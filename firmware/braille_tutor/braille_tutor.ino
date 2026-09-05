// =====================================================================
//  BRAILLE TUTOR FIRMWARE  v1.0.0
//  Arduino Uno + 6x SG90 servos + 6x pushbuttons + LED + buzzer
//  Structured JSON line protocol over Serial @ 9600 baud.
//  Fully non-blocking: millis()-based debounce, tone queue and LED
//  timing. No delay() and no blocking release-wait loops.
//
//  Dot layout:    1 4
//                 2 5
//                 3 6
//
//  Servo pins:    dot1=A3  dot2=A4  dot3=A5  dot4=A2  dot5=A1  dot6=A0
//  Button pins:   dot1=2   dot2=3   dot3=4   dot4=5   dot5=6   dot6=7
//  LED: pin 8     Buzzer: pin 9
// =====================================================================

#include <Servo.h>

Servo servo[6];

// ---------------------------------------------------------------
// PINS (unchanged from the validated prototype)
// ---------------------------------------------------------------

const uint8_t SERVO_PINS[6]  = { A3, A4, A5, A2, A1, A0 };
const uint8_t BUTTON_PINS[6] = { 2, 3, 4, 5, 6, 7 };
const uint8_t LED_PIN        = 8;
const uint8_t BUZZER_PIN     = 9;

// ---------------------------------------------------------------
// SERVO ANGLES (exact hardware calibration - do not change)
//   dots 1,2,3 : LOW = 0    HIGH = 50
//   dot  4     : LOW = 70   HIGH = 20
//   dots 5,6   : LOW = 80   HIGH = 30
// ---------------------------------------------------------------

const int HIGH_ANGLE[6] = { 50, 50, 50, 20, 30, 30 };
const int LOW_ANGLE[6]  = {  0,  0,  0, 70, 80, 80 };

// ---------------------------------------------------------------
// TIMING
// ---------------------------------------------------------------

const unsigned long DEBOUNCE_MS = 25;

// ---------------------------------------------------------------
// NON-BLOCKING TONE QUEUE
// ---------------------------------------------------------------

struct Note {
	uint16_t freq; // 0 = silence
	uint16_t ms;
};

const uint8_t TONE_QUEUE_MAX = 8;
Note toneQueue[TONE_QUEUE_MAX];
uint8_t toneHead   = 0;
uint8_t toneLen    = 0;
bool    toneActive = false;
unsigned long toneStartMs = 0;

const Note MELODY_OK[]      = { { 1000, 60 } };
const Note MELODY_CORRECT[] = { { 1000, 120 }, { 1500, 120 }, { 2000, 200 } };
const Note MELODY_WRONG[]   = { { 400, 250 }, { 0, 100 }, { 400, 250 } };

// ---------------------------------------------------------------
// NON-BLOCKING LED
// ---------------------------------------------------------------

unsigned long ledOffAtMs = 0;

// ---------------------------------------------------------------
// LEARNING SESSION STATE
// ---------------------------------------------------------------

char          targetChar     = 'A';
char          targetLabel[8] = "A";
uint8_t       targetMask     = 0x01; // bit i => dot (i+1) is required
uint8_t       progressMask   = 0;
uint8_t       attempts       = 0;    // total button presses this target
uint8_t       misses         = 0;    // wrong-dot presses this target
unsigned long targetStartMs  = 0;
bool          sessionActive  = false;
bool          quietFeedback  = false; // TEST mode: no click on correct dots
char          fwMode         = 'P';   // 'P' = practice, 'T' = test

// ---------------------------------------------------------------
// BRAILLE ALPHABET (index 0 = 'A'), dot order 1..6
// Layout: 1 4 / 2 5 / 3 6
// ---------------------------------------------------------------

const uint8_t BRAILLE_A_Z[26] = {
	0b000001, // A  dots 1
	0b000011, // B  dots 1,2
	0b001001, // C  dots 1,4
	0b011001, // D  dots 1,4,5
	0b010001, // E  dots 1,5
	0b001011, // F  dots 1,2,4
	0b011011, // G  dots 1,2,4,5
	0b010011, // H  dots 1,2,5
	0b001010, // I  dots 2,4
	0b011010, // J  dots 2,4,5
	0b000101, // K  dots 1,3
	0b000111, // L  dots 1,2,3
	0b001101, // M  dots 1,3,4
	0b011101, // N  dots 1,3,4,5
	0b010101, // O  dots 1,3,5
	0b001111, // P  dots 1,2,3,4
	0b011111, // Q  dots 1,2,3,4,5
	0b010111, // R  dots 1,2,3,5
	0b001110, // S  dots 2,3,4
	0b011110, // T  dots 2,3,4,5
	0b100101, // U  dots 1,3,6
	0b100111, // V  dots 1,2,3,6
	0b111010, // W  dots 2,4,5,6
	0b101101, // X  dots 1,3,4,6
	0b111101, // Y  dots 1,3,4,5,6
	0b110101  // Z  dots 1,3,5,6
};

