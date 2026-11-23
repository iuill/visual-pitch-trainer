import {
  getAudioContext,
  isAudioContextSupported,
  peekAudioContext,
} from "./audioContext";
import { queryElement } from "./dom";
import { drawMelodyGraph, type MelodyGraphData } from "./melodyGraph";
import { followMelodyKeyboard, renderMelodyKeyboard } from "./melodyKeyboard";
import {
  buildMelody,
  getLastToneScaleStart,
  getMelodyAssessedSeconds,
  getMelodyPosition,
  getToneScaleSize,
  MELODY_COUNTDOWN_SECONDS,
  MELODY_GRACE_SECONDS,
  MELODY_PATTERNS,
  type MelodyNoteResult,
  type MelodyObservation,
  pickToneScaleStart,
  recordMelodyObservation,
} from "./melodyPractice";
import { formatMicrophoneError } from "./microphone";
import { formatPitchMovement, type Note } from "./pitchMath";
import { getPitchMovementIcon } from "./pitchMovementVisual";
import type { ReferenceInstrumentId } from "./referenceInstruments";
import type { ReferencePlayer } from "./referencePlayer";
import type { PitchSample } from "./session";
import { setupSettingsDialog } from "./settingsDialog";

export type PracticeInputStartResult =
  | { ok: true }
  | { ok: false; message?: string };

type MelodyDependencies = {
  getSettings(): {
    startMidi: number;
    tolerance: number;
    instrument: ReferenceInstrumentId;
  };
  getPlayer(): ReferencePlayer;
  getCurrentPlayer(): ReferencePlayer | null;
  prepareInput(): void;
  startInput(): Promise<PracticeInputStartResult>;
  stopInput(): void;
  inputIsStarting(): boolean;
  reportInputStatus(message: string): void;
  prepareReferenceStatus(): void;
  updateReferenceInstrumentDescription(): void;
  showReferenceAudioError(error: unknown): void;
  setSharedControlsLocked(locked: boolean): void;
};

