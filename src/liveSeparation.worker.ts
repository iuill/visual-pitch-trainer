import * as ort from "onnxruntime-web/webgpu";
import { PitchDetector } from "pitchy";
import { LiveMdxTransform } from "./liveMdxTransform";
import {
  LIVE_MODELS,
  LIVE_SAMPLE_RATE,
  type LiveModelId,
  type LivePitchPoint,
  type LiveWorkerReply,
  type LiveWorkerRequest,
  MDX_BINS,
  MDX_FFT,
  MDX_FRAMES,
  MDX_SAMPLES,
  stemsAreAmbiguous,
} from "./liveSeparation";
import { getRms } from "./pitchMath";

const scope = self as unknown as {
  postMessage(message: LiveWorkerReply): void;
  onmessage: ((event: MessageEvent<LiveWorkerRequest>) => void) | null;
};
let session: ort.InferenceSession | null = null;
let transform: LiveMdxTransform | null = null;
let modelId: LiveModelId = "voc-ft";
let busy = false;
const FRAME_SIZE = 4096;
const detector = PitchDetector.forFloat32Array(FRAME_SIZE);
detector.clarityThreshold = 0.9;

async function modelBytes(id: LiveModelId) {
  const model = LIVE_MODELS[id];
  let cache: Cache | null = null;
  let response: Response | undefined;
  try {
    cache = await caches.open("live-mdx-v1");
    response = await cache.match(model.url);
  } catch {
    /* Storage may be unavailable. */
    cache = null;
  }
  if (!response) {
    scope.postMessage({
      type: "status",
      message: `${model.label}を取得中（約67MB）。音声は送信しません。`,
    });
    response = await fetch(model.url);
  }
  if (!response.ok)
    throw new Error(`モデル取得に失敗しました（${response.status}）。`);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (bytes.byteLength !== model.bytes || hash !== model.sha256) {
    await cache?.delete(model.url);
    throw new Error(
      "モデルのチェックサムが一致しません。再度開始してください。",
    );
  }
  try {
    await cache?.put(model.url, new Response(bytes));
  } catch {
    /* Continue without persistent cache. */
  }
  return bytes;
}

function pitch(samples: Float32Array, minRms: number): number | null {
  if (getRms(samples) < minRms) return null;
  const [hz, clarity] = detector.findPitch(samples, LIVE_SAMPLE_RATE);
  return Number.isFinite(hz) && hz >= 55 && hz <= 1600 && clarity >= 0.9
    ? hz
    : null;
}

async function analyze(
  request: Extract<LiveWorkerRequest, { type: "analyze" }>,
) {
  if (!session || !transform) throw new Error("モデルの準備ができていません。");
  const started = performance.now();
  const count = Math.min(
    MDX_SAMPLES,
    Math.floor(
      (request.samples.length * LIVE_SAMPLE_RATE) / request.sampleRate,
    ),
  );
  const offset = Math.floor((MDX_SAMPLES - count) / 2);
  const mix = new Float32Array(MDX_SAMPLES);
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const at = (i * request.sampleRate) / LIVE_SAMPLE_RATE;
    const lo = Math.floor(at);
    const fraction = at - lo;
    const value =
      request.samples[lo] * (1 - fraction) +
      request.samples[Math.min(lo + 1, request.samples.length - 1)] * fraction;
    mix[offset + i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  // Shared gain for both stems. Never normalize them independently.
  const gain = peak > 0 ? 1 / peak : 1;
  for (let i = offset; i < offset + count; i++) mix[i] *= gain;
  const input = new ort.Tensor("float32", transform.forward(mix), [
    1,
    4,
    MDX_BINS,
    MDX_FRAMES,
  ]);
  let outputs: Record<string, ort.Tensor> = {};
  try {
    outputs = await session.run({ [session.inputNames[0]]: input });
    const tensor = outputs[session.outputNames[0]];
    if (
      tensor?.type !== "float32" ||
      tensor.dims.join(",") !== `1,4,${MDX_BINS},${MDX_FRAMES}`
    )
      throw new Error("想定と異なるMDX出力です。");
    const voice = transform.inverse(tensor.data as Float32Array);
    const piano = new Float32Array(MDX_SAMPLES);
    for (let i = 0; i < MDX_SAMPLES; i++) {
      voice[i] *= LIVE_MODELS[modelId].compensate / gain;
      piano[i] = mix[i] / gain - voice[i];
      if (!Number.isFinite(voice[i]) || !Number.isFinite(piano[i]))
        throw new Error("分離結果に不正な値があります。");
    }
    const points: LivePitchPoint[] = [];
    const startTimeMs = request.endTimeMs - (count / LIVE_SAMPLE_RATE) * 1000;
    // Discard the context edges rather than scoring padded/unstable samples.
    for (
      let i = offset + MDX_FFT / 2;
      i + FRAME_SIZE <= offset + count - MDX_FFT / 2;
      i += 2048
    ) {
      const v = voice.subarray(i, i + FRAME_SIZE);
      const p = piano.subarray(i, i + FRAME_SIZE);
      points.push({
        timeMs:
          startTimeMs +
          ((i - offset + FRAME_SIZE / 2) / LIVE_SAMPLE_RATE) * 1000,
        voiceHz: pitch(v, request.minRms),
        pianoHz: pitch(p, request.minRms),
        uncertain: stemsAreAmbiguous(v, p),
      });
    }
    scope.postMessage({
      type: "result",
      points,
      processingMs: performance.now() - started,
    });
  } finally {
    input.dispose();
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

scope.onmessage = async ({ data }) => {
  if (busy) return; // Main thread also enforces one request in flight.
  busy = true;
  try {
    if (data.type === "load") {
      modelId = data.model;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
      const bytes = await modelBytes(modelId);
      scope.postMessage({
        type: "status",
        message: "モデルを展開中。端末によってメモリ使用量や速度が異なります。",
      });
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: [data.backend],
        graphOptimizationLevel: "disabled",
      });
      transform = new LiveMdxTransform();
      scope.postMessage({ type: "ready" });
    } else {
      await analyze(data);
    }
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy = false;
  }
};
