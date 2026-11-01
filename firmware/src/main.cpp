/**
 * Smart Speed Detection — IR gate firmware (Arduino Uno, PlatformIO).
 *
 * Protocol contract: /firmware/README.md (mirrors packages/shared/src/serial.ts).
 * Emitted lines are validated there by the bridge with Zod — one JSON line per
 * vehicle at 115200 baud, debug lines start with '#', nothing else.
 */
#include <Arduino.h>
#include <EEPROM.h>
#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <stdlib.h>
#include <string.h>

/* ---------------- constants (spec: firmware section) ---------------- */
static const uint8_t PIN_A = 2;        // IR sensor A -> INT0
static const uint8_t PIN_B = 3;        // IR sensor B -> INT1
static const uint8_t PIN_BUZZER = 13;  // wired to D13 on this build (onboard LED blinks with it)
static const uint8_t LCD_ADDR = 0x27;  // try 0x3F if the LCD stays blank (see README)
static const int IR_EDGE = FALLING;    // most IR modules are active-LOW; use RISING if nothing prints
static const float GATE_DISTANCE_M = 0.10f;
static const char *FW_VERSION = "1.2.1";

static const unsigned long DEBOUNCE_US = 2000UL;    // ignore re-triggers < 2 ms
static const unsigned long TIMEOUT_US = 2000000UL;  // lone sensor resets after 2 s
static const unsigned long HB_INTERVAL_MS = 5000UL; // heartbeat every 5 s
static const unsigned long BEEP_MS = 150UL;         // non-blocking beep half-period
static const int BEEP_COUNT = 3;
static const unsigned long MIN_DT_US = 361UL;       // keeps speed_kmh <= 999 (schema max)
static const float MIN_LIMIT_KMH = 0.1f;            // calibrated raw gate-speed threshold
static const float MAX_LIMIT_KMH = 200.0f;
static const float MIN_SCALE = 0.01f;               // station scale factor (toy -> real world)
static const float MAX_SCALE = 1000.0f;

/* ---------------- state ---------------- */
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

volatile unsigned long edgeA = 0, edgeB = 0; // last ACCEPTED edge times (micros)
volatile bool fA = false, fB = false;        // sensor fired, waiting for its partner
volatile bool fwdDir = true;                 // set when the SECOND sensor fires

float limitKmh = 40.0f;   // raw gate trip limit (server limit / scale)
float scaleFactor = 1.0f; // pushed with set_limit; LCD shows speed x scale
uint32_t bootId = 0;
unsigned long seq = 0;
unsigned long lastHbMs = 0;

float lastSpeedKmh = 0.0f;
char lastStatus[12] = "Waiting...";

int beepsLeft = 0;
bool buzzerOn = false;
unsigned long buzzerT = 0;

char cmdBuf[96];
uint8_t cmdLen = 0;

/* ---------------- ISRs: store micros() and flags ONLY ---------------- */
void isrA() {
  const unsigned long n = micros();
  if (fA) return; // already captured for this crossing (also absorbs bounce)
  if (n - edgeA < DEBOUNCE_US) return;
  edgeA = n;
  fA = true;
  if (fB) fwdDir = false; // B fired first -> vehicle travelled B->A
}

void isrB() {
  const unsigned long n = micros();
  if (fB) return;
  if (n - edgeB < DEBOUNCE_US) return;
  edgeB = n;
  fB = true;
  if (fA) fwdDir = true; // A fired first -> vehicle travelled A->B
}

/* ---------------- serial output helpers ---------------- */
static void emitHello() {
  Serial.print(F("{\"t\":\"hello\",\"fw\":\""));
  Serial.print(FW_VERSION);
  Serial.print(F("\",\"limit\":"));
  Serial.print(limitKmh, 1);
  Serial.print(F(",\"boot\":"));
  Serial.print(bootId);
  Serial.println('}');
}

static void emitDetection(unsigned long dtUs, float speed, bool over) {
  Serial.print(F("{\"t\":\"detection\",\"dt_us\":"));
  Serial.print(dtUs);
  Serial.print(F(",\"speed_kmh\":"));
  Serial.print(speed, 2);
  Serial.print(F(",\"dir\":\""));
  Serial.print(fwdDir ? "fwd" : "rev");
  Serial.print(F("\",\"over\":"));
  Serial.print(over ? "true" : "false");
  Serial.print(F(",\"limit\":"));
  Serial.print(limitKmh, 1);
  Serial.print(F(",\"seq\":"));
  Serial.print(seq);
  Serial.println('}');
}

static void emitHeartbeat() {
  Serial.print(F("{\"t\":\"hb\",\"seq\":"));
  Serial.print(seq);
  Serial.println('}');
}

static void emitAck(const char *cmd) {
  Serial.print(F("{\"t\":\"ack\",\"cmd\":\""));
  Serial.print(cmd);
  Serial.println(F("\"}"));
}

