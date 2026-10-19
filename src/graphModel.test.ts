import { describe, expect, test } from "bun:test";
import {
  buildGraphPoints,
  clamp,
  createGraphViewport,
  createMelodyGraphLayout,
  getVisibleSamples,
  midiToY,
  resolveCanvasBackingSize,
} from "./graphModel";
import { midiToFrequency } from "./pitchMath";
import { createPitchSample } from "./session";

describe("graph model", () => {
  test("keeps the full melody range and maps each note to its fixed timeline segment", () => {
    const frequencies = [
      261.625565, 293.664768, 329.627557, 349.228231, 391.995436, 440,
      493.883301, 523.251131,
    ];
    const graph = createMelodyGraphLayout(frequencies, 3, 390, 300);
    expect(graph.duration).toBe(24);
    expect(graph.minMidi).toBe(58);
    expect(graph.maxMidi).toBe(74);
    expect(graph.x(0)).toBe(graph.padding.left);
    expect(graph.x(24)).toBe(graph.width - graph.padding.right);
    expect(graph.x(6) - graph.x(3)).toBeCloseTo(graph.plotWidth / 8);
    // Major-scale steps remain unequal; the viewport does not recenter per note.
    expect(graph.y(64) - graph.y(65)).toBeCloseTo(
      (graph.y(60) - graph.y(62)) / 2,
    );
    expect(graph.x(-10)).toBe(graph.x(0));
    expect(graph.x(100)).toBe(graph.x(24));
  });

  test("gives long melodies room to scroll without dropping early notes", () => {
    const notes = Array.from({ length: 32 }, () => 440);
    const graph = createMelodyGraphLayout(notes, 5, 320, 300);
    expect(graph.duration).toBe(160);
    expect(graph.width).toBeGreaterThan(320);
    expect(graph.plotWidth / 32).toBeGreaterThanOrEqual(42);
    expect(graph.y(69)).toBeGreaterThan(graph.padding.top);
  });
  test("creates a viewport centered on the target note", () => {
    const targetFrequency = midiToFrequency(60);
    const viewport = createGraphViewport(
      960,
      360,
      targetFrequency,
      20,
      [],
      12,
      6,
    );

    expect(viewport.plotWidth).toBe(886);
    expect(viewport.zeroY).toBeCloseTo(
      midiToY(60, 54, 66, viewport.padding, viewport.plotHeight),
      8,
    );
    expect(viewport.toleranceTop).toBeLessThan(viewport.zeroY);
    expect(viewport.toleranceBottom).toBeGreaterThan(viewport.zeroY);
    expect(viewport.startTime).toBe(0);
  });

  test("turns samples into graph points and restarts lines after gaps", () => {
    const targetFrequency = midiToFrequency(60);
    const samples = [
      createPitchSample(
        0,
        { frequency: targetFrequency, clarity: 0.9 },
        0.03,
        targetFrequency,
        0,
      ),
      createPitchSample(
        100,
        { frequency: null, clarity: null },
        0.03,
        targetFrequency,
        0,
      ),
      createPitchSample(
        200,
        { frequency: midiToFrequency(61), clarity: 0.9 },
        0.03,
        targetFrequency,
        0,
      ),
    ];
    const viewport = createGraphViewport(
      960,
      360,
      targetFrequency,
      20,
      samples,
      12,
      6,
    );
    const points = buildGraphPoints(samples, viewport, 12);

    expect(points).toHaveLength(2);
    expect(viewport.startTime).toBe(-11_800);
    expect(points[0]?.startsLine).toBe(true);
    expect(points[1]?.startsLine).toBe(true);
    expect(points[1]?.y).toBeLessThan(points[0]?.y ?? Infinity);
    expect(points[1]?.x).toBeCloseTo(
      viewport.padding.left + viewport.plotWidth,
      8,
    );
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
    const samples = [0, 1, 2].map((time) => ({
      ...createPitchSample(
        time,
        { frequency: targetFrequency, clarity: 0.9 },
        0.03,
        targetFrequency,
        null,
      ),
      timeMs: time,
    }));

    expect(
      getVisibleSamples(samples, 2).map((sample) => sample.timeMs),
    ).toEqual([1, 2]);
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(0, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });
});
