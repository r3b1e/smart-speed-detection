"""Bounded ring buffer of raw camera frames.

Frames are stored as numpy BGR arrays (cheap); JPEG encoding is deferred until
a capture is requested ("lazy JPEG"). Each entry carries both a monotonic and a
wall-clock timestamp so a capture can be anchored to the bridge event time.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass


@dataclass(slots=True)
class FrameEntry:
    monotonic_ns: int
    wall_seconds: float
    frame: object


class RingBuffer:
    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("ring capacity must be >= 1")
        self._capacity = capacity
        self._entries: deque[FrameEntry] = deque(maxlen=capacity)
        self._drops = 0
        self._lock = threading.Lock()

    def push(self, frame: object) -> None:
        with self._lock:
            if len(self._entries) == self._capacity:
                self._drops += 1
            self._entries.append(
                FrameEntry(
                    monotonic_ns=time.monotonic_ns(),
                    wall_seconds=time.time(),
                    frame=frame,
                )
            )

    def closest(self, target_wall_seconds: float, tolerance_ms: int) -> FrameEntry | None:
        """Frame whose wall-clock timestamp is nearest the target, within tolerance."""
        with self._lock:
            best: FrameEntry | None = None
            best_delta: float | None = None
            for entry in self._entries:
                delta = abs(entry.wall_seconds - target_wall_seconds)
                if best_delta is None or delta < best_delta:
                    best_delta = delta
                    best = entry
            if best is None or best_delta is None:
                return None
            if best_delta * 1000.0 > tolerance_ms:
                return None
            return best

    def window(self, start_wall_seconds: float, end_wall_seconds: float) -> list[FrameEntry]:
        """Snapshot of frames whose wall-clock time is within [start, end], oldest first."""
        with self._lock:
            return [
                e for e in self._entries if start_wall_seconds <= e.wall_seconds <= end_wall_seconds
            ]

    def latest(self) -> FrameEntry | None:
        with self._lock:
            if not self._entries:
                return None
            return self._entries[-1]

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._entries)

    @property
    def drops(self) -> int:
        with self._lock:
            return self._drops

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()