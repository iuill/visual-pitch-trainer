import { describe, expect, test } from "bun:test";
import { PitchDetector } from "pitchy";
import {
  detectPitchWithLibraries,
  type LibraryDetectors,
} from "./pitchDetection";

const TEST_SAMPLE_RATE = 44_100;

function createDetectors(pitch: number, clarity: number): LibraryDetectors {
  return {
    sampleRate: TEST_SAMPLE_RATE,
    bufferSize: 4,
    detector: {
      findPitch: () => [pitch, clarity],
    } as unknown as LibraryDetectors["detector"],
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
  test("skips pitch detection when the buffer is below the RMS gate", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0, 0, 0, 0]) as Float32Array<ArrayBuffer>,
      createDetectors(440, 1),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toEqual({ frequency: null, clarity: null });
  });

  test("returns the pitchy candidate near the target", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(440, 0.99),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection.frequency).toBe(440);
    expect(detection.clarity).toBe(0.99);
  });

  test("reports fallback clarity when no candidate can be used", () => {
    const detection = detectPitchWithLibraries(
      new Float32Array([0.2, -0.2, 0.2, -0.2]) as Float32Array<ArrayBuffer>,
      createDetectors(3000, 0.7),
      { minRms: 0.006, minClarity: 0.52, targetFrequency: 440 },
    );

    expect(detection).toEqual({ frequency: null, clarity: 0.7 });
  });

  test("detects a real sine wave through pitchy", () => {
    const bufferSize = 4096;
    const targetFrequency = 440;
    const detector = PitchDetector.forFloat32Array(bufferSize);
    detector.clarityThreshold = 0.93;
    detector.minVolumeAbsolute = 0.006;

    const detection = detectPitchWithLibraries(
      createSineBuffer(targetFrequency, TEST_SAMPLE_RATE, bufferSize),
      {
        sampleRate: TEST_SAMPLE_RATE,
        bufferSize,
        detector,
      },
      { minRms: 0.006, minClarity: 0.52, targetFrequency },
    );

    expect(detection.frequency).toBeCloseTo(targetFrequency, 1);
    expect(detection.clarity).toBeGreaterThan(0.95);
  });
});
