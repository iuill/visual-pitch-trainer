import { createAudioContext } from "./audioContext";
import { observeGraphResize } from "./graphCanvas";
import { VOICE_RANGE_GRAPH_MS, type VoiceRangeGraphSample } from "./graphModel";
import { formatMicrophoneError, MicrophoneInput } from "./microphone";
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

export class VoiceRangeCheck {
  private range = createVoiceRange();
  private context: AudioContext | null = null;
  private readonly microphone = new MicrophoneInput();
  private active = false;
  private samples: VoiceRangeGraphSample[] = [];
  private readonly root: HTMLElement;
  private readonly stopObservingGraph: () => void;
  private readonly actions: HTMLElement;
  private pendingMessage = "";
  private pendingMessageAt = 0;

  constructor(
    private readonly settings: () => { deviceId: string; minRms: number },
    private readonly beforeStart: () => void,
  ) {
    const root = document.querySelector<HTMLElement>("#voiceRangeView");
    if (!root) throw new Error("声域チェック画面がありません。");
    this.root = root;
    this.actions = this.el("voiceRangeActions");
    this.el<HTMLProgressElement>("voiceRangeHold").max = RANGE_HOLD_MS;
    this.el<HTMLButtonElement>("voiceRangeStart").addEventListener(
      "click",
      () => void this.start(),
    );
    this.el<HTMLButtonElement>("voiceRangeStop").addEventListener("click", () =>
      this.stop(),
    );
    this.el<HTMLButtonElement>("voiceRangeReset").addEventListener(
      "click",
      () => {
        this.stop();
        this.range = createVoiceRange();
        this.samples = [];
        this.render();
        this.message("記録を消しました。もう一度チェックできます。");
      },
    );
    this.el<HTMLSelectElement>("voiceRangeGraphNotation").addEventListener(
      "change",
      () => this.drawGraph(),
    );
    this.stopObservingGraph = observeGraphResize(
      [this.el("voiceRangeCanvas")],
      () => this.drawGraph(),
    );
    this.render();
  }

