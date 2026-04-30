import { Macleod, YIN } from "pitchfinder";
import "../styles.css";

type Note = {
  solfege: string;
  name: string;
  frequency: number;
};

type PitchSample = {
  timeMs: number;
  capturedAt: number;
  frequency: number | null;
  midi: number | null;
  note: string | null;
  centsFromTarget: number | null;
  volume: number;
  clarity: number | null;
};

type PitchDetection = {
  frequency: number | null;
  clarity: number | null;
};

type PitchCandidate = {
  frequency: number;
  confidence: number;
  source: "yin" | "macleod";
};

type GraphPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type LibraryDetectors = {
  sampleRate: number;
  yin: (buffer: Float32Array<ArrayBuffer>) => number | null;
  macleod: (buffer: Float32Array<ArrayBuffer>) => { freq: number; probability: number };
};

type AppState = {
  noteRangeStartMidi: number;
  target: Note;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  mediaStream: MediaStream | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  referenceOscillator: OscillatorNode | null;
  referenceGain: GainNode | null;
  referenceVolume: number;
  pitchDetectors: LibraryDetectors | null;
  isMicActive: boolean;
  animationId: number | null;
  buffer: Float32Array<ArrayBuffer> | null;
  samples: PitchSample[];
  totalAbsCents: number;
  totalValidSamples: number;
  sessionStart: number | null;
  stableMs: number;
  lastSampleAt: number | null;
  tolerance: number;
  minRms: number;
  selectedDeviceId: string;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const SOLFEGE_NAMES = [
  "ド",
  "ド#",
  "レ",
  "レ#",
  "ミ",
  "ファ",
  "ファ#",
  "ソ",
  "ソ#",
  "ラ",
  "ラ#",
  "シ",
  "ド",
] as const;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DEFAULT_RANGE_START_MIDI = 48;
const GRAPH_SECONDS = 12;
const GRAPH_RANGE_SEMITONES = 12;
const DETECTION_MIN_HZ = 80;
const DETECTION_MAX_HZ = 1600;
const YIN_THRESHOLD = 0.12;
const MIN_CLARITY = 0.52;
const MACLEOD_CUTOFF = 0.93;
const MAX_REFERENCE_GAIN = 0.5;
const TARGET_DISTANCE_CONFIDENCE_WEIGHT = 0.012;

const state: AppState = {
  noteRangeStartMidi: DEFAULT_RANGE_START_MIDI,
  target: buildNoteRange(DEFAULT_RANGE_START_MIDI)[0],
  audioContext: null,
  analyser: null,
  mediaStream: null,
  sourceNode: null,
  referenceOscillator: null,
  referenceGain: null,
  referenceVolume: 0.35,
  pitchDetectors: null,
  isMicActive: false,
  animationId: null,
  buffer: null,
  samples: [],
  totalAbsCents: 0,
  totalValidSamples: 0,
  sessionStart: null,
  stableMs: 0,
  lastSampleAt: null,
  tolerance: 20,
  minRms: 0.006,
  selectedDeviceId: "",
};

function queryElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

const elements = {
  noteButtons: queryElement<HTMLDivElement>("#noteButtons"),
  targetFrequency: queryElement<HTMLParagraphElement>("#targetFrequency"),
  playScaleButton: queryElement<HTMLButtonElement>("#playScaleButton"),
  playToneButton: queryElement<HTMLButtonElement>("#playToneButton"),
  micButton: queryElement<HTMLButtonElement>("#micButton"),
  micSelect: queryElement<HTMLSelectElement>("#micSelect"),
  micDeviceStatus: queryElement<HTMLParagraphElement>("#micDeviceStatus"),
  noteRangeSelect: queryElement<HTMLSelectElement>("#noteRangeSelect"),
  referenceVolumeInput: queryElement<HTMLInputElement>("#referenceVolumeInput"),
  referenceVolumeValue: queryElement<HTMLOutputElement>("#referenceVolumeValue"),
  toleranceInput: queryElement<HTMLInputElement>("#toleranceInput"),
  toleranceValue: queryElement<HTMLOutputElement>("#toleranceValue"),
  sensitivityInput: queryElement<HTMLInputElement>("#sensitivityInput"),
  sensitivityValue: queryElement<HTMLOutputElement>("#sensitivityValue"),
  analysisStatus: queryElement<HTMLElement>("#analysisStatus"),
  graphVolume: queryElement<HTMLElement>("#graphVolume"),
  graphClarity: queryElement<HTMLElement>("#graphClarity"),
  durationReadout: queryElement<HTMLElement>("#durationReadout"),
  stableReadout: queryElement<HTMLElement>("#stableReadout"),
  averageReadout: queryElement<HTMLElement>("#averageReadout"),
  recentAverageReadout: queryElement<HTMLElement>("#recentAverageReadout"),
  clearGraphButton: queryElement<HTMLButtonElement>("#clearGraphButton"),
  pitchCanvas: queryElement<HTMLCanvasElement>("#pitchCanvas"),
};

const maybeCanvasContext = elements.pitchCanvas.getContext("2d");

if (!maybeCanvasContext) {
  throw new Error("Canvas 2D context is not available.");
}

const canvasContext = maybeCanvasContext;

function init() {
  renderNoteButtons();
  updateTargetDisplay();
  updateReferenceVolume();
  updateTolerance();
  updateSensitivity();
  drawGraph();

  elements.playToneButton.addEventListener("click", () => {
    toggleReferenceTone();
  });

  elements.playScaleButton.addEventListener("click", playScale);
  elements.micButton.addEventListener("click", toggleMicrophone);
  elements.clearGraphButton.addEventListener("click", clearSession);
  elements.noteRangeSelect.addEventListener("change", handleNoteRangeChange);
  elements.referenceVolumeInput.addEventListener("input", updateReferenceVolume);
  elements.toleranceInput.addEventListener("input", updateTolerance);
  elements.sensitivityInput.addEventListener("input", updateSensitivity);
  elements.micSelect.addEventListener("change", handleMicSelection);

  refreshAudioDevices();
}

function renderNoteButtons() {
  const notes = getCurrentNotes();

  elements.noteButtons.replaceChildren(
    ...notes.map((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "note-button";
      button.setAttribute("aria-pressed", String(note.name === state.target.name));
      button.innerHTML = `<strong>${note.solfege}</strong><span>${note.name}</span>`;
      button.addEventListener("click", () => {
        state.target = note;
        resetActiveSession();
        updateTargetDisplay();
        renderNoteButtons();
        updateReferenceToneFrequency();
        drawGraph();
      });
      return button;
    }),
  );
}

function handleNoteRangeChange() {
  const previousIndex = getCurrentNotes().findIndex((note) => note.name === state.target.name);
  const nextStartMidi = Number(elements.noteRangeSelect.value);
  const nextNotes = buildNoteRange(nextStartMidi);

  state.noteRangeStartMidi = nextStartMidi;
  state.target = nextNotes[Math.max(0, previousIndex)] ?? nextNotes[0];

  resetActiveSession();
  updateTargetDisplay();
  renderNoteButtons();
  updateReferenceToneFrequency();
  drawGraph();
}

function getCurrentNotes(): Note[] {
  return buildNoteRange(state.noteRangeStartMidi);
}

function buildNoteRange(startMidi: number): Note[] {
  return SOLFEGE_NAMES.map((solfege, index) => {
    const midi = startMidi + index;

    return {
      solfege,
      name: midiToNoteName(midi),
      frequency: midiToFrequency(midi),
    };
  });
}

function getAudioContext(): AudioContext {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }

  return state.audioContext;
}

