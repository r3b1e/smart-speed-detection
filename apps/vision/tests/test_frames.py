from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.frames import YoloDetector, encode_jpeg, make_thumbnail, overlay_caption


def make_frame() -> np.ndarray:
    rng = np.random.default_rng(1)
    return (rng.integers(0, 255, (360, 640, 3), dtype=np.uint8)).astype(np.uint8)


def test_encode_jpeg_returns_jpeg():
    data = encode_jpeg(make_frame(), 85)
    assert data[:2] == b"\xff\xd8"
    assert data[-2:] == b"\xff\xd9"


def test_make_thumbnail_scales_width():
    thumb = make_thumbnail(make_frame(), 320)
    img = cv2.imdecode(np.frombuffer(thumb, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert img is not None
    assert img.shape[1] == 320
    assert img.shape[0] < 360


def test_overlay_caption_draws_in_place():
    frame = make_frame()
    before = frame.copy()
    overlay_caption(frame, "SmartSpeed hello")
    assert not np.array_equal(frame, before)


def test_yolo_disabled_accepts_every_frame():
    detector = YoloDetector(enable=False, classes=("car",))
    confirmed, boxes = detector.confirm(make_frame())
    assert confirmed is True
    assert boxes == []