// ---------------------------------------------------------------
// LOW-LEVEL OUTPUT
// ---------------------------------------------------------------

uint8_t popcount8(uint8_t v) {
	uint8_t c = 0;
	while (v) { c += (v & 1); v >>= 1; }
	return c;
}

// ---------------------------------------------------------------
// SERVO MOVER (staggered, non-blocking)
//
// Six servos jerking at once can spike the Uno 5V rail and brown-out
// reset the MCU (the "dots drop + READY repeats" symptom). We instead
// move at most ONE servo every MOVE_STEP_MS so the current draw stays
// low and smooth.
// ---------------------------------------------------------------

const uint16_t MOVE_STEP_MS = 150;

uint8_t        moveTarget     = 0; // desired raised-dot mask
uint8_t        currentMask    = 0; // mask actually applied so far
uint8_t        moveIndex      = 0;
bool           moveInProgress = false;
unsigned long  moveLastMs     = 0;

void applyMask(uint8_t mask) {
	moveTarget     = mask;
	moveIndex      = 0;
	moveInProgress = true;
	moveLastMs     = millis();
}

void moveServoStep() {
	unsigned long now = millis();
	if ((long)(now - moveLastMs) < MOVE_STEP_MS) return;

	while (moveIndex < 6) {
		uint8_t i = moveIndex++;
		bool want = moveTarget & (1 << i);
		bool have = currentMask & (1 << i);
		if (want != have) {
			servo[i].write(want ? HIGH_ANGLE[i] : LOW_ANGLE[i]);
			if (want) {
				currentMask |= (1 << i);
			} else {
				currentMask &= ~(1 << i);
			}
			moveLastMs = now;
			return; // one servo change per tick
		}
	}
	moveInProgress = false;
}

void enqueueNotes(const Note* notes, uint8_t count) {
	for (uint8_t i = 0; i < count; i++) {
		if (toneLen >= TONE_QUEUE_MAX) break;
		toneQueue[(toneHead + toneLen) % TONE_QUEUE_MAX] = notes[i];
		toneLen++;
	}
}

void ledFlash(uint16_t ms) {
	digitalWrite(LED_PIN, HIGH);
	ledOffAtMs = millis() + ms;
}

// ---------------------------------------------------------------
// JSON OUTPUT HELPERS
// ---------------------------------------------------------------

void sendReady() {
	Serial.print(F("{\"event\":\"READY\",\"fw\":\"1.0.0\",\"board\":\"uno\",\"mode\":\""));
	Serial.print(fwMode == 'T' ? F("TEST") : F("PRACTICE"));
	Serial.println(F("\"}"));
}

void sendTarget(bool shown) {
	Serial.print(F("{\"event\":\"TARGET\",\"char\":\""));
	Serial.print(targetLabel);
	Serial.print(F("\",\"mask\":"));
	Serial.print(targetMask);
	Serial.print(F(",\"shown\":"));
	Serial.print(shown ? F("true") : F("false"));
	Serial.println(F("}"));
}

void sendButton(uint8_t dotIdx) {
	Serial.print(F("{\"event\":\"BUTTON\",\"dot\":"));
	Serial.print(dotIdx + 1);
	Serial.println(F(",\"state\":\"down\"}"));
}

void sendDotOk(uint8_t dotIdx) {
	Serial.print(F("{\"event\":\"DOT_OK\",\"dot\":"));
	Serial.print(dotIdx + 1);
	Serial.print(F(",\"progress\":"));
	Serial.print(popcount8(progressMask));
	Serial.print(F(",\"total\":"));
	Serial.print(popcount8(targetMask));
	Serial.println(F("}"));
}

void sendResultCorrect() {
	Serial.print(F("{\"event\":\"RESULT\",\"outcome\":\"CORRECT\",\"char\":\""));
	Serial.print(targetLabel);
	Serial.print(F("\",\"attempts\":"));
	Serial.print(attempts);
	Serial.print(F(",\"misses\":"));
	Serial.print(misses);
	Serial.print(F(",\"time_ms\":"));
	Serial.print(millis() - targetStartMs);
	Serial.println(F("}"));
}

