import {
  LIVE_MODELS,
  LIVE_SAMPLE_RATE,
  type LiveBackend,
  type LiveMatchState,
  type LiveModelId,
  type LivePitchPoint,
  LiveSampleBuffer,
  type LiveWorkerReply,
  type LiveWorkerRequest,
  updateLiveMatch,
} from "./liveSeparation";
import { hzToCents, hzToMidi, hzToNoteName, midiToNoteName } from "./pitchMath";

export class LivePractice {
  private readonly root: HTMLElement;
  private worker: Worker | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private samples: LiveSampleBuffer | null = null;
  private generation = 0;
  private busy = false;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private origin = 0;
  private endTimeMs = 0;
  private lastRequestMs = -Infinity;
  private points: LivePitchPoint[] = [];
  private match: LiveMatchState = {
    lastTimeMs: null,
    targetMidi: null,
    heldMs: 0,
  };

  constructor(private readonly beforeStart: () => Promise<void>) {
    const root = document.querySelector<HTMLElement>("#livePracticeView");
    if (!root) throw new Error("ライブ練習画面が見つかりません。");
    this.root = root;
    this.element<HTMLButtonElement>("liveStart").addEventListener(
      "click",
      () => void this.start(),
    );
    this.element<HTMLButtonElement>("liveStop").addEventListener("click", () =>
      this.stop(),
    );
    const observer = new ResizeObserver(() => this.draw());
    observer.observe(this.element("liveCanvas"));
    window.addEventListener("pagehide", () => this.stop());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
    });
  }
  private element<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`ライブ練習の要素が見つかりません：${id}`);
    return element;
  }
  private status(message: string) {
    this.element("liveStatus").textContent = message;
  }
  private setRunning(value: boolean) {
    this.element<HTMLButtonElement>("liveStart").disabled = value;
    this.element<HTMLButtonElement>("liveStop").disabled = !value;
    this.element<HTMLFieldSetElement>("liveSettings").disabled = value;
  }
  stop(message = "停止しました。最後の解析結果を残しています。") {
    const wasRunning = this.context !== null || this.worker !== null;
    ++this.generation;
    this.ready = false;
    this.busy = false;
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.timer = this.watchdog = null;
    this.worker?.terminate();
    this.worker = null;
    if (this.capture) this.capture.port.onmessage = null;
    this.capture?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = null;
    this.capture = null;
    this.source = null;
    this.stream = null;
    this.samples = null;
    this.root.classList.remove("live-matched");
    this.setRunning(false);
    if (wasRunning) {
      this.status(message);
      this.element("liveMatch").textContent = "停止中（表示は最後の解析位置）";
    }
  }
  private armTimeout(ms: number, message: string) {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.stop(message), ms);
  }
  private async start() {
    this.stop();
    const generation = this.generation;
    this.setRunning(true);
    this.points = [];
    this.match = { lastTimeMs: null, targetMidi: null, heldMs: 0 };
    this.endTimeMs = 0;
    this.lastRequestMs = -Infinity;
    for (const id of [
      "livePiano",
      "liveVoice",
      "liveGap",
      "liveProcessing",
      "liveDelay",
    ])
      this.element(id).textContent = "—";
    this.element("liveMatch").textContent = "準備中";
    this.draw();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("マイクにはHTTPSまたはlocalhostが必要です。");
      const model = this.element<HTMLSelectElement>("liveModel")
        .value as LiveModelId;
      const backend = this.element<HTMLSelectElement>("liveBackend")
        .value as LiveBackend;
      if (!(model in LIVE_MODELS)) throw new Error("認識方式が不正です。");
      if (backend === "webgpu" && !("gpu" in navigator))
        throw new Error(
          "WebGPUが使えません。「CPU」を選んで再度開始してください。",
        );
      this.context = new AudioContext({ sampleRate: LIVE_SAMPLE_RATE });
      const context = this.context;
      context.addEventListener("statechange", () => {
        if (
          generation === this.generation &&
          this.ready &&
          context.state !== "running"
        ) {
          this.stop("音声入力が中断されました。再度開始してください。");
        }
      });
      if (!context.audioWorklet)
        throw new Error("AudioWorklet対応のブラウザが必要です。");
      await context.resume();
      if (generation !== this.generation) return;
      await this.beforeStart();
      if (generation !== this.generation) return;
      this.status("マイクの使用を許可してください。");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (generation === this.generation)
            this.stop("マイクが切断されました。再度開始してください。");
        });
      });
      await context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}live-capture.js`,
      );
      if (generation !== this.generation) return;
      const seconds = Number(
        this.element<HTMLSelectElement>("liveWindow").value,
      );
      this.samples = new LiveSampleBuffer(
        Math.round(seconds * context.sampleRate),
      );
      this.worker = new Worker(
        new URL("./liveSeparation.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = ({ data }: MessageEvent<LiveWorkerReply>) => {
        if (generation !== this.generation) return;
        if (data.type === "error") {
          this.stop(
            `解析を停止しました：${data.message} 設定を変えて再度開始できます。`,
          );
          return;
        }
        if (data.type === "status") this.status(data.message);
        if (data.type === "ready") {
          if (this.watchdog) clearTimeout(this.watchdog);
          this.ready = true;
          this.origin = context.currentTime;
          try {
            this.capture = new AudioWorkletNode(context, "live-capture");
            this.source = context.createMediaStreamSource(stream);
          } catch (error) {
            this.stop(`音声入力の接続に失敗しました：${String(error)}`);
            return;
          }
          this.capture.onprocessorerror = () => {
            if (generation === this.generation)
              this.stop("音声入力処理が停止しました。再度開始してください。");
          };
          this.capture.port.onmessage = (
            event: MessageEvent<{ samples: Float32Array; endTime: number }>,
          ) => {
            if (generation !== this.generation) return;
            this.samples?.push(event.data.samples);
            this.endTimeMs = (event.data.endTime - this.origin) * 1000;
            this.requestAnalysis();
          };
          this.source.connect(this.capture);
          this.capture.connect(context.destination); // Worklet emits silence; microphone is never played.
          this.status(
            `収音中。最初の${seconds.toFixed(1)}秒をためてから解析します。演奏・発声の順番は自由です。`,
          );
          this.element("liveMatch").textContent = "音声を収集中";
          this.timer = setInterval(() => this.updateDelay(), 250);
        }
        if (data.type === "result") {
          if (this.watchdog) clearTimeout(this.watchdog);
          this.busy = false;
          this.acceptResult(data.points, data.processingMs);
          this.requestAnalysis();
        }
      };
      this.worker.onerror = (event) => {
        if (generation === this.generation)
          this.stop(
            `解析ワーカーでエラーが発生しました：${event.message || "実行環境を確認してください。"}`,
          );
      };
      this.armTimeout(
        120_000,
        "モデル準備がタイムアウトしました。通信や処理方式を確認して再度開始してください。",
      );
      this.status(
        "モデルの準備中。初回は約67MBを取得します。停止ボタンで中止できます。",
      );
      this.worker.postMessage({
        type: "load",
        model,
        backend,
      } satisfies LiveWorkerRequest);
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof Error ? error.message : String(error);
        this.stop();
        this.status(`開始できませんでした：${message}`);
      }
    }
  }
  private requestAnalysis() {
    if (
      !this.ready ||
      this.busy ||
      !this.worker ||
      !this.context ||
      this.endTimeMs - this.lastRequestMs < 1000
    )
      return;
    const samples = this.samples?.snapshot();
    if (!samples) return;
    this.lastRequestMs = this.endTimeMs;
    this.busy = true;
    this.armTimeout(
      90_000,
      "解析がタイムアウトしました。別の処理方式で試してください。",
    );
    this.worker.postMessage(
      {
        type: "analyze",
        samples,
        sampleRate: this.context.sampleRate,
        endTimeMs: this.endTimeMs,
        minRms: Number(this.element<HTMLInputElement>("liveMinRms").value),
      } satisfies LiveWorkerRequest,
      [samples.buffer],
    );
  }
  private acceptResult(points: LivePitchPoint[], processingMs: number) {
    const previousEnd = this.points.at(-1)?.timeMs ?? -Infinity;
    const fresh = points.filter((point) => point.timeMs > previousEnd);
    const tolerance = Number(
      this.element<HTMLInputElement>("liveTolerance").value,
    );
    for (const point of fresh)
      this.match = updateLiveMatch(this.match, point, tolerance);
    this.points.push(...fresh);
    const latest = this.points.at(-1);
    if (!latest) return;
    this.points = this.points.filter(
      (point) => point.timeMs >= latest.timeMs - 24_000,
    );
    const format = (hz: number | null) =>
      hz ? `${hzToNoteName(hz)} / ${hz.toFixed(1)} Hz` : "検出できません";
    this.element("livePiano").textContent = format(latest.pianoHz);
    this.element("liveVoice").textContent = format(latest.voiceHz);
    const cents =
      latest.voiceHz && latest.pianoHz
        ? hzToCents(latest.voiceHz, latest.pianoHz)
        : null;
    this.element("liveGap").textContent =
      cents === null
        ? "—"
        : `${cents > 0 ? "+" : ""}${Math.round(cents)} cents`;
    this.element("liveProcessing").textContent =
      `${(processingMs / 1000).toFixed(2)} 秒`;
    const matched = this.match.heldMs >= 500;
    this.root.classList.toggle("live-matched", matched);
    this.element("liveMatch").textContent = latest.uncertain
      ? "判別中（分離の漏れ・音量差の可能性）"
      : cents === null
        ? "両方の音程を検出できていません"
        : matched
          ? "推定一致 ✨"
          : Math.abs(cents) <= tolerance
            ? "許容幅内・キープ中"
            : cents > 0
              ? "声が高め"
              : "声が低め";
    this.status(
      "解析中。表示は過去の解析位置の推定です。声とピアノの取り違え・誤った一致判定があり得ます。",
    );
    this.updateDelay();
    this.draw();
  }
  private updateDelay() {
    const latest = this.points.at(-1);
    if (!latest || !this.context) return;
    const delay = Math.max(
      0,
      (this.context.currentTime - this.origin) * 1000 - latest.timeMs,
    );
    this.element("liveDelay").textContent = `${(delay / 1000).toFixed(1)} 秒前`;
  }
  private draw() {
    const canvas = this.element<HTMLCanvasElement>("liveCanvas");
    const width = canvas.getBoundingClientRect().width;
    if (width < 1) return;
    const height = 320;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fffdf7";
    ctx.fillRect(0, 0, width, height);
    const midis = this.points.flatMap((point) =>
      [point.pianoHz, point.voiceHz]
        .filter((hz): hz is number => hz !== null)
        .map(hzToMidi),
    );
    const low = Math.floor(Math.min(48, ...midis) - 2);
    const high = Math.ceil(Math.max(72, ...midis) + 2);
    const y = (hz: number) =>
      20 + ((high - hzToMidi(hz)) / (high - low)) * (height - 55);
    const end = this.points.at(-1)?.timeMs ?? 24_000;
    const start = Math.max(0, end - 24_000);
    const duration = Math.max(6000, end - start);
    const x = (time: number) => 48 + ((time - start) / duration) * (width - 60);
    ctx.font = "12px sans-serif";
    for (let midi = low; midi <= high; midi++) {
      if (high - low > 36 && midi % 2 !== 0) continue;
      const at = 20 + ((high - midi) / (high - low)) * (height - 55);
      ctx.strokeStyle = "#e1e5e3";
      ctx.beginPath();
      ctx.moveTo(45, at);
      ctx.lineTo(width - 10, at);
      ctx.stroke();
      ctx.fillStyle = "#52605e";
      ctx.fillText(midiToNoteName(midi), 4, at + 4);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(46, 0, width - 46, height - 25);
    ctx.clip();
    let previous: LivePitchPoint | null = null;
    for (const point of this.points) {
      if (point.pianoHz) {
        ctx.strokeStyle = point.uncertain ? "#8a978f" : "#15806d";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x(point.timeMs - 23), y(point.pianoHz));
        ctx.lineTo(x(point.timeMs + 23), y(point.pianoHz));
        ctx.stroke();
      }
      if (point.voiceHz) {
        ctx.strokeStyle = "#245eb7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (previous?.voiceHz && point.timeMs - previous.timeMs <= 150)
          ctx.moveTo(x(previous.timeMs), y(previous.voiceHz));
        else ctx.moveTo(x(point.timeMs) - 1, y(point.voiceHz));
        ctx.lineTo(x(point.timeMs), y(point.voiceHz));
        ctx.stroke();
      }
      previous = point;
    }
    ctx.restore();
    ctx.fillStyle = "#52605e";
    ctx.fillText(`${(start / 1000).toFixed(1)} 秒`, 48, height - 8);
    ctx.textAlign = "right";
    ctx.fillText(
      `${(end / 1000).toFixed(1)} 秒（解析位置）`,
      width - 10,
      height - 8,
    );
    if (!this.points.length) {
      ctx.textAlign = "center";
      ctx.fillText(
        "開始するとピアノと声の推定を重ねます",
        width / 2,
        height / 2,
      );
    }
  }
}
