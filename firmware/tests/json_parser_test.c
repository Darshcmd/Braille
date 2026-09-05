// Verbatim copies of the firmware's JSON parser, tested natively
// against the exact commands the web app sends.
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <assert.h>

typedef struct Note { uint16_t freq; uint16_t ms; } Note;

// ---- verbatim from braille_tutor.ino ----
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
	while (*p && *p != '"' && i < maxLen - 1) { out[i++] = *p++; }
	out[i] = '\0';
	return true;
}

int jsonGetSeq(const char* json, const char* key, Note* out, int maxNotes) {
	const char* p = jsonValueStart(json, key);
	if (!p || *p != '[') return 0;
	p++;
	int count = 0;
	while (*p && count < maxNotes) {
		while (*p == ' ' || *p == ',') p++;
		if (*p == '\0' || *p == ']') break;
		if (*p != '[') { p++; continue; }
		p++;
		long f = strtol(p, (char**)&p, 10);
		while (*p == ' ' || *p == ',') p++;
		long m = strtol(p, (char**)&p, 10);
		while (*p && *p != ']') p++;
		if (*p == ']') p++;
		if (f > 0 && m > 0) {
			out[count].freq = (uint16_t)f;
			out[count].ms   = (uint16_t)m;
			count++;
		}
	}
	return count;
}

// Replica of the fixed SET_DOTS dots-mask parsing in handleLine()
uint8_t parseDotsMask(const char* line) {
	const char* p = jsonValueStart(line, "dots");
	if (!p) return 0;
	uint8_t mask = 0;
	while (*p && *p != ']') {
		if (*p >= '0' && *p <= '9') {
			long d = strtol(p, (char**)&p, 10);
			if (d >= 1 && d <= 6) mask |= (1 << (d - 1));
		} else {
			p++;
		}
	}
	return mask;
}

static int failures = 0;
static void check(const char* name, int got, int want) {
	if (got == want) {
		printf("PASS  %-46s = %d\n", name, got);
	} else {
		printf("FAIL  %-46s = %d (want %d)\n", name, got, want);
		failures++;
	}
}

int main(void) {
	// The exact command the app sends on connect — this hung the board before.
	check("dots [1,3] (label K)", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[1,3],\"label\":\"K\",\"show\":true}"), 0b000101);
	check("dots [1,2] (label B)", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[1,2],\"label\":\"B\",\"show\":true}"), 0b000011);
	check("dots [2,4,6] (label I)", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[2,4,6],\"label\":\"I\",\"show\":false}"), 0b101010);
	check("dots [1,2,3,4,5,6] (label for)", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[1,2,3,4,5,6],\"label\":\"for\",\"show\":true}"), 0b111111);
	check("dots [3,4] (label st)", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[3,4],\"label\":\"st\",\"show\":true}"), 0b001100);
	check("dots [] empty", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"dots\":[],\"label\":\"?\",\"show\":true}"), 0);
	check("dots missing key", parseDotsMask(
		"{\"cmd\":\"SET_DOTS\",\"label\":\"x\",\"show\":true}"), 0);

	char label[8]; char ch[4]; bool b; long n;
	assert(jsonGetString("{\"cmd\":\"SET_DOTS\",\"dots\":[1,3],\"label\":\"and\",\"show\":true}", "label", label, 8));
	check("label extraction 'and'", strcmp(label, "and") == 0, 1);
	assert(jsonGetString("{\"cmd\":\"SET_TARGET\",\"char\":\"B\",\"show\":false}", "char", ch, 4));
	check("char extraction 'B'", ch[0] == 'B', 1);
	assert(jsonGetBool("{\"cmd\":\"SET_DOTS\",\"dots\":[1],\"label\":\"A\",\"show\":false}", "show", &b));
	check("show=false", b == false, 1);
	assert(jsonGetBool("{\"cmd\":\"SET_DOTS\",\"dots\":[1],\"label\":\"A\",\"show\":true}", "show", &b));
	check("show=true", b == true, 1);
	assert(jsonGetInt("{\"cmd\":\"SIM_PRESS\",\"dot\":6}", "dot", &n));
	check("SIM_PRESS dot=6", n == 6, 1);

	Note seq[6];
	check("TONE seq 2 notes", jsonGetSeq(
		"{\"cmd\":\"TONE\",\"seq\":[[1000,120],[1500,120]]}", "seq", seq, 6), 2);
	check("  seq[0]", seq[0].freq == 1000 && seq[0].ms == 120, 1);
	check("  seq[1]", seq[1].freq == 1500 && seq[1].ms == 120, 1);
	check("TONE seq 3 notes", jsonGetSeq(
		"{\"cmd\":\"TONE\",\"seq\":[[1000,120],[1500,120],[2000,200]]}", "seq", seq, 6), 3);
	check("TONE seq single-note malformed", jsonGetSeq(
		"{\"cmd\":\"TONE\",\"seq\":[1000]}", "seq", seq, 6), 0);
	check("TONE seq missing", jsonGetSeq(
		"{\"cmd\":\"TONE\",\"freq\":1000,\"ms\":120}", "seq", seq, 6), 0);

	printf("\n%s (%d failures)\n", failures == 0 ? "ALL TESTS PASSED" : "TESTS FAILED", failures);
	return failures == 0 ? 0 : 1;
}
