declare module "demucs-web" {
  export const CONSTANTS: {
    SAMPLE_RATE: number;
    FFT_SIZE: number;
    HOP_SIZE: number;
    TRAINING_SAMPLES: number;
    MODEL_SPEC_BINS: number;
    MODEL_SPEC_FRAMES: number;
    SEGMENT_OVERLAP: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };

  export function prepareModelInput(
    leftChannel: Float32Array,
    rightChannel: Float32Array,
  ): {
    waveform: Float32Array;
    magSpec: Float32Array;
  };

  export function standaloneMask(freqOutput: Float32Array): Array<{
    leftReal: Float32Array;
    leftImag: Float32Array;
    rightReal: Float32Array;
    rightImag: Float32Array;
  }>;

  export function standaloneIspec(
    trackSpec: {
      leftReal: Float32Array;
      leftImag: Float32Array;
      rightReal: Float32Array;
      rightImag: Float32Array;
    },
    targetLength: number,
  ): DemucsStem;

  export class DemucsProcessor {
    session: import("onnxruntime-web").InferenceSession | null;

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
  }

  export type DemucsStem = {
    left: Float32Array;
    right: Float32Array;
  };
}
