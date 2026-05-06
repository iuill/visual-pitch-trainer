import { PitchDetector } from "pitchy";
import {
  type AudioFileAnalysis,
  type AudioPitchPoint,
  analyzeAudioData,
  formatDuration,
  formatMidiRange,
  getVoiceCoverage,
} from "./audioFileAnalysis";
import {
  analyzeAudioDataWithCrepe,
  assertCrepeModelAccessible,
  type CrepeAnalysisProgress,
  type CrepeModelSize,
  getCrepeModelUrl,
  getCrepePitchDetectionSupportMessage,
  releaseCrepeSessions,
} from "./crepePitchDetection";
import {
  createInitialGameEffectState,
  type GameEffectState,
  getTargetGlowStrength,
  updateGameEffectState,
} from "./gameEffects";
import {
  buildGraphPoints,
  clamp,
  createGraphViewport,
  type GraphPadding,
  midiToY,
  resolveCanvasBackingSize,
} from "./graphModel";
import {
  createMp3BlobFromDecodedAudio,
  createWavBlobFromDecodedAudio,
  type DecodedMediaAudio,
  decodeMediaAudio,
  mixChannelsToMono,
} from "./mediaAudioExtraction";
import {
  detectPitchWithLibraries,
  type LibraryDetectors,
} from "./pitchDetection";
import {
  buildNoteRange,
  getRms,
  midiToNoteName,
  midiToSolfegeName,
  type Note,
} from "./pitchMath";
import {
  analyzeAudioDataWithRmvpe,
  assertRmvpeModelAccessible,
  getRmvpePitchDetectionSupportMessage,
  type RmvpeAnalysisProgress,
  releaseRmvpeSession,
} from "./rmvpePitchDetection";
import {
  addSampleToSession,
  createInitialSessionStats,
  createPitchSample,
  createSessionSummary,
  formatAnalysisStatus,
  MAX_STABLE_SAMPLE_GAP_MS,
  type PitchSample,
  resolveAnalysisStatus,
  type SessionStats,
  trimSamples,
} from "./session";
import {
  assertVocalSeparationModelAccessible,
  assertVocalSeparationSupported,
  extractVocals,
  getVocalSeparationSupportMessage,
  VOCAL_SEPARATION_MODELS,
  type VocalSeparationModelId,
  type VocalSeparationProgress,
} from "./vocalSeparation";
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
  audioRangePixelRatio: number;
  selectedAudioFile: File | null;
  selectedPlaybackAudioFile: File | null;
  useSeparatePlaybackAudio: boolean;
  useVocalExtraction: boolean;
  vocalSeparationModel: VocalSeparationModelId;
  audioPitchEstimator: AudioPitchEstimator;
  isCapturingCrepeComparison: boolean;
  isCapturingVocalSeparationComparison: boolean;
  isEncodingExtractedVocalDownload: boolean;
  audioPlaybackSource: "original" | "vocals";
  selectedPlaybackAudioFileUrl: string | null;
  extractedVocalAudioUrl: string | null;
  extractedVocalAudio: DecodedMediaAudio | null;
  extractedVocalAudioFileName: string | null;
  audioFilePlayer: HTMLAudioElement | null;
  audioFilePlaybackSource: MediaElementAudioSourceNode | null;
  audioFilePlaybackGain: GainNode | null;
  audioFileAnalysis: AudioFileAnalysis | null;
  isAnalyzingAudioFile: boolean;
  audioAnalysisMemoryTimerId: number | null;
  progressTimings: Map<string, number>;
  isAudioPlaybackDurationCompatible: boolean;
  audioPlaybackAnimationId: number | null;
  isDraggingAudioPlaybackCursor: boolean;
  pitchCanvasResizeObserver: ResizeObserver | null;
  pitchCanvasResizeHandler: (() => void) | null;
  audioRangeResizeObserver: ResizeObserver | null;
  audioRangeResizeHandler: (() => void) | null;
  gameEffects: GameEffectState;
};

type AudioPitchEstimator = "rmvpe" | "pitchy" | `crepe-${CrepeModelSize}`;

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

const DEFAULT_RANGE_START_MIDI = 48;
const GRAPH_SECONDS = 12;
const GRAPH_RANGE_SEMITONES = 6;
const MIN_CLARITY = 0.52;
const PITCHY_CLARITY_THRESHOLD = 0.93;
const MAX_REFERENCE_GAIN = 0.5;
const MOBILE_VIEWPORT_QUERY = "(max-width: 820px)";
const LANDING_RIPPLE_DURATION_MS = 850;
const MAX_LANDING_RIPPLES = 8;
const CREPE_MODEL_SIZES: CrepeModelSize[] = [
  "small",
  "medium",
  "large",
  "full",
];
const VOCAL_SEPARATION_COMPARISON_MODELS: VocalSeparationModelId[] = [
  "demucs",
  "bs-roformer-fp16",
];

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
  audioRangePixelRatio: 1,
  selectedAudioFile: null,
  selectedPlaybackAudioFile: null,
  useSeparatePlaybackAudio: false,
  useVocalExtraction: false,
  vocalSeparationModel: "demucs",
  audioPitchEstimator: "rmvpe",
  isCapturingCrepeComparison: false,
  isCapturingVocalSeparationComparison: false,
  isEncodingExtractedVocalDownload: false,
  audioPlaybackSource: "original",
  selectedPlaybackAudioFileUrl: null,
  extractedVocalAudioUrl: null,
  extractedVocalAudio: null,
  extractedVocalAudioFileName: null,
  audioFilePlayer: null,
  audioFilePlaybackSource: null,
  audioFilePlaybackGain: null,
  audioFileAnalysis: null,
  isAnalyzingAudioFile: false,
  audioAnalysisMemoryTimerId: null,
  progressTimings: new Map(),
  isAudioPlaybackDurationCompatible: true,
  audioPlaybackAnimationId: null,
  isDraggingAudioPlaybackCursor: false,
  pitchCanvasResizeObserver: null,
  pitchCanvasResizeHandler: null,
  audioRangeResizeObserver: null,
  audioRangeResizeHandler: null,
  gameEffects: createInitialGameEffectState(),
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
  graphTargetButtons: queryElement<HTMLDivElement>("#graphTargetButtons"),
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
  comboReadout: queryElement<HTMLElement>("#comboReadout"),
  durationReadout: queryElement<HTMLElement>("#durationReadout"),
  stableReadout: queryElement<HTMLElement>("#stableReadout"),
  averageReadout: queryElement<HTMLElement>("#averageReadout"),
  recentAverageReadout: queryElement<HTMLElement>("#recentAverageReadout"),
  appVersion: queryElement<HTMLElement>("#appVersion"),
  clearGraphButton: queryElement<HTMLButtonElement>("#clearGraphButton"),
  graphPanel: queryElement<HTMLElement>(".graph-panel"),
  pitchCanvas: queryElement<HTMLCanvasElement>("#pitchCanvas"),
  audioFileInput: queryElement<HTMLInputElement>("#audioFileInput"),
  playbackAudioFileInput: queryElement<HTMLInputElement>(
    "#playbackAudioFileInput",
  ),
  useSeparatePlaybackAudioInput: queryElement<HTMLInputElement>(
    "#useSeparatePlaybackAudioInput",
  ),
  useVocalExtractionInput: queryElement<HTMLInputElement>(
    "#useVocalExtractionInput",
  ),
  vocalSeparationModelSelect: queryElement<HTMLSelectElement>(
    "#vocalSeparationModelSelect",
  ),
  audioPitchEstimatorSelect: queryElement<HTMLSelectElement>(
    "#audioPitchEstimatorSelect",
  ),
  audioPlaybackSourceSelect: queryElement<HTMLSelectElement>(
    "#audioPlaybackSourceSelect",
  ),
  downloadExtractedVocalButton: queryElement<HTMLButtonElement>(
    "#downloadExtractedVocalButton",
  ),
  playAudioFileButton: queryElement<HTMLButtonElement>("#playAudioFileButton"),
  pauseAudioFileButton: queryElement<HTMLButtonElement>(
    "#pauseAudioFileButton",
  ),
  stopAudioFileButton: queryElement<HTMLButtonElement>("#stopAudioFileButton"),
  analyzeAudioFileButton: queryElement<HTMLButtonElement>(
    "#analyzeAudioFileButton",
  ),
  analyzeAudioFileButtonLabel: queryElement<HTMLElement>(
    "#analyzeAudioFileButtonLabel",
  ),
  captureCrepeComparisonButton: queryElement<HTMLButtonElement>(
    "#captureCrepeComparisonButton",
  ),
  captureVocalSeparationComparisonButton: queryElement<HTMLButtonElement>(
    "#captureVocalSeparationComparisonButton",
  ),
  audioFileStatus: queryElement<HTMLElement>("#audioFileStatus"),
  audioMemoryStatus: queryElement<HTMLElement>("#audioMemoryStatus"),
  audioPlaybackTime: queryElement<HTMLElement>("#audioPlaybackTime"),
  audioSeekButtons: [
    ...document.querySelectorAll<HTMLButtonElement>("[data-audio-seek]"),
  ],
  voiceRangeReadout: queryElement<HTMLElement>("#voiceRangeReadout"),
  commonVoiceRangeReadout: queryElement<HTMLElement>(
    "#commonVoiceRangeReadout",
  ),
  medianVoiceReadout: queryElement<HTMLElement>("#medianVoiceReadout"),
  voicedRatioReadout: queryElement<HTMLElement>("#voicedRatioReadout"),
  audioRangeDescription: queryElement<HTMLElement>("#audioRangeDescription"),
  audioRangeScroll: queryElement<HTMLElement>(".audio-range-scroll"),
  audioRangeAxisCanvas: queryElement<HTMLCanvasElement>(
    "#audioRangeAxisCanvas",
  ),
  audioRangeCanvas: queryElement<HTMLCanvasElement>("#audioRangeCanvas"),
};

const maybeCanvasContext = elements.pitchCanvas.getContext("2d");
const maybeAudioRangeAxisCanvasContext =
  elements.audioRangeAxisCanvas.getContext("2d");
const maybeAudioRangeCanvasContext = elements.audioRangeCanvas.getContext("2d");

if (!maybeCanvasContext) {
  throw new Error("Canvas 2D context is not available.");
}

if (!maybeAudioRangeCanvasContext) {
  throw new Error("Audio range canvas 2D context is not available.");
}

if (!maybeAudioRangeAxisCanvasContext) {
  throw new Error("Audio range axis canvas 2D context is not available.");
}

const canvasContext = maybeCanvasContext;
const audioRangeAxisCanvasContext = maybeAudioRangeAxisCanvasContext;
const audioRangeCanvasContext = maybeAudioRangeCanvasContext;
const AUDIO_RANGE_MIN_WIDTH = 960;
const AUDIO_RANGE_MAX_WIDTH = 28800;
const AUDIO_RANGE_PIXELS_PER_SECOND = 32;
const AUDIO_FILE_PLAYBACK_GAIN = 2;
const AUDIO_PLAYBACK_DURATION_TOLERANCE_SEC = 1;
const AUDIO_PLAYBACK_CURSOR_HIT_RADIUS_PX = 14;
const AUDIO_FILE_UNSUPPORTED_MESSAGE =
  "このブラウザでは音源ファイルの解析や再生ができません。別のブラウザで開いてください。";
const AUDIO_RANGE_GRAPH_PADDING: GraphPadding = {
  top: 28,
  right: 20,
  bottom: 34,
  left: 54,
};

