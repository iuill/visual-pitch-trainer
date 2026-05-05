import type { DecodedMediaAudio } from "./mediaAudioExtraction";

type DemucsModule = typeof import("demucs-web");
type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");

export type VocalSeparationProgress = {
  phase: "loading-runtime" | "loading-model" | "separating";
  loadedBytes?: number;
  totalBytes?: number;
  progress?: number;
  currentSegment?: number;
  totalSegments?: number;
};

export type VocalSeparationOptions = {
  onProgress?: (progress: VocalSeparationProgress) => void;
};

const DEMUCS_SAMPLE_RATE = 44_100;
const DEFAULT_MODEL_URL =
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";

export async function extractVocalsWithDemucs(
  decodedAudio: DecodedMediaAudio,
  options: VocalSeparationOptions = {},
): Promise<DecodedMediaAudio> {
  options.onProgress?.({ phase: "loading-runtime" });
  const [demucs, ort] = await Promise.all([
    import("demucs-web"),
    import("onnxruntime-web/webgpu"),
  ]);

  configureOnnxRuntime(ort);

  const processor = createDemucsProcessor(demucs, ort, options);

  options.onProgress?.({ phase: "loading-model" });
  await processor.loadModel(getDemucsModelUrl());

  options.onProgress?.({ phase: "separating", progress: 0 });
  const stereoAudio = await resampleToDemucsStereo(decodedAudio);
  const separated = await processor.separate(
    stereoAudio.left,
    stereoAudio.right,
  );

  return {
    sampleRate: DEMUCS_SAMPLE_RATE,
    channels: [separated.vocals.left, separated.vocals.right],
    durationSec: separated.vocals.left.length / DEMUCS_SAMPLE_RATE,
    source: decodedAudio.source,
  };
}

export function getVocalSeparationSupportMessage(): string | null {
  if (!("gpu" in navigator)) {
    return "このブラウザではWebGPUが使えないため、ボーカル抽出はPC版Chrome/Edgeなどで試してください。";
  }

  if (!window.isSecureContext) {
    return "ボーカル抽出にはHTTPSまたはlocalhostの安全な接続が必要です。";
  }

  return null;
}

function createDemucsProcessor(
  demucs: DemucsModule,
  ort: OnnxRuntimeWebGpu,
  options: VocalSeparationOptions,
) {
  return new demucs.DemucsProcessor({
    ort,
    modelPath: getDemucsModelUrl(),
    sessionOptions: {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "basic",
    },
    onDownloadProgress: (loadedBytes: number, totalBytes: number) => {
      options.onProgress?.({
        phase: "loading-model",
        loadedBytes,
        totalBytes,
      });
    },
    onProgress: (progress: {
      progress: number;
      currentSegment: number;
      totalSegments: number;
    }) => {
      options.onProgress?.({
        phase: "separating",
        progress: progress.progress,
        currentSegment: progress.currentSegment,
        totalSegments: progress.totalSegments,
      });
    },
  });
}

function configureOnnxRuntime(ort: OnnxRuntimeWebGpu) {
  ort.env.wasm.numThreads = window.crossOriginIsolated
    ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
    : 1;
}

function getDemucsModelUrl(): string {
  return import.meta.env.VITE_DEMUCS_MODEL_URL || DEFAULT_MODEL_URL;
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
