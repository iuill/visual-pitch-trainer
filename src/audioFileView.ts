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
import { createAudioFilePlayback } from "./audioFilePlayback";
import {
  AUDIO_RANGE_GRAPH_PADDING,
  audioPitchLabelAt,
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
  playbackBlob: Blob;
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
  extractedVocals: ExtractedVocals | null;
  audioFileAnalysis: AudioFileAnalysis | null;
  operation: AudioFileOperation | null;
  audioAnalysisMemoryTimerId: number | null;
  isAudioPlaybackDurationCompatible: boolean;
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
    extractedVocals: null,
    audioFileAnalysis: null,
    operation: null,
    audioAnalysisMemoryTimerId: null,
    isAudioPlaybackDurationCompatible: true,
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
    audioRangeContent: queryElement<HTMLElement>(".audio-range-content"),
    audioRangeCursor: queryElement<HTMLElement>("#audioRangeCursor"),
    audioRangeCursorTime: queryElement<HTMLElement>("#audioRangeCursorTime"),
    audioRangeCursorPitch: queryElement<HTMLElement>("#audioRangeCursorPitch"),
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
  const AUDIO_PLAYBACK_DURATION_TOLERANCE_SEC = 1;
  const AUDIO_PLAYBACK_CURSOR_HIT_RADIUS_PX = 14;
  const AUDIO_FILE_UNSUPPORTED_MESSAGE =
    "このブラウザでは音源ファイルの解析や再生ができません。別のブラウザで開いてください。";
  let graphWidth = 0;
  let viewportWidth = 0;
  let lastGraph: {
    analysis: AudioFileAnalysis | null;
    duration: number;
    pixelRatio: number;
    width: number;
    height: number;
    axisWidth: number;
  } | null = null;

  const playback = createAudioFilePlayback((event) => {
    switch (event) {
      case "metadata":
        validateAudioPlaybackDuration();
        refreshPlaybackControls();
        break;
      case "state":
        updateAudioFileControls();
        break;
      case "position":
        updateAudioPlaybackView();
        break;
    }
  });

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
        playback.clear();
        cleanupExtractedVocals();
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
    cleanupExtractedVocals();
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
    state.isAudioPlaybackDurationCompatible = true;
    const source = usesExtractedVocals()
      ? (state.extractedVocals?.playbackBlob ?? null)
      : getSelectedOriginalAudioPlaybackFile();
    playback.load(source);
  }

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

    if (!playback.hasSource()) resetAudioFilePlayerForSelectedSource();
    if (playback.isPlaying()) return;

    if (!validateAudioPlaybackDuration()) {
      refreshPlaybackControls();
      return;
    }

    try {
      await playback.play();
    } catch (error) {
      setAudioFileStatus(
        "音源を再生できませんでした。ブラウザの音声設定を確認してください。",
        "error",
      );
      console.error(error);
    }
  }

  function pauseAudioFilePlayback() {
    playback.pause();
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
    if (!playback.hasSource()) return;
    playback.pause();
    elements.audioRangeScroll.scrollLeft = 0;
    playback.seek(0);
    updateAudioFileControls();
  }

  function seekAudioPlayback(offsetSec: number) {
    const duration = playback.getDuration();
    const maxTime = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    playback.seek(
      Math.max(0, Math.min(maxTime, playback.getTime() + offsetSec)),
    );
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
    const isPlaying = playback.isPlaying();
    elements.playAudioFileButton.disabled = !canUsePlayback || isPlaying;
    elements.pauseAudioFileButton.disabled =
      !canUsePlayback || !playback.hasSource() || !isPlaying;
    elements.stopAudioFileButton.disabled =
      !canUsePlayback || !playback.hasSource();
    elements.audioSeekButtons.forEach((button) => {
      button.disabled = !canUsePlayback || !playback.hasSource();
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

  function cleanupExtractedVocals() {
    const vocals = state.extractedVocals;
    if (!vocals) return;
    if (usesExtractedVocals() || playback.uses(vocals.playbackBlob)) {
      playback.clear();
      elements.audioPlaybackSourceSelect.value = "original";
    }
    state.extractedVocals = null;
  }

  function updateAudioPlaybackView() {
    updateAudioPlaybackReadout();
    scrollAudioRangeToPlayback();
    updateAudioRangeCursor();
  }

  function updateAudioPlaybackReadout() {
    const currentTime = playback.getTime();
    const duration = playback.getDuration();

    const label = `${formatClockTime(currentTime)} / ${formatClockTime(duration)}`;
    if (elements.audioPlaybackTime.textContent !== label)
      elements.audioPlaybackTime.textContent = label;
  }

  function validateAudioPlaybackDuration(): boolean {
    state.isAudioPlaybackDurationCompatible = true;

    if (!state.useSeparatePlaybackAudio || !hasPlayableAudioFileAnalysis()) {
      return true;
    }

    const analysisDuration = state.audioFileAnalysis?.summary.durationSec;
    const playbackDuration = playback.getDuration();

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
      playback.pause();

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
    const durationSec = playback.getDuration();
    if (!playback.isPlaying() || durationSec <= 0) {
      return;
    }

    const x = (playback.getTime() / durationSec) * graphWidth;
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
              playbackBlob: createWavBlobFromDecodedAudio(vocals),
            }
          : null;
      cleanupExtractedVocals();
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
    const { top, bottom, left, right } = AUDIO_RANGE_GRAPH_PADDING;
    const { style } = elements.audioRangeCursor;
    style.setProperty("--audio-plot-top", `${top}px`);
    style.setProperty("--audio-plot-bottom", `${bottom}px`);
    style.setProperty("--audio-plot-left", `${left}px`);
    style.setProperty("--audio-plot-right", `${right}px`);
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
      const observer = new ResizeObserverClass(drawAudioRangeGraph);
      observer.observe(elements.audioRangeScroll);
      state.audioRangeResizeObserver = observer;
      return;
    }

    state.audioRangeResizeHandler = drawAudioRangeGraph;
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
    if (!playback.hasSource() || !isPointerNearAudioPlaybackCursor(event)) {
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
    const durationSec = getAudioFileDurationSec();
    if (!playback.hasSource() || durationSec <= 0) {
      return;
    }

    playback.seek(getAudioTimeFromPointer(event, durationSec));
  }

  function isPointerNearAudioPlaybackCursor(event: PointerEvent): boolean {
    const durationSec = getAudioFileDurationSec();
    if (!playback.hasSource() || durationSec <= 0) {
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
    const canvasWidth = graphWidth;
    const plotWidth =
      canvasWidth -
      AUDIO_RANGE_GRAPH_PADDING.left -
      AUDIO_RANGE_GRAPH_PADDING.right;
    const ratio =
      (pointerX - AUDIO_RANGE_GRAPH_PADDING.left) / Math.max(1, plotWidth);

    return Math.max(0, Math.min(durationSec, ratio * durationSec));
  }

  function getAudioPlaybackCursorX(durationSec: number): number {
    const canvasWidth = graphWidth;
    const plotWidth =
      canvasWidth -
      AUDIO_RANGE_GRAPH_PADDING.left -
      AUDIO_RANGE_GRAPH_PADDING.right;
    const currentTime = Math.max(0, Math.min(durationSec, playback.getTime()));

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
    viewportWidth = elements.audioRangeScroll.clientWidth;
    const rangeWidth = audioRangeGraphWidth(
      getAudioFileDurationSec(),
      Math.max(1, viewportWidth),
    );
    const widthStyle = `${rangeWidth}px`;
    if (elements.audioRangeContent.style.width !== widthStyle)
      elements.audioRangeContent.style.width = widthStyle;

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
    graphWidth = backingSize.width / backingSize.pixelRatio;

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

  function getAudioFileDurationSec(): number {
    const analysisDuration = state.audioFileAnalysis?.summary.durationSec;
    if (analysisDuration !== undefined && Number.isFinite(analysisDuration)) {
      return analysisDuration;
    }

    return playback.getDuration();
  }

  function drawAudioRangeGraph() {
    if (elements.audioFileView.hidden) return;
    syncAudioRangeCanvasSize();
    const graph = {
      analysis: state.audioFileAnalysis,
      duration: getAudioFileDurationSec(),
      pixelRatio: state.audioRangePixelRatio,
      width: elements.audioRangeCanvas.width,
      height: elements.audioRangeCanvas.height,
      axisWidth: elements.audioRangeAxisCanvas.width,
    };

    if (
      !lastGraph ||
      lastGraph.analysis !== graph.analysis ||
      lastGraph.duration !== graph.duration ||
      lastGraph.pixelRatio !== graph.pixelRatio ||
      lastGraph.width !== graph.width ||
      lastGraph.height !== graph.height ||
      lastGraph.axisWidth !== graph.axisWidth
    ) {
      renderAudioRangeGraph(audioRangeCanvasContext, {
        axisContext: audioRangeAxisCanvasContext,
        pixelRatio: graph.pixelRatio,
        analysis: graph.analysis,
        durationSec: graph.duration,
      });
      lastGraph = graph;
    }
    updateAudioRangeCursor();
  }

  function updateAudioRangeCursor() {
    const duration = getAudioFileDurationSec();
    const analysis = state.audioFileAnalysis;
    const cursor = elements.audioRangeCursor;
    if (
      !analysis ||
      analysis.summary.validFrames === 0 ||
      !playback.hasSource() ||
      duration <= 0
    ) {
      cursor.hidden = true;
      return;
    }

    const time = Math.max(0, Math.min(duration, playback.getTime()));
    cursor.hidden = false;
    cursor.style.setProperty(
      "--audio-cursor-x",
      `${getAudioPlaybackCursorX(duration)}px`,
    );
    const timeLabel = formatClockTime(time);
    if (elements.audioRangeCursorTime.textContent !== timeLabel)
      elements.audioRangeCursorTime.textContent = timeLabel;

    const pitchLabel = audioPitchLabelAt(analysis.points, time * 1000);
    elements.audioRangeCursorPitch.hidden = pitchLabel === null;
    if (elements.audioRangeCursorPitch.textContent !== pitchLabel)
      elements.audioRangeCursorPitch.textContent = pitchLabel;
  }

  return init();
}