function init() {
  updateBuildInfo();
  elements.vocalSeparationModelSelect.value = state.vocalSeparationModel;
  syncVocalSeparationModelOptions();
  renderNoteButtons();
  updateTargetDisplay();
  updateReferenceVolume();
  updateTolerance();
  updateSensitivity();
  setupPitchCanvas();
  setupAudioRangeCanvas();
  drawGraph();
  drawAudioRangeGraph();
  elements.clearGraphButton.addEventListener("click", clearSession);
  elements.audioFileInput.addEventListener("change", handleAudioFileSelection);
  elements.playbackAudioFileInput.addEventListener(
    "change",
    handlePlaybackAudioFileSelection,
  );
  elements.useSeparatePlaybackAudioInput.addEventListener(
    "change",
    handleUseSeparatePlaybackAudioChange,
  );
  elements.useVocalExtractionInput.addEventListener(
    "change",
    handleUseVocalExtractionChange,
  );
  elements.vocalSeparationModelSelect.addEventListener(
    "change",
    handleVocalSeparationModelChange,
  );
  elements.audioPitchEstimatorSelect.addEventListener(
    "change",
    handleAudioPitchEstimatorChange,
  );
  elements.audioPlaybackSourceSelect.addEventListener(
    "change",
    handleAudioPlaybackSourceChange,
  );
  elements.downloadExtractedVocalButton.addEventListener(
    "click",
    handleExtractedVocalDownload,
  );
  elements.playAudioFileButton.addEventListener(
    "click",
    handleAudioFilePlayback,
  );
  elements.pauseAudioFileButton.addEventListener(
    "click",
    pauseAudioFilePlayback,
  );
  elements.stopAudioFileButton.addEventListener("click", stopAudioFilePlayback);
  elements.audioSeekButtons.forEach((button) => {
    button.addEventListener("click", handleAudioSeekButtonClick);
  });
  elements.analyzeAudioFileButton.addEventListener(
    "click",
    handleAudioFileAnalysis,
  );
  elements.captureCrepeComparisonButton.addEventListener(
    "click",
    handleCrepeComparisonCapture,
  );
  elements.captureVocalSeparationComparisonButton.addEventListener(
    "click",
    handleVocalSeparationComparisonCapture,
  );
  window.addEventListener("pagehide", handlePageHide);
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

function updateBuildInfo() {
  const commitHash = import.meta.env.VITE_APP_COMMIT_HASH;
  const versionName = `v${import.meta.env.VITE_APP_VERSION}`;
  const commitSuffix = commitHash ? ` (${commitHash})` : "";

  elements.appVersion.textContent = `Version ${versionName}${commitSuffix}`;
  elements.appVersion.title = commitHash
    ? `build commit: ${commitHash}`
    : "build commit: unavailable";
}

function isAudioContextSupported(): boolean {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

function disableAudioControls() {
  elements.playToneButton.disabled = true;
  elements.playScaleButton.disabled = true;
  elements.micButton.disabled = true;
  elements.audioFileInput.disabled = true;
  elements.playbackAudioFileInput.disabled = true;
  elements.useSeparatePlaybackAudioInput.disabled = true;
  elements.useVocalExtractionInput.disabled = true;
  elements.vocalSeparationModelSelect.disabled = true;
  elements.audioPitchEstimatorSelect.disabled = true;
  elements.audioPlaybackSourceSelect.disabled = true;
  elements.downloadExtractedVocalButton.disabled = true;
  elements.analyzeAudioFileButton.disabled = true;
  elements.captureCrepeComparisonButton.disabled = true;
  elements.captureVocalSeparationComparisonButton.disabled = true;
  elements.playAudioFileButton.disabled = true;
  elements.pauseAudioFileButton.disabled = true;
  elements.stopAudioFileButton.disabled = true;
  elements.audioSeekButtons.forEach((button) => {
    button.disabled = true;
  });
  elements.analysisStatus.textContent =
    "このブラウザでは声の稽古を始められません。別のブラウザで開いてください。";
  elements.micDeviceStatus.textContent =
    "音声機能が使えないため、マイクを取得できません。";
  setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
}

function syncVocalSeparationModelOptions() {
  Array.from(elements.vocalSeparationModelSelect.options).forEach((option) => {
    const modelId = option.value as VocalSeparationModelId;
    const model = VOCAL_SEPARATION_MODELS[modelId];
    const isAvailable = model?.isAvailableInBuild ?? false;
    option.disabled = !isAvailable;
    option.hidden = !isAvailable;
  });

  state.vocalSeparationModel = resolveVocalSeparationModel(
    elements.vocalSeparationModelSelect.value,
  );
  elements.vocalSeparationModelSelect.value = state.vocalSeparationModel;
}

function showAudioError(error: unknown) {
  elements.analysisStatus.textContent =
    "声の稽古を開始できませんでした。ブラウザの音声設定を確認してください。";
  console.error(error);
}

function setAudioFileStatus(
  message: string,
  tone: "neutral" | "error" = "neutral",
) {
  elements.audioFileStatus.textContent = message;
  elements.audioFileStatus.classList.toggle("is-error", tone === "error");
}

function handleAudioFileSelection() {
  releaseAudioPitchEstimatorSessions();
  const file = elements.audioFileInput.files?.[0] ?? null;
  state.selectedAudioFile = file;
  state.audioFileAnalysis = null;
  state.isAudioPlaybackDurationCompatible = true;
  state.audioPlaybackSource = "original";
  elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
  cleanupExtractedVocalAudioUrl();
  resetAudioFileReadouts();

  if (!state.useSeparatePlaybackAudio) {
    resetAudioFilePlayerForSelectedSource();
  }

  if (!file) {
    setAudioFileStatus("音源や動画はブラウザ内だけで処理します。");
    updateAudioFileControls();
    drawAudioRangeGraph();
    return;
  }

  setAudioFileStatus(
    `解析用に ${file.name} を選択しました。動画の場合は音声トラックを取り出してから声域を推定します。`,
  );
  updateAudioFileControls();
  drawAudioRangeGraph();
}

function handlePlaybackAudioFileSelection() {
  const file = elements.playbackAudioFileInput.files?.[0] ?? null;
  state.selectedPlaybackAudioFile = file;
  state.isAudioPlaybackDurationCompatible = true;
  state.audioPlaybackSource = "original";
  elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;

  if (state.useSeparatePlaybackAudio) {
    resetAudioFilePlayerForSelectedSource();
  }

  if (!file) {
    updateAudioFileControls();
    updateAudioPlaybackReadout();
    drawAudioRangeGraph();
    return;
  }

  setAudioFileStatus(`再生用に ${file.name} を選択しました。`);
  updateAudioFileControls();
  updateAudioPlaybackReadout();
  drawAudioRangeGraph();
}

function handleUseSeparatePlaybackAudioChange() {
  state.useSeparatePlaybackAudio =
    elements.useSeparatePlaybackAudioInput.checked;
  state.isAudioPlaybackDurationCompatible = true;
  elements.playbackAudioFileInput.disabled =
    !isAudioContextSupported() || !state.useSeparatePlaybackAudio;
  resetAudioFilePlayerForSelectedSource();
  updateAudioFileControls();
  updateAudioPlaybackReadout();
  drawAudioRangeGraph();
}

function handleUseVocalExtractionChange() {
  state.useVocalExtraction = elements.useVocalExtractionInput.checked;
  state.audioFileAnalysis = null;
  state.audioPlaybackSource = "original";
  elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
  cleanupExtractedVocalAudioUrl();
  resetAudioFilePlayerForSelectedSource();
  resetAudioFileReadouts();
  updateAudioFileControls();
  drawAudioRangeGraph();

  if (state.useVocalExtraction) {
    const supportMessage = getVocalSeparationSupportMessage();
    const model = VOCAL_SEPARATION_MODELS[state.vocalSeparationModel];
    setAudioFileStatus(
      supportMessage ??
        `${model.label}でボーカル抽出します。モデルサイズは${model.sizeLabel}です。初回は時間がかかります。`,
    );
  } else if (state.selectedAudioFile) {
    setAudioFileStatus(
      `解析用に ${state.selectedAudioFile.name} を選択しました。解析ボタンで声域を推定します。`,
    );
  } else {
    setAudioFileStatus("音源や動画はブラウザ内だけで処理します。");
  }
}

function handleVocalSeparationModelChange() {
  state.vocalSeparationModel = resolveVocalSeparationModel(
    elements.vocalSeparationModelSelect.value,
  );
  state.audioFileAnalysis = null;
  state.audioPlaybackSource = "original";
  elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
  cleanupExtractedVocalAudioUrl();
  resetAudioFilePlayerForSelectedSource();
  resetAudioFileReadouts();
  updateAudioFileControls();
  drawAudioRangeGraph();

  const model = VOCAL_SEPARATION_MODELS[state.vocalSeparationModel];
  const supportMessage = state.useVocalExtraction
    ? getVocalSeparationSupportMessage()
    : null;

  setAudioFileStatus(
    supportMessage ??
      `${model.label}を選択しました。モデルサイズは${model.sizeLabel}です。${model.licenseNote}`,
  );
}

function handleAudioPitchEstimatorChange() {
  releaseAudioPitchEstimatorSessions();
  state.audioPitchEstimator = resolveAudioPitchEstimator(
    elements.audioPitchEstimatorSelect.value,
  );
  state.audioFileAnalysis = null;
  resetAudioFileReadouts();
  updateAudioFileControls();
  drawAudioRangeGraph();

  const crepeModelSize = getSelectedCrepeModelSize();

  if (crepeModelSize) {
    const supportMessage = getCrepePitchDetectionSupportMessage();
    setAudioFileStatus(
      supportMessage ??
        `CREPE ${formatCrepeModelSize(
          crepeModelSize,
        )} 推定を使います。解析ボタンで声域を推定します。`,
    );
  } else if (state.audioPitchEstimator === "rmvpe") {
    const supportMessage = getRmvpePitchDetectionSupportMessage();
    setAudioFileStatus(
      supportMessage ??
        "RMVPE推定を有効にしました。ONNXモデルをWebGPUで実行して声の高さを推定します。",
    );
  } else if (state.selectedAudioFile) {
    setAudioFileStatus(
      `解析用に ${state.selectedAudioFile.name} を選択しました。解析ボタンで声域を推定します。`,
    );
  } else {
    setAudioFileStatus("音源や動画はブラウザ内だけで処理します。");
  }
}

function handleAudioPlaybackSourceChange() {
  state.audioPlaybackSource =
    elements.audioPlaybackSourceSelect.value === "vocals"
      ? "vocals"
      : "original";
  state.isAudioPlaybackDurationCompatible = true;
  resetAudioFilePlayerForSelectedSource();
  updateAudioFileControls();
  updateAudioPlaybackReadout();
  drawAudioRangeGraph();
}

function resetAudioFilePlayerForSelectedSource() {
  cleanupAudioFilePlayer();
  const file = getSelectedOriginalAudioPlaybackFile();

  if (state.audioPlaybackSource === "vocals" && state.extractedVocalAudioUrl) {
    setupAudioFilePlayerFromUrl(state.extractedVocalAudioUrl);
  } else if (file) {
    setupAudioFilePlayer(file);
  }
}

async function handleAudioFilePlayback() {
  if (!isAudioContextSupported()) {
    setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
    updateAudioFileControls();
    return;
  }

  const selectedPlaybackFile = getSelectedOriginalAudioPlaybackFile();

  if (state.audioPlaybackSource === "original" && !selectedPlaybackFile) {
    return;
  }

  if (state.audioPlaybackSource === "vocals" && !state.extractedVocalAudioUrl) {
    return;
  }

  if (!hasPlayableAudioFileAnalysis()) {
    setAudioFileStatus(
      "音源を再生する前に、解析で歌声らしい音程を検出してください。",
      "error",
    );
    updateAudioFileControls();
    return;
  }

  if (!state.audioFilePlayer && state.audioPlaybackSource === "vocals") {
    resetAudioFilePlayerForSelectedSource();
  } else if (!state.audioFilePlayer && selectedPlaybackFile) {
    setupAudioFilePlayer(selectedPlaybackFile);
  }

  const player = state.audioFilePlayer;
  if (!player) {
    return;
  }

  if (!player.paused) {
    return;
  }

  if (!validateAudioPlaybackDuration()) {
    updateAudioFileControls();
    drawAudioRangeGraph();
    return;
  }

  try {
    await setupBoostedAudioFilePlayback(player);
    await player.play();
  } catch (error) {
    setAudioFileStatus(
      "音源を再生できませんでした。ブラウザの音声設定を確認してください。",
      "error",
    );
    console.error(error);
  }
}

function pauseAudioFilePlayback() {
  const player = state.audioFilePlayer;
  if (!player) {
    return;
  }

  player.pause();
  updateAudioPlaybackView();
  updateAudioFileControls();
}

function handleAudioSeekButtonClick(event: MouseEvent) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const seconds = Number(button.dataset.audioSeek);
  if (!Number.isFinite(seconds)) {
    return;
  }

  seekAudioPlayback(seconds);
}

function stopAudioFilePlayback() {
  const player = state.audioFilePlayer;
  if (!player) {
    return;
  }

  player.pause();
  player.currentTime = 0;
  elements.audioRangeScroll.scrollLeft = 0;
  updateAudioPlaybackView();
  updateAudioFileControls();
}

function seekAudioPlayback(offsetSec: number) {
  const player = state.audioFilePlayer;
  if (!player) {
    return;
  }

  const durationSec = getAudioPlaybackDurationSec();
  const maxTime = durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY;
  player.currentTime = Math.max(
    0,
    Math.min(maxTime, player.currentTime + offsetSec),
  );
  updateAudioPlaybackView();
}

function getSelectedOriginalAudioPlaybackFile(): File | null {
  return state.useSeparatePlaybackAudio
    ? state.selectedPlaybackAudioFile
    : state.selectedAudioFile;
}

function updateAudioFileControls() {
  const isAudioSupported = isAudioContextSupported();
  const isAudioBusy =
    state.isAnalyzingAudioFile ||
    state.isCapturingCrepeComparison ||
    state.isCapturingVocalSeparationComparison ||
    state.isEncodingExtractedVocalDownload;
  const selectedPlaybackFile = getSelectedOriginalAudioPlaybackFile();
  const hasPlayableAnalysis = hasPlayableAudioFileAnalysis();
  const hasSelectedPlaybackSource =
    state.audioPlaybackSource === "vocals"
      ? Boolean(state.extractedVocalAudioUrl)
      : Boolean(selectedPlaybackFile);
  const canUsePlayback =
    isAudioSupported &&
    hasSelectedPlaybackSource &&
    hasPlayableAnalysis &&
    state.isAudioPlaybackDurationCompatible;

  elements.useSeparatePlaybackAudioInput.disabled =
    !isAudioSupported || isAudioBusy;
  elements.playbackAudioFileInput.disabled =
    !isAudioSupported || !state.useSeparatePlaybackAudio || isAudioBusy;
  elements.useVocalExtractionInput.disabled = !isAudioSupported || isAudioBusy;
  elements.vocalSeparationModelSelect.disabled =
    !isAudioSupported || !state.useVocalExtraction || isAudioBusy;
  elements.audioPitchEstimatorSelect.disabled =
    !isAudioSupported || isAudioBusy;
  updateAudioPlaybackSourceControl(isAudioSupported);
  elements.analyzeAudioFileButton.disabled =
    !isAudioSupported || !state.selectedAudioFile || isAudioBusy;
  elements.analyzeAudioFileButton.classList.toggle(
    "is-loading",
    state.isAnalyzingAudioFile,
  );
  elements.analyzeAudioFileButton.setAttribute(
    "aria-busy",
    String(state.isAnalyzingAudioFile),
  );
  elements.analyzeAudioFileButtonLabel.textContent = state.isAnalyzingAudioFile
    ? "解析中"
    : "解析";
  elements.captureCrepeComparisonButton.disabled =
    !isAudioSupported || !state.selectedAudioFile || isAudioBusy;
  elements.captureVocalSeparationComparisonButton.disabled =
    !isAudioSupported || !state.selectedAudioFile || isAudioBusy;
  elements.downloadExtractedVocalButton.disabled =
    !isAudioSupported || !state.extractedVocalAudio || isAudioBusy;
  const isPlaying = Boolean(
    state.audioFilePlayer && !state.audioFilePlayer.paused,
  );
  elements.playAudioFileButton.disabled = !canUsePlayback || isPlaying;
  elements.pauseAudioFileButton.disabled =
    !canUsePlayback || !state.audioFilePlayer || !isPlaying;
  elements.stopAudioFileButton.disabled =
    !canUsePlayback || !state.audioFilePlayer;
  elements.audioSeekButtons.forEach((button) => {
    button.disabled = !canUsePlayback || !state.audioFilePlayer;
  });
}

function updateAudioPlaybackSourceControl(isAudioSupported: boolean) {
  const vocalOption = elements.audioPlaybackSourceSelect.querySelector(
    'option[value="vocals"]',
  );

  if (vocalOption instanceof HTMLOptionElement) {
    vocalOption.disabled = !state.extractedVocalAudioUrl;
  }

  if (!state.extractedVocalAudioUrl && state.audioPlaybackSource === "vocals") {
    state.audioPlaybackSource = "original";
    elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
  }

  elements.audioPlaybackSourceSelect.disabled =
    !isAudioSupported ||
    !state.extractedVocalAudioUrl ||
    state.isAnalyzingAudioFile ||
    state.isCapturingCrepeComparison ||
    state.isCapturingVocalSeparationComparison;
}

function hasPlayableAudioFileAnalysis(): boolean {
  return (state.audioFileAnalysis?.summary.validFrames ?? 0) > 0;
}

function setupAudioFilePlayer(file: File) {
  const url = URL.createObjectURL(file);
  setupAudioFilePlayerFromUrl(url);
  state.selectedPlaybackAudioFileUrl = url;
}

function setupAudioFilePlayerFromUrl(url: string) {
  const player = new Audio(url);
  player.preload = "metadata";
  player.volume = 1;

  state.audioFilePlayer = player;

  player.addEventListener("loadedmetadata", () => {
    validateAudioPlaybackDuration();
    updateAudioRangeCanvasWidth();
    updateAudioPlaybackReadout();
    updateAudioFileControls();
    drawAudioRangeGraph();
  });
  player.addEventListener("play", () => {
    updateAudioFileControls();
    startAudioPlaybackTracking();
  });
  player.addEventListener("pause", () => {
    updateAudioFileControls();
    stopAudioPlaybackTracking();
    updateAudioPlaybackView();
  });
  player.addEventListener("ended", () => {
    updateAudioFileControls();
    stopAudioPlaybackTracking();
    updateAudioPlaybackView();
  });
  player.addEventListener("timeupdate", updateAudioPlaybackView);
}

async function setupBoostedAudioFilePlayback(player: HTMLAudioElement) {
  if (!isAudioContextSupported()) {
    throw new Error("AudioContext is not available.");
  }

  const audioContext = getAudioContext();

  if (!state.audioFilePlaybackSource || !state.audioFilePlaybackGain) {
    const source = audioContext.createMediaElementSource(player);
    const gain = audioContext.createGain();
    gain.gain.value = AUDIO_FILE_PLAYBACK_GAIN;
    source.connect(gain);
    gain.connect(audioContext.destination);

    state.audioFilePlaybackSource = source;
    state.audioFilePlaybackGain = gain;
  } else {
    state.audioFilePlaybackGain.gain.value = AUDIO_FILE_PLAYBACK_GAIN;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function cleanupAudioFilePlayer() {
  stopAudioPlaybackTracking();

  state.audioFilePlaybackSource?.disconnect();
  state.audioFilePlaybackGain?.disconnect();
  state.audioFilePlaybackSource = null;
  state.audioFilePlaybackGain = null;

  if (state.audioFilePlayer) {
    state.audioFilePlayer.pause();
    state.audioFilePlayer.removeAttribute("src");
    state.audioFilePlayer.load();
  }

  if (state.selectedPlaybackAudioFileUrl) {
    URL.revokeObjectURL(state.selectedPlaybackAudioFileUrl);
  }

  state.selectedPlaybackAudioFileUrl = null;
  state.audioFilePlayer = null;
}

function cleanupExtractedVocalAudioUrl() {
  const extractedVocalAudioUrl = state.extractedVocalAudioUrl;

  if (!extractedVocalAudioUrl) {
    return;
  }

  const isPlayingExtractedVocals =
    state.audioPlaybackSource === "vocals" ||
    state.audioFilePlayer?.src === extractedVocalAudioUrl;

  if (isPlayingExtractedVocals) {
    cleanupAudioFilePlayer();
    state.audioPlaybackSource = "original";
    elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
  }

  URL.revokeObjectURL(extractedVocalAudioUrl);
  state.extractedVocalAudioUrl = null;
  state.extractedVocalAudio = null;
  state.extractedVocalAudioFileName = null;
}

function startAudioPlaybackTracking() {
  if (state.audioPlaybackAnimationId !== null) {
    return;
  }

  const tick = () => {
    updateAudioPlaybackView();
    state.audioPlaybackAnimationId = requestAnimationFrame(tick);
  };

  state.audioPlaybackAnimationId = requestAnimationFrame(tick);
}

function stopAudioPlaybackTracking() {
  if (state.audioPlaybackAnimationId === null) {
    return;
  }

  cancelAnimationFrame(state.audioPlaybackAnimationId);
  state.audioPlaybackAnimationId = null;
}

function updateAudioPlaybackView() {
  updateAudioPlaybackReadout();
  scrollAudioRangeToPlayback();
  drawAudioRangeGraph();
}

function updateAudioPlaybackReadout() {
  const currentTime = getAudioPlaybackTimeSec();
  const duration = getAudioPlaybackDurationSec();

  elements.audioPlaybackTime.textContent = `${formatClockTime(
    currentTime,
  )} / ${formatClockTime(duration)}`;
}

function validateAudioPlaybackDuration(): boolean {
  state.isAudioPlaybackDurationCompatible = true;

  if (!state.useSeparatePlaybackAudio || !hasPlayableAudioFileAnalysis()) {
    return true;
  }

  const analysisDuration = state.audioFileAnalysis?.summary.durationSec;
  const playbackDuration = getAudioPlaybackDurationSec();

  if (
    analysisDuration === undefined ||
    !Number.isFinite(analysisDuration) ||
    playbackDuration <= 0
  ) {
    return true;
  }

  const difference = Math.abs(analysisDuration - playbackDuration);
  const isCompatible = difference <= AUDIO_PLAYBACK_DURATION_TOLERANCE_SEC;
  state.isAudioPlaybackDurationCompatible = isCompatible;

  if (!isCompatible) {
    const player = state.audioFilePlayer;
    if (player && !player.paused) {
      player.pause();
    }

    setAudioFileStatus(
      `解析用音源（${formatDuration(
        analysisDuration,
      )}）と再生用音源（${formatDuration(
        playbackDuration,
      )}）の長さが異なります。同じ長さの音源を選んでください。`,
      "error",
    );
  }

  return isCompatible;
}

function scrollAudioRangeToPlayback() {
  const player = state.audioFilePlayer;
  const durationSec = getAudioPlaybackDurationSec();

  if (!player || player.paused || durationSec <= 0) {
    return;
  }

  const canvasWidth = elements.audioRangeCanvas.clientWidth;
  const x = (player.currentTime / durationSec) * canvasWidth;
  const viewportWidth = elements.audioRangeScroll.clientWidth;
  const desiredLeft = x - viewportWidth * 0.45;

  elements.audioRangeScroll.scrollLeft = Math.max(0, desiredLeft);
}

async function handleAudioFileAnalysis() {
  if (
    !state.selectedAudioFile ||
    state.isAnalyzingAudioFile ||
    state.isCapturingCrepeComparison ||
    state.isCapturingVocalSeparationComparison
  ) {
    return;
  }

  if (!isAudioContextSupported()) {
    setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
    updateAudioFileControls();
    return;
  }

  if (state.useVocalExtraction) {
    try {
      await assertVocalSeparationSupported();
    } catch (error) {
      setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
      updateAudioFileControls();
      return;
    }
  }

  if (getSelectedCrepeModelSize()) {
    const supportMessage = getCrepePitchDetectionSupportMessage();

    if (supportMessage) {
      setAudioFileStatus(supportMessage, "error");
      updateAudioFileControls();
      return;
    }
  }

  if (state.audioPitchEstimator === "rmvpe") {
    const supportMessage = getRmvpePitchDetectionSupportMessage();

    if (supportMessage) {
      setAudioFileStatus(supportMessage, "error");
      updateAudioFileControls();
      return;
    }
  }

  state.isAnalyzingAudioFile = true;
  clearProgressTimings();
  startAudioAnalysisMemoryTracking();
  updateAudioFileControls();
  elements.audioFileInput.disabled = true;
  setAudioFileStatus("モデルファイルにアクセスできるか確認しています。");

  try {
    await waitForPaint();
    await preflightSelectedAnalysisModels();
    setAudioFileStatus(
      "音源を読み込んでいます。長い曲では少し時間がかかります。",
    );
    await waitForPaint();
    const decodedAudio = await prepareDecodedAudioForAnalysis(
      state.selectedAudioFile,
    );
    const monoData = mixChannelsToMono(decodedAudio.channels);

    setAudioFileStatus(
      "声の高さを推定しています。画面はこのままにしてください。",
    );
    await waitForPaint();

    state.audioFileAnalysis = await analyzeAudioDataWithSelectedEstimator(
      monoData,
      decodedAudio.sampleRate,
    );
    updateAudioFileReadouts(state.audioFileAnalysis);
    validateAudioPlaybackDuration();
    drawAudioRangeGraph();
  } catch (error) {
    state.audioFileAnalysis = null;
    cleanupExtractedVocalAudioUrl();
    resetAudioFileReadouts();
    drawAudioRangeGraph();
    setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
    console.error(error);
  } finally {
    state.isAnalyzingAudioFile = false;
    clearProgressTimings();
    releaseAudioPitchEstimatorSessions();
    stopAudioAnalysisMemoryTracking();
    elements.audioFileInput.disabled = false;
    updateAudioFileControls();
  }
}

async function preflightSelectedAnalysisModels() {
  if (state.useVocalExtraction) {
    state.vocalSeparationModel = resolveVocalSeparationModel(
      elements.vocalSeparationModelSelect.value,
    );
    elements.vocalSeparationModelSelect.value = state.vocalSeparationModel;
    await assertVocalSeparationModelAccessible(state.vocalSeparationModel);
  }

  const crepeModelSize = getSelectedCrepeModelSize();
  if (crepeModelSize) {
    await assertCrepeModelAccessible(crepeModelSize);
    return;
  }

  if (state.audioPitchEstimator === "rmvpe") {
    await assertRmvpeModelAccessible();
  }
}

async function prepareDecodedAudioForAnalysis(
  file: File,
): Promise<DecodedMediaAudio> {
  const audioContext = getAudioContext();
  let decodedAudio = await decodeMediaAudio(file, audioContext);

  if (state.useVocalExtraction) {
    cleanupExtractedVocalAudioUrl();
    state.vocalSeparationModel = resolveVocalSeparationModel(
      elements.vocalSeparationModelSelect.value,
    );
    decodedAudio = await extractVocals(decodedAudio, {
      modelId: state.vocalSeparationModel,
      onProgress: updateVocalExtractionProgress,
    });
    state.extractedVocalAudio = decodedAudio;
    state.extractedVocalAudioFileName = createExtractedVocalFileName(
      state.vocalSeparationModel,
    );
    state.extractedVocalAudioUrl = URL.createObjectURL(
      createWavBlobFromDecodedAudio(decodedAudio),
    );
    state.audioPlaybackSource = "vocals";
    elements.audioPlaybackSourceSelect.value = state.audioPlaybackSource;
    resetAudioFilePlayerForSelectedSource();
    return decodedAudio;
  }

  cleanupExtractedVocalAudioUrl();
  return decodedAudio;
}

async function analyzeAudioDataWithSelectedEstimator(
  monoData: Float32Array,
  sampleRate: number,
): Promise<AudioFileAnalysis> {
  const crepeModelSize = getSelectedCrepeModelSize();

  if (crepeModelSize) {
    return analyzeAudioDataWithCrepe(monoData, {
      sampleRate,
      modelUrl: getCrepeModelUrl(crepeModelSize),
      onProgress: updateCrepeAnalysisProgress,
    });
  }

  if (state.audioPitchEstimator === "rmvpe") {
    return analyzeAudioDataWithRmvpe(monoData, {
      sampleRate,
      onProgress: updateRmvpeAnalysisProgress,
    });
  }

  return analyzeAudioData(monoData, { sampleRate });
}

function releaseAudioPitchEstimatorSessions() {
  void releaseCrepeSessions();
  void releaseRmvpeSession();
}

async function handleCrepeComparisonCapture() {
  if (
    !state.selectedAudioFile ||
    state.isAnalyzingAudioFile ||
    state.isCapturingCrepeComparison ||
    state.isCapturingVocalSeparationComparison
  ) {
    return;
  }

  if (!isAudioContextSupported()) {
    setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
    updateAudioFileControls();
    return;
  }

  const supportMessage = getCrepePitchDetectionSupportMessage();

  if (supportMessage) {
    setAudioFileStatus(supportMessage, "error");
    updateAudioFileControls();
    return;
  }

  const rmvpeSupportMessage = getRmvpePitchDetectionSupportMessage();

  if (rmvpeSupportMessage) {
    setAudioFileStatus(rmvpeSupportMessage, "error");
    updateAudioFileControls();
    return;
  }

  if (state.useVocalExtraction) {
    try {
      await assertVocalSeparationSupported();
    } catch (error) {
      setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
      updateAudioFileControls();
      return;
    }
  }

  state.isCapturingCrepeComparison = true;
  clearProgressTimings();
  startAudioAnalysisMemoryTracking();
  updateAudioFileControls();
  setAudioFileStatus("ピッチ推定モデル比較PNG用に音源を読み込んでいます。");
  const originalAudioPitchEstimator = state.audioPitchEstimator;
  const originalAudioFileAnalysis = state.audioFileAnalysis;
  const originalAudioPlaybackDurationCompatible =
    state.isAudioPlaybackDurationCompatible;
  let shouldRestoreOriginalAnalysis = false;

  try {
    await waitForPaint();
    const decodedAudio = await prepareDecodedAudioForAnalysis(
      state.selectedAudioFile,
    );
    const monoData = mixChannelsToMono(decodedAudio.channels);

    const captures: {
      label: string;
      canvas: HTMLCanvasElement;
    }[] = [];

    setAudioFileStatus("既存のpitchy解析で比較用グラフを作成しています。");
    await waitForPaint();
    state.audioFileAnalysis = analyzeAudioData(monoData, {
      sampleRate: decodedAudio.sampleRate,
    });
    updateAudioFileReadouts(state.audioFileAnalysis);
    validateAudioPlaybackDuration();
    drawAudioRangeGraph();
    await waitForPaint();
    captures.push({
      label: "pitchy",
      canvas: cloneAudioRangeGraphCanvas(),
    });

    for (const modelSize of CREPE_MODEL_SIZES) {
      state.audioPitchEstimator = `crepe-${modelSize}`;
      elements.audioPitchEstimatorSelect.value = state.audioPitchEstimator;
      setAudioFileStatus(
        `CREPE ${formatCrepeModelSize(
          modelSize,
        )} モデルで比較用グラフを作成しています。`,
      );
      await waitForPaint();

      state.audioFileAnalysis = await analyzeAudioDataWithCrepe(monoData, {
        sampleRate: decodedAudio.sampleRate,
        modelUrl: getCrepeModelUrl(modelSize),
        onProgress: updateCrepeAnalysisProgress,
      });
      updateAudioFileReadouts(state.audioFileAnalysis);
      validateAudioPlaybackDuration();
      drawAudioRangeGraph();
      await waitForPaint();
      captures.push({
        label: `CREPE ${formatCrepeModelSize(modelSize)}`,
        canvas: cloneAudioRangeGraphCanvas(),
      });
    }

    setAudioFileStatus("RMVPEモデルで比較用グラフを作成しています。");
    await waitForPaint();
    state.audioPitchEstimator = "rmvpe";
    elements.audioPitchEstimatorSelect.value = state.audioPitchEstimator;
    state.audioFileAnalysis = await analyzeAudioDataWithRmvpe(monoData, {
      sampleRate: decodedAudio.sampleRate,
      onProgress: updateRmvpeAnalysisProgress,
    });
    updateAudioFileReadouts(state.audioFileAnalysis);
    validateAudioPlaybackDuration();
    drawAudioRangeGraph();
    await waitForPaint();
    captures.push({
      label: "RMVPE",
      canvas: cloneAudioRangeGraphCanvas(),
    });

    await downloadCombinedCrepeComparisonPng(captures);
    shouldRestoreOriginalAnalysis = true;
    setAudioFileStatus(
      "ピッチ推定モデル比較PNGを作成しました。ダウンロード結果を確認してください。",
    );
  } catch (error) {
    state.audioFileAnalysis = null;
    resetAudioFileReadouts();
    drawAudioRangeGraph();
    setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
    console.error(error);
  } finally {
    state.audioPitchEstimator = originalAudioPitchEstimator;
    elements.audioPitchEstimatorSelect.value = originalAudioPitchEstimator;
    if (shouldRestoreOriginalAnalysis) {
      state.audioFileAnalysis = originalAudioFileAnalysis;
      state.isAudioPlaybackDurationCompatible =
        originalAudioPlaybackDurationCompatible;

      if (originalAudioFileAnalysis) {
        updateAudioFileReadouts(originalAudioFileAnalysis);
      } else {
        resetAudioFileReadouts();
      }

      drawAudioRangeGraph();
    }
    state.isCapturingCrepeComparison = false;
    clearProgressTimings();
    void releaseCrepeSessions();
    void releaseRmvpeSession();
    stopAudioAnalysisMemoryTracking();
    updateAudioFileControls();
  }
}

async function handleExtractedVocalDownload() {
  if (!state.extractedVocalAudio) {
    setAudioFileStatus(
      "保存できる抽出ボーカルがまだありません。ボーカル抽出を有効にして解析してください。",
      "error",
    );
    updateAudioFileControls();
    return;
  }

  const fileName =
    state.extractedVocalAudioFileName ?? createExtractedVocalFileName();

  try {
    state.isEncodingExtractedVocalDownload = true;
    setAudioFileStatus("抽出ボーカルMP3を作成しています。");
    updateAudioFileControls();
    await waitForPaint();
    const blob = await createMp3BlobFromDecodedAudio(state.extractedVocalAudio);
    downloadBlob(blob, fileName);
    setAudioFileStatus(
      "抽出ボーカルMP3を保存しました。ブラウザのダウンロード結果を確認してください。",
    );
  } catch (error) {
    setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
    console.error(error);
  } finally {
    state.isEncodingExtractedVocalDownload = false;
    updateAudioFileControls();
  }
}

async function handleVocalSeparationComparisonCapture() {
  if (
    !state.selectedAudioFile ||
    state.isAnalyzingAudioFile ||
    state.isCapturingCrepeComparison ||
    state.isCapturingVocalSeparationComparison
  ) {
    return;
  }

  if (!isAudioContextSupported()) {
    setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
    updateAudioFileControls();
    return;
  }

  try {
    await assertVocalSeparationSupported();
  } catch (error) {
    setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
    updateAudioFileControls();
    return;
  }

  state.isCapturingVocalSeparationComparison = true;
  clearProgressTimings();
  startAudioAnalysisMemoryTracking();
  updateAudioFileControls();
  setAudioFileStatus("全ボーカル抽出モデル出力用に音源を読み込んでいます。");

  try {
    await waitForPaint();
    const audioContext = getAudioContext();
    const decodedAudio = await decodeMediaAudio(
      state.selectedAudioFile,
      audioContext,
    );
    const failures: string[] = [];

    const comparisonModels = VOCAL_SEPARATION_COMPARISON_MODELS.filter(
      (modelId) => VOCAL_SEPARATION_MODELS[modelId].isAvailableInBuild,
    );

    for (const modelId of comparisonModels) {
      const model = VOCAL_SEPARATION_MODELS[modelId];
      setAudioFileStatus(`${model.label}でボーカル抽出MP3を作成しています。`);
      await waitForPaint();

      try {
        const extractedAudio = await extractVocals(decodedAudio, {
          modelId,
          onProgress: updateVocalExtractionProgress,
        });
        setAudioFileStatus(
          `${model.label}の抽出ボーカルをMP3に変換しています。`,
        );
        await waitForPaint();
        const blob = await createMp3BlobFromDecodedAudio(extractedAudio);
        downloadBlob(
          blob,
          `${createAudioFileBaseName()}-${createVocalModelFileNameSegment(
            modelId,
          )}-vocals.mp3`,
        );
      } catch (error) {
        failures.push(model.label);
        console.error(`${model.label} vocal separation failed.`, error);
      }
    }

    setAudioFileStatus(
      failures.length > 0
        ? `ボーカル抽出MP3出力が完了しました。一部失敗: ${failures.join("、")}`
        : "全ボーカル抽出モデルのMP3を出力しました。ダウンロード結果を確認してください。",
    );
  } catch (error) {
    setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
    console.error(error);
  } finally {
    state.isCapturingVocalSeparationComparison = false;
    clearProgressTimings();
    stopAudioAnalysisMemoryTracking();
    updateAudioFileControls();
  }
}

function updateAudioFileReadouts(analysis: AudioFileAnalysis) {
  const { summary } = analysis;
  const coverage = getVoiceCoverage(summary);
  const robustRange = formatMidiRange(
    summary.robustLowestMidi,
    summary.robustHighestMidi,
  );
  const commonRange = formatMidiRange(
    summary.commonLowestMidi,
    summary.commonHighestMidi,
  );
  const median = formatMidiRange(summary.medianMidi, summary.medianMidi);

  elements.voiceRangeReadout.textContent = robustRange;
  elements.commonVoiceRangeReadout.textContent = commonRange;
  elements.medianVoiceReadout.textContent =
    summary.medianMidi === null ? "--" : median.split(" - ")[0] || median;
  elements.voicedRatioReadout.textContent = `${Math.round(coverage * 100)}%`;

  if (summary.validFrames === 0) {
    setAudioFileStatus(
      "歌声らしい音程を検出できませんでした。伴奏が強い音源や無音区間が多い音源では推定できないことがあります。",
    );
    elements.audioRangeDescription.textContent =
      "音源から歌声らしい音程を検出できませんでした。";
    return;
  }

  setAudioFileStatus(
    `解析完了: ${formatDuration(summary.durationSec)} の音源から ${formatDuration(
      summary.voicedSec,
    )} 分の歌声らしい音程を検出しました。`,
  );
  elements.audioRangeDescription.textContent = `推定声域は ${robustRange}、よく出る範囲は ${commonRange}、中心付近は ${elements.medianVoiceReadout.textContent} です。`;
}

function resetAudioFileReadouts() {
  elements.voiceRangeReadout.textContent = "--";
  elements.commonVoiceRangeReadout.textContent = "--";
  elements.medianVoiceReadout.textContent = "--";
  elements.voicedRatioReadout.textContent = "--";
  elements.audioRangeDescription.textContent =
    "音源の声域推定はまだ実行されていません。";
}

function clearProgressTimings() {
  state.progressTimings.clear();
}

function formatProgressTiming(
  key: string,
  completedUnits: number,
  totalUnits: number,
): string {
  const total = Math.max(0, totalUnits);
  if (total <= 0) {
    return formatElapsedProgress(key);
  }

  const completed = clamp(completedUnits, 0, total);
  const elapsedSec = getProgressElapsedSec(key);
  const parts = [
    formatPercent(completed / total),
    `経過 ${formatProgressDuration(elapsedSec)}`,
  ];

  if (completed > 0 && completed < total) {
    const remainingSec = (elapsedSec / completed) * (total - completed);
    parts.push(`残り 約${formatProgressDuration(remainingSec)}`);
  } else if (completed >= total) {
    parts.push("残り 0秒");
  }

  return parts.join(" / ");
}

function formatElapsedProgress(key: string): string {
  return `経過 ${formatProgressDuration(getProgressElapsedSec(key))}`;
}

function getProgressElapsedSec(key: string): number {
  const startedAt = state.progressTimings.get(key) ?? performance.now();
  if (!state.progressTimings.has(key)) {
    state.progressTimings.set(key, startedAt);
  }

  return Math.max(0, (performance.now() - startedAt) / 1000);
}

function formatProgressDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0秒";
  }

  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) {
    return `${roundedSeconds}秒`;
  }

  const minutes = Math.floor(roundedSeconds / 60);
  const secondsPart = roundedSeconds % 60;
  if (minutes < 60) {
    return `${minutes}分${secondsPart}秒`;
  }

  const hours = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${hours}時間${String(minutesPart).padStart(2, "0")}分`;
}

function updateVocalExtractionProgress(progress: VocalSeparationProgress) {
  updateAudioMemoryStatus();
  const modelLabel = progress.modelLabel ?? "ボーカル抽出モデル";

  if (progress.phase === "loading-runtime") {
    setAudioFileStatus("ボーカル抽出の実行環境を読み込んでいます。");
    return;
  }

  if (progress.phase === "loading-model") {
    const progressKey = `vocal:${modelLabel}:loading-model`;
    setAudioFileStatus(
      progress.loadedBytes !== undefined && progress.totalBytes !== undefined
        ? `${modelLabel}を読み込んでいます。${formatBytes(
            progress.loadedBytes,
          )} / ${formatBytes(progress.totalBytes)}（${formatProgressTiming(
            progressKey,
            progress.loadedBytes,
            progress.totalBytes,
          )}）`
        : `${modelLabel}を読み込んでいます。初回は時間がかかります。（${formatElapsedProgress(progressKey)}）`,
    );
    return;
  }

  const progressKey = `vocal:${modelLabel}:separating`;
  setAudioFileStatus(
    progress.currentSegment !== undefined &&
      progress.totalSegments !== undefined
      ? `${modelLabel}でボーカルを抽出しています。${progress.currentSegment} / ${progress.totalSegments} Chunks（${formatProgressTiming(
          progressKey,
          progress.currentSegment,
          progress.totalSegments,
        )}）`
      : `${modelLabel}でボーカルを抽出しています。${formatProgressTiming(
          progressKey,
          progress.progress ?? 0,
          1,
        )}`,
  );
}

function updateCrepeAnalysisProgress(progress: CrepeAnalysisProgress) {
  updateAudioMemoryStatus();

  if (progress.phase === "loading-runtime") {
    setAudioFileStatus("CREPE推定の実行環境を読み込んでいます。");
    return;
  }

  if (progress.phase === "loading-model") {
    const crepeModelSize = getSelectedCrepeModelSize() ?? "small";
    setAudioFileStatus(
      `CREPE ${formatCrepeModelSize(
        crepeModelSize,
      )} モデルを読み込んでいます。初回は時間がかかります。（${formatElapsedProgress(
        `crepe:${crepeModelSize}:loading-model`,
      )}）`,
    );
    return;
  }

  const crepeModelSize = getSelectedCrepeModelSize() ?? "small";
  const progressKey = `crepe:${crepeModelSize}:analyzing`;
  setAudioFileStatus(
    progress.processedFrames !== undefined &&
      progress.totalFrames !== undefined &&
      progress.totalFrames > 0
      ? `CREPEで声の高さを推定しています。${progress.processedFrames} / ${progress.totalFrames} フレーム（${formatProgressTiming(
          progressKey,
          progress.processedFrames,
          progress.totalFrames,
        )}）`
      : "CREPEで声の高さを推定しています。",
  );
}

function updateRmvpeAnalysisProgress(progress: RmvpeAnalysisProgress) {
  updateAudioMemoryStatus();

  if (progress.phase === "loading-runtime") {
    setAudioFileStatus("RMVPE推定の実行環境を読み込んでいます。");
    return;
  }

  if (progress.phase === "loading-model") {
    setAudioFileStatus(
      `RMVPEのONNXモデルを読み込んでいます。初回は時間がかかります。（${formatElapsedProgress(
        "rmvpe:loading-model",
      )}）`,
    );
    return;
  }

  if (progress.phase === "extracting-features") {
    const progressKey = "rmvpe:extracting-features";
    setAudioFileStatus(
      progress.processedFrames !== undefined &&
        progress.totalFrames !== undefined &&
        progress.totalFrames > 0
        ? `RMVPE用の特徴量を作成しています。${progress.processedFrames} / ${progress.totalFrames} フレーム（${formatProgressTiming(
            progressKey,
            progress.processedFrames,
            progress.totalFrames,
          )}）`
        : "RMVPE用の特徴量を作成しています。",
    );
    return;
  }

  const progressKey = "rmvpe:analyzing";
  setAudioFileStatus(
    progress.processedFrames !== undefined &&
      progress.totalFrames !== undefined &&
      progress.totalFrames > 0
      ? `RMVPEで声の高さを推定しています。${progress.processedFrames} / ${progress.totalFrames} フレーム（${formatProgressTiming(
          progressKey,
          progress.processedFrames,
          progress.totalFrames,
        )}）`
      : "RMVPEで声の高さを推定しています。",
  );
}

function formatCrepeModelSize(modelSize: CrepeModelSize): string {
  return modelSize;
}

async function downloadCombinedCrepeComparisonPng(
  captures: {
    label: string;
    canvas: HTMLCanvasElement;
  }[],
) {
  const combinedCanvas = createCombinedCrepeComparisonCanvas(captures);
  const blob = await createCanvasPngBlob(combinedCanvas);
  downloadBlob(blob, `${createAudioFileBaseName()}-crepe-comparison.png`);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createVocalModelFileNameSegment(
  modelId: VocalSeparationModelId,
): string {
  return modelId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createExtractedVocalFileName(modelId = state.vocalSeparationModel) {
  return `${createAudioFileBaseName()}-${createVocalModelFileNameSegment(
    modelId,
  )}-vocals.mp3`;
}

function cloneAudioRangeGraphCanvas(): HTMLCanvasElement {
  const source = elements.audioRangeCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("比較用グラフを作成できませんでした。");
  }

  context.drawImage(source, 0, 0);
  return canvas;
}

function createCombinedCrepeComparisonCanvas(
  captures: {
    label: string;
    canvas: HTMLCanvasElement;
  }[],
): HTMLCanvasElement {
  if (captures.length === 0) {
    throw new Error("比較用グラフを作成できませんでした。");
  }

  const titleHeight = 52;
  const width = Math.max(...captures.map((capture) => capture.canvas.width));
  const height = captures.reduce(
    (total, capture) => total + titleHeight + capture.canvas.height,
    0,
  );
  const combinedCanvas = document.createElement("canvas");
  combinedCanvas.width = width;
  combinedCanvas.height = height;

  const context = combinedCanvas.getContext("2d");
  if (!context) {
    throw new Error("比較用グラフを作成できませんでした。");
  }

  context.fillStyle = "#f7faf8";
  context.fillRect(0, 0, width, height);

  let y = 0;
  for (const capture of captures) {
    context.fillStyle = "#172026";
    context.font = `${Math.round(18 * state.audioRangePixelRatio)}px system-ui, sans-serif`;
    context.fillText(
      capture.label,
      Math.round(18 * state.audioRangePixelRatio),
      y + Math.round(32 * state.audioRangePixelRatio),
    );
    y += titleHeight;
    context.drawImage(capture.canvas, 0, y);
    y += capture.canvas.height;
  }

  return combinedCanvas;
}

function createCanvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("グラフPNGを作成できませんでした。"));
    }, "image/png");
  });
}

function createAudioFileBaseName(): string {
  const fileName = state.selectedAudioFile?.name ?? "audio";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const safeName = withoutExtension
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeName || "audio";
}

function resolveAudioPitchEstimator(value: string): AudioPitchEstimator {
  if (
    value === "rmvpe" ||
    value === "pitchy" ||
    value === "crepe-small" ||
    value === "crepe-medium" ||
    value === "crepe-large" ||
    value === "crepe-full"
  ) {
    return value;
  }

  return "rmvpe";
}

function resolveVocalSeparationModel(value: string): VocalSeparationModelId {
  if (
    value in VOCAL_SEPARATION_MODELS &&
    VOCAL_SEPARATION_MODELS[value as VocalSeparationModelId].isAvailableInBuild
  ) {
    return value as VocalSeparationModelId;
  }

  return "demucs";
}

function getSelectedCrepeModelSize(): CrepeModelSize | null {
  if (!state.audioPitchEstimator.startsWith("crepe-")) {
    return null;
  }

  const modelSize = state.audioPitchEstimator.slice("crepe-".length);

  if (modelSize === "medium" || modelSize === "large" || modelSize === "full") {
    return modelSize;
  }

  return "small";
}

function startAudioAnalysisMemoryTracking() {
  updateAudioMemoryStatus();

  if (state.audioAnalysisMemoryTimerId !== null) {
    return;
  }

  state.audioAnalysisMemoryTimerId = window.setInterval(
    updateAudioMemoryStatus,
    500,
  );
}

function stopAudioAnalysisMemoryTracking() {
  if (state.audioAnalysisMemoryTimerId === null) {
    updateAudioMemoryStatus();
    return;
  }

  window.clearInterval(state.audioAnalysisMemoryTimerId);
  state.audioAnalysisMemoryTimerId = null;
  updateAudioMemoryStatus();
}

function updateAudioMemoryStatus() {
  elements.audioMemoryStatus.textContent = `メモリ使用量: ${formatMemoryStatus()}`;
}

function formatMemoryStatus(): string {
  const memory = performance.memory;

  if (memory) {
    return `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(
      memory.jsHeapSizeLimit,
    )}`;
  }

  const deviceMemory = (
    navigator as Navigator & {
      deviceMemory?: number;
    }
  ).deviceMemory;

  if (deviceMemory !== undefined) {
    return `端末メモリ目安 ${deviceMemory} GB / 使用量は取得不可`;
  }

  return "このブラウザでは取得不可";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "--";
  }

  const mib = bytes / 1024 / 1024;

  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(1)} GB`;
  }

  return `${Math.round(mib)} MB`;
}

function formatAudioFileAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (
    message.includes("WebGPU") ||
    message.includes("安全な接続") ||
    message.includes("Cross-Origin") ||
    message.includes("WebGPUアダプタ")
  ) {
    return message;
  }

  if (state.isCapturingVocalSeparationComparison) {
    return message
      ? `ボーカル抽出モデルMP3の作成に失敗しました。${message}`
      : "ボーカル抽出モデルMP3の作成に失敗しました。PC版Chrome/EdgeなどのWebGPU対応ブラウザで、短めの音源から試してください。";
  }

  if (state.useVocalExtraction) {
    const model = VOCAL_SEPARATION_MODELS[state.vocalSeparationModel];
    return message
      ? `${model.label}のボーカル抽出または声域推定に失敗しました。${message}`
      : `${model.label}のボーカル抽出または声域推定に失敗しました。PC版Chrome/EdgeなどのWebGPU対応ブラウザで、短めの音源から試してください。`;
  }

  if (state.isCapturingCrepeComparison) {
    return message
      ? `ピッチ推定モデル比較PNGの作成に失敗しました。${message}`
      : "ピッチ推定モデル比較PNGの作成に失敗しました。短めの音源から試してください。";
  }

  if (getSelectedCrepeModelSize()) {
    return message
      ? `CREPE推定に失敗しました。${message}`
      : "CREPE推定に失敗しました。PC版Chrome/EdgeなどのWebGPU対応ブラウザで、短めの音源から試してください。";
  }

  if (state.audioPitchEstimator === "rmvpe") {
    return message
      ? `RMVPE推定に失敗しました。${message}`
      : "RMVPE推定に失敗しました。PC版Chrome/EdgeなどのWebGPU対応ブラウザで、短めの音源から試してください。";
  }

  return "音源を解析できませんでした。別形式の音源ファイル、または音声トラックを含む動画で試してください。";
}

