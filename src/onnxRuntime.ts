import { PITCH_MODEL_SETUP_HINT } from "./modelAccess";

export type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");

type ConfigureOnnxRuntimeWebGpuOptions = {
  numThreads: number;
  powerPreference?: GPURequestAdapterOptions["powerPreference"];
};

const ONNX_RUNTIME_WASM_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${import.meta.env.VITE_ONNX_RUNTIME_WEB_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`;

export function configureOnnxRuntimeWebGpu(
  ort: OnnxRuntimeWebGpu,
  options: ConfigureOnnxRuntimeWebGpuOptions,
) {
  ort.env.wasm.numThreads = options.numThreads;
  ort.env.wasm.wasmPaths = {
    wasm: ONNX_RUNTIME_WASM_URL,
  };

  if (options.powerPreference) {
    ort.env.webgpu.powerPreference = options.powerPreference;
  }
}

type BrowserGpu = {
  requestAdapter?: () => Promise<GPUAdapter | null>;
};

function getNavigatorGpu(): BrowserGpu | undefined {
  return (navigator as Navigator & { gpu?: BrowserGpu }).gpu;
}

export async function requestWebGpuAdapter() {
  return getNavigatorGpu()?.requestAdapter?.();
}

type WebGpuRequirements = {
  requiresCrossOriginIsolation?: boolean;
};

export function getWebGpuSupportMessage(
  feature: string,
  { requiresCrossOriginIsolation }: WebGpuRequirements = {},
): string | null {
  if (!window.isSecureContext) {
    return `${feature}にはHTTPSまたはlocalhostの安全な接続が必要です。`;
  }

  if (
    requiresCrossOriginIsolation &&
    (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
  ) {
    return `${feature}にはCross-Origin-Opener-PolicyとCross-Origin-Embedder-Policyが有効な配信環境が必要です。`;
  }

  if (!getNavigatorGpu()) {
    return `このブラウザではWebGPUが使えないため、${feature}はPC版Chrome/Edgeなどで試してください。`;
  }

  return null;
}

export async function assertWebGpuSupported(
  feature: string,
  requirements?: WebGpuRequirements,
): Promise<void> {
  const supportMessage = getWebGpuSupportMessage(feature, requirements);
  if (supportMessage) throw new Error(supportMessage);

  if (!(await requestWebGpuAdapter())) {
    throw new Error(
      `この環境ではWebGPUアダプタを取得できないため、${feature}を使えません。`,
    );
  }
}

export function disposeTensors(
  ...tensors: ({ dispose?: () => void } | undefined)[]
) {
  for (const tensor of tensors) tensor?.dispose?.();
}

export type PitchModelSession = {
  ort: OnnxRuntimeWebGpu;
  session: Awaited<ReturnType<OnnxRuntimeWebGpu["InferenceSession"]["create"]>>;
};

export async function createPitchModelSession(
  label: string,
  modelUrl: string,
): Promise<PitchModelSession> {
  const ort = await import("onnxruntime-web/webgpu");
  configureOnnxRuntimeWebGpu(ort, {
    numThreads: 1,
    powerPreference: "high-performance",
  });

  try {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
    return { ort, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      !message.includes("protobuf parsing failed") &&
      !message.includes("Failed to load model")
    ) {
      throw error;
    }
    throw new Error(
      `${label}モデルを読み込めませんでした。${modelUrl} が有効な ONNX モデルとして配信されているか確認してください。${PITCH_MODEL_SETUP_HINT}元のエラー: ${message}`,
    );
  }
}