void sendResultWrong(uint8_t dotIdx) {
	Serial.print(F("{\"event\":\"RESULT\",\"outcome\":\"WRONG_DOT\",\"char\":\""));
	Serial.print(targetLabel);
	Serial.print(F("\",\"dot\":"));
	Serial.print(dotIdx + 1);
	Serial.print(F(",\"attempts\":"));
	Serial.print(attempts);
	Serial.print(F(",\"misses\":"));
	Serial.print(misses);
	Serial.println(F("}"));
}

// ---------------------------------------------------------------
// SESSION / FEEDBACK LOGIC
// ---------------------------------------------------------------

void beginTarget(const char* label, uint8_t mask, bool show) {
	strncpy(targetLabel, label, sizeof(targetLabel) - 1);
	targetLabel[sizeof(targetLabel) - 1] = '\\0';
	targetChar    = label[0];
	targetMask    = mask;
	progressMask  = 0;
	attempts      = 0;
	misses        = 0;
	targetStartMs = millis();
	sessionActive = true;
	applyMask(show ? targetMask : 0);
	sendTarget(show);
}

void handlePress(uint8_t dotIdx) {
	sendButton(dotIdx);

	if (!sessionActive || dotIdx > 5) return;

	bool needed = targetMask & (1 << dotIdx);
	attempts++;

	// ---- WRONG DOT PRESSED ----
	if (!needed) {
		misses++;
		progressMask = 0; // pattern must be restarted, like the prototype
		enqueueNotes(MELODY_WRONG, sizeof(MELODY_WRONG) / sizeof(Note));
		ledFlash(600);
		sendResultWrong(dotIdx);
		return;
	}

	// ---- CORRECT DOT PRESSED ----
	progressMask |= (1 << dotIdx);

	if (!quietFeedback) {
		enqueueNotes(MELODY_OK, sizeof(MELODY_OK) / sizeof(Note));
	}
	sendDotOk(dotIdx);

	// ---- ALL REQUIRED DOTS PRESSED ----
	if (progressMask == targetMask) {
		sessionActive = false;
		enqueueNotes(MELODY_CORRECT, sizeof(MELODY_CORRECT) / sizeof(Note));
		sendResultCorrect();
	}
}

// ---------------------------------------------------------------
// BUTTON DEBOUNCING (non-blocking, per-button state machine)
// ---------------------------------------------------------------

struct BtnState {
	bool lastReading = HIGH;
	bool stableState = HIGH;
	unsigned long lastChangeMs = 0;
	bool lockout = false; // set after a handled press until release
};

BtnState buttons[6];

void pollButtons() {
	for (uint8_t i = 0; i < 6; i++) {
		bool reading = digitalRead(BUTTON_PINS[i]);

		if (reading != buttons[i].lastReading) {
			buttons[i].lastChangeMs = millis();
			buttons[i].lastReading  = reading;
		}

		if ((millis() - buttons[i].lastChangeMs) > DEBOUNCE_MS &&
			reading != buttons[i].stableState) {

			buttons[i].stableState = reading;

			if (reading == LOW && !buttons[i].lockout) {
				buttons[i].lockout = true;
				handlePress(i);
			} else if (reading == HIGH) {
				buttons[i].lockout = false;
			}
		}
	}
}

// ---------------------------------------------------------------
// SERIAL LINE BUFFER
// ---------------------------------------------------------------

const uint8_t LINE_BUF_SIZE = 160;
char    lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;

// ---------------------------------------------------------------
// MINIMAL JSON HELPERS (protocol-specific, no external library)
// ---------------------------------------------------------------

const char* jsonValueStart(const char* json, const char* key) {
	char pat[24];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char* p = strstr(json, pat);
	if (!p) return NULL;
	p += strlen(pat);
	while (*p == ' ' || *p == ':') p++;
	return p;
}

bool jsonGetInt(const char* json, const char* key, long* out) {
	const char* p = jsonValueStart(json, key);
	if (!p) return false;
	*out = strtol(p, NULL, 10);
	return true;
}

bool jsonGetBool(const char* json, const char* key, bool* out) {
	const char* p = jsonValueStart(json, key);
	if (!p) return false;
	*out = (strncmp(p, "true", 4) == 0) || (*p == '1');
	return true;
}

