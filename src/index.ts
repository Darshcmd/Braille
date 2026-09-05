// ===== Serial connection (from GoogleChromeLabs/serial-terminal) =====
import {
  serial as polyfill, SerialPort as SerialPortPolyfill,
} from 'web-serial-polyfill';
import {BRAILLE_ALPHABET, getSymbols, getDotIndices, getDotDescription, Curriculum} from './braille';
import {initLottie} from './lottie';

type Port = SerialPort | SerialPortPolyfill;

const usePolyfill = new URLSearchParams(window.location.search).has('polyfill');
const serial = usePolyfill ? polyfill : navigator.serial;

let port: Port | undefined;
let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;
let writer: WritableStreamDefaultWriter | undefined;
let keepReading = false;
let readBuffer = '';

// ===== Calibration maps =====
// buttonMap[logical] = physical  (0-indexed). Default identity.
// servoMap[logical] = physical   (0-indexed). Default identity.
let buttonMap: number[] = [0, 1, 2, 3, 4, 5];
let servoMap: number[] = [0, 1, 2, 3, 4, 5];
// Inverse: physical -> logical
let invButtonMap: number[] = [0, 1, 2, 3, 4, 5];

function loadCalibration() {
  try {
    const bm = JSON.parse(localStorage.getItem('braille_button_map') || 'null');
    const sm = JSON.parse(localStorage.getItem('braille_servo_map') || 'null');
    if (bm && bm.length === 6) buttonMap = bm;
    if (sm && sm.length === 6) servoMap = sm;
    rebuildInvButtonMap();
  } catch { /* use defaults */ }
}

function saveCalibration() {
  localStorage.setItem('braille_button_map', JSON.stringify(buttonMap));
  localStorage.setItem('braille_servo_map', JSON.stringify(servoMap));
}

function rebuildInvButtonMap() {
  invButtonMap = [0, 1, 2, 3, 4, 5];
  for (let i = 0; i < 6; i++) invButtonMap[buttonMap[i]] = i;
}

// Remap a SET_DOTS dot list (1-based logical -> 1-based physical)
function remapDots(dots: number[]): number[] {
  return dots.map(d => servoMap[d - 1] + 1);
}

// ===== Calibration wizard =====
const calibration = {
  active: false,
  step: '' as '' | 'buttons' | 'servos',
  buttonIdx: 0,    // which logical button we're mapping (0-5)
  servoIdx: 0,     // which physical servo we're raising (0-5)
};

function startCalibration() {
  if (!port) {
    alert('Connect the board first, then calibrate.');
    return;
  }
  calibration.active = true;
  calibration.step = 'buttons';
  calibration.buttonIdx = 0;
  calibration.servoIdx = 0;
  showCalModal();
  updateCalUI();
}

function calibrationCaptureButton(physicalDot: number) {
  // Record: logical button `buttonIdx` = physical dot `physicalDot`
  buttonMap[calibration.buttonIdx] = physicalDot;
  calibration.buttonIdx++;
  playTone(1200, 40);
  if (calibration.buttonIdx >= 6) {
    // Button calibration done, move to servos
    rebuildInvButtonMap();
    calibration.step = 'servos';
    calibration.servoIdx = 0;
    raiseServoForCalibration(0);
  }
  updateCalUI();
}

function raiseServoForCalibration(physicalServoIdx: number) {
  // Raise one physical servo so the user can see which dot it is
  const dots = [physicalServoIdx + 1]; // 1-based physical dot
  sendCommand({ cmd: 'SET_DOTS', dots, label: '', show: true });
}

function calibrationServoPick(logicalDot: number) {
  // Record: logical servo `servoIdx` = physical servo `servoIdx`
  // Wait - we need to map physical servo -> logical servo
  // servoMap[logical] = physical, so we're filling servoMap[servoIdx] = physical
  servoMap[calibration.servoIdx] = logicalDot - 1; // logicalDot is 1-based user input
  calibration.servoIdx++;
  playTone(1200, 40);
  if (calibration.servoIdx >= 6) {
    // All done
    saveCalibration();
    calibration.active = false;
    calibration.step = '';
    showCalDone();
    // Re-apply current symbol with new mapping
    sendCommand({ cmd: 'SET_DOTS', dots: remapDots(getDotIndices(currentPattern)), label: currentSymbol, show: mode === 'practice' });
    return;
  }
  raiseServoForCalibration(calibration.servoIdx);
  updateCalUI();
}

