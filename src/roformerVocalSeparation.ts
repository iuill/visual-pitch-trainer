import type * as ort from "onnxruntime-web/webgpu";
import type { DecodedMediaAudio } from "./mediaAudioExtraction";
import { assertModelUrlAccessible } from "./modelAccess";

export type RoformerVocalModelId = "bs-roformer-fp16";

export type RoformerVocalProgress = {
  phase: "loading-model" | "separating";
  loadedBytes?: number;
  totalBytes?: number;
  progress?: number;
  currentSegment?: number;
  totalSegments?: number;
};

type RoformerVocalModelConfig = {
  label: string;
  modelUrl: string;
  executionProviders: ort.InferenceSession.ExecutionProviderConfig[];
  graphOptimizationLevel: ort.InferenceSession.SessionOptions["graphOptimizationLevel"];
  isAvailableInBuild: boolean;
  sampleRate: number;
  nFft: number;
  hopSize: number;
  winLength: number;
  chunkSize: number;
  overlap: number;
  centeredStft: boolean;
  minModelBytes: number;
};

type SignalStats = {
  length: number;
  finiteCount: number;
  nonFiniteCount: number;
  firstNonFiniteIndex: number | null;
  min: number;
  max: number;
  meanAbs: number;
};

const AUDIO_CHANNELS = 2;
const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_N_FFT = 2048;
const DEFAULT_WIN_LENGTH = 2048;
const N_FREQ = DEFAULT_N_FFT / 2 + 1;

export const ROFORMER_VOCAL_MODELS: Record<
  RoformerVocalModelId,
  RoformerVocalModelConfig
> = {
  "bs-roformer-fp16": {
    label: "BS-RoFormer fp16 2-stem",
    modelUrl:
      import.meta.env.VITE_BS_ROFORMER_FP16_MODEL_URL ||
      "models/bs-roformer-fp16-webgpu.onnx",
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "disabled",
    isAvailableInBuild:
      import.meta.env.DEV ||
      Boolean(import.meta.env.VITE_BS_ROFORMER_FP16_MODEL_URL),
    sampleRate: DEFAULT_SAMPLE_RATE,
    nFft: DEFAULT_N_FFT,
    hopSize: 441,
    winLength: DEFAULT_WIN_LENGTH,
    chunkSize: 352_800,
    overlap: 2,
    centeredStft: true,
    minModelBytes: 16 * 1024 * 1024,
  },
};

export async function extractVocalsWithRoformer(
  decodedAudio: DecodedMediaAudio,
  modelId: RoformerVocalModelId,
  ortRuntime: typeof ort,
  options: {
    onProgress?: (progress: RoformerVocalProgress) => void;
  } = {},
): Promise<DecodedMediaAudio> {
  const config = ROFORMER_VOCAL_MODELS[modelId];
  if (!config.isAvailableInBuild) {
    throw new Error(
      `${config.label} はこのビルドでは利用できません。VITE_BS_ROFORMER_FP16_MODEL_URL を指定してビルドするか、開発環境でローカルモデルを生成してください。`,
    );
  }

  const stereoAudio = await resampleToStereo(decodedAudio, config.sampleRate);
  options.onProgress?.({ phase: "loading-model" });
  const session = await createRoformerSession(ortRuntime, config, options);

  try {
    await validateRoformerWarmup(session, ortRuntime, config);

    const separated = await separateWithRoformerSession(
      stereoAudio,
      session,
      ortRuntime,
      config,
      options,
    );

    assertAudibleSeparation(separated, config);

    return {
      sampleRate: config.sampleRate,
      channels: [separated.left, separated.right],
      durationSec: separated.left.length / config.sampleRate,
      source: decodedAudio.source,
    };
  } finally {
    await session.release();
  }
}

