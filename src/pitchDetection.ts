import { chooseBestLibraryPitch, getRms, type PitchCandidate } from "./pitchMath";
import type { PitchDetection } from "./session";

export type LibraryDetectors = {
  sampleRate: number;
  yin: (buffer: Float32Array<ArrayBuffer>) => number | null;
  macleod: (buffer: Float32Array<ArrayBuffer>) => { freq: number; probability: number };
};

export type PitchDetectionOptions = {
  minRms: number;
  minClarity: number;
  targetFrequency: number;
};

export function detectPitchWithLibraries(
  buffer: Float32Array<ArrayBuffer>,
  detectors: LibraryDetectors,
  options: PitchDetectionOptions,
): PitchDetection {
  const rms = getRms(buffer);

  if (rms < options.minRms) {
    return { frequency: null, clarity: null };
  }

  const candidates: PitchCandidate[] = [];
  const yinPitch = detectors.yin(buffer);

  if (yinPitch !== null) {
    candidates.push({
      frequency: yinPitch,
      confidence: 0.86,
      source: "yin",
    });
  }

  const macleodPitch = detectors.macleod(buffer);

  if (macleodPitch.freq > 0 && macleodPitch.probability >= options.minClarity) {
    candidates.push({
      frequency: macleodPitch.freq,
      confidence: clamp(macleodPitch.probability, 0, 1),
      source: "macleod",
    });
  }

  const bestCandidate = chooseBestLibraryPitch(candidates, options.targetFrequency);

  if (!bestCandidate) {
    const fallbackClarity =
      macleodPitch.freq > 0 ? clamp(macleodPitch.probability, 0, 1) : null;
    return { frequency: null, clarity: fallbackClarity };
  }

  return {
    frequency: bestCandidate.frequency,
    clarity: bestCandidate.confidence,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