export function createMelodyPracticeView(deps: MelodyDependencies) {
  const elements = {
    melodySection: queryElement<HTMLElement>(".melody-practice"),
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
    toneScaleManual: queryElement<HTMLDivElement>("#toneScaleManual"),
    toneScaleDown: queryElement<HTMLButtonElement>("#toneScaleDown"),
    toneScaleUp: queryElement<HTMLButtonElement>("#toneScaleUp"),
    toneScaleRandomControls: queryElement<HTMLDivElement>(
      "#toneScaleRandomControls",
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
  let timer: number | null = null;
  let scalePlaybackRequestId = 0;
  let melodyGraphData: MelodyGraphData | null = null;

  function init() {
    setupSettingsDialog(elements.melodySetup, elements.openMelodySettings);
    elements.melodyPatternSelect.replaceChildren(
      ...MELODY_PATTERNS.map(
        (pattern) => new Option(pattern.label, pattern.id),
      ),
      new Option("自由メロディ（音名を入力）", "custom"),
    );
    elements.melodyPatternSelect.addEventListener("change", () => {
      toneScaleStartDegree = 0;
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
      if (steps > 0 && toneScaleRandomSteps === 0) setToneScaleStart(0);
      toneScaleRandomSteps = steps;
      updateToneScaleControls();
    });
    elements.toneScaleNext.addEventListener("click", () => {
      setToneScaleStart(
        pickToneScaleStart(
          getToneScaleSize(elements.melodyPatternSelect.value),
          toneScaleStartDegree,
          toneScaleRandomSteps,
        ),
      );
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
    elements.melodySection.hidden = !visible;
    elements.melodyGraphView.hidden = !visible;
    elements.melodyResults.hidden =
      !visible ||
      melodyGraphData?.phase !== "stopped" ||
      !elements.melodyResults.childElementCount;
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
        deps.getSettings().tolerance,
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
      lap: number;
      notes: Note[];
    } | null;
  };
  let melodyRun: MelodyRun | null = null;

  function selectedMelody(degree = toneScaleStartDegree): Note[] {
    return buildMelody(
      elements.melodyPatternSelect.value,
      elements.customMelodyInput.value,
      deps.getSettings().startMidi,
      degree,
    );
  }

  function setToneScaleStart(degree: number) {
    const tones = getToneScaleSize(elements.melodyPatternSelect.value);
    const next = Math.max(0, Math.min(degree, getLastToneScaleStart(tones)));
    const run = melodyRun;
    if (!tones || next === (run?.pending?.degree ?? toneScaleStartDegree))
      return;
    if (run) {
      queueMelodyStart(run, next);
      return;
    }
    if (running) return;
    toneScaleStartDegree = next;
    renderMelodyPreview();
  }

  function queueMelodyStart(run: MelodyRun, degree: number) {
    const player = deps.getCurrentPlayer();
    if (!player) return;
    const notes = selectedMelody(degree);
    const frequencies = notes.map((note) => note.frequency);
    // If the audio clock reaches the boundary while updating the display, use the following lap.
    for (let attempt = 0; attempt < 2; attempt++) {
      const position = tickMelody(false);
      if (!position) return;
      const lap = position.phase === "countdown" ? 0 : position.lap + 1;
      if (!player.replaceScaleLap(lap, frequencies)) continue;
      run.pending =
        degree === toneScaleStartDegree ? null : { degree, lap, notes };
      if (lap === 0) {
        applyMelodyLapChange(run);
        tickMelody(false);
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

  function updateToneScaleControls(start?: Note) {
    const tones = getToneScaleSize(elements.melodyPatternSelect.value);
    const random = toneScaleRandomSteps > 0;
    const locked = running;
    const pending = melodyRun?.pending;
    const degree = pending?.degree ?? toneScaleStartDegree;
    const manualLocked = locked && !melodyRun;
    elements.toneScaleControls.hidden = !tones;
    elements.toneScaleManual.hidden = random && !locked;
    elements.toneScaleRandomControls.hidden = locked;
    elements.toneScaleNext.hidden = !random;
    elements.toneScaleRandom.disabled = locked;
    elements.toneScaleDown.disabled = manualLocked;
    elements.toneScaleUp.disabled = manualLocked;
    elements.toneScaleDown.setAttribute(
      "aria-disabled",
      String(manualLocked || degree === 0),
    );
    elements.toneScaleUp.setAttribute(
      "aria-disabled",
      String(manualLocked || degree === getLastToneScaleStart(tones)),
    );
    elements.toneScaleNext.disabled = locked;
    if (tones && start) {
      const next = pending?.notes[0];
      const label = `開始音：${start.solfege}（${start.name}）${pending && next ? ` · ${pending.lap + 1}周目から${next.solfege}（${next.name}）` : ""}`;
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
    const start = deps.getSettings().startMidi;
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
        tolerance: deps.getSettings().tolerance,
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
    document.body.classList.toggle("is-melody-running", locked);
    deps.setSharedControlsLocked(locked);
    elements.playScaleButton
      .closest(".melody-practice")
      ?.classList.toggle("is-running", locked);
    for (const control of [
      elements.openMelodySettings,
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

  function tickMelody(schedule = true, elapsed?: number) {
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
      if (position.index >= 0) draw();
    }
    const message =
      position.phase === "countdown"
        ? `お手本と一緒に発声します：あと${Math.ceil(position.remaining)}秒`
        : `${position.lap + 1}周目・一緒に発声：${position.index + 1}/${run.notes.length}音 ${run.notes[position.index].solfege} (${run.notes[position.index].name})・あと${Math.ceil(position.remaining)}秒`;
    if (elements.melodyStatus.textContent !== message)
      elements.melodyStatus.textContent = message;
    if (schedule && position.phase !== "sing") draw();
    if (schedule) timer = window.setTimeout(tickMelody, 50);
    return position;
  }

  function showMelodyResults(
    run: NonNullable<typeof melodyRun>,
    elapsed: number,
  ) {
    const heading = document.createElement("p");
    heading.textContent = `練習全体の集計です。グラフは停止した周回の声です。判定幅は半音の${melodyGraphData?.tolerance ?? deps.getSettings().tolerance}%です。各周回の最初の${MELODY_GRACE_SECONDS}秒だけが周回開始の猶予です。途中の音の切り替わりには猶予を設けません。「合った割合」は停止までの判定対象時間に対する割合で、無音・検出不能も含みます。`;
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
    for (const section of sections) {
      const body = table.createTBody();
      if (sections.length > 1) {
        const label = document.createElement("th");
        label.scope = "rowgroup";
        label.colSpan = header.cells.length;
        const start = section.notes[0];
        label.textContent = `${section.firstLap + 1}周目から · 開始音 ${start.solfege} (${start.name})`;
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

    if (deps.inputIsStarting()) {
      deps.reportInputStatus(
        "マイクの準備中です。少し待ってからメロディ稽古を始めてください。",
      );
      return;
    }

    let notes: Note[];
    try {
      notes = selectedMelody();
    } catch {
      renderMelodyPreview();
      return;
    }
    deps.prepareInput();
    running = true;
    setMelodyControlsLocked(true);
    elements.melodyResults.hidden = true;
    elements.melodyResults.replaceChildren();
    elements.melodyStatus.textContent =
      "マイクとお手本音を準備しています。マイクの利用を許可してください。";

    const requestId = ++scalePlaybackRequestId;
    const { instrument } = deps.getSettings();
    deps.prepareReferenceStatus();
    try {
      const context = getAudioContext();
      const player = deps.getPlayer();
      await player.prepare(instrument);
      if (requestId !== scalePlaybackRequestId) return;
      let input: PracticeInputStartResult;
      try {
        input = await deps.startInput();
      } catch (error) {
        if (requestId !== scalePlaybackRequestId) return;
        stopScalePlayback();
        elements.melodyStatus.textContent = formatMicrophoneError(error);
        console.error(error);
        return;
      }
      if (requestId !== scalePlaybackRequestId) return;
      if (!input.ok) {
        stopScalePlayback();
        if (input.message) elements.melodyStatus.textContent = input.message;
        return;
      }
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
        tolerance: deps.getSettings().tolerance,
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
      deps.updateReferenceInstrumentDescription();
      tickMelody();
    } catch (error) {
      if (requestId !== scalePlaybackRequestId) return;
      stopScalePlayback();
      deps.showReferenceAudioError(error);
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
      tickMelody(false, elapsed);
    elements.melodyCountdown.hidden = true;
    scalePlaybackRequestId++;
    deps.getCurrentPlayer()?.stopScale();
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }

    running = false;
    melodyRun = null;
    elements.playScaleButton.disabled = !isAudioContextSupported();
    if (melodyGraphData) melodyGraphData.phase = "stopped";
    deps.stopInput();
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
    deps.updateReferenceInstrumentDescription();
    draw();
  }

  return {
    init,
    show,
    draw,
    record,
    get running() {
      return running;
    },
    graphScroll: elements.melodyGraphScroll,
    tick: tickMelody,
    noteAt: (index: number | undefined) =>
      index === undefined ? undefined : melodyRun?.notes[index],
    stop: stopScalePlayback,
    refresh: renderMelodyPreview,
    hasStoppedGraph: () => melodyGraphData?.phase === "stopped",
    followKeyboard: () => followMelodyKeyboard(elements.melodyKeyboard),
    clearGraph() {
      if (melodyGraphData) melodyGraphData.samples = [];
    },
    updateTolerance(tolerance: number) {
      if (melodyGraphData?.phase === "ready")
        melodyGraphData.tolerance = tolerance;
    },
  };
}