function skipButtonCalibration() {
  calibration.step = 'servos';
  calibration.servoIdx = 0;
  raiseServoForCalibration(0);
  updateCalUI();
}

function skipServoCalibration() {
  calibration.active = false;
  calibration.step = '';
  saveCalibration();
  closeCalModal();
  sendCommand({ cmd: 'SET_DOTS', dots: remapDots(getDotIndices(currentPattern)), label: currentSymbol, show: mode === 'practice' });
}

// ===== Calibration UI =====
function showCalModal() {
  $('cal-modal').style.display = 'flex';
  $('cal-step-buttons').style.display = 'none';
  $('cal-step-servos').style.display = 'none';
  $('cal-step-done').style.display = 'none';
}

function closeCalModal() {
  calibration.active = false;
  calibration.step = '';
  $('cal-modal').style.display = 'none';
}

function showCalDone() {
  $('cal-step-buttons').style.display = 'none';
  $('cal-step-servos').style.display = 'none';
  $('cal-step-done').style.display = 'block';
}

function updateCalUI() {
  const dots = document.querySelectorAll('#cal-step-buttons .cal-dot, #cal-step-servos .cal-dot');

  if (calibration.step === 'buttons') {
    $('cal-step-buttons').style.display = 'block';
    $('cal-step-servos').style.display = 'none';
    $('cal-step-done').style.display = 'none';
    $('cal-btn-status').textContent = `Press button ${calibration.buttonIdx + 1}`;
    dots.forEach((el, i) => {
      el.classList.toggle('done', i < calibration.buttonIdx);
      el.classList.toggle('active', i === calibration.buttonIdx);
    });
  } else if (calibration.step === 'servos') {
    $('cal-step-buttons').style.display = 'none';
    $('cal-step-servos').style.display = 'block';
    $('cal-step-done').style.display = 'none';
    $('cal-servo-status').textContent = `Raising servo ${calibration.servoIdx + 1} — click the dot that rose`;
    dots.forEach((el, i) => {
      el.classList.toggle('done', i < calibration.servoIdx);
      el.classList.toggle('active', i === calibration.servoIdx);
    });
  }
}

// ===== App state =====
type Mode = 'practice' | 'test';
let mode: Mode = 'practice';
let curriculum: Curriculum = 'alphabet';
let currentSymbol = 'A';
let currentPattern: number[] = BRAILLE_ALPHABET['A'];
let userPattern = [false, false, false, false, false, false];
let firmwareAlive = false;
let patternAcked = false;
let sessionActive = false;
let solveStartTime = 0;

// Stats
let totalSolved = 0;
let totalPerfect = 0;
let totalMisses = 0;
let solveTimes: number[] = [];
let symbolStats: Record<string, { attempts: number; correct: number; misses: number }> = {};
let recentResults: { symbol: string; passed: boolean; time: number }[] = [];

// ===== DOM refs =====
const $ = (id: string) => document.getElementById(id)!;
const connectBtn = $('connect-btn') as HTMLButtonElement;
const statusPill = $('status-pill');
const statusText = $('status-text');
const currentChar = $('current-char');
const patternInstruction = $('pattern-instruction');
const brailleCell = $('braille-cell');
const serialLog = $('serial-log');
const serialInput = $('serial-input') as HTMLInputElement;
const serialSend = $('serial-send') as HTMLButtonElement;

// ===== Logging =====
function logSerial(direction: 'in' | 'out', text: string) {
  const line = document.createElement('div');
  line.className = `log-line log-${direction}`;
  line.textContent = `${direction === 'out' ? '→' : '←'} ${text}`;
  serialLog.appendChild(line);
  serialLog.scrollTop = serialLog.scrollHeight;
}

// ===== Serial write =====
async function sendCommand(cmd: object) {
  if (!port?.writable) return;
  try {
    writer = port.writable.getWriter();
    const data = JSON.stringify(cmd) + '\n';
    await writer.write(new TextEncoder().encode(data));
    logSerial('out', data.trim());
    writer.releaseLock();
    writer = undefined;
  } catch (e) {
    console.warn('write failed', e);
  }
}

