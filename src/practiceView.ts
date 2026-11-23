import { getAudioContext, isAudioContextSupported } from "./audioContext";
import type { CommonSettings, ReferencePlayback } from "./commonSettings";
import { queryElement } from "./dom";
import {
  createInitialGameEffectState,
  type GameEffectState,
  getComboTier,
  updateGameEffectState,
} from "./gameEffects";
import {
  createMelodyPracticeView,
  type PracticeInputStartResult,
} from "./melodyPracticeView";
import {
  formatMicrophoneError,
  type MicrophoneCapture,
  MicrophoneInput,
  PRACTICE_MIC_FFT_SIZE,
} from "./microphone";
import { detectPitchWithLibraries } from "./pitchDetection";
import { buildNoteRange, getRms, type Note } from "./pitchMath";
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
  COMBO_MILESTONE_DURATION_MS,
  drawSinglePracticeGraph,
  GRAPH_SECONDS,
  LANDING_RIPPLE_DURATION_MS,
} from "./singlePracticeGraph";

type PracticeState = {
  target: Note;
  isReferencePlaying: boolean;
  isMicStarting: boolean;
  animationId: number | null;
  session: SessionStats;
  pitchCanvasResizeObserver: ResizeObserver | null;
  pitchCanvasResizeHandler: (() => void) | null;
  gameEffects: GameEffectState;
  personalBest: BestRecords;
};

type BestRecords = {
  score: number;
  comboMs: number;
};

