# Vision Service (`/apps/vision`)

Frame capture for the Smart Speed Detection system. Streams a phone camera,
keeps a ring buffer of the last ~3 s of frames, and when the server reports an
**overspeed** detection it picks the best frame of the passing vehicle and
uploads it (JPEG + thumbnail) to the server.

Two camera sources (`CAMERA_SOURCE` in `.env`):

| Source               | Value     | How it works                                                                                                                                                 |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android phone (used) | `android` | `app/android.py` runs the scrcpy server on the phone in camera mode over ADB/USB, reads the raw H.264 stream through `adb forward` and decodes it with PyAV. |
| iPhone               | _(empty)_ | macOS Continuity Camera via AVFoundation, locked to the iPhone in `LIVE_CAMERA_UNIQUE_ID` / `LIVE_CAMERA_MODEL_ID`. Never falls back to FaceTime/other cams. |

If the camera is unavailable the service reports `camera_waiting` and retries
with exponential backoff (1 s → 30 s, one log line per attempt).

### Android setup

1. `brew install scrcpy` (also installs `adb`).
2. On the phone: Developer options → **USB debugging** on; plug in and accept the prompt. `adb devices` must list it.
3. **Close the phone's Camera app** — Android gives the camera to one client at a time.
4. Mount the phone ~30–40 cm from where the car crosses, out of the car's path (the IR sensors point outward, so the car passes in front of them).
5. Optional tuning in `.env`: `ANDROID_CAMERA_FPS=60` (less blur), `ANDROID_TORCH=true` (flashlight), `ANDROID_ROTATE`, `ANDROID_CAMERA_ZOOM`.

### Which frame is saved (`CAPTURE_MODE=motion`, default)

The IR timestamp and camera timestamps never line up exactly, so `/capture`
waits `MOTION_AFTER_MS`, builds an "empty scene" (median of earlier frames),
finds every frame within `[event − MOTION_BEFORE_MS, event + MOTION_AFTER_MS]`
where something moved, and keeps the **sharpest** one (Laplacian variance in
the motion box). A red `VEHICLE` box is drawn around the moving object.
`CAPTURE_MODE=closest` uses the frame nearest `eventTs − CAPTURE_OFFSET_MS`.

## Setup

```bash
python3.12 -m venv apps/vision/.venv     # or: uv venv -p 3.12 apps/vision/.venv
apps/vision/.venv/bin/pip install -r apps/vision/requirements.txt
apps/vision/.venv/bin/python -m app.camera_test --discover   # from apps/vision
```

## Run

```bash
pnpm dev:vision          # or: .venv/bin/python -m uvicorn --factory app.main:create_app --port 8001 --app-dir apps/vision
```

Copy `apps/vision/.env.example` → `.env` and set `VISION_SHARED_SECRET` to the
server's value.

## Endpoints

| Route           | Auth              | Purpose                                                                                                                                                                                                                                                          |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /capture` | `x-vision-secret` | `{detectionId, eventTs, offsetMs}` → pick closest ring frame, caption overlay, upload frame + thumb to the server; returns `{status: ok\|failed}`. A failure never loses the detection — the server's watchdog marks the frame `failed` and the UI offers retry. |
| `GET /health`   | public            | camera state (`ok`/`waiting`/`offline`), ring depth, counters                                                                                                                                                                                                    |
| `GET /live`     | `?token=`         | MJPEG preview stream for the dashboard (`LIVE_STREAM_TOKEN`)                                                                                                                                                                                                     |

The server calls `/capture` fire-and-forget for every ingested detection
(`triggerCapture`), using the same `x-vision-secret`.

## Ring buffer & capture semantics

- A background thread reads the camera continuously into a bound ring
  (capacity = `RING_SECONDS × RING_FPS`), storing raw BGR frames with monotonic +
  wall-clock timestamps. JPEG encoding is lazy — only a `/capture` encodes.
- In `closest` mode `/capture` selects the frame closest to `eventTs − offsetMs` (ms), refuses
  frames outside `FRAME_TOLERANCE_MS` (default 400 ms) as `failed`, adds a
  subtle bottom caption (time + offset), encodes quality-85 JPEG + width-320
  thumbnail and POSTs both as multipart to
  `POST /api/ingest/detections/:id/frame`.

## Optional YOLOv8n

`ENABLE_YOLO=true` lazily loads `ultralytics/yolov8n.pt` to confirm a vehicle
class (default `car,truck,bus`) is in the frame and draws a bounding box. Off
by default — every frame is accepted and no model is loaded.

## Session summary

On exit the last log line is:
`framesProcessed=N framesCaptured=N uploads ok=N failed=N queueDrops=N cameraFlips=N`.

## Tests

```bash
cd apps/vision && .venv/bin/pytest -q
```

Uses a fake camera source and mocked server uploads — no phone required.
