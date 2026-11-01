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

# ---------------------------------------------------------------------------
# Motion-based frame selection
# ---------------------------------------------------------------------------
# The bridge timestamp (second IR sensor) and the camera's frame timestamps
# never line up exactly (USB/decoder latency, slow toy cars), so instead of
# trusting "closest frame to eventTs - offset" we look at every frame around
# the event and keep the one that differs most from the empty scene.

_MOTION_WIDTH = 160  # analyse a small grey copy: fast and noise-tolerant


def _small_grey(frame):
    height, width = frame.shape[:2]
    scale = _MOTION_WIDTH / width
    small = cv2.resize(frame, (_MOTION_WIDTH, max(1, int(height * scale))), interpolation=cv2.INTER_AREA)
    grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(grey, (5, 5), 0)


def background_of(frames: list) -> object | None:
    """Median of a few frames: anything that only passed through briefly disappears."""
    if not frames:
        return None
    import numpy as np

    greys = [_small_grey(f) for f in frames]
    return np.median(np.stack(greys), axis=0).astype("uint8")


def _motion_mask(frame, background):
    grey = _small_grey(frame)
    if grey.shape != background.shape:
        return None
    diff = cv2.absdiff(grey, background)
    _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))


def _bbox_from_mask(mask, frame_shape):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
    height, width = frame_shape[:2]
    scale = width / _MOTION_WIDTH
    pad = 6
    return (
        max(0, int((x - pad) * scale)),
        max(0, int((y - pad) * scale)),
        min(width - 1, int((x + w + pad) * scale)),
        min(height - 1, int((y + h + pad) * scale)),
    )


def sharpness(frame, bbox) -> float:
    """Variance of the Laplacian inside bbox: higher = crisper edges, less motion blur."""
    x1, y1, x2, y2 = bbox
    crop = frame[y1 : y2 + 1, x1 : x2 + 1]
    if crop.size == 0:
        return 0.0
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


def pick_motion_frame(
    candidates: list,
    background,
    min_fraction: float = 0.003,
    presence_ratio: float = 0.5,
):
    """Return (index, bbox | None, changed_fraction) of the best vehicle frame.

    *candidates* are BGR frames, *background* comes from ``background_of``.
    Every frame where the moving object covers at least *presence_ratio* of
    the largest change seen (i.e. the vehicle is substantially in view) is a
    contender; of those, the SHARPEST one inside its motion box wins — the
    frame with the most change is usually the closest and most blurred.
    bbox is (x1, y1, x2, y2) in full-frame pixels around the biggest moving
    blob. Returns (None, None, best_fraction) when nothing moved more than
    *min_fraction* of the picture (caller falls back to time-based choice).
    """
    if background is None or not candidates:
        return None, None, 0.0
    scored = []
    for i, frame in enumerate(candidates):
        mask = _motion_mask(frame, background)
        if mask is None:
            continue
        scored.append((i, float(cv2.countNonZero(mask)) / mask.size, mask))
    best_score = max((sc for _, sc, _ in scored), default=0.0)
    if best_score < min_fraction:
        return None, None, best_score

    threshold = max(min_fraction, best_score * presence_ratio)
    chosen = None  # (sharpness, index, bbox, score)
    for i, score, mask in scored:
        if score < threshold:
            continue
        bbox = _bbox_from_mask(mask, candidates[i].shape)
        if bbox is None:
            continue
        sharp = sharpness(candidates[i], bbox)
        if chosen is None or sharp > chosen[0]:
            chosen = (sharp, i, bbox, score)
    if chosen is None:
        return None, None, best_score
    _, index, bbox, score = chosen
    return index, bbox, score


def draw_motion_box(frame, bbox) -> None:
    x1, y1, x2, y2 = bbox
    cv2.rectangle(frame, (x1, y1), (x2, y2), (60, 60, 255), 3)
    cv2.putText(frame, "VEHICLE", (x1, max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 255), 2, cv2.LINE_AA)
