import {
  type AudioPitchEstimator,
  analyzeAudioFile,
  getEstimatorLabel,
  getEstimatorSupportMessage,
  resolveAudioPitchEstimator,
} from "./audioAnalysisPipeline";
import {
  createAudioAnalysisReporter,
  formatBytes,
  waitForPaint,
} from "./audioAnalysisProgress";
import { getAudioContext, isAudioContextSupported } from "./audioContext";
import { downloadBlob, vocalDownloadName } from "./audioDownloads";
import {
  type AudioFileAnalysis,
  formatDuration,
  formatMidiRange,
  getVoiceCoverage,
} from "./audioFileAnalysis";
import {
  AUDIO_RANGE_GRAPH_PADDING,
  audioRangeGraphWidth,
  formatClockTime,
  renderAudioRangeGraph,
} from "./audioRangeGraph";
import { queryElement } from "./dom";
import { resolveCanvasBackingSize } from "./graphModel";
import {
  createMp3BlobFromDecodedAudio,
  createWavBlobFromDecodedAudio,
  type DecodedMediaAudio,
} from "./mediaAudioExtraction";
import {
  getVocalSeparationSupportMessage,
  VOCAL_SEPARATION_MODELS,
  type VocalSeparationModelId,
} from "./vocalSeparation";

