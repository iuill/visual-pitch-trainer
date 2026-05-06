import {
  type AudioFileAnalysis,
  type AudioPitchPoint,
  refineAudioPitchPoints,
  summarizeVoiceRange,
} from "./audioFileAnalysis";
import { resampleAudioForPitchModel } from "./crepePitchDetection";
import { assertModelUrlAccessible } from "./modelAccess";
import { getRms, hzToMidi } from "./pitchMath";

type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");

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
const RMVPE_N_CLASSES = 360;
const RMVPE_CENTS_OFFSET = 1997.3794084376191;
const RMVPE_MEL_FMIN = 30;
const RMVPE_MEL_FMAX = 8000;
const DEFAULT_MIN_RMS = 0.004;
const DEFAULT_MIN_CONFIDENCE = 0.03;
const DEFAULT_MIN_FREQUENCY = 82;
const DEFAULT_MAX_FREQUENCY = 1047;
const WEIGHTED_ARGMAX_RADIUS = 4;
const ONNX_RUNTIME_WASM_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.asyncify.wasm";
const RMVPE_MODEL_URL =
  import.meta.env.VITE_RMVPE_MODEL_URL || "models/rmvpe.onnx";

let rmvpeSessionPromise: Promise<{
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
}> | null = null;

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
    disposeTensor(input);
    disposeTensors(Object.values(output));
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
  if (!window.isSecureContext) {
    return "RMVPE推定にはHTTPSまたはlocalhostの安全な接続が必要です。";
  }

  if (!getNavigatorGpu()) {
    return "このブラウザではWebGPUが使えないため、RMVPE推定はPC版Chrome/Edgeなどで試してください。";
  }

  return null;
}

export async function assertRmvpeModelAccessible(): Promise<void> {
  await assertModelUrlAccessible({
    label: "RMVPE",
    modelUrl: RMVPE_MODEL_URL,
    minBytes: 16 * 1024 * 1024,
    setupHint:
      "ローカル開発や Cloudflare Pages など GitHub Pages 以外の配信では、build 前に bun run download:pitch-models を実行して public/models/ にモデルを取得してください。",
  });
}

export async function assertRmvpePitchDetectionSupported(): Promise<void> {
  const supportMessage = getRmvpePitchDetectionSupportMessage();
  if (supportMessage) {
    throw new Error(supportMessage);
  }

  const adapter = await getNavigatorGpu()?.requestAdapter?.();
  if (!adapter) {
    throw new Error(
      "この環境ではWebGPUアダプタを取得できないため、RMVPE推定を使えません。",
    );
  }
}

export function decodeRmvpeFrame(
  activation: Float32Array,
  frameIndex: number,
): {
  frequency: number;
  confidence: number;
} {
  const offset = frameIndex * RMVPE_N_CLASSES;
  let maxIndex = 0;
  let confidence = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < RMVPE_N_CLASSES; index += 1) {
    const value = activation[offset + index] ?? 0;

    if (value > confidence) {
      confidence = value;
      maxIndex = index;
    }
  }

  const start = Math.max(0, maxIndex - WEIGHTED_ARGMAX_RADIUS);
  const end = Math.min(RMVPE_N_CLASSES - 1, maxIndex + WEIGHTED_ARGMAX_RADIUS);
  let weightedSum = 0;
  let weightTotal = 0;

  for (let index = start; index <= end; index += 1) {
    const value = Math.max(0, activation[offset + index] ?? 0);
    weightedSum += rmvpeBinToCents(index) * value;
    weightTotal += value;
  }

  const cents =
    weightTotal > 0 ? weightedSum / weightTotal : rmvpeBinToCents(maxIndex);

  return {
    frequency: 10 * 2 ** (cents / 1200),
    confidence: Math.max(0, confidence),
  };
}