function playTone(frequency: number, durationSec = 0.8, delaySec = 0) {
  const audioContext = getAudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startAt = audioContext.currentTime + delaySec;
  const stopAt = startAt + durationSec;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(getReferenceGainValue(), startAt + 0.03);
  gain.gain.setValueAtTime(getReferenceGainValue(), Math.max(startAt + 0.04, stopAt - 0.08));
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.02);
}

function toggleReferenceTone() {
  if (state.referenceOscillator) {
    stopReferenceTone();
    return;
  }

  startReferenceTone();
}

function startReferenceTone() {
  const audioContext = getAudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(state.target.frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(getReferenceGainValue(), now + 0.04);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);

  state.referenceOscillator = oscillator;
  state.referenceGain = gain;
  elements.playToneButton.classList.add("is-active");
  elements.playToneButton.innerHTML = `<span aria-hidden="true">■</span>停止`;
}

function stopReferenceTone() {
  if (!state.referenceOscillator || !state.referenceGain || !state.audioContext) {
    state.referenceOscillator = null;
    state.referenceGain = null;
    elements.playToneButton.classList.remove("is-active");
    elements.playToneButton.innerHTML = `<span aria-hidden="true">▶</span>参考音`;
    return;
  }

  const now = state.audioContext.currentTime;
  state.referenceGain.gain.cancelScheduledValues(now);
  state.referenceGain.gain.setValueAtTime(state.referenceGain.gain.value, now);
  state.referenceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  state.referenceOscillator.stop(now + 0.06);
  state.referenceOscillator = null;
  state.referenceGain = null;

  elements.playToneButton.classList.remove("is-active");
  elements.playToneButton.innerHTML = `<span aria-hidden="true">▶</span>参考音`;
}

