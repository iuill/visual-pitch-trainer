import { describe, expect, test } from "bun:test";
import {
  buildMelody,
  getMelodyPosition,
  recordMelodyObservation,
} from "./melodyPractice";

describe("melody practice", () => {
  test("keeps major-scale intervals and transposes every note with the selected range", () => {
    expect(buildMelody("major", "", 48).map((note) => note.name)).toEqual([
      "C3",
      "D3",
      "E3",
      "F3",
      "G3",
      "A3",
      "B3",
      "C4",
    ]);
    expect(buildMelody("triad", "", 60).map((note) => note.name)).toEqual([
      "C4",
      "E4",
      "G4",
      "E4",
      "C4",
    ]);
    expect(buildMelody("chromatic", "", 72)).toHaveLength(13);
  });
  test("accepts repeated notes, sharps and the upper do without silently skipping invalid notes", () => {
    expect(
      buildMelody("custom", "ド ド、ファ♯ ソ＃ 高ド", 48).map(
        (note) => note.name,
      ),
    ).toEqual(["C3", "C3", "F#3", "G#3", "C4"]);
    for (const input of ["", "ド", "ド 不明", Array(33).fill("ド").join(" ")]) {
      expect(() => buildMelody("custom", input, 48)).toThrow();
    }
  });
  test("moves through demonstration, three-second countdown, singing and completion at exact audio boundaries", () => {
    expect(getMelodyPosition(0, 2, 3)).toMatchObject({
      phase: "listen",
      index: 0,
      remaining: 2,
    });
    expect(getMelodyPosition(2, 2, 3)).toMatchObject({
      phase: "listen",
      index: 1,
    });
    expect(getMelodyPosition(4, 2, 3)).toMatchObject({
      phase: "countdown",
      remaining: 3,
    });
    expect(getMelodyPosition(7, 2, 3)).toMatchObject({
      phase: "sing",
      index: 0,
    });
    expect(getMelodyPosition(10, 2, 3)).toMatchObject({
      phase: "sing",
      index: 1,
    });
    expect(getMelodyPosition(13, 2, 3).phase).toBe("finished");
    expect(getMelodyPosition(100, 2, 3).phase).toBe("finished");
  });
  test("keeps demonstration at two seconds when singing duration changes", () => {
    for (const seconds of [1, 5]) {
      expect(getMelodyPosition(3.9, 2, seconds)).toMatchObject({
        phase: "listen",
        index: 1,
      });
      expect(getMelodyPosition(4, 2, seconds)).toMatchObject({
        phase: "countdown",
        remaining: 3,
      });
      expect(getMelodyPosition(6, 2, seconds)).toMatchObject({
        phase: "countdown",
        remaining: 1,
      });
      expect(getMelodyPosition(7, 2, seconds)).toMatchObject({
        phase: "sing",
        index: 0,
        remaining: seconds,
      });
      expect(getMelodyPosition(7 + seconds, 2, seconds)).toMatchObject({
        phase: "sing",
        index: 1,
      });
      expect(getMelodyPosition(7 + 2 * seconds, 2, seconds).phase).toBe(
        "finished",
      );
    }
  });
  test("excludes transition grace, silence, out-of-tune input, cross-note intervals and background gaps", () => {
    const results = [
      { detectedMs: 0, inTuneMs: 0 },
      { detectedMs: 0, inTuneMs: 0 },
    ];
    const record = (a: number, b: number, cents: number | null = 0) =>
      recordMelodyObservation(
        results,
        { index: 0, elapsed: a, cents },
        { index: 0, elapsed: b, cents },
        3,
        30,
      );
    record(0.1, 0.2);
    expect(results[0].inTuneMs).toBe(0);
    record(0.35, 0.45);
    expect(results[0].inTuneMs).toBeCloseTo(50);
    record(0.5, 0.6, null);
    record(0.7, 0.8, 60);
    record(1, 2);
    recordMelodyObservation(
      results,
      { index: 0, elapsed: 2.95, cents: 0 },
      { index: 1, elapsed: 3.05, cents: 0 },
      3,
      30,
    );
    expect(results[0].inTuneMs).toBeCloseTo(50);
    expect(results[0].detectedMs).toBeCloseTo(150);
    expect(results[1].inTuneMs).toBe(0);
  });
});