function formatPercent(ratio: number): string {
  return `${Math.round(clamp(ratio, 0, 1) * 100)}%`;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function renderNoteButtons() {
  const notes = getCurrentNotes();

  elements.noteButtons.replaceChildren(
    ...notes.map((note) => createNoteButton(note, "note-button")),
  );
  elements.graphTargetButtons.replaceChildren(
    ...notes.map((note) => createNoteButton(note, "target-note-button")),
  );
}

function createNoteButton(note: Note, className: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.noteName = note.name;
  button.setAttribute("aria-pressed", String(note.name === state.target.name));
  button.innerHTML = `<strong>${note.solfege}</strong><span>${note.name}</span>`;
  button.addEventListener("click", () => {
    selectTargetNote(note);
  });
  return button;
}

function selectTargetNote(note: Note) {
  state.target = note;
  resetActiveSession();
  updateTargetDisplay();
  updateNoteButtonStates();
  updateReferenceToneFrequency();
  drawGraph();
}

function updateNoteButtonStates() {
  const buttons = [
    ...elements.noteButtons.querySelectorAll<HTMLButtonElement>("button"),
    ...elements.graphTargetButtons.querySelectorAll<HTMLButtonElement>(
      "button",
    ),
  ];

  buttons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.noteName === state.target.name),
    );
  });
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