declare global {
  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

type ExtractedVocals = {
  audio: DecodedMediaAudio;
  fileName: string;
  url: string;
};

type AudioFileOperation = {
  kind: "analysis" | "download";
  controller: AbortController;
};

type AudioFileState = {
  audioRangePixelRatio: number;
  selectedAudioFile: File | null;
  selectedPlaybackAudioFile: File | null;
  useSeparatePlaybackAudio: boolean;
  useVocalExtraction: boolean;
  vocalSeparationModel: VocalSeparationModelId;
  audioPitchEstimator: AudioPitchEstimator;
  selectedPlaybackAudioFileUrl: string | null;
  extractedVocals: ExtractedVocals | null;
  audioFilePlayer: HTMLAudioElement | null;
  audioFilePlaybackSource: MediaElementAudioSourceNode | null;
  audioFilePlaybackGain: GainNode | null;
  audioFileAnalysis: AudioFileAnalysis | null;
  operation: AudioFileOperation | null;
  audioAnalysisMemoryTimerId: number | null;
  isAudioPlaybackDurationCompatible: boolean;
  audioPlaybackAnimationId: number | null;
  isDraggingAudioPlaybackCursor: boolean;
  audioRangeResizeObserver: ResizeObserver | null;
  audioRangeResizeHandler: (() => void) | null;
};
export function setupAudioFileView() {
  const state: AudioFileState = {
    audioRangePixelRatio: 1,
    selectedAudioFile: null,
    selectedPlaybackAudioFile: null,
    useSeparatePlaybackAudio: false,
    useVocalExtraction: false,
    vocalSeparationModel: "demucs",
    audioPitchEstimator: "rmvpe",
    selectedPlaybackAudioFileUrl: null,
    extractedVocals: null,
    audioFilePlayer: null,
    audioFilePlaybackSource: null,
    audioFilePlaybackGain: null,
    audioFileAnalysis: null,
    operation: null,
    audioAnalysisMemoryTimerId: null,
    isAudioPlaybackDurationCompatible: true,
    audioPlaybackAnimationId: null,
    isDraggingAudioPlaybackCursor: false,
    audioRangeResizeObserver: null,
    audioRangeResizeHandler: null,
  };
  const elements = {
    audioFileView: queryElement<HTMLElement>("#audioFileView"),
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
    playAudioFileButton: queryElement<HTMLButtonElement>(
      "#playAudioFileButton",
    ),
    pauseAudioFileButton: queryElement<HTMLButtonElement>(
      "#pauseAudioFileButton",
    ),
    stopAudioFileButton: queryElement<HTMLButtonElement>(
      "#stopAudioFileButton",
    ),
    analyzeAudioFileButton: queryElement<HTMLButtonElement>(
      "#analyzeAudioFileButton",
    ),
    analyzeAudioFileButtonLabel: queryElement<HTMLElement>(
      "#analyzeAudioFileButtonLabel",
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
  const maybeAudioRangeAxisCanvasContext =
    elements.audioRangeAxisCanvas.getContext("2d");
  const maybeAudioRangeCanvasContext =
    elements.audioRangeCanvas.getContext("2d");

  if (!maybeAudioRangeCanvasContext) {
    throw new Error("Audio range canvas 2D context is not available.");
  }

  if (!maybeAudioRangeAxisCanvasContext) {
    throw new Error("Audio range axis canvas 2D context is not available.");
  }

  const audioRangeAxisCanvasContext = maybeAudioRangeAxisCanvasContext;
  const audioRangeCanvasContext = maybeAudioRangeCanvasContext;
  const AUDIO_FILE_PLAYBACK_GAIN = 2;
  const AUDIO_PLAYBACK_DURATION_TOLERANCE_SEC = 1;
  const AUDIO_PLAYBACK_CURSOR_HIT_RADIUS_PX = 14;
  const AUDIO_FILE_UNSUPPORTED_MESSAGE =
    "このブラウザでは音源ファイルの解析や再生ができません。別のブラウザで開いてください。";
  function init() {
    elements.vocalSeparationModelSelect.value = state.vocalSeparationModel;
    syncVocalSeparationModelOptions();
    setupAudioRangeCanvas();
    drawAudioRangeGraph();
    elements.audioFileInput.addEventListener(
      "change",
      handleAudioFileSelection,
    );
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
    elements.stopAudioFileButton.addEventListener(
      "click",
      stopAudioFilePlayback,
    );
    elements.audioSeekButtons.forEach((button) => {
      button.addEventListener("click", handleAudioSeekButtonClick);
    });
    elements.analyzeAudioFileButton.addEventListener(
      "click",
      handleAudioFileAnalysis,
    );
    updateAudioFileControls();
    if (!isAudioContextSupported()) {
      elements.audioFileInput.disabled = true;
      setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
    }
    return {
      show(visible: boolean) {
        elements.audioFileView.hidden = !visible;
        if (visible) requestAnimationFrame(drawAudioRangeGraph);
      },
      pause: pauseAudioFilePlayback,
      dispose() {
        state.operation?.controller.abort();
        stopAudioAnalysisMemoryTracking();
        cleanupAudioFilePlayer();
        cleanupExtractedVocalAudioUrl();
        cleanupAudioRangeCanvasListeners();
      },
    };
  }

  function syncVocalSeparationModelOptions() {
    Array.from(elements.vocalSeparationModelSelect.options).forEach(
      (option) => {
        const modelId = option.value as VocalSeparationModelId;
        const model = VOCAL_SEPARATION_MODELS[modelId];
        const isAvailable = model?.isAvailableInBuild ?? false;
        option.disabled = !isAvailable;
        option.hidden = !isAvailable;
      },
    );

    state.vocalSeparationModel = resolveVocalSeparationModel(
      elements.vocalSeparationModelSelect.value,
    );
    elements.vocalSeparationModelSelect.value = state.vocalSeparationModel;
  }

  function setAudioFileStatus(
    message: string,
    tone: "neutral" | "error" = "neutral",
  ) {
    elements.audioFileStatus.textContent = message;
    elements.audioFileStatus.classList.toggle("is-error", tone === "error");
  }

  function handleAudioFileSelection() {
    const file = elements.audioFileInput.files?.[0] ?? null;
    state.selectedAudioFile = file;
    invalidateAnalysis(!state.useSeparatePlaybackAudio);
    setAudioFileStatus(
      file
        ? `解析用に ${file.name} を選択しました。動画の場合は音声トラックを取り出してから声域を推定します。`
        : "音源や動画はブラウザ内だけで処理します。",
    );
  }

  function handlePlaybackAudioFileSelection() {
    const file = elements.playbackAudioFileInput.files?.[0] ?? null;
    state.selectedPlaybackAudioFile = file;
    elements.audioPlaybackSourceSelect.value = "original";
    if (state.useSeparatePlaybackAudio) resetAudioFilePlayerForSelectedSource();

    if (file) setAudioFileStatus(`再生用に ${file.name} を選択しました。`);
    refreshPlaybackControls();
  }

  function handleUseSeparatePlaybackAudioChange() {
    state.useSeparatePlaybackAudio =
      elements.useSeparatePlaybackAudioInput.checked;
    handleAudioPlaybackSourceChange();
  }

  function invalidateAnalysis(resetPlayer: boolean) {
    state.audioFileAnalysis = null;
    cleanupExtractedVocalAudioUrl();
    if (resetPlayer) {
      elements.audioPlaybackSourceSelect.value = "original";
      resetAudioFilePlayerForSelectedSource();
    }
    resetAudioFileReadouts();
    refreshPlaybackControls();
  }

  function handleUseVocalExtractionChange() {
    state.useVocalExtraction = elements.useVocalExtractionInput.checked;
    invalidateAnalysis(true);

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
    invalidateAnalysis(true);

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
    state.audioPitchEstimator = resolveAudioPitchEstimator(
      elements.audioPitchEstimatorSelect.value,
    );
    state.audioFileAnalysis = null;
    resetAudioFileReadouts();
    updateAudioFileControls();
    drawAudioRangeGraph();

    if (state.audioPitchEstimator.startsWith("crepe-")) {
      const supportMessage = getEstimatorSupportMessage(
        state.audioPitchEstimator,
      );
      setAudioFileStatus(
        supportMessage ??
          `${getEstimatorLabel(state.audioPitchEstimator)} 推定を使います。解析ボタンで声域を推定します。`,
      );
    } else if (state.audioPitchEstimator === "rmvpe") {
      const supportMessage = getEstimatorSupportMessage(
        state.audioPitchEstimator,
      );
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
    resetAudioFilePlayerForSelectedSource();
    refreshPlaybackControls();
  }

  function refreshPlaybackControls() {
    updateAudioFileControls();
    updateAudioPlaybackReadout();
    drawAudioRangeGraph();
  }

  function resetAudioFilePlayerForSelectedSource() {
    cleanupAudioFilePlayer();
    state.isAudioPlaybackDurationCompatible = true;
    const file = getSelectedOriginalAudioPlaybackFile();

    if (usesExtractedVocals() && state.extractedVocals) {
      setupAudioFilePlayerFromUrl(state.extractedVocals.url);
    } else if (file) {
      setupAudioFilePlayer(file);
    }
  }

  let playbackRequest = 0;

  async function handleAudioFilePlayback() {
    if (!isAudioContextSupported()) {
      setAudioFileStatus(AUDIO_FILE_UNSUPPORTED_MESSAGE, "error");
      updateAudioFileControls();
      return;
    }

    const selectedPlaybackFile = getSelectedOriginalAudioPlaybackFile();

    if (!usesExtractedVocals() && !selectedPlaybackFile) {
      return;
    }

    if (usesExtractedVocals() && !state.extractedVocals) {
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

    if (!state.audioFilePlayer && usesExtractedVocals()) {
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

    const request = ++playbackRequest;
    try {
      await setupBoostedAudioFilePlayback(player);
      if (request !== playbackRequest || player !== state.audioFilePlayer)
        return;
      await player.play();
    } catch (error) {
      if (request !== playbackRequest) return;
      setAudioFileStatus(
        "音源を再生できませんでした。ブラウザの音声設定を確認してください。",
        "error",
      );
      console.error(error);
    }
  }

  function pauseAudioFilePlayback() {
    playbackRequest++;
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
    playbackRequest++;
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
    const isAudioBusy = state.operation !== null;
    const isAnalyzing = state.operation?.kind === "analysis";
    const selectedPlaybackFile = getSelectedOriginalAudioPlaybackFile();
    const hasPlayableAnalysis = hasPlayableAudioFileAnalysis();
    const hasSelectedPlaybackSource = usesExtractedVocals()
      ? Boolean(state.extractedVocals)
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
    elements.useVocalExtractionInput.disabled =
      !isAudioSupported || isAudioBusy;
    elements.vocalSeparationModelSelect.disabled =
      !isAudioSupported || !state.useVocalExtraction || isAudioBusy;
    elements.audioPitchEstimatorSelect.disabled =
      !isAudioSupported || isAudioBusy;
    updateAudioPlaybackSourceControl(isAudioSupported && !isAnalyzing);
    elements.analyzeAudioFileButton.disabled =
      !isAudioSupported || !state.selectedAudioFile || isAudioBusy;
    elements.analyzeAudioFileButton.classList.toggle("is-loading", isAnalyzing);
    elements.analyzeAudioFileButton.setAttribute(
      "aria-busy",
      String(isAnalyzing),
    );
    elements.analyzeAudioFileButtonLabel.textContent = isAnalyzing
      ? "解析中"
      : "解析";
    elements.downloadExtractedVocalButton.disabled =
      !isAudioSupported || !state.extractedVocals || isAudioBusy;
    elements.audioFileInput.disabled = !isAudioSupported || isAudioBusy;
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

  function updateAudioPlaybackSourceControl(canChangeSource: boolean) {
    const vocalOption = elements.audioPlaybackSourceSelect.querySelector(
      'option[value="vocals"]',
    );

    if (vocalOption instanceof HTMLOptionElement) {
      vocalOption.disabled = !state.extractedVocals;
    }

    elements.audioPlaybackSourceSelect.disabled =
      !canChangeSource || !state.extractedVocals;
  }

  function usesExtractedVocals() {
    return elements.audioPlaybackSourceSelect.value === "vocals";
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
      if (state.audioFilePlayer !== player) return;
      validateAudioPlaybackDuration();
      updateAudioRangeCanvasWidth();
      updateAudioPlaybackReadout();
      updateAudioFileControls();
      drawAudioRangeGraph();
    });
    player.addEventListener("play", () => {
      if (state.audioFilePlayer !== player) return;
      updateAudioFileControls();
      startAudioPlaybackTracking();
    });
    const onPlaybackStopped = () => {
      if (state.audioFilePlayer !== player) return;
      updateAudioFileControls();
      stopAudioPlaybackTracking();
      updateAudioPlaybackView();
    };
    player.addEventListener("pause", onPlaybackStopped);
    player.addEventListener("ended", onPlaybackStopped);
    player.addEventListener("timeupdate", () => {
      if (state.audioFilePlayer === player) updateAudioPlaybackView();
    });
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
    playbackRequest++;
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
    const vocals = state.extractedVocals;
    if (!vocals) return;

    if (usesExtractedVocals() || state.audioFilePlayer?.src === vocals.url) {
      cleanupAudioFilePlayer();
      elements.audioPlaybackSourceSelect.value = "original";
    }
    URL.revokeObjectURL(vocals.url);
    state.extractedVocals = null;
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
    const file = state.selectedAudioFile;
    if (!file || state.operation || !isAudioContextSupported()) return;

    const controller = new AbortController();
    const estimator = state.audioPitchEstimator;
    const vocalModel = state.useVocalExtraction
      ? state.vocalSeparationModel
      : null;
    state.operation = { kind: "analysis", controller };
    startAudioAnalysisMemoryTracking();
    updateAudioFileControls();
    const report = createAudioAnalysisReporter((message) => {
      if (!controller.signal.aborted) setAudioFileStatus(message);
    });

    try {
      const { analysis, vocals } = await analyzeAudioFile(file, {
        context: getAudioContext(),
        estimator,
        vocalModel,
        report,
        signal: controller.signal,
        yieldToUi: waitForPaint,
      });
      if (controller.signal.aborted) return;
      const extractedVocals =
        vocals && vocalModel
          ? {
              audio: vocals,
              fileName: vocalDownloadName(file, vocalModel),
              url: URL.createObjectURL(createWavBlobFromDecodedAudio(vocals)),
            }
          : null;
      cleanupExtractedVocalAudioUrl();
      if (extractedVocals) {
        state.extractedVocals = extractedVocals;
        elements.audioPlaybackSourceSelect.value = "vocals";
        resetAudioFilePlayerForSelectedSource();
      }
      state.audioFileAnalysis = analysis;
      updateAudioFileReadouts(analysis);
      validateAudioPlaybackDuration();
      drawAudioRangeGraph();
    } catch (error) {
      if (controller.signal.aborted) return;
      setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
      console.error(error);
    } finally {
      state.operation = null;
      stopAudioAnalysisMemoryTracking();
      if (!controller.signal.aborted) updateAudioFileControls();
    }
  }

  async function handleExtractedVocalDownload() {
    if (state.operation) return;
    const vocals = state.extractedVocals;
    if (!vocals) {
      setAudioFileStatus(
        "保存できる抽出ボーカルがまだありません。ボーカル抽出を有効にして解析してください。",
        "error",
      );
      updateAudioFileControls();
      return;
    }

    const controller = new AbortController();
    state.operation = { kind: "download", controller };
    try {
      setAudioFileStatus("抽出ボーカルMP3を作成しています。");
      updateAudioFileControls();
      await waitForPaint();
      if (controller.signal.aborted) return;
      const blob = await createMp3BlobFromDecodedAudio(vocals.audio);
      if (controller.signal.aborted) return;
      downloadBlob(blob, vocals.fileName);
      setAudioFileStatus(
        "抽出ボーカルMP3を保存しました。ブラウザのダウンロード結果を確認してください。",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setAudioFileStatus(formatAudioFileAnalysisError(error), "error");
      console.error(error);
    } finally {
      state.operation = null;
      if (!controller.signal.aborted) updateAudioFileControls();
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

  function resolveVocalSeparationModel(value: string): VocalSeparationModelId {
    if (
      value in VOCAL_SEPARATION_MODELS &&
      VOCAL_SEPARATION_MODELS[value as VocalSeparationModelId]
        .isAvailableInBuild
    ) {
      return value as VocalSeparationModelId;
    }

    return "demucs";
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

    if (state.useVocalExtraction) {
      const model = VOCAL_SEPARATION_MODELS[state.vocalSeparationModel];
      return message
        ? `${model.label}のボーカル抽出または声域推定に失敗しました。${message}`
        : `${model.label}のボーカル抽出または声域推定に失敗しました。PC版Chrome/EdgeなどのWebGPU対応ブラウザで、短めの音源から試してください。`;
    }

    if (state.audioPitchEstimator.startsWith("crepe-")) {
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
    const cssWidth = audioRangeGraphWidth(durationSec, visibleWidth);
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

  function drawAudioRangeGraph() {
    syncAudioRangeCanvasSize();
    renderAudioRangeGraph(audioRangeCanvasContext, {
      axisContext: audioRangeAxisCanvasContext,
      pixelRatio: state.audioRangePixelRatio,
      analysis: state.audioFileAnalysis,
      durationSec: getAudioFileDurationSec(),
      playbackTime: state.audioFilePlayer
        ? getAudioPlaybackTimeSec()
        : undefined,
    });
  }

  return init();
}
