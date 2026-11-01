from __future__ import annotations

import datetime as dt
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.config as config_mod
from app.config import Config
from app.main import create_app, mjpeg_frames


class FakeUploader:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def upload_frame(self, detection_id: str, jpeg: bytes, thumb: bytes) -> None:
        self.calls.append(("frame", detection_id, jpeg, thumb))

    async def heartbeat(self, status: str, meta: dict) -> None:
        self.calls.append(("hb", status, meta))

    async def aclose(self) -> None:
        pass


def make_cfg(monkeypatch) -> Config:
    monkeypatch.setenv("SERVER_URL", "http://test-server")
    monkeypatch.setenv("VISION_SHARED_SECRET", "secret-1234")
    monkeypatch.setenv("LIVE_STREAM_TOKEN", "stream-token")
    monkeypatch.setenv("HEARTBEAT_MS", "60000")
    return config_mod.load()


def make_frame() -> np.ndarray:
    return np.zeros((180, 320, 3), dtype=np.uint8)


def push_frame(app, at_epoch: float) -> None:
    ring = app.state.services.ring
    ring.push(make_frame())
    ring._entries[-1].wall_seconds = at_epoch


def iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch).isoformat()


def capture(client, detection_id: str, epoch: float, offset_ms: int = 0):
    return client.post(
        "/capture",
        json={"detectionId": detection_id, "eventTs": iso(epoch), "offsetMs": offset_ms},
        headers={"x-vision-secret": "secret-1234"},
    )


def test_health_when_capture_disabled(monkeypatch):
    cfg = make_cfg(monkeypatch)
    app = create_app(cfg, uploader=FakeUploader(), enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        body = client.get("/health").json()
        assert body["cameraStatus"] == "waiting"
        assert body["version"] == "1.0.0"
        assert "stats" in body


def test_capture_requires_secret(monkeypatch):
    cfg = make_cfg(monkeypatch)
    app = create_app(cfg, uploader=FakeUploader(), enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        payload = {"detectionId": "d1", "eventTs": iso(time.time())}
        assert client.post("/capture", json=payload).status_code == 401
        bad = client.post(
            "/capture", json=payload, headers={"x-vision-secret": "wrong"}
        )
        assert bad.status_code == 401


def test_capture_ok_uploads_frame(monkeypatch):
    cfg = make_cfg(monkeypatch)
    uploader = FakeUploader()
    app = create_app(cfg, uploader=uploader, enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        now = time.time()
        push_frame(app, now)
        res = capture(client, "d1", now)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert uploader.calls[0][0] == "frame"
        assert uploader.calls[0][1] == "d1"
        assert uploader.calls[0][2][:2] == b"\xff\xd8"
        assert uploader.calls[0][3][:2] == b"\xff\xd8"


def test_capture_offset_shifts_target(monkeypatch):
    cfg = make_cfg(monkeypatch)
    uploader = FakeUploader()
    app = create_app(cfg, uploader=uploader, enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        now = time.time()
        push_frame(app, now - 0.3)
        # target = eventTs(now) - 300 ms == the frame time
        res = capture(client, "d-offset", now, offset_ms=300)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert uploader.calls[0][1] == "d-offset"


def test_capture_fails_when_no_frame_in_window(monkeypatch):
    cfg = make_cfg(monkeypatch)
    uploader = FakeUploader()
    app = create_app(cfg, uploader=uploader, enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        push_frame(app, time.time() - 5)
        res = capture(client, "d-miss", time.time() - 4)
        assert res.status_code == 200
        assert res.json()["status"] == "failed"
        assert not uploader.calls


def test_live_requires_token(monkeypatch):
    cfg = make_cfg(monkeypatch)
    app = create_app(cfg, uploader=FakeUploader(), enable_capture=False, enable_heartbeat=False)
    with TestClient(app) as client:
        assert client.get("/live").status_code == 401
        assert client.get("/live?token=wrong").status_code == 401


@pytest.mark.asyncio
async def test_mjpeg_stream_contains_frame(monkeypatch):
    cfg = make_cfg(monkeypatch)
    app = create_app(cfg, uploader=FakeUploader(), enable_capture=False, enable_heartbeat=False)
    push_frame(app, time.time())
    stream = mjpeg_frames(app.state.services.ring, cfg)
    buf = b""
    for _ in range(5):
        buf += await anext(stream)
        if b"--frame" in buf and b"\xff\xd8" in buf:
            break
    await stream.aclose()
    assert b"--frame" in buf
    assert b"\xff\xd8" in buf