function stopScalePlayback() {
  if (state.scalePlaybackTimerId !== null) {
    window.clearTimeout(state.scalePlaybackTimerId);
    state.scalePlaybackTimerId = null;
  }

  state.isScalePlaying = false;
  elements.playScaleButton.disabled = false;
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
      "この表示方法ではマイクを使えません。HTTPSのURL、またはlocalhostで開いてください。";
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
  focusGraphForPractice();

  state.animationId = requestAnimationFrame(analyzeFrame);
}

function focusGraphForPractice() {
  if (!window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
    return;
  }

  requestAnimationFrame(() => {
    elements.graphPanel.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function stopMicrophone() {
  if (state.animationId !== null) {
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

function handlePageHide(event: PageTransitionEvent) {
  if (event.persisted) {
    return;
  }

  cleanupRuntimeResources();
}

function cleanupRuntimeResources() {
  stopAudioPlaybackTracking();
  stopAudioAnalysisMemoryTracking();
  stopScalePlayback();
  stopReferenceTone();
  stopMicrophone();
  cleanupAudioFilePlayer();
  cleanupExtractedVocalAudioUrl();
  cleanupCanvasRuntimeListeners();
  void releaseCrepeSessions();
  void releaseRmvpeSession();

  const audioContext = state.audioContext;
  state.audioContext = null;
  if (audioContext && audioContext.state !== "closed") {
    void audioContext.close();
  }
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
  updateGameEffects(sample, status, now);
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

function updateGameEffects(
  sample: PitchSample,
  status: ReturnType<typeof resolveAnalysisStatus>,
  now: number,
) {
  const isInTune = status === "inRange" && sample.centsFromTarget !== null;
  const previousSample = state.session.samples.at(-2);

  state.gameEffects = updateGameEffectState({
    state: state.gameEffects,
    sample,
    previousSample,
    isInTune,
    tolerance: state.tolerance,
    now,
    maxStableGapMs: MAX_STABLE_SAMPLE_GAP_MS,
    rippleDurationMs: LANDING_RIPPLE_DURATION_MS,
    maxRipples: MAX_LANDING_RIPPLES,
  });
  elements.comboReadout.textContent =
    state.gameEffects.stableComboMs > 0
      ? `${(state.gameEffects.stableComboMs / 1000).toFixed(1)}秒`
      : "--";
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
  state.gameEffects = createInitialGameEffectState();
  elements.comboReadout.textContent = "--";
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
    )}%、音程検出は${
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
  )}%、音程検出は${
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
  if (state.pitchDetectors) {
    state.pitchDetectors.detector.minVolumeAbsolute = state.minRms;
  }

  if (value <= 4) {
    elements.sensitivityValue.textContent = "よく拾う";
  } else if (value >= 12) {
    elements.sensitivityValue.textContent = "控えめ";
  } else {
    elements.sensitivityValue.textContent = "ふつう";
  }
}

function setupPitchCanvas() {
  cleanupPitchCanvasResizeWatcher();
  syncPitchCanvasSize();

  const ResizeObserverClass = globalThis.ResizeObserver;
  if (ResizeObserverClass) {
    const observer = new ResizeObserverClass(() => {
      syncPitchCanvasSize();
      drawGraph();
    });
    observer.observe(elements.pitchCanvas);
    state.pitchCanvasResizeObserver = observer;
    return;
  }

  state.pitchCanvasResizeHandler = () => {
    syncPitchCanvasSize();
    drawGraph();
  };
  window.addEventListener("resize", state.pitchCanvasResizeHandler);
}

function setupAudioRangeCanvas() {
  cleanupAudioRangeCanvasListeners();
  syncAudioRangeCanvasSize();
  elements.audioRangeCanvas.addEventListener(
    "pointerdown",
    handleAudioRangePointerDown,
  );
  elements.audioRangeCanvas.addEventListener(
    "pointermove",
    handleAudioRangePointerMove,
  );
  elements.audioRangeCanvas.addEventListener(
    "pointerup",
    handleAudioRangePointerUp,
  );
  elements.audioRangeCanvas.addEventListener(
    "pointercancel",
    handleAudioRangePointerUp,
  );
  elements.audioRangeCanvas.addEventListener(
    "pointerleave",
    handleAudioRangePointerLeave,
  );

  const ResizeObserverClass = globalThis.ResizeObserver;
  if (ResizeObserverClass) {
    const observer = new ResizeObserverClass(() => {
      syncAudioRangeCanvasSize();
      drawAudioRangeGraph();
    });
    observer.observe(elements.audioRangeScroll);
    state.audioRangeResizeObserver = observer;
    return;
  }

  state.audioRangeResizeHandler = () => {
    syncAudioRangeCanvasSize();
    drawAudioRangeGraph();
  };
  window.addEventListener("resize", state.audioRangeResizeHandler);
}

function cleanupCanvasRuntimeListeners() {
  cleanupPitchCanvasResizeWatcher();
  cleanupAudioRangeCanvasListeners();
}

function cleanupPitchCanvasResizeWatcher() {
  state.pitchCanvasResizeObserver?.disconnect();
  state.pitchCanvasResizeObserver = null;

  if (state.pitchCanvasResizeHandler) {
    window.removeEventListener("resize", state.pitchCanvasResizeHandler);
    state.pitchCanvasResizeHandler = null;
  }
}

function cleanupAudioRangeCanvasListeners() {
  elements.audioRangeCanvas.removeEventListener(
    "pointerdown",
    handleAudioRangePointerDown,
  );
  elements.audioRangeCanvas.removeEventListener(
    "pointermove",
    handleAudioRangePointerMove,
  );
  elements.audioRangeCanvas.removeEventListener(
    "pointerup",
    handleAudioRangePointerUp,
  );
  elements.audioRangeCanvas.removeEventListener(
    "pointercancel",
    handleAudioRangePointerUp,
  );
  elements.audioRangeCanvas.removeEventListener(
    "pointerleave",
    handleAudioRangePointerLeave,
  );

  state.audioRangeResizeObserver?.disconnect();
  state.audioRangeResizeObserver = null;

  if (state.audioRangeResizeHandler) {
    window.removeEventListener("resize", state.audioRangeResizeHandler);
    state.audioRangeResizeHandler = null;
  }
}

function handleAudioRangePointerDown(event: PointerEvent) {
  if (!state.audioFilePlayer || !isPointerNearAudioPlaybackCursor(event)) {
    return;
  }

  state.isDraggingAudioPlaybackCursor = true;
  elements.audioRangeCanvas.setPointerCapture(event.pointerId);
  elements.audioRangeCanvas.classList.add("is-dragging-playback-cursor");
  seekAudioPlaybackToPointer(event);
}

function handleAudioRangePointerMove(event: PointerEvent) {
  if (state.isDraggingAudioPlaybackCursor) {
    seekAudioPlaybackToPointer(event);
    return;
  }

  elements.audioRangeCanvas.classList.toggle(
    "is-hovering-playback-cursor",
    isPointerNearAudioPlaybackCursor(event),
  );
}

function handleAudioRangePointerUp(event: PointerEvent) {
  if (!state.isDraggingAudioPlaybackCursor) {
    return;
  }

  state.isDraggingAudioPlaybackCursor = false;
  elements.audioRangeCanvas.releasePointerCapture(event.pointerId);
  elements.audioRangeCanvas.classList.remove("is-dragging-playback-cursor");
  elements.audioRangeCanvas.classList.toggle(
    "is-hovering-playback-cursor",
    isPointerNearAudioPlaybackCursor(event),
  );
}

function handleAudioRangePointerLeave() {
  if (state.isDraggingAudioPlaybackCursor) {
    return;
  }

  elements.audioRangeCanvas.classList.remove("is-hovering-playback-cursor");
}

function seekAudioPlaybackToPointer(event: PointerEvent) {
  const player = state.audioFilePlayer;
  const durationSec = getAudioFileDurationSec();

  if (!player || durationSec <= 0) {
    return;
  }

  player.currentTime = getAudioTimeFromPointer(event, durationSec);
  updateAudioPlaybackView();
}

function isPointerNearAudioPlaybackCursor(event: PointerEvent): boolean {
  const player = state.audioFilePlayer;
  const durationSec = getAudioFileDurationSec();

  if (!player || durationSec <= 0) {
    return false;
  }

  const pointerX = getAudioCanvasPointerX(event);
  const cursorX = getAudioPlaybackCursorX(durationSec);

  return Math.abs(pointerX - cursorX) <= AUDIO_PLAYBACK_CURSOR_HIT_RADIUS_PX;
}

function getAudioTimeFromPointer(
  event: PointerEvent,
  durationSec: number,
): number {
  const pointerX = getAudioCanvasPointerX(event);
  const canvasWidth =
    elements.audioRangeCanvas.width / state.audioRangePixelRatio;
  const plotWidth =
    canvasWidth -
    AUDIO_RANGE_GRAPH_PADDING.left -
    AUDIO_RANGE_GRAPH_PADDING.right;
  const ratio =
    (pointerX - AUDIO_RANGE_GRAPH_PADDING.left) / Math.max(1, plotWidth);

  return Math.max(0, Math.min(durationSec, ratio * durationSec));
}

function getAudioPlaybackCursorX(durationSec: number): number {
  const canvasWidth =
    elements.audioRangeCanvas.width / state.audioRangePixelRatio;
  const plotWidth =
    canvasWidth -
    AUDIO_RANGE_GRAPH_PADDING.left -
    AUDIO_RANGE_GRAPH_PADDING.right;
  const currentTime = Math.max(
    0,
    Math.min(durationSec, getAudioPlaybackTimeSec()),
  );

  return (
    AUDIO_RANGE_GRAPH_PADDING.left +
    (currentTime / durationSec) * Math.max(1, plotWidth)
  );
}

function getAudioCanvasPointerX(event: PointerEvent): number {
  const rect = elements.audioRangeCanvas.getBoundingClientRect();

  return event.clientX - rect.left;
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

function syncAudioRangeCanvasSize() {
  const canvas = elements.audioRangeCanvas;
  const axisCanvas = elements.audioRangeAxisCanvas;
  updateAudioRangeCanvasWidth();

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

  state.audioRangePixelRatio = backingSize.pixelRatio;

  if (
    canvas.width !== backingSize.width ||
    canvas.height !== backingSize.height
  ) {
    canvas.width = backingSize.width;
    canvas.height = backingSize.height;
  }

  const axisRect = axisCanvas.getBoundingClientRect();
  const axisCssWidth = Math.max(
    1,
    Math.round(axisRect.width || axisCanvas.clientWidth || axisCanvas.width),
  );
  const axisBackingSize = resolveCanvasBackingSize(
    axisCssWidth,
    cssHeight,
    state.audioRangePixelRatio,
  );

  if (
    axisCanvas.width !== axisBackingSize.width ||
    axisCanvas.height !== axisBackingSize.height
  ) {
    axisCanvas.width = axisBackingSize.width;
    axisCanvas.height = axisBackingSize.height;
  }
}

function updateAudioRangeCanvasWidth() {
  const durationSec = getAudioFileDurationSec();
  const visibleWidth = Math.max(1, elements.audioRangeScroll.clientWidth);
  const minWidth = durationSec > 0 ? AUDIO_RANGE_MIN_WIDTH : visibleWidth;
  const expandedWidth =
    durationSec > 0
      ? Math.ceil(durationSec * AUDIO_RANGE_PIXELS_PER_SECOND)
      : visibleWidth;
  const cssWidth = Math.min(
    AUDIO_RANGE_MAX_WIDTH,
    Math.max(visibleWidth, minWidth, expandedWidth),
  );

  elements.audioRangeCanvas.style.width = `${cssWidth}px`;
}

function getAudioFileDurationSec(): number {
  const analysisDuration = state.audioFileAnalysis?.summary.durationSec;
  if (analysisDuration !== undefined && Number.isFinite(analysisDuration)) {
    return analysisDuration;
  }

  const playerDuration = state.audioFilePlayer?.duration;
  if (playerDuration !== undefined && Number.isFinite(playerDuration)) {
    return playerDuration;
  }

  return 0;
}

function getAudioPlaybackDurationSec(): number {
  const playerDuration = state.audioFilePlayer?.duration;
  if (playerDuration !== undefined && Number.isFinite(playerDuration)) {
    return playerDuration;
  }

  return 0;
}

function getAudioPlaybackTimeSec(): number {
  const currentTime = state.audioFilePlayer?.currentTime ?? 0;

  return Number.isFinite(currentTime) ? currentTime : 0;
}

function createPitchDetectors(
  sampleRate: number,
  bufferSize: number,
): LibraryDetectors {
  const detector = PitchDetector.forFloat32Array(bufferSize);
  detector.clarityThreshold = PITCHY_CLARITY_THRESHOLD;
  detector.minVolumeAbsolute = state.minRms;

  return {
    sampleRate,
    bufferSize,
    detector,
  };
}

function detectPitch(buffer: Float32Array<ArrayBuffer>, sampleRate: number) {
  const detectors =
    state.pitchDetectors?.sampleRate === sampleRate &&
    state.pitchDetectors.bufferSize === buffer.length
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
  drawTargetGlow(context, width, viewport);

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
  drawLandingRipples(context, viewport);
  drawGraphLabels(context, width, height, viewport.padding);
  drawCurrentPitchLabel(context, width, viewport);
}

function drawTargetGlow(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
) {
  const latestSample = state.session.samples.at(-1);

  if (!latestSample || latestSample.centsFromTarget === null) {
    return;
  }

  const distance = Math.abs(latestSample.centsFromTarget);
  const glowStrength = getTargetGlowStrength(distance, state.tolerance);

  if (glowStrength <= 0) {
    return;
  }

  const centerX = viewport.padding.left + viewport.plotWidth / 2;
  const glowWidth = viewport.plotWidth * (0.42 + glowStrength * 0.34);
  const glowHeight = 24 + glowStrength * 34;
  const gradient = context.createRadialGradient(
    centerX,
    viewport.zeroY,
    4,
    centerX,
    viewport.zeroY,
    glowWidth / 2,
  );

  gradient.addColorStop(0, `rgba(28, 148, 119, ${0.34 * glowStrength})`);
  gradient.addColorStop(0.55, `rgba(247, 201, 72, ${0.2 * glowStrength})`);
  gradient.addColorStop(1, "rgba(247, 201, 72, 0)");

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = gradient;
  context.fillRect(
    Math.max(viewport.padding.left, centerX - glowWidth / 2),
    viewport.zeroY - glowHeight / 2,
    Math.min(glowWidth, width - viewport.padding.left - viewport.padding.right),
    glowHeight,
  );
  context.restore();
}

function drawLandingRipples(
  context: CanvasRenderingContext2D,
  viewport: ReturnType<typeof createGraphViewport>,
) {
  const now = performance.now();

  state.gameEffects.landingRipples.forEach((ripple) => {
    if (ripple.timeMs < viewport.startTime) {
      return;
    }

    const age = now - ripple.createdAt;
    const progress = clamp(age / LANDING_RIPPLE_DURATION_MS, 0, 1);
    const alpha = (1 - progress) * (0.28 + ripple.intensity * 0.32);
    const radius = 12 + progress * (42 + ripple.intensity * 26);
    const x =
      viewport.padding.left +
      ((ripple.timeMs - viewport.startTime) / (GRAPH_SECONDS * 1000)) *
        viewport.plotWidth;
    const y = midiToY(
      ripple.midi,
      viewport.minMidi,
      viewport.maxMidi,
      viewport.padding,
      viewport.plotHeight,
    );

    context.save();
    context.strokeStyle = `rgba(247, 201, 72, ${alpha})`;
    context.lineWidth = 2 + ripple.intensity * 2;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = `rgba(28, 148, 119, ${alpha * 0.72})`;
    context.beginPath();
    context.arc(x, y, 4 + ripple.intensity * 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });
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

function drawCurrentPitchLabel(
  context: CanvasRenderingContext2D,
  width: number,
  viewport: ReturnType<typeof createGraphViewport>,
) {
  const latestSample = state.session.samples.at(-1);

  if (
    !latestSample ||
    latestSample.midi === null ||
    latestSample.note === null
  ) {
    return;
  }

  const label = `${midiToSolfegeName(latestSample.midi)} ${latestSample.note}`;
  const x = width / 2;
  const y = viewport.padding.top + 72;

  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 48px system-ui, sans-serif";

  const metrics = context.measureText(label);
  const labelX = Math.max(
    viewport.padding.left + metrics.width / 2 + 10,
    Math.min(x, width - viewport.padding.right - metrics.width / 2 - 10),
  );
  const labelY = Math.max(viewport.padding.top + 18, y);

  context.lineWidth = 10;
  context.strokeStyle = "rgba(255, 255, 255, 0.96)";
  context.strokeText(label, labelX, labelY);
  context.fillStyle = "#0d4f56";
  context.fillText(label, labelX, labelY);
  context.restore();
}

function drawAudioRangeGraph() {
  syncAudioRangeCanvasSize();

  const canvas = elements.audioRangeCanvas;
  const context = audioRangeCanvasContext;
  const width = canvas.width / state.audioRangePixelRatio;
  const height = canvas.height / state.audioRangePixelRatio;
  const padding = AUDIO_RANGE_GRAPH_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.setTransform(
    state.audioRangePixelRatio,
    0,
    0,
    state.audioRangePixelRatio,
    0,
    0,
  );
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  const analysis = state.audioFileAnalysis;
  const summary = analysis?.summary;
  const durationSec = getAudioFileDurationSec();
  const midiBounds = getAudioRangeMidiBounds(summary);
  const minMidi = Math.floor(midiBounds.min - 2);
  const maxMidi = Math.ceil(midiBounds.max + 2);

  drawAudioRangeGrid(context, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec,
    width,
    height,
  });
  drawAudioRangeAxis({
    padding,
    plotHeight,
    minMidi,
    maxMidi,
  });

  if (!analysis || analysis.summary.validFrames === 0) {
    context.fillStyle = "#5c6870";
    context.font = "16px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(
      "音源を選んで解析すると、推定した声域を表示します",
      width / 2,
      height / 2,
    );
    context.textAlign = "left";
    return;
  }

  drawVoiceRangeBand(context, {
    summary: analysis.summary,
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
  });
  drawAudioPitchCloud(context, analysis.points, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec: analysis.summary.durationSec,
  });
  drawAudioPitchTrend(context, analysis.points, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec: analysis.summary.durationSec,
  });
  drawAudioPlaybackCursor(context, {
    points: analysis.points,
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec,
  });
}

function drawAudioRangeGrid(
  context: CanvasRenderingContext2D,
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
    width: number;
    height: number;
  },
) {
  const {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec,
    width,
    height,
  } = options;

  context.strokeStyle = "#e8edf0";
  context.lineWidth = 1;
  context.font = "14px system-ui, sans-serif";

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = midiToY(midi, minMidi, maxMidi, padding, plotHeight);
    const isOctave = midi % 12 === 0;

    context.strokeStyle = isOctave ? "#c6d4d8" : "#e8edf0";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + plotWidth, y);
    context.stroke();

    if (isOctave || midi % 2 === 0) {
      context.fillStyle = "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  drawAudioTimeGrid(context, {
    padding,
    plotWidth,
    plotHeight,
    durationSec,
    height,
  });

  context.fillStyle = "#5c6870";
  context.fillText("音名", 8, 20);
  context.fillText("開始", padding.left, height - 10);
  context.fillText("終わり", width - padding.right - 44, height - 10);
}

