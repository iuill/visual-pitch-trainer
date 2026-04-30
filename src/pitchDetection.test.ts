import { describe, expect, test } from "bun:test";
import {
  detectPitchWithLibraries,
  type LibraryDetectors,
} from "./pitchDetection";

function createDetectors(
  yinPitch: number | null,
  macleodPitch: { freq: number; probability: number },
): LibraryDetectors {
  return {
    sampleRate: 44_100,
    yin: () => yinPitch,
    macleod: () => macleodPitch,
  };
}

describe("pitch detection", () => {
  test("skips pitch detection when the buffer is below the RMS gate", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0, 0, 0, 0]) as Float32Array<ArrayBuffer>,
      createDetectors(440, { freq: 440, probability: 1 }),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toEqual({ frequency: null, clarity: null });
  });

  test("returns the best library candidate near the target", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(440, { freq: 880, probability: 0.99 }),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection.frequency).toBe(440);
    expect(detection.clarity).toBe(0.86);
  });

  test("reports fallback clarity when no candidate can be used", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(null, { freq: 3000, probability: 0.7 }),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toEqual({ frequency: null, clarity: 0.7 });
  });
});
