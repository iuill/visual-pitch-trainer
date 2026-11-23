import { PitchDetector } from "pitchy";
import {
  analyzePitchFrame,
  type PitchFrame,
  type PitchFrameOptions,
} from "./pitchDetection";

export const PRACTICE_MIC_FFT_SIZE = 4096;
const PITCHY_CLARITY_THRESHOLD = 0.93;

export type MicrophoneCapture = {
  deviceLabel: string;
  sample(options: PitchFrameOptions): PitchFrame;
};

type MicrophoneOptions = {
  deviceId: string;
  fftSize: number;
  onEnded(): void;
};

export class MicrophoneInput {
  private generation = 0;
  private release: (() => void) | null = null;

  async start(
    context: AudioContext,
    options: MicrophoneOptions,
  ): Promise<MicrophoneCapture | null> {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        "Microphone input requires a secure context.",
        "SecurityError",
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(options.deviceId
            ? { deviceId: { exact: options.deviceId } }
            : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
    const tracks = stream.getTracks();
    if (generation !== this.generation) {
      for (const track of tracks) track.stop();
      return null;
    }

    let analyser: AnalyserNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    const onEnded = () => {
      this.stop();
      options.onEnded();
    };
    this.release = () => {
      for (const track of tracks) {
        track.removeEventListener("ended", onEnded);
        track.stop();
      }
      source?.disconnect();
      analyser?.disconnect();
    };

    try {
      const inputAnalyser = context.createAnalyser();
      analyser = inputAnalyser;
      analyser.fftSize = options.fftSize;
      analyser.smoothingTimeConstant = 0;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const detector = PitchDetector.forFloat32Array(buffer.length);
      detector.clarityThreshold = PITCHY_CLARITY_THRESHOLD;
      for (const track of tracks) track.addEventListener("ended", onEnded);
      const detectors = { detector, sampleRate: context.sampleRate };
      return {
        deviceLabel: stream.getAudioTracks()[0]?.label ?? "",
        sample(options) {
          inputAnalyser.getFloatTimeDomainData(buffer);
          return analyzePitchFrame(buffer, detectors, options);
        },
      };
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.generation++;
    this.release?.();
    this.release = null;
  }
}

export function formatMicrophoneError(error: unknown): string {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "UnknownError";
  const prefix = `マイクを開始できませんでした（${name}）。`;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${prefix}ブラウザのマイク許可と、HTTPSで開いていることを確認してください。`;
    case "OverconstrainedError":
    case "NotFoundError":
      return `${prefix}共通設定のマイクを「既定のマイク」に戻すか、接続中の入力を選び直してください。`;
    case "NotReadableError":
    case "AbortError":
      return `${prefix}ほかのアプリでのマイク使用を止めて、もう一度開始してください。改善しない場合はページを開き直してください。`;
    default:
      return `${prefix}ブラウザのマイク許可と接続を確認してください。`;
  }
}
