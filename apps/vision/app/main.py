"""FastAPI app: POST /capture, GET /health, GET /live (MJPEG)."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Iterable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .capture import CaptureWorker, CameraState, HeartbeatWorker
from .camera import LiveCamera
from .config import Config, load as load_config
from .frames import (
    YoloDetector,
    background_of,
    draw_motion_box,
    encode_jpeg,
    make_thumbnail,
    overlay_caption,
    pick_motion_frame,
)
from .log import setup_logging
from .ring import RingBuffer
from .stats import Stats
from .uploader import UploadError, Uploader

BOUNDARY = "frame"

RING_FPS = 15  # MJPEG preview rate (the ring itself is sized by cfg.ring_fps)


async def mjpeg_frames(ring: RingBuffer, cfg: Config) -> AsyncIterator[bytes]:
    while True:
        entry = ring.latest()
        if entry is not None:
            payload = encode_jpeg(entry.frame, cfg.jpeg_quality)
            yield (
                f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                f"Content-Length: {len(payload)}\r\n\r\n"
            ).encode()
            yield payload
            yield b"\r\n"
        await asyncio.sleep(1 / RING_FPS)


class CaptureRequest(BaseModel):
    detectionId: str = Field(min_length=1)
    eventTs: dt.datetime
    offsetMs: int = 0


@dataclass
class Services:
    cfg: Config
    logger: logging.Logger
    stats: Stats
    ring: RingBuffer
    uploader: Uploader
    yolo: YoloDetector
    capture: CaptureWorker | None
    heartbeat: HeartbeatWorker | None
    started_at: float = time.time()


def _check_vision_secret(request: Request, cfg: Config) -> None:
    if request.headers.get("x-vision-secret") != cfg.vision_shared_secret:
        raise HTTPException(status_code=401, detail="bad vision secret")


def create_app(
    cfg: Config | None = None,
    *,
    camera_type: type[LiveCamera] | None = None,
    uploader: Uploader | None = None,
    enable_capture: bool = True,
    enable_heartbeat: bool = True,
) -> FastAPI:
    cfg = cfg or load_config()
    if camera_type is None:
        if (cfg.camera_source or "").lower() == "android":
            from .android import AndroidCamera

            camera_type = AndroidCamera  # type: ignore[assignment]
        else:
            camera_type = LiveCamera
    logger = setup_logging(cfg)
    stats = Stats()
    ring = RingBuffer(max(1, int(cfg.ring_seconds * cfg.ring_fps)))
    up = uploader or Uploader(cfg)
    yolo = YoloDetector(cfg.enable_yolo, cfg.yolo_classes)
    capture: CaptureWorker | None = None
    heartbeat: HeartbeatWorker | None = None

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        capture: CaptureWorker | None = None
        heartbeat: HeartbeatWorker | None = None
        if enable_capture:
            capture = CaptureWorker(cfg, ring, stats, camera_type=camera_type)
            capture.start()
        if enable_heartbeat and capture is not None:
            heartbeat = HeartbeatWorker(
                cfg,
                capture,
                ring,
                stats,
                up.heartbeat,
                asyncio.get_running_loop(),
            )
            heartbeat.start()
        services.capture = capture
        services.heartbeat = heartbeat
        logger.info("vision service ready (ring %.1fs, yolo=%s)", cfg.ring_seconds, cfg.enable_yolo)
        try:
            yield
        finally:
            if heartbeat is not None:
                heartbeat.stop()
                await asyncio.to_thread(heartbeat.join, cfg.request_timeout_s + 1)
            if capture is not None:
                capture.stop()
            await up.aclose()
            logger.info("session summary: %s", stats.summary())

    services = Services(cfg=cfg, logger=logger, stats=stats, ring=ring, uploader=up, yolo=yolo, capture=capture, heartbeat=heartbeat)
    app = FastAPI(title="Smart Speed Vision", version=__version__, lifespan=lifespan)
    # The dashboard probes /health and renders /live directly from the browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.state.services = services

    @app.get("/health")
    async def health() -> dict:
        state = services.capture.state() if services.capture else CameraState.WAITING
        return {
            "status": state.value,
            "cameraStatus": state.value,
            "cameraSource": cfg.camera_source or "continuity",
            "cameraLabel": services.capture.camera_label() if services.capture else None,
            "ringFrames": ring.size,
            "uptimeMs": int((time.time() - services.started_at) * 1000),
            "stats": stats.as_dict(),
            "version": __version__,
        }

    async def _motion_pick(event: float):
        """Wait until frames after the event exist, then pick the one with most motion."""
        after = cfg.motion_after_ms / 1000.0
        before = cfg.motion_before_ms / 1000.0
        deadline = time.monotonic() + after + 1.0
        while time.monotonic() < deadline:
            latest = ring.latest()
            if latest is not None and latest.wall_seconds >= event + after:
                break
            await asyncio.sleep(0.05)
        candidates = ring.window(event - before, event + after)
        reference = ring.window(event - before - 1.0, event - before)
        if not candidates or not reference:
            return None, None
        # keep at most 5 evenly spaced reference frames for the median background
        step = max(1, len(reference) // 5)
        background = await asyncio.to_thread(background_of, [e.frame for e in reference[::step]])
        index, bbox, score = await asyncio.to_thread(
            pick_motion_frame, [e.frame for e in candidates], background
        )
        if index is None:
            services.logger.info("capture: no motion found (max %.2f%% changed), using time match", score * 100)
            return None, None
        services.logger.info(
            "capture: motion frame %+.0f ms from event (%.1f%% changed)",
            (candidates[index].wall_seconds - event) * 1000.0,
            score * 100,
        )
        return candidates[index], bbox

    @app.post("/capture")
    async def capture(body: CaptureRequest, request: Request) -> dict:
        _check_vision_secret(request, cfg)
        event = body.eventTs.timestamp()
        entry = None
        motion_box = None
        if cfg.capture_mode == "motion":
            entry, motion_box = await _motion_pick(event)
        if entry is None:
            target = event - body.offsetMs / 1000.0
            entry = ring.closest(target, cfg.frame_tolerance_ms)
        if entry is None:
            services.logger.info("capture miss for %s (no frame within %.0f ms)", body.detectionId, cfg.frame_tolerance_ms)
            return {"status": "failed", "reason": "no frame within window"}
        frame = entry.frame.copy()
        if motion_box is not None:
            draw_motion_box(frame, motion_box)
        confirmed, boxes = services.yolo.confirm(frame)
        if not confirmed:
            return {"status": "failed", "reason": "no vehicle confirmed in frame"}
        if boxes:
            services.yolo.draw_boxes(frame, boxes)
        if cfg.overlay_caption:
            local = dt.datetime.fromtimestamp(entry.wall_seconds)
            delta_ms = (entry.wall_seconds - event) * 1000.0
            how = "motion" if motion_box is not None else "time"
            overlay_caption(frame, f"SmartSpeed {local.strftime('%Y-%m-%d %H:%M:%S')} | {delta_ms:+.0f}ms ({how})")
        jpeg = encode_jpeg(frame, cfg.jpeg_quality)
        thumb = make_thumbnail(frame, cfg.thumb_width)
        try:
            await services.uploader.upload_frame(body.detectionId, jpeg, thumb)
        except UploadError as exc:
            services.stats.uploads_failed += 1
            services.logger.warning("frame upload failed for %s: %s", body.detectionId, exc)
            return {"status": "failed", "reason": f"upload failed: {exc}", "detectionId": body.detectionId}
        services.stats.frames_captured += 1
        services.stats.uploads_ok += 1
        return {"status": "ok", "detectionId": body.detectionId}

    @app.get("/live")
    async def live(request: Request, token: str = "") -> StreamingResponse:
        if cfg.live_token and token != cfg.live_token:
            raise HTTPException(status_code=401, detail="bad stream token")
        return StreamingResponse(
            mjpeg_frames(ring, cfg),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store"},
        )

    return app