// ===== Serial read loop (Google's pattern) =====
async function readLoop() {
  while (port && port.readable && keepReading) {
    try {
      reader = port.readable.getReader();
      try {
        while (true) {
          const result = await (reader as ReadableStreamDefaultReader).read();
          const { value, done } = result;
          if (done) break;
          if (value) {
            readBuffer += new TextDecoder().decode(value);
            const lines = readBuffer.split('\n');
            readBuffer = lines.pop() || '';
            for (const line of lines) {
              if (line.trim()) handleFirmwareLine(line.trim());
            }
          }
        }
      } finally {
        reader.releaseLock();
        reader = undefined;
      }
    } catch (e) {
      console.warn('read error', e);
      break;
    }
  }
}

// ===== Firmware message handler =====
function handleFirmwareLine(line: string) {
  logSerial('in', line);
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }

  // Calibration: capture raw button presses
  if (calibration.active && calibration.step === 'buttons' && msg.event === 'BUTTON') {
    calibrationCaptureButton(msg.dot - 1);
    return;
  }

  if (msg.event === 'READY') {
    firmwareAlive = true;
    updateStatus();
    sendCommand({ cmd: 'MODE', mode: mode.toUpperCase() });
    sendCommand({ cmd: 'SET_DOTS', dots: remapDots(getDotIndices(currentPattern)), label: currentSymbol, show: mode === 'practice' });
  }

  if (msg.event === 'TARGET') {
    patternAcked = true;
    sessionActive = true;
    updateStatus();
  }

  if (msg.event === 'DOT_OK') {
    const physicalDot = msg.dot - 1;
    const logicalDot = invButtonMap[physicalDot];
    if (logicalDot >= 0 && logicalDot < 6) {
      userPattern[logicalDot] = true;
      flashDot(logicalDot, 'correct');
      playTone(1000, 60);
    }
  }

  if (msg.event === 'RESULT') {
    if (msg.outcome === 'correct') handleSolve(true);
  }

  if (msg.event === 'BUTTON') {
    const physicalDot = msg.dot - 1;
    const logicalDot = invButtonMap[physicalDot];
    if (logicalDot >= 0 && logicalDot < 6 && sessionActive) handleDotPress(logicalDot);
  }
}

// ===== Connect / Disconnect (Google's pattern) =====
async function connectToPort() {
  try {
    port = await serial.requestPort();
    await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
    keepReading = true;
    firmwareAlive = false;
    patternAcked = false;
    updateStatus();
    readLoop();
    setTimeout(async () => { await sendCommand({ cmd: 'ID' }); }, 1200);
  } catch (e) {
    console.error('connect failed', e);
    setStatus('error', 'Connection failed');
  }
}

async function disconnectFromPort() {
  keepReading = false;
  try {
    if (reader) await reader.cancel();
    if (writer) writer.releaseLock();
    if (port) await port.close();
  } catch (e) { /* ignore */ }
  port = undefined;
  firmwareAlive = false;
  patternAcked = false;
  sessionActive = false;
  updateStatus();
}

function setStatus(type: 'disconnected' | 'connecting' | 'connected' | 'error', text: string) {
  statusPill.className = `status pill-${type === 'error' ? 'connecting' : type}`;
  statusText.textContent = text;
  connectBtn.textContent = port ? 'Disconnect' : 'Connect';
}

function updateStatus() {
  if (!port) setStatus('disconnected', 'Disconnected');
  else if (!firmwareAlive) setStatus('connecting', 'Linking board...');
  else if (!patternAcked) setStatus('connecting', 'Syncing board...');
  else setStatus('connected', 'Board ready');
}

// ===== Tutor logic =====
function pickNextSymbol(): string {
  const symbols = getSymbols(curriculum);
  const keys = Object.keys(symbols);
  const weights = keys.map(k => {
    const s = symbolStats[k];
    if (!s) return 3;
    // Stronger weighting for weak symbols: square the weakness factor
    const weakness = 1 - s.correct / s.attempts;
    return Math.pow(weakness, 1.5) * 4 + 0.5;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r <= 0) return keys[i];
  }
  return keys[Math.floor(Math.random() * keys.length)];
}