function drawAudioRangeAxis(options: {
  padding: GraphPadding;
  plotHeight: number;
  minMidi: number;
  maxMidi: number;
}) {
  const canvas = elements.audioRangeAxisCanvas;
  const context = audioRangeAxisCanvasContext;
  const width = canvas.width / state.audioRangePixelRatio;
  const height = canvas.height / state.audioRangePixelRatio;
  const { padding, plotHeight, minMidi, maxMidi } = options;

  context.setTransform(
    state.audioRangePixelRatio,
    0,
    0,
    state.audioRangePixelRatio,
    0,
    0,
  );
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  context.font = "14px system-ui, sans-serif";

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = midiToY(midi, minMidi, maxMidi, padding, plotHeight);
    const isOctave = midi % 12 === 0;

    if (isOctave || midi % 2 === 0) {
      context.fillStyle = "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  context.fillStyle = "#5c6870";
  context.fillText("音名", 8, 20);
}

function drawAudioTimeGrid(
  context: CanvasRenderingContext2D,
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    durationSec: number;
    height: number;
  },
) {
  const { padding, plotWidth, plotHeight, durationSec, height } = options;
  const intervalSec = getAudioTimeGridInterval(durationSec);
  const safeDurationSec = Math.max(1, durationSec);

  context.strokeStyle = "#d7dee2";
  context.fillStyle = "#73808a";
  context.textAlign = "center";

  if (durationSec <= 0) {
    for (let ratio = 0; ratio <= 1; ratio += 0.25) {
      const x = padding.left + plotWidth * ratio;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, padding.top + plotHeight);
      context.stroke();
    }
    context.textAlign = "left";
    return;
  }

  for (
    let seconds = intervalSec;
    seconds < durationSec;
    seconds += intervalSec
  ) {
    const x = padding.left + (seconds / safeDurationSec) * plotWidth;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + plotHeight);
    context.stroke();

    context.fillText(formatTimeLabel(seconds), x, height - 10);
  }

  context.textAlign = "left";
}

