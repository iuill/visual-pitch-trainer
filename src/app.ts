import { Macleod, YIN } from "pitchfinder";
import {
  buildGraphPoints,
  createGraphViewport,
  type GraphPadding,
  resolveCanvasBackingSize,
} from "./graphModel";
import {
  detectPitchWithLibraries,
  type LibraryDetectors,
} from "./pitchDetection";
import { buildNoteRange, getRms, midiToNoteName, type Note } from "./pitchMath";
import {
  addSampleToSession,
  createInitialSessionStats,
  createPitchSample,
  createSessionSummary,
  formatAnalysisStatus,
  type PitchSample,
  resolveAnalysisStatus,
  type SessionStats,
  trimSamples,
} from "./session";
import "../styles.css";

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
  isMicStarting: boolean;
  isScalePlaying: boolean;
  scalePlaybackTimerId: number | null;
  animationId: number | null;
  buffer: Float32Array<ArrayBuffer> | null;
  session: SessionStats;
  tolerance: number;
  minRms: number;
  selectedDeviceId: string;
  graphPixelRatio: number;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const DEFAULT_RANGE_START_MIDI = 48;
const GRAPH_SECONDS = 12;
const GRAPH_RANGE_SEMITONES = 6;
const YIN_THRESHOLD = 0.12;
const MIN_CLARITY = 0.52;
const MACLEOD_CUTOFF = 0.93;
const MAX_REFERENCE_GAIN = 0.5;

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
  isMicStarting: false,
  isScalePlaying: false,
  scalePlaybackTimerId: null,
  animationId: null,
  buffer: null,
  session: createInitialSessionStats(),
  tolerance: 50,
  minRms: 0.006,
  selectedDeviceId: "",
  graphPixelRatio: 1,
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
  referenceVolumeValue: queryElement<HTMLOutputElement>(
    "#referenceVolumeValue",
  ),
  toleranceInput: queryElement<HTMLInputElement>("#toleranceInput"),
  toleranceValue: queryElement<HTMLOutputElement>("#toleranceValue"),
  sensitivityInput: queryElement<HTMLInputElement>("#sensitivityInput"),
  sensitivityValue: queryElement<HTMLOutputElement>("#sensitivityValue"),
  analysisStatus: queryElement<HTMLElement>("#analysisStatus"),
  graphVolume: queryElement<HTMLElement>("#graphVolume"),
  graphClarity: queryElement<HTMLElement>("#graphClarity"),
  graphDescription: queryElement<HTMLElement>("#graphDescription"),
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
  setupPitchCanvas();
  drawGraph();
  elements.clearGraphButton.addEventListener("click", clearSession);
  elements.noteRangeSelect.addEventListener("change", handleNoteRangeChange);
  elements.referenceVolumeInput.addEventListener(
    "input",
    updateReferenceVolume,
  );
  elements.toleranceInput.addEventListener("input", updateTolerance);
  elements.sensitivityInput.addEventListener("input", updateSensitivity);
  elements.micSelect.addEventListener("change", handleMicSelection);

  if (isAudioContextSupported()) {
    elements.playToneButton.addEventListener("click", () => {
      try {
        toggleReferenceTone();
      } catch (error) {
        showAudioError(error);
      }
    });

    elements.playScaleButton.addEventListener("click", () => {
      try {
        playScale();
      } catch (error) {
        showAudioError(error);
      }
    });
    elements.micButton.addEventListener("click", toggleMicrophone);
    refreshAudioDevices();
  } else {
    disableAudioControls();
  }
}

