import { AnimationLoop } from "./animationLoop";
import { getAudioContext } from "./audioContext";
import { queryElement } from "./dom";
import { midiToFrequency } from "./pitchMath";
import { ReferencePlayer } from "./referencePlayer";
import {
  CALIBRATION_BEAT_MS,
  CALIBRATION_COUNTDOWN_MS,
  CALIBRATION_TAPS,
  calibrationTapIndex,
  measureRhythmOffset,
  type RhythmGuide,
  rhythmEventTimeMs,
} from "./rhythmCalibration";
import {
  createRhythmBars,
  getRhythmNoteValue,
  getRhythmRestValue,
  RHYTHM_CHAPTERS,
  RHYTHM_NOTE_BEATS,
  RHYTHM_STEPS,
  type RhythmNoteValue,
  type RhythmRestValue,
  type RhythmStep,
  rhythmSlotsPerBeat,
} from "./rhythmCourse";
import {
  collectOmittedRhythmNotes,
  createRhythmTargets,
  judgeRhythmTap,
  RHYTHM_BEGINNER_PASS_RATE,
  RHYTHM_HISTOGRAM_LABELS,
  RHYTHM_MATCH_MS,
  type RhythmHit,
  summarizeRhythm,
} from "./rhythmJudge";
import {
  createRhythmProgressStore,
  newRhythmProgress,
  recordRhythmAttempt,
  rhythmStepUnlocked,
} from "./rhythmProgressStore";
import {
  type RhythmCount,
  type RhythmCue,
  RhythmScheduler,
} from "./rhythmScheduler";

const gradeLabels = {
  perfect: "◎ ぴったり",
  close: "○ ちょっとずれ",
  miss: "× ミス",
};
const gradeSymbols = { perfect: "◎", close: "○", miss: "×" };
const noteNotation: Record<RhythmNoteValue, string> = {
  whole: "全音符",
  "dotted-half": "付点2分音符",
  half: "2分音符",
  "dotted-quarter": "付点4分音符",
  quarter: "4分音符",
  "triplet-eighth": "8分音符（三連符）",
  "dotted-eighth": "付点8分音符",
  eighth: "8分音符",
  sixteenth: "16分音符",
};
const restNotation: Record<RhythmRestValue, string> = {
  quarter: "4分休符",
  eighth: "8分休符",
};
const linePercent = 18;
const beatPercent = 30;
const timingPulseMs = 100;
const hitStampMs = 550;
const countdownSeconds = CALIBRATION_COUNTDOWN_MS / 1000;
const practiceReadyMs = 3000;
const practiceCountInBars = 2;
const rhythmTapLabel = "タップ（スペースキー）";

function rhythmMeterAndTempo(step: RhythmStep) {
  return `${step.beatsPerBar ?? 4}/4拍子・${step.bpm} BPM`;
}

function rhythmBeatLabel(beat: number, part: number, slotsPerBeat: number) {
  if (part === 0) return `${beat}拍目`;
  return slotsPerBeat === 2 || (slotsPerBeat === 4 && part === 2)
    ? `${beat}拍目の裏`
    : `${beat}拍目の${part + 1}つ目`;
}

function createCountdown(startMs: number): RhythmCue[] {
  return ([3, 2, 1] as const).map((countdown, index) => ({
    timeMs: startMs + index * 1000,
    countdown,
  }));
}

function countdownText(elapsedMs: number) {
  return String(Math.min(countdownSeconds, Math.ceil(-elapsedMs / 1000)));
}

function createFootprint() {
  const icon = document.createElement("span");
  icon.className = "rhythm-footprint";
  return icon;
}

function createNoteIcon(value: RhythmNoteValue) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.classList.add("rhythm-note-icon");
  icon.dataset.noteValue = value;
  icon.setAttribute("viewBox", "0 0 28 28");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("aria-hidden", "true");
  if (value !== "whole") {
    const stem = document.createElementNS(svgNamespace, "path");
    stem.setAttribute(
      "d",
      RHYTHM_NOTE_BEATS[value] < 1
        ? "M17.5 21V3h2c.6 2.4 2.3 3.7 4 5 1.5 1.2 2.5 2.5 2.5 4.5 0 1.6-.6 2.9-1.7 4 .6-1.4.6-2.6.1-3.5-.8-1.6-2.6-2.3-4.9-3.1V21Z"
        : "M18 20V3h2v17Z",
    );
    icon.append(stem);
    if (value === "sixteenth") {
      const secondFlag = stem.cloneNode() as SVGPathElement;
      secondFlag.setAttribute("transform", "translate(0 5)");
      icon.append(secondFlag);
    }
  }
  const head = document.createElementNS(svgNamespace, "ellipse");
  head.setAttribute("cx", "14");
  head.setAttribute("cy", value === "whole" ? "14" : "21");
  head.setAttribute("rx", value === "whole" ? "7" : "6");
  head.setAttribute("ry", "3.9");
  if (value !== "whole") head.setAttribute("transform", "rotate(-20 14 21)");
  if (value === "whole" || value === "half" || value === "dotted-half") {
    head.setAttribute("fill", "none");
    head.setAttribute("stroke", "currentColor");
    head.setAttribute("stroke-width", "2.2");
  }
  icon.append(head);
  if (value.startsWith("dotted-")) {
    const dot = document.createElementNS(svgNamespace, "circle");
    dot.setAttribute("cx", "24");
    dot.setAttribute("cy", "20");
    dot.setAttribute("r", "1.8");
    icon.append(dot);
  }
  return icon;
}

function createRestIcon(value: RhythmRestValue) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.classList.add("rhythm-rest-icon");
  icon.dataset.restValue = value;
  icon.setAttribute("viewBox", "0 0 24 28");
  icon.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(svgNamespace, "path");
  shape.setAttribute("fill", "currentColor");
  shape.setAttribute(
    "d",
    value === "eighth"
      ? "M9 7a3 3 0 1 0 2.9 3.5c1.6.2 3-.2 4.8-1.3L11 25h2l7-20h-2c-1.1 2.5-3.4 4.4-6.8 3.4A3 3 0 0 0 9 7Z"
      : "M10 1.5 17 9l-5 5 4 6c-2.6-1.34-5-.9-5.5 1.2-.4 1.65.6 3.3 2.8 4.8-3.8-.5-6.1-3.1-5.3-5.8.45-1.52 1.7-2.58 3.55-2.92l-4-5.38 4.8-5.05Z",
  );
  icon.append(shape);
  return icon;
}

function melodyNotes(
  pitches: readonly number[],
  targets: ReturnType<typeof createRhythmTargets>,
  bpm: number,
  startMs: number,
) {
  return targets.map((target, index) => ({
    frequency: midiToFrequency(pitches[index]),
    seconds: (RHYTHM_NOTE_BEATS[target.noteValue] * 60) / bpm,
    offsetSeconds: (target.timeMs - startMs) / 1000,
  }));
}

function offsetLabel(offset: number) {
  return `${Math.abs(Math.round(offset))}ms ${offset < 0 ? "早い" : "遅い"}`;
}

