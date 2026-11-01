"""Thread-safe session counters for the summary line on exit."""

from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass(slots=True)
class Stats:
    frames_processed: int = 0
    frames_captured: int = 0
    uploads_ok: int = 0
    uploads_failed: int = 0
    queue_drops: int = 0
    camera_flips: int = 0

    _lock: threading.Lock = threading.Lock()

    def summary(self) -> str:
        with self._lock:
            return (
                f"framesProcessed={self.frames_processed} "
                f"framesCaptured={self.frames_captured} "
                f"uploads ok={self.uploads_ok} failed={self.uploads_failed} "
                f"queueDrops={self.queue_drops} cameraFlips={self.camera_flips}"
            )

    def as_dict(self) -> dict:
        with self._lock:
            return {
                "framesProcessed": self.frames_processed,
                "framesCaptured": self.frames_captured,
                "uploadsOk": self.uploads_ok,
                "uploadsFailed": self.uploads_failed,
                "queueDrops": self.queue_drops,
                "cameraFlips": self.camera_flips,
            }