function pickWeakSymbol(): string {
  const symbols = getSymbols(curriculum);
  const keys = Object.keys(symbols);
  // Filter to symbols with at least 1 attempt and accuracy < 70%
  const weak = keys.filter(k => {
    const s = symbolStats[k];
    return s && s.attempts >= 1 && s.correct / s.attempts < 0.7;
  });
  if (weak.length === 0) return pickNextSymbol();
  // Pick the weakest one (lowest accuracy)
  weak.sort((a, b) => {
    const sa = symbolStats[a], sb = symbolStats[b];
    return (sa.correct / sa.attempts) - (sb.correct / sb.attempts);
  });
  // Pick from top 3 weakest with some randomness
  const topWeak = weak.slice(0, Math.min(3, weak.length));
  return topWeak[Math.floor(Math.random() * topWeak.length)];
}

function setMode(newMode: Mode) {
  if (mode === newMode) return;
  mode = newMode;
  // Update UI
  document.querySelectorAll('[data-mode]').forEach(e => {
    e.classList.toggle('active', (e as HTMLElement).dataset.mode === mode);
  });
  // Play mode-change audio
  const modeAudio = new Audio(`/audio-modes/${mode}.mp3`);
  modeAudio.play().catch(() => {/* ignore */});
  renderCell();
  if (firmwareAlive) sendCommand({ cmd: 'MODE', mode: mode.toUpperCase() });
}

function setCurriculum(newCurriculum: Curriculum) {
  if (curriculum === newCurriculum) return;
  curriculum = newCurriculum;
  // Update UI
  document.querySelectorAll('[data-curriculum]').forEach(e => {
    e.classList.toggle('active', (e as HTMLElement).dataset.curriculum === curriculum);
  });
  // Play curriculum-change audio
  const currAudio = new Audio(`/audio-modes/${curriculum}.mp3`);
  currAudio.play().catch(() => {/* ignore */});
  setSymbol(pickNextSymbol());
}

function setSymbol(symbol: string) {
  const symbols = getSymbols(curriculum);
  if (!symbols[symbol]) return;
  currentSymbol = symbol;
  currentPattern = symbols[symbol];
  userPattern = [false, false, false, false, false, false];
  solveStartTime = Date.now();
  sessionActive = true;
  currentChar.textContent = symbol;
  patternInstruction.textContent = getDotDescription(symbol, currentPattern);
  renderCell();
  if (firmwareAlive) {
    sendCommand({ cmd: 'SET_DOTS', dots: remapDots(getDotIndices(currentPattern)), label: symbol, show: mode === 'practice' });
  }
  // Play pre-recorded audio for alphabet/numbers, then speak the description
  playSymbolAudio(symbol, curriculum);
  const letterName = symbol.length === 1 && symbol.match(/[A-Z]/) ? `Letter ${symbol}` : symbol;
  speak(`${letterName}. ${getDotDescription(symbol, currentPattern)}`);
}

function renderCell() {
  const dots = brailleCell.querySelectorAll('.dot');
  // Show the logical Braille pattern (not the physical servo mapping)
  dots.forEach((el) => {
    const dotNum = parseInt((el as HTMLElement).dataset.dot!);
    el.classList.remove('raised', 'pressed', 'correct', 'wrong');
    if (mode === 'practice' && currentPattern[dotNum]) el.classList.add('raised');
    if (userPattern[dotNum]) el.classList.add('pressed');
  });
}

function flashDot(dot: number, type: 'correct' | 'wrong') {
  const dotEl = brailleCell.querySelector(`[data-dot="${dot}"]`);
  if (!dotEl) return;
  dotEl.classList.remove('correct', 'wrong');
  void (dotEl as HTMLElement).offsetWidth;
  dotEl.classList.add(type);
  setTimeout(() => dotEl.classList.remove(type), 400);
}

function handleDotPress(dot: number) {
  if (!sessionActive) return;
  // Only evaluate locally — the firmware has its own independent evaluation
  // and sends RESULT events for hardware presses. Tracking here lets the
  // on-screen UI advance in both practice and test mode without depending
  // on the firmware's button handling.
  if (currentPattern[dot] === 1) {
    userPattern[dot] = true;
    flashDot(dot, 'correct');
    playTone(1000, 60);
    // Check if all required dots are now pressed
    if (currentPattern.every((v, i) => v === 0 || userPattern[i])) {
      handleSolve(true);
    }
  } else {
    flashDot(dot, 'wrong');
    playTone(400, 250);
    totalMisses++;
    if (!symbolStats[currentSymbol]) symbolStats[currentSymbol] = { attempts: 0, correct: 0, misses: 0 };
    symbolStats[currentSymbol].misses++;
    userPattern = [false, false, false, false, false, false];
    renderCell();
  }
}