function calibrationLabel(offset: number | null | undefined, date?: string) {
  if (offset == null) return "未測定";
  const measured = `${Math.round(offset)}ms`;
  return date
    ? `${measured}（${new Date(date).toLocaleDateString("ja-JP")}）`
    : measured;
}

function hitLabel(hit: RhythmHit) {
  if (hit.reason === "extra") return "× ミス（余分なタップ）";
  if (hit.reason === "omitted") return "× ミス（叩き忘れ）";
  return hit.offsetMs
    ? `${gradeLabels[hit.grade]}（${offsetLabel(hit.offsetMs)}）`
    : gradeLabels[hit.grade];
}

function remainingPassLabel(remaining: number, opensNext: boolean) {
  const passes =
    remaining === 1 ? "あと1回合格" : `あと${remaining}回連続で合格`;
  return `${passes}すると、${opensNext ? "次のステップに進めます" : "このステップをクリアできます"}。`;
}

export function setupRhythmPractice(stopPreview: () => void) {
  const root = queryElement<HTMLElement>("#rhythmPracticeView");
  const setup = queryElement<HTMLElement>("#rhythmSetup");
  const stepSelect = queryElement<HTMLSelectElement>("#rhythmStep");
  const stepInfo = queryElement<HTMLElement>("#rhythmStepInfo");
  const unlockMessage = queryElement<HTMLElement>("#rhythmUnlockMessage");
  const unlockCount = queryElement<HTMLElement>("#rhythmUnlockCount");
  const unlockProgress = queryElement<HTMLProgressElement>(
    "#rhythmUnlockProgress",
  );
  const hint = queryElement<HTMLElement>("#rhythmHint");
  const examples = queryElement<HTMLElement>("#rhythmPatterns");
  const examplesDetails = queryElement<HTMLDetailsElement>("#rhythmExamples");
  const exampleBars = queryElement<HTMLDetailsElement>("#rhythmExampleBars");
  const exampleBarsLabel = queryElement<HTMLElement>("#rhythmExampleBarsLabel");
  const examplePlayAll = queryElement<HTMLButtonElement>(
    "#rhythmExamplePlayAll",
  );
  const exampleVoice = queryElement<HTMLInputElement>("#rhythmExampleVoice");
  const exampleHelp = queryElement<HTMLElement>("#rhythmExampleHelp");
  const exampleStatus = queryElement<HTMLElement>("#rhythmExampleStatus");
  const patternLegend = queryElement<HTMLUListElement>("#rhythmPatternLegend");
  const start = queryElement<HTMLButtonElement>("#rhythmStart");
  const visualCalibration = queryElement<HTMLButtonElement>(
    "#rhythmVisualCalibration",
  );
  const clearVisualCalibration = queryElement<HTMLButtonElement>(
    "#rhythmClearVisualCalibration",
  );
  const audioCalibration = queryElement<HTMLButtonElement>(
    "#rhythmAudioCalibration",
  );
  const calibrationInfo = queryElement<HTMLElement>("#rhythmCalibrationInfo");
  const sound = queryElement<HTMLSelectElement>("#rhythmSound");
  const countVoice = queryElement<HTMLSelectElement>("#rhythmCountVoice");
  const volume = queryElement<HTMLInputElement>("#rhythmVolume");
  const effects = queryElement<HTMLInputElement>("#rhythmEffects");
  const freePlay = queryElement<HTMLInputElement>("#rhythmFreePlay");
  const guide = queryElement<HTMLSelectElement>("#rhythmGuide");
  const reset = queryElement<HTMLButtonElement>("#rhythmReset");
  const warning = queryElement<HTMLElement>("#rhythmStorageWarning");
  const stage = queryElement<HTMLElement>("#rhythmStage");
  const activeStep = queryElement<HTMLElement>("#rhythmActiveStep");
  const activeStepLabel = queryElement<HTMLElement>("#rhythmActiveStepLabel");
  const activeMeter = queryElement<HTMLElement>("#rhythmActiveMeter");
  const title = queryElement<HTMLElement>("#rhythmActiveTitle");
  const phase = queryElement<HTMLElement>("#rhythmPhase");
  const loading = queryElement<HTMLElement>("#rhythmLoading");
  const count = queryElement<HTMLElement>("#rhythmCount");
  const score = queryElement<HTMLElement>("#rhythmScore");
  const scoreLabel = queryElement<HTMLElement>("#rhythmScoreLabel");
  const scoreBars = queryElement<HTMLOListElement>("#rhythmScoreBars");
  const scoreExtras = queryElement<HTMLElement>("#rhythmScoreExtras");
  const lanes = queryElement<HTMLElement>("#rhythmLanes");
  const markers = queryElement<HTMLElement>("#rhythmMarkers");
  const inputHelp = queryElement<HTMLElement>("#rhythmInputHelp");
  const tap = queryElement<HTMLButtonElement>("#rhythmTap");
  const tapLabel = queryElement<HTMLElement>("#rhythmTapLabel");
  const stopButton = queryElement<HTMLButtonElement>("#rhythmStop");
  const feedback = queryElement<HTMLElement>("#rhythmFeedback");
  const hitFeedback = queryElement<HTMLElement>("#rhythmHitFeedback");
  const resultPanel = queryElement<HTMLElement>("#rhythmResult");
  const stats = queryElement<HTMLElement>("#rhythmStats");
  const average = queryElement<HTMLElement>("#rhythmAverage");
  const passRate = queryElement<HTMLElement>("#rhythmPassRate");
  const histogram = queryElement<HTMLElement>("#rhythmHistogram");
  const next = queryElement<HTMLButtonElement>("#rhythmNext");
  const retry = queryElement<HTMLButtonElement>("#rhythmRetry");
  root.style.setProperty("--rhythm-line", `${linePercent}%`);

  const store = createRhythmProgressStore(() => {
    warning.textContent = "進捗はこのブラウザに保存されません。";
  });
  const loop = new AnimationLoop();
  let progress = newRhythmProgress();
  let settings = store.loadSettings();
  let calibration = store.loadCalibration();
  let loadedProgress = false;
  let scheduler: RhythmScheduler | null = null;
  let melodyPlayer: ReferencePlayer | null = null;
  let generation = 0;
  let acceptTap: ((timestamp: number) => void) | null = null;
  let preparedBars: string[] | null = null;
  let activeExample: {
    cards: readonly HTMLElement[];
    button: HTMLButtonElement;
    label: string;
  } | null = null;

  function currentStep() {
    return (
      RHYTHM_STEPS.find((step) => step.id === progress.currentStepId) ??
      RHYTHM_STEPS[0]
    );
  }

  function stepSelectable(step: ReturnType<typeof currentStep>) {
    return settings.freePlay || rhythmStepUnlocked(progress, step);
  }

  function positionPracticeStart() {
    const insideExamples = start.parentElement === examplesDetails;
    const beforeBars = Boolean(currentStep().melody && examplesDetails.open);
    if (beforeBars === insideExamples) return;
    if (beforeBars) exampleBars.before(start);
    else examplesDetails.after(start);
  }

  function showSetup() {
    stopExample();
    exampleStatus.textContent = "";
    setup.hidden = false;
    stage.hidden = true;
    sound.value = settings.sound;
    countVoice.value = settings.countVoice;
    countVoice.disabled = settings.sound !== "voice" && !settings.exampleVoice;
    volume.value = String(settings.volume * 100);
    effects.checked = settings.effects;
    freePlay.checked = settings.freePlay;
    exampleVoice.checked = settings.exampleVoice;
    calibrationInfo.textContent = `視覚 ${calibrationLabel(calibration?.visualOffsetMs, calibration?.measuredAt)} ／ 音 ${calibrationLabel(calibration?.audioOffsetMs, calibration?.audioMeasuredAt)}`;
    clearVisualCalibration.disabled = calibration?.visualOffsetMs == null;

    if (!stepSelectable(currentStep())) {
      const firstUncleared =
        RHYTHM_STEPS.find((item) => !progress.steps[item.id]?.cleared) ??
        RHYTHM_STEPS[0];
      progress.currentStepId = firstUncleared.id;
      store.saveProgress(progress);
      resultPanel.hidden = true;
      feedback.textContent = "";
    }
    const step = currentStep();
    guide.options[1].disabled =
      calibration?.audioOffsetMs == null ||
      (settings.sound === "none" && !step.melody) ||
      settings.volume === 0;
    if (guide.options[1].disabled) settings.guide = "visual";
    guide.value = settings.guide;
    const nextStep = RHYTHM_STEPS[RHYTHM_STEPS.indexOf(step) + 1];
    next.hidden = !nextStep || !stepSelectable(nextStep);
    stepSelect.replaceChildren(
      ...RHYTHM_CHAPTERS.map((chapter, index) => {
        const group = document.createElement("optgroup");
        group.label = `第${index + 1}章 ${chapter}`;
        for (const item of RHYTHM_STEPS.filter(
          (candidate) => candidate.chapter === index + 1,
        )) {
          const unlocked = stepSelectable(item);
          const state = progress.steps[item.id]?.cleared
            ? "（クリア）"
            : unlocked
              ? ""
              : "（未解放）";
          const option = new Option(
            `${item.id} ｜ ${rhythmMeterAndTempo(item)} ／ ${item.title}${state}`,
            item.id,
            false,
            item === step,
          );
          option.disabled = !unlocked;
          group.append(option);
        }
        return group;
      }),
    );
    const record = progress.steps[step.id];
    stepInfo.textContent = rhythmMeterAndTempo(step);
    const streak = record?.streak ?? 0;
    const cleared = record?.cleared ?? false;
    unlockMessage.textContent = cleared
      ? "このステップはクリア済みです。"
      : remainingPassLabel(
          step.requiredStreak - streak,
          !settings.freePlay && step !== RHYTHM_STEPS.at(-1),
        );
    unlockCount.hidden = cleared;
    unlockCount.textContent = `連続合格 ${streak} / ${step.requiredStreak}回`;
    unlockProgress.hidden = cleared;
    unlockProgress.max = step.requiredStreak;
    unlockProgress.value = streak;
    hint.textContent = step.hint;
    const feetOnly = step.feetOnly;
    const slotsPerBeat = rhythmSlotsPerBeat(step);
    const subdivided = step.countSubdivision !== undefined;
    const stride = subdivided ? 1 : slotsPerBeat;
    examplePlayAll.hidden = step.patterns.length < 2;
    examplePlayAll.textContent = step.melody ? "曲を通して再生" : "通しで再生";
    exampleBarsLabel.hidden = !step.melody;
    if (!step.melody) exampleBars.open = true;
    positionPracticeStart();
    exampleHelp.textContent =
      (step.melody
        ? `全${step.patterns.length}小節。バスドラムで足の拍を取り、ピアノの音が始まるところでタップします。`
        : feetOnly
          ? "バスドラムに合わせて足で拍を取ります。"
          : "バスドラムが足の拍、ハイタムが手でタップする位置です。") +
      (step.countSubdivision === "triplet"
        ? "数字から次の数字までを3等分します。「・」の位置でも手でタップします。"
        : step.countSubdivision === "sixteenth"
          ? "数字から次の数字までを4等分します。「&」はその真ん中です。"
          : subdivided
            ? "「&」は拍と次の拍の真ん中です。"
            : "");
    const symbols = step.patterns.join("");
    const shownValues = new Set(Array.from(symbols, getRhythmNoteValue));
    const legend = [];
    for (const value of [
      "whole",
      "dotted-half",
      "half",
      "dotted-quarter",
      "quarter",
      "dotted-eighth",
      "eighth",
      "sixteenth",
      "triplet-eighth",
    ] as const) {
      if (feetOnly || !shownValues.has(value)) continue;
      const item = document.createElement("li");
      const beats =
        value === "triplet-eighth"
          ? "1/3拍"
          : RHYTHM_NOTE_BEATS[value] === 0.5
            ? "半拍"
            : `${RHYTHM_NOTE_BEATS[value]}拍`;
      item.append(createNoteIcon(value), `${noteNotation[value]}（${beats}）`);
      legend.push(item);
    }
    const shownRests = new Set(Array.from(symbols, getRhythmRestValue));
    for (const value of ["quarter", "eighth"] as const) {
      if (!shownRests.has(value)) continue;
      const item = document.createElement("li");
      item.append(
        createRestIcon(value),
        `${restNotation[value]}（${value === "quarter" ? "1拍" : "半拍"}休む）`,
      );
      legend.push(item);
    }
    patternLegend.replaceChildren(...legend);
    patternLegend.hidden = legend.length === 0;
    examples.replaceChildren(
      ...step.patterns.map((pattern, index) => {
        const card = document.createElement("div");
        card.className = "rhythm-pattern";
        const slots = Array.from(pattern).flatMap((note, slot) =>
          slot % stride === 0
            ? [
                {
                  note,
                  beat: Math.floor(slot / slotsPerBeat) + 1,
                  part: slot % slotsPerBeat,
                },
              ]
            : [],
        );
        card.dataset.subdivided = String(subdivided);
        card.dataset.dense = String(slots.length > 8);
        card.style.setProperty("--rhythm-slots", String(slots.length));
        card.setAttribute("role", "img");
        const handBeats = slots.flatMap(({ note, beat, part }) => {
          const value = getRhythmNoteValue(note);
          return value
            ? [
                `${rhythmBeatLabel(beat, part, slotsPerBeat)}に${noteNotation[value]}`,
              ]
            : [];
        });
        const restBeats = slots.flatMap(({ note, beat, part }) => {
          const value = getRhythmRestValue(note);
          return value
            ? [
                `${rhythmBeatLabel(beat, part, slotsPerBeat)}に${restNotation[value]}`,
              ]
            : [];
        });
        card.setAttribute(
          "aria-label",
          feetOnly
            ? "足で1、2、3、4拍を刻み、各拍でタップ"
            : `足で毎拍を刻む。手で叩く位置は${handBeats.join("、")}${restBeats.length ? `。${restBeats.join("、")}` : ""}`,
        );

        const addRow = (label: string, kind: string, cells: string[]) => {
          [label, ...cells].forEach((text, index) => {
            const cell = document.createElement("span");
            cell.className =
              index === 0 ? "rhythm-pattern-label" : `rhythm-pattern-${kind}`;
            if (kind === "beat") cell.classList.add("rhythm-pattern-foot-row");
            cell.setAttribute("aria-hidden", "true");
            if (index > 0)
              cell.dataset.exampleSlot = String((index - 1) * stride);
            const value =
              kind === "note" ? getRhythmNoteValue(text) : undefined;
            const rest = kind === "note" ? getRhythmRestValue(text) : undefined;
            if (index === 1 && (value || (kind === "beat" && text))) {
              cell.classList.add("rhythm-pattern-downbeat");
            }
            if (kind === "beat" && index > 0 && text) {
              cell.append(createFootprint());
            } else if (value) {
              cell.append(createNoteIcon(value));
            } else if (rest) {
              cell.append(createRestIcon(rest));
            } else {
              cell.textContent = text;
            }
            card.append(cell);
          });
        };
        addRow(
          "拍",
          "count",
          slots.map(({ beat, part }) =>
            part === 0
              ? String(beat)
              : slotsPerBeat === 2 || (slotsPerBeat === 4 && part === 2)
                ? "&"
                : "・",
          ),
        );
        if (!feetOnly)
          addRow(
            "手",
            "note",
            slots.map(({ note }) => (note === "-" ? "" : note)),
          );
        addRow(
          feetOnly ? "足＋タップ" : "足",
          "beat",
          slots.map(({ part }) => (part ? "" : "足")),
        );
        const example = document.createElement("div");
        example.className = "rhythm-pattern-example";
        const label = step.melody
          ? `${index + 1}小節目`
          : step.patterns.length === 1
            ? "見本"
            : `見本${index + 1}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = `${label}を再生`;
        button.addEventListener("click", () => void playExample(button, index));
        example.append(card, button);
        return example;
      }),
    );
  }

  function stopExample() {
    if (!activeExample) return;
    loop.stop();
    scheduler?.stop();
    melodyPlayer?.stopScale();
    const { cards, button, label } = activeExample;
    activeExample = null;
    button.textContent = label;
    for (const card of cards) {
      for (const cell of card.querySelectorAll("[data-playing]"))
        cell.removeAttribute("data-playing");
    }
  }

  async function playExample(button: HTMLButtonElement, index?: number) {
    const stopping = activeExample?.button === button;
    stopExample();
    if (stopping) return;
    stopPreview();
    exampleStatus.textContent = "";
    const step = currentStep();
    const beatsPerBar = step.beatsPerBar ?? 4;
    const slotsPerBeat = rhythmSlotsPerBeat(step);
    const slotsPerBar = beatsPerBar * slotsPerBeat;
    const exampleCards = Array.from(
      examples.querySelectorAll<HTMLElement>(".rhythm-pattern"),
    );
    const patterns =
      index === undefined ? step.patterns : [step.patterns[index]];
    const cards = index === undefined ? exampleCards : [exampleCards[index]];
    const label = button.textContent ?? "見本を再生";
    const example = { cards, button, label };
    activeExample = example;
    button.textContent =
      index === undefined
        ? step.melody
          ? "曲の再生を停止"
          : "通し再生を停止"
        : label.replace(/再生$/, "停止");
    try {
      const context = getAudioContext();
      if (context.state !== "running") await context.resume();
      if (activeExample !== example) return;
      scheduler ??= new RhythmScheduler(context);
      const player = scheduler;
      const melody =
        index === undefined ? step.melody?.flat() : step.melody?.[index];
      const feetOnly = step.feetOnly === true || melody !== undefined;
      const eighths = step.countSubdivision === "eighth";
      const spokenEighths = eighths && !melody;
      const voice = settings.exampleVoice ? settings.countVoice : null;
      if (melody) melodyPlayer ??= new ReferencePlayer(context);
      const [percussion, spoken, piano] = await Promise.allSettled([
        player.loadPercussion(feetOnly),
        voice
          ? player.loadVoices(
              voice,
              (spokenEighths ? 30_000 : 60_000) / step.bpm,
            )
          : Promise.resolve(),
        melody ? melodyPlayer?.prepare("piano") : undefined,
      ]);
      if (activeExample !== example) return;
      const messages = [];
      if (percussion.status === "rejected")
        messages.push("読み込めなかった打楽器音は電子音で代用します。");
      if (spoken.status === "rejected")
        messages.push(
          "カウント音声を読み込めなかったため、拍の音で再生します。",
        );
      if (piano.status === "rejected")
        messages.push(
          "ピアノを読み込めなかったため、電子音でメロディーを再生します。",
        );
      exampleStatus.textContent = messages.join(" ");
      const startAt = player.playExample(patterns, step.bpm, {
        beatsPerBar,
        feetOnly,
        eighths: spokenEighths,
        voice: spoken.status === "fulfilled" ? voice : null,
      });
      if (melody && melodyPlayer) {
        const notes = melodyNotes(
          melody,
          createRhythmTargets(patterns, step.bpm, 0, slotsPerBeat),
          step.bpm,
          0,
        );
        melodyPlayer.setVolume(0.36);
        melodyPlayer.playPhrase(
          piano.status === "fulfilled" ? "piano" : "sine",
          notes,
          startAt,
        );
      }
      const slotSeconds = 60 / (step.bpm * slotsPerBeat);
      const subdivisions = step.countSubdivision ? 1 : slotsPerBeat;
      const cells = cards.map((card) =>
        card.querySelectorAll<HTMLElement>("[data-example-slot]"),
      );
      let highlighted = -1;
      loop.start(() => {
        const latency = context.outputLatency ?? context.baseLatency ?? 0;
        const slot = Math.floor(
          (context.currentTime - latency - startAt) / slotSeconds,
        );
        if (slot >= patterns.length * slotsPerBar) {
          stopExample();
          return;
        }
        if (slot < 0) return;
        const current = slot - (slot % subdivisions);
        if (current === highlighted) return;
        highlighted = current;
        for (const [bar, columnCells] of cells.entries()) {
          for (const cell of columnCells)
            cell.toggleAttribute(
              "data-playing",
              bar * slotsPerBar + Number(cell.dataset.exampleSlot) === current,
            );
        }
      });
    } catch {
      if (activeExample !== example) return;
      stopExample();
      exampleStatus.textContent =
        "見本を再生できませんでした。もう一度お試しください。";
    }
  }

  function end() {
    generation++;
    loading.hidden = true;
    loop.stop();
    scheduler?.stop();
    melodyPlayer?.stopScale();
    acceptTap = null;
    preparedBars = null;
    markers.replaceChildren();
    showSetup();
  }

  function stop() {
    stopExample();
    if (stage.hidden) return;
    const started = preparedBars === null;
    end();
    if (started) feedback.textContent = "中止しました。";
  }

  function openStage(mode: RhythmGuide | null) {
    stopExample();
    stopPreview();
    setup.hidden = true;
    resultPanel.hidden = true;
    stage.hidden = false;
    lanes.hidden = mode !== null;
    lanes.removeAttribute("data-count-in");
    lanes.removeAttribute("data-note-pulse");
    lanes.removeAttribute("data-beat-pulse");
    lanes.style.removeProperty("--rhythm-count-in-width");
    score.hidden = mode !== null;
    count.removeAttribute("data-calibration");
    count.removeAttribute("data-ready");
    count.style.removeProperty("--rhythm-ready-remaining");
    count.dataset.accent = "false";
    count.textContent = "—";
    hitFeedback.textContent = "";
    hitFeedback.removeAttribute("data-grade");
    const step = currentStep();
    activeStep.hidden = mode !== null;
    activeStepLabel.textContent = `第${step.chapter}章 ${RHYTHM_CHAPTERS[step.chapter - 1]} ／ ステップ ${step.id}`;
    activeMeter.textContent = rhythmMeterAndTempo(step);
    title.textContent =
      mode === "visual"
        ? "視覚の補正"
        : mode === "audio"
          ? "音の補正"
          : step.title;
    phase.textContent = mode === null ? "開始前" : "準備中";
    phase.removeAttribute("data-scoring");
    tapLabel.textContent = mode === null ? "練習を始める" : rhythmTapLabel;
    stopButton.textContent = mode === null ? "戻る" : "停止";
    inputHelp.textContent =
      mode === "visual"
        ? "カウントダウンの後、円が光る瞬間にタップします。"
        : mode === "audio"
          ? "カウントダウンの後、クリック音が聞こえた瞬間にタップします。"
          : `タップかスペースキーで開始します。同じテンポで準備${practiceCountInBars}小節、本番${preparedBars?.length ?? 0}小節です。`;
    feedback.textContent = "";
    tap.focus({ preventScroll: true });
    if (mode !== null) stage.scrollIntoView({ block: "nearest" });
  }

  async function prepareAudio(
    shortestVoiceIntervalMs?: number,
    needsMelody = false,
  ) {
    const token = ++generation;
    let cue = settings.sound;
    try {
      const context = getAudioContext();
      if (context.state !== "running") await context.resume();
      if (token !== generation) return null;
      scheduler ??= new RhythmScheduler(context);
      const player = scheduler;
      let instrument: "piano" | "sine" | null = null;
      if (
        shortestVoiceIntervalMs !== undefined &&
        cue === "voice" &&
        settings.volume > 0
      ) {
        try {
          await player.loadVoices(settings.countVoice, shortestVoiceIntervalMs);
        } catch {
          if (token !== generation) return null;
          cue = "click";
          feedback.textContent =
            "カウント音声を読み込めなかったため、クリック音を使います。";
        }
      }
      if (token !== generation) return null;
      if (needsMelody && settings.volume > 0) {
        melodyPlayer ??= new ReferencePlayer(context);
        const [piano, drums] = await Promise.allSettled([
          melodyPlayer.prepare("piano"),
          player.loadPercussion(true),
        ]);
        if (token !== generation) return null;
        instrument = piano.status === "fulfilled" ? "piano" : "sine";
        const messages = [feedback.textContent];
        if (piano.status === "rejected")
          messages.push(
            "ピアノを読み込めなかったため、電子音でメロディーを再生します。",
          );
        if (drums.status === "rejected")
          messages.push(
            "バスドラムを読み込めなかったため、電子音で足の拍を鳴らします。",
          );
        feedback.textContent = messages.filter(Boolean).join(" ");
      }
      if (token !== generation) return null;
      // Output latency may still change after the context starts rendering.
      const latencyMs = (guide: RhythmGuide) =>
        guide === "audio"
          ? (context.outputLatency ?? context.baseLatency ?? 0) * 1000
          : 0;
      const now = () => context.currentTime * 1000;
      const eventTime = (timestamp: number, guide: RhythmGuide) =>
        rhythmEventTimeMs(
          context.currentTime,
          timestamp,
          performance.now(),
          latencyMs(guide),
        );
      return { player, now, eventTime, cue, latencyMs, instrument };
    } catch {
      if (token !== generation) return null;
      end();
      feedback.textContent =
        "練習の準備ができませんでした。もう一度お試しください。";
      start.focus();
      return null;
    }
  }

  async function calibrate(mode: RhythmGuide) {
    if (!stage.hidden) return;
    openStage(mode);
    const audio = await prepareAudio();
    if (!audio) return;
    const countdownMs = audio.now() + 100;
    const startMs = countdownMs + CALIBRATION_COUNTDOWN_MS;
    const offsets: (number | null)[] = Array(CALIBRATION_TAPS).fill(null);
    let received = 0;
    phase.textContent = "開始まで";
    count.textContent = String(countdownSeconds);
    const cues = createCountdown(countdownMs);
    if (mode === "audio") {
      cues.push(
        ...offsets.map((_, index) => ({
          timeMs: startMs + index * CALIBRATION_BEAT_MS,
          voiceIndex: 1,
          sound: "click" as const,
          volume: settings.volume || 0.65,
        })),
      );
    }
    audio.player.start(cues, audio.cue, settings.volume, settings.countVoice);
    acceptTap = (timestamp) => {
      const tapMs = audio.eventTime(timestamp, mode);
      const index = calibrationTapIndex(tapMs, startMs);
      if (index < 0 || offsets[index] !== null) return;
      offsets[index] = tapMs - startMs - index * CALIBRATION_BEAT_MS;
      phase.textContent = `${++received} / ${CALIBRATION_TAPS}回`;
    };
    loop.start(() => {
      const elapsed = audio.now() - audio.latencyMs(mode) - startMs;
      if (elapsed < 0) {
        count.textContent = countdownText(elapsed);
        return;
      }
      if (phase.textContent === "開始まで")
        phase.textContent = `0 / ${CALIBRATION_TAPS}回`;
      const beat = Math.floor(elapsed / CALIBRATION_BEAT_MS);
      if (mode === "visual" && beat >= 0 && beat < CALIBRATION_TAPS) {
        count.setAttribute("data-calibration", "");
        count.textContent = String(beat + 1);
        count.dataset.accent = String(elapsed % CALIBRATION_BEAT_MS < 160);
      } else if (mode === "audio") {
        count.textContent = "♪";
      }
      if (elapsed < (CALIBRATION_TAPS - 0.5) * CALIBRATION_BEAT_MS) return;
      const measured = measureRhythmOffset(offsets);
      if (measured !== null) {
        const date = new Date().toISOString();
        if (mode === "visual") {
          calibration = {
            version: 1,
            visualOffsetMs: measured,
            measuredAt: date,
            audioOffsetMs: calibration?.audioOffsetMs ?? null,
            audioMeasuredAt: calibration?.audioMeasuredAt,
          };
        } else {
          calibration = {
            version: 1,
            visualOffsetMs: calibration?.visualOffsetMs ?? null,
            measuredAt: calibration?.measuredAt,
            audioOffsetMs: measured,
            audioMeasuredAt: date,
          };
        }
        store.saveCalibration(calibration);
      }
      end();
      feedback.textContent =
        measured === null
          ? "12回分のタイミングがそろいませんでした。もう一度測定してください。"
          : `${mode === "visual" ? "視覚" : "音"}の補正を記録しました。`;
      if (measured === null)
        (mode === "audio" ? audioCalibration : visualCalibration).focus();
      else start.focus();
    });
  }

  function makeMarker(
    kind: "note" | "rest" | "beat" | "hit",
    content?: Node | string,
  ) {
    const marker = document.createElement("span");
    marker.className = `rhythm-mark rhythm-${kind}`;
    if (kind === "beat") marker.append(createFootprint());
    else if (content !== undefined) marker.append(content);
    markers.append(marker);
    return marker;
  }

  function openPractice() {
    if (!stage.hidden) return;
    const step = currentStep();
    const feetOnly = step.feetOnly;
    const beatsPerBar = step.beatsPerBar ?? 4;
    const slotsPerBeat = rhythmSlotsPerBeat(step);
    preparedBars = createRhythmBars(step);
    openStage(null);
    lanes.dataset.dense = String(slotsPerBeat > 2);
    stage.insertBefore(score, lanes);
    score.hidden = false;
    scoreLabel.textContent = `${preparedBars.length}小節の判定`;
    scoreExtras.hidden = true;
    const stride = step.countSubdivision ? 1 : slotsPerBeat;
    scoreBars.dataset.dense = String((beatsPerBar * slotsPerBeat) / stride > 8);
    scoreBars.style.setProperty(
      "--rhythm-score-slots",
      String((beatsPerBar * slotsPerBeat) / stride),
    );
    scoreBars.replaceChildren(
      ...preparedBars.map((pattern, index) => {
        const bar = document.createElement("li");
        const number = document.createElement("span");
        number.className = "rhythm-score-bar-number";
        number.textContent = `${index + 1}小節`;
        bar.append(number);
        for (let slot = 0; slot < pattern.length; slot += stride) {
          const note = document.createElement("span");
          note.className = "rhythm-score-slot";
          const value = getRhythmNoteValue(pattern[slot]);
          const rest = getRhythmRestValue(pattern[slot]);
          const label = rhythmBeatLabel(
            Math.floor(slot / slotsPerBeat) + 1,
            slot % slotsPerBeat,
            slotsPerBeat,
          );
          if (value) {
            note.dataset.note = label;
            note.setAttribute("role", "img");
            const noteLabel = feetOnly
              ? label
              : `${label} ${noteNotation[value]}`;
            note.setAttribute("aria-label", `${noteLabel} 未判定`);
            if (feetOnly) note.append(createFootprint());
            else note.append(createNoteIcon(value));
          } else if (rest) {
            note.setAttribute("role", "img");
            note.setAttribute("aria-label", `${label} ${restNotation[rest]}`);
            note.append(createRestIcon(rest));
          } else {
            note.setAttribute("aria-hidden", "true");
          }
          bar.append(note);
        }
        return bar;
      }),
    );
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const marker = makeMarker("beat");
      marker.dataset.accent = String(beat === 0);
      marker.style.left = `${linePercent + 22 * beat}%`;
    }
    if (!feetOnly) {
      Array.from(preparedBars[0]).forEach((symbol, slot) => {
        const value = getRhythmNoteValue(symbol);
        const rest = getRhythmRestValue(symbol);
        const marker = value
          ? makeMarker("note", createNoteIcon(value))
          : rest && makeMarker("rest", createRestIcon(rest));
        if (!marker) return;
        if (value) marker.dataset.accent = String(slot === 0);
        marker.style.left = `${linePercent + (22 * slot) / slotsPerBeat}%`;
      });
    }
    stage.scrollIntoView({ block: "nearest" });
  }

  async function play() {
    const bars = preparedBars;
    if (!bars) return;
    preparedBars = null;
    const step = currentStep();
    const beatsPerBar = step.beatsPerBar ?? 4;
    const slotsPerBeat = rhythmSlotsPerBeat(step);
    const countInBeats = beatsPerBar * practiceCountInBars;
    const nextStep = RHYTHM_STEPS[RHYTHM_STEPS.indexOf(step) + 1];
    phase.textContent = "音源を準備中";
    loading.hidden = false;
    tapLabel.textContent = rhythmTapLabel;
    stopButton.textContent = "停止";
    const tapHelp =
      (step.feetOnly
        ? "足あとの中心の点線が判定ラインに重なった瞬間にタップします。"
        : "上段の音符の点線が判定ラインに重なった瞬間にタップします。足は下段の足あとに合わせます。") +
      (bars.some((pattern) => Array.from(pattern).some(getRhythmRestValue))
        ? "休符の位置ではタップを休みます。"
        : "");
    inputHelp.textContent = `準備の${practiceCountInBars}小節は足で拍を刻みます。タップは「本番」の表示からです。`;
    const beatMs = 60_000 / step.bpm;
    const audio = await prepareAudio(beatMs, Boolean(step.melody));
    if (!audio) return;
    loading.hidden = true;
    phase.textContent = "準備まで";
    count.setAttribute("data-ready", "");
    count.style.setProperty("--rhythm-ready-remaining", "100%");
    count.textContent = String(practiceReadyMs / 1000);
    const guideMode = settings.guide;
    // With a melody, the moving notes follow the audible output in either guide mode.
    const clockGuide = audio.instrument ? "audio" : guideMode;
    const correction =
      guideMode === "audio"
        ? (calibration?.audioOffsetMs ?? 0)
        : (calibration?.visualOffsetMs ?? 0);
    const firstBeatMs =
      audio.now() - audio.latencyMs(clockGuide) + practiceReadyMs;
    const startMs = firstBeatMs + beatMs * countInBeats;
    const endMs = startMs + bars.length * beatsPerBar * beatMs;
    const targets = createRhythmTargets(bars, step.bpm, startMs, slotsPerBeat);
    const beatCount = (bars.length + practiceCountInBars) * beatsPerBar;
    const counts: RhythmCount[] = [];
    for (let beat = 0; beat < beatCount; beat++) {
      const timeMs = firstBeatMs + beat * beatMs;
      counts.push({ timeMs, voiceIndex: beat % beatsPerBar });
      if (
        beat >= countInBeats &&
        !step.melody &&
        audio.cue === "click" &&
        step.countSubdivision === "eighth"
      )
        counts.push({ timeMs: timeMs + beatMs / 2, voiceIndex: 4 });
    }
    audio.player.start(
      step.melody ? counts.slice(0, countInBeats) : counts,
      audio.cue,
      settings.volume,
      settings.countVoice,
      step.melody ? startMs : endMs,
    );
    if (step.melody && melodyPlayer && audio.instrument) {
      melodyPlayer.setVolume(settings.volume);
      melodyPlayer.playPhrase(
        audio.instrument,
        melodyNotes(step.melody.flat(), targets, step.bpm, startMs),
        startMs / 1000,
      );
      for (const beat of counts.slice(countInBeats)) {
        const downbeat = beat.voiceIndex === 0;
        audio.player.scheduleBassDrum(
          beat.timeMs / 1000,
          downbeat,
          settings.volume * (downbeat ? 0.6 : 0.46),
        );
      }
    }
    lanes.setAttribute("data-count-in", "");
    lanes.style.setProperty("--rhythm-count-in-width", "100%");
    markers.replaceChildren();
    const moving = counts
      .filter((item) => item.voiceIndex !== 4)
      .map((item, index) => {
        const marker = makeMarker("beat");
        marker.dataset.accent = String(item.voiceIndex === 0);
        marker.toggleAttribute("data-count-in", index < countInBeats);
        return { ...item, marker };
      });
    const notes = step.feetOnly
      ? []
      : targets.map((target) => {
          const marker = makeMarker("note", createNoteIcon(target.noteValue));
          marker.dataset.accent = String(target.downbeat);
          return { target, marker };
        });
    const rests = bars.flatMap((pattern, bar) =>
      Array.from(pattern).flatMap((symbol, slot) => {
        const rest = getRhythmRestValue(symbol);
        return rest
          ? [
              {
                timeMs:
                  startMs +
                  ((bar * pattern.length + slot) * beatMs) / slotsPerBeat,
                marker: makeMarker("rest", createRestIcon(rest)),
              },
            ]
          : [];
      }),
    );
    for (const item of [...moving, ...notes, ...rests])
      item.marker.hidden = true;
    const scoreNotes = scoreBars.querySelectorAll<HTMLElement>("[data-note]");
    const hits: RhythmHit[] = [];
    let extras = 0;
    let stamp: { created: number; marker: HTMLElement } | undefined;

    const presentHit = (hit: RhythmHit) => {
      hits.push(hit);
      const label = hitLabel(hit);
      hitFeedback.textContent = label;
      hitFeedback.dataset.grade = hit.grade;
      if (hit.reason === "extra") {
        scoreExtras.hidden = false;
        scoreExtras.textContent = `余分なタップ ${++extras}回`;
      } else {
        const index = targets.findIndex((target) => target.hit === hit);
        const note = scoreNotes[index];
        note.dataset.grade = hit.grade;
        note.textContent = gradeSymbols[hit.grade];
        const name = step.feetOnly
          ? ""
          : ` ${noteNotation[targets[index].noteValue]}`;
        note.title = `${note.dataset.note}${name} ${label}`;
        note.setAttribute("aria-label", note.title);
      }
      if (settings.effects) audio.player.feedback(hit.grade);
      stamp?.marker.remove();
      const marker = makeMarker("hit", gradeSymbols[hit.grade]);
      marker.dataset.grade = hit.grade;
      const left = trackPercent(-(hit.offsetMs ?? 0));
      marker.style.left = `clamp(1.3rem, ${left}%, 100% - 1.3rem)`;
      stamp = { created: audio.now(), marker };
    };

    acceptTap = (timestamp) => {
      const corrected = audio.eventTime(timestamp, clockGuide) - correction;
      if (corrected < startMs - RHYTHM_MATCH_MS || corrected >= endMs) return;
      presentHit(judgeRhythmTap(targets, corrected));
    };

    function trackPercent(deltaMs: number) {
      return linePercent + (deltaMs / beatMs) * beatPercent;
    }

    function position(marker: HTMLElement, delta: number, visible = true) {
      const left = trackPercent(delta);
      marker.hidden = !visible || left < -5 || left > 105;
      if (!marker.hidden) marker.style.left = `${left}%`;
    }

    loop.start(() => {
      const now = audio.now();
      const visibleMs = now - audio.latencyMs(clockGuide);
      const elapsed = visibleMs - firstBeatMs;
      const countInWidth = Math.min(
        100,
        Math.max(0, trackPercent(startMs - visibleMs)),
      );
      lanes.style.setProperty("--rhythm-count-in-width", `${countInWidth}%`);
      let beatPulse = false;
      for (const item of moving) {
        const delta = item.timeMs - visibleMs;
        const active = delta <= 0 && delta > -timingPulseMs;
        item.marker.dataset.active = String(active);
        beatPulse ||= active;
        position(item.marker, delta);
      }
      let notePulse = false;
      for (const note of notes) {
        const delta = note.target.timeMs - visibleMs;
        const active = delta <= 0 && delta > -timingPulseMs;
        note.marker.toggleAttribute("data-active", active);
        notePulse ||= active;
        position(
          note.marker,
          delta,
          !note.target.hit || delta > -timingPulseMs,
        );
      }
      lanes.toggleAttribute("data-beat-pulse", beatPulse);
      lanes.toggleAttribute("data-note-pulse", notePulse);
      for (const rest of rests) position(rest.marker, rest.timeMs - visibleMs);
      if (elapsed < 0) {
        const seconds = String(
          Math.ceil(Math.min(-elapsed, practiceReadyMs) / 1000),
        );
        if (count.textContent !== seconds) count.textContent = seconds;
        count.style.setProperty(
          "--rhythm-ready-remaining",
          `${Math.min(1, -elapsed / practiceReadyMs) * 100}%`,
        );
        return;
      }
      if (count.hasAttribute("data-ready")) {
        count.removeAttribute("data-ready");
        count.style.removeProperty("--rhythm-ready-remaining");
      }
      const beat = Math.floor(elapsed / beatMs);
      const bar = Math.floor(beat / beatsPerBar) + 1;
      const scoring = beat >= countInBeats;
      const offbeat =
        scoring &&
        step.countSubdivision === "eighth" &&
        elapsed % beatMs >= beatMs / 2;
      const shownCount = `${(Math.min(beat, beatCount - 1) % beatsPerBar) + 1}${offbeat ? " &" : ""}`;
      if (count.textContent !== shownCount) count.textContent = shownCount;
      count.dataset.accent = String(beat % beatsPerBar === 0 && !offbeat);
      const label = scoring
        ? `本番 ${Math.min(bar - practiceCountInBars, bars.length)} / ${bars.length} 小節`
        : `準備 ${bar} / ${practiceCountInBars} 小節（判定なし）`;
      if (phase.textContent !== label) {
        phase.textContent = label;
        phase.toggleAttribute("data-scoring", scoring);
        lanes.toggleAttribute("data-count-in", !scoring);
      }
      if (scoring && inputHelp.textContent !== tapHelp)
        inputHelp.textContent = tapHelp;
      if (stamp && now - stamp.created > hitStampMs) {
        stamp.marker.remove();
        stamp = undefined;
      }
      const judgeNow = visibleMs - correction;
      for (const hit of collectOmittedRhythmNotes(targets, judgeNow))
        presentHit(hit);
      if (visibleMs < endMs || judgeNow < endMs) return;
      const result = summarizeRhythm(hits, step.chapter);
      const record = recordRhythmAttempt(
        progress,
        step,
        result,
        new Date().toISOString(),
      );
      store.saveProgress(progress);
      end();
      const remaining = step.requiredStreak - record.streak;
      const outcome = result.passed ? "合格！" : "今回は不合格。";
      const courseCleared = RHYTHM_STEPS.every(
        (item) => progress.steps[item.id]?.cleared,
      );
      const progressLabel = record.cleared
        ? courseCleared
          ? "全ステップクリア！"
          : "このステップはクリア済みです。"
        : remainingPassLabel(
            remaining,
            !settings.freePlay && nextStep !== undefined,
          );
      feedback.textContent = `${outcome} ${progressLabel}（連続合格 ${record.streak} / ${step.requiredStreak}回、ぴったり率 ${Math.round(result.perfectRate * 100)}%）`;
      resultPanel.insertBefore(score, stats);
      renderResult(result, step.chapter);
      (next.hidden ? retry : next).focus();
    });
  }

  function renderResult(
    result: ReturnType<typeof summarizeRhythm>,
    chapter: number,
  ) {
    const total =
      result.counts.perfect + result.counts.close + result.counts.miss;
    stats.replaceChildren(
      ...(["perfect", "close", "miss"] as const).map((grade) => {
        const amount = result.counts[grade];
        const cell = document.createElement("div");
        const value = document.createElement("strong");
        cell.append(gradeLabels[grade]);
        const ratio = total ? amount / total : 0;
        value.textContent = `${amount}回（${Math.round(ratio * 100)}%）`;
        cell.append(value);
        return cell;
      }),
    );
    passRate.hidden = chapter !== 1;
    const percent = new Intl.NumberFormat("ja-JP", {
      style: "percent",
      maximumFractionDigits: 1,
    });
    passRate.textContent =
      chapter === 1
        ? `ぴったり＋ちょっとずれ ${percent.format(result.onBeatRate)}（合格ライン ${percent.format(RHYTHM_BEGINNER_PASS_RATE)}）`
        : "";
    const offset = result.meanOffsetMs;
    average.textContent =
      offset === null
        ? "平均のズレを計算できるタップがありませんでした。"
        : Math.round(offset) === 0
          ? "平均のズレは0msでした。"
          : `平均 ${offsetLabel(offset)}`;
    histogram.replaceChildren(
      ...result.histogram.map((amount, index) => {
        const row = document.createElement("li");
        const bar = document.createElement("meter");
        bar.max = Math.max(1, ...result.histogram);
        bar.value = amount;
        bar.setAttribute("aria-hidden", "true");
        row.append(RHYTHM_HISTOGRAM_LABELS[index], bar, `${amount}回`);
        return row;
      }),
    );
    resultPanel.hidden = false;
  }

  function selectStep(id: string) {
    const step = RHYTHM_STEPS.find((item) => item.id === id);
    if (!step || !stepSelectable(step)) return;
    progress.currentStepId = id;
    store.saveProgress(progress);
    examplesDetails.open = true;
    exampleBars.open = true;
    resultPanel.hidden = true;
    feedback.textContent = "";
    showSetup();
  }

  function updateSettings() {
    settings = {
      sound: sound.value as typeof settings.sound,
      countVoice: countVoice.value === "female" ? "female" : "male",
      volume: Number(volume.value) / 100,
      effects: effects.checked,
      guide: guide.value === "audio" ? "audio" : "visual",
      freePlay: freePlay.checked,
      exampleVoice: exampleVoice.checked,
    };
    showSetup();
    store.saveSettings(settings);
  }

  function handleKey(event: KeyboardEvent) {
    if (
      !acceptTap ||
      event.code !== "Space" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const focused = document.activeElement;
    if (
      focused !== tap &&
      focused?.closest(
        "button, input, select, textarea, summary, a, [contenteditable]",
      )
    )
      return;
    event.preventDefault();
    if (!event.repeat) acceptTap(event.timeStamp);
  }
  document.addEventListener("keydown", handleKey);
  function handleKeyUp(event: KeyboardEvent) {
    if (acceptTap && event.code === "Space" && document.activeElement === tap)
      event.preventDefault();
  }
  document.addEventListener("keyup", handleKeyUp);
  tap.addEventListener("pointerdown", (event) => {
    if (event.isPrimary && event.button === 0) acceptTap?.(event.timeStamp);
  });
  tap.addEventListener("click", (event) => {
    if (preparedBars) void play();
    else if (event.detail === 0) acceptTap?.(event.timeStamp);
  });
  stopButton.addEventListener("click", () => {
    stop();
    start.focus();
  });
  start.addEventListener("click", openPractice);
  examplePlayAll.addEventListener(
    "click",
    () => void playExample(examplePlayAll),
  );
  examplesDetails.addEventListener("toggle", () => {
    if (!examplesDetails.open) stopExample();
    positionPracticeStart();
  });
  exampleBars.addEventListener("toggle", () => {
    if (!exampleBars.open && activeExample?.button !== examplePlayAll)
      stopExample();
  });
  retry.addEventListener("click", openPractice);
  visualCalibration.addEventListener("click", () => void calibrate("visual"));
  audioCalibration.addEventListener("click", () => void calibrate("audio"));
  stepSelect.addEventListener("change", () => selectStep(stepSelect.value));
  for (const control of [
    sound,
    countVoice,
    volume,
    effects,
    guide,
    freePlay,
    exampleVoice,
  ])
    control.addEventListener("change", updateSettings);
  clearVisualCalibration.addEventListener("click", () => {
    if (calibration?.visualOffsetMs == null) return;
    const { audioOffsetMs, audioMeasuredAt } = calibration;
    calibration =
      audioOffsetMs === null
        ? null
        : { version: 1, visualOffsetMs: null, audioOffsetMs, audioMeasuredAt };
    store.saveCalibration(calibration);
    showSetup();
    visualCalibration.focus();
    feedback.textContent = "視覚の補正を解除しました。";
  });
  next.addEventListener("click", () => {
    const step = RHYTHM_STEPS[RHYTHM_STEPS.indexOf(currentStep()) + 1];
    if (step) selectStep(step.id);
    start.focus();
  });
  reset.addEventListener("click", () => {
    if (!window.confirm("リズム練習の全ステップの進捗をリセットしますか？"))
      return;
    progress = newRhythmProgress();
    selectStep(progress.currentStepId);
    feedback.textContent = "リズム練習の進捗をリセットしました。";
  });

  return {
    show(visible: boolean) {
      root.hidden = !visible;
      if (!visible) return;
      if (!loadedProgress) {
        progress = store.loadProgress();
        loadedProgress = true;
      }
      showSetup();
    },
    stop,
    dispose() {
      stop();
      melodyPlayer?.dispose();
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("keyup", handleKeyUp);
    },
  };
}
