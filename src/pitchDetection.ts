import type { PitchDetector } from "pitchy";
import { chooseBestLibraryPitch, getRms } from "./pitchMath";
import type { PitchDetection } from "./session";

export type LibraryDetectors = {
  sampleRate: number;
  detector: Pick<PitchDetector<Float32Array>, "findPitch">;
};

export type PitchFrameOptions = { minRms: number } & (
  | { targetFrequency: number; minClarity: number }
  | { targetFrequency?: undefined }
);

export type PitchFrame = PitchDetection & { rms: number };

const VOICE_RANGE_MIN_CLARITY = 0.93;

export function analyzePitchFrame(
  buffer: Float32Array<ArrayBuffer>,
  detectors: LibraryDetectors,
  options: PitchFrameOptions,
): PitchFrame {
  const rms = getRms(buffer);
  if (rms < options.minRms) return { rms, frequency: null, clarity: null };

  const [frequency, clarity] = detectors.detector.findPitch(
    buffer,
    detectors.sampleRate,
  );
  if (options.targetFrequency === undefined) {
    // Voice range measurement has no target note or octave correction.
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
