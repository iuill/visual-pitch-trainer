import { describe, expect, test } from "bun:test";
import { PitchDetector } from "pitchy";
import { analyzePitchFrame, type LibraryDetectors } from "./pitchDetection";

const TEST_SAMPLE_RATE = 44_100;

function createDetectors(pitch: number, clarity: number): LibraryDetectors {
  return {
    sampleRate: TEST_SAMPLE_RATE,
    detector: {
      findPitch: () => [pitch, clarity],
    },
  };
}

function createSineBuffer(
  frequency: number,
  sampleRate: number,
  length: number,
): Float32Array<ArrayBuffer> {
  const buffer = new Float32Array(length) as Float32Array<ArrayBuffer>;

  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] =
      0.2 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }

  return buffer;
}

describe("pitch detection", () => {
  test("voice range uses a wide range without a practice target and gates noise", () => {
    const buffer = new Float32Array([0.2, -0.2, 0.2, -0.2]);
    for (const hz of [32.71, 98, 196, 440, 1046, 2093]) {
      expect(
        analyzePitchFrame(buffer, createDetectors(hz, 0.99), { minRms: 0.006 })
          .frequency,
      ).toBe(hz);
    }
    for (const [hz, clarity] of [
      [440, 0.6],
      [30, 1],
      [2200, 1],
      [Infinity, 1],
    ]) {
      expect(
        analyzePitchFrame(buffer, createDetectors(hz, clarity), {
          minRms: 0.006,
        }).frequency,
      ).toBe(null);
    }
    expect(
      analyzePitchFrame(new Float32Array(4), createDetectors(440, 1), {
        minRms: 0.006,
      }).frequency,
    ).toBe(null);
  });
  test("voice range detects real low and high sine waves", () => {
    for (const frequency of [32.71, 65.41, 98, 440, 1046.5]) {
      const buffer = createSineBuffer(frequency, TEST_SAMPLE_RATE, 8192);
      const detector = PitchDetector.forFloat32Array(8192);
      const detection = analyzePitchFrame(
        buffer,
        { detector, sampleRate: TEST_SAMPLE_RATE },
        { minRms: 0.006 },
      );
      expect(detection.frequency).not.toBe(null);
      expect(Math.abs((detection.frequency ?? 0) - frequency)).toBeLessThan(1);
    }
  });
  test("skips pitch detection when the buffer is below the RMS gate", () => {
    const detection = analyzePitchFrame(
      new Float32Array([0, 0, 0, 0]) as Float32Array<ArrayBuffer>,
      createDetectors(440, 1),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toEqual({ frequency: null, clarity: null, rms: 0 });
  });

  test("returns the pitchy candidate near the target", () => {
    const detection = analyzePitchFrame(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(440, 0.99),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection.frequency).toBe(440);
    expect(detection.clarity).toBe(0.99);
    expect(detection.rms).toBeCloseTo(0.2);
  });

  test("reports fallback clarity when no candidate can be used", () => {
    const detection = analyzePitchFrame(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(3000, 0.7),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toMatchObject({ frequency: null, clarity: 0.7 });
  });

  test("detects a real sine wave through pitchy", () => {
    const bufferSize = 4096;
    const targetFrequency = 440;
    const detector = PitchDetector.forFloat32Array(bufferSize);
    detector.clarityThreshold = 0.93;

    const detection = analyzePitchFrame(
      createSineBuffer(targetFrequency, TEST_SAMPLE_RATE, bufferSize),
      {
        sampleRate: TEST_SAMPLE_RATE,
        detector,
      },
      { minRms: 0.006, minClarity: 0.52, targetFrequency },
    );

    expect(detection.frequency).toBeCloseTo(targetFrequency, 1);
    expect(detection.clarity).toBeGreaterThan(0.95);
  });
});