function updateReferenceToneFrequency() {
  if (!state.referenceOscillator || !state.audioContext) {
    return;
  }

  state.referenceOscillator.frequency.setTargetAtTime(
    state.target.frequency,
    state.audioContext.currentTime,
    0.015,
  );
}

function updateReferenceVolume() {
  state.referenceVolume = Number(elements.referenceVolumeInput.value) / 100;
  elements.referenceVolumeValue.textContent = `${Math.round(state.referenceVolume * 100)}%`;

  if (state.referenceGain && state.audioContext) {
    state.referenceGain.gain.setTargetAtTime(
      getReferenceGainValue(),
      state.audioContext.currentTime,
      0.015,
    );
  }
}

function getReferenceGainValue(): number {
  return Math.max(0.0001, state.referenceVolume * MAX_REFERENCE_GAIN);
}

function playScale() {
  getCurrentNotes().forEach((note, index) => {
    playTone(note.frequency, 0.42, index * 0.5);
  });
}

async function toggleMicrophone() {
  if (state.isMicActive) {
    stopMicrophone();
    return;
  }

  try {
    await startMicrophone();
  } catch (error) {
    elements.analysisStatus.textContent =
      "マイクを開始できませんでした。ブラウザの許可を確認してください。";
    console.error(error);
  }
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.analysisStatus.textContent =
      "この表示方法ではマイクを利用できません。外部ブラウザで localhost を開いてください。";
    return;
  }

  const audioContext = getAudioContext();
  const audioConstraint = state.selectedDeviceId
    ? { deviceId: { exact: state.selectedDeviceId } }
    : true;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(typeof audioConstraint === "object" ? audioConstraint : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;

  const sourceNode = audioContext.createMediaStreamSource(stream);
  sourceNode.connect(analyser);

  state.mediaStream = stream;
  state.analyser = analyser;
  state.sourceNode = sourceNode;
  state.pitchDetectors = createPitchDetectors(audioContext.sampleRate, analyser.fftSize);
  state.buffer = new Float32Array(analyser.fftSize);
  state.isMicActive = true;
  resetSessionStats(performance.now());

  elements.micButton.classList.add("is-active");
  elements.micButton.innerHTML = `<span aria-hidden="true">■</span>マイク停止`;
  elements.analysisStatus.textContent = "音程を解析中です";

  await refreshAudioDevices();
  updateActiveDeviceFromStream(stream);

  state.animationId = requestAnimationFrame(analyzeFrame);
}

