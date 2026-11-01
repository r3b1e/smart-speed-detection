from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import httpx
import pytest

import app.config as config_mod
from app.capture import CameraState, HeartbeatWorker
from app.config import Config
from app.uploader import UploadError, Uploader


def make_cfg(monkeypatch) -> Config:
    monkeypatch.setenv("SERVER_URL", "http://test-server")
    monkeypatch.setenv("VISION_SHARED_SECRET", "secret-1234")
    return config_mod.load()


@pytest.mark.asyncio
async def test_upload_frame_posts_multipart_with_secret(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("x-vision-secret")
        captured["body"] = request.content
        return httpx.Response(201, json={})

    transport = httpx.MockTransport(handler)
    uploader = Uploader(make_cfg(monkeypatch), transport=transport)
    await uploader.upload_frame("det-1", b"\xff\xd8jpeg", b"\xff\xd8thumb")
    assert captured["url"].endswith("/api/ingest/detections/det-1/frame")
    assert captured["auth"] == "secret-1234"
    assert b'name="frame"' in captured["body"]
    assert b'name="thumb"' in captured["body"]
    assert b"frame.jpg" in captured["body"]
    assert b"\xff\xd8jpeg" in captured["body"]
    assert b"\xff\xd8thumb" in captured["body"]
    await uploader.aclose()


@pytest.mark.asyncio
async def test_upload_frame_raises_on_rejection(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(415, json={"error": "bad type"})

    transport = httpx.MockTransport(handler)
    uploader = Uploader(make_cfg(monkeypatch), transport=transport)
    with pytest.raises(UploadError):
        await uploader.upload_frame("det-1", b"bad", b"bad")
    await uploader.aclose()


@pytest.mark.asyncio
async def test_heartbeat_sends_vision_status(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content
        return httpx.Response(204)

    transport = httpx.MockTransport(handler)
    uploader = Uploader(make_cfg(monkeypatch), transport=transport)
    await uploader.heartbeat("waiting", {"cameraStatus": "waiting", "dropped": 0})
    assert captured["url"].endswith("/api/ingest/heartbeat")
    assert captured["body"]  # non-empty JSON
    await uploader.aclose()


@pytest.mark.asyncio
async def test_heartbeat_worker_uses_application_event_loop(monkeypatch):
    cfg = make_cfg(monkeypatch)
    main_thread = threading.get_ident()
    sent = asyncio.Event()

    async def sender(_status: str, _meta: dict) -> None:
        assert threading.get_ident() == main_thread
        sent.set()

    worker = HeartbeatWorker(
        cfg,
        SimpleNamespace(state=lambda: CameraState.OK),
        SimpleNamespace(size=1),
        SimpleNamespace(queue_drops=0),
        sender,
        asyncio.get_running_loop(),
    )
    worker.start()
    try:
        await asyncio.wait_for(sent.wait(), timeout=1)
    finally:
        worker.stop()
        await asyncio.to_thread(worker.join, 1)