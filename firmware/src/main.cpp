/**
 * Smart Speed Detection — IR gate firmware (Arduino Uno, PlatformIO).
 *
 * Protocol contract: /firmware/README.md (mirrors packages/shared/src/serial.ts).
 * Emitted lines are validated there by the bridge with Zod — one JSON line per
 * vehicle at 115200 baud, debug lines start with '#', nothing else.
 */
#include <Arduino.h>
#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <stdlib.h>
#include <string.h>

/* ---------------- constants (spec: firmware section) ---------------- */
static const uint8_t PIN_A = 2;        // IR sensor A -> INT0
static const uint8_t PIN_B = 3;        // IR sensor B -> INT1
static const uint8_t PIN_BUZZER = 8;
static const uint8_t LCD_ADDR = 0x27;  // try 0x3F if the LCD stays blank (see README)
static const int IR_EDGE = FALLING;    // most IR modules are active-LOW; use RISING if nothing prints
static const float GATE_DISTANCE_M = 0.10f;
static const char *FW_VERSION = "1.0.0";

static const unsigned long DEBOUNCE_US = 2000UL;    // ignore re-triggers < 2 ms
static const unsigned long TIMEOUT_US = 2000000UL;  // lone sensor resets after 2 s
static const unsigned long HB_INTERVAL_MS = 5000UL; // heartbeat every 5 s
static const unsigned long BEEP_MS = 150UL;         // non-blocking beep half-period
static const int BEEP_COUNT = 3;
static const unsigned long MIN_DT_US = 361UL;       // keeps speed_kmh <= 999 (schema max)
static const float MIN_LIMIT_KMH = 0.1f;            // calibrated raw gate-speed threshold
static const float MAX_LIMIT_KMH = 200.0f;

/* ---------------- state ---------------- */
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

volatile unsigned long edgeA = 0, edgeB = 0; // last ACCEPTED edge times (micros)
volatile bool fA = false, fB = false;        // sensor fired, waiting for its partner
volatile bool fwdDir = true;                 // set when the SECOND sensor fires

float limitKmh = 40.0f;
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

static void renderLcd() {
  char speedTxt[12];
  char line[17];
  dtostrf(lastSpeedKmh, 0, 1, speedTxt);
  snprintf(line, sizeof(line), "Speed:%skm/h", speedTxt);
  writeLine(0, line);
  writeLine(1, lastStatus);
}

static void showBootScreen() {
  char title[17];
  snprintf(title, sizeof(title), "SmartSpeed %s", FW_VERSION);
  writeLine(0, title);
  char speedTxt[12];
  char line[17];
  dtostrf(limitKmh, 0, 0, speedTxt);
  snprintf(line, sizeof(line), "GateLim:%s km/h", speedTxt);
  writeLine(1, line);
}

/** After a set_limit command the LCD shows the new limit until the next vehicle. */
static void showLimitChanged() {
  char limitTxt[12];
  char line[17];
  dtostrf(limitKmh, 0, 0, limitTxt);
  snprintf(line, sizeof(line), "GateLim:%s km/h", limitTxt);
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

  seq++; // monotonic per boot: server dedupes on (bootId, seq)
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

/* ---------------- Arduino entry points ---------------- */
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  lcd.init();
  lcd.backlight();

  randomSeed((unsigned long)(micros() ^ ((unsigned long)analogRead(A0) << 10)));
  bootId = ((uint32_t)random(0x10000UL) << 16) | (uint32_t)random(0x10000UL);
  if (bootId == 0) bootId = 1;

  emitHello(); // bridge pushes the server limit when it sees this line

  attachInterrupt(digitalPinToInterrupt(PIN_A), isrA, IR_EDGE);
  attachInterrupt(digitalPinToInterrupt(PIN_B), isrB, IR_EDGE);

  showBootScreen();
  delay(1500); // boot screen only; ISRs are already capturing
  writeLine(0, "Speed:--.-km/h");
  writeLine(1, "Waiting...");

  lastHbMs = millis();
}

void loop() {
  readCommands();
  checkTimeout();
  processDetection();
  updateBuzzer();
  heartbeatDue();
}
