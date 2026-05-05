declare module "demucs-web" {
  export const CONSTANTS: {
    SAMPLE_RATE: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };

  export class DemucsProcessor {
    constructor(options: {
      ort: typeof import("onnxruntime-web/webgpu");
      modelPath?: string;
      sessionOptions?: import("onnxruntime-web").InferenceSession.SessionOptions;
      onProgress?: (progress: {
        progress: number;
        currentSegment: number;
        totalSegments: number;
      }) => void;
      onLog?: (category: string, message: string) => void;
      onDownloadProgress?: (loadedBytes: number, totalBytes: number) => void;
    });

    loadModel(modelPathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(
      leftChannel: Float32Array,
      rightChannel: Float32Array,
    ): Promise<{
      drums: DemucsStem;
      bass: DemucsStem;
      other: DemucsStem;
      vocals: DemucsStem;
    }>;
  }

  export type DemucsStem = {
    left: Float32Array;
    right: Float32Array;
  };
}
