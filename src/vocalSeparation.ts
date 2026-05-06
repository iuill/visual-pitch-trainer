import type { DecodedMediaAudio } from "./mediaAudioExtraction";
import { assertModelUrlAccessible } from "./modelAccess";
import {
  assertRoformerModelAccessible,
  extractVocalsWithRoformer,
  ROFORMER_VOCAL_MODELS,
  type RoformerVocalModelId,
} from "./roformerVocalSeparation";

type DemucsModule = typeof import("demucs-web");
type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");
type DemucsProcessor = InstanceType<DemucsModule["DemucsProcessor"]>;
type DemucsModelInput = ReturnType<DemucsModule["prepareModelInput"]>;

export type VocalSeparationProgress = {
  phase: "loading-runtime" | "loading-model" | "separating";
  modelLabel?: string;
  loadedBytes?: number;
  totalBytes?: number;
  progress?: number;
  currentSegment?: number;
  totalSegments?: number;
};

export type VocalSeparationModelId = "demucs" | RoformerVocalModelId;

export type VocalSeparationOptions = {
  modelId?: VocalSeparationModelId;
  onProgress?: (progress: VocalSeparationProgress) => void;
};

const DEMUCS_SAMPLE_RATE = 44_100;
const ONNX_RUNTIME_WASM_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.asyncify.wasm";
const DEFAULT_MODEL_URL =
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";
const DEFAULT_DEMUCS_PARALLEL_SEGMENTS = 1;

export const VOCAL_SEPARATION_MODELS: Record<
  VocalSeparationModelId,
  {
    label: string;
    sizeLabel: string;
    licenseNote: string;
    isAvailableInBuild: boolean;
  }
> = {
  demucs: {
    label: "Demucs v4",
    sizeLabel: "約172MB",
    licenseNote: "demucs-web / HTDemucs 系。既存の標準モデルです。",
    isAvailableInBuild: true,
  },
  "bs-roformer-fp16": {
    label: ROFORMER_VOCAL_MODELS["bs-roformer-fp16"].label,
    sizeLabel: "約310MB",
    licenseNote:
      "MIT表記。商用利用前は配布元の学習データ条件も確認してください。",
    isAvailableInBuild:
      ROFORMER_VOCAL_MODELS["bs-roformer-fp16"].isAvailableInBuild,
  },
};

export async function extractVocals(
  decodedAudio: DecodedMediaAudio,
  options: VocalSeparationOptions = {},
): Promise<DecodedMediaAudio> {
  await assertVocalSeparationSupported();
  const modelId = options.modelId ?? "demucs";
  const modelLabel = VOCAL_SEPARATION_MODELS[modelId].label;

  options.onProgress?.({ phase: "loading-runtime", modelLabel });
  const ort = await import("onnxruntime-web/webgpu");

  configureOnnxRuntime(ort);

  if (modelId !== "demucs") {
    return extractVocalsWithRoformer(decodedAudio, modelId, ort, {
      onProgress: (progress) => {
        options.onProgress?.({
          ...progress,
          modelLabel,
        });
      },
    });
  }

  const demucs = await import("demucs-web");
  const processors = await createDemucsProcessors(demucs, ort, options);
  if (!processors[0]) {
    throw new Error("Demucs v4 の推論セッションを作成できませんでした。");
  }

  try {
    options.onProgress?.({ phase: "separating", progress: 0, modelLabel });
    const stereoAudio = await resampleToDemucsStereo(decodedAudio);
    const vocals = await separateVocalsWithDemucsProcessors(
      demucs,
      ort,
      processors,
      stereoAudio.left,
      stereoAudio.right,
      options,
    );

    return {
      sampleRate: DEMUCS_SAMPLE_RATE,
      channels: [vocals.left, vocals.right],
      durationSec: vocals.left.length / DEMUCS_SAMPLE_RATE,
      source: decodedAudio.source,
    };
  } finally {
    await releaseDemucsProcessorSessions(processors);
  }
}

