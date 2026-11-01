# MASTER PROMPT: Smart Speed Detection System (build from scratch, end-to-end)

---

# 0. ROLE AND OPERATING MODE

You are a principal full-stack + embedded engineer. Build the complete project described below from an empty directory to a working, demo-ready system. Every detail in this spec matters.

Operating rules:
1. Work in PHASES (section 14). After each phase: list files created, give exact commands to run/test, run the tests yourself, show results, fix failures, then make ONE git commit (conventional commits). Then continue to the next phase without waiting, unless something truly blocks you.
2. Start by printing the final folder tree and your assumptions. Ask me only about things that truly block you (e.g. the iPhone model, the serial port name). Otherwise decide sensibly and document the decision in the README.
3. Never fake the pipeline. Runtime detections must come only from physical Arduino sensor lines over USB serial. Seed scripts may create accounts and configuration, but never detection history or vehicle measurements.
4. Strict TypeScript, no `any`. Small typed functions. Shared types/schemas live in one shared package.
5. No log spam anywhere. Every retry loop uses exponential backoff and logs ONE concise line per attempt.
6. Never commit secrets. Provide `.env.example` for every app.
7. Finish with the Definition of Done checklist (section 15), verified item by item.

---

# 1. PROJECT SUMMARY

"Smart Speed Detection" is an IoT system. Two IR sensors measure vehicle speed. An on-device buzzer alerts on overspeed. Every detection streams to a web dashboard in REAL TIME, with analytics, a live map, and a camera snapshot of every detected vehicle. There are three user roles: admin, authority, user.

## 1.1 Hardware (already built; do not change the wiring concept)
- Arduino Uno, breadboard, jumper wires
- 2x IR obstacle sensors (A and B), placed exactly 10 cm apart along the travel path
- Buzzer in the centre of the breadboard (overspeed alert)
- 16x2 I2C LCD (shows speed and status)
- Arduino connected to the Mac over USB serial
- Camera: ONLY an iPhone, via Continuity Camera (or an iPhone IP-camera stream URL as a configured alternative)

## 1.2 The three core problems this build must solve
1. REAL-TIME DATA TRANSFER: Arduino data must reach the dashboard in real time. The LCD cannot be read by software, so the Arduino must emit data over USB serial, and a bridge forwards it to the backend, which pushes it to the browser over WebSockets (no polling).
2. LIVE SCAN ONLY VIA THE iPHONE CAMERA: A previous attempt failed with
   `camera not found: camera 'iPhone Camera' is not attached. Cameras currently visible to macOS: [0] FaceTime HD Camera`
   and then repeated that error hundreds of times in a tight loop and exited with 0 frames processed. Lessons that MUST be built in:
   - Match the camera by case-insensitive substring "iphone" (the real name looks like "Pranav's iPhone Camera", never exactly "iPhone Camera").
   - NEVER fall back to the FaceTime/built-in camera or any other device. If the iPhone is unavailable, wait and report status `camera_waiting`.
   - Retries use exponential backoff, one log line per attempt.
3. LIVE MAP + FRAME PER VEHICLE: Show detection locations on a live map and capture and store a camera frame for EVERY detected vehicle, linked to its detection record.

## 1.3 Physics
- Gate distance d = 0.10 m. Measure dt in microseconds with `micros()`.
- `speed_kmh = 360000 / dt_us` (0.1 m / (dt_us x 1e-6 s) x 3.6).
- Direction: A then B = "fwd", B then A = "rev".
- Because the gate is only 10 cm, test "vehicles" are toy/model cars or a hand. Provide a `scaleFactor` setting (default 1) so the dashboard shows both "measured speed" and "scaled (real-world equivalent) speed". The overspeed decision on the SERVER uses the scaled speed against the configured limit. The Arduino buzzer uses its own limit (pushed from the server settings; see section 4).

---

# 2. TECH STACK (use exactly this)

Monorepo with pnpm workspaces:

| Path | Stack |
|---|---|
| `/firmware` | Arduino C++ via PlatformIO (Arduino framework), LiquidCrystal_I2C |
| `/packages/shared` | TypeScript + Zod schemas and types shared by server, bridge, web |
| `/apps/server` | Node 20, TypeScript, Express, Socket.IO, Mongoose, Zod, JWT (access token + refresh token in httpOnly cookie), bcrypt, helmet, cors, express-rate-limit, pino, multer, pdfkit, csv-stringify, node-cron, swagger-ui (OpenAPI generated from Zod) |
| `/apps/bridge` | Node 20, TypeScript, `serialport` + `@serialport/parser-readline`, axios or socket.io-client |
| `/apps/vision` | Python 3.11, OpenCV, pyobjc-framework-AVFoundation, FastAPI + uvicorn, httpx, numpy. Optional, flag-gated and default OFF: ultralytics YOLOv8n to confirm a vehicle is in the frame and draw a bounding box |
| `/apps/web` | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui (Radix), Framer Motion, TanStack Query, TanStack Table (virtualized), Zustand, React Router, react-hook-form + Zod, Socket.IO client, Apache ECharts (echarts-for-react), React-Leaflet (+ leaflet.markercluster, leaflet.heat) with dark map tiles, sonner, lucide-react, date-fns |
| Database | MongoDB 7 via Docker. Mongoose models with proper indexes (2dsphere, compound, unique, TTL where relevant) |
| Infra | `docker-compose.yml` (mongo, optional mongo-express, server, web), root scripts: `dev`, physical `dev:bridge`, `seed`, `test`, `lint` |
| Quality | ESLint + Prettier, Vitest (server + web), Pytest (vision), one Playwright e2e smoke test |

---

# 3. ARCHITECTURE AND DATA FLOW

```
IR A / IR B -> Arduino (interrupts, micros) --JSON lines over USB serial @115200--> BRIDGE (Node)
BRIDGE --POST /api/ingest/detections (x-device-key)--> SERVER (Express + MongoDB)
SERVER: validate -> dedupe -> compute scaled speed/overspeed/severity -> save Detection
        -> emit Socket.IO "detection:new" (and "alert:overspeed" when applicable)
SERVER --POST http://localhost:8001/capture {detectionId, eventTs, offsetMs}--> VISION (FastAPI)
VISION: pick closest frame from the iPhone ring buffer -> JPEG + thumbnail
        -> POST /api/ingest/detections/:id/frame (multipart)
SERVER: store in GridFS, set detection.frame, emit "detection:frame"
WEB: single Socket.IO connection updates KPIs, charts, table, ticker, map live (no polling).
BRIDGE + VISION send heartbeats -> SERVER emits "system:status" -> UI health indicators.
SERVER -> BRIDGE commands (set_limit, buzzer_test) -> serial -> Arduino
```

Two-way serial: the admin changes the speed limit in the UI; the server stores it in MongoDB settings and the bridge writes `{"cmd":"set_limit","kmh":40}` to the Arduino, both on change and on every (re)connect.

The detection time is the BRIDGE's receive time (`receivedAt`, Mac clock) because the Arduino has no real-time clock. The server stores it as `detectedAt` in UTC.

---

# 4. FIRMWARE (`/firmware`)

Wiring: IR A to pin 2 (INT0), IR B to pin 3 (INT1), buzzer to pin 8, LCD on SDA/SCL (A4/A5), shared VCC/GND. Include an ASCII wiring diagram in `/firmware/README.md`.

Requirements:
- ISRs only store `micros()` and set volatile flags (no Serial, no LCD, no delay inside ISRs).
- Edge is a named constant (`IR_EDGE = FALLING`; most IR modules are active-LOW; note to switch to RISING if nothing prints).
- Debounce: ignore re-triggers < 2 ms. Timeout: if only one sensor fires, reset after 2 s.
- Direction reported (`fwd`/`rev`).
- Buzzer: non-blocking pattern (3 beeps) using `millis()`.
- LCD address 0x27 as a constant (note 0x3F fallback and the contrast pot). Boot screen shows the limit. Line 1: `Speed:42.3km/h`; line 2: `OK` / `OVERSPEED!` / `Waiting...`.
- Serial 115200. Emit ONE JSON line per vehicle. Nothing else on the serial output except debug lines that start with `#`.
- Protocol (newline-delimited JSON):
  - Boot: `{"t":"hello","fw":"1.0.0","limit":40.0,"boot":<random uint32>}` (a random boot id so `seq` can restart safely)
  - Detection: `{"t":"detection","dt_us":8500,"speed_kmh":42.35,"dir":"fwd","over":true,"limit":40.0,"seq":17}`
  - Heartbeat every 5 s: `{"t":"hb","seq":17}`
  - Commands in: `{"cmd":"set_limit","kmh":40}`, `{"cmd":"buzzer_test"}`, `{"cmd":"ping"}`; replies: `{"t":"ack","cmd":"..."}`