function isAudioContextSupported(): boolean {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

function disableAudioControls() {
  elements.playToneButton.disabled = true;
  elements.playScaleButton.disabled = true;
  elements.micButton.disabled = true;
  elements.analysisStatus.textContent =
    "このブラウザでは声の稽古を始められません。別のブラウザで開いてください。";
  elements.micDeviceStatus.textContent =
    "音声機能が使えないため、マイクを取得できません。";
}

function showAudioError(error: unknown) {
  elements.analysisStatus.textContent =
    "声の稽古を開始できませんでした。ブラウザの音声設定を確認してください。";
  console.error(error);
}

function renderNoteButtons() {
  const notes = getCurrentNotes();

  elements.noteButtons.replaceChildren(
    ...notes.map((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "note-button";
      button.setAttribute(
        "aria-pressed",
        String(note.name === state.target.name),
      );
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
  const previousIndex = getCurrentNotes().findIndex(
    (note) => note.name === state.target.name,
  );
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

function getAudioContext(): AudioContext {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext is not available.");
    }

    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    void state.audioContext.resume();
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
  gain.gain.exponentialRampToValueAtTime(
    getReferenceGainValue(),
    startAt + 0.03,
  );
  gain.gain.setValueAtTime(
    getReferenceGainValue(),
    Math.max(startAt + 0.04, stopAt - 0.08),
  );
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
  if (
    !state.referenceOscillator ||
    !state.referenceGain ||
    !state.audioContext
  ) {
    state.referenceOscillator = null;
    state.referenceGain = null;
    elements.playToneButton.classList.remove("is-active");
    elements.playToneButton.innerHTML = `<span aria-hidden="true">▶</span>お手本音`;
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
  elements.playToneButton.innerHTML = `<span aria-hidden="true">▶</span>お手本音`;
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
  if (state.isScalePlaying) {
    return;
  }

  if (state.isMicStarting) {
    elements.analysisStatus.textContent =
      "マイクの準備中です。少し待ってからドレミ稽古を始めてください。";
    return;
  }

  if (state.isMicActive) {
    stopMicrophone();
  }

  stopReferenceTone();
  state.isScalePlaying = true;
  elements.playScaleButton.disabled = true;
  elements.micButton.disabled = true;
  elements.analysisStatus.textContent =
    "ドレミ稽古中です。終わるまでマイクは停止しています。";

  const notes = getCurrentNotes();
  notes.forEach((note, index) => {
    playTone(note.frequency, 0.42, index * 0.5);
  });

  const playbackMs = Math.ceil(((notes.length - 1) * 0.5 + 0.5) * 1000);
  state.scalePlaybackTimerId = window.setTimeout(() => {
    state.isScalePlaying = false;
    state.scalePlaybackTimerId = null;
    elements.playScaleButton.disabled = false;
    updateMicButtonState("stopped");
    elements.analysisStatus.textContent =
      "ドレミ稽古が終わりました。稽古開始でマイクを使えます。";
  }, playbackMs);
}

async function toggleMicrophone() {
  if (state.isMicStarting || state.isScalePlaying) {
    return;
  }

  if (state.isMicActive) {
    stopMicrophone();
    return;
  }

  state.isMicStarting = true;
  updateMicButtonState("starting");

  try {
    await startMicrophone();
    if (!state.isMicActive) {
      updateMicButtonState("stopped");
    }
  } catch (error) {
    elements.analysisStatus.textContent =
      "稽古を開始できませんでした。ブラウザのマイク許可を確認してください。";
    updateMicButtonState("stopped");
    console.error(error);
  } finally {
    state.isMicStarting = false;
  }
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.analysisStatus.textContent =
      "この表示方法ではマイクを使えません。外部ブラウザで localhost を開いてください。";
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
  state.pitchDetectors = createPitchDetectors(
    audioContext.sampleRate,
    analyser.fftSize,
  );
  state.buffer = new Float32Array(analyser.fftSize);
  state.isMicActive = true;
  resetSessionStats(performance.now());

  updateMicButtonState("active");
  elements.analysisStatus.textContent = "声の軌跡を見ています";

  await refreshAudioDevices();
  updateActiveDeviceFromStream(stream);

  state.animationId = requestAnimationFrame(analyzeFrame);
}

function stopMicrophone() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
  }

  state.mediaStream?.getTracks().forEach((track) => {
    track.stop();
  });
  state.sourceNode?.disconnect();

  state.mediaStream = null;
  state.sourceNode = null;
  state.analyser = null;
  state.pitchDetectors = null;
  state.buffer = null;
  state.isMicActive = false;
  state.animationId = null;

  updateMicButtonState("stopped");
  elements.analysisStatus.textContent = "稽古を停止しました";
}

function updateMicButtonState(status: "active" | "starting" | "stopped") {
  elements.micButton.disabled = status === "starting" || state.isScalePlaying;
  elements.micButton.classList.toggle("is-active", status === "active");

  if (status === "active") {
    elements.micButton.innerHTML = `<span aria-hidden="true">■</span>稽古停止`;
  } else if (status === "starting") {
    elements.micButton.innerHTML = `<span aria-hidden="true">●</span>稽古準備中`;
  } else {
    elements.micButton.innerHTML = `<span aria-hidden="true">●</span>稽古開始`;
  }
}

async function handleMicSelection() {
  if (state.isMicStarting) {
    return;
  }

  state.selectedDeviceId = elements.micSelect.value;
  const selectedLabel =
    elements.micSelect.selectedOptions[0]?.textContent || "既定のマイク";
  elements.micDeviceStatus.textContent = `選択中: ${selectedLabel}`;

  if (state.isMicActive) {
    stopMicrophone();
    state.isMicStarting = true;
    updateMicButtonState("starting");
    try {
      await startMicrophone();
      if (!state.isMicActive) {
        updateMicButtonState("stopped");
      }
    } catch (error) {
      elements.analysisStatus.textContent =
        "選択したマイクで稽古を始められませんでした。別の入力を選択してください。";
      elements.micDeviceStatus.textContent = "マイクの切り替えに失敗しました。";
      updateMicButtonState("stopped");
      console.error(error);
    } finally {
      state.isMicStarting = false;
    }
  }
}

async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.micDeviceStatus.textContent =
      "このブラウザではマイク一覧を取得できません。";
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

    if (
      currentValue &&
      inputs.some((device) => device.deviceId === currentValue)
    ) {
      elements.micSelect.value = currentValue;
    } else {
      elements.micSelect.value = "";
      state.selectedDeviceId = "";
    }

    if (inputs.length === 0) {
      elements.micDeviceStatus.textContent =
        "利用可能なマイクが見つかりません。";
    } else if (!state.isMicActive && inputs.some((device) => !device.label)) {
      elements.micDeviceStatus.textContent =
        "稽古開始後に入力名を表示できます。";
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
    elements.micSelect.selectedOptions[0]?.textContent ||
    track?.label ||
    "既定のマイク";
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
  const sample = createPitchSample(
    now,
    detection,
    volume,
    state.target.frequency,
    state.session.sessionStart,
  );
  state.session = addSampleToSession(state.session, sample, state.tolerance);
  state.session = {
    ...state.session,
    samples: trimSamples(state.session.samples, now, GRAPH_SECONDS),
  };
  updateReadouts(sample, now);
  drawGraph();

  state.animationId = requestAnimationFrame(analyzeFrame);
}

function updateReadouts(sample: PitchSample, now: number) {
  const status = resolveAnalysisStatus(sample, state.minRms, state.tolerance);
  elements.analysisStatus.textContent = formatAnalysisStatus(status);
  elements.graphDescription.textContent = formatGraphDescription(
    sample,
    status,
  );

  elements.graphVolume.textContent = `${Math.round(Math.min(sample.volume * 500, 100))}%`;
  elements.graphClarity.textContent =
    sample.clarity === null ? "--" : `${Math.round(sample.clarity * 100)}%`;

  updateSummary(now);
}

function updateSummary(now: number) {
  const summary = createSessionSummary(state.session, now);

  elements.durationReadout.textContent = `${summary.elapsedSec.toFixed(1)} 秒`;
  elements.stableReadout.textContent = `${summary.stableSec.toFixed(1)} 秒`;
  elements.averageReadout.textContent = summary.formattedOverallAverage;
  elements.recentAverageReadout.textContent = summary.formattedRecentAverage;
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
  state.session = createInitialSessionStats(startAt);
  elements.durationReadout.textContent = "0.0 秒";
  elements.stableReadout.textContent = "0.0 秒";
  elements.averageReadout.textContent = "--";
  elements.recentAverageReadout.textContent = "--";
  elements.graphDescription.textContent = "声の軌跡はまだ記録されていません。";
}

function formatGraphDescription(
  sample: PitchSample,
  status: ReturnType<typeof resolveAnalysisStatus>,
): string {
  if (sample.frequency === null || sample.centsFromTarget === null) {
    return `直近の状態: ${formatAnalysisStatus(status)}。声量は${Math.round(
      Math.min(sample.volume * 500, 100),
    )}%、確かさは${
      sample.clarity === null ? "不明" : `${Math.round(sample.clarity * 100)}%`
    }です。`;
  }

  const direction =
    sample.centsFromTarget > state.tolerance
      ? "高め"
      : sample.centsFromTarget < -state.tolerance
        ? "低め"
        : "範囲内";

  return `直近の声は${sample.note ?? "不明"}、目標${state.target.name}に対して半音の${Math.round(
    Math.abs(sample.centsFromTarget),
  )}%${direction}です。声量は${Math.round(
    Math.min(sample.volume * 500, 100),
  )}%、確かさは${
    sample.clarity === null ? "不明" : `${Math.round(sample.clarity * 100)}%`
  }です。`;
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
    elements.sensitivityValue.textContent = "よく拾う";
  } else if (value >= 12) {
    elements.sensitivityValue.textContent = "控えめ";
  } else {
    elements.sensitivityValue.textContent = "ふつう";
  }
}

function setupPitchCanvas() {
  syncPitchCanvasSize();

  const ResizeObserverClass = globalThis.ResizeObserver;
  if (ResizeObserverClass) {
    const observer = new ResizeObserverClass(() => {
      syncPitchCanvasSize();
      drawGraph();
    });
    observer.observe(elements.pitchCanvas);
    return;
  }

  window.addEventListener("resize", () => {
    syncPitchCanvasSize();
    drawGraph();
  });
}

function syncPitchCanvasSize() {
  const canvas = elements.pitchCanvas;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(
    1,
    Math.round(rect.width || canvas.clientWidth || canvas.width),
  );
  const cssHeight = Math.max(
    1,
    Math.round(rect.height || canvas.clientHeight || canvas.height),
  );
  const backingSize = resolveCanvasBackingSize(
    cssWidth,
    cssHeight,
    window.devicePixelRatio || 1,
  );

  state.graphPixelRatio = backingSize.pixelRatio;

  if (
    canvas.width !== backingSize.width ||
    canvas.height !== backingSize.height
  ) {
    canvas.width = backingSize.width;
    canvas.height = backingSize.height;
  }
}

function createPitchDetectors(
  sampleRate: number,
  bufferSize: number,
): LibraryDetectors {
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

function detectPitch(buffer: Float32Array<ArrayBuffer>, sampleRate: number) {
  const detectors =
    state.pitchDetectors?.sampleRate === sampleRate
      ? state.pitchDetectors
      : createPitchDetectors(sampleRate, buffer.length);
  state.pitchDetectors = detectors;

  return detectPitchWithLibraries(buffer, detectors, {
    minRms: state.minRms,
    minClarity: MIN_CLARITY,
    targetFrequency: state.target.frequency,
  });
}

function drawGraph() {
  syncPitchCanvasSize();

  const canvas = elements.pitchCanvas;
  const context = canvasContext;
  const width = canvas.width / state.graphPixelRatio;
  const height = canvas.height / state.graphPixelRatio;
  const visibleSamples = state.session.samples;
  const viewport = createGraphViewport(
    width,
    height,
    state.target.frequency,
    state.tolerance,
    visibleSamples,
    GRAPH_SECONDS,
    GRAPH_RANGE_SEMITONES,
  );

  context.setTransform(
    state.graphPixelRatio,
    0,
    0,
    state.graphPixelRatio,
    0,
    0,
  );
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(47, 133, 90, 0.12)";
  context.fillRect(
    viewport.padding.left,
    viewport.toleranceTop,
    viewport.plotWidth,
    viewport.toleranceBottom - viewport.toleranceTop,
  );

  drawGrid(context, viewport);

  context.strokeStyle = "#146c75";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(viewport.padding.left, viewport.zeroY);
  context.lineTo(width - viewport.padding.right, viewport.zeroY);
  context.stroke();

  context.fillStyle = "#172026";
  context.font = "22px system-ui, sans-serif";
  context.fillText(
    state.target.name,
    viewport.padding.left + 8,
    viewport.zeroY - 10,
  );

  context.strokeStyle = "#2b6cb0";
  context.lineWidth = 4;
  context.beginPath();

  buildGraphPoints(visibleSamples, viewport, GRAPH_SECONDS).forEach((point) => {
    if (point.startsLine) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });

  context.stroke();
  drawGraphLabels(context, width, height, viewport.padding);
}

function drawGrid(
  context: CanvasRenderingContext2D,
  viewport: ReturnType<typeof createGraphViewport>,
) {
  context.strokeStyle = "#d7dee2";
  context.lineWidth = 1;
  context.font = "16px system-ui, sans-serif";
  context.fillStyle = "#5c6870";

  for (
    let midi = Math.ceil(viewport.minMidi);
    midi <= Math.floor(viewport.maxMidi);
    midi += 1
  ) {
    const y =
      viewport.padding.top +
      ((viewport.maxMidi - midi) / (viewport.maxMidi - viewport.minMidi)) *
        viewport.plotHeight;
    const isOctave = Math.round(midi - viewport.targetMidi) % 12 === 0;
    const isTarget = Math.round(midi) === Math.round(viewport.targetMidi);

    context.strokeStyle = isTarget
      ? "#146c75"
      : isOctave
        ? "#c6d4d8"
        : "#e8edf0";
    context.lineWidth = isTarget ? 2 : 1;
    context.beginPath();
    context.moveTo(viewport.padding.left, y);
    context.lineTo(viewport.padding.left + viewport.plotWidth, y);
    context.stroke();

    if (isOctave || isTarget || midi % 2 === 0) {
      context.fillStyle = isTarget ? "#172026" : "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  context.strokeStyle = "#d7dee2";
  context.lineWidth = 1;

  for (let second = 0; second <= GRAPH_SECONDS; second += 3) {
    const x =
      viewport.padding.left + (second / GRAPH_SECONDS) * viewport.plotWidth;
    context.beginPath();
    context.moveTo(x, viewport.padding.top);
    context.lineTo(x, viewport.padding.top + viewport.plotHeight);
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

init();
