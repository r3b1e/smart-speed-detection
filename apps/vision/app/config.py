"""Vision service configuration loaded from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "true" if default else "false").lower()
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    server_url: str
    vision_shared_secret: str
    camera_source: str | None
    # --- Locked iPhone device identity ---
    # These must match the physical iPhone used as the Continuity Camera.
    # avfoundation.choose_camera() tries unique_id first, then model_id prefix,
    # then falls back to an 'iphone' name match with a warning.
    camera_unique_id: str  # AVFoundation uniqueID, e.g. "E63B6BDD-EB3D-46B0-81D5-42D500000001"
    camera_model_id: str   # Apple model identifier, e.g. "iPhone15,5"
    ring_seconds: float
    capture_offset_ms: int
    jpeg_quality: int
    overlay_caption: bool
    enable_yolo: bool
    heartbeat_ms: int
    reconnect_min_ms: int
    reconnect_max_ms: int
    port: int
    log_level: str
    live_token: str | None
    cors_origins: tuple[str, ...]
    frame_tolerance_ms: int
    opencv_max_scan: int
    thumb_width: int
    max_frame_read_ms: int
    request_timeout_s: float
    yolo_classes: tuple[str, ...] = field(default_factory=tuple)
    # "motion": pick the frame around the event that differs most from the empty
    # scene (robust to timing offsets); "closest": nearest frame to eventTs - offset.
    capture_mode: str = "motion"
    ring_fps: int = 15  # camera frames/s the ring must hold (capacity = ring_seconds * ring_fps)
    motion_before_ms: int = 800
    motion_after_ms: int = 700

    def as_json(self) -> dict[str, Any]:
        return {
            "cameraSource": self.camera_source,
            "ringSeconds": self.ring_seconds,
            "captureOffsetMs": self.capture_offset_ms,
            "enableYolo": self.enable_yolo,
        }


def _load_env_file() -> None:
    """Load apps/vision/.env if present; real environment variables win."""
    try:
        from dotenv import load_dotenv
    except Exception:  # pragma: no cover - dotenv optional
        return
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
    load_dotenv(env_file, override=False)


def load() -> Config:
    _load_env_file()
    # Import constants lazily so tests can patch avfoundation before loading config.
    from .avfoundation import LIVE_CAMERA_UNIQUE_ID, LIVE_CAMERA_MODEL_ID

    yolo_classes = tuple(
        c.strip() for c in _env("YOLO_CLASSES", "car,truck,bus").split(",") if c.strip()
    )
    return Config(
        server_url=_env("SERVER_URL", "http://localhost:4000").rstrip("/"),
        vision_shared_secret=_env("VISION_SHARED_SECRET", "dev-vision-secret-change-me"),
        camera_source=_env("CAMERA_SOURCE", "") or None,
        camera_unique_id=_env("LIVE_CAMERA_UNIQUE_ID", LIVE_CAMERA_UNIQUE_ID),
        camera_model_id=_env("LIVE_CAMERA_MODEL_ID", LIVE_CAMERA_MODEL_ID),
        ring_seconds=_env_float("RING_SECONDS", 3.0),
        capture_offset_ms=_env_int("CAPTURE_OFFSET_MS", 200),
        jpeg_quality=_env_int("JPEG_QUALITY", 85),
        overlay_caption=_env_bool("OVERLAY_CAPTION", True),
        enable_yolo=_env_bool("ENABLE_YOLO", False),
        heartbeat_ms=_env_int("HEARTBEAT_MS", 5000),
        reconnect_min_ms=_env_int("RECONNECT_MIN_MS", 1000),
        reconnect_max_ms=_env_int("RECONNECT_MAX_MS", 30000),
        port=_env_int("PORT", 8001),
        log_level=_env("LOG_LEVEL", "INFO").upper(),
        live_token=_env("LIVE_STREAM_TOKEN", "change-me") or None,
        cors_origins=tuple(
            o.strip()
            for o in _env(
                "VISION_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173"
            ).split(",")
            if o.strip()
        ),
        frame_tolerance_ms=_env_int("FRAME_TOLERANCE_MS", 400),
        opencv_max_scan=_env_int("OPENCV_MAX_SCAN", 8),
        thumb_width=_env_int("THUMB_WIDTH", 320),
        max_frame_read_ms=_env_int("MAX_FRAME_READ_MS", 2500),
        request_timeout_s=_env_float("REQUEST_TIMEOUT_S", 8.0),
        yolo_classes=yolo_classes,
        capture_mode=_env("CAPTURE_MODE", "motion").lower(),
        ring_fps=_env_int("RING_FPS", 15),
        motion_before_ms=_env_int("MOTION_BEFORE_MS", 800),
        motion_after_ms=_env_int("MOTION_AFTER_MS", 700),
    )