  private el<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`声域チェックの要素がありません：${id}`);
    return element;
  }

  private message(text: string, now?: number) {
    if (now !== undefined) {
      if (text !== this.pendingMessage) {
        this.pendingMessage = text;
        this.pendingMessageAt = now;
      }
      if (now - this.pendingMessageAt < 200) return;
    } else this.pendingMessage = "";
    const element = this.el("voiceRangeStatus");
    if (element.textContent !== text) element.textContent = text;
  }

  dispose() {
    this.stop();
    this.stopObservingGraph();
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    this.microphone.stop();
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = null;
    this.range.candidate = null;
    this.range.heldMs = 0;
    this.range.previousAt = null;
    this.el<HTMLButtonElement>("voiceRangeStart").disabled = false;
    this.el<HTMLButtonElement>("voiceRangeStop").disabled = true;
    this.actions.classList.remove("mobile-action-bar");
    this.el("voiceRangeCurrent").textContent = "—";
    this.el<HTMLProgressElement>("voiceRangeHold").value = 0;
    const last = this.samples.at(-1);
    if (wasActive && last && last.midi !== null)
      this.samples.push({ timeMs: last.timeMs, midi: null });
    this.render();
    if (wasActive)
      this.message(
        this.range.notes.length
          ? "停止しました。記録した声域を確認できます。続けて測ることもできます。"
          : "停止しました。安定した音はまだ記録されていません。",
      );
  }

  private async start() {
    this.stop();
    this.beforeStart();
    this.active = true;
    this.render();
    this.el<HTMLButtonElement>("voiceRangeStart").disabled = true;
    this.el<HTMLButtonElement>("voiceRangeStop").disabled = false;
    this.actions.classList.add("mobile-action-bar");
    this.message("マイクの利用を許可してください。");
    let context: AudioContext | null = null;
    try {
      context = createAudioContext();
      this.context = context;
      await context.resume();
      if (this.context !== context) return;
      const { deviceId, minRms } = this.settings();
      const capture = await this.microphone.start(context, {
        deviceId,
        fftSize: 8192,
        onEnded: () => {
          this.stop();
          this.message(
            "マイクが切断されました。接続を確認して、再開してください。",
          );
        },
      });
      if (!capture || this.context !== context) return;
      this.microphone.startFrames((now, capture) => {
        const detection = capture.sampleVoiceRange(minRms);
        const before = this.range.notes.length;
        observeVoiceRange(this.range, detection.frequency, now);
        if (now - (this.samples.at(-1)?.timeMs ?? -Infinity) >= 40) {
          this.samples.push({
            timeMs: now,
            midi:
              detection.frequency === null
                ? null
                : hzToMidi(detection.frequency),
          });
          this.samples = this.samples.filter(
            (sample) => sample.timeMs >= now - VOICE_RANGE_GRAPH_MS,
          );
          this.drawGraph();
        }
        const note = this.range.candidate;
        this.el("voiceRangeCurrent").textContent =
          note === null
            ? "—"
            : `${midiToSolfegeWithOctave(note)} / ${midiToNoteName(note)} / ${midiToKaraokeName(note)}`;
        this.el<HTMLProgressElement>("voiceRangeHold").value = Math.min(
          RANGE_HOLD_MS,
          this.range.heldMs,
        );
        this.message(
          note === null
            ? "声が小さいか、音程を確認できません。同じ高さでゆっくり伸ばしてください。"
            : this.range.heldMs >= RANGE_HOLD_MS
              ? "この音を記録しました。無理のない範囲で低い音・高い音も試せます。"
              : "その高さを少し保ってください…",
          now,
        );
        if (before !== this.range.notes.length) this.render();
      });
    } catch (error) {
      if (this.context !== context) return;
      this.stop();
      this.message(formatMicrophoneError(error));
    }
  }

  private render() {
    const low = this.range.notes[0];
    const high = this.range.notes.at(-1);
    for (const [id, format] of [
      ["voiceRangeSolfege", midiToSolfegeWithOctave],
      ["voiceRangeScientific", midiToNoteName],
      ["voiceRangeKaraoke", midiToKaraokeName],
    ] as const)
      this.el(id).textContent =
        low === undefined || high === undefined
          ? "—"
          : `${format(low)} 〜 ${format(high)}`;
    this.el("voiceRangeSpan").textContent =
      low === undefined || high === undefined
        ? "同じ高さの声を保つと記録されます。"
        : `${this.range.notes.length}音を記録・最低音と最高音の幅は${high - low}半音です。間のすべての音を確認したわけではありません。`;
    this.el("voiceRangeNotes").replaceChildren(
      ...this.range.notes.map((midi) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "voice-range-recorded-note";
        button.disabled = this.active;
        const label = `${midiToSolfegeWithOctave(midi)} / ${midiToNoteName(midi)} / ${midiToKaraokeName(midi)}`;
        button.textContent = `${label} ×`;
        button.setAttribute("aria-label", `${label}を記録から削除`);
        button.addEventListener("click", () => {
          removeVoiceRangeNote(this.range, midi);
          this.render();
          this.message(`${label}の記録を削除しました。`);
          (
            this.root.querySelector<HTMLButtonElement>(
              ".voice-range-recorded-note",
            ) ?? this.el<HTMLButtonElement>("voiceRangeReset")
          ).focus();
        });
        item.append(button);
        return item;
      }),
    );
    this.drawGraph();
  }

  private drawGraph() {
    drawVoiceRangeGraph(
      this.el<HTMLCanvasElement>("voiceRangeCanvas"),
      this.samples,
      this.range.notes,
      this.el<HTMLSelectElement>("voiceRangeGraphNotation")
        .value as VoiceRangeGraphNotation,
    );
  }
}