function stopMicrophone() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
  }

  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.sourceNode?.disconnect();

  state.mediaStream = null;
  state.sourceNode = null;
  state.analyser = null;
  state.pitchDetectors = null;
  state.buffer = null;
  state.isMicActive = false;
  state.animationId = null;

  elements.micButton.classList.remove("is-active");
  elements.micButton.innerHTML = `<span aria-hidden="true">●</span>マイク開始`;
  elements.analysisStatus.textContent = "マイクを停止しました";
}

async function handleMicSelection() {
  state.selectedDeviceId = elements.micSelect.value;
  const selectedLabel =
    elements.micSelect.selectedOptions[0]?.textContent || "既定のマイク";
  elements.micDeviceStatus.textContent = `選択中: ${selectedLabel}`;

  if (state.isMicActive) {
    stopMicrophone();
    await startMicrophone();
  }
}

async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.micDeviceStatus.textContent = "このブラウザではマイク一覧を取得できません。";
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const currentValue = state.selectedDeviceId || elements.micSelect.value;

    elements.micSelect.replaceChildren(
      createOption("", "既定のマイク"),
      ...inputs.map((device, index) =>
        createOption(device.deviceId, device.label || `マイク ${index + 1}`),
      ),
    );

    if (currentValue && inputs.some((device) => device.deviceId === currentValue)) {
      elements.micSelect.value = currentValue;
    } else {
      elements.micSelect.value = "";
      state.selectedDeviceId = "";
    }

    if (inputs.length === 0) {
      elements.micDeviceStatus.textContent = "利用可能なマイクが見つかりません。";
    } else if (!state.isMicActive && inputs.some((device) => !device.label)) {
      elements.micDeviceStatus.textContent =
        "マイク開始後にデバイス名を表示できます。";
    } else {
      const selectedLabel =
        elements.micSelect.selectedOptions[0]?.textContent || "既定のマイク";
      elements.micDeviceStatus.textContent = `選択中: ${selectedLabel}`;
    }
  } catch (error) {
    elements.micDeviceStatus.textContent = "マイク一覧を取得できませんでした。";
    console.error(error);
  }
}

function updateActiveDeviceFromStream(stream: MediaStream) {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.();
  const deviceId = settings?.deviceId || "";

  if (deviceId) {
    state.selectedDeviceId = deviceId;
    elements.micSelect.value = deviceId;
  }

  const selectedLabel =
    elements.micSelect.selectedOptions[0]?.textContent || track?.label || "既定のマイク";
  elements.micDeviceStatus.textContent = `使用中: ${selectedLabel}`;
}

function createOption(value: string, text: string) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function analyzeFrame(now: number) {
  if (!state.analyser || !state.buffer || !state.audioContext) {
    return;
  }

  state.analyser.getFloatTimeDomainData(state.buffer);
  const volume = getRms(state.buffer);
  const detection = detectPitch(state.buffer, state.audioContext.sampleRate);
  const sample = createPitchSample(now, detection, volume);
  state.samples.push(sample);
  recordSessionStats(sample);
  trimSamples(now);
  updateReadouts(sample, now);
  drawGraph();

  state.animationId = requestAnimationFrame(analyzeFrame);
}

function createPitchSample(now: number, detection: PitchDetection, volume: number): PitchSample {
  const elapsedMs = state.sessionStart ? now - state.sessionStart : 0;
  const pitch = detection.frequency;
  let cents: number | null = null;
  let note: string | null = null;

  if (pitch) {
    cents = hzToCents(pitch, state.target.frequency);
    note = hzToNoteName(pitch);
  }

  const sample = {
    timeMs: elapsedMs,
    capturedAt: now,
    frequency: pitch,
    midi: pitch ? hzToMidi(pitch) : null,
    note,
    centsFromTarget: cents,
    volume,
    clarity: detection.clarity,
  };

  if (state.lastSampleAt !== null && cents !== null && Math.abs(cents) <= state.tolerance) {
    state.stableMs += now - state.lastSampleAt;
  }
  state.lastSampleAt = now;

  return sample;
}

