import {
  getAudioContext,
  isAudioContextSupported,
  peekAudioContext,
} from "./audioContext";
import type { CommonSettings, ReferencePlayback } from "./commonSettings";
import { queryElement } from "./dom";
import { drawMelodyGraph, type MelodyGraphData } from "./melodyGraph";
import { followMelodyKeyboard, renderMelodyKeyboard } from "./melodyKeyboard";
import {
  buildMelody,
  getMelodyAssessedSeconds,
  getMelodyPosition,
  getToneScaleSize,
  getToneScaleStartBounds,
  MELODY_COUNTDOWN_SECONDS,
  MELODY_GRACE_SECONDS,
  MELODY_PATTERNS,
  type MelodyNoteResult,
  type MelodyObservation,
  pickToneScalePattern,
  recordMelodyObservation,
} from "./melodyPractice";
import { formatMicrophoneError, type MicrophoneCapture } from "./microphone";
import { PRACTICE_MIN_CLARITY } from "./pitchDetection";
import { formatPitchMovement, type Note } from "./pitchMath";
import { getPitchMovementIcon } from "./pitchMovementVisual";
import type { PracticeReadout } from "./practiceReadout";
import {
  createPitchSample,
  formatAnalysisStatus,
  type PitchSample,
  resolveAnalysisStatus,
} from "./session";

type MelodyInput = {
  start(): Promise<MicrophoneCapture | null>;
  stop(): void;
};

