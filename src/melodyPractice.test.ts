import { describe, expect, test } from "bun:test";
import {
  buildMelody,
  getMelodyAssessedSeconds,
  getMelodyPosition,
  MELODY_PATTERNS,
  pickToneScalePattern,
  recordMelodyObservation,
} from "./melodyPractice";
import { midiToFrequency } from "./pitchMath";

describe("melody practice", () => {
  test("loops tone scales without repeating the turn or the starting note", () => {
    expect(MELODY_PATTERNS[0].id).toBe("two-tone");
    expect(buildMelody("two-tone", "", 48).map((note) => note.name)).toEqual([
      "C3",
      "D3",
    ]);
    expect(buildMelody("three-tone", "", 48).map((note) => note.name)).toEqual([
      "C3",
      "D3",
      "E3",
      "D3",
    ]);
    expect(buildMelody("five-tone", "", 48).map((note) => note.name)).toEqual([
      "C3",
      "D3",
      "E3",
      "F3",
      "G3",
      "F3",
      "E3",
      "D3",
    ]);
    expect(buildMelody("two-tone", "", 60, 1).map((note) => note.name)).toEqual(
      ["D4", "E4"],
    );
    expect(
      buildMelody("three-tone", "", 60, 1).map((note) => note.name),
    ).toEqual(["D4", "E4", "F4", "E4"]);
    expect(
      buildMelody("five-tone", "", 60, 3).map((note) => note.name),
    ).toEqual(["F4", "G4", "A4", "B4", "C5", "B4", "A4", "G4"]);
  });
  test("changes the two-tone interval so it can skip notes or go down", () => {
    const skip = pickToneScalePattern(2, 3, undefined, () => 0);
    expect(skip).toEqual({ startDegree: 0, offsets: [0, 2] });
    const down = pickToneScalePattern(2, 3, skip.offsets, () => 0.999);
    expect(down).toEqual({ startDegree: 7, offsets: [0, -1] });
    expect(
      buildMelody("two-tone", "", 60, down.startDegree, down.offsets).map(
        (note) => note.name,
      ),
    ).toEqual(["C5", "B4"]);
    expect(pickToneScalePattern(2, 1, down.offsets, () => 0).offsets).toEqual([
      0, 1,
    ]);
  });
  test("keeps random patterns and their return path in range when moving the start", () => {
    for (const [id, tones] of [
      ["three-tone", 3],
      ["five-tone", 5],
    ] as const) {
      for (const maxSteps of [1, 2, 3]) {
        const { offsets } = pickToneScalePattern(
          tones,
          maxSteps,
          undefined,
          () => 0.6,
        );
        expect(new Set(offsets).size).toBe(tones);
        for (let index = 1; index < offsets.length; index++) {
          expect(
            Math.abs(offsets[index] - offsets[index - 1]),
          ).toBeLessThanOrEqual(maxSteps);
        }
        for (const start of [0, 7]) {
          const notes = buildMelody(id, "", 60, start, offsets).map(
            (note) => note.frequency,
          );
          expect(notes).toHaveLength(2 * tones - 2);
          expect(notes.slice(tones)).toEqual(
            notes.slice(1, tones - 1).reverse(),
          );
          expect(Math.min(...notes)).toBeGreaterThanOrEqual(
            midiToFrequency(60),
          );
          expect(Math.max(...notes)).toBeLessThanOrEqual(midiToFrequency(72));
        }
      }
    }
  });
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
  test("counts down once then loops on exact audio boundaries", () => {
    expect(getMelodyPosition(0, 2, 3)).toMatchObject({
      phase: "countdown",
      remaining: 3,
    });
    expect(getMelodyPosition(2, 2, 3)).toMatchObject({
      phase: "countdown",
      remaining: 1,
    });
    expect(getMelodyPosition(3, 2, 3)).toMatchObject({
      phase: "sing",
      lap: 0,
      index: 0,
      remaining: 3,
    });
    expect(getMelodyPosition(6, 2, 3)).toMatchObject({
      phase: "sing",
      index: 1,
    });
    expect(getMelodyPosition(9, 2, 3)).toMatchObject({
      phase: "sing",
      lap: 1,
      index: 0,
      elapsedInLap: 0,
    });
    expect(getMelodyPosition(6003, 2, 3)).toMatchObject({
      phase: "sing",
      lap: 1000,
      index: 0,
    });
  });
  test("uses the selected duration on every lap without another countdown", () => {
    for (const seconds of [0.5, 1, 5]) {
      expect(getMelodyPosition(0, 2, seconds)).toMatchObject({
        phase: "countdown",
        remaining: 3,
      });
      expect(getMelodyPosition(2, 2, seconds)).toMatchObject({
        phase: "countdown",
        remaining: 1,
      });
      expect(getMelodyPosition(3, 2, seconds)).toMatchObject({
        phase: "sing",
        index: 0,
        remaining: seconds,
      });
      expect(getMelodyPosition(3 + seconds, 2, seconds)).toMatchObject({
        phase: "sing",
        index: 1,
      });
      expect(getMelodyPosition(3 + 2 * seconds, 2, seconds)).toMatchObject({
        phase: "sing",
        lap: 1,
        index: 0,
        remaining: seconds,
      });
    }
  });
  test("assesses all laps and only the practiced part of the final note", () => {
    expect(getMelodyAssessedSeconds(2, 2, 3, 0)).toBe(0);
    expect(getMelodyAssessedSeconds(3.2, 2, 3, 0)).toBe(0);
    expect(getMelodyAssessedSeconds(4, 2, 3, 0)).toBeCloseTo(0.6);
    expect(getMelodyAssessedSeconds(4, 2, 3, 1)).toBe(0);
    expect(getMelodyAssessedSeconds(9, 2, 3, 0)).toBeCloseTo(2.6);
    expect(getMelodyAssessedSeconds(10, 2, 3, 0)).toBeCloseTo(3.2);
    expect(getMelodyAssessedSeconds(10, 2, 3, 1)).toBeCloseTo(3);
    expect(getMelodyAssessedSeconds(4, 2, 0.5, 0)).toBeCloseTo(0.1);
    expect(getMelodyAssessedSeconds(4, 2, 0.5, 1)).toBeCloseTo(0.5);
    expect(getMelodyAssessedSeconds(3.65, 2, 0.5, 1)).toBeCloseTo(0.15);
    expect(getMelodyAssessedSeconds(4.2, 2, 0.5, 0)).toBeCloseTo(0.1);
    expect(getMelodyAssessedSeconds(4.2, 2, 0.5, 1)).toBeCloseTo(0.5);
  });
  test("assesses only the laps in a section after a starting-note change", () => {
    const firstLap = 2;
    expect(getMelodyAssessedSeconds(7.4, 2, 1, 0, firstLap)).toBeCloseTo(0);
    expect(getMelodyAssessedSeconds(8.25, 2, 1, 0, firstLap)).toBeCloseTo(0.6);
    expect(getMelodyAssessedSeconds(8.25, 2, 1, 1, firstLap)).toBeCloseTo(0.25);
    expect(getMelodyAssessedSeconds(11, 2, 1, 0, firstLap)).toBeCloseTo(1.2);
  });

  test("scores the second note immediately while excluding grace at the start of each lap", () => {
    const results = [
      { detectedMs: 0, inTuneMs: 0 },
      { detectedMs: 0, inTuneMs: 0 },
    ];
    for (let lap = 0; lap < 2; lap++) {
      recordMelodyObservation(
        results,
        { index: 0, elapsed: 0.1, cents: 0 },
        { index: 0, elapsed: 0.2, cents: 0 },
        0.5,
        30,
      );
      recordMelodyObservation(
        results,
        { index: 1, elapsed: 0.55, cents: 0 },
        { index: 1, elapsed: 0.65, cents: 0 },
        0.5,
        30,
      );
    }
    expect(results[0].inTuneMs).toBe(0);
    expect(results[1].inTuneMs).toBeCloseTo(200);
    expect(results[1].detectedMs).toBeCloseTo(200);
  });
  test("excludes lap-start grace, silence, out-of-tune input, cross-note intervals and background gaps", () => {
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
