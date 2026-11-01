"""Server uploader: posts JPEG + thumbnail to the ingest frame endpoint."""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

import httpx

from .config import Config

logger = logging.getLogger("smart-speed-vision.uploader")


class UploadError(Exception):
    """Raised when the server rejects or is unreachable for an upload."""


class Uploader:
    def __init__(self, cfg: Config, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._cfg = cfg
        self._client = httpx.AsyncClient(
            base_url=cfg.server_url,
            headers={"x-vision-secret": cfg.vision_shared_secret},
            timeout=cfg.request_timeout_s,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def upload_frame(self, detection_id: str, jpeg: bytes, thumb: bytes) -> None:
        files = {
            "frame": ("frame.jpg", jpeg, "image/jpeg"),
            "thumb": ("thumb.jpg", thumb, "image/jpeg"),
        }
        try:
            res = await self._client.post(
                f"/api/ingest/detections/{detection_id}/frame", files=files
            )
        except httpx.HTTPError as exc:
            raise UploadError(f"upload transport error: {exc}") from exc
        if res.status_code != 201:
            raise UploadError(f"server rejected frame upload: {res.status_code}")

    async def heartbeat(self, status: str, meta: dict[str, Any]) -> None:
        body = {"source": "vision", "status": status, "meta": meta, "receivedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            await self._client.post("/api/ingest/heartbeat", json=body)
        except httpx.HTTPError as exc:  # pragma: no cover - server briefly down
            logger.debug("heartbeat failed: %s", exc)