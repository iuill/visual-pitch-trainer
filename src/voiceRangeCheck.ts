import { createAudioContext } from "./audioContext";
import { queryElement } from "./dom";
import { observeGraphResize } from "./graphCanvas";
import { VOICE_RANGE_GRAPH_MS, type VoiceRangeGraphSample } from "./graphModel";
import {
  formatMicrophoneError,
  type MicrophoneCapture,
  MicrophoneInput,
} from "./microphone";
import {
  hzToMidi,
  midiToKaraokeName,
  midiToNoteName,
  midiToSolfegeWithOctave,
} from "./pitchMath";
import {
  createVoiceRange,
  observeVoiceRange,
  RANGE_HOLD_MS,
  removeVoiceRangeNote,
} from "./voiceRange";
import {
  drawVoiceRangeGraph,
  type VoiceRangeGraphNotation,
} from "./voiceRangeGraph";

export function setupVoiceRangeCheck(
  getSettings: () => { deviceId: string; minRms: number },
  beforeStart: () => void,
) {
  const root = queryElement<HTMLElement>("#voiceRangeView");
  const elements = {
    hold: queryElement<HTMLProgressElement>("#voiceRangeHold"),
    start: queryElement<HTMLButtonElement>("#voiceRangeStart"),
    stop: queryElement<HTMLButtonElement>("#voiceRangeStop"),
    reset: queryElement<HTMLButtonElement>("#voiceRangeReset"),
    graphNotation: queryElement<HTMLSelectElement>("#voiceRangeGraphNotation"),
    canvas: queryElement<HTMLCanvasElement>("#voiceRangeCanvas"),
    status: queryElement<HTMLElement>("#voiceRangeStatus"),
    current: queryElement<HTMLElement>("#voiceRangeCurrent"),
    rangeDescription: queryElement<HTMLElement>("#voiceRangeSpan"),
    notes: queryElement<HTMLElement>("#voiceRangeNotes"),
    solfege: queryElement<HTMLElement>("#voiceRangeSolfege"),
    scientific: queryElement<HTMLElement>("#voiceRangeScientific"),
    karaoke: queryElement<HTMLElement>("#voiceRangeKaraoke"),
  };
  let range = createVoiceRange();
  let audioContext: AudioContext | null = null;
  const microphone = new MicrophoneInput();
  let active = false;
  let samples: VoiceRangeGraphSample[] = [];
  let pendingMessage = "";
  let pendingMessageAt = 0;

  elements.hold.max = RANGE_HOLD_MS;
  elements.start.addEventListener("click", () => void start());
  elements.stop.addEventListener("click", () => stop());
  elements.reset.addEventListener("click", () => {
    stop();
    range = createVoiceRange();
    samples = [];
    render();
    message("記録を消しました。もう一度チェックできます。");
  });
  elements.graphNotation.addEventListener("change", drawGraph);
  const stopObservingGraph = observeGraphResize([elements.canvas], drawGraph);
  render();

  return { show, stop, settingsChanged: stop, dispose };

  function message(text: string, now?: number) {
    if (now !== undefined) {
      if (text !== pendingMessage) {
        pendingMessage = text;
        pendingMessageAt = now;
      }
      if (now - pendingMessageAt < 200) return;
    } else pendingMessage = "";
    const element = elements.status;
    if (element.textContent !== text) element.textContent = text;
  }

  function show(visible: boolean) {
    root.hidden = !visible;
    if (visible) requestAnimationFrame(drawGraph);
  }

  function dispose() {
    stop();
    stopObservingGraph();
  }

  function stop() {
    const wasActive = active;
    active = false;
    microphone.stop();
    if (audioContext && audioContext.state !== "closed")
      void audioContext.close().catch(() => {});
    audioContext = null;
    range.candidate = null;
    range.heldMs = 0;
    range.previousAt = null;
    elements.start.disabled = false;
    elements.stop.disabled = true;
    root.removeAttribute("data-running");
    elements.current.textContent = "—";
    elements.hold.value = 0;
    const last = samples.at(-1);
    if (wasActive && last && last.midi !== null)
      samples.push({ timeMs: last.timeMs, midi: null });
    render();
    if (wasActive)
      message(
        range.notes.length
          ? "停止しました。記録した声域を確認できます。続けて測ることもできます。"
          : "停止しました。安定した音はまだ記録されていません。",
      );
  }

  async function start() {
    stop();
    beforeStart();
    active = true;
    render();
    elements.start.disabled = true;
    elements.stop.disabled = false;
    root.setAttribute("data-running", "");
    message("マイクの利用を許可してください。");
    let context: AudioContext | null = null;
    try {
      const nextContext = createAudioContext();
      audioContext = nextContext;
      context = nextContext;
      await nextContext.resume();
      if (audioContext !== context) return;
      const { deviceId, minRms } = getSettings();
      await microphone.start(() => nextContext, {
        deviceId,
        fftSize: 8192,
        onEnded: () => {
          stop();
          message("マイクが切断されました。接続を確認して、再開してください。");
        },
        onFrame: (now, capture) => onFrame(now, capture, minRms),
      });
    } catch (error) {
      if (audioContext !== context) return;
      stop();
      message(formatMicrophoneError(error));
    }
  }

  function onFrame(now: number, capture: MicrophoneCapture, minRms: number) {
    const detection = capture.sampleVoiceRange(minRms);
    const before = range.notes.length;
    observeVoiceRange(range, detection.frequency, now);
    if (now - (samples.at(-1)?.timeMs ?? -Infinity) >= 40) {
      samples.push({
        timeMs: now,
        midi:
          detection.frequency === null ? null : hzToMidi(detection.frequency),
      });
      samples = samples.filter(
        (sample) => sample.timeMs >= now - VOICE_RANGE_GRAPH_MS,
      );
      drawGraph();
    }
    const note = range.candidate;
    elements.current.textContent =
      note === null
        ? "—"
        : `${midiToSolfegeWithOctave(note)} / ${midiToNoteName(note)} / ${midiToKaraokeName(note)}`;
    elements.hold.value = Math.min(RANGE_HOLD_MS, range.heldMs);
    message(
      note === null
        ? "声が小さいか、音程を確認できません。同じ高さでゆっくり伸ばしてください。"
        : range.heldMs >= RANGE_HOLD_MS
          ? "この音を記録しました。無理のない範囲で低い音・高い音も試せます。"
          : "その高さを少し保ってください…",
      now,
    );
    if (before !== range.notes.length) render();
  }

  function render() {
    const low = range.notes[0];
    const high = range.notes.at(-1);
    for (const [element, format] of [
      [elements.solfege, midiToSolfegeWithOctave],
      [elements.scientific, midiToNoteName],
      [elements.karaoke, midiToKaraokeName],
    ] as const)
      element.textContent =
        low === undefined || high === undefined
          ? "—"
          : `${format(low)} 〜 ${format(high)}`;
    elements.rangeDescription.textContent =
      low === undefined || high === undefined
        ? "同じ高さの声を保つと記録されます。"
        : `${range.notes.length}音を記録・最低音と最高音の幅は${high - low}半音です。間のすべての音を確認したわけではありません。`;
    elements.notes.replaceChildren(
      ...range.notes.map((midi) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "voice-range-recorded-note";
        button.disabled = active;
        const label = `${midiToSolfegeWithOctave(midi)} / ${midiToNoteName(midi)} / ${midiToKaraokeName(midi)}`;
        button.textContent = `${label} ×`;
        button.setAttribute("aria-label", `${label}を記録から削除`);
        button.addEventListener("click", () => {
          removeVoiceRangeNote(range, midi);
          render();
          message(`${label}の記録を削除しました。`);
          (
            root.querySelector<HTMLButtonElement>(
              ".voice-range-recorded-note",
            ) ?? elements.reset
          ).focus();
        });
        item.append(button);
        return item;
      }),
    );
    drawGraph();
  }

  function drawGraph() {
    drawVoiceRangeGraph(
      elements.canvas,
      samples,
      range.notes,
      elements.graphNotation.value as VoiceRangeGraphNotation,
    );
  }
}