bool jsonGetString(const char* json, const char* key, char* out, size_t maxLen) {
	const char* p = jsonValueStart(json, key);
	if (!p || *p != '"') return false;
	p++;
	size_t i = 0;
	while (*p && *p != '"' && i < maxLen - 1) {
		out[i++] = *p++;
	}
	out[i] = '\0';
	return true;
}

// Parses "seq": [[freq,ms],[freq,ms],...]
int jsonGetSeq(const char* json, const char* key, Note* out, int maxNotes) {
	const char* p = jsonValueStart(json, key);
	if (!p || *p != '[') return 0;
	p++; // consume the outer '['
	int count = 0;
	while (*p && count < maxNotes) {
		while (*p == ' ' || *p == ',') p++;
		if (*p == '\0' || *p == ']') break; // end of sequence
		if (*p != '[') {                    // malformed; skip a character
			p++;
			continue;
		}
		p++;                                // consume the pair's '['
		long f = strtol(p, (char**)&p, 10);
		while (*p == ' ' || *p == ',') p++;
		long m = strtol(p, (char**)&p, 10);
		while (*p && *p != ']') p++;        // skip to the pair's ']'
		if (*p == ']') p++;                 // consume it so the outer loop continues
		if (f > 0 && m > 0) {
			out[count].freq = (uint16_t)f;
			out[count].ms   = (uint16_t)m;
			count++;
		}
	}
	return count;
}

// ---------------------------------------------------------------
// COMMAND DISPATCH
// ---------------------------------------------------------------

void handleLine(char* line) {
	while (*line == ' ' || *line == '\t') line++;
	if (*line != '{') return; // ignore non-JSON noise (e.g. boot garbage)

	char cmd[16];
	if (!jsonGetString(line, "cmd", cmd, sizeof(cmd))) return;

	// {"cmd":"SET_DOTS","dots":[1,3,6],"label":"and","show":true}
	if (strcmp(cmd, "SET_DOTS") == 0) {
		const char* p = jsonValueStart(line, "dots");
		if (!p) return;
		uint8_t mask = 0;
		// NOTE: strtol() does not advance the pointer when there is no digit,
		// so we must skip non-digit characters (e.g. '[' and ',') ourselves
		// or this loop would hang forever on the opening bracket.
		while (*p && *p != ']') {
			if (*p >= '0' && *p <= '9') {
				long d = strtol(p, (char**)&p, 10);
				if (d >= 1 && d <= 6) mask |= (1 << (d - 1));
			} else {
				p++;
			}
		}
		char label[8];
		if (!jsonGetString(line, "label", label, sizeof(label))) {
			label[0] = '?';
			label[1] = '\0';
		}
		bool show = true;
		jsonGetBool(line, "show", &show);
		beginTarget(label, mask, show);
	}

	// {"cmd":"SET_TARGET","char":"B","show":true}
	else if (strcmp(cmd, "SET_TARGET") == 0) {
		char ch[4];
		if (!jsonGetString(line, "char", ch, sizeof(ch))) return;
		char up = (char)toupper(ch[0]);
		if (up < 'A' || up > 'Z') return;
		char label[2] = { up, '\0' };
		bool show = true;
		jsonGetBool(line, "show", &show);
		beginTarget(label, BRAILLE_A_Z[up - 'A'], show);
	}

	// {"cmd":"SHOW_ANSWER"}
	else if (strcmp(cmd, "SHOW_ANSWER") == 0) {
		applyMask(targetMask);
	}

	// {"cmd":"CLEAR"}
	else if (strcmp(cmd, "CLEAR") == 0) {
		applyMask(0);
	}

	// {"cmd":"TONE","seq":[[1000,120],[1500,120]]} or {"cmd":"TONE","freq":1000,"ms":120}
	else if (strcmp(cmd, "TONE") == 0) {
		Note seq[6];
		int n = jsonGetSeq(line, "seq", seq, 6);
		if (n > 0) {
			enqueueNotes(seq, (uint8_t)n);
		} else {
			long f = 1000, m = 120;
			jsonGetInt(line, "freq", &f);
			jsonGetInt(line, "ms", &m);
			Note one = { (uint16_t)((f > 0) ? f : 1000), (uint16_t)((m > 0) ? m : 120) };
			enqueueNotes(&one, 1);
		}
	}

	// {"cmd":"LED","state":true,"ms":600}
	else if (strcmp(cmd, "LED") == 0) {
		bool on = true;
		long ms = 0;
		jsonGetBool(line, "state", &on);
		jsonGetInt(line, "ms", &ms);
		if (on) {
			if (ms > 0) {
				ledFlash((uint16_t)ms);
			} else {
				digitalWrite(LED_PIN, HIGH);
				ledOffAtMs = 0;
			}
		} else {
			digitalWrite(LED_PIN, LOW);
			ledOffAtMs = 0;
		}
	}

	// {"cmd":"MODE","mode":"PRACTICE"} | {"cmd":"MODE","mode":"TEST"}
	else if (strcmp(cmd, "MODE") == 0) {
		char mode[12];
		if (!jsonGetString(line, "mode", mode, sizeof(mode))) return;
		if (strcmp(mode, "TEST") == 0) {
			fwMode = 'T';
			quietFeedback = true;
		} else {
			fwMode = 'P';
			quietFeedback = false;
		}
		Serial.print(F("{\"event\":\"MODE\",\"mode\":\""));
		Serial.print(fwMode == 'T' ? F("TEST") : F("PRACTICE"));
		Serial.println(F("\"}"));
	}

	// {"cmd":"SIM_PRESS","dot":3}  (virtual presses from the UI / keyboard)
	else if (strcmp(cmd, "SIM_PRESS") == 0) {
		long dot = 0;
		if (jsonGetInt(line, "dot", &dot) && dot >= 1 && dot <= 6) {
			handlePress((uint8_t)(dot - 1));
		}
	}

	// {"cmd":"RESET"}  restart the current target's counters
	else if (strcmp(cmd, "RESET") == 0) {
		progressMask  = 0;
		attempts      = 0;
		misses        = 0;
		targetStartMs = millis();
		sessionActive = true;
		Serial.println(F("{\"event\":\"RESET\"}"));
	}

	// {"cmd":"ID"}
	else if (strcmp(cmd, "ID") == 0) {
		sendReady();
	}
}