function updateReadouts(sample: PitchSample, now: number) {
  const hasPitch = sample.frequency !== null;
  const cents = sample.centsFromTarget;

  if (sample.volume < state.minRms) {
    elements.analysisStatus.textContent = "音が小さい、または無音です";
  } else if (!hasPitch) {
    elements.analysisStatus.textContent = "音程を検出できません";
  } else if (cents !== null && Math.abs(cents) <= state.tolerance) {
    elements.analysisStatus.textContent = "目標範囲内です";
  } else if (cents !== null && cents > 0) {
    elements.analysisStatus.textContent = "目標より高い傾向です";
  } else {
    elements.analysisStatus.textContent = "目標より低い傾向です";
  }

  elements.graphVolume.textContent = `${Math.round(Math.min(sample.volume * 500, 100))}%`;
  elements.graphClarity.textContent =
    sample.clarity === null ? "--" : `${Math.round(sample.clarity * 100)}%`;

  updateSummary(now);
}

function updateSummary(now: number) {
  const elapsedSec = state.sessionStart ? (now - state.sessionStart) / 1000 : 0;
  const recentSamples = state.samples.filter((sample) => sample.centsFromTarget !== null);
  const recentAverage =
    recentSamples.length === 0
      ? null
      : recentSamples.reduce((sum, sample) => sum + Math.abs(sample.centsFromTarget ?? 0), 0) /
        recentSamples.length;
  const overallAverage =
    state.totalValidSamples === 0 ? null : state.totalAbsCents / state.totalValidSamples;

  elements.durationReadout.textContent = `${elapsedSec.toFixed(1)} 秒`;
  elements.stableReadout.textContent = `${(state.stableMs / 1000).toFixed(1)} 秒`;
  elements.averageReadout.textContent = formatPitchGap(overallAverage);
  elements.recentAverageReadout.textContent = formatPitchGap(recentAverage);
}

function clearSession() {
  resetSessionStats(state.isMicActive ? performance.now() : null);
  drawGraph();
}

function resetActiveSession() {
  if (!state.isMicActive) {
    return;
  }

  resetSessionStats(performance.now());
}

function resetSessionStats(startAt: number | null) {
  state.samples = [];
  state.totalAbsCents = 0;
  state.totalValidSamples = 0;
  state.sessionStart = startAt;
  state.lastSampleAt = null;
  state.stableMs = 0;
  elements.durationReadout.textContent = "0.0 秒";
  elements.stableReadout.textContent = "0.0 秒";
  elements.averageReadout.textContent = "--";
  elements.recentAverageReadout.textContent = "--";
}

function recordSessionStats(sample: PitchSample) {
  if (sample.centsFromTarget === null) {
    return;
  }

  state.totalAbsCents += Math.abs(sample.centsFromTarget);
  state.totalValidSamples += 1;
}

function formatPitchGap(value: number | null): string {
  return value === null ? "--" : `半音の${Math.round(value)}%`;
}

function updateTargetDisplay() {
  elements.targetFrequency.textContent = `${state.target.name} / ${state.target.frequency.toFixed(2)} Hz`;
}

function updateTolerance() {
  state.tolerance = Number(elements.toleranceInput.value);
  elements.toleranceValue.textContent = `半音の${state.tolerance}%`;
  drawGraph();
}

function updateSensitivity() {
  const value = Number(elements.sensitivityInput.value);
  state.minRms = value / 1000;

  if (value <= 4) {
    elements.sensitivityValue.textContent = "高い";
  } else if (value >= 12) {
    elements.sensitivityValue.textContent = "低い";
  } else {
    elements.sensitivityValue.textContent = "標準";
  }
}