export async function assertRoformerModelAccessible(
  modelId: RoformerVocalModelId,
): Promise<void> {
  const config = ROFORMER_VOCAL_MODELS[modelId];
  if (!config.isAvailableInBuild) {
    throw new Error(
      `${config.label} はこのビルドでは利用できません。VITE_BS_ROFORMER_FP16_MODEL_URL を指定してビルドするか、開発環境でローカルモデルを生成してください。`,
    );
  }

  await assertModelUrlAccessible({
    label: config.label,
    modelUrl: config.modelUrl,
    minBytes: config.minModelBytes,
    setupHint:
      "開発環境では bun run prepare:bs-roformer-webgpu を実行して public/models/bs-roformer-fp16-webgpu.onnx を生成してください。公開ビルドでは VITE_BS_ROFORMER_FP16_MODEL_URL に配信用モデルURLを指定してください。",
  });
}

async function createRoformerSession(
  ortRuntime: typeof ort,
  config: RoformerVocalModelConfig,
  options: {
    onProgress?: (progress: RoformerVocalProgress) => void;
  },
) {
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: config.executionProviders,
    graphOptimizationLevel: config.graphOptimizationLevel,
    freeDimensionOverrides: {
      batch: 1,
      time_frames: getFrameCount(config),
    },
  };

  const modelBuffer = await fetchModelArrayBuffer(config.modelUrl, options);
  try {
    return await ortRuntime.InferenceSession.create(
      modelBuffer,
      sessionOptions,
    );
  } catch (error) {
    throw createRoformerModelLoadError(config, error);
  }
}

function assertAudibleSeparation(
  separated: {
    left: Float32Array;
    right: Float32Array;
  },
  config: RoformerVocalModelConfig,
) {
  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;

  for (const channel of [separated.left, separated.right]) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) {
        throw new Error(`${config.label} の抽出結果に不正な値が含まれました。`);
      }

      const absSample = Math.abs(sample);
      peak = Math.max(peak, absSample);
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));

  if (peak < 1e-5 || rms < 1e-7) {
    throw new Error(`${config.label} の抽出結果がほぼ無音でした。`);
  }
}

async function fetchModelArrayBuffer(
  modelUrl: string,
  options: {
    onProgress?: (progress: RoformerVocalProgress) => void;
  },
): Promise<ArrayBuffer> {
  const response = await fetch(modelUrl);

  if (!response.ok) {
    throw new Error(
      `ボーカル抽出モデルを取得できませんでした: ${response.status}`,
    );
  }

  const totalBytes =
    Number(response.headers.get("content-length")) || undefined;

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    assertModelBufferLooksUsable(
      buffer,
      modelUrl,
      configFromModelUrl(modelUrl),
    );
    options.onProgress?.({
      phase: "loading-model",
      loadedBytes: buffer.byteLength,
      totalBytes,
    });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      options.onProgress?.({
        phase: "loading-model",
        loadedBytes,
        totalBytes,
      });
    }
  }

  const modelBytes = new Uint8Array(loadedBytes);
  let offset = 0;

  for (const chunk of chunks) {
    modelBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const buffer = modelBytes.buffer;
  assertModelBufferLooksUsable(buffer, modelUrl, configFromModelUrl(modelUrl));
  return buffer;
}

function configFromModelUrl(modelUrl: string): RoformerVocalModelConfig {
  const matchedConfig = Object.values(ROFORMER_VOCAL_MODELS).find(
    (config) => config.modelUrl === modelUrl,
  );

  return matchedConfig ?? ROFORMER_VOCAL_MODELS["bs-roformer-fp16"];
}

function assertModelBufferLooksUsable(
  buffer: ArrayBuffer,
  modelUrl: string,
  config: RoformerVocalModelConfig,
) {
  if (buffer.byteLength < config.minModelBytes || startsWithHtml(buffer)) {
    throw new Error(
      `${config.label} モデルを読み込めませんでした。${modelUrl} が有効な ONNX モデルとして配信されていない可能性があります。開発環境では bun run prepare:bs-roformer-webgpu を実行して public/models/bs-roformer-fp16-webgpu.onnx を生成してください。公開ビルドでは VITE_BS_ROFORMER_FP16_MODEL_URL に配信用モデルURLを指定してください。`,
    );
  }
}

