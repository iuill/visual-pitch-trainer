import { describe, expect, test } from "bun:test";
import {
  buildGraphPoints,
  clamp,
  createGraphViewport,
  createMelodyGraphLayout,
  createPianoKeyboardLayout,
  getVisibleSamples,
  midiToY,
  resolveCanvasBackingSize,
} from "./graphModel";
import { midiToFrequency } from "./pitchMath";
import { createPitchSample } from "./session";

describe("graph model", () => {
  test("lays out all 88 piano keys from A0 to C8 with 52 white and 36 black keys", () => {
    const layout = createPianoKeyboardLayout();
    expect(layout.whiteCount).toBe(52);
    expect(layout.keys).toHaveLength(88);
    expect(layout.keys[0]).toMatchObject({ midi: 21, black: false, left: 0 });
    expect(layout.keys.at(-1)).toMatchObject({ midi: 108, black: false });
    expect(layout.keys.filter((key) => key.black)).toHaveLength(36);
    const last = layout.keys[layout.keys.length - 1];
    expect(last.left + last.width).toBeCloseTo(100);
    for (const key of layout.keys) {
      expect(key.left).toBeGreaterThanOrEqual(0);
      expect(key.left + key.width).toBeLessThanOrEqual(100);
    }
  });

  test("places piano black keys between white neighbors without adding keys at E–F or B–C", () => {
    const layout = createPianoKeyboardLayout();
    const c = layout.keys[60 - 21];
    const cSharp = layout.keys[61 - 21];
    expect(cSharp.black).toBe(true);
    expect(cSharp.left + cSharp.width / 2).toBeCloseTo(c.left + c.width);
    expect(
      layout.keys
        .filter((key) => key.midi >= 60 && key.midi <= 72 && key.black)
        .map((key) => key.midi),
    ).toEqual([61, 63, 66, 68, 70]);
    expect(layout.keys[65 - 21].left - layout.keys[64 - 21].left).toBeCloseTo(
      100 / 52,
    );
    expect(layout.keys[72 - 21].left - layout.keys[71 - 21].left).toBeCloseTo(
      100 / 52,
    );
  });
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