function createPitchDetectors(sampleRate: number, bufferSize: number): LibraryDetectors {
  return {
    sampleRate,
    yin: YIN({
      sampleRate,
      threshold: YIN_THRESHOLD,
      probabilityThreshold: MIN_CLARITY,
    }),
    macleod: Macleod({
      sampleRate,
      bufferSize,
      cutoff: MACLEOD_CUTOFF,
    }),
  };
}

function detectPitch(buffer: Float32Array<ArrayBuffer>, sampleRate: number): PitchDetection {
  const rms = getRms(buffer);

  if (rms < state.minRms) {
    return { frequency: null, clarity: null };
  }

  const detectors =
    state.pitchDetectors?.sampleRate === sampleRate
      ? state.pitchDetectors
      : createPitchDetectors(sampleRate, buffer.length);
  state.pitchDetectors = detectors;

  const candidates: PitchCandidate[] = [];
  const yinPitch = detectors.yin(buffer);

  if (yinPitch !== null) {
    candidates.push({
      frequency: yinPitch,
      confidence: 0.86,
      source: "yin",
    });
  }

  const macleodPitch = detectors.macleod(buffer);

  if (macleodPitch.freq > 0 && macleodPitch.probability >= MIN_CLARITY) {
    candidates.push({
      frequency: macleodPitch.freq,
      confidence: clamp(macleodPitch.probability, 0, 1),
      source: "macleod",
    });
  }

  const bestCandidate = chooseBestLibraryPitch(candidates);

  if (!bestCandidate) {
    const fallbackClarity =
      macleodPitch.freq > 0 ? clamp(macleodPitch.probability, 0, 1) : null;
    return { frequency: null, clarity: fallbackClarity };
  }

  return {
    frequency: bestCandidate.frequency,
    clarity: bestCandidate.confidence,
  };
}

function chooseBestLibraryPitch(candidates: PitchCandidate[]): PitchCandidate | null {
  const targetMinHz = Math.max(DETECTION_MIN_HZ, state.target.frequency / 2);
  const targetMaxHz = Math.min(DETECTION_MAX_HZ, state.target.frequency * 2);
  let bestCandidate: PitchCandidate | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.frequency) ||
      candidate.frequency < targetMinHz ||
      candidate.frequency > targetMaxHz
    ) {
      continue;
    }

    const distanceSemitones = Math.abs(12 * Math.log2(candidate.frequency / state.target.frequency));
    const sourceBonus = candidate.source === "yin" ? 0 : 0.04;
    const score =
      distanceSemitones * TARGET_DISTANCE_CONFIDENCE_WEIGHT +
      (1 - candidate.confidence) +
      sourceBonus;

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestCandidate.confidence < MIN_CLARITY) {
    return null;
  }

  return bestCandidate;
}

function getRms(buffer: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    sum += buffer[i] * buffer[i];
  }

  return Math.sqrt(sum / buffer.length);
}

function hzToCents(frequency: number, targetFrequency: number): number {
  return 1200 * Math.log2(frequency / targetFrequency);
}

