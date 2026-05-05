import {
  type AudioFileAnalysis,
  type AudioPitchPoint,
  refineAudioPitchPoints,
  summarizeVoiceRange,
} from "./audioFileAnalysis";
import { getRms, hzToMidi } from "./pitchMath";

type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");

export type CrepeAnalysisProgress = {
  phase: "loading-runtime" | "loading-model" | "analyzing";
  processedFrames?: number;
  totalFrames?: number;
};

export type AnalyzeAudioDataWithCrepeOptions = {
  sampleRate: number;
  modelUrl?: string;
  minRms?: number;
  minConfidence?: number;
  minFrequency?: number;
  maxFrequency?: number;
  batchSize?: number;
  onProgress?: (progress: CrepeAnalysisProgress) => void;
};

const CREPE_SAMPLE_RATE = 16_000;
const CREPE_FRAME_SIZE = 1024;
const CREPE_HOP_SIZE = 160;
const CREPE_BIN_COUNT = 360;
const CREPE_FIRST_BIN_CENTS = 1997.3794084376191;
const CREPE_CENTS_PER_BIN = 20;
const DEFAULT_MIN_RMS = 0.004;
const DEFAULT_MIN_CONFIDENCE = 0.45;
const DEFAULT_MIN_FREQUENCY = 82;
const DEFAULT_MAX_FREQUENCY = 1047;
const DEFAULT_BATCH_SIZE = 256;
const WEIGHTED_ARGMAX_RADIUS = 4;
const ONNX_RUNTIME_WASM_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.asyncify.wasm";
export const CREPE_MODEL_URLS = {
  small: "/models/crepe-small.onnx",
  medium: "/models/crepe-medium.onnx",
  large: "/models/crepe-large.onnx",
  full: "/models/crepe-full.onnx",
} as const;

export type CrepeModelSize = keyof typeof CREPE_MODEL_URLS;

const crepeSessionPromises = new Map<
  string,
  Promise<{
    ort: OnnxRuntimeWebGpu;
    session: Awaited<
      ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>
    >;
  }>
>();

export async function analyzeAudioDataWithCrepe(
  audioData: Float32Array,
  options: AnalyzeAudioDataWithCrepeOptions,
): Promise<AudioFileAnalysis> {
  await assertCrepePitchDetectionSupported();

  const minRms = options.minRms ?? DEFAULT_MIN_RMS;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const modelUrl = options.modelUrl ?? getCrepeModelUrl("small");
  const resampledAudio = resampleLinear(
    audioData,
    options.sampleRate,
    CREPE_SAMPLE_RATE,
  );
  const totalFrames = Math.max(
    0,
    Math.floor((resampledAudio.length - CREPE_FRAME_SIZE) / CREPE_HOP_SIZE) + 1,
  );
  const points: AudioPitchPoint[] = [];

  options.onProgress?.({ phase: "loading-runtime" });
  const { ort, session } = await getCrepeSession(modelUrl, () => {
    options.onProgress?.({ phase: "loading-model" });
  });

  options.onProgress?.({
    phase: "analyzing",
    processedFrames: 0,
    totalFrames,
  });

  for (
    let frameStartIndex = 0;
    frameStartIndex < totalFrames;
    frameStartIndex += batchSize
  ) {
    const currentBatchSize = Math.min(batchSize, totalFrames - frameStartIndex);
    const frames = new Float32Array(currentBatchSize * CREPE_FRAME_SIZE);
    const volumes = new Float32Array(currentBatchSize);

    for (let batchIndex = 0; batchIndex < currentBatchSize; batchIndex += 1) {
      const offset = (frameStartIndex + batchIndex) * CREPE_HOP_SIZE;
      const frame = resampledAudio.subarray(offset, offset + CREPE_FRAME_SIZE);
      frames.set(frame, batchIndex * CREPE_FRAME_SIZE);
      volumes[batchIndex] = getRms(frame);
    }

    const input = new ort.Tensor("float32", frames, [
      currentBatchSize,
      CREPE_FRAME_SIZE,
    ]);
    const output = await session.run({ frames: input });
    const probabilities = output.probabilities;

    if (!probabilities || probabilities.data.length === 0) {
      throw new Error("CREPEモデルからピッチ候補を取得できませんでした。");
    }

    const values = probabilities.data as Float32Array;

    for (let batchIndex = 0; batchIndex < currentBatchSize; batchIndex += 1) {
      const frameIndex = frameStartIndex + batchIndex;
      const timeMs =
        ((frameIndex * CREPE_HOP_SIZE + CREPE_FRAME_SIZE / 2) /
          CREPE_SAMPLE_RATE) *
        1000;
      const volume = volumes[batchIndex] ?? 0;
      const prediction = decodeCrepeFrame(values, batchIndex);
      const isAccepted =
        volume >= minRms &&
        prediction.confidence >= minConfidence &&
        prediction.frequency >= minFrequency &&
        prediction.frequency <= maxFrequency;

      points.push({
        timeMs,
        frequency: isAccepted ? prediction.frequency : null,
        midi: isAccepted ? hzToMidi(prediction.frequency) : null,
        clarity: prediction.confidence,
        volume,
      });
    }

    disposeTensor(input);
    disposeTensor(probabilities);

    options.onProgress?.({
      phase: "analyzing",
      processedFrames: Math.min(
        frameStartIndex + currentBatchSize,
        totalFrames,
      ),
      totalFrames,
    });
  }

  const refinedPoints = refineAudioPitchPoints(points);

  return {
    points: refinedPoints,
    summary: summarizeVoiceRange(
      refinedPoints,
      audioData.length / options.sampleRate,
      CREPE_HOP_SIZE / CREPE_SAMPLE_RATE,
    ),
  };
}

