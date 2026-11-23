import { PitchDetector } from "pitchy";
import { AnimationLoop } from "./animationLoop";
import {
  analyzeTargetPitch,
  analyzeVoiceRangePitch,
  type PitchFrame,
  type TargetPitchOptions,
} from "./pitchDetection";

export const PRACTICE_MIC_FFT_SIZE = 4096;
export const PRACTICE_MIN_CLARITY = 0.52;
const PITCHY_CLARITY_THRESHOLD = 0.93;

export type MicrophoneCapture = {
  deviceLabel: string;
  sampleTarget(options: TargetPitchOptions): PitchFrame;
  sampleVoiceRange(minRms: number): PitchFrame;
};

type MicrophoneOptions = {
  deviceId: string;
  fftSize: number;
  onEnded(): void;
};

export class MicrophoneInput {
  private generation = 0;
  private release: (() => void) | null = null;
  private readonly loop = new AnimationLoop();
  private capture: MicrophoneCapture | null = null;
  private starting = false;

  get isActive() {
    return this.capture !== null;
  }

  get isStarting() {
    return this.starting;
  }

  isCurrent(capture: MicrophoneCapture) {
    return this.capture === capture;
  }

  async start(
    context: AudioContext | (() => AudioContext),
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

    this.starting = true;
    try {
      const capture = await this.acquire(
        typeof context === "function" ? context() : context,
        options,
        generation,
      );
      if (generation !== this.generation) return null;
      this.capture = capture;
      return capture;
    } catch (error) {
      if (generation !== this.generation) return null;
      this.disposeCapture();
      throw error;
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  private async acquire(
    context: AudioContext,
    options: MicrophoneOptions,
    generation: number,
  ): Promise<MicrophoneCapture | null> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
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
    function readWaveform() {
      inputAnalyser.getFloatTimeDomainData(buffer);
      return buffer;
    }
    return {
      deviceLabel: stream.getAudioTracks()[0]?.label ?? "",
      sampleTarget(options) {
        return analyzeTargetPitch(readWaveform(), detectors, options);
      },
      sampleVoiceRange(minRms) {
        return analyzeVoiceRangePitch(readWaveform(), detectors, minRms);
      },
    };
  }

  startFrames(onFrame: (now: number, capture: MicrophoneCapture) => void) {
    const capture = this.capture;
    if (capture) this.loop.start((now) => onFrame(now, capture));
  }

  stop() {
    this.generation++;
    this.starting = false;
    this.loop.stop();
    this.disposeCapture();
  }

  private disposeCapture() {
    this.release?.();
    this.release = null;
    this.capture = null;
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
      return `${prefix}ブラウザのマイク許可と、HTTPSまたはlocalhostで開いていることを確認してください。`;
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