export function getVocalSeparationSupportMessage(): string | null {
  if (!window.isSecureContext) {
    return "ボーカル抽出にはHTTPSまたはlocalhostの安全な接続が必要です。";
  }

  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    return "ボーカル抽出にはCross-Origin-Opener-PolicyとCross-Origin-Embedder-Policyが有効な配信環境が必要です。";
  }

  if (!getNavigatorGpu()) {
    return "このブラウザではWebGPUが使えないため、ボーカル抽出はPC版Chrome/Edgeなどで試してください。";
  }

  return null;
}

export async function assertVocalSeparationSupported(): Promise<void> {
  const supportMessage = getVocalSeparationSupportMessage();
  if (supportMessage) {
    throw new Error(supportMessage);
  }

  const adapter = await getNavigatorGpu()?.requestAdapter?.();
  if (!adapter) {
    throw new Error(
      "この環境ではWebGPUアダプタを取得できないため、ボーカル抽出を使えません。",
    );
  }
}

export async function assertVocalSeparationModelAccessible(
  modelId: VocalSeparationModelId,
): Promise<void> {
  const model = VOCAL_SEPARATION_MODELS[modelId];
  if (!model.isAvailableInBuild) {
    throw new Error(`${model.label} はこのビルドでは利用できません。`);
  }

  if (modelId !== "demucs") {
    await assertRoformerModelAccessible(modelId);
    return;
  }

  await assertModelUrlAccessible({
    label: model.label,
    modelUrl: getDemucsModelUrl(),
    minBytes: 16 * 1024 * 1024,
    setupHint:
      "既定では Hugging Face 上の Demucs v4 モデルを取得します。別の配信先を使う場合は VITE_DEMUCS_MODEL_URL に有効なONNXモデルURLを指定してください。",
  });
}

function createDemucsProcessor(
  demucs: DemucsModule,
  ort: OnnxRuntimeWebGpu,
  options: VocalSeparationOptions,
) {
  return new demucs.DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "basic",
    },
    onProgress: (progress: {
      progress: number;
      currentSegment: number;
      totalSegments: number;
    }) => {
      options.onProgress?.({
        phase: "separating",
        modelLabel: VOCAL_SEPARATION_MODELS.demucs.label,
        progress: progress.progress,
        currentSegment: progress.currentSegment,
        totalSegments: progress.totalSegments,
      });
    },
  });
}

async function createDemucsProcessors(
  demucs: DemucsModule,
  ort: OnnxRuntimeWebGpu,
  options: VocalSeparationOptions,
) {
  const parallelSegments = getDemucsParallelSegments();
  const modelBuffer = await fetchDemucsModelBuffer(options);
  const processors: DemucsProcessor[] = [];

  try {
    for (let index = 0; index < parallelSegments; index++) {
      const processor = createDemucsProcessor(demucs, ort, options);
      processors.push(processor);
      await processor.loadModel(modelBuffer.slice(0));
    }
  } catch (error) {
    await releaseDemucsProcessorSessions(processors);
    throw error;
  }

  return processors;
}

async function releaseDemucsProcessorSessions(processors: DemucsProcessor[]) {
  await Promise.all(
    processors.map((processor) => releaseDemucsProcessorSession(processor)),
  );
}

async function releaseDemucsProcessorSession(processor: DemucsProcessor) {
  try {
    await processor.session?.release();
  } catch (error) {
    console.warn("Failed to release Demucs ONNX session.", error);
  } finally {
    processor.session = null;
  }
}

