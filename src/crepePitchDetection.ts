import {
  type AudioFileAnalysis,
  type AudioPitchPoint,
  refineAudioPitchPoints,
  summarizeVoiceRange,
} from "./audioFileAnalysis";
import {
  assertModelUrlAccessible,
  PITCH_MODEL_SETUP_HINT,
} from "./modelAccess";
import {
  assertWebGpuSupported,
  createPitchModelSession,
  disposeTensors,
  getWebGpuSupportMessage,
  type PitchModelSession,
} from "./onnxRuntime";
import { getRms, hzToMidi } from "./pitchMath";
import { decodePitchModelFrame } from "./pitchModelDecoding";

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
const DEFAULT_MIN_RMS = 0.004;
const DEFAULT_MIN_CONFIDENCE = 0.45;
const DEFAULT_MIN_FREQUENCY = 82;
const DEFAULT_MAX_FREQUENCY = 1047;
const DEFAULT_BATCH_SIZE = 256;
const LOW_PASS_TAP_COUNT = 31;
const CREPE_MODEL_PATHS = {
  small: "models/crepe-small.onnx",
  medium: "models/crepe-medium.onnx",
  large: "models/crepe-large.onnx",
  full: "models/crepe-full.onnx",
} as const;

export type CrepeModelSize = keyof typeof CREPE_MODEL_PATHS;

const crepeSessionPromises = new Map<string, Promise<PitchModelSession>>();

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
  const resampledAudio = await resampleAudioForPitchModel(
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
    let output: Record<string, { data: unknown; dispose?: () => void }> = {};

    try {
      output = await session.run({ frames: input });
      const probabilities = output.probabilities;

      const values = probabilities?.data as Float32Array | undefined;

      if (!values || values.length === 0) {
        throw new Error("CREPEモデルからピッチ候補を取得できませんでした。");
      }

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
    } finally {
      disposeTensors(input, ...Object.values(output));
    }

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
  return getWebGpuSupportMessage("CREPE推定");
}
export function assertCrepePitchDetectionSupported(): Promise<void> {
  return assertWebGpuSupported("CREPE推定");
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

export async function resampleAudioForPitchModel(
  audioData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(audioData);
  }

  const offlineAudioContext = getOfflineAudioContextConstructor();
  if (offlineAudioContext) {
    try {
      return await resampleWithOfflineAudioContext(
        audioData,
        sourceSampleRate,
        targetSampleRate,
        offlineAudioContext,
      );
    } catch {
      // Fall back to the deterministic path below when a browser rejects the
      // source rate or cannot create an OfflineAudioContext.
    }
  }

  return resampleLinear(
    lowPassBeforeDownsampling(audioData, sourceSampleRate, targetSampleRate),
    sourceSampleRate,
    targetSampleRate,
  );
}

export function decodeCrepeFrame(
  probabilities: Float32Array,
  frameIndex: number,
) {
  return decodePitchModelFrame(probabilities, frameIndex, "bins");
}

export { pitchBinToFrequency as crepeBinToFrequency } from "./pitchModelDecoding";

export function getCrepeModelUrl(modelSize: CrepeModelSize): string {
  const envModelUrl = import.meta.env.VITE_CREPE_MODEL_URL;

  if (envModelUrl && modelSize === "small") {
    return envModelUrl;
  }

  return CREPE_MODEL_PATHS[modelSize];
}

export async function assertCrepeModelAccessible(
  modelSize: CrepeModelSize,
): Promise<void> {
  await assertModelUrlAccessible({
    label: `CREPE ${modelSize}`,
    modelUrl: getCrepeModelUrl(modelSize),
    minBytes: 1024 * 1024,
    setupHint: PITCH_MODEL_SETUP_HINT,
  });
}

export async function releaseCrepeSessions() {
  const sessionPromises = Array.from(crepeSessionPromises.values());
  crepeSessionPromises.clear();

  await Promise.all(
    sessionPromises.map(async (sessionPromise) => {
      try {
        const { session } = await sessionPromise;
        await session.release();
      } catch (error) {
        console.warn("Failed to release CREPE ONNX session.", error);
      }
    }),
  );
}

async function resampleWithOfflineAudioContext(
  audioData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  offlineAudioContext: typeof OfflineAudioContext,
): Promise<Float32Array> {
  const outputLength = Math.max(
    1,
    Math.round((audioData.length / sourceSampleRate) * targetSampleRate),
  );
  const context = new offlineAudioContext(1, outputLength, targetSampleRate);
  const buffer = context.createBuffer(1, audioData.length, sourceSampleRate);
  buffer.copyToChannel(new Float32Array(audioData), 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();

  const renderedBuffer = await context.startRendering();
  return new Float32Array(renderedBuffer.getChannelData(0));
}

function lowPassBeforeDownsampling(
  audioData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate >= sourceSampleRate) {
    return audioData;
  }

  const cutoffRatio = Math.min(
    0.45,
    (targetSampleRate / sourceSampleRate) * 0.45,
  );
  const taps = createLowPassKernel(LOW_PASS_TAP_COUNT, cutoffRatio);
  const output = new Float32Array(audioData.length);
  const center = Math.floor(taps.length / 2);

  for (let index = 0; index < audioData.length; index += 1) {
    let sum = 0;

    for (let tapIndex = 0; tapIndex < taps.length; tapIndex += 1) {
      const sourceIndex = clampIndex(
        index + tapIndex - center,
        audioData.length,
      );
      sum += (audioData[sourceIndex] ?? 0) * (taps[tapIndex] ?? 0);
    }

    output[index] = sum;
  }

  return output;
}

function createLowPassKernel(
  tapCount: number,
  cutoffRatio: number,
): Float32Array {
  const taps = new Float32Array(tapCount);
  const center = (tapCount - 1) / 2;
  let sum = 0;

  for (let index = 0; index < tapCount; index += 1) {
    const offset = index - center;
    const sinc =
      offset === 0
        ? 2 * cutoffRatio
        : Math.sin(2 * Math.PI * cutoffRatio * offset) / (Math.PI * offset);
    const window =
      0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (tapCount - 1));
    const value = sinc * window;
    taps[index] = value;
    sum += value;
  }

  for (let index = 0; index < taps.length; index += 1) {
    taps[index] /= sum;
  }

  return taps;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function getOfflineAudioContextConstructor():
  | typeof OfflineAudioContext
  | undefined {
  return (
    (
      globalThis as typeof globalThis & {
        webkitOfflineAudioContext?: typeof OfflineAudioContext;
      }
    ).OfflineAudioContext ??
    (
      globalThis as typeof globalThis & {
        webkitOfflineAudioContext?: typeof OfflineAudioContext;
      }
    ).webkitOfflineAudioContext
  );
}

async function getCrepeSession(
  modelUrl: string,
  onCreate?: () => void,
): Promise<PitchModelSession> {
  let crepeSessionPromise = crepeSessionPromises.get(modelUrl);

  if (!crepeSessionPromise) {
    onCreate?.();
    crepeSessionPromise = createPitchModelSession("CREPE", modelUrl).catch(
      (error) => {
        if (crepeSessionPromises.get(modelUrl) === crepeSessionPromise) {
          crepeSessionPromises.delete(modelUrl);
        }
        throw error;
      },
    );
    crepeSessionPromises.set(modelUrl, crepeSessionPromise);
  }

  return crepeSessionPromise;
}
