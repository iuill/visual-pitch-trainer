import { describe, expect, test } from "bun:test";
import {
  buildGraphPoints,
  clamp,
  createGraphViewport,
  getVisibleSamples,
  midiToY,
  resolveCanvasBackingSize,
} from "./graphModel";
import { midiToFrequency } from "./pitchMath";
import { createPitchSample } from "./session";

describe("graph model", () => {
  test("creates a viewport centered on the target note", () => {
    const targetFrequency = midiToFrequency(60);
    const viewport = createGraphViewport(960, 360, targetFrequency, 20, [], 12, 12);

    expect(viewport.plotWidth).toBe(886);
    expect(viewport.zeroY).toBeCloseTo(midiToY(60, 48, 72, viewport.padding, viewport.plotHeight), 8);
    expect(viewport.toleranceTop).toBeLessThan(viewport.zeroY);
    expect(viewport.toleranceBottom).toBeGreaterThan(viewport.zeroY);
    expect(viewport.startTime).toBe(0);
  });

  test("turns samples into graph points and restarts lines after gaps", () => {
    const targetFrequency = midiToFrequency(60);
    const samples = [
      createPitchSample(0, { frequency: targetFrequency, clarity: 0.9 }, 0.03, targetFrequency, 0),
      createPitchSample(100, { frequency: null, clarity: null }, 0.03, targetFrequency, 0),
      createPitchSample(
        200,
        { frequency: midiToFrequency(61), clarity: 0.9 },
        0.03,
        targetFrequency,
        0,
      ),
    ];
    const viewport = createGraphViewport(960, 360, targetFrequency, 20, samples, 12, 12);
    const points = buildGraphPoints(samples, viewport, 12);

    expect(points).toHaveLength(2);
    expect(points[0]?.startsLine).toBe(true);
    expect(points[1]?.startsLine).toBe(true);
    expect(points[1]?.y).toBeLessThan(points[0]?.y ?? Infinity);
  });

  test("clamps canvas backing size pixel ratio", () => {
    expect(resolveCanvasBackingSize(300, 100, 4)).toEqual({
      width: 900,
      height: 300,
      pixelRatio: 3,
    });
    expect(resolveCanvasBackingSize(0, 0, 0)).toEqual({
      width: 1,
      height: 1,
      pixelRatio: 1,
    });
  });

  test("returns the most recent visible samples and clamps scalar values", () => {
    const targetFrequency = midiToFrequency(60);
    const samples = [0, 1, 2].map((time) =>
      ({
        ...createPitchSample(time, { frequency: targetFrequency, clarity: 0.9 }, 0.03, targetFrequency, null),
        timeMs: time,
      }),
    );

    expect(getVisibleSamples(samples, 2).map((sample) => sample.timeMs)).toEqual([1, 2]);
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(0, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });
});
