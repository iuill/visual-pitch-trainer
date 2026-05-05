import { describe, expect, test } from "bun:test";
import {
  crepeBinToFrequency,
  decodeCrepeFrame,
  getCrepeModelUrl,
  resampleLinear,
} from "./crepePitchDetection";

describe("CREPE pitch detection helpers", () => {
  test("maps CREPE bins to ascending vocal frequencies", () => {
    expect(crepeBinToFrequency(0)).toBeCloseTo(31.7, 1);
    expect(crepeBinToFrequency(360)).toBeCloseTo(2029, -1);
    expect(crepeBinToFrequency(69)).toBeLessThan(crepeBinToFrequency(70));
  });

  test("decodes a frame with weighted pitch around the strongest bin", () => {
    const probabilities = new Float32Array(360);
    probabilities[100] = 0.2;
    probabilities[101] = 0.8;
    probabilities[102] = 0.4;

    const result = decodeCrepeFrame(probabilities, 0);

    expect(result.confidence).toBeCloseTo(0.8, 6);
    expect(result.frequency).toBeGreaterThan(crepeBinToFrequency(100));
    expect(result.frequency).toBeLessThan(crepeBinToFrequency(102));
  });

  test("resamples audio with linear interpolation", () => {
    const result = resampleLinear(new Float32Array([0, 1, 0]), 3, 6);

    expect([...result]).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  test("resolves bundled model URLs by size", () => {
    expect(getCrepeModelUrl("small")).toBe("/models/crepe-small.onnx");
    expect(getCrepeModelUrl("medium")).toBe("/models/crepe-medium.onnx");
    expect(getCrepeModelUrl("large")).toBe("/models/crepe-large.onnx");
    expect(getCrepeModelUrl("full")).toBe("/models/crepe-full.onnx");
  });
});