function getAudioTimeGridInterval(durationSec: number): number {
  return durationSec > 0 ? 5 : 15;
}

function formatTimeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatClockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  return formatTimeLabel(seconds);
}

function getAudioRangeMidiBounds(
  summary: AudioFileAnalysis["summary"] | undefined,
): { min: number; max: number } {
  if (
    !summary ||
    summary.robustLowestMidi === null ||
    summary.robustHighestMidi === null
  ) {
    return { min: 48, max: 72 };
  }

  const center =
    summary.medianMidi ??
    midpoint(summary.robustLowestMidi, summary.robustHighestMidi);
  const minSpan = 18;
  const halfSpan = Math.max(
    minSpan / 2,
    Math.abs(summary.robustHighestMidi - summary.robustLowestMidi) / 2,
  );

  return {
    min: center - halfSpan,
    max: center + halfSpan,
  };
}

function midpoint(a: number, b: number): number {
  return (a + b) / 2;
}

function drawVoiceRangeBand(
  context: CanvasRenderingContext2D,
  options: {
    summary: AudioFileAnalysis["summary"];
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
  },
) {
  const { summary, padding, plotWidth, plotHeight, minMidi, maxMidi } = options;

  if (
    summary.robustLowestMidi === null ||
    summary.robustHighestMidi === null ||
    summary.commonLowestMidi === null ||
    summary.commonHighestMidi === null ||
    summary.medianMidi === null
  ) {
    return;
  }

  const robustTop = midiToY(
    summary.robustHighestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const robustBottom = midiToY(
    summary.robustLowestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const commonTop = midiToY(
    summary.commonHighestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const commonBottom = midiToY(
    summary.commonLowestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const medianY = midiToY(
    summary.medianMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );

  context.fillStyle = "rgba(20, 108, 117, 0.1)";
  context.fillRect(
    padding.left,
    robustTop,
    plotWidth,
    robustBottom - robustTop,
  );
  context.fillStyle = "rgba(47, 133, 90, 0.16)";
  context.fillRect(
    padding.left,
    commonTop,
    plotWidth,
    commonBottom - commonTop,
  );
  context.strokeStyle = "#0d4f56";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(padding.left, medianY);
  context.lineTo(padding.left + plotWidth, medianY);
  context.stroke();
}

function drawAudioPitchCloud(
  context: CanvasRenderingContext2D,
  points: AudioPitchPoint[],
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
  },
) {
  const { padding, plotWidth, plotHeight, minMidi, maxMidi, durationSec } =
    options;

  context.save();

  points.forEach((point) => {
    if (point.midi === null) {
      return;
    }

    const x =
      padding.left +
      (point.timeMs / Math.max(1, durationSec * 1000)) * plotWidth;
    const y = midiToY(point.midi, minMidi, maxMidi, padding, plotHeight);
    const alpha = 0.18 + 0.5 * Math.max(0, Math.min(1, point.clarity ?? 0));

    context.fillStyle = `rgba(43, 108, 176, ${alpha})`;
    context.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
  });

  context.restore();
}

function drawAudioPitchTrend(
  context: CanvasRenderingContext2D,
  points: AudioPitchPoint[],
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
  },
) {
  const { padding, plotWidth, plotHeight, minMidi, maxMidi, durationSec } =
    options;
  const trendPoints = buildAudioPitchTrend(points);
  let startsLine = true;

  context.save();
  context.strokeStyle = "#1f5f93";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  trendPoints.forEach((point) => {
    const x =
      padding.left +
      (point.timeMs / Math.max(1, durationSec * 1000)) * plotWidth;
    const y = midiToY(point.midi, minMidi, maxMidi, padding, plotHeight);

    if (point.startsLine || startsLine) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }

    startsLine = false;
  });

  context.stroke();
  context.restore();
}

function drawAudioPlaybackCursor(
  context: CanvasRenderingContext2D,
  options: {
    points: AudioPitchPoint[];
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
  },
) {
  const { points, padding, plotWidth, plotHeight, durationSec } = options;
  const currentTime = getAudioPlaybackTimeSec();

  if (!state.audioFilePlayer || durationSec <= 0) {
    return;
  }

  const clampedTime = Math.max(0, Math.min(durationSec, currentTime));
  const x = padding.left + (clampedTime / durationSec) * plotWidth;

  context.save();
  context.strokeStyle = "#b42318";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, padding.top);
  context.lineTo(x, padding.top + plotHeight);
  context.stroke();

  context.fillStyle = "#b42318";
  context.font = "700 13px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(formatClockTime(clampedTime), x, padding.top - 8);

  drawAudioPlaybackPitchLabel(context, {
    point: findNearestAudioPitchPoint(points, clampedTime * 1000),
    x,
    padding,
    plotWidth,
  });
  context.restore();
}