const MIN_CLARITY = 0.52;
const MOBILE_VIEWPORT_QUERY = "(max-width: 820px)";
const MAX_LANDING_RIPPLES = 8;
const MAX_COMBO_MILESTONES = 4;
const BEST_RECORDS_STORAGE_KEY = "visual-pitch-trainer:best-records";
export function setupPracticeView(
  settings: CommonSettings,
  playback: ReferencePlayback,
) {
  const state: PracticeState = {
    target: buildNoteRange(settings.getSettings().startMidi)[0],
    isReferencePlaying: false,
    isMicStarting: false,
    animationId: null,
    session: createInitialSessionStats(),
    pitchCanvasResizeObserver: null,
    pitchCanvasResizeHandler: null,
    gameEffects: createInitialGameEffectState(),
    personalBest: loadBestRecords(),
  };

  const elements = {
    practiceGraphTitle: queryElement<HTMLElement>("#practiceGraphTitle"),
    practiceGraphHelp: queryElement<HTMLElement>("#practiceGraphHelp"),
    noteButtons: queryElement<HTMLFieldSetElement>("#noteButtons"),
    graphTargetButtons: queryElement<HTMLDivElement>("#graphTargetButtons"),
    targetFrequency: queryElement<HTMLParagraphElement>("#targetFrequency"),
    playToneButton: queryElement<HTMLButtonElement>("#playToneButton"),
    micButton: queryElement<HTMLButtonElement>("#micButton"),
    analysisStatus: queryElement<HTMLElement>("#analysisStatus"),
    graphVolume: queryElement<HTMLElement>("#graphVolume"),
    graphClarity: queryElement<HTMLElement>("#graphClarity"),
    graphDescription: queryElement<HTMLElement>("#graphDescription"),
    comboReadout: queryElement<HTMLElement>("#comboReadout"),
    comboTierBadge: queryElement<HTMLElement>("#comboTierBadge"),
    scoreReadout: queryElement<HTMLElement>("#scoreReadout"),
    scoreSummaryReadout: queryElement<HTMLElement>("#scoreSummaryReadout"),
    bestComboReadout: queryElement<HTMLElement>("#bestComboReadout"),
    bestScoreNote: queryElement<HTMLElement>("#bestScoreNote"),
    bestComboNote: queryElement<HTMLElement>("#bestComboNote"),
    durationReadout: queryElement<HTMLElement>("#durationReadout"),
    stableReadout: queryElement<HTMLElement>("#stableReadout"),
    averageReadout: queryElement<HTMLElement>("#averageReadout"),
    recentAverageReadout: queryElement<HTMLElement>("#recentAverageReadout"),
    clearGraphButton: queryElement<HTMLButtonElement>("#clearGraphButton"),
    graphPanel: queryElement<HTMLElement>(".graph-panel"),
    pitchCanvas: queryElement<HTMLCanvasElement>("#pitchCanvas"),
  };

  type PracticeMode = "single" | "melody";
  let practiceView: PracticeMode | null = "single";
  let lastMelodySample: PitchSample | null = null;
  let singleStatus = "稽古を開始してください";

  const melody = createMelodyPracticeView(settings, playback, {
    prepare() {
      stopMicrophone();
      settings.stopPreview();
      stopReferenceTone();
    },
    start: startMicrophone,
    stop: stopMicrophone,
    isStarting: () => state.isMicStarting,
    reportStatus: (message) => {
      elements.analysisStatus.textContent = message;
    },
    setControlsLocked(locked) {
      elements.graphPanel.classList.toggle("is-melody-running", locked);
      settings.lockInputControls(locked);
      elements.clearGraphButton.disabled = locked;
      if (locked) {
        settings.close();
        elements.micButton.disabled = true;
      } else {
        updateMicButtonState("stopped");
      }
    },
  });

  function show(view: PracticeMode | null) {
    if (practiceView === "single")
      singleStatus = elements.analysisStatus.textContent;
    practiceView = view;
    const isMelody = view === "melody";
    document
      .querySelectorAll<HTMLElement>("[data-single-only]")
      .forEach((element) => {
        element.hidden = practiceView !== "single";
      });
    elements.graphPanel.hidden = view === null;
    melody.show(isMelody);
    elements.pitchCanvas.hidden = isMelody;
    elements.practiceGraphTitle.textContent = isMelody
      ? "お手本と自分の声"
      : "声の軌跡";
    elements.practiceGraphHelp.textContent = isMelody
      ? "お手本は全体を表示し、終わった音も残します。自分の声を重ねて振り返れます。"
      : "直近12秒の声の高さを、音名のレーンに沿って表示します。";
    if (isMelody) {
      elements.analysisStatus.textContent = melody.hasStoppedGraph()
        ? "停止した周回の声を表示しています。"
        : "お手本と一緒に発声して判定します。停止するまで繰り返せます。";
      updatePitchMeters(lastMelodySample);
      elements.graphDescription.textContent =
        "メロディと発声の位置をグラフに表示します。";
    } else if (view === "single") {
      elements.analysisStatus.textContent = singleStatus;
      const latest = state.session.samples.at(-1) ?? null;
      updatePitchMeters(latest);
      elements.graphDescription.textContent = latest
        ? formatGraphDescription(
            latest,
            resolveAnalysisStatus(
              latest,
              settings.getSettings().minRms,
              settings.getSettings().tolerance,
            ),
            state.target,
          )
        : "声の軌跡はまだ記録されていません。";
    }
    requestAnimationFrame(() => {
      drawGraph();
      if (isMelody) melody.followKeyboard();
    });
  }

  function init() {
    melody.init();
    renderNoteButtons();
    updateTargetDisplay();
    setupPitchCanvas();
    drawGraph();
    elements.clearGraphButton.addEventListener("click", clearSession);
    settings.onChange((key, previous) => {
      switch (key) {
        case "startMidi":
          handleNoteRangeChange(previous.startMidi);
          break;
        case "instrument":
          handleReferenceInstrumentChange();
          break;
        case "tolerance":
          melody.updateTolerance(settings.getSettings().tolerance);
          drawGraph();
          break;
        case "deviceId":
          void handleMicSelection();
          break;
      }
    });

    if (isAudioContextSupported()) {
      elements.playToneButton.addEventListener(
        "click",
        () => void toggleReferenceTone(),
      );
      elements.micButton.addEventListener("click", toggleMicrophone);
    } else {
      elements.playToneButton.disabled = true;
      elements.micButton.disabled = true;
      elements.analysisStatus.textContent =
        "このブラウザでは声の稽古を始められません。別のブラウザで開いてください。";
    }
    return { show, stop, dispose: cleanupPitchCanvasResizeWatcher };
  }

  function stop() {
    if (melody.running) melody.stop();
    stopReferenceTone();
    if (capture || state.isMicStarting) stopMicrophone();
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
    button.setAttribute(
      "aria-pressed",
      String(note.name === state.target.name),
    );
    button.innerHTML = `<strong>${note.solfege}</strong><span>${note.name}</span>`;
    button.addEventListener("click", () => {
      selectTargetNote(note);
    });
    return button;
  }

  function selectTargetNote(note: Note) {
    if (melody.running) melody.stop();
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

  function handleNoteRangeChange(previousStartMidi: number) {
    if (melody.running) melody.stop();
    const previousIndex = buildNoteRange(previousStartMidi).findIndex(
      (note) => note.name === state.target.name,
    );
    const nextNotes = getCurrentNotes();
    state.target = nextNotes[Math.max(0, previousIndex)] ?? nextNotes[0];

    resetActiveSession();
    updateTargetDisplay();
    renderNoteButtons();
    updateReferenceToneFrequency();
    drawGraph();
    melody.refresh();
  }

  function getCurrentNotes(): Note[] {
    return buildNoteRange(settings.getSettings().startMidi);
  }

  let referencePlaybackRequestId = 0;
  const microphone = new MicrophoneInput();
  let capture: MicrophoneCapture | null = null;
  let microphoneStart: symbol | null = null;
  function handleReferenceInstrumentChange() {
    const wasPlaying = state.isReferencePlaying;
    stopReferenceTone();
    melody.stop();
    if (wasPlaying) void startReferenceTone();
  }

  async function toggleReferenceTone() {
    if (state.isReferencePlaying) {
      stopReferenceTone();
      return;
    }
    await startReferenceTone();
  }

  async function startReferenceTone() {
    settings.stopPreview();
    melody.stop();
    const requestId = ++referencePlaybackRequestId;
    const instrument = settings.getSettings().instrument;
    state.isReferencePlaying = true;
    elements.playToneButton.classList.add("is-active");
    elements.playToneButton.innerHTML = `<span aria-hidden="true">■</span>停止`;
    elements.playToneButton.setAttribute("aria-pressed", "true");
    settings.showReferencePreparing();
    try {
      const context = getAudioContext();
      const player = playback.getPlayer();
      await player.prepare(instrument);
      if (requestId !== referencePlaybackRequestId) return;
      await context.resume();
      if (requestId !== referencePlaybackRequestId) return;
      player.startReference(instrument, state.target.frequency);
      settings.resetReferenceStatus();
    } catch (error) {
      if (requestId !== referencePlaybackRequestId) return;
      stopReferenceTone();
      settings.reportReferenceError(error);
    }
  }

  function stopReferenceTone() {
    referencePlaybackRequestId++;
    playback.getCurrentPlayer()?.stopReference();
    state.isReferencePlaying = false;
    elements.playToneButton.classList.remove("is-active");
    elements.playToneButton.innerHTML = `<span aria-hidden="true">▶</span>お手本音`;
    elements.playToneButton.setAttribute("aria-pressed", "false");
    settings.resetReferenceStatus();
  }

  function updateReferenceToneFrequency() {
    playback.getCurrentPlayer()?.setFrequency(state.target.frequency);
  }

  async function toggleMicrophone() {
    if (state.isMicStarting || melody.running) {
      return;
    }

    if (capture) {
      stopMicrophone();
      return;
    }

    await requestMicrophone();
  }

  async function requestMicrophone(switching = false) {
    const request = Symbol();
    microphoneStart = request;
    state.isMicStarting = true;
    updateMicButtonState("starting");
    try {
      const result = await startMicrophone();
      if (microphoneStart === request && !result.ok && result.message) {
        elements.analysisStatus.textContent = result.message;
      }
    } catch (error) {
      if (microphoneStart !== request) return;
      elements.analysisStatus.textContent = switching
        ? "選択したマイクで稽古を始められませんでした。別の入力を選択してください。"
        : formatMicrophoneError(error);
      if (switching) settings.showMicrophoneSwitchError();
      console.error(error);
    } finally {
      if (microphoneStart === request) {
        microphoneStart = null;
        state.isMicStarting = false;
        if (!capture) updateMicButtonState("stopped");
      }
    }
  }

  async function startMicrophone(): Promise<PracticeInputStartResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        message:
          "この表示方法ではマイクを使えません。HTTPSのURL、またはlocalhostで開いてください。",
      };
    }

    const input = await microphone.start(getAudioContext(), {
      deviceId: settings.getSettings().deviceId,
      fftSize: PRACTICE_MIC_FFT_SIZE,
      onEnded() {
        if (melody.running) melody.stop();
        else stopMicrophone();
        elements.analysisStatus.textContent =
          "マイクが切断されました。接続を確認して、もう一度開始してください。";
      },
    });
    if (!input) return { ok: false };
    capture = input;
    if (melody.running) {
      lastMelodySample = null;
      updatePitchMeters(null);
    } else {
      resetSessionStats(performance.now());
    }

    updateMicButtonState("active");
    elements.analysisStatus.textContent = "声の軌跡を見ています";

    await settings.refreshAudioDevices(() => capture !== null);
    if (capture !== input) return { ok: false };
    settings.showActiveMicrophone(input.stream.getAudioTracks()[0]);
    focusGraphForPractice();

    state.animationId = requestAnimationFrame(analyzeFrame);
    return { ok: true };
  }

  function focusGraphForPractice() {
    if (!window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
      return;
    }
    settings.close();

    requestAnimationFrame(() => {
      elements.graphPanel.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function stopMicrophone() {
    microphoneStart = null;
    state.isMicStarting = false;
    microphone.stop();
    capture = null;
    if (state.animationId !== null) {
      cancelAnimationFrame(state.animationId);
    }
    state.animationId = null;

    commitSessionBestRecords();
    updatePersonalBestNotes();
    updateMicButtonState("stopped");
    elements.analysisStatus.textContent = "稽古を停止しました";
  }

  function updateMicButtonState(status: "active" | "starting" | "stopped") {
    elements.micButton.disabled = status === "starting" || melody.running;
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
    if (state.isMicStarting || !capture) return;
    stopMicrophone();
    await requestMicrophone(true);
  }

  function analyzeFrame(now: number) {
    const position = melody.tick(false);
    if (!capture) return;

    if (melody.running && position?.phase !== "sing") {
      elements.analysisStatus.textContent =
        "準備中です。3秒後からお手本と一緒に発声してください。";
      state.animationId = requestAnimationFrame(analyzeFrame);
      return;
    }

    const { minRms, tolerance } = settings.getSettings();
    const buffer = capture.read();
    const volume = getRms(buffer);
    const target = melody.noteAt(position?.index) ?? state.target;
    const detection = detectPitchWithLibraries(buffer, capture.detectors, {
      minRms,
      minClarity: MIN_CLARITY,
      targetFrequency: target.frequency,
    });
    const sample = createPitchSample(
      now,
      detection,
      volume,
      target.frequency,
      position ? null : state.session.sessionStart,
    );
    if (position?.phase === "sing") {
      const inGracePeriod = melody.record(position, sample, volume >= minRms);
      if (inGracePeriod) sample.centsFromTarget = null;
      lastMelodySample = sample;
      updatePitchMeters(sample);
      const status = resolveAnalysisStatus(sample, minRms, tolerance);
      elements.analysisStatus.textContent = inGracePeriod
        ? "周回開始の猶予中です（各周回の最初の0.4秒は判定しません）"
        : formatAnalysisStatus(status);
      elements.graphDescription.textContent = formatGraphDescription(
        sample,
        status,
        target,
      );
    } else {
      state.session = addSampleToSession(state.session, sample, tolerance);
      state.session = {
        ...state.session,
        samples: trimSamples(state.session.samples, now, GRAPH_SECONDS),
      };
      updateSingleReadouts(sample, now, target);
    }
    drawGraph();

    state.animationId = requestAnimationFrame(analyzeFrame);
  }

  function updateSingleReadouts(
    sample: PitchSample,
    now: number,
    target: Note,
  ) {
    const { minRms, tolerance } = settings.getSettings();
    const status = resolveAnalysisStatus(sample, minRms, tolerance);
    updateGameEffects(sample, status, now);
    elements.analysisStatus.textContent = formatAnalysisStatus(status);
    elements.graphDescription.textContent = formatGraphDescription(
      sample,
      status,
      target,
    );

    updatePitchMeters(sample);
    updateSummary(now);
  }

  function updatePitchMeters(sample: PitchSample | null) {
    elements.graphVolume.textContent = sample
      ? `${Math.round(Math.min(sample.volume * 500, 100))}%`
      : "--";
    const clarity = sample?.clarity;
    elements.graphClarity.textContent =
      clarity == null ? "--" : `${Math.round(clarity * 100)}%`;
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
      tolerance: settings.getSettings().tolerance,
      now,
      maxStableGapMs: MAX_STABLE_SAMPLE_GAP_MS,
      rippleDurationMs: LANDING_RIPPLE_DURATION_MS,
      maxRipples: MAX_LANDING_RIPPLES,
      milestoneDurationMs: COMBO_MILESTONE_DURATION_MS,
      maxMilestones: MAX_COMBO_MILESTONES,
    });
    elements.comboReadout.textContent =
      state.gameEffects.stableComboMs > 0
        ? `${(state.gameEffects.stableComboMs / 1000).toFixed(1)}秒`
        : "--";
    elements.scoreReadout.textContent = formatScore(state.gameEffects.score);
    updateComboTierBadge();
  }

  function updateComboTierBadge() {
    const tier = getComboTier(state.gameEffects.stableComboMs);

    if (tier.label === null || state.gameEffects.stableComboMs <= 0) {
      elements.comboTierBadge.hidden = true;
      return;
    }

    elements.comboTierBadge.hidden = false;
    elements.comboTierBadge.textContent = `${tier.label} ×${tier.multiplier}`;
    elements.comboTierBadge.dataset.tier = String(tier.level);
  }

  function formatScore(score: number): string {
    return Math.round(score).toLocaleString("ja-JP");
  }

  function loadBestRecords(): BestRecords {
    try {
      const raw = localStorage.getItem(BEST_RECORDS_STORAGE_KEY);

      if (!raw) {
        return { score: 0, comboMs: 0 };
      }

      const parsed = JSON.parse(raw) as Partial<BestRecords>;

      return {
        score:
          typeof parsed.score === "number" && Number.isFinite(parsed.score)
            ? Math.max(0, parsed.score)
            : 0,
        comboMs:
          typeof parsed.comboMs === "number" && Number.isFinite(parsed.comboMs)
            ? Math.max(0, parsed.comboMs)
            : 0,
      };
    } catch {
      return { score: 0, comboMs: 0 };
    }
  }

  function saveBestRecords(records: BestRecords) {
    try {
      localStorage.setItem(BEST_RECORDS_STORAGE_KEY, JSON.stringify(records));
    } catch {
      // localStorageが使えない環境では自己ベストを永続化しない
    }
  }

  function commitSessionBestRecords() {
    const sessionScore = Math.round(state.gameEffects.score);
    const sessionComboMs = state.gameEffects.bestComboMs;
    const next: BestRecords = {
      score: Math.max(state.personalBest.score, sessionScore),
      comboMs: Math.max(state.personalBest.comboMs, sessionComboMs),
    };

    if (
      next.score !== state.personalBest.score ||
      next.comboMs !== state.personalBest.comboMs
    ) {
      state.personalBest = next;
      saveBestRecords(next);
    }
  }

  function updatePersonalBestNotes() {
    const sessionScore = Math.round(state.gameEffects.score);
    const isScoreRecord = sessionScore > state.personalBest.score;
    const isComboRecord =
      state.gameEffects.bestComboMs > state.personalBest.comboMs;

    elements.bestScoreNote.textContent = isScoreRecord
      ? "✨ 自己ベスト更新中!"
      : `自己ベスト: ${
          state.personalBest.score > 0
            ? formatScore(state.personalBest.score)
            : "--"
        }`;
    elements.bestScoreNote.classList.toggle("is-new-record", isScoreRecord);

    elements.bestComboNote.textContent = isComboRecord
      ? "✨ 自己ベスト更新中!"
      : `自己ベスト: ${
          state.personalBest.comboMs > 0
            ? `${(state.personalBest.comboMs / 1000).toFixed(1)}秒`
            : "--"
        }`;
    elements.bestComboNote.classList.toggle("is-new-record", isComboRecord);
  }

  function updateSummary(now: number) {
    const summary = createSessionSummary(state.session, now);

    elements.durationReadout.textContent = `${summary.elapsedSec.toFixed(1)} 秒`;
    elements.stableReadout.textContent = `${summary.stableSec.toFixed(1)} 秒`;
    elements.averageReadout.textContent = summary.formattedOverallAverage;
    elements.recentAverageReadout.textContent = summary.formattedRecentAverage;
    elements.scoreSummaryReadout.textContent = formatScore(
      state.gameEffects.score,
    );
    elements.bestComboReadout.textContent = `${(
      state.gameEffects.bestComboMs / 1000
    ).toFixed(1)} 秒`;
    updatePersonalBestNotes();
  }

  function clearSession() {
    if (practiceView === "melody") {
      melody.clearGraph();
      lastMelodySample = null;
      updatePitchMeters(null);
    } else {
      resetSessionStats(capture ? performance.now() : null);
    }
    drawGraph();
  }

  function resetActiveSession() {
    if (!capture) {
      return;
    }

    resetSessionStats(performance.now());
  }

  function resetSessionStats(startAt: number | null) {
    commitSessionBestRecords();
    state.session = createInitialSessionStats(startAt);
    state.gameEffects = createInitialGameEffectState();
    elements.comboReadout.textContent = "--";
    elements.comboTierBadge.hidden = true;
    elements.scoreReadout.textContent = "--";
    elements.durationReadout.textContent = "0.0 秒";
    elements.stableReadout.textContent = "0.0 秒";
    elements.averageReadout.textContent = "--";
    elements.recentAverageReadout.textContent = "--";
    elements.scoreSummaryReadout.textContent = "0";
    elements.bestComboReadout.textContent = "0.0 秒";
    elements.graphDescription.textContent =
      "声の軌跡はまだ記録されていません。";
    updatePersonalBestNotes();
  }

  function formatGraphDescription(
    sample: PitchSample,
    status: ReturnType<typeof resolveAnalysisStatus>,
    target: Note,
  ): string {
    if (sample.frequency === null || sample.centsFromTarget === null) {
      return `直近の状態: ${formatAnalysisStatus(status)}。声量は${Math.round(
        Math.min(sample.volume * 500, 100),
      )}%、音程検出は${
        sample.clarity === null
          ? "不明"
          : `${Math.round(sample.clarity * 100)}%`
      }です。`;
    }

    const { tolerance } = settings.getSettings();
    const direction =
      sample.centsFromTarget > tolerance
        ? "高め"
        : sample.centsFromTarget < -tolerance
          ? "低め"
          : "範囲内";

    return `直近の声は${sample.note ?? "不明"}、目標${target.name}に対して半音の${Math.round(
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

  function setupPitchCanvas() {
    cleanupPitchCanvasResizeWatcher();

    const ResizeObserverClass = globalThis.ResizeObserver;
    if (ResizeObserverClass) {
      const observer = new ResizeObserverClass(() => {
        drawGraph();
        if (practiceView === "melody") melody.followKeyboard();
      });
      observer.observe(elements.pitchCanvas);
      observer.observe(melody.graphScroll);
      state.pitchCanvasResizeObserver = observer;
      return;
    }

    state.pitchCanvasResizeHandler = () => {
      drawGraph();
      if (practiceView === "melody") melody.followKeyboard();
    };
    window.addEventListener("resize", state.pitchCanvasResizeHandler);
  }

  function cleanupPitchCanvasResizeWatcher() {
    state.pitchCanvasResizeObserver?.disconnect();
    state.pitchCanvasResizeObserver = null;

    if (state.pitchCanvasResizeHandler) {
      window.removeEventListener("resize", state.pitchCanvasResizeHandler);
      state.pitchCanvasResizeHandler = null;
    }
  }

  function drawGraph() {
    if (practiceView === "melody") {
      melody.draw();
      return;
    }
    if (practiceView === null) return;

    drawSinglePracticeGraph(elements.pitchCanvas, {
      target: state.target,
      tolerance: settings.getSettings().tolerance,
      samples: state.session.samples,
      effects: state.gameEffects,
    });
  }

  return init();
}
