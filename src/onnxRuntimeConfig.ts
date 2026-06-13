type OnnxRuntimeWebGpu = typeof import("onnxruntime-web/webgpu");

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
