import type { PitchDetector } from "pitchy";
import { chooseBestLibraryPitch, getRms } from "./pitchMath";
import type { PitchDetection } from "./session";

export type LibraryDetectors = {
  sampleRate: number;
  detector: Pick<PitchDetector<Float32Array>, "findPitch">;
};

export type TargetPitchOptions = {
  minRms: number;
  targetFrequency: number;
  minClarity: number;
};

export type PitchFrame = PitchDetection & { rms: number };

const VOICE_RANGE_MIN_CLARITY = 0.93;

export function analyzeTargetPitch(
  buffer: Float32Array<ArrayBuffer>,
  detectors: LibraryDetectors,
  options: TargetPitchOptions,
): PitchFrame {
  const { rms, pitch } = readPitch(buffer, detectors, options.minRms);
  if (!pitch) return { rms, frequency: null, clarity: null };

  const [frequency, clarity] = pitch;
  const confidence = clamp(clarity, 0, 1);
  const candidates =
    frequency > 0 && confidence >= options.minClarity
      ? [{ frequency, confidence, source: "pitchy" as const }]
      : [];
  const best = chooseBestLibraryPitch(candidates, options.targetFrequency);
  return {
    rms,
    frequency: best?.frequency ?? null,
    clarity: best?.confidence ?? (frequency > 0 ? confidence : null),
  };
}

export function analyzeVoiceRangePitch(
  buffer: Float32Array<ArrayBuffer>,
  detectors: LibraryDetectors,
  minRms: number,
): PitchFrame {
  const { rms, pitch } = readPitch(buffer, detectors, minRms);
  if (!pitch) return { rms, frequency: null, clarity: null };

  const [frequency, clarity] = pitch;
  return {
    rms,
    frequency:
      Number.isFinite(frequency) &&
      frequency >= 32.7 &&
      frequency <= 2100 &&
      clarity >= VOICE_RANGE_MIN_CLARITY
        ? frequency
        : null,
    clarity: Number.isFinite(clarity) ? clamp(clarity, 0, 1) : null,
  };
}

function readPitch(
  buffer: Float32Array<ArrayBuffer>,
  { sampleRate, detector }: LibraryDetectors,
  minRms: number,
) {
  const rms = getRms(buffer);
  return {
    rms,
    pitch: rms < minRms ? null : detector.findPitch(buffer, sampleRate),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