function hzToNoteName(frequency: number): string {
  const midi = Math.round(hzToMidi(frequency));
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

function hzToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

function drawGraph() {
  const canvas = elements.pitchCanvas;
  const context = canvasContext;
  const width = canvas.width;
  const height = canvas.height;
  const padding: GraphPadding = { top: 22, right: 20, bottom: 34, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const targetMidi = hzToMidi(state.target.frequency);
  const minMidi = targetMidi - GRAPH_RANGE_SEMITONES;
  const maxMidi = targetMidi + GRAPH_RANGE_SEMITONES;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  const zeroY = midiToY(targetMidi, minMidi, maxMidi, padding, plotHeight);
  const toleranceSemitone = state.tolerance / 100;
  const toleranceTop = midiToY(targetMidi + toleranceSemitone, minMidi, maxMidi, padding, plotHeight);
  const toleranceBottom = midiToY(
    targetMidi - toleranceSemitone,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );

  context.fillStyle = "rgba(47, 133, 90, 0.12)";
  context.fillRect(padding.left, toleranceTop, plotWidth, toleranceBottom - toleranceTop);

  drawGrid(context, padding, plotWidth, plotHeight, minMidi, maxMidi, targetMidi);

  context.strokeStyle = "#146c75";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(padding.left, zeroY);
  context.lineTo(width - padding.right, zeroY);
  context.stroke();

  context.fillStyle = "#172026";
  context.font = "22px system-ui, sans-serif";
  context.fillText(state.target.name, padding.left + 8, zeroY - 10);

  const visibleSamples = state.samples.slice(-900);
  const latestTime = visibleSamples.at(-1)?.timeMs ?? GRAPH_SECONDS * 1000;
  const startTime = Math.max(0, latestTime - GRAPH_SECONDS * 1000);

  context.strokeStyle = "#2b6cb0";
  context.lineWidth = 4;
  context.beginPath();
  let startedLine = false;

  visibleSamples.forEach((sample) => {
    if (sample.midi === null || sample.timeMs < startTime) {
      startedLine = false;
      return;
    }

    const x = padding.left + ((sample.timeMs - startTime) / (GRAPH_SECONDS * 1000)) * plotWidth;
    const y = midiToY(sample.midi, minMidi, maxMidi, padding, plotHeight);

    if (!startedLine) {
      context.moveTo(x, y);
      startedLine = true;
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
  drawGraphLabels(context, width, height, padding);
}

function drawGrid(
  context: CanvasRenderingContext2D,
  padding: GraphPadding,
  plotWidth: number,
  plotHeight: number,
  minMidi: number,
  maxMidi: number,
  targetMidi: number,
) {
  context.strokeStyle = "#d7dee2";
  context.lineWidth = 1;
  context.font = "16px system-ui, sans-serif";
  context.fillStyle = "#5c6870";

  for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi += 1) {
    const y = midiToY(midi, minMidi, maxMidi, padding, plotHeight);
    const isOctave = Math.round(midi - targetMidi) % 12 === 0;
    const isTarget = Math.round(midi) === Math.round(targetMidi);

    context.strokeStyle = isTarget ? "#146c75" : isOctave ? "#c6d4d8" : "#e8edf0";
    context.lineWidth = isTarget ? 2 : 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + plotWidth, y);
    context.stroke();

    if (isOctave || isTarget || midi % 2 === 0) {
      context.fillStyle = isTarget ? "#172026" : "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  context.strokeStyle = "#d7dee2";
  context.lineWidth = 1;

  for (let second = 0; second <= GRAPH_SECONDS; second += 3) {
    const x = padding.left + (second / GRAPH_SECONDS) * plotWidth;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + plotHeight);
    context.stroke();
  }
}

function drawGraphLabels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: GraphPadding,
) {
  context.fillStyle = "#5c6870";
  context.font = "16px system-ui, sans-serif";
  context.fillText("音名", 8, 20);
  context.fillText("12秒前", padding.left, height - 10);
  context.fillText("現在", width - padding.right - 38, height - 10);
}

function midiToY(
  midi: number,
  minMidi: number,
  maxMidi: number,
  padding: GraphPadding,
  plotHeight: number,
): number {
  const clamped = clamp(midi, minMidi, maxMidi);
  return padding.top + ((maxMidi - clamped) / (maxMidi - minMidi)) * plotHeight;
}

function trimSamples(now: number) {
  const keepAfter = now - GRAPH_SECONDS * 1000 - 1000;
  state.samples = state.samples.filter((sample) => sample.capturedAt >= keepAfter);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

init();
