"""Open only the configured camera and verify its OpenCV capture."""

from __future__ import annotations

import logging
import time

import cv2

from . import avfoundation
from .config import Config

logger = logging.getLogger("smart-speed-vision.camera")


class CameraUnavailable(Exception):
    """Raised when no iPhone camera can be opened (waiting / offline)."""


def map_camera_index(
    devices: list[tuple[str, str]],
    opencv_max_scan: int,
    unique_id: str | None = None,
    model_id: str | None = None,
) -> int:
    """Map the configured camera to its OpenCV index.

    cv2 and AVFoundation enumerate the same device registry, so the iPhone's
    index equals its position in the AVFoundation video-device list. The index
    is verified by the caller opening it and reading a frame.

    *unique_id* and *model_id* are forwarded to ``avfoundation.choose_camera``
    so the selection is locked to the specific device stored in Config.
    """
    if not devices:
        raise CameraUnavailable("no cameras visible to macOS")
    kwargs: dict = {}
    if unique_id is not None:
        kwargs["unique_id"] = unique_id
    if model_id is not None:
        kwargs["model_id"] = model_id
    try:
        device = avfoundation.choose_camera(devices, **kwargs)
    except ValueError as exc:
        raise CameraUnavailable(str(exc)) from exc
    index = devices.index(device)
    if index < 0 or index >= opencv_max_scan:
        raise CameraUnavailable(f"configured camera index {index} out of scan range")
    return index


class LiveCamera:
    """Owns a cv2.VideoCapture pointing only at the configured camera."""

    def __init__(self, cfg: Config, source: str | None) -> None:
        self._cfg = cfg
        self._source = source
        self._cap: cv2.VideoCapture | None = None
        self._opened_as: str | None = None

    @property
    def label(self) -> str:
        return self._opened_as or "unopened"

    def open(self) -> None:
        if self._source:
            raise CameraUnavailable(
                "CAMERA_SOURCE is disabled; live scan is locked to the configured camera"
            )
        self._open_selected_device()

    def _open_selected_device(self) -> None:
        devices = avfoundation.camera_devices()
        index = map_camera_index(
            devices,
            self._cfg.opencv_max_scan,
            unique_id=self._cfg.camera_unique_id,
            model_id=self._cfg.camera_model_id,
        )
        cap = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
        self._verify(cap, f"index {index} ({devices[index][1]})")
        self._cap = cap
        self._opened_as = devices[index][1]

    def _verify(self, cap: cv2.VideoCapture, label: str) -> None:
        if not cap.isOpened():
            cap.release()
            raise CameraUnavailable(f"camera {label} did not open")
        deadline = time.monotonic() + self._cfg.max_frame_read_ms / 1000.0
        ok = False
        while time.monotonic() < deadline:
            ok, _ = cap.read()
            if ok:
                break
        if not ok:
            cap.release()
            raise CameraUnavailable(f"camera {label} opened but produced no frames")

    def read(self):
        if self._cap is None:
            raise CameraUnavailable("camera not open")
        ok, frame = self._cap.read()
        if not ok or frame is None:
            raise CameraUnavailable("camera read failed")
        return frame

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._opened_as = None


def backoff_delay(attempt: int, min_ms: int, max_ms: int, rng=None) -> float:
    """Exponential backoff with jitter: min stays, max caps; attempt 1 == min.

    Mirrors the bridge backoff so camera retries land 1 s .. 30 s.
    """
    import random

    rng = rng or random.random
    ceiling = min(max_ms, min_ms * 2 ** (attempt - 1))
    floor = min(ceiling, min_ms)
    return floor + rng() * (ceiling - floor)