function startsWithHtml(buffer: ArrayBuffer): boolean {
  const head = new TextDecoder()
    .decode(buffer.slice(0, Math.min(buffer.byteLength, 256)))
    .trimStart()
    .toLowerCase();

  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function createRoformerModelLoadError(
  config: RoformerVocalModelConfig,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "";
  if (!message.includes("protobuf parsing failed")) {
    return error;
  }

  return new Error(
    `${config.label} モデルをONNXとして読み込めませんでした。モデルファイルが未生成、途中までしか取得できていない、またはHTML/エラーページを返している可能性があります。開発環境では bun run prepare:bs-roformer-webgpu を実行して public/models/bs-roformer-fp16-webgpu.onnx を生成してください。元のエラー: ${message}`,
  );
}

async function separateWithRoformerSession(
  stereoAudio: {
    left: Float32Array;
    right: Float32Array;
  },
  session: ort.InferenceSession,
  ortRuntime: typeof ort,
  config: RoformerVocalModelConfig,
  options: {
    onProgress?: (progress: RoformerVocalProgress) => void;
  },
): Promise<{
  left: Float32Array;
  right: Float32Array;
}> {
  const totalSamples = stereoAudio.left.length;
  const stepSize = Math.floor(config.chunkSize / config.overlap);
  const chunkStarts: number[] = [];

  for (let start = 0; start < totalSamples; start += stepSize) {
    chunkStarts.push(start);
  }

  const vocalsLeft = new Float32Array(totalSamples);
  const vocalsRight = new Float32Array(totalSamples);
  const overlapWeights = new Float32Array(totalSamples);
  const window = hannWindow(config.winLength);
  const inputName = session.inputNames[0] ?? "stft_features";
  const outputName = session.outputNames[0] ?? "mask";

  for (let chunkIndex = 0; chunkIndex < chunkStarts.length; chunkIndex += 1) {
    const start = chunkStarts[chunkIndex] ?? 0;
    const end = Math.min(start + config.chunkSize, totalSamples);
    const chunkLength = end - start;
    const chunkLeft = new Float32Array(config.chunkSize);
    const chunkRight = new Float32Array(config.chunkSize);

    chunkLeft.set(stereoAudio.left.subarray(start, end));
    chunkRight.set(stereoAudio.right.subarray(start, end));

    const prepared = prepareChunkInput(chunkLeft, chunkRight, window, config);
    const inputStats = getSignalStats(prepared.input);
    assertFiniteSignalStats(inputStats, {
      config,
      stage: "STFT入力",
      chunkIndex,
      totalChunks: chunkStarts.length,
    });

    const tensor = new ortRuntime.Tensor("float32", prepared.input, [
      1,
      prepared.nFrames,
      N_FREQ * AUDIO_CHANNELS * 2,
    ]);
    let results: Record<string, { data: unknown; dispose?: () => void }> = {};

    try {
      results = await session.run({ [inputName]: tensor });
      const mask = results[outputName]?.data ?? Object.values(results)[0]?.data;

      if (!(mask instanceof Float32Array)) {
        throw new Error(`${config.label} の推論結果を読み取れませんでした。`);
      }

      const maskStats = getSignalStats(mask);
      assertFiniteSignalStats(maskStats, {
        config,
        stage: "推論出力mask",
        chunkIndex,
        totalChunks: chunkStarts.length,
        inputStats,
        extra: `input=${inputName}, output=${outputName}, frames=${prepared.nFrames}`,
      });

      const reconstructed = applyMaskAndReconstruct(
        mask,
        prepared.stftLeft,
        prepared.stftRight,
        prepared.nFrames,
        window,
        config,
      );
      const reconstructedStats = combineSignalStats([
        getSignalStats(reconstructed.left),
        getSignalStats(reconstructed.right),
      ]);
      assertFiniteSignalStats(reconstructedStats, {
        config,
        stage: "iSTFT再構成",
        chunkIndex,
        totalChunks: chunkStarts.length,
        inputStats,
        maskStats,
      });

      const overlapWindow = createChunkOverlapWindow({
        chunkLength,
        fadeSize: Math.max(1, Math.floor(config.chunkSize / 10)),
        isFirstChunk: chunkIndex === 0,
        isLastChunk: chunkIndex === chunkStarts.length - 1,
      });

      for (let sampleIndex = 0; sampleIndex < chunkLength; sampleIndex += 1) {
        const outputIndex = start + sampleIndex;
        const weight = overlapWindow[sampleIndex] ?? 0;
        vocalsLeft[outputIndex] +=
          (reconstructed.left[sampleIndex] ?? 0) * weight;
        vocalsRight[outputIndex] +=
          (reconstructed.right[sampleIndex] ?? 0) * weight;
        overlapWeights[outputIndex] += weight;
      }
    } finally {
      disposeTensor(tensor);
      disposeTensors(Object.values(results));
    }

    options.onProgress?.({
      phase: "separating",
      progress: (chunkIndex + 1) / chunkStarts.length,
      currentSegment: chunkIndex + 1,
      totalSegments: chunkStarts.length,
    });

    await yieldToBrowser();
  }

  for (let index = 0; index < totalSamples; index += 1) {
    if (overlapWeights[index] > 0) {
      vocalsLeft[index] /= overlapWeights[index];
      vocalsRight[index] /= overlapWeights[index];
    }
  }

  return {
    left: vocalsLeft,
    right: vocalsRight,
  };
}

async function validateRoformerWarmup(
  session: ort.InferenceSession,
  ortRuntime: typeof ort,
  config: RoformerVocalModelConfig,
) {
  const inputName = session.inputNames[0] ?? "stft_features";
  const outputName = session.outputNames[0] ?? "mask";
  const nFrames = getFrameCount(config);
  const featureDim = N_FREQ * AUDIO_CHANNELS * 2;
  const tensor = new ortRuntime.Tensor(
    "float32",
    new Float32Array(nFrames * featureDim),
    [1, nFrames, featureDim],
  );
  let results: Record<string, { data: unknown; dispose?: () => void }> = {};

  try {
    results = await session.run({ [inputName]: tensor });
    const mask = results[outputName]?.data ?? Object.values(results)[0]?.data;

    if (!(mask instanceof Float32Array)) {
      throw new Error(
        `${config.label} のウォームアップ推論結果を読み取れませんでした。`,
      );
    }

    const maskStats = getSignalStats(mask);
    if (maskStats.nonFiniteCount === 0) {
      return;
    }

    const diagnostics = await getWebGpuAdapterDiagnostics();
    assertFiniteSignalStats(maskStats, {
      config,
      stage: "ウォームアップ推論出力mask",
      chunkIndex: 0,
      totalChunks: 1,
      extra: [
        `input=${inputName}`,
        `output=${outputName}`,
        `frames=${nFrames}`,
        diagnostics,
      ]
        .filter(Boolean)
        .join(" "),
    });
  } finally {
    disposeTensor(tensor);
    disposeTensors(Object.values(results));
  }
}

async function getWebGpuAdapterDiagnostics(): Promise<string> {
  const adapter = await getNavigatorGpu()?.requestAdapter?.();

  if (!adapter) {
    return "webgpuAdapter=unavailable";
  }

  const features =
    Array.from(adapter.features ?? [])
      .sort()
      .join("|") || "-";
  const limits = adapter.limits;
  const maxStorageBufferBindingSize = limits?.maxStorageBufferBindingSize;
  const maxStorageBuffersPerShaderStage =
    limits?.maxStorageBuffersPerShaderStage;

  return [
    `webgpuFeatures=${features}`,
    maxStorageBufferBindingSize !== undefined
      ? `maxStorageBufferBindingSize=${maxStorageBufferBindingSize}`
      : null,
    maxStorageBuffersPerShaderStage !== undefined
      ? `maxStorageBuffersPerShaderStage=${maxStorageBuffersPerShaderStage}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function prepareChunkInput(
  left: Float32Array,
  right: Float32Array,
  window: Float32Array,
  config: RoformerVocalModelConfig,
) {
  const stftLeft = stft(left, window, config);
  const stftRight = stft(right, window, config);
  const nFrames = stftLeft.nFrames;
  const featureDim = N_FREQ * AUDIO_CHANNELS * 2;
  const input = new Float32Array(nFrames * featureDim);

  for (let timeIndex = 0; timeIndex < nFrames; timeIndex += 1) {
    const timeOffset = timeIndex * featureDim;

    for (let freqIndex = 0; freqIndex < N_FREQ; freqIndex += 1) {
      const sourceOffset = (freqIndex * nFrames + timeIndex) * 2;
      const leftFeatureOffset = timeOffset + freqIndex * 4;
      const rightFeatureOffset = leftFeatureOffset + 2;

      input[leftFeatureOffset] = stftLeft.data[sourceOffset] ?? 0;
      input[leftFeatureOffset + 1] = stftLeft.data[sourceOffset + 1] ?? 0;
      input[rightFeatureOffset] = stftRight.data[sourceOffset] ?? 0;
      input[rightFeatureOffset + 1] = stftRight.data[sourceOffset + 1] ?? 0;
    }
  }

  return {
    input,
    nFrames,
    stftLeft,
    stftRight,
  };
}

function applyMaskAndReconstruct(
  mask: Float32Array,
  stftLeft: StftResult,
  stftRight: StftResult,
  nFrames: number,
  window: Float32Array,
  config: RoformerVocalModelConfig,
) {
  const maskedLeft = new Float32Array(N_FREQ * nFrames * 2);
  const maskedRight = new Float32Array(N_FREQ * nFrames * 2);

  for (let freqIndex = 0; freqIndex < N_FREQ; freqIndex += 1) {
    for (let timeIndex = 0; timeIndex < nFrames; timeIndex += 1) {
      const sourceOffset = (freqIndex * nFrames + timeIndex) * 2;
      const maskLeftOffset = (freqIndex * 2 * nFrames + timeIndex) * 2;
      const maskRightOffset = ((freqIndex * 2 + 1) * nFrames + timeIndex) * 2;
      const sourceLeftReal = stftLeft.data[sourceOffset] ?? 0;
      const sourceLeftImag = stftLeft.data[sourceOffset + 1] ?? 0;
      const sourceRightReal = stftRight.data[sourceOffset] ?? 0;
      const sourceRightImag = stftRight.data[sourceOffset + 1] ?? 0;
      const maskLeftReal = mask[maskLeftOffset] ?? 0;
      const maskLeftImag = mask[maskLeftOffset + 1] ?? 0;
      const maskRightReal = mask[maskRightOffset] ?? 0;
      const maskRightImag = mask[maskRightOffset + 1] ?? 0;

      maskedLeft[sourceOffset] =
        sourceLeftReal * maskLeftReal - sourceLeftImag * maskLeftImag;
      maskedLeft[sourceOffset + 1] =
        sourceLeftReal * maskLeftImag + sourceLeftImag * maskLeftReal;
      maskedRight[sourceOffset] =
        sourceRightReal * maskRightReal - sourceRightImag * maskRightImag;
      maskedRight[sourceOffset + 1] =
        sourceRightReal * maskRightImag + sourceRightImag * maskRightReal;
    }
  }

  for (let timeIndex = 0; timeIndex < nFrames; timeIndex += 1) {
    maskedLeft[timeIndex * 2] = 0;
    maskedLeft[timeIndex * 2 + 1] = 0;
    maskedRight[timeIndex * 2] = 0;
    maskedRight[timeIndex * 2 + 1] = 0;
  }

  return {
    left: istft(maskedLeft, nFrames, window, config),
    right: istft(maskedRight, nFrames, window, config),
  };
}

type StftResult = {
  data: Float32Array;
  nFrames: number;
};

function stft(
  signal: Float32Array,
  window: Float32Array,
  config: RoformerVocalModelConfig,
): StftResult {
  const paddedSignal = config.centeredStft
    ? reflectPad(signal, config.nFft / 2)
    : signal;
  const nFrames = getFrameCount(config);
  const data = new Float32Array(N_FREQ * nFrames * 2);
  const windowed = new Float32Array(config.nFft);

  for (let frameIndex = 0; frameIndex < nFrames; frameIndex += 1) {
    const frameOffset = frameIndex * config.hopSize;

    for (let index = 0; index < config.nFft; index += 1) {
      windowed[index] =
        (paddedSignal[frameOffset + index] ?? 0) * window[index];
    }

    const spectrum = rfft(windowed, config.nFft);

    for (let freqIndex = 0; freqIndex < N_FREQ; freqIndex += 1) {
      const outputOffset = (freqIndex * nFrames + frameIndex) * 2;
      data[outputOffset] = spectrum[freqIndex * 2] ?? 0;
      data[outputOffset + 1] = spectrum[freqIndex * 2 + 1] ?? 0;
    }
  }

  return { data, nFrames };
}

function istft(
  stftData: Float32Array,
  nFrames: number,
  window: Float32Array,
  config: RoformerVocalModelConfig,
): Float32Array {
  const paddedLength = config.centeredStft
    ? config.chunkSize + config.nFft
    : config.chunkSize;
  const out = new Float32Array(paddedLength);
  const windowSum = new Float32Array(paddedLength);
  const spectrum = new Float32Array(N_FREQ * 2);

  for (let frameIndex = 0; frameIndex < nFrames; frameIndex += 1) {
    for (let freqIndex = 0; freqIndex < N_FREQ; freqIndex += 1) {
      const sourceOffset = (freqIndex * nFrames + frameIndex) * 2;
      spectrum[freqIndex * 2] = stftData[sourceOffset] ?? 0;
      spectrum[freqIndex * 2 + 1] = stftData[sourceOffset + 1] ?? 0;
    }

    const frame = irfft(spectrum, config.nFft);
    const frameOffset = frameIndex * config.hopSize;

    for (let index = 0; index < config.nFft; index += 1) {
      const outputIndex = frameOffset + index;

      if (outputIndex >= paddedLength) {
        continue;
      }

      const windowValue = window[index] ?? 0;
      out[outputIndex] += (frame[index] ?? 0) * windowValue;
      windowSum[outputIndex] += windowValue * windowValue;
    }
  }

  for (let index = 0; index < paddedLength; index += 1) {
    if (windowSum[index] > 1e-8) {
      out[index] /= windowSum[index];
    }
  }

  return config.centeredStft
    ? out.slice(config.nFft / 2, config.nFft / 2 + config.chunkSize)
    : out;
}

function rfft(input: Float32Array, length: number): Float32Array {
  const real = new Float32Array(length);
  const imag = new Float32Array(length);
  real.set(input);
  fftInPlace(real, imag, length);

  const output = new Float32Array((length / 2 + 1) * 2);

  for (let freqIndex = 0; freqIndex <= length / 2; freqIndex += 1) {
    output[freqIndex * 2] = real[freqIndex] ?? 0;
    output[freqIndex * 2 + 1] = imag[freqIndex] ?? 0;
  }

  return output;
}

function irfft(spectrum: Float32Array, length: number): Float32Array {
  const real = new Float32Array(length);
  const imag = new Float32Array(length);
  const halfLength = length / 2;

  for (let freqIndex = 0; freqIndex <= halfLength; freqIndex += 1) {
    real[freqIndex] = spectrum[freqIndex * 2] ?? 0;
    imag[freqIndex] = -(spectrum[freqIndex * 2 + 1] ?? 0);
  }

  for (let freqIndex = 1; freqIndex < halfLength; freqIndex += 1) {
    real[length - freqIndex] = spectrum[freqIndex * 2] ?? 0;
    imag[length - freqIndex] = spectrum[freqIndex * 2 + 1] ?? 0;
  }

  fftInPlace(real, imag, length);

  const output = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    output[index] = (real[index] ?? 0) / length;
  }

  return output;
}

function fftInPlace(real: Float32Array, imag: Float32Array, length: number) {
  for (let index = 1, reverseIndex = 0; index < length; index += 1) {
    let bit = length >> 1;

    for (; reverseIndex & bit; bit >>= 1) {
      reverseIndex ^= bit;
    }

    reverseIndex ^= bit;

    if (index < reverseIndex) {
      const realValue = real[index] ?? 0;
      real[index] = real[reverseIndex] ?? 0;
      real[reverseIndex] = realValue;

      const imagValue = imag[index] ?? 0;
      imag[index] = imag[reverseIndex] ?? 0;
      imag[reverseIndex] = imagValue;
    }
  }

  for (let fftLength = 2; fftLength <= length; fftLength <<= 1) {
    const halfLength = fftLength >> 1;
    const angle = (-2 * Math.PI) / fftLength;
    const twiddleReal = Math.cos(angle);
    const twiddleImag = Math.sin(angle);

    for (let offset = 0; offset < length; offset += fftLength) {
      let currentReal = 1;
      let currentImag = 0;

      for (let index = 0; index < halfLength; index += 1) {
        const leftIndex = offset + index;
        const rightIndex = leftIndex + halfLength;
        const tempReal =
          currentReal * (real[rightIndex] ?? 0) -
          currentImag * (imag[rightIndex] ?? 0);
        const tempImag =
          currentReal * (imag[rightIndex] ?? 0) +
          currentImag * (real[rightIndex] ?? 0);

        real[rightIndex] = (real[leftIndex] ?? 0) - tempReal;
        imag[rightIndex] = (imag[leftIndex] ?? 0) - tempImag;
        real[leftIndex] = (real[leftIndex] ?? 0) + tempReal;
        imag[leftIndex] = (imag[leftIndex] ?? 0) + tempImag;

        const nextCurrentReal =
          currentReal * twiddleReal - currentImag * twiddleImag;
        currentImag = currentReal * twiddleImag + currentImag * twiddleReal;
        currentReal = nextCurrentReal;
      }
    }
  }
}

function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / length));
  }

  return window;
}

function createChunkOverlapWindow({
  chunkLength,
  fadeSize,
  isFirstChunk,
  isLastChunk,
}: {
  chunkLength: number;
  fadeSize: number;
  isFirstChunk: boolean;
  isLastChunk: boolean;
}): Float32Array {
  const window = new Float32Array(chunkLength);
  const effectiveFadeSize = Math.max(1, Math.min(fadeSize, chunkLength));

  for (let index = 0; index < chunkLength; index += 1) {
    const fadeIn = isFirstChunk ? 1 : Math.min(1, index / effectiveFadeSize);
    const fadeOut = isLastChunk
      ? 1
      : Math.min(1, (chunkLength - index) / effectiveFadeSize);
    window[index] = Math.min(fadeIn, fadeOut);
  }

  return window;
}

function reflectPad(signal: Float32Array, padSize: number): Float32Array {
  const padded = new Float32Array(signal.length + padSize * 2);

  for (let index = 0; index < padSize; index += 1) {
    padded[index] = signal[Math.max(0, padSize - index)] ?? 0;
  }

  padded.set(signal, padSize);

  for (let index = 0; index < padSize; index += 1) {
    padded[padSize + signal.length + index] =
      signal[Math.max(0, signal.length - 2 - index)] ?? 0;
  }

  return padded;
}

async function resampleToStereo(
  decodedAudio: DecodedMediaAudio,
  sampleRate: number,
): Promise<{
  left: Float32Array;
  right: Float32Array;
}> {
  const left = decodedAudio.channels[0] ?? new Float32Array(0);
  const right = decodedAudio.channels[1] ?? left;

  if (decodedAudio.sampleRate === sampleRate) {
    return {
      left: new Float32Array(left),
      right: new Float32Array(right),
    };
  }

  const frameCount = Math.max(
    1,
    Math.ceil((left.length / decodedAudio.sampleRate) * sampleRate),
  );
  const offlineContext = new OfflineAudioContext(2, frameCount, sampleRate);
  const buffer = offlineContext.createBuffer(
    2,
    Math.max(left.length, right.length, 1),
    decodedAudio.sampleRate,
  );

  buffer.copyToChannel(new Float32Array(left), 0);
  buffer.copyToChannel(new Float32Array(right), 1);

  const source = offlineContext.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineContext.destination);
  source.start();

  const rendered = await offlineContext.startRendering();

  return {
    left: new Float32Array(rendered.getChannelData(0)),
    right: new Float32Array(rendered.getChannelData(1)),
  };
}

function getFrameCount(config: RoformerVocalModelConfig): number {
  const inputLength = config.centeredStft
    ? config.chunkSize + config.nFft
    : config.chunkSize;

  return Math.floor((inputLength - config.nFft) / config.hopSize) + 1;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function disposeTensors(tensors: Array<{ dispose?: () => void } | undefined>) {
  for (const tensor of tensors) {
    disposeTensor(tensor);
  }
}

function disposeTensor(tensor: { dispose?: () => void } | undefined) {
  tensor?.dispose?.();
}

function getSignalStats(signal: Float32Array): SignalStats {
  let finiteCount = 0;
  let nonFiniteCount = 0;
  let firstNonFiniteIndex: number | null = null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sumAbs = 0;

  for (let index = 0; index < signal.length; index += 1) {
    const value = signal[index] ?? 0;

    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      firstNonFiniteIndex ??= index;
      continue;
    }

    finiteCount += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sumAbs += Math.abs(value);
  }

  return {
    length: signal.length,
    finiteCount,
    nonFiniteCount,
    firstNonFiniteIndex,
    min: finiteCount > 0 ? min : Number.NaN,
    max: finiteCount > 0 ? max : Number.NaN,
    meanAbs: finiteCount > 0 ? sumAbs / finiteCount : Number.NaN,
  };
}

function combineSignalStats(statsList: SignalStats[]): SignalStats {
  const length = statsList.reduce((sum, stats) => sum + stats.length, 0);
  const finiteCount = statsList.reduce(
    (sum, stats) => sum + stats.finiteCount,
    0,
  );
  const nonFiniteCount = statsList.reduce(
    (sum, stats) => sum + stats.nonFiniteCount,
    0,
  );
  const firstNonFiniteIndex =
    statsList.find((stats) => stats.firstNonFiniteIndex !== null)
      ?.firstNonFiniteIndex ?? null;
  const min = Math.min(...statsList.map((stats) => stats.min));
  const max = Math.max(...statsList.map((stats) => stats.max));
  const weightedAbsSum = statsList.reduce(
    (sum, stats) => sum + stats.meanAbs * stats.finiteCount,
    0,
  );

  return {
    length,
    finiteCount,
    nonFiniteCount,
    firstNonFiniteIndex,
    min: finiteCount > 0 ? min : Number.NaN,
    max: finiteCount > 0 ? max : Number.NaN,
    meanAbs: finiteCount > 0 ? weightedAbsSum / finiteCount : Number.NaN,
  };
}

function assertFiniteSignalStats(
  stats: SignalStats,
  context: {
    config: RoformerVocalModelConfig;
    stage: string;
    chunkIndex: number;
    totalChunks: number;
    inputStats?: SignalStats;
    maskStats?: SignalStats;
    extra?: string;
  },
) {
  if (stats.nonFiniteCount === 0) {
    return;
  }

  throw new Error(
    [
      `${context.config.label} の${context.stage}に不正な値が含まれました。`,
      context.stage.includes("推論出力mask")
        ? "WebGPU推論がNaN/Infinityを返しています。"
        : null,
      `chunk=${context.chunkIndex + 1}/${context.totalChunks}`,
      `stats=${formatSignalStats(stats)}`,
      context.inputStats
        ? `inputStats=${formatSignalStats(context.inputStats)}`
        : null,
      context.maskStats
        ? `maskStats=${formatSignalStats(context.maskStats)}`
        : null,
      context.extra,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function formatSignalStats(stats: SignalStats): string {
  return [
    `len:${stats.length}`,
    `finite:${stats.finiteCount}`,
    `nonFinite:${stats.nonFiniteCount}`,
    `firstBad:${stats.firstNonFiniteIndex ?? "-"}`,
    `min:${formatDebugNumber(stats.min)}`,
    `max:${formatDebugNumber(stats.max)}`,
    `meanAbs:${formatDebugNumber(stats.meanAbs)}`,
  ].join(",");
}

function formatDebugNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  return value.toExponential(3);
}

function getNavigatorGpu():
  | {
      requestAdapter?: () => Promise<GPUAdapter | null>;
    }
  | undefined {
  return (
    navigator as Navigator & {
      gpu?: {
        requestAdapter?: () => Promise<GPUAdapter | null>;
      };
    }
  ).gpu;
}