function handleSolve(passed: boolean) {
  // Guard: if the session already ended, ignore duplicate RESULT events
  // from the firmware (the local evaluation already advanced us).
  if (!sessionActive) return;
  const time = (Date.now() - solveStartTime) / 1000;
  sessionActive = false;
  if (!symbolStats[currentSymbol]) symbolStats[currentSymbol] = { attempts: 0, correct: 0, misses: 0 };
  symbolStats[currentSymbol].attempts++;
  if (passed) {
    symbolStats[currentSymbol].correct++;
    totalSolved++;
    solveTimes.push(time);
    if (symbolStats[currentSymbol].misses === 0) totalPerfect++;
  }
  recentResults.unshift({ symbol: currentSymbol, passed, time });
  if (recentResults.length > 10) recentResults.pop();
  if (passed) { playSuccessMelody(); spawnConfetti(); speak('Correct! Great job.'); }
  else speak('Not quite. Try again.');
  updateStats();
  setTimeout(() => setSymbol(pickNextSymbol()), passed ? 2000 : 1500);
}

// ===== Audio (browsers block AudioContext + speech until user interacts) =====
let audioEnabled = false;
let speechEnabled = false;
let speechQueue: string[] = [];
let audioCtx: AudioContext | null = null;

// Play a pre-recorded wav file for the current symbol (alphabet/numbers)
let pendingAudioSymbol = '';
let pendingAudioCurriculum = '';

function playSymbolAudio(symbol: string, curriculum: string) {
  if (!audioEnabled) {
    // Queue for playback once user interacts
    pendingAudioSymbol = symbol;
    pendingAudioCurriculum = curriculum;
    return;
  }
  let path = '';
  if (curriculum === 'alphabet') {
    path = `/audio-alphabet/${symbol.toUpperCase()}.wav`;
  } else if (curriculum === 'numbers') {
    path = `/audio-numbers/${symbol}.wav`;
  } else {
    return; // contractions: no audio file, use speech
  }
  try {
    const audio = new Audio(path);
    audio.play().catch(() => {/* ignore */});
  } catch {/* ignore */}
}

function ensureAudio() {
  if (audioEnabled) return;
  audioEnabled = true;
  speechEnabled = true;
  try { audioCtx = new AudioContext(); } catch { /* ignore */ }
  const banner = document.getElementById('sound-banner');
  if (banner) banner.classList.add('hidden');
  const queued = speechQueue;
  speechQueue = [];
  queued.forEach(t => speak(t));
  // Play queued audio file from before user interaction
  if (pendingAudioSymbol) {
    playSymbolAudio(pendingAudioSymbol, pendingAudioCurriculum);
    pendingAudioSymbol = '';
    pendingAudioCurriculum = '';
  }
}

function playTone(freq: number, ms: number) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + ms / 1000);
    osc.start(); osc.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* ignore */ }
}

function playSuccessMelody() {
  [523, 659, 784].forEach((f, i) => setTimeout(() => playTone(f, 150), i * 120));
}

