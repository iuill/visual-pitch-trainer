// MDX geometry and model parameters follow Ultimate Vocal Remover / MDX-Net.
// Only model files are downloaded; microphone audio never leaves the browser.
import { hzToCents, hzToMidi } from "./pitchMath";

const MODEL_REVISION = "fddec39677560e41e3194f24a9e4c4cd32ef0e83";
const MODEL_BASE = `https://huggingface.co/Blane187/all_public_uvr_models/resolve/${MODEL_REVISION}`;
export const LIVE_MODELS = {
  "voc-ft": {
    label: "MDX Voc FT",
    url: `${MODEL_BASE}/UVR-MDX-NET-Voc_FT.onnx`,
    sha256: "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111",
    bytes: 66_762_490,
    compensate: 1.021,
  },
  "kim-vocal-2": {
    label: "MDX Kim Vocal 2",
    url: `${MODEL_BASE}/Kim_Vocal_2.onnx`,
    sha256: "ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b",
    bytes: 66_759_214,
    compensate: 1.009,
  },
} as const;
export type LiveModelId = keyof typeof LIVE_MODELS;
export type LiveBackend = "webgpu" | "wasm";
export const LIVE_SAMPLE_RATE = 44_100;
export const MDX_FFT = 7680;
export const MDX_BINS = 3072;
export const MDX_FRAMES = 256;
export const MDX_HOP = 1024;
export const MDX_SAMPLES = MDX_HOP * (MDX_FRAMES - 1);

export type LivePitchPoint = {
  timeMs: number;
  pianoHz: number | null;
  voiceHz: number | null;
  uncertain: boolean;
};
export type LiveWorkerRequest =
  | { type: "load"; model: LiveModelId; backend: LiveBackend }
  | {
      type: "analyze";
      samples: Float32Array;
      sampleRate: number;
      endTimeMs: number;
      minRms: number;
    };
export type LiveWorkerReply =
  | { type: "status"; message: string }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "result"; points: LivePitchPoint[]; processingMs: number };

/** Fixed capacity: pending inference must never grow the microphone buffer. */
export class LiveSampleBuffer {
  private readonly data: Float32Array;
  private cursor = 0;
  private count = 0;
  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }
  push(samples: Float32Array) {
    for (const sample of samples) {
      this.data[this.cursor] = sample;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
    }
  }
  snapshot(): Float32Array | null {
    if (this.count < this.capacity) return null;
    const result = new Float32Array(this.capacity);
    const tail = this.data.subarray(this.cursor);
    result.set(tail);
    result.set(this.data.subarray(0, this.cursor), tail.length);
    return result;
  }
}

/** Suppresses nearly identical leaked waveforms; this is not voice identification. */
export function stemsAreAmbiguous(voice: Float32Array, piano: Float32Array) {
  let vv = 0;
  let pp = 0;
  let vp = 0;
  for (let i = 0; i < voice.length; i++) {
    vv += voice[i] ** 2;
    pp += piano[i] ** 2;
    vp += voice[i] * piano[i];
  }
  if (vv === 0 || pp === 0) return true;
  const ratio = vv / pp;
  return (
    ratio < 0.01 || ratio > 100 || Math.abs(vp) / Math.sqrt(vv * pp) > 0.98
  );
}

export type LiveMatchState = {
  lastTimeMs: number | null;
  targetMidi: number | null;
  heldMs: number;
};
export function updateLiveMatch(
  previous: LiveMatchState,
  point: LivePitchPoint,
  tolerance: number,
): LiveMatchState {
  const targetMidi = point.pianoHz ? Math.round(hzToMidi(point.pianoHz)) : null;
  const matches =
    !point.uncertain &&
    point.voiceHz !== null &&
    point.pianoHz !== null &&
    Math.abs(hzToCents(point.voiceHz, point.pianoHz)) <= tolerance;
  const gap =
    previous.lastTimeMs === null
      ? Infinity
      : point.timeMs - previous.lastTimeMs;
  return {
    lastTimeMs: matches ? point.timeMs : null,
    targetMidi,
    heldMs:
      matches && targetMidi === previous.targetMidi && gap > 0 && gap <= 150
        ? previous.heldMs + gap
        : 0,
  };
}