function drawAudioPlaybackPitchLabel(
  context: CanvasRenderingContext2D,
  options: {
    point: AudioPitchPoint | null;
    x: number;
    padding: GraphPadding;
    plotWidth: number;
  },
) {
  const { point, x, padding, plotWidth } = options;

  if (point?.midi === null || point?.midi === undefined) {
    return;
  }

  const label = `${midiToSolfegeName(point.midi)} ${midiToNoteName(point.midi)}`;

  context.save();
  context.font = "800 15px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const metrics = context.measureText(label);
  const labelWidth = metrics.width + 14;
  const labelHeight = 24;
  const labelX = Math.max(
    padding.left + labelWidth / 2,
    Math.min(x, padding.left + plotWidth - labelWidth / 2),
  );
  const labelY = padding.top + 14;
  const rectX = labelX - labelWidth / 2;
  const rectY = labelY - labelHeight / 2;

  context.fillStyle = "rgba(255, 255, 255, 0.98)";
  context.strokeStyle = "#b42318";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(rectX, rectY, labelWidth, labelHeight, 7);
  context.fill();
  context.stroke();
  context.fillStyle = "#8f1d14";
  context.fillText(label, labelX, labelY);
  context.restore();
}

function findNearestAudioPitchPoint(
  points: AudioPitchPoint[],
  timeMs: number,
): AudioPitchPoint | null {
  const maxDistanceMs = 300;
  let nearestPoint: AudioPitchPoint | null = null;
  let nearestDistance = Infinity;

  for (const point of points) {
    if (point.midi === null) {
      continue;
    }

    const distance = Math.abs(point.timeMs - timeMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  }

  return nearestDistance <= maxDistanceMs ? nearestPoint : null;
}

function buildAudioPitchTrend(
  points: AudioPitchPoint[],
): { timeMs: number; midi: number; startsLine: boolean }[] {
  const trendPoints: { timeMs: number; midi: number; startsLine: boolean }[] =
    [];
  let previousTimeMs: number | null = null;

  points.forEach((point, index) => {
    if (point.midi === null) {
      previousTimeMs = null;
      return;
    }

    const nearbyMidi = getNearbyAudioMidiValues(points, index, 5);

    if (nearbyMidi.length < 3) {
      previousTimeMs = null;
      return;
    }

    nearbyMidi.sort((a, b) => a - b);
    const median = percentile(nearbyMidi, 0.5);

    if (median === null) {
      previousTimeMs = null;
      return;
    }

    trendPoints.push({
      timeMs: point.timeMs,
      midi: median,
      startsLine:
        previousTimeMs === null || point.timeMs - previousTimeMs > 1600,
    });
    previousTimeMs = point.timeMs;
  });

  return trendPoints;
}

function getNearbyAudioMidiValues(
  points: AudioPitchPoint[],
  index: number,
  radius: number,
): number[] {
  const values: number[] = [];
  const start = Math.max(0, index - radius);
  const end = Math.min(points.length - 1, index + radius);

  for (let nearbyIndex = start; nearbyIndex <= end; nearbyIndex += 1) {
    const midi = points[nearbyIndex]?.midi;

    if (midi !== null && midi !== undefined && Number.isFinite(midi)) {
      values.push(midi);
    }
  }

  return values;
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = (sortedValues.length - 1) * Math.max(0, Math.min(1, ratio));
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;
  const lower = sortedValues[lowerIndex] ?? sortedValues[0];
  const upper = sortedValues[upperIndex] ?? sortedValues.at(-1) ?? lower;

  return lower + (upper - lower) * weight;
}

init();
