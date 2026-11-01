"""Frame processing: JPEG/thumbnail encoding, optional caption overlay, YOLO gate."""

from __future__ import annotations

import logging

import cv2

logger = logging.getLogger("smart-speed-vision.frames")


def encode_jpeg(frame, quality: int) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("cv2 failed to encode JPEG")
    return buf.tobytes()


def make_thumbnail(frame, width: int) -> bytes:
    height, frame_width = frame.shape[:2]
    scale = width / frame_width
    resized = cv2.resize(frame, (width, int(height * scale)), interpolation=cv2.INTER_AREA)
    return encode_jpeg(resized, 70)


def overlay_caption(frame, caption: str) -> None:
    """Draws a subtle bottom caption bar with the supplied text in place."""
    height, width = frame.shape[:2]
    bar_h = 28
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, height - bar_h), (width, height), (10, 12, 14), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, dst=frame)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(frame, caption, (10, height - 8), font, 0.55, (220, 230, 240), 1, cv2.LINE_AA)


class YoloDetector:
    """Vehicle-in-frame confirmation via ultralytics YOLOv8n.

    Flag-gated and default OFF: with ``ENABLE_YOLO=false`` every frame is
    accepted (confirmed), so the model is never loaded. When enabled but the
    package is missing, it degrades to accepted and logs once.
    """

    def __init__(self, enable: bool, classes: tuple[str, ...]) -> None:
        self._enable = enable
        self._classes = set(classes) or {"car", "truck", "bus"}
        self._model = None
        self._warned = False

    def confirm(self, frame) -> tuple[bool, list]:
        """Returns (is_vehicle, boxes). Disabled -> (True, [])."""
        if not self._enable:
            return True, []
        if self._model is None:
            self._load()
        if self._model is None:
            return True, []
        results = self._model.predict(frame, verbose=False)
        boxes = []
        for result in results:
            for box in result.boxes:
                cls = int(box.cls[0])
                name = str(result.names.get(cls, ""))
                if name in self._classes:
                    boxes.append([float(c) for c in box.xyxy[0].tolist()])
        return len(boxes) > 0, boxes

    def draw_boxes(self, frame, boxes: list) -> None:
        for x1, y1, x2, y2 in boxes:
            cv2.rectangle(
                frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 120), 2
            )

    def _load(self) -> None:
        try:
            from ultralytics import YOLO  # type: ignore[import-not-found]

            self._model = YOLO("yolov8n.pt")
        except Exception as exc:  # pragma: no cover - depends on optional dep
            if not self._warned:
                logger.warning("YOLO enabled but unavailable (%s); vehicle check disabled", exc)
                self._warned = True