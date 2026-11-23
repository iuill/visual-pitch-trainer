import type { CommonSettings } from "./commonSettings";
import { queryElement } from "./dom";
import {
  createInitialGameEffectState,
  getComboTier,
  updateGameEffectState,
} from "./gameEffects";
import { type MicrophoneCapture, PRACTICE_MIN_CLARITY } from "./microphone";
import { buildNoteRange, type Note } from "./pitchMath";
import type { PracticeReadout } from "./practiceReadout";
import {
  addSampleToSession,
  createInitialSessionStats,
  createPitchSample,
  createSessionSummary,
  formatAnalysisStatus,
  MAX_STABLE_SAMPLE_GAP_MS,
  type PitchSample,
  resolveAnalysisStatus,
  trimSamples,
} from "./session";
import {
  COMBO_MILESTONE_DURATION_MS,
  drawSinglePracticeGraph,
  GRAPH_SECONDS,
  LANDING_RIPPLE_DURATION_MS,
} from "./singlePracticeGraph";

type BestRecords = {
  score: number;
  comboMs: number;
};

const MAX_LANDING_RIPPLES = 8;
const MAX_COMBO_MILESTONES = 4;
const BEST_RECORDS_STORAGE_KEY = "visual-pitch-trainer:best-records";

export function createSinglePracticeView(
  settings: CommonSettings,
  controls: {
    readout: PracticeReadout;
    isActive(): boolean;
    targetChanged(frequency: number): void;
  },
) {
  const state = {
    target: buildNoteRange(settings.getSettings().startMidi)[0],
    session: createInitialSessionStats(),
    gameEffects: createInitialGameEffectState(),
    personalBest: loadBestRecords(),
  };
  const elements = {
    noteButtons: queryElement<HTMLFieldSetElement>("#noteButtons"),
    graphTargetButtons: queryElement<HTMLDivElement>("#graphTargetButtons"),
    targetFrequency: queryElement<HTMLParagraphElement>("#targetFrequency"),
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
    pitchCanvas: queryElement<HTMLCanvasElement>("#pitchCanvas"),
  };
  let status = "稽古を開始してください";

  function show(visible: boolean) {
    elements.pitchCanvas.hidden = !visible;
    if (!visible) return;
    const readout = controls.readout;
    readout.status.textContent = status;
    const sample = state.session.samples.at(-1) ?? null;
    readout.showMeters(sample);
    if (sample) {
      const { minRms, tolerance } = settings.getSettings();
      readout.describe(
        sample,
        resolveAnalysisStatus(sample, minRms, tolerance),
        state.target.name,
      );
    } else readout.clearDescription();
  }

  function onFrame(now: number, capture: MicrophoneCapture) {
    const { minRms, tolerance } = settings.getSettings();
    const { target, session } = state;
    const detection = capture.sampleTarget({
      minRms,
      minClarity: PRACTICE_MIN_CLARITY,
      targetFrequency: target.frequency,
    });
    const sample = createPitchSample(
      now,
      detection,
      detection.rms,
      target.frequency,
      session.sessionStart,
    );
    state.session = addSampleToSession(session, sample, tolerance);
    state.session.samples = trimSamples(
      state.session.samples,
      now,
      GRAPH_SECONDS,
    );
    const analysis = resolveAnalysisStatus(sample, minRms, tolerance);
    updateGameEffects(sample, analysis, now);
    setStatus(formatAnalysisStatus(analysis));
    controls.readout.showMeters(sample);
    controls.readout.describe(sample, analysis, target.name);
    updateSummary(now);
    drawGraph();
  }

  function setStatus(message: string) {
    status = message;
    controls.readout.status.textContent = message;
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
    state.target = note;
    if (controls.isActive()) resetSessionStats(performance.now());
    updateTargetDisplay();
    updateNoteButtonStates();
    controls.targetChanged(state.target.frequency);
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
    const previousIndex = buildNoteRange(previousStartMidi).findIndex(
      (note) => note.name === state.target.name,
    );
    const nextNotes = getCurrentNotes();
    state.target = nextNotes[Math.max(0, previousIndex)] ?? nextNotes[0];

    if (controls.isActive()) resetSessionStats(performance.now());
    updateTargetDisplay();
    renderNoteButtons();
    controls.targetChanged(state.target.frequency);
    drawGraph();
  }

  function getCurrentNotes(): Note[] {
    return buildNoteRange(settings.getSettings().startMidi);
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
    controls.readout.clearDescription();
    updatePersonalBestNotes();
  }

  function updateTargetDisplay() {
    elements.targetFrequency.textContent = `${state.target.name} / ${state.target.frequency.toFixed(2)} Hz`;
  }

  function drawGraph() {
    if (elements.pitchCanvas.hidden) return;
    drawSinglePracticeGraph(elements.pitchCanvas, {
      target: state.target,
      tolerance: settings.getSettings().tolerance,
      samples: state.session.samples,
      effects: state.gameEffects,
    });
  }

  return {
    init() {
      renderNoteButtons();
      updateTargetDisplay();
    },
    show,
    draw: drawGraph,
    canvas: elements.pitchCanvas,
    get frequency() {
      return state.target.frequency;
    },
    changeRange: handleNoteRangeChange,
    setStatus,
    onFrame,
    start() {
      resetSessionStats(performance.now());
      setStatus("声の軌跡を見ています");
    },
    stop() {
      commitSessionBestRecords();
      updatePersonalBestNotes();
      setStatus("稽古を停止しました");
    },
    clear() {
      resetSessionStats(controls.isActive() ? performance.now() : null);
      drawGraph();
    },
  };
}