async function separateVocalsWithDemucsProcessors(
  demucs: DemucsModule,
  ort: OnnxRuntimeWebGpu,
  processors: DemucsProcessor[],
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  options: VocalSeparationOptions,
) {
  const primarySession = processors[0]?.session;
  if (!primarySession) {
    throw new Error("Demucs v4 の推論セッションが読み込まれていません。");
  }

  const {
    TRAINING_SAMPLES,
    MODEL_SPEC_BINS,
    MODEL_SPEC_FRAMES,
    SEGMENT_OVERLAP,
    TRACKS,
  } = demucs.CONSTANTS;
  const totalSamples = leftChannel.length;
  const stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
  const numSegments = Math.ceil((totalSamples - TRAINING_SAMPLES) / stride) + 1;
  const vocalsTrackIndex = TRACKS.indexOf("vocals");
  if (vocalsTrackIndex < 0) {
    throw new Error("Demucs v4 の出力に vocals stem が見つかりません。");
  }

  const vocals = {
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
  };
  const weights = new Float32Array(totalSamples);
  let nextSegmentIndex = 0;
  let completedSegments = 0;

  const processNextSegment = async (processor: DemucsProcessor) => {
    const session = processor.session;
    if (!session) {
      throw new Error("Demucs v4 の推論セッションが解放されています。");
    }

    while (true) {
      const segmentIndex = nextSegmentIndex;
      nextSegmentIndex++;

      const start = segmentIndex * stride;
      if (start >= totalSamples) {
        return;
      }

      const segmentLength = Math.min(TRAINING_SAMPLES, totalSamples - start);
      const segment = prepareDemucsSegment(
        leftChannel,
        rightChannel,
        start,
        segmentLength,
        TRAINING_SAMPLES,
      );
      const input = demucs.prepareModelInput(segment.left, segment.right);
      const output = await runDemucsSegment(
        ort,
        demucs,
        session,
        input,
        TRAINING_SAMPLES,
        MODEL_SPEC_BINS,
        MODEL_SPEC_FRAMES,
        vocalsTrackIndex,
      );
      const overlapWindow = createDemucsOverlapWindow(segmentLength, stride);

      for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
        const sampleIndex = start + i;
        const weight = overlapWindow[i] ?? 0;
        vocals.left[sampleIndex] += output.left[i] * weight;
        vocals.right[sampleIndex] += output.right[i] * weight;
        weights[sampleIndex] += weight;
      }

      completedSegments++;
      options.onProgress?.({
        phase: "separating",
        modelLabel: VOCAL_SEPARATION_MODELS.demucs.label,
        progress: completedSegments / numSegments,
        currentSegment: completedSegments,
        totalSegments: numSegments,
      });
    }
  };

  await Promise.all(
    processors.map((processor) => processNextSegment(processor)),
  );

  for (let i = 0; i < totalSamples; i++) {
    if (weights[i] > 0) {
      vocals.left[i] /= weights[i];
      vocals.right[i] /= weights[i];
    }
  }

  return vocals;
}

function prepareDemucsSegment(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  start: number,
  segmentLength: number,
  trainingSamples: number,
) {
  const left = new Float32Array(trainingSamples);
  const right = new Float32Array(trainingSamples);

  for (let i = 0; i < segmentLength; i++) {
    left[i] = leftChannel[start + i] ?? 0;
    right[i] = rightChannel[start + i] ?? 0;
  }

  return { left, right };
}

async function runDemucsSegment(
  ort: OnnxRuntimeWebGpu,
  demucs: DemucsModule,
  session: NonNullable<DemucsProcessor["session"]>,
  input: DemucsModelInput,
  trainingSamples: number,
  modelSpecBins: number,
  modelSpecFrames: number,
  vocalsTrackIndex: number,
) {
  const waveformTensor = new ort.Tensor("float32", input.waveform, [
    1,
    2,
    trainingSamples,
  ]);
  const magSpecTensor = new ort.Tensor("float32", input.magSpec, [
    1,
    4,
    modelSpecBins,
    modelSpecFrames,
  ]);
  const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
    [session.inputNames[0]]: waveformTensor,
  };
  if (session.inputNames.length > 1 && session.inputNames[1]) {
    feeds[session.inputNames[1]] = magSpecTensor;
  }

  let left = new Float32Array(0);
  let right = new Float32Array(0);
  let inferResults: Record<
    string,
    { data: unknown; dims: readonly number[]; dispose?: () => void }
  > = {};

  try {
    inferResults = await session.run(feeds);
    let timeData: Float32Array | null = null;
    let timeShape: readonly number[] | null = null;
    let freqData: Float32Array | null = null;

    for (const name of session.outputNames) {
      const tensor = inferResults[name];
      if (!tensor) {
        continue;
      }

      if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
        timeData = tensor.data as Float32Array;
        timeShape = tensor.dims;
      } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
        freqData = tensor.data as Float32Array;
      }
    }

    if (!timeData || !timeShape) {
      throw new Error("Demucs v4 の時間領域出力が見つかりません。");
    }

    const numChannels = timeShape[2];
    const samples = timeShape[3];
    if (numChannels !== 2 || typeof samples !== "number") {
      throw new Error("Demucs v4 の時間領域出力 shape が想定外です。");
    }

    left = new Float32Array(samples);
    right = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      left[i] = timeData[vocalsTrackIndex * numChannels * samples + i] ?? 0;
      right[i] =
        timeData[vocalsTrackIndex * numChannels * samples + samples + i] ?? 0;
    }

    if (freqData) {
      const vocalsSpec = demucs.standaloneMask(freqData)[vocalsTrackIndex];
      if (vocalsSpec) {
        const freqOutput = demucs.standaloneIspec(vocalsSpec, trainingSamples);
        for (let i = 0; i < samples; i++) {
          left[i] += freqOutput.left[i] ?? 0;
          right[i] += freqOutput.right[i] ?? 0;
        }
      }
    }
  } finally {
    disposeTensor(waveformTensor);
    disposeTensor(magSpecTensor);
    disposeTensors(Object.values(inferResults));
  }

  return { left, right };
}