// ---------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------

void setup() {
	// Attach servos one at a time with a short gap. Six SG90s jerking to
	// their low position simultaneously can spike the Uno 5V rail (mostly
	// when powered from USB) and brown-out/reset the MCU — visible as the
	// dots "dropping" and the serial repeating READY lines. Staggering the
	// attach spreads the inrush. (For permanent reliability power the
	// servos from an external 5V ≥3A supply with common ground.)
	for (uint8_t i = 0; i < 6; i++) {
		servo[i].attach(SERVO_PINS[i]);
		servo[i].write(LOW_ANGLE[i]);
		delay(80);
	}

	for (uint8_t i = 0; i < 6; i++) {
		pinMode(BUTTON_PINS[i], INPUT_PULLUP);
	}

	pinMode(LED_PIN, OUTPUT);
	pinMode(BUZZER_PIN, OUTPUT);
	digitalWrite(LED_PIN, LOW);
	noTone(BUZZER_PIN);

	Serial.begin(9600);

	// The host opening the serial port auto-resets the Uno. Wait for the
	// USB-CDC connection to settle so the READY line is never clipped, and
	// drain any garbage bytes received during the reset window.
	delay(250);
	while (Serial.available() > 0) {
		Serial.read();
	}

	sendReady();
}

// ---------------------------------------------------------------
// LOOP (fully non-blocking)
// ---------------------------------------------------------------

void loop() {
	unsigned long now = millis();

	pollButtons();
	moveServoStep();

	// --- tone queue timing ---
	if (toneActive && (now - toneStartMs) >= toneQueue[toneHead].ms) {
		noTone(BUZZER_PIN);
		toneHead   = (toneHead + 1) % TONE_QUEUE_MAX;
		toneLen--;
		toneActive = false;
	}
	if (!toneActive && toneLen > 0) {
		Note n = toneQueue[toneHead];
		if (n.freq > 0) {
			tone(BUZZER_PIN, n.freq);
		}
		toneStartMs = now;
		toneActive  = true;
	}

	// --- LED auto-off ---
	if (ledOffAtMs != 0 && (long)(now - ledOffAtMs) >= 0) {
		digitalWrite(LED_PIN, LOW);
		ledOffAtMs = 0;
	}

	// --- serial line assembly ---
	while (Serial.available() > 0) {
		char c = (char)Serial.read();
		if (c == '\n') {
			lineBuf[lineLen] = '\0';
			handleLine(lineBuf);
			lineLen = 0;
		} else if (c != '\r' && lineLen < sizeof(lineBuf) - 1) {
			lineBuf[lineLen++] = c;
		}
	}
}