/* ---------------- LCD ---------------- */
static void writeLine(uint8_t row, const char *text) {
  char buf[17];
  strncpy(buf, text, 16);
  buf[16] = '\0';
  lcd.setCursor(0, row);
  lcd.print(buf);
  for (uint8_t i = (uint8_t)strlen(buf); i < 16; i++) lcd.print(' ');
}

/** Line 2: status on the left, vehicle count on the right, e.g. "OVERSPEED!   #12". */
static void statusLine(const char *status, char *out) {
  char count[8];
  snprintf(count, sizeof(count), "#%lu", seq);
  const int pad = 16 - (int)strlen(count);
  snprintf(out, 17, "%-*.*s%s", pad, pad, status, count);
}

/**
 * Re-run the LCD's init sequence before redrawing. The HD44780 talks in 4-bit
 * nibbles through the I2C backpack; one glitched nibble (loose jumper, noise,
 * a reset in the middle of a write) shifts every later character and the
 * screen fills with garbage until power-cycled. init() forces it back into
 * sync. Costs ~60 ms, only once per vehicle; the ISRs keep timing meanwhile.
 */
static void lcdResync() {
  lcd.init();
  lcd.backlight();
}

/** "48.0km/h (4.8)" = scaled (what the dashboard shows) + raw gate speed. */
static void speedLine(char *out) {
  char rawTxt[12];
  dtostrf(lastSpeedKmh, 0, 1, rawTxt);
  if (scaleFactor == 1.0f) {
    snprintf(out, 17, "Speed:%skm/h", rawTxt);
    return;
  }
  char scaledTxt[12];
  const float scaled = lastSpeedKmh * scaleFactor;
  dtostrf(scaled, 0, scaled < 100.0f ? 1 : 0, scaledTxt);
  snprintf(out, 17, "%skm/h (%s)", scaledTxt, rawTxt);
}

/** "Limit:40km/h x10" = the real-world limit the server uses + scale factor. */
static void limitLine(char *out) {
  char limitTxt[12];
  dtostrf(limitKmh * scaleFactor, 0, 0, limitTxt);
  if (scaleFactor == 1.0f) {
    snprintf(out, 17, "Limit:%s km/h", limitTxt);
    return;
  }
  char scaleTxt[12];
  dtostrf(scaleFactor, 0, scaleFactor == (float)(long)scaleFactor ? 0 : 1, scaleTxt);
  snprintf(out, 17, "Limit:%skm/h x%s", limitTxt, scaleTxt);
}

static void renderLcd() {
  char line[17];
  lcdResync();
  speedLine(line);
  writeLine(0, line);
  statusLine(lastStatus, line);
  writeLine(1, line);
}

/** Known characters at boot: compare with the LCD to spot a bad data line. */
static void showTestPattern() {
  writeLine(0, "0123456789ABCDEF");
  writeLine(1, "abcdefghij:./#!?");
}

static void showBootScreen() {
  char line[17];
  snprintf(line, sizeof(line), "SmartSpeed %s", FW_VERSION);
  writeLine(0, line);
  limitLine(line);
  writeLine(1, line);
}

/** After a set_limit command the LCD shows the new limit until the next vehicle. */
static void showLimitChanged() {
  char line[17];
  limitLine(line);
  writeLine(1, line);
}

/* ---------------- buzzer (non-blocking) ---------------- */
static void startBeeps(int n) {
  beepsLeft = n;
  buzzerOn = false;
  buzzerT = millis() - BEEP_MS; // first edge fires on the next updateBuzzer()
}

static void updateBuzzer() {
  if (beepsLeft <= 0 && !buzzerOn) return;
  const unsigned long now = millis();
  if (now - buzzerT < BEEP_MS) return;
  buzzerT = now;
  if (buzzerOn) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerOn = false;
  } else if (beepsLeft > 0) {
    digitalWrite(PIN_BUZZER, HIGH);
    buzzerOn = true;
    beepsLeft--;
  }
}

/* ---------------- incoming commands (bridge -> device) ---------------- */
static void handleCommand() {
  cmdBuf[cmdLen] = '\0';
  if (strstr(cmdBuf, "\"set_limit\"") != NULL) {
    const char *p = strstr(cmdBuf, "\"kmh\":");
    const float v = (p != NULL) ? (float)atof(p + 6) : -1.0f;
    if (v >= MIN_LIMIT_KMH && v <= MAX_LIMIT_KMH) {
      limitKmh = v;
      const char *ps = strstr(cmdBuf, "\"scale\":"); // optional
      if (ps != NULL) {
        const float sc = (float)atof(ps + 8);
        if (sc >= MIN_SCALE && sc <= MAX_SCALE) scaleFactor = sc;
      }
      emitAck("set_limit");
      showLimitChanged();
    } else {
      Serial.println(F("# rejected set_limit (kmh must be 0.1..200)"));
    }
    return;
  }
  if (strstr(cmdBuf, "\"buzzer_test\"") != NULL) {
    emitAck("buzzer_test");
    startBeeps(BEEP_COUNT);
    return;
  }
  if (strstr(cmdBuf, "\"ping\"") != NULL) {
    emitAck("ping");
    return;
  }
  Serial.println(F("# unknown command"));
}