function speak(text: string) {
  if (!speechEnabled) {
    speechQueue.push(text);
    return;
  }
  try {
    const u = new SpeechSynthesisUtterance(text);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// Enable audio + speech on first user interaction
document.addEventListener('click', ensureAudio, { once: true });
document.addEventListener('keydown', ensureAudio, { once: true });
document.addEventListener('touchstart', ensureAudio, { once: true });

function spawnConfetti() {
  const container = $('confetti-container');
  const colors = ['#4f46e5', '#16a34a', '#fbbf24', '#dc2626', '#0891b2'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.top = Math.random() * 30 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 2000);
  }
}

function updateStats() {
  $('stat-perfect').textContent = String(totalPerfect);
  $('stat-solved').textContent = String(totalSolved);
  $('stat-misses').textContent = String(totalMisses);
  $('stat-time').textContent = solveTimes.length > 0
    ? (solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length).toFixed(1) + 's' : '--';
  const weakList = $('weak-list');
  const sorted = Object.entries(symbolStats).filter(([, s]) => s.attempts >= 2)
    .sort((a, b) => (a[1].correct / a[1].attempts) - (b[1].correct / b[1].attempts)).slice(0, 5);
  weakList.innerHTML = sorted.length === 0
    ? '<li class="weak-empty">Not enough data yet</li>'
    : sorted.map(([sym, s]) => `<li class="weak-item"><span class="weak-char">${sym}</span><span class="weak-acc">${Math.round(s.correct / s.attempts * 100)}%</span></li>`).join('');
  const recentList = $('recent-list');
  recentList.innerHTML = recentResults.map(r =>
    `<li class="recent-item"><span class="recent-char">${r.symbol}</span><span class="recent-result ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'Pass' : 'Fail'}  ${r.time.toFixed(1)}s</span></li>`).join('');
}

// ===== Event wiring =====
connectBtn.addEventListener('click', () => {
  if (port) disconnectFromPort();
  else connectToPort();
});

$('calibrate-btn').addEventListener('click', startCalibration);
$('cal-close').addEventListener('click', closeCalModal);
$('cal-skip-buttons').addEventListener('click', skipButtonCalibration);
$('cal-skip-servos').addEventListener('click', skipServoCalibration);
$('cal-done-btn').addEventListener('click', closeCalModal);

document.querySelectorAll('[data-servo-pick]').forEach(el => {
  el.addEventListener('click', () => {
    const dot = parseInt((el as HTMLElement).dataset.servoPick!);
    calibrationServoPick(dot);
  });
});

$('hint-btn').addEventListener('click', () => speak(getDotDescription(currentSymbol, currentPattern)));
$('repeat-btn').addEventListener('click', () => speak(getDotDescription(currentSymbol, currentPattern)));
$('next-btn').addEventListener('click', () => setSymbol(pickNextSymbol()));

$('reset-btn').addEventListener('click', () => {
  totalSolved = 0; totalPerfect = 0; totalMisses = 0;
  solveTimes = []; symbolStats = {}; recentResults = [];
  updateStats();
});

$('practice-weak-btn').addEventListener('click', () => {
  const weak = pickWeakSymbol();
  if (weak) setSymbol(weak);
});

brailleCell.querySelectorAll('.dot').forEach(el => {
  el.addEventListener('click', () => {
    const dot = parseInt((el as HTMLElement).dataset.dot!);
    handleDotPress(dot);
    renderCell();
  });
});

document.addEventListener('keydown', (e) => {
  const dot = parseInt(e.key) - 1;
  if (dot >= 0 && dot < 6) { handleDotPress(dot); renderCell(); }
  if (e.key === ' ') { e.preventDefault(); setMode(mode === 'practice' ? 'test' : 'practice'); }
  if (e.key === 'n' || e.key === 'N') setCurriculum('numbers');
  if (e.key === 'a' || e.key === 'A') setCurriculum('alphabet');
  if (e.key === 'c' || e.key === 'C') setCurriculum('contractions');
  if (e.key === 'h' || e.key === 'H') speak(getDotDescription(currentSymbol, currentPattern));
  if (e.key === 'r' || e.key === 'R') speak(getDotDescription(currentSymbol, currentPattern));
});

document.querySelectorAll('[data-mode]').forEach(el => {
  el.addEventListener('click', () => {
    setMode((el as HTMLElement).dataset.mode as Mode);
  });
});

document.querySelectorAll('[data-curriculum]').forEach(el => {
  el.addEventListener('click', () => {
    setCurriculum((el as HTMLElement).dataset.curriculum as Curriculum);
  });
});

serialSend.addEventListener('click', async () => {
  const val = serialInput.value.trim();
  if (val) {
    try { JSON.parse(val); await sendCommand(JSON.parse(val)); }
    catch { await sendCommand({ cmd: val }); }
    serialInput.value = '';
  }
});

serialInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') serialSend.click();
});

// ===== Init =====
function init() {
  loadCalibration();
  initLottie($('lottie-container'));
  setSymbol('A');
  updateStatus();
  updateStats();
}

document.addEventListener('DOMContentLoaded', init);