export function createMelodyPracticeView(
  settings: Pick<
    CommonSettings,
    | "getSettings"
    | "setupTabbedDialog"
    | "showReferencePreparing"
    | "resetReferenceStatus"
    | "reportReferenceError"
  >,
  playback: ReferencePlayback,
  {
    input,
    controls,
    readout,
  }: {
    input: MelodyInput;
    readout: PracticeReadout;
    controls: {
      prepare(): void;
      setLocked(locked: boolean): void;
    };
  },
) {
  const elements = {
    melodySection: queryElement<HTMLElement>(".melody-practice"),
    melodySequence: queryElement<HTMLElement>(".melody-sequence"),
    melodySetup: queryElement<HTMLDialogElement>("#melodySetup"),
    openMelodySettings: queryElement<HTMLButtonElement>("#openMelodySettings"),
    melodySettingsSummary: queryElement<HTMLElement>("#melodySettingsSummary"),
    melodySettingsError: queryElement<HTMLElement>("#melodySettingsError"),
    melodyGraphView: queryElement<HTMLElement>("#melodyGraphView"),
    melodyCanvas: queryElement<HTMLCanvasElement>("#melodyCanvas"),
    melodyGraphScroll: queryElement<HTMLElement>("#melodyGraphScroll"),
    melodyGraphDescription: queryElement<HTMLElement>(
      "#melodyGraphDescription",
    ),
    playScaleButton: queryElement<HTMLButtonElement>("#playScaleButton"),
    melodyPatternSelect: queryElement<HTMLSelectElement>(
      "#melodyPatternSelect",
    ),
    melodySecondsSelect: queryElement<HTMLSelectElement>(
      "#melodySecondsSelect",
    ),
    toneScaleControls: queryElement<HTMLDivElement>("#toneScaleControls"),
    toneScaleStart: queryElement<HTMLParagraphElement>("#toneScaleStart"),
    toneScaleDown: queryElement<HTMLButtonElement>("#toneScaleDown"),
    toneScaleUp: queryElement<HTMLButtonElement>("#toneScaleUp"),
    toneScaleRandomSetting: queryElement<HTMLDivElement>(
      "#toneScaleRandomSetting",
    ),
    toneScaleRandom: queryElement<HTMLSelectElement>("#toneScaleRandom"),
    toneScaleNext: queryElement<HTMLButtonElement>("#toneScaleNext"),
    customMelodyInput: queryElement<HTMLInputElement>("#customMelodyInput"),
    customMelodyRow: queryElement<HTMLDivElement>("#customMelodyRow"),
    customMelodyHelp: queryElement<HTMLParagraphElement>("#customMelodyHelp"),
    melodyNotes: queryElement<HTMLOListElement>("#melodyNotes"),
    melodyStatus: queryElement<HTMLParagraphElement>("#melodyStatus"),
    melodyMovement: queryElement<HTMLElement>("#melodyMovement"),
    melodyKeyboard: queryElement<HTMLElement>("#melodyKeyboard"),
    melodyMovementIcon: queryElement<SVGSVGElement>("#melodyMovementIcon"),
    melodyMovementIconPath: queryElement<SVGPathElement>(
      "#melodyMovementIconPath",
    ),
    melodyCurrentMovement: queryElement<HTMLParagraphElement>(
      "#melodyCurrentMovement",
    ),
    melodyNextMovement: queryElement<HTMLParagraphElement>(
      "#melodyNextMovement",
    ),
    melodyProgress: queryElement<HTMLProgressElement>("#melodyProgress"),
    melodyCountdown: queryElement<HTMLElement>("#melodyCountdown"),
    melodyCountdownNumber: queryElement<HTMLElement>("#melodyCountdownNumber"),
    melodyCountdownSteps: queryElement<HTMLElement>("#melodyCountdownSteps"),
    melodyCountdownProgress: queryElement<HTMLProgressElement>(
      "#melodyCountdownProgress",
    ),
    melodyCountdownSound: queryElement<HTMLInputElement>(
      "#melodyCountdownSound",
    ),
    melodyResults: queryElement<HTMLDivElement>("#melodyResults"),
  };
  let running = false;
  let lastSample: PitchSample | null = null;
  let scalePlaybackRequestId = 0;
  let melodyGraphData: MelodyGraphData | null = null;

  function init() {
    settings.setupTabbedDialog(
      elements.melodySetup,
      elements.openMelodySettings,
      () => running,
    );
    elements.melodyPatternSelect.replaceChildren(
      ...MELODY_PATTERNS.map(
        (pattern) => new Option(pattern.label, pattern.id),
      ),
      new Option("自由メロディ（音名を入力）", "custom"),
    );
    elements.melodyPatternSelect.addEventListener("change", () => {
      toneScaleStartDegree = 0;
      toneScaleOffsets = undefined;
      renderMelodyPreview();
    });
    elements.toneScaleDown.addEventListener("click", () =>
      setToneScaleStart(
        (melodyRun?.pending?.degree ?? toneScaleStartDegree) - 1,
      ),
    );
    elements.toneScaleUp.addEventListener("click", () =>
      setToneScaleStart(
        (melodyRun?.pending?.degree ?? toneScaleStartDegree) + 1,
      ),
    );
    elements.toneScaleRandom.addEventListener("change", () => {
      const steps = Number(elements.toneScaleRandom.value);
      const enabling = steps > 0 && toneScaleRandomSteps === 0;
      toneScaleRandomSteps = steps;
      if (
        (enabling && toneScaleStartDegree !== 0) ||
        toneScaleOffsets?.some(
          (offset, index, offsets) =>
            index > 0 && Math.abs(offset - offsets[index - 1]) > steps,
        )
      ) {
        toneScaleOffsets = undefined;
        const tones = getToneScaleSize(elements.melodyPatternSelect.value);
        const { last } = getToneScaleStartBounds(tones);
        toneScaleStartDegree = enabling
          ? 0
          : Math.min(toneScaleStartDegree, last);
        renderMelodyPreview();
      } else {
        updateToneScaleControls();
      }
    });
    elements.toneScaleNext.addEventListener("click", () => {
      const run = melodyRun;
      if (running && !run) return;
      if (run) updatePosition();
      const pattern = pickToneScalePattern(
        getToneScaleSize(elements.melodyPatternSelect.value),
        toneScaleRandomSteps,
        toneScaleOffsets,
        { pending: run?.pending ?? undefined },
      );
      if (!pattern) return;
      if (run) {
        queueToneScaleChange(run, pattern.startDegree, pattern.offsets);
        return;
      }
      toneScaleStartDegree = pattern.startDegree;
      toneScaleOffsets = pattern.offsets;
      renderMelodyPreview();
    });
    elements.customMelodyInput.addEventListener("input", renderMelodyPreview);
    elements.melodySecondsSelect.addEventListener(
      "change",
      renderMelodyPreview,
    );
    renderMelodyPreview();
    if (isAudioContextSupported())
      elements.playScaleButton.addEventListener(
        "click",
        () => void playScale(),
      );
  }

  function show(visible: boolean) {
    if (!visible) elements.melodySetup.close();
    elements.melodySection.hidden = !visible;
    elements.melodyGraphView.hidden = !visible;
    elements.melodyResults.hidden =
      !visible ||
      melodyGraphData?.phase !== "stopped" ||
      !elements.melodyResults.childElementCount;
    if (visible) {
      readout.status.textContent =
        melodyGraphData?.phase === "stopped"
          ? "停止した周回の声を表示しています。"
          : "お手本と一緒に発声して判定します。停止するまで繰り返せます。";
      readout.showMeters(lastSample);
      readout.describeMelody();
    }
  }

  function onFrame(now: number, capture: MicrophoneCapture) {
    const position = updatePosition();
    if (position?.phase !== "sing") return;
    const target = melodyRun?.notes[position.index];
    if (!target) return;
    const { minRms, tolerance } = settings.getSettings();
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
      null,
    );
    const inGracePeriod = record(position, sample, detection.rms >= minRms);
    if (inGracePeriod) sample.centsFromTarget = null;
    lastSample = sample;
    readout.showMeters(sample);
    const status = resolveAnalysisStatus(sample, minRms, tolerance);
    readout.status.textContent = inGracePeriod
      ? "周回開始の猶予中です（各周回の最初の0.4秒は判定しません）"
      : formatAnalysisStatus(status);
    readout.describe(sample, status, target.name);
    draw();
  }

  function draw() {
    if (melodyGraphData)
      drawMelodyGraph(
        elements.melodyCanvas,
        elements.melodyGraphScroll,
        melodyGraphData,
        running,
      );
    else {
      const context = elements.melodyCanvas.getContext("2d");
      context?.clearRect(
        0,
        0,
        elements.melodyCanvas.width,
        elements.melodyCanvas.height,
      );
    }
  }

  function record(
    position: ReturnType<typeof getMelodyPosition>,
    sample: PitchSample,
    audible: boolean,
  ) {
    if (melodyRun) {
      const elapsed = position.elapsedInLap;
      const observation = {
        index: position.index,
        elapsed,
        cents: audible ? sample.centsFromTarget : null,
      };
      recordMelodyObservation(
        melodyRun.results,
        melodyRun.previous,
        observation,
        melodyRun.seconds,
        settings.getSettings().tolerance,
      );
      melodyRun.previous = observation;
      if (
        melodyGraphData &&
        elapsed - (melodyGraphData.samples.at(-1)?.time ?? -1) >= 0.04
      ) {
        melodyGraphData.samples.push({
          time: elapsed,
          midi: audible ? sample.midi : null,
        });
      }
    }
    return position.elapsedInLap < MELODY_GRACE_SECONDS;
  }

  let toneScaleStartDegree = 0;
  let toneScaleRandomSteps = 0;
  let toneScaleOffsets: number[] | undefined;
  type MelodyResultSection = {
    notes: Note[];
    results: MelodyNoteResult[];
    firstLap: number;
    elapsed: number;
  };
  type MelodyRun = {
    notes: Note[];
    seconds: number;
    startedAt: number;
    positionKey: string;
    results: MelodyNoteResult[];
    previous: MelodyObservation | null;
    lap: number;
    firstLap: number;
    history: MelodyResultSection[];
    pending: {
      degree: number;
      offsets: number[] | undefined;
      lap: number;
      notes: Note[];
    } | null;
  };
  let melodyRun: MelodyRun | null = null;

  function selectedMelody(
    degree = toneScaleStartDegree,
    offsets = toneScaleOffsets,
  ): Note[] {
    return buildMelody(
      elements.melodyPatternSelect.value,
      elements.customMelodyInput.value,
      settings.getSettings().startMidi,
      degree,
      offsets,
    );
  }

  function setToneScaleStart(degree: number) {
    const tones = getToneScaleSize(elements.melodyPatternSelect.value);
    const run = melodyRun;
    const offsets = run?.pending?.offsets ?? toneScaleOffsets;
    const { first, last } = getToneScaleStartBounds(tones, offsets);
    const next = Math.max(first, Math.min(degree, last));
    if (!tones || next === (run?.pending?.degree ?? toneScaleStartDegree))
      return;
    if (run) {
      queueToneScaleChange(run, next, offsets);
      return;
    }
    if (running) return;
    toneScaleStartDegree = next;
    renderMelodyPreview();
  }

  function queueToneScaleChange(
    run: MelodyRun,
    degree: number,
    offsets: number[] | undefined,
  ) {
    const player = playback.getCurrentPlayer();
    if (!player) return;
    const notes = selectedMelody(degree, offsets);
    const frequencies = notes.map((note) => note.frequency);
    // If the audio clock reaches the boundary while updating the display, use the following lap.
    for (let attempt = 0; attempt < 2; attempt++) {
      const position = updatePosition();
      if (!position) return;
      const lap = position.phase === "countdown" ? 0 : position.lap + 1;
      if (!player.replaceScaleLap(lap, frequencies)) continue;
      run.pending = notes.every(
        (note, index) => note.frequency === run.notes[index].frequency,
      )
        ? null
        : { degree, offsets, lap, notes };
      if (lap === 0) {
        applyMelodyLapChange(run);
        updatePosition();
        draw();
      } else if (position.index === run.notes.length - 1) {
        updateMelodyMovement(
          run.notes,
          position.index,
          false,
          run.pending?.notes[0],
        );
      }
      updateToneScaleControls(run.notes[0]);
      return;
    }
  }

  function formatToneScalePattern(notes: Note[], tones: number) {
    return notes
      .slice(0, tones)
      .map((note) => `${note.solfege}（${note.name}）`)
      .join(" → ");
  }

  function updateToneScaleControls(start?: Note) {
    const tones = getToneScaleSize(elements.melodyPatternSelect.value);
    const random = toneScaleRandomSteps > 0;
    const locked = running;
    const pending = melodyRun?.pending;
    const degree = pending?.degree ?? toneScaleStartDegree;
    const { first, last } = getToneScaleStartBounds(
      tones,
      pending?.offsets ?? toneScaleOffsets,
    );
    const preparing = locked && !melodyRun;
    elements.toneScaleControls.hidden = !tones;
    elements.toneScaleDown.hidden = random && !locked;
    elements.toneScaleUp.hidden = random && !locked;
    elements.toneScaleRandomSetting.hidden = locked;
    elements.toneScaleNext.hidden = !random;
    elements.toneScaleRandom.disabled = locked;
    elements.toneScaleDown.disabled = preparing;
    elements.toneScaleUp.disabled = preparing;
    elements.toneScaleDown.setAttribute(
      "aria-disabled",
      String(preparing || degree === first),
    );
    elements.toneScaleUp.setAttribute(
      "aria-disabled",
      String(preparing || degree === last),
    );
    elements.toneScaleNext.disabled = preparing;
    if (tones && start) {
      let label = `開始音：${start.solfege}（${start.name}）`;
      if (pending) {
        const next = pending.notes[0];
        const queued = random
          ? formatToneScalePattern(pending.notes, tones)
          : `${next.solfege}（${next.name}）`;
        label += ` · ${pending.lap + 1}周目から${queued}`;
      }
      if (elements.toneScaleStart.textContent !== label)
        elements.toneScaleStart.textContent = label;
    }
  }

  function updateMelodyMovement(
    notes: Note[],
    index: number,
    preparing = false,
    loopStart = notes[0],
  ) {
    const looping = running && !preparing;
    const note = notes[index];
    const next = notes[index + 1] ?? (looping ? loopStart : undefined);
    renderMelodyKeyboard(elements.melodyKeyboard, note, next);
    elements.melodyMovement.hidden = !note;
    if (!note) return;
    elements.melodyCurrentMovement.textContent =
      index === 0
        ? `${preparing ? "発声の最初" : "最初の音"}：${note.solfege} (${note.name})`
        : `前の音から：${formatPitchMovement(notes[index - 1].frequency, note.frequency)}`;
    elements.melodyMovementIcon.toggleAttribute("hidden", !next);
    if (next) {
      const icon = getPitchMovementIcon(note.frequency, next.frequency);
      elements.melodyMovementIconPath.setAttribute("d", icon.path);
      elements.melodyMovementIconPath.setAttribute("transform", icon.transform);
    }
    elements.melodyNextMovement.textContent = next
      ? `次：${formatPitchMovement(note.frequency, next.frequency, true)} · ${next.solfege} (${next.name})`
      : "最後の音 · そのままキープ";
    elements.melodyCurrentMovement.textContent += next
      ? `。次の音：${next.solfege} (${next.name})、${formatPitchMovement(note.frequency, next.frequency)}`
      : "。次の音はありません。最後の音です。";
  }

  function renderMelodyNotes(notes: Note[]) {
    elements.melodyNotes.replaceChildren(
      ...notes.map((note, index) => {
        const item = document.createElement("li");
        const movement =
          index === 0
            ? "最初の音"
            : `前の音から ${formatPitchMovement(notes[index - 1].frequency, note.frequency)}`;
        item.textContent = `${index + 1}. ${note.solfege} (${note.name})・${movement}`;
        return item;
      }),
    );
  }

  function melodyGraphMidiRange(): readonly [number, number] | undefined {
    if (!getToneScaleSize(elements.melodyPatternSelect.value)) return;
    const start = settings.getSettings().startMidi;
    return [start, start + 12];
  }

  function renderMelodyPreview() {
    if (running) stopScalePlayback();
    const custom = elements.melodyPatternSelect.value === "custom";
    elements.melodySettingsError.hidden = true;
    elements.customMelodyInput.removeAttribute("aria-invalid");
    elements.melodySettingsSummary.textContent = `${elements.melodyPatternSelect.selectedOptions[0]?.textContent ?? ""} · 1音${elements.melodySecondsSelect.value}秒`;
    elements.customMelodyRow.hidden = !custom;
    elements.customMelodyHelp.hidden = !custom;
    updateToneScaleControls();
    elements.melodyResults.hidden = true;
    elements.melodyResults.replaceChildren();
    elements.melodyProgress.value = 0;
    try {
      const notes = selectedMelody();
      updateToneScaleControls(notes[0]);
      updateMelodyMovement(notes, 0);
      melodyGraphData = {
        notes,
        midiRange: melodyGraphMidiRange(),
        seconds: Number(elements.melodySecondsSelect.value),
        tolerance: settings.getSettings().tolerance,
        phase: "ready",
        cursor: 0,
        samples: [],
      };
      elements.melodyGraphDescription.textContent =
        "横軸は音の順番、縦軸は声の高さです。声の線は周回ごとに描き直し、停止後はその周回を残します。長いメロディは左右にスクロールできます。範囲外の声は上下端に表示します。";
      renderMelodyNotes(notes);
      const duration =
        notes.length * Number(elements.melodySecondsSelect.value);
      const message = `${notes.length}音・1周${duration}秒。3秒の準備後、お手本と一緒に発声します。停止するまで繰り返します。`;
      if (elements.melodyStatus.textContent !== message)
        elements.melodyStatus.textContent = message;
      elements.playScaleButton.disabled = !isAudioContextSupported();
    } catch (error) {
      elements.melodyNotes.replaceChildren();
      elements.melodySettingsError.textContent = (error as Error).message;
      elements.melodySettingsError.hidden = false;
      if (custom)
        elements.customMelodyInput.setAttribute("aria-invalid", "true");
      elements.melodyMovement.hidden = true;
      elements.melodyKeyboard.hidden = true;
      elements.melodyStatus.textContent = (error as Error).message;
      elements.playScaleButton.disabled = true;
      melodyGraphData = null;
    }
    elements.melodyGraphScroll.scrollLeft = 0;
    draw();
  }

  function setMelodyControlsLocked(locked: boolean) {
    controls.setLocked(locked);
    elements.melodySequence.hidden = locked;
    elements.playScaleButton.classList.toggle("is-active", locked);
    for (const control of [
      elements.melodyPatternSelect,
      elements.melodySecondsSelect,
      elements.melodyCountdownSound,
      elements.customMelodyInput,
    ])
      control.disabled = locked;
    updateToneScaleControls();
    if (locked) {
      elements.melodySetup.close();
    }
    elements.playScaleButton.textContent = locked
      ? "メロディ稽古を停止"
      : "メロディ稽古を始める";
    elements.playScaleButton.setAttribute("aria-pressed", String(locked));
  }

  function applyMelodyLapChange(run: MelodyRun) {
    const pending = run.pending;
    if (!pending) return;
    if (pending.lap > run.firstLap) {
      run.history.push({
        notes: run.notes,
        results: run.results,
        firstLap: run.firstLap,
        elapsed:
          MELODY_COUNTDOWN_SECONDS +
          pending.lap * run.notes.length * run.seconds,
      });
    }
    toneScaleStartDegree = pending.degree;
    toneScaleOffsets = pending.offsets;
    run.firstLap = pending.lap;
    run.notes = pending.notes;
    run.results = pending.notes.map(() => ({ detectedMs: 0, inTuneMs: 0 }));
    run.pending = null;
    run.positionKey = "";
    if (melodyGraphData) {
      melodyGraphData.notes = run.notes;
      melodyGraphData.samples = [];
    }
    renderMelodyNotes(run.notes);
    updateToneScaleControls(run.notes[0]);
  }

  function updatePosition(elapsed?: number) {
    const run = melodyRun;
    const context = peekAudioContext();
    if (!run || !context) return;
    const position = getMelodyPosition(
      elapsed ?? context.currentTime - run.startedAt,
      run.notes.length,
      run.seconds,
    );
    if (
      position.phase === "sing" &&
      run.pending &&
      position.lap >= run.pending.lap
    )
      applyMelodyLapChange(run);
    const total = run.notes.length * run.seconds;
    if (position.phase === "sing" && position.lap !== run.lap) {
      run.lap = position.lap;
      run.previous = null;
      if (melodyGraphData) melodyGraphData.samples = [];
    }
    elements.melodyCountdown.hidden = position.phase !== "countdown";
    if (position.phase === "countdown") {
      const remaining = Math.ceil(position.remaining);
      elements.melodyCountdownNumber.textContent = String(remaining);
      elements.melodyCountdownSteps.textContent = [3, 2, 1]
        .map((n) => (n === remaining ? `【${n}】` : String(n)))
        .join(" → ");
      elements.melodyCountdownProgress.value =
        MELODY_COUNTDOWN_SECONDS - position.remaining;
    }
    if (melodyGraphData) {
      melodyGraphData.phase = position.phase;
      melodyGraphData.cursor = position.elapsedInLap;
    }
    elements.melodyProgress.max = total;
    elements.melodyProgress.value = position.elapsedInLap;
    const key = `${position.phase}:${position.lap}:${position.index}`;
    if (run.positionKey !== key) {
      run.positionKey = key;
      updateMelodyMovement(
        run.notes,
        position.phase === "countdown" ? 0 : position.index,
        position.phase === "countdown",
        run.pending?.notes[0],
      );
      if (position.phase === "countdown") {
        const rect = elements.melodyCountdown.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          window.scrollTo({
            top: Math.max(
              0,
              window.scrollY + rect.top - window.innerHeight * 0.55,
            ),
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          });
        }
      }
      run.previous = null;
      for (const [index, item] of Array.from(
        elements.melodyNotes.children,
      ).entries()) {
        if (index === position.index) {
          item.setAttribute("aria-current", "step");
          elements.melodyNotes.scrollTo({
            left:
              (item as HTMLElement).offsetLeft -
              elements.melodyNotes.clientWidth / 2 +
              item.clientWidth / 2,
          });
        } else item.removeAttribute("aria-current");
      }
    }
    const message =
      position.phase === "countdown"
        ? `お手本と一緒に発声します：あと${Math.ceil(position.remaining)}秒`
        : `${position.lap + 1}周目・一緒に発声：${position.index + 1}/${run.notes.length}音 ${run.notes[position.index].solfege} (${run.notes[position.index].name})・あと${Math.ceil(position.remaining)}秒`;
    if (elements.melodyStatus.textContent !== message)
      elements.melodyStatus.textContent = message;
    if (position.phase === "countdown")
      readout.status.textContent =
        "準備中です。3秒後からお手本と一緒に発声してください。";
    return position;
  }

  function showMelodyResults(
    run: NonNullable<typeof melodyRun>,
    elapsed: number,
  ) {
    const heading = document.createElement("p");
    heading.textContent = `練習全体の集計です。グラフは停止した周回の声です。判定幅は半音の${melodyGraphData?.tolerance ?? settings.getSettings().tolerance}%です。各周回の最初の${MELODY_GRACE_SECONDS}秒だけが周回開始の猶予です。途中の音の切り替わりには猶予を設けません。「合った割合」は停止までの判定対象時間に対する割合で、無音・検出不能も含みます。`;
    const table = document.createElement("table");
    const caption = table.createCaption();
    caption.textContent = "音ごとの判定（マイクに入った音の目安）";
    const header = table.createTHead().insertRow();
    for (const label of [
      "音",
      "合った時間",
      "合った割合",
      "音程を検出した時間",
    ]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      header.append(th);
    }
    const sections = [
      ...run.history,
      {
        notes: run.notes,
        results: run.results,
        firstLap: run.firstLap,
        elapsed,
      },
    ];
    const tones = getToneScaleSize(elements.melodyPatternSelect.value);
    for (const section of sections) {
      const body = table.createTBody();
      if (sections.length > 1) {
        const label = document.createElement("th");
        label.scope = "rowgroup";
        label.colSpan = header.cells.length;
        label.textContent = `${section.firstLap + 1}周目から · ${formatToneScalePattern(section.notes, tones)}`;
        body.insertRow().append(label);
      }
      section.results.forEach((result, index) => {
        const row = body.insertRow();
        const note = section.notes[index];
        const assessedMs =
          getMelodyAssessedSeconds(
            section.elapsed,
            section.notes.length,
            run.seconds,
            index,
            section.firstLap,
          ) * 1000;
        const values = [
          `${index + 1}. ${note.solfege} (${note.name})`,
          `${(result.inTuneMs / 1000).toFixed(1)}秒`,
          assessedMs > 0
            ? `${Math.min(100, Math.round((result.inTuneMs / assessedMs) * 100))}%`
            : "—",
          `${(result.detectedMs / 1000).toFixed(1)}秒`,
        ];
        for (const value of values) row.insertCell().textContent = value;
      });
    }
    elements.melodyResults.replaceChildren(heading, table);
    elements.melodyResults.hidden = false;
  }

  async function playScale() {
    if (running) {
      stopScalePlayback();
      return;
    }

    let notes: Note[];
    try {
      notes = selectedMelody();
    } catch {
      renderMelodyPreview();
      return;
    }
    controls.prepare();
    running = true;
    setMelodyControlsLocked(true);
    elements.melodyResults.hidden = true;
    elements.melodyResults.replaceChildren();
    elements.melodyStatus.textContent =
      "マイクとお手本音を準備しています。マイクの利用を許可してください。";
    readout.status.textContent = "マイクとお手本音を準備しています。";

    const requestId = ++scalePlaybackRequestId;
    const { instrument } = settings.getSettings();
    settings.showReferencePreparing();
    try {
      const context = getAudioContext();
      const player = playback.getPlayer();
      await player.prepare(instrument);
      if (requestId !== scalePlaybackRequestId) return;
      let capture: MicrophoneCapture | null;
      try {
        capture = await input.start();
      } catch (error) {
        if (requestId !== scalePlaybackRequestId) return;
        stopScalePlayback();
        elements.melodyStatus.textContent = formatMicrophoneError(error);
        console.error(error);
        return;
      }
      if (requestId !== scalePlaybackRequestId) return;
      if (!capture) {
        stopScalePlayback();
        return;
      }
      lastSample = null;
      readout.showMeters(null);
      await context.resume();
      if (requestId !== scalePlaybackRequestId) return;
      const seconds = Number(elements.melodySecondsSelect.value);
      const startedAt = context.currentTime + 0.1;
      const run: MelodyRun = {
        notes,
        seconds,
        startedAt,
        positionKey: "",
        results: notes.map(() => ({ detectedMs: 0, inTuneMs: 0 })),
        previous: null,
        lap: -1,
        firstLap: 0,
        history: [],
        pending: null,
      };
      melodyRun = run;
      melodyGraphData = {
        notes,
        midiRange: melodyGraphMidiRange(),
        seconds,
        tolerance: settings.getSettings().tolerance,
        phase: "ready",
        cursor: 0,
        samples: [],
      };
      elements.melodyGraphScroll.scrollLeft = 0;
      player.playScale(
        instrument,
        notes.map((note) => note.frequency),
        {
          noteSeconds: seconds,
          loop: true,
          countdownSeconds: MELODY_COUNTDOWN_SECONDS,
          countdownSound: elements.melodyCountdownSound.checked,
          startAt: startedAt,
        },
      );
      updateToneScaleControls(notes[0]);
      settings.resetReferenceStatus();
      updatePosition();
      draw();
    } catch (error) {
      if (requestId !== scalePlaybackRequestId) return;
      stopScalePlayback();
      settings.reportReferenceError(error);
      elements.melodyStatus.textContent =
        "開始できませんでした。マイクの許可とお手本音の読み込みを確認して、もう一度お試しください。";
    }
  }

  function stopScalePlayback() {
    if (!running) return;
    const run = melodyRun;
    const context = peekAudioContext();
    const elapsed = run && context ? context.currentTime - run.startedAt : 0;
    if (run?.pending && elapsed >= MELODY_COUNTDOWN_SECONDS)
      updatePosition(elapsed);
    elements.melodyCountdown.hidden = true;
    scalePlaybackRequestId++;
    playback.getCurrentPlayer()?.stopScale();
    running = false;
    melodyRun = null;
    elements.playScaleButton.disabled = !isAudioContextSupported();
    if (melodyGraphData) melodyGraphData.phase = "stopped";
    input.stop();
    setMelodyControlsLocked(false);
    updateToneScaleControls(run?.notes[0]);
    for (const item of elements.melodyNotes.children)
      item.removeAttribute("aria-current");
    if (run && elapsed > MELODY_COUNTDOWN_SECONDS)
      showMelodyResults(run, elapsed);
    if (run)
      updateMelodyMovement(
        run.notes,
        Math.max(
          0,
          getMelodyPosition(elapsed, run.notes.length, run.seconds).index,
        ),
      );
    elements.melodyStatus.textContent =
      "メロディ稽古を停止しました。もう一度始めると最初から練習できます。";
    readout.status.textContent = "稽古を停止しました";
    settings.resetReferenceStatus();
    draw();
  }

  return {
    init,
    show,
    draw,
    onFrame,
    graphScroll: elements.melodyGraphScroll,
    stop: stopScalePlayback,
    refresh: renderMelodyPreview,
    followKeyboard: () => followMelodyKeyboard(elements.melodyKeyboard),
    clear() {
      if (melodyGraphData) melodyGraphData.samples = [];
      lastSample = null;
      readout.showMeters(null);
      draw();
    },
    updateTolerance(tolerance: number) {
      if (melodyGraphData?.phase === "ready")
        melodyGraphData.tolerance = tolerance;
    },
  };
}
