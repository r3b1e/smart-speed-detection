"""Capture + heartbeat worker threads.

``CaptureWorker`` owns the camera lifecycle: open/verify, read frames into the
ring buffer, and on any failure retry with exponential backoff (1 s -> 30 s).
Camera state flips waiting/offline on changes with one log line per attempt,
never per frame. ``HeartbeatWorker`` reports vision status to the server.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from enum import Enum

from .camera import CameraUnavailable, LiveCamera, backoff_delay
from .config import Config
from .ring import RingBuffer
from .stats import Stats

logger = logging.getLogger("smart-speed-vision.capture")


class CameraState(str, Enum):
    OK = "ok"
    WAITING = "waiting"
    OFFLINE = "offline"


class CaptureWorker(threading.Thread):
    def __init__(
        self,
        cfg: Config,
        ring: RingBuffer,
        stats: Stats,
        rng=None,
        camera_type: type[LiveCamera] = LiveCamera,
    ) -> None:
        super().__init__(name="smart-speed-capture", daemon=True)
        self._cfg = cfg
        self._ring = ring
        self._stats = stats
        self._rng = rng
        self._camera_type = camera_type
        self._stop_event = threading.Event()
        self._state = CameraState.WAITING
        self._state_lock = threading.Lock()
        self._attempt = 0
        self._camera: LiveCamera | None = None

    def stop(self) -> None:
        self._stop_event.set()

    def state(self) -> CameraState:
        with self._state_lock:
            return self._state

    def camera_label(self) -> str | None:
        with self._state_lock:
            return self._camera.label if self._camera is not None else None

    def _set_state(self, state: CameraState) -> None:
        changed = False
        with self._state_lock:
            if self._state != state:
                self._state = state
                changed = True
                self._stats.camera_flips += 1
        if changed:
            logger.info("camera state -> %s", state.value)

    def run(self) -> None:
        while not self._stop_event.is_set():
            self._attempt += 1
            try:
                self._open_and_read()
            except CameraUnavailable as exc:
                self._set_state(CameraState.WAITING)
                self._pause(str(exc))
            except Exception as exc:  # pragma: no cover - unexpected camera errors
                logger.warning("camera loop error: %s", exc)
                self._set_state(CameraState.OFFLINE)
                self._pause("unexpected error")

    def _pause(self, reason: str) -> None:
        if self._stop_event.is_set():
            return
        delay = backoff_delay(
            self._attempt,
            self._cfg.reconnect_min_ms,
            self._cfg.reconnect_max_ms,
            rng=self._rng,
        )
        logger.info(
            "camera unavailable (%s) — retry in %.0f ms (attempt %d)",
            reason,
            delay,
            self._attempt,
        )
        self._stop_event.wait(delay / 1000.0)

    def _open_and_read(self) -> None:
        camera = self._camera_type(self._cfg, self._cfg.camera_source)
        camera.open()
        self._camera = camera
        self._attempt = 0
        self._set_state(CameraState.OK)
        logger.info("camera connected: %s", camera.label)
        try:
            while not self._stop_event.is_set():
                try:
                    frame = camera.read()
                except CameraUnavailable as exc:
                    self._set_state(CameraState.OFFLINE)
                    raise exc
                self._ring.push(frame)
                self._stats.frames_processed += 1
                self._stats.queue_drops = self._ring.drops
        finally:
            camera.close()
            self._camera = None
        self._set_state(CameraState.WAITING)


class HeartbeatWorker(threading.Thread):
    def __init__(
        self,
        cfg: Config,
        worker: CaptureWorker,
        ring: RingBuffer,
        stats: Stats,
        sender,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__(name="smart-speed-heartbeat", daemon=True)
        self._cfg = cfg
        self._worker = worker
        self._ring = ring
        self._stats = stats
        self._sender = sender
        self._loop = loop
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        self._send()
        while not self._stop_event.wait(self._cfg.heartbeat_ms / 1000.0):
            self._send()

    def _send(self) -> None:
        state = self._worker.state()
        meta = {
            "cameraStatus": state.value,
            "cameraSource": self._cfg.camera_source or "continuity",
            "ringFrames": self._ring.size,
            "dropped": self._stats.queue_drops,
        }
        future = asyncio.run_coroutine_threadsafe(self._sender(state.value, meta), self._loop)
        try:
            future.result(timeout=self._cfg.request_timeout_s + 1)
        except TimeoutError:  # pragma: no cover - network stalls
            future.cancel()
            logger.debug("heartbeat send timed out")
        except Exception as exc:  # pragma: no cover - network hiccups
            logger.debug("heartbeat send failed: %s", exc)