static void readCommands() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen > 0) handleCommand();
      cmdLen = 0;
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    } else {
      cmdLen = 0; // overlong line: drop it, stay aligned
    }
  }
}

/* ---------------- detection pipeline ---------------- */
static void checkTimeout() {
  noInterrupts();
  const bool onlyOne = fA != fB;
  const unsigned long last = fA ? edgeA : edgeB;
  interrupts();
  if (onlyOne && (micros() - last > TIMEOUT_US)) {
    noInterrupts();
    fA = false;
    fB = false;
    interrupts();
  }
}

static void processDetection() {
  unsigned long a = 0, b = 0;
  bool ready = false;
  noInterrupts();
  if (fA && fB) {
    a = edgeA;
    b = edgeB;
    fA = false;
    fB = false;
    ready = true;
  }
  interrupts();
  if (!ready) return;

  // wrap-safe |a-b|: micros() wraps every ~71.6 min
  const unsigned long d1 = a - b;
  const unsigned long d2 = b - a;
  const unsigned long dtUs = (d1 < d2) ? d1 : d2;

  if (dtUs < MIN_DT_US) {
    Serial.println(F("# dt out of range, ignored"));
    return;
  }

  // speed_kmh = (0.1 m / dt_us * 1e-6 s) * 3600 = 360000 / dt_us
  const float speed = (GATE_DISTANCE_M * 1000000.0f * 3.6f) / (float)dtUs;
  const bool over = speed > limitKmh;

  seq++; // monotonic per boot: server dedupes on (bootId, seq); also the LCD vehicle count
  emitDetection(dtUs, speed, over);

  lastSpeedKmh = speed;
  strncpy(lastStatus, over ? "OVERSPEED!" : "OK", sizeof(lastStatus));
  renderLcd();
  if (over) startBeeps(BEEP_COUNT);
}

static void heartbeatDue() {
  const unsigned long now = millis();
  if (now - lastHbMs < HB_INTERVAL_MS) return;
  lastHbMs = now;
  emitHeartbeat();
}

/**
 * Unique id per power-on/reset. The server dedupes detections on
 * (bootId, seq) and seq restarts at 0 every boot, so a repeated bootId would
 * make the new boot's vehicles look like duplicates and be dropped.
 * micros()/floating-pin noise alone repeated across resets, so a boot counter
 * kept in EEPROM (incremented every boot) guarantees a fresh id; the noise is
 * still mixed in so a re-flashed board (EEPROM may be kept) differs too.
 */
static const int EEPROM_BOOT_COUNTER_ADDR = 0;

static uint32_t nextBootId() {
  uint32_t counter = 0;
  EEPROM.get(EEPROM_BOOT_COUNTER_ADDR, counter);
  counter++;
  EEPROM.put(EEPROM_BOOT_COUNTER_ADDR, counter); // ~1 write per boot; EEPROM lasts 100k cycles

  uint32_t noise = micros();
  for (uint8_t i = 0; i < 8; i++) noise = (noise << 3) ^ (uint32_t)analogRead(A0) ^ micros();
  randomSeed(noise ^ counter);

  // Knuth multiplicative hash spreads consecutive counters; xor in randomness
  uint32_t id = (counter * 2654435761UL) ^ (((uint32_t)random(0x10000UL) << 16) | (uint32_t)random(0x10000UL));
  return id == 0 ? 1 : id;
}

/* ---------------- Arduino entry points ---------------- */
void setup() {
  Serial.begin(115200);
  pinMode(PIN_A, INPUT_PULLUP); // matches the original sketch; IR OUT is active-LOW
  pinMode(PIN_B, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  lcd.init();
  lcd.backlight();

  bootId = nextBootId();

  emitHello(); // bridge pushes the server limit when it sees this line

  attachInterrupt(digitalPinToInterrupt(PIN_A), isrA, IR_EDGE);
  attachInterrupt(digitalPinToInterrupt(PIN_B), isrB, IR_EDGE);

  showTestPattern();
  delay(2000); // boot-only delays; ISRs are already capturing
  showBootScreen();
  delay(1500);
  lcdResync();
  writeLine(0, "Speed:--.-km/h");
  char line[17];
  statusLine("Waiting...", line);
  writeLine(1, line);

  lastHbMs = millis();
}

void loop() {
  readCommands();
  checkTimeout();
  processDetection();
  updateBuzzer();
  heartbeatDue();
}
