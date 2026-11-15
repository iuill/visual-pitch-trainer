import { PitchDetector } from "pitchy";
import { VOICE_RANGE_GRAPH_MS, type VoiceRangeGraphSample } from "./graphModel";
import { detectVoiceRangePitch } from "./pitchDetection";
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
} from "./voiceRange";
import {
  drawVoiceRangeGraph,
  type VoiceRangeGraphNotation,
} from "./voiceRangeGraph";

export class VoiceRangeCheck {
  private range = createVoiceRange();
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: number | null = null;
  private generation = 0;
  private active = false;
  private samples: VoiceRangeGraphSample[] = [];
  private readonly root: HTMLElement;

  constructor(
    private readonly settings: () => { deviceId: string; minRms: number },
    private readonly beforeStart: () => void,
  ) {
    const root = document.querySelector<HTMLElement>("#voiceRangeView");
    if (!root) throw new Error("声域チェック画面がありません。");
    this.root = root;
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
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
    });
    window.addEventListener("pagehide", () => this.stop());
    this.el<HTMLSelectElement>("voiceRangeGraphNotation").addEventListener(
      "change",
      () => this.drawGraph(),
    );
    new ResizeObserver(() => this.drawGraph()).observe(
      this.el("voiceRangeCanvas"),
    );
    this.render();
  }

  private el<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`声域チェックの要素がありません：${id}`);
    return element;
  }

  private message(text: string) {
    const element = this.el("voiceRangeStatus");
    if (element.textContent !== text) element.textContent = text;
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    this.generation++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.range.candidate = null;
    this.range.heldMs = 0;
    this.range.previousAt = null;
    this.el<HTMLButtonElement>("voiceRangeStart").disabled = false;
    this.el<HTMLButtonElement>("voiceRangeStop").disabled = true;
    this.el("voiceRangeCurrent").textContent = "—";
    this.el<HTMLProgressElement>("voiceRangeHold").value = 0;
    const last = this.samples.at(-1);
    if (wasActive && last && last.midi !== null)
      this.samples.push({ timeMs: last.timeMs, midi: null });
    this.drawGraph();
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
    const generation = this.generation;
    this.active = true;
    this.el<HTMLButtonElement>("voiceRangeStart").disabled = true;
    this.el<HTMLButtonElement>("voiceRangeStop").disabled = false;
    this.message("マイクの利用を許可してください。");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("microphone unavailable");
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("audio unavailable");
      const context = new Context();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const { deviceId, minRms } = this.settings();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      for (const track of stream.getTracks())
        track.addEventListener("ended", () => {
          if (generation === this.generation) this.stop();
        });
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      this.analyser = analyser;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const detector = PitchDetector.forFloat32Array(buffer.length);
      detector.clarityThreshold = 0.93;
      detector.minVolumeAbsolute = minRms;
      const detectors = {
        detector,
        sampleRate: context.sampleRate,
        bufferSize: buffer.length,
      };
      const tick = (now: number) => {
        if (generation !== this.generation) return;
        analyser.getFloatTimeDomainData(buffer);
        const detection = detectVoiceRangePitch(buffer, detectors, minRms);
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
        );
        if (before !== this.range.notes.length) this.render();
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    } catch {
      if (generation !== this.generation) return;
      this.stop();
      this.message(
        "マイクを開始できません。HTTPSまたはlocalhostで開き、ブラウザのマイク許可と接続を確認してください。",
      );
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
        item.className = "voice-range-recorded-note";
        item.textContent = `${midiToSolfegeWithOctave(midi)} / ${midiToNoteName(midi)} / ${midiToKaraokeName(midi)}`;
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