export function getCrepePitchDetectionSupportMessage(): string | null {
  if (!window.isSecureContext) {
    return "CREPE推定にはHTTPSまたはlocalhostの安全な接続が必要です。";
  }

  if (!getNavigatorGpu()) {
    return "このブラウザではWebGPUが使えないため、CREPE推定はPC版Chrome/Edgeなどで試してください。";
  }

  return null;
}

export async function assertCrepePitchDetectionSupported(): Promise<void> {
  const supportMessage = getCrepePitchDetectionSupportMessage();
  if (supportMessage) {
    throw new Error(supportMessage);
  }

  const adapter = await getNavigatorGpu()?.requestAdapter?.();
  if (!adapter) {
    throw new Error(
      "この環境ではWebGPUアダプタを取得できないため、CREPE推定を使えません。",
    );
  }
}

export function resampleLinear(
  audioData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(audioData);
  }

  const outputLength = Math.max(
    0,
    Math.round((audioData.length / sourceSampleRate) * targetSampleRate),
  );
  const output = new Float32Array(outputLength);

  if (audioData.length === 0 || outputLength === 0) {
    return output;
  }

  const scale = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * scale;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, audioData.length - 1);
    const weight = sourceIndex - lowerIndex;
    const lower = audioData[lowerIndex] ?? 0;
    const upper = audioData[upperIndex] ?? lower;
    output[index] = lower + (upper - lower) * weight;
  }

  return output;
}

export function decodeCrepeFrame(
  probabilities: Float32Array,
  frameIndex: number,
): {
  frequency: number;
  confidence: number;
} {
  const offset = frameIndex * CREPE_BIN_COUNT;
  let maxIndex = 0;
  let confidence = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < CREPE_BIN_COUNT; index += 1) {
    const value = probabilities[offset + index] ?? 0;

    if (value > confidence) {
      confidence = value;
      maxIndex = index;
    }
  }

  const start = Math.max(0, maxIndex - WEIGHTED_ARGMAX_RADIUS);
  const end = Math.min(CREPE_BIN_COUNT - 1, maxIndex + WEIGHTED_ARGMAX_RADIUS);
  let weightedSum = 0;
  let weightTotal = 0;

  for (let index = start; index <= end; index += 1) {
    const value = Math.max(0, probabilities[offset + index] ?? 0);
    weightedSum += index * value;
    weightTotal += value;
  }

  const bin = weightTotal > 0 ? weightedSum / weightTotal : maxIndex;

  return {
    frequency: crepeBinToFrequency(bin),
    confidence: Math.max(0, confidence),
  };
}

export function crepeBinToFrequency(bin: number): number {
  const cents = CREPE_FIRST_BIN_CENTS + CREPE_CENTS_PER_BIN * bin;
  return 10 * 2 ** (cents / 1200);
}

export function getCrepeModelUrl(modelSize: CrepeModelSize): string {
  const envModelUrl = import.meta.env.VITE_CREPE_MODEL_URL;

  if (envModelUrl && modelSize === "small") {
    return envModelUrl;
  }

  return CREPE_MODEL_URLS[modelSize];
}

async function getCrepeSession(
  modelUrl: string,
  onCreate?: () => void,
): Promise<{
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
}> {
  let crepeSessionPromise = crepeSessionPromises.get(modelUrl);

  if (!crepeSessionPromise) {
    onCreate?.();
    crepeSessionPromise = createCrepeSession(modelUrl);
    crepeSessionPromises.set(modelUrl, crepeSessionPromise);
  }

  return crepeSessionPromise;
}

async function createCrepeSession(modelUrl: string): Promise<{
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
}> {
  const ort = await import("onnxruntime-web/webgpu");
  configureOnnxRuntime(ort);

  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  });

  return { ort, session };
}

function configureOnnxRuntime(ort: OnnxRuntimeWebGpu) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    wasm: ONNX_RUNTIME_WASM_URL,
  };
  ort.env.webgpu.powerPreference = "high-performance";
}

function getNavigatorGpu():
  | {
      requestAdapter?: () => Promise<unknown>;
    }
  | undefined {
  return (
    navigator as Navigator & {
      gpu?: {
        requestAdapter?: () => Promise<unknown>;
      };
    }
  ).gpu;
}

function disposeTensor(tensor: { dispose?: () => void }) {
  tensor.dispose?.();
}
