# Firmware — IR Gate Speed Detector (Arduino Uno)

Arduino C++ (PlatformIO, Arduino framework) for the 10 cm IR gate: two IR
sensors, a buzzer and a 16×2 LCD. The firmware speaks the NDJSON serial
protocol that is defined once as Zod schemas in
[`packages/shared/src/serial.ts`](../packages/shared/src/serial.ts) and
enforced by the physical serial bridge. **This README is the human-readable
copy of that contract — change both together.**

## Wiring

```
        Arduino Uno                     IR sensor A (near side)
      ┌──────────────┐                    ┌──────────┐
      │          D2  ├───────────────────►│ OUT      │  VCC ──► 5V
      │          D3  ├───────┬───────────►│ OUT      │  GND ──► GND
      │          D8  │       │            └──────────┘
      │              │       │            IR sensor B (far side)
      │          5V  ├──┬────┴──┬───────  VCC/GND (same rail)
      │          GND ├──┘       │        ┌──────────┐
      │              │          └───────►│ OUT      │
      │     A4 (SDA) ├───────────────────┤ VCC/GND  │
      │     A5 (SCL) ├──────────────────  └──────────┘
      │              │                         ▲
      └──────┬───────┘                         │ shared 5V / GND rail
             │ USB (serial 115200)             │
             ▼                            ┌────┴─────┐
           Mac host                      │  IR A : D2 (INT0)
           (bridge)                      │  IR B : D3 (INT1)
                                         │  Buzzer (+) : D8  (− : GND)
                                         │  LCD I2C : SDA/SCL (A4/A5)
                                         └──────────┘
```

- IR modules are active-LOW: `IR_EDGE = FALLING` in `src/main.cpp`.
  If no detections ever print, flip it to `RISING` (some clones are active-HIGH).
- LCD address is `0x27`. If the backlight is on but the text is blank, try
  `0x3F` and turn the contrast pot on the LCD backpack.
- The buzzer needs its (+) on D8 and (−) on GND; it is driven non-blocking
  (3 × 150 ms beeps, `millis()`-based, never `delay()` in the loop).

## Build & flash

```bash
cd firmware
pio run                 # compile
pio run -t upload       # flash over USB
pio device monitor      # 115200 baud — you should see the hello line first
```

> **Apple Silicon note:** PlatformIO's stock AVR toolchain is x86_64-only. Either
> install Rosetta (`softwareupdate --install-rosetta --agree-to-license`) and use the
> commands above as-is, or install a native toolchain (`brew install osx-cross/avr/avr-gcc`,
> after `brew trust osx-cross/avr`) and override it locally with
> `platform_packages = toolchain-atmelavr @ symlink:///opt/homebrew/...` in a throwaway
> config (`pio run -c check-compile.ini`). The sketch compiles warning-free under
> `-Wall -Wextra` (RAM 38%, Flash 44% of an Uno).

## Protocol (NDJSON @ 115200 baud)

One JSON object per line, `\n`-terminated. The ONLY other allowed output is
debug lines starting with `#` (the bridge ignores them). Anything else on the
serial line is counted as malformed by the bridge.

### Device → bridge

| Line        | When               | Fields                                                                                            |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `hello`     | once at boot       | `fw` string ≤32, `limit` 0..200, `boot` random uint32                                             |
| `detection` | one per vehicle    | `dt_us` int >0, `speed_kmh` 0..999, `dir` `fwd`\|`rev`, `over` bool, `limit` 0..200, `seq` int ≥0 |
| `hb`        | every 5 s          | `seq` — last emitted detection seq                                                                |
| `ack`       | reply to a command | `cmd` — the command name                                                                          |

```json
{"t":"hello","fw":"1.0.0","limit":40.0,"boot":305419896}
{"t":"detection","dt_us":8500,"speed_kmh":42.35,"dir":"fwd","over":true,"limit":40.0,"seq":17}
{"t":"hb","seq":17}
{"t":"ack","cmd":"set_limit"}
```

- `boot` is a random uint32 generated at MCU reset; `seq` restarts at 0 each
  boot, so `(bootId, seq)` is the idempotency key the server dedupes on
  (unique index `{deviceId, bootId, seq}`).
- `dir`: `fwd` = sensor A fired before sensor B (vehicle crossed A → B),
  `rev` = B fired before A.
- `over` is the device-local decision (raw gate speed vs the pushed limit) —
  the buzzer follows it; the SERVER independently recomputes overspeed from
  the scaled speed against the configured limit.

### Bridge → device

| Command                       | Effect                                                                    | Ack                               |
| ----------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| `{"cmd":"set_limit","kmh":6}` | sets the calibrated raw gate trip threshold (0.1..200 km/h), LCD shows it | `{"t":"ack","cmd":"set_limit"}`   |
| `{"cmd":"buzzer_test"}`       | 3 beeps                                                                   | `{"t":"ack","cmd":"buzzer_test"}` |
| `{"cmd":"ping"}`              | none                                                                      | `{"t":"ack","cmd":"ping"}`        |

Out-of-range or unknown commands print `# ...` debug and get **no ack**.
The bridge pushes `server speed limit / scale factor` on every (re)connect
(after `hello`) and whenever either value changes in the UI. This keeps the
Arduino buzzer threshold aligned with the server's scaled-speed decision.

### Bridge → server (after adding `receivedAt`)

```json
{
  "seq": 17,
  "bootId": "305419896",
  "dtMicros": 8500,
  "measuredSpeedKmh": 42.35,
  "deviceOver": true,
  "direction": "fwd",
  "deviceLimitKmh": 40.0,
  "receivedAt": "2026-10-07T11:38:46.378Z",
  "source": "arduino"
}
```

`receivedAt` is the Mac clock (the Arduino has no RTC); the server stores it
as `detectedAt` in UTC. The bridge accepts only physical Arduino serial lines.

## Timing rules

| Rule                | Value                      | Why                                                           |
| ------------------- | -------------------------- | ------------------------------------------------------------- |
| Gate distance       | `GATE_DISTANCE_M = 0.10` m | speed = `360000 / dt_us` km/h                                 |
| Debounce            | 2 ms                       | absorbs IR module output bounce                               |
| Lone-sensor timeout | 2 s                        | clears a half-crossing (also caps min speed at 0.18 km/h)     |
| `dt_us` minimum     | 361 µs                     | keeps `speed_kmh ≤ 999` (schema max) — EMI spikes are dropped |
| Heartbeat           | 5 s                        | server watchdog marks the bridge offline after 15 s           |
| `micros()` wrap     | ~71.6 min                  | `dt` uses wrap-safe unsigned distance                         |

ISRs only store `micros()` and set `volatile` flags — no serial, no LCD, no
`delay()` inside an interrupt. All printing, LCD and buzzer work happens in
`loop()`.

## Troubleshooting

- **Nothing prints**: check `IR_EDGE` polarity; open the monitor and break the
  beam by hand — you should get `{"t":"detection",...}` lines.
- **Detection then nothing**: lone-sensor timeouts print nothing (by design);
  check both sensors see the beam at the same height.
- **LCD blank**: `0x27` → `0x3F`, then the contrast pot.
- **Wrong direction**: swap the two sensor wires (or their pins) — `fwd` is
  defined as A-then-B.
- **Limit changes are ignored**: the ack line `{"t":"ack","cmd":"set_limit"}`
  confirms it; if it is missing, the command never reached the board (bridge
  log shows `serial not connected`).
