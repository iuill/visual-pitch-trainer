import { createPeriodicHannWindow, fftInPlace, reflectPad } from "./audioDsp";
import {
  type AudioFileAnalysis,
  type AudioPitchPoint,
  refineAudioPitchPoints,
  summarizeVoiceRange,
} from "./audioFileAnalysis";
import { resampleAudioForPitchModel } from "./crepePitchDetection";
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

export type RmvpeAnalysisProgress = {
  phase:
    | "loading-runtime"
    | "loading-model"
    | "extracting-features"
    | "analyzing";
  processedFrames?: number;
  totalFrames?: number;
};

export type AnalyzeAudioDataWithRmvpeOptions = {
  sampleRate: number;
  minRms?: number;
  minConfidence?: number;
  minFrequency?: number;
  maxFrequency?: number;
  onProgress?: (progress: RmvpeAnalysisProgress) => void;
};

const RMVPE_SAMPLE_RATE = 16_000;
const RMVPE_WIN_LENGTH = 1024;
const RMVPE_HOP_LENGTH = 160;
const RMVPE_N_MELS = 128;
const RMVPE_MEL_FMIN = 30;
const RMVPE_MEL_FMAX = 8000;
const DEFAULT_MIN_RMS = 0.004;
const DEFAULT_MIN_CONFIDENCE = 0.03;
const DEFAULT_MIN_FREQUENCY = 82;
const DEFAULT_MAX_FREQUENCY = 1047;
const RMVPE_MODEL_URL =
  import.meta.env.VITE_RMVPE_MODEL_URL || "models/rmvpe.onnx";

let rmvpeSessionPromise: Promise<PitchModelSession> | null = null;

let rmvpeMelBasis: Float32Array | null = null;

export async function analyzeAudioDataWithRmvpe(
  audioData: Float32Array,
  options: AnalyzeAudioDataWithRmvpeOptions,
): Promise<AudioFileAnalysis> {
  await assertRmvpePitchDetectionSupported();

  const minRms = options.minRms ?? DEFAULT_MIN_RMS;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;
  const resampledAudio = await resampleAudioForPitchModel(
    audioData,
    options.sampleRate,
    RMVPE_SAMPLE_RATE,
  );
  const volumes = resolveFrameVolumes(resampledAudio);

  options.onProgress?.({ phase: "extracting-features" });
  const mel = createLogMelSpectrogram(
    resampledAudio,
    (processedFrames, totalFrames) => {
      options.onProgress?.({
        phase: "extracting-features",
        processedFrames,
        totalFrames,
      });
    },
  );
  const nFrames = mel.length / RMVPE_N_MELS;
  const paddedFrameCount = Math.ceil(Math.max(1, nFrames) / 32) * 32;
  const paddedMel = new Float32Array(RMVPE_N_MELS * paddedFrameCount);

  for (let frame = 0; frame < nFrames; frame += 1) {
    for (let melIndex = 0; melIndex < RMVPE_N_MELS; melIndex += 1) {
      paddedMel[melIndex * paddedFrameCount + frame] =
        mel[melIndex * nFrames + frame] ?? 0;
    }
  }

  options.onProgress?.({ phase: "loading-runtime" });
  const { ort, session } = await getRmvpeSession(() => {
    options.onProgress?.({ phase: "loading-model" });
  });

  options.onProgress?.({
    phase: "analyzing",
    processedFrames: 0,
    totalFrames: nFrames,
  });

  const input = new ort.Tensor("float32", paddedMel, [
    1,
    RMVPE_N_MELS,
    paddedFrameCount,
  ]);
  const points: AudioPitchPoint[] = [];
  let output: Record<string, { data: unknown; dispose?: () => void }> = {};

  try {
    output = await session.run({ input });
    const activationTensor = output.output;

    const activation = activationTensor?.data as Float32Array | undefined;

    if (!activation || activation.length === 0) {
      throw new Error("RMVPEモデルからピッチ候補を取得できませんでした。");
    }

    for (let frame = 0; frame < nFrames; frame += 1) {
      const prediction = decodeRmvpeFrame(activation, frame);
      const timeMs = ((frame * RMVPE_HOP_LENGTH) / RMVPE_SAMPLE_RATE) * 1000;
      const volume = volumes[frame] ?? 0;
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
    processedFrames: nFrames,
    totalFrames: nFrames,
  });

  const refinedPoints = refineAudioPitchPoints(points);

  return {
    points: refinedPoints,
    summary: summarizeVoiceRange(
      refinedPoints,
      audioData.length / options.sampleRate,
      RMVPE_HOP_LENGTH / RMVPE_SAMPLE_RATE,
    ),
  };
}

export function getRmvpePitchDetectionSupportMessage(): string | null {
  return getWebGpuSupportMessage("RMVPE推定");
}
export async function assertRmvpeModelAccessible(): Promise<void> {
  await assertModelUrlAccessible({
    label: "RMVPE",
    modelUrl: RMVPE_MODEL_URL,
    minBytes: 16 * 1024 * 1024,
    setupHint: PITCH_MODEL_SETUP_HINT,
  });
}

export function assertRmvpePitchDetectionSupported(): Promise<void> {
  return assertWebGpuSupported("RMVPE推定");
}
export function decodeRmvpeFrame(activation: Float32Array, frameIndex: number) {
  return decodePitchModelFrame(activation, frameIndex, "cents");
}