export function createLogMelSpectrogram(
  audioData: Float32Array,
  onProgress?: (processedFrames: number, totalFrames: number) => void,
): Float32Array {
  const paddedAudio = reflectPad(audioData, RMVPE_WIN_LENGTH / 2);
  const totalFrames =
    paddedAudio.length < RMVPE_WIN_LENGTH
      ? 0
      : Math.floor((paddedAudio.length - RMVPE_WIN_LENGTH) / RMVPE_HOP_LENGTH) +
        1;
  const magnitudes = new Float32Array((RMVPE_WIN_LENGTH / 2 + 1) * totalFrames);
  const frame = new Float32Array(RMVPE_WIN_LENGTH);
  const real = new Float32Array(RMVPE_WIN_LENGTH);
  const imag = new Float32Array(RMVPE_WIN_LENGTH);
  const window = createHannWindow(RMVPE_WIN_LENGTH);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const offset = frameIndex * RMVPE_HOP_LENGTH;

    for (let index = 0; index < RMVPE_WIN_LENGTH; index += 1) {
      frame[index] = (paddedAudio[offset + index] ?? 0) * window[index];
    }

    real.set(frame);
    imag.fill(0);
    fft(real, imag);

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
  const paddedAudio = reflectPad(audioData, RMVPE_WIN_LENGTH / 2);
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

function createHannWindow(length: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length),
  );
}

function reflectPad(audioData: Float32Array, padSize: number): Float32Array {
  const output = new Float32Array(audioData.length + padSize * 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] =
      audioData[reflectIndex(index - padSize, audioData.length)] ?? 0;
  }

  return output;
}

function reflectIndex(index: number, length: number): number {
  if (length <= 1) {
    return 0;
  }

  let reflected = index;

  while (reflected < 0 || reflected >= length) {
    if (reflected < 0) {
      reflected = -reflected;
    }

    if (reflected >= length) {
      reflected = 2 * length - reflected - 2;
    }
  }

  return reflected;
}

function fft(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  let j = 0;

  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }

    j ^= bit;

    if (i < j) {
      const tempReal = real[i] ?? 0;
      const tempImag = imag[i] ?? 0;
      real[i] = real[j] ?? 0;
      imag[i] = imag[j] ?? 0;
      real[j] = tempReal;
      imag[j] = tempImag;
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImag = Math.sin(angle);

    for (let i = 0; i < n; i += length) {
      let wReal = 1;
      let wImag = 0;

      for (let k = 0; k < length / 2; k += 1) {
        const evenIndex = i + k;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] ?? 0;
        const oddImag = imag[oddIndex] ?? 0;
        const tReal = wReal * oddReal - wImag * oddImag;
        const tImag = wReal * oddImag + wImag * oddReal;
        const uReal = real[evenIndex] ?? 0;
        const uImag = imag[evenIndex] ?? 0;

        real[evenIndex] = uReal + tReal;
        imag[evenIndex] = uImag + tImag;
        real[oddIndex] = uReal - tReal;
        imag[oddIndex] = uImag - tImag;

        const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
        wImag = wReal * wLengthImag + wImag * wLengthReal;
        wReal = nextWReal;
      }
    }
  }
}

function rmvpeBinToCents(bin: number): number {
  return 20 * bin + RMVPE_CENTS_OFFSET;
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

async function getRmvpeSession(onCreate?: () => void): Promise<{
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
}> {
  if (!rmvpeSessionPromise) {
    onCreate?.();
    const sessionPromise = createRmvpeSession().catch((error) => {
      if (rmvpeSessionPromise === sessionPromise) {
        rmvpeSessionPromise = null;
      }
      throw error;
    });
    rmvpeSessionPromise = sessionPromise;
  }

  return rmvpeSessionPromise;
}

async function createRmvpeSession(): Promise<{
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
}> {
  const ort = await import("onnxruntime-web/webgpu");
  configureOnnxRuntime(ort);

  let session: Awaited<
    ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>
  >;
  try {
    session = await ort.InferenceSession.create(RMVPE_MODEL_URL, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    throw createOnnxModelLoadError("RMVPE", RMVPE_MODEL_URL, error);
  }

  return { ort, session };
}

function createOnnxModelLoadError(
  label: string,
  modelUrl: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "";
  if (
    !message.includes("protobuf parsing failed") &&
    !message.includes("Failed to load model")
  ) {
    return error;
  }

  return new Error(
    `${label}モデルを読み込めませんでした。${modelUrl} が有効な ONNX モデルとして配信されているか確認してください。ローカル開発や Cloudflare Pages など GitHub Pages 以外の配信では、build 前に bun run download:pitch-models を実行して public/models/ にモデルを取得してください。元のエラー: ${message}`,
  );
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

function disposeTensors(tensors: Array<{ dispose?: () => void } | undefined>) {
  for (const tensor of tensors) {
    tensor?.dispose?.();
  }
}