- `seq` is monotonically increasing so the server can detect drops.

Reference sketch to start from (improve it, do not simply copy it blindly):

```cpp
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

const uint8_t  PIN_A = 2, PIN_B = 3, PIN_BUZZER = 8;
const uint8_t  LCD_ADDR = 0x27;
const float    DISTANCE_M = 0.10;
const unsigned long DEBOUNCE_US = 2000UL;
const unsigned long TIMEOUT_US  = 2000000UL;
const int      IR_EDGE = FALLING;
const char*    FW_VERSION = "1.0.0";

LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
volatile unsigned long tA = 0, tB = 0;
volatile bool fA = false, fB = false;
float limitKmh = 40.0;
unsigned long seq = 0, lastHb = 0;
int beepsLeft = 0; bool buzzerOn = false; unsigned long buzzerT = 0;

void isrA() { unsigned long n = micros(); if (!fA && (n - tA) > DEBOUNCE_US) { tA = n; fA = true; } }
void isrB() { unsigned long n = micros(); if (!fB && (n - tB) > DEBOUNCE_US) { tB = n; fB = true; } }

void startBeeps(int n) { beepsLeft = n; buzzerOn = false; buzzerT = 0; }
void updateBuzzer() {
  if (beepsLeft <= 0 && !buzzerOn) return;
  unsigned long now = millis();
  if (now - buzzerT < 150) return;
  buzzerT = now;
  if (buzzerOn) { digitalWrite(PIN_BUZZER, LOW); buzzerOn = false; }
  else if (beepsLeft > 0) { digitalWrite(PIN_BUZZER, HIGH); buzzerOn = true; beepsLeft--; }
}
void showLcd(float speed, const char* status) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Speed:"); lcd.print(speed, 1); lcd.print("km/h");
  lcd.setCursor(0, 1); lcd.print(status);
}
// loop(): updateBuzzer(); read commands; copy ISR data inside noInterrupts()/interrupts();
// when both flags set -> dt = |tA - tB|, speed = (DISTANCE_M / (dt/1e6)) * 3.6, direction by order,
// print JSON line, update LCD, beep if over limit, clear flags; on single-sensor timeout clear flags;
// send heartbeat every 5 s.
```

---

# 5. DATABASE (MongoDB / Mongoose)

- `users`: name, email (unique), passwordHash, role (`admin`|`authority`|`user`), isActive, lastLoginAt, createdAt.
- `devices` (stations): name, apiKeyHash, location (GeoJSON Point `[lng, lat]`), address, scaleFactor, speedLimitKmh, status, lastSeenAt, bridgeOnline, cameraStatus (`ok`|`waiting`|`offline`), firmwareVersion. Index: 2dsphere on location.
- `detections`: deviceId, bootId, seq, source `arduino` only, vehicleUid (uuid), measuredSpeedKmh, scaledSpeedKmh, limitKmh, server overspeed, `deviceOver` (Arduino buzzer decision), severity (`low`|`medium`|`high`, by percent over limit), direction, dtMicros, detectedAt (UTC), location (copied from device), frame {fileId, thumbFileId, capturedAt, status: `pending`|`ready`|`failed`|`skipped`}, plate (optional), review {status: `pending`|`confirmed`|`dismissed`, by, at, note}, fine {amount, status} (optional).
  Indexes: `{detectedAt:-1}`, `{deviceId:1, detectedAt:-1}`, `{overspeed:1, detectedAt:-1}`, 2dsphere on location, unique `{deviceId, bootId, seq}` (idempotent ingestion).
