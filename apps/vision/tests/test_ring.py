from __future__ import annotations

import time

import cv2
import numpy as np

from app.ring import RingBuffer


def make_frame(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (rng.integers(0, 255, (180, 320, 3), dtype=np.uint8) + 128).astype(np.uint8)


def test_push_and_size():
    ring = RingBuffer(3)
    for i in range(3):
        ring.push(make_frame(i))
    assert ring.size == 3
    assert ring.drops == 0


def test_capacity_evicts_oldest_and_counts_drops():
    ring = RingBuffer(2)
    for i in range(4):
        ring.push(make_frame(i))
    assert ring.size == 2
    assert ring.drops == 2


def test_closest_within_tolerance():
    ring = RingBuffer(10)
    now = time.time()
    for i, off in enumerate((-0.2, 0.0, 0.3)):
        ring.push(make_frame(i))
        ring._entries[-1].wall_seconds = now + off
    picked = ring.closest(now + 0.05, tolerance_ms=150)
    assert picked is not None
    assert abs((picked.wall_seconds - (now + 0.05)) * 1000) <= 150


def test_closest_outside_tolerance_returns_none():
    ring = RingBuffer(10)
    now = time.time()
    ring.push(make_frame(1))
    ring._entries[-1].wall_seconds = now + 2.5
    assert ring.closest(now, tolerance_ms=400) is None


def test_empty_ring_returns_none():
    ring = RingBuffer(5)
    assert ring.closest(time.time(), tolerance_ms=400) is None
    assert ring.latest() is None


def test_latest_is_last_pushed():
    ring = RingBuffer(5)
    frames = [make_frame(i) for i in range(3)]
    for frame in frames:
        ring.push(frame)
    latest = ring.latest()
    assert latest is not None
    assert latest.frame is frames[-1]
    assert ring.size == 3


def test_clear():
    ring = RingBuffer(5)
    ring.push(make_frame(0))
    ring.clear()
    assert ring.size == 0


def test_ring_stores_raw_frame_references_for_lazy_encoding():
    ring = RingBuffer(5)
    frame = make_frame(7)
    ring.push(frame)
    assert ring.latest().frame is frame


def test_cv2_available():
    assert cv2 is not None