#!/usr/bin/env bash
# =============================================================
# Braille Tutor - direct hardware test (bypasses the browser)
#
# Usage:  bash tools/hwtest.sh [port]
#         port defaults to the first /dev/cu.usb* device.
#
# Sends ID / SET_TARGET / SET_DOTS / CLEAR and prints every
# response from the board. Servos WILL physically move.
# =============================================================
set -u

PORT="${1:-}"
if [ -z "$PORT" ]; then
	PORT=$(ls /dev/cu.usb* 2>/dev/null | head -1)
fi

if [ -z "$PORT" ] || [ ! -e "$PORT" ]; then
	echo "ERROR: no USB serial device found - is the Arduino plugged in?"
	echo "Devices present right now:"
	ls /dev/cu.* 2>/dev/null || echo "  (none)"
	exit 1
fi

echo "Testing $PORT  (servos will move!)"

if ! stty -f "$PORT" 9600 raw -echo 2>/dev/null; then
	HOLDER=$(lsof "$PORT" 2>/dev/null | tail -n +2 | awk '{print $1, $2}' | head -1)
	echo "ERROR: $PORT is busy (held by: ${HOLDER:-unknown process})."
	echo "Close the Arduino Serial Monitor / disconnect the web app, then retry."
	exit 1
fi

# Single persistent open: every extra open() resets the Uno.
exec 3<>"$PORT"
sleep 2.5   # let the auto-reset + bootloader finish

cat <&3 > /tmp/braille-hw.log &
CPID=$!

send() {
	printf '%s\n' "$1" >&3
	sleep "${2:-1.5}"
}

send '{"cmd":"ID"}'                                        1
send '{"cmd":"SET_TARGET","char":"B","show":true}'         2.5
send '{"cmd":"SET_DOTS","dots":[1,3],"label":"K","show":true}' 2.5
send '{"cmd":"CLEAR"}'                                     1.5

kill $CPID 2>/dev/null
exec 3<&- 3>&-

echo "=== BOARD RESPONSES ==="
cat /tmp/braille-hw.log