function createDemucsOverlapWindow(segmentLength: number, stride: number) {
  const overlapWindow = new Float32Array(segmentLength);

  for (let i = 0; i < segmentLength; i++) {
    const fadeIn = Math.min(i / (stride * 0.5), 1);
    const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
    overlapWindow[i] = Math.min(fadeIn, fadeOut);
  }

  return overlapWindow;
}

function configureOnnxRuntime(ort: OnnxRuntimeWebGpu) {
  ort.env.wasm.numThreads = window.crossOriginIsolated
    ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
    : 1;
  ort.env.wasm.wasmPaths = {
    wasm: ONNX_RUNTIME_WASM_URL,
  };
}

function getDemucsModelUrl(): string {
  return import.meta.env.VITE_DEMUCS_MODEL_URL || DEFAULT_MODEL_URL;
}

function getDemucsParallelSegments(): number {
  const configured = Number(import.meta.env.VITE_DEMUCS_PARALLEL_SEGMENTS);
  if (!Number.isFinite(configured)) {
    return DEFAULT_DEMUCS_PARALLEL_SEGMENTS;
  }

  return Math.max(1, Math.min(4, Math.floor(configured)));
}

async function fetchDemucsModelBuffer(options: VocalSeparationOptions) {
  options.onProgress?.({
    phase: "loading-model",
    modelLabel: VOCAL_SEPARATION_MODELS.demucs.label,
  });

  const response = await fetch(getDemucsModelUrl());
  if (!response.ok) {
    throw new Error(
      `Demucs v4 モデルを取得できませんでした: ${response.status}`,
    );
  }

  const contentLength = response.headers.get("Content-Length");
  if (!contentLength || !response.body) {
    return response.arrayBuffer();
  }

  const totalBytes = Number(contentLength);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    loadedBytes += value.length;
    options.onProgress?.({
      phase: "loading-model",
      modelLabel: VOCAL_SEPARATION_MODELS.demucs.label,
      loadedBytes,
      totalBytes,
    });
  }

  const combined = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined.buffer;
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

function disposeTensors(tensors: Array<{ dispose?: () => void } | undefined>) {
  for (const tensor of tensors) {
    disposeTensor(tensor);
  }
}

function disposeTensor(tensor: { dispose?: () => void } | undefined) {
  tensor?.dispose?.();
}

async function resampleToDemucsStereo(
  decodedAudio: DecodedMediaAudio,
): Promise<{
  left: Float32Array;
  right: Float32Array;
}> {
  const left = decodedAudio.channels[0] ?? new Float32Array(0);
  const right = decodedAudio.channels[1] ?? left;

  if (decodedAudio.sampleRate === DEMUCS_SAMPLE_RATE) {
    return {
      left: new Float32Array(left),
      right: new Float32Array(right),
    };
  }

  const frameCount = Math.max(
    1,
    Math.ceil((left.length / decodedAudio.sampleRate) * DEMUCS_SAMPLE_RATE),
  );
  const offlineContext = new OfflineAudioContext(
    2,
    frameCount,
    DEMUCS_SAMPLE_RATE,
  );
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