export function createLogMelSpectrogram(
  audioData: Float32Array,
  onProgress?: (processedFrames: number, totalFrames: number) => void,
): Float32Array {
  const paddedAudio = reflectPad(
    audioData,
    RMVPE_WIN_LENGTH / 2,
    "repeat-reflection",
  );
  const totalFrames =
    paddedAudio.length < RMVPE_WIN_LENGTH
      ? 0
      : Math.floor((paddedAudio.length - RMVPE_WIN_LENGTH) / RMVPE_HOP_LENGTH) +
        1;
  const magnitudes = new Float32Array((RMVPE_WIN_LENGTH / 2 + 1) * totalFrames);
  const frame = new Float32Array(RMVPE_WIN_LENGTH);
  const real = new Float32Array(RMVPE_WIN_LENGTH);
  const imag = new Float32Array(RMVPE_WIN_LENGTH);
  const window = createPeriodicHannWindow(RMVPE_WIN_LENGTH);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const offset = frameIndex * RMVPE_HOP_LENGTH;

    for (let index = 0; index < RMVPE_WIN_LENGTH; index += 1) {
      frame[index] = (paddedAudio[offset + index] ?? 0) * window[index];
    }

    real.set(frame);
    imag.fill(0);
    fftInPlace(real, imag);

    for (let bin = 0; bin <= RMVPE_WIN_LENGTH / 2; bin += 1) {
      magnitudes[bin * totalFrames + frameIndex] = Math.hypot(
        real[bin] ?? 0,
        imag[bin] ?? 0,
      );
    }

    if (frameIndex % 256 === 0) {
      onProgress?.(frameIndex, totalFrames);
    }
  }

  const melBasis = getMelBasis();
  const mel = new Float32Array(RMVPE_N_MELS * totalFrames);

  for (let melIndex = 0; melIndex < RMVPE_N_MELS; melIndex += 1) {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      let sum = 0;

      for (let bin = 0; bin <= RMVPE_WIN_LENGTH / 2; bin += 1) {
        sum +=
          (melBasis[melIndex * (RMVPE_WIN_LENGTH / 2 + 1) + bin] ?? 0) *
          (magnitudes[bin * totalFrames + frameIndex] ?? 0);
      }

      mel[melIndex * totalFrames + frameIndex] = Math.log(Math.max(sum, 1e-5));
    }
  }

  onProgress?.(totalFrames, totalFrames);
  return mel;
}

function resolveFrameVolumes(audioData: Float32Array): Float32Array {
  const paddedAudio = reflectPad(
    audioData,
    RMVPE_WIN_LENGTH / 2,
    "repeat-reflection",
  );
  const totalFrames =
    paddedAudio.length < RMVPE_WIN_LENGTH
      ? 0
      : Math.floor((paddedAudio.length - RMVPE_WIN_LENGTH) / RMVPE_HOP_LENGTH) +
        1;
  const volumes = new Float32Array(totalFrames);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const offset = frameIndex * RMVPE_HOP_LENGTH;
    volumes[frameIndex] = getRms(
      paddedAudio.subarray(offset, offset + RMVPE_WIN_LENGTH),
    );
  }

  return volumes;
}

function getMelBasis(): Float32Array {
  if (!rmvpeMelBasis) {
    rmvpeMelBasis = createMelBasis();
  }

  return rmvpeMelBasis;
}

function createMelBasis(): Float32Array {
  const fftBinCount = RMVPE_WIN_LENGTH / 2 + 1;
  const basis = new Float32Array(RMVPE_N_MELS * fftBinCount);
  const melMin = hzToMel(RMVPE_MEL_FMIN);
  const melMax = hzToMel(RMVPE_MEL_FMAX);
  const melPoints = Array.from({ length: RMVPE_N_MELS + 2 }, (_, index) =>
    melToHz(melMin + ((melMax - melMin) * index) / (RMVPE_N_MELS + 1)),
  );

  for (let melIndex = 0; melIndex < RMVPE_N_MELS; melIndex += 1) {
    const lower = melPoints[melIndex] ?? 0;
    const center = melPoints[melIndex + 1] ?? lower;
    const upper = melPoints[melIndex + 2] ?? center;
    const enorm = 2 / Math.max(1e-12, upper - lower);

    for (let bin = 0; bin < fftBinCount; bin += 1) {
      const frequency = (bin * RMVPE_SAMPLE_RATE) / RMVPE_WIN_LENGTH;
      const lowerSlope = (frequency - lower) / Math.max(1e-12, center - lower);
      const upperSlope = (upper - frequency) / Math.max(1e-12, upper - center);
      basis[melIndex * fftBinCount + bin] =
        Math.max(0, Math.min(lowerSlope, upperSlope)) * enorm;
    }
  }

  return basis;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

export async function releaseRmvpeSession() {
  const sessionPromise = rmvpeSessionPromise;
  rmvpeSessionPromise = null;

  if (!sessionPromise) {
    return;
  }

  try {
    const { session } = await sessionPromise;
    await session.release();
  } catch (error) {
    console.warn("Failed to release RMVPE ONNX session.", error);
  }
}

async function getRmvpeSession(
  onCreate?: () => void,
): Promise<PitchModelSession> {
  if (!rmvpeSessionPromise) {
    onCreate?.();
    const sessionPromise = createPitchModelSession(
      "RMVPE",
      RMVPE_MODEL_URL,
    ).catch((error) => {
      if (rmvpeSessionPromise === sessionPromise) {
        rmvpeSessionPromise = null;
      }
      throw error;
    });
    rmvpeSessionPromise = sessionPromise;
  }

  return rmvpeSessionPromise;
}
