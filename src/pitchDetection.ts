import type { PitchDetector } from "pitchy";
import {
  chooseBestLibraryPitch,
  getRms,
  type PitchCandidate,
} from "./pitchMath";
import type { PitchDetection } from "./session";

export type LibraryDetectors = {
  sampleRate: number;
  bufferSize: number;
  detector: PitchDetector<Float32Array>;
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

  const [frequency, clarity] = detectors.detector.findPitch(
    buffer,
    detectors.sampleRate,
  );
  const confidence = clamp(clarity, 0, 1);
  const candidates: PitchCandidate[] =
    frequency > 0 && confidence >= options.minClarity
      ? [
          {
            frequency,
            confidence,
            source: "pitchy",
          },
        ]
      : [];

  const bestCandidate = chooseBestLibraryPitch(
    candidates,
    options.targetFrequency,
  );

  if (!bestCandidate) {
    const fallbackClarity = frequency > 0 ? confidence : null;
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