- `vehicles`: ownerUserId, plate (unique), nickname.
- `settings` (singleton): defaultLimitKmh, scaleFactor, captureOffsetMs (default 200), retentionDays, alertSound.
- `auditLogs`: actorId, action, entity, entityId, meta, at (optional TTL).
- Frames: JPEG + thumbnail stored in GridFS bucket `frames`.
- Seed script: accounts, one gate and default settings only. Do not create readings, vehicles or mock history. Print credentials and the device API key ONCE.

---

# 6. BACKEND API (`/apps/server`)

Every request/response is validated with Zod. Error format: `{error:{code,message,details}}`. Pagination: cursor or page/limit. OpenAPI docs at `/api/docs`.

Auth: `POST /api/auth/register` (creates role `user` only), `/login`, `/refresh`, `/logout`, `GET /api/auth/me`. RBAC middleware `requireRole(...)`.

Roles:
- Admin: CRUD users, CRUD devices (rotate API key, shown once), PATCH settings, view audit logs, send device commands (set limit, buzzer test).
- Authority: list/filter/search all detections, review (confirm/dismiss/note), tag plate, set fine, export CSV/PDF, analytics for all devices.
- User: register own vehicles, see only detections matching own plates, personal alerts, public aggregate stats (never other people's plates).

Ingest (header `x-device-key`, rate-limited):
- `POST /api/ingest/detections` creates the detection (dedupe on deviceId+bootId+seq), returns the id, triggers the vision capture.
- `POST /api/ingest/detections/:id/frame` (multipart) stores frame + thumbnail (check file type and size).
- `POST /api/ingest/heartbeat` `{source:"bridge"|"vision", status, meta}`.

Read APIs:
- `GET /api/detections` (filters: date range, device, overspeed, severity, review status, speed range, plate, text; sort; pagination), `GET /api/detections/:id`, `GET /api/frames/:fileId` (auth-checked streaming).
- `GET /api/analytics/summary` (today/7d/30d: total, overspeed count, avg and max speed, violation rate, trend vs previous period)
- `GET /api/analytics/timeseries` (bucketed by minute/hour/day with `$dateTrunc`)
- `GET /api/analytics/hourly-heatmap` (day-of-week x hour)
- `GET /api/analytics/speed-distribution` (histogram)
- `GET /api/analytics/by-device`, `/top-violations`
- `GET /api/map/detections` (GeoJSON, bbox + time filter), `GET /api/map/heat`
- `GET /api/export/detections.csv` and `.pdf`

Socket.IO (JWT-authenticated handshake, rooms per role): events `detection:new`, `detection:frame`, `detection:updated`, `system:status`, `alert:overspeed`. A node-cron watchdog marks bridge/camera "offline" when no heartbeat arrives for 15 s.

Security: helmet, CORS allow-list, input validation everywhere, hashed API keys, never log secrets.

---

# 7. BRIDGE (`/apps/bridge`)

- Auto-detect the Arduino by listing serial ports (`/dev/cu.usbmodem*`, `/dev/cu.usbserial*`, or Arduino vendor IDs); allow `SERIAL_PORT` env override.
- Parse each line as JSON, validate with Zod, ignore `#` debug lines, count malformed lines.
- Add `receivedAt` (Mac clock) to each detection.
- POST to the server with retry and a queue (memory + disk) so no detection is lost if the server is briefly down; preserve order; dedupe by (bootId, seq).
- Reconnect with exponential backoff (1 s up to 30 s) on unplug, one concise log line per attempt.
- Heartbeat every 5 s: `{serialConnected, port, lastSeq, queueDepth, malformedCount}`.
- Receive server commands and write them to serial. Push the current limit to the Arduino on connect.
- Accept detections only from the physical Arduino serial port. Do not generate, inject or persist synthetic sensor readings.

---

# 8. VISION SERVICE (`/apps/vision`)

- Camera discovery via AVFoundation: select ONLY devices whose `localizedName` contains "iphone" (case-insensitive). Map the AVFoundation device to the correct OpenCV index and verify the mapping (indexes can differ). Never select any other camera. Remove any "choose whichever camera is attached" behaviour.
- `python -m app.camera_test --discover` lists every camera and highlights the iPhone, or prints "iPhone not found" plus a checklist: unlock the iPhone, same Apple ID, Wi-Fi and Bluetooth on, Continuity Camera enabled (Settings > General > AirPlay & Handoff), iOS 16+/macOS 13+, phone mounted still in landscape.
- Optional IP-camera mode (`CAMERA_SOURCE=url`, an MJPEG/RTSP URL from an iPhone camera app). Still iPhone only.
- Retry with exponential backoff (1 s up to 30 s), one log line per attempt, clean Ctrl+C, heartbeat with `cameraStatus` = `ok` | `waiting` | `offline`.
- Capture thread keeps a ring buffer of the last ~3 s of frames with monotonic + wall-clock timestamps (bounded memory, lazy JPEG encoding).
- FastAPI endpoints:
  - `POST /capture {detectionId, eventTs, offsetMs}`: choose the frame closest to `eventTs - offsetMs`, encode JPEG (quality 85) + thumbnail, optional subtle caption overlay (speed, time, device), upload to the server, return status.
  - `GET /health`
  - `GET /live`: MJPEG preview stream for the dashboard (short-lived token auth).
- A capture failure must NEVER lose the detection: mark `frame.status = "failed"`; the UI shows a placeholder and a retry button.
- Session summary on exit: framesProcessed, framesCaptured, uploads ok/failed, queue drops.
- Pytest with a fake camera source.

---

# 9. FRONTEND (`/apps/web`): must look exceptional

Design language: dark "mission control / traffic ops" theme with a light-mode toggle. Glassmorphism cards with subtle borders and glow, neon cyan/emerald for OK, amber for warnings, red for overspeed. Inter + JetBrains Mono (numbers). Smooth Framer Motion page transitions, count-up numbers, skeleton loaders, empty states, fully responsive (desktop/tablet/phone), keyboard accessible, WCAG-AA contrast.

Pages:
1. **Login / Register**: animated background, role-aware redirect.
2. **Dashboard (live)**: KPI cards with sparkline + trend (total today, overspeed today, average speed, max speed, violation rate); animated radial SPEED GAUGE that sweeps to the latest speed and turns red and pulses above the limit; live detection ticker (slide-in cards with the vehicle snapshot thumbnail); charts: speed over time (live line), violations by hour (bar), hourly heatmap (day x hour), speed distribution histogram, severity donut; system health strip (Arduino/bridge, iPhone camera, server, DB) with live status dots.
3. **Detections**: virtualized table, column filters, date-range picker, search, severity badges, sort, bulk actions (authority); row click opens a side drawer with large frame image (zoom), speed details, map mini-view, review workflow, plate tagging, timeline, audit trail; export CSV/PDF.
4. **Live Map**: React-Leaflet with dark tiles, device markers (status-coloured), clustered detection markers with popups (thumbnail, speed, time, status), heatmap toggle, time-range slider, live "ping" animation on new detections, fit-to-bounds, geolocation button; admin can drag a device marker to set its coordinates.
5. **Live Camera**: MJPEG preview from the vision service plus an overlay with the latest detection and capture status.
6. **Analytics**: date-range explorer, period comparison, per-device breakdown, top violations, downloadable report.
7. **Devices (admin)**: add/edit stations, rotate API key (show once), set limit and scale factor, "buzzer test" button, firmware/heartbeat info.
8. **Users (admin)**: list/create/edit roles, activate/deactivate.
9. **Settings (admin)**: default limit, scale factor, capture offset, retention, alert sound.
10. **My Vehicles (user)**: add plates, see matched detections and alerts.
11. **Audit log (admin)**.

Real-time behaviour: ONE Socket.IO connection held in a Zustand store. New detections update the table, KPIs, charts, ticker, and map within ~1 s. Overspeed triggers a toast, optional alert sound, and a red flash on the gauge. A persistent banner shows connection state (connected / reconnecting / Arduino disconnected / camera waiting). Optimistic UI for review actions. Roles are enforced in routing and UI, and again on the server.

---

# 10. NON-FUNCTIONAL REQUIREMENTS

- End-to-end latency from IR crossing to dashboard under 1 s (the frame may arrive up to 2 s later and then updates the row live).
- Idempotent ingestion (deviceId + bootId + seq).
- All times stored in UTC, rendered in the user's locale.
- `docker compose up` brings up Mongo + server + web. Bridge and vision run on the host (they need USB and camera access).
- README with a mermaid architecture diagram, setup, wiring, run order (mongo, server, bridge, vision, web), troubleshooting (iPhone not detected, serial port busy, no frames, LCD blank), and a demo script.

---

# 11. SERIAL PROTOCOL CONTRACT (single source of truth)

Define these as Zod schemas in `/packages/shared` and reuse them in the physical serial bridge, and document them in `/firmware/README.md`:
- Device to bridge: `hello`, `detection`, `hb`, `ack`
- Bridge to device: `set_limit`, `buzzer_test`, `ping`
- Bridge to server: detection payload `{bootId, seq, dtMicros, measuredSpeedKmh, deviceOver, direction, deviceLimitKmh, receivedAt, source}`

---

# 12. TESTING

- Server: Vitest for auth, RBAC, ingest idempotency, analytics aggregations, socket events (use mongodb-memory-server).
- Bridge: Vitest for physical line parsing, malformed handling, queue/dedupe, backoff.
- Vision: Pytest with a fake camera: ring-buffer selection of the closest frame, backoff behaviour, iPhone-only filter (feed a device list containing only FaceTime and assert it refuses).
- Web: Vitest for key components/stores; one Playwright smoke test (login, physical Arduino detection appears live, open drawer).

---

# 13. LIVE RUN SCRIPT (requires physical hardware)

1. Start Mongo, server and web; connect the Arduino over USB and start the physical bridge and configured camera service.
2. Log in as admin; the dashboard initially shows no readings until the gate measures a crossing.
3. Arduino sensor detections arrive live; an overspeed one flashes the gauge, toasts, appears on the map and requests a camera frame.
4. Within-limit detections are stored without requesting or displaying a camera frame.
5. Change the speed limit as admin; confirm the bridge pushes it (visible in bridge logs).
6. Log in as authority and confirm a detection; log in as user and verify restricted visibility.

---

# 14. BUILD PLAN (one commit per phase)

- Phase 1: Monorepo scaffold, tooling, Docker Compose + Mongo, env files, shared package (Zod schemas and protocol contract).
- Phase 2: Server core: models, auth, RBAC, settings, devices, seed script. Tests.
- Phase 3: Ingest, detections, analytics, export APIs, Socket.IO. Tests using validated Arduino protocol fixtures.
- Phase 4: Physical serial bridge, durable queue and reconnect. Prove the real-time flow into MongoDB.
- Phase 5: Firmware (full sketch) + physical serial protocol doc.
- Phase 6: Vision service: iPhone-only discovery, backoff, ring buffer, `/capture`, frame upload. Pytest with a fake camera.
- Phase 7: Frontend foundation: design system, layout, auth, routing, socket store, theming.
- Phase 8: Dashboard, gauge, charts, live ticker, health strip.
- Phase 9: Detections table, drawer, review workflow, exports.
- Phase 10: Live map, heatmap, camera page.
- Phase 11: Admin pages (devices, users, settings, audit) and My Vehicles.
- Phase 12: Polish (animations, loading/empty/error states, responsiveness, accessibility), Playwright smoke test, README runbook, final end-to-end run with physical hardware.

---

# 15. DEFINITION OF DONE (verify and report each item)

- [ ] Camera: iPhone-only; refuses FaceTime/any other device; reports `camera_waiting` with backoff and no log flood
- [ ] Real-time: physical sensor detection appears in the UI within about 1 s of the IR crossing, with no polling
- [ ] Overspeed detections get a frame (or a clear "failed" state with retry); within-limit detections do not trigger capture
- [ ] Live map with device markers, clustered detections, heatmap, live ping
- [ ] Three roles enforced in both UI and API
- [ ] MongoDB persistence with the specified indexes; idempotent ingestion
- [ ] Firmware: interrupts + micros, buzzer, LCD, JSON serial protocol, commands
- [ ] Admin can change the limit from the UI and the Arduino receives it
- [ ] Only real sensor-origin detections are accepted and displayed
- [ ] Tests pass; lint passes; README complete

Begin now: print the folder tree and assumptions, then execute Phase 1.