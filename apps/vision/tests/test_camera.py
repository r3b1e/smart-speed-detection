from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.avfoundation import LIVE_CAMERA_UNIQUE_ID, choose_camera
from app import camera as camera_module
from app.camera import CameraUnavailable, LiveCamera, backoff_delay, map_camera_index


def test_choose_camera_matches_exact_unique_id():
    target = (LIVE_CAMERA_UNIQUE_ID, "USB Camera VID:1133 PID:2057")
    devices = [
        ("EAB7A68F-EC2B-4487-AADF-D8A91C1CB782", "FaceTime HD Camera"),
        target,
        ("E63B6BDD-EB3D-46B0-81D5-42D500000001", "iPhone Camera"),
    ]
    assert choose_camera(devices) == target


def test_choose_camera_refuses_when_configured_device_is_missing():
    # Neither the exact unique ID nor the model ID prefix nor 'iphone' in name
    # is present — should raise.
    with pytest.raises(ValueError):
        choose_camera(
            [
                ("EAB7A68F-EC2B-4487-AADF-D8A91C1CB782", "FaceTime HD Camera"),
                ("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB", "USB Webcam"),
            ]
        )


def test_map_camera_index_uses_registry_position():
    devices = [
        ("EAB7A68F-EC2B-4487-AADF-D8A91C1CB782", "FaceTime HD Camera"),
        (LIVE_CAMERA_UNIQUE_ID, "USB Camera VID:1133 PID:2057"),
        ("E63B6BDD-EB3D-46B0-81D5-42D500000001", "iPhone Camera"),
    ]
    assert map_camera_index(devices, opencv_max_scan=8) == 1


def test_camera_refuses_external_camera_source():
    cfg = SimpleNamespace(camera_source="rtsp://other-camera", opencv_max_scan=8)
    camera = LiveCamera(cfg, cfg.camera_source)
    with pytest.raises(CameraUnavailable, match="locked to the configured camera"):
        camera.open()


def test_camera_passes_backend_separately_from_device_index(monkeypatch):
    devices = [(LIVE_CAMERA_UNIQUE_ID, "USB Camera VID:1133 PID:2057")]
    calls = []

    class FakeCapture:
        def isOpened(self):
            return True

        def read(self):
            return True, object()

        def release(self):
            pass

    monkeypatch.setattr(camera_module.avfoundation, "camera_devices", lambda: devices)
    monkeypatch.setattr(camera_module.cv2, "CAP_AVFOUNDATION", 1200, raising=False)

    def video_capture(index, backend):
        calls.append((index, backend))
        return FakeCapture()

    monkeypatch.setattr(camera_module.cv2, "VideoCapture", video_capture)
    cfg = SimpleNamespace(
        camera_source=None,
        opencv_max_scan=8,
        max_frame_read_ms=10,
        camera_unique_id=LIVE_CAMERA_UNIQUE_ID,
        camera_model_id="iPhone15,5",
    )
    camera = LiveCamera(cfg, None)
    camera.open()
    camera.close()

    assert calls == [(0, 1200)]


def test_map_camera_index_never_falls_back():
    with pytest.raises(CameraUnavailable):
        map_camera_index(
            [("EAB7A68F-EC2B-4487-AADF-D8A91C1CB782", "FaceTime HD Camera")],
            opencv_max_scan=8,
        )


def test_map_camera_index_rejects_empty():
    with pytest.raises(CameraUnavailable):
        map_camera_index([], opencv_max_scan=8)


def test_map_camera_index_out_of_scan_range():
    with pytest.raises(CameraUnavailable):
        map_camera_index(
            [
                ("EAB7A68F-EC2B-4487-AADF-D8A91C1CB782", "FaceTime HD Camera"),
                (LIVE_CAMERA_UNIQUE_ID, "USB Camera VID:1133 PID:2057"),
            ],
            opencv_max_scan=1,
        )


def test_backoff_first_attempt_is_exactly_min():
    assert backoff_delay(1, 1000, 30000, rng=lambda: 0.5) == 1000
    assert backoff_delay(1, 1000, 30000, rng=lambda: 1.0) == 1000


def test_backoff_caps_at_max():
    delay = backoff_delay(10, 1000, 30000, rng=lambda: 0.0)
    assert 0 <= delay <= 30000


def test_backoff_floor_respects_min():
    delay = backoff_delay(6, 1000, 30000, rng=lambda: 0.0)
    assert delay == 1000