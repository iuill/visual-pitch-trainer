import { describe, expect, test } from "bun:test";
import { isGeneratedInstrument } from "./generatedInstruments";
import {
  buildSongEvents,
  songDrumsForEvents,
  songSampleInstruments,
} from "./rhythmArrangement";
import {
  CALIBRATION_TAPS,
  calibrationTapIndex,
  measureRhythmOffset,
  rhythmEventTimeMs,
} from "./rhythmCalibration";
import {
  createRhythmBars,
  getRhythmNoteValue,
  RHYTHM_NOTE_BEATS,
  RHYTHM_STEPS,
  rhythmBeatAccent,
  rhythmPulseUnits,
  rhythmSlotsPerBeat,
} from "./rhythmCourse";
import {
  collectOmittedRhythmNotes,
  createRhythmTargets,
  judgeRhythmTap,
  type RhythmHit,
  summarizeRhythm,
} from "./rhythmJudge";
import {
  createRhythmProgressStore,
  newRhythmProgress,
  recordRhythmAttempt,
  rhythmStepUnlocked,
} from "./rhythmProgressStore";

describe("rhythm course", () => {
  test("uses 32 ordered steps, in 5 chapters", () => {
    expect(RHYTHM_STEPS.map((step) => step.bpm)).toEqual([
      60, 60, 60, 60, 60, 60, 70, 70, 80, 90, 100, 110, 60, 60, 80, 100, 76,
      100, 80, 76, 72, 88, 92, 96, 52, 60, 52, 72, 116, 144, 128, 180,
    ]);
    expect(new Set(RHYTHM_STEPS.map((step) => step.id)).size).toBe(32);
    for (const step of RHYTHM_STEPS) {
      expect(step.requiredStreak).toBe(step.chapter === 5 ? 1 : 2);
      const bars = createRhythmBars(step, () => 0);
      const slotsPerBeat = rhythmSlotsPerBeat(step);
      if (step.melody) {
        expect(bars.length).toBeGreaterThanOrEqual(8);
        expect(step.melody).toHaveLength(bars.length);
        expect(bars).toEqual([...step.patterns]);
      } else expect(bars).toHaveLength(4);
      for (const [index, bar] of bars.entries()) {
        expect(bar).toMatch(/^[wjhdxtfezrs-]+$/);
        expect(bar).toHaveLength((step.beatsPerBar ?? 4) * slotsPerBeat);
        for (const [slot, symbol] of Array.from(bar).entries()) {
          const value = getRhythmNoteValue(symbol);
          if (value) {
            const duration =
              RHYTHM_NOTE_BEATS[value] * slotsPerBeat * rhythmPulseUnits(step);
            expect(slot + duration).toBeLessThanOrEqual(bar.length);
            expect(bar.slice(slot + 1, slot + duration)).toBe(
              "-".repeat(duration - 1),
            );
          }
          if (symbol === "r") {
            expect(slot % slotsPerBeat).toBe(0);
            expect(bar.slice(slot + 1, slot + slotsPerBeat)).toBe(
              "-".repeat(slotsPerBeat - 1),
            );
          }
        }
        expect(step.patterns).toContain(bar);
        if (step.mixed && index > 0) expect(bar).not.toBe(bars[index - 1]);
        if (step.melody)
          expect(
            createRhythmTargets([bar], step.bpm, 0, slotsPerBeat),
          ).toHaveLength(step.melody[index].length);
      }
    }
  });

  test("partitions the original songs into sections with complete rhythm and harmony data", () => {
    const originals = RHYTHM_STEPS.filter((step) => step.chapter === 5);
    expect(originals).toHaveLength(5);
    for (const step of originals) {
      const beats = step.beatsPerBar ?? 4;
      const seconds = (step.patterns.length * beats * 60) / step.bpm;
      expect(seconds).toBeGreaterThanOrEqual(180);
      expect(seconds).toBeLessThanOrEqual(240);
      expect(step.arrangement).toHaveLength(step.patterns.length);
      expect(step.arrangement?.filter((bar) => bar.ending)).toHaveLength(1);
      expect(step.arrangement?.at(-1)?.ending).toBe(true);
      let end = 0;
      for (const section of step.sections ?? []) {
        expect(section.startBar).toBe(end);
        expect(section.endBar).toBeGreaterThan(section.startBar);
        end = section.endBar;
      }
      expect(end).toBe(step.patterns.length);
    }
    const odd = originals[2];
    expect(
      Array.from({ length: 7 }, (_, pulse) => rhythmBeatAccent(odd, pulse)),
    ).toEqual([true, false, true, false, true, false, false]);
    expect(
      createRhythmTargets(
        odd.patterns.slice(0, 2),
        odd.bpm,
        0,
        rhythmSlotsPerBeat(odd),
      )
        .slice(0, 4)
        .map(({ timeMs }) => Math.round(timeMs)),
    ).toEqual([0, 833, 1667, 2917]);
  });

  test("keeps the score aligned across instruments and adds only kick cues in practice", () => {
    for (const step of RHYTHM_STEPS.filter((item) => item.arrangement)) {
      const startMs = 3000;
      const pulseMs = 60_000 / step.bpm;
      const fullLength = step.patterns.length;
      const barMs = (step.beatsPerBar ?? 4) * pulseMs;
      const events = buildSongEvents(step, 0, fullLength, startMs, false);
      const samples = songSampleInstruments(events);
      for (const event of events) {
        if ("drum" in event) continue;
        expect(event.seconds).toBeGreaterThan(0);
        if (!isGeneratedInstrument(event.instrument))
          expect(samples).toContain(event.instrument);
      }
      if (step.id === "5-4")
        expect(new Set(songDrumsForEvents(events))).toEqual(
          new Set([
            "kick",
            "snare",
            "hi-hat",
            "high-tom",
            "low-tom",
            "crash",
            "ride",
          ]),
        );
      for (const section of step.sections ?? []) {
        const from = section.startBar;
        const to = section.endBar;
        const score = step.patterns.slice(from, to);
        const targets = createRhythmTargets(
          score,
          step.bpm,
          startMs,
          rhythmSlotsPerBeat(step),
        );
        const sectionEvents = buildSongEvents(step, from, to, startMs, false);
        const practice = buildSongEvents(step, from, to, startMs, true);
        expect(
          practice.filter(
            (event) => !("drum" in event) || event.drum !== "kick",
          ),
        ).toEqual(
          sectionEvents.filter(
            (event) => !("drum" in event) || event.drum !== "kick",
          ),
        );
        const pitches = step.melody?.slice(from, to).flat() ?? [];
        expect(pitches).toHaveLength(targets.length);
        for (const [index, target] of targets.entries()) {
          const bar = Math.floor((target.timeMs - startMs + 0.001) / barMs);
          expect(
            sectionEvents.some(
              (event) =>
                "instrument" in event &&
                event.instrument === step.arrangement?.[from + bar].part.lead &&
                event.midi === pitches[index] &&
                Math.abs(event.timeMs - target.timeMs) < 0.001,
            ),
          ).toBe(true);
        }
        for (const event of sectionEvents) {
          expect(event.timeMs).toBeGreaterThanOrEqual(startMs);
          expect(
            event.timeMs + ("seconds" in event ? event.seconds * 1000 : 0),
          ).toBeLessThanOrEqual(startMs + (to - from) * barMs + 0.001);
        }
      }
    }
  });

  test("places the 7/8 accompaniment on the starts of the 2+2+3 groups", () => {
    const step = RHYTHM_STEPS.find(({ id }) => id === "5-3");
    if (!step) throw new Error("Missing 7/8 song");
    const events = buildSongEvents(step, 0, 1, 0, false);
    const accompaniment = events.filter(
      (event) =>
        "instrument" in event &&
        event.instrument === "piano" &&
        event.level < 0.5,
    );
    expect(accompaniment.map(({ timeMs }) => Math.round(timeMs))).toEqual([
      0, 833, 1667,
    ]);
  });

  test("records guitar bends at the solo's tap times", () => {
    const step = RHYTHM_STEPS.find(({ id }) => id === "5-5");
    const solo = step?.sections?.find(({ title }) => title === "ギターソロ");
    if (!step || !solo) throw new Error("Missing symphonic rock solo");
    const events = buildSongEvents(step, solo.startBar, solo.endBar, 0, false);
    const bends = events
      .filter((event) => "instrument" in event)
      .filter((event) => event.bendSemitones !== undefined);
    const targets = createRhythmTargets(
      step.patterns.slice(solo.startBar, solo.endBar),
      step.bpm,
      0,
      rhythmSlotsPerBeat(step),
    );
    expect(bends).toHaveLength(16);
    expect(new Set(bends.map(({ bendSemitones }) => bendSemitones))).toEqual(
      new Set([1, 2]),
    );
    for (const bend of bends) {
      expect(bend.instrument).toBe("electric-guitar");
      expect(
        targets.some(({ timeMs }) => Math.abs(timeMs - bend.timeMs) < 0.001),
      ).toBe(true);
    }
  });

  test("times triplets and the habanera rhythm at their actual fractions of a beat", () => {
    expect(
      createRhythmTargets(["tttttt", "tttttt"], 60, 0, 3).map((target) =>
        Math.round(target.timeMs),
      ),
    ).toEqual([
      0, 333, 667, 1000, 1333, 1667, 2000, 2333, 2667, 3000, 3333, 3667,
    ]);
    expect(
      createRhythmTargets(["f--ze-e-", "f--ze-e-"], 60, 0, 4).map(
        (target) => target.timeMs,
      ),
    ).toEqual([0, 750, 1000, 1500, 2000, 2750, 3000, 3500]);
  });

  test("keeps the song's pitches, offbeat and rest aligned in 3/4", () => {
    const step = RHYTHM_STEPS[18];
    const bars = createRhythmBars(step);
    expect(
      createRhythmTargets(bars.slice(0, 4), step.bpm, 1000).map(
        ({ timeMs }) => timeMs,
      ),
    ).toEqual([1000, 1750, 2500, 3250, 4375, 4750, 5500, 6250, 7000, 7750]);
  });

  test("keeps the 2/4 opening rest and starts the long note on the next downbeat", () => {
    const targets = createRhythmTargets(
      ["seee", "h---", "seee", "h---"],
      60,
      0,
    );
    expect(targets.map(({ timeMs }) => timeMs)).toEqual([
      500, 1000, 1500, 2000, 4500, 5000, 5500, 6000,
    ]);
    expect(targets.filter((target) => target.downbeat)).toHaveLength(2);
  });

  test("shows eighth rests at the untapped beats in the offbeat chapter", () => {
    const patterns = new Set(
      RHYTHM_STEPS.filter((step) => step.chapter === 3).flatMap(
        (step) => step.patterns,
      ),
    );
    expect([...patterns]).toEqual(["sesesese", "x-x-sese", "sesex-x-"]);
    expect(
      createRhythmTargets(["sesesese"], 60, 0).map((target) => target.timeMs),
    ).toEqual([500, 1500, 2500, 3500]);
  });

  test("maps eighth slots and bar boundaries to the common time axis", () => {
    expect(
      createRhythmTargets(["-e---e--", "w-------", "h---x-x-"], 60, 1000),
    ).toEqual([
      { timeMs: 1500, downbeat: false, noteValue: "eighth" },
      { timeMs: 3500, downbeat: false, noteValue: "eighth" },
      { timeMs: 5000, downbeat: true, noteValue: "whole" },
      { timeMs: 9000, downbeat: true, noteValue: "half" },
      { timeMs: 11000, downbeat: false, noteValue: "quarter" },
      { timeMs: 12000, downbeat: false, noteValue: "quarter" },
    ]);
  });

  test("quarter rests leave time for the beat but never become tap targets", () => {
    const targets = createRhythmTargets(["x-x-r-x-"], 60, 1000);
    expect(targets.map((target) => target.timeMs)).toEqual([1000, 2000, 4000]);
    expect(judgeRhythmTap(targets, 3000).reason).toBe("extra");
  });
});

describe("rhythm judging", () => {
  test("includes the exact boundaries and claims a note only once", () => {
    for (const [offset, grade] of [
      [40, "perfect"],
      [-40, "perfect"],
      [40.01, "close"],
      [-80, "close"],
      [80.01, "miss"],
      [-150, "miss"],
    ] as const) {
      const targets = [{ timeMs: 1000 }];
      expect(judgeRhythmTap(targets, 1000 + offset).grade).toBe(grade);
      expect(judgeRhythmTap(targets, 1000)).toEqual({
        grade: "miss",
        reason: "extra",
        offsetMs: null,
      });
    }
    expect(judgeRhythmTap([{ timeMs: 1000 }], 1150.01).reason).toBe("extra");
  });

  test("picks the closer note when the match windows overlap and expires only after 150ms", () => {
    const targets = [{ timeMs: 1000 }, { timeMs: 1273 }];
    expect(judgeRhythmTap(targets, 1140).offsetMs).toBe(-133);
    expect(collectOmittedRhythmNotes(targets, 1150)).toEqual([]);
    expect(collectOmittedRhythmNotes(targets, 1150.01)).toEqual([
      { grade: "miss", reason: "omitted", offsetMs: null },
    ]);
    expect(collectOmittedRhythmNotes(targets, 2000)).toEqual([]);
  });

  test("counts extra inputs and omitted notes in the result, but only matched taps in the mean", () => {
    const hits: RhythmHit[] = [
      ...Array.from(
        { length: 6 },
        (): RhythmHit => ({ grade: "perfect", offsetMs: -20 }),
      ),
      { grade: "close", offsetMs: 50 },
      { grade: "close", offsetMs: -50 },
      { grade: "close", offsetMs: 70 },
      { grade: "miss", reason: "extra", offsetMs: null },
    ];
    expect(summarizeRhythm(hits, 2)).toEqual({
      counts: { perfect: 6, close: 3, miss: 1 },
      perfectRate: 0.6,
      missRate: 0.1,
      onBeatRate: 0.9,
      passed: true,
      histogram: [0, 1, 6, 2, 0],
      meanOffsetMs: -50 / 9,
    });
    expect(summarizeRhythm(hits, 1).passed).toBe(true);
    hits[8] = { grade: "miss", reason: "omitted", offsetMs: null };
    expect(summarizeRhythm(hits, 2).passed).toBe(false);
  });

  test("accepts 85% in chapter one and counts both misses and extra taps against that rate", () => {
    const hits: RhythmHit[] = [
      ...Array.from(
        { length: 17 },
        (): RhythmHit => ({ grade: "close", offsetMs: 60 }),
      ),
      { grade: "miss", reason: "omitted", offsetMs: null },
      { grade: "miss", reason: "omitted", offsetMs: null },
      { grade: "miss", reason: "extra", offsetMs: null },
    ];
    expect(summarizeRhythm(hits, 1)).toMatchObject({
      onBeatRate: 0.85,
      passed: true,
    });
    hits.push({ grade: "miss", reason: "extra", offsetMs: null });
    expect(summarizeRhythm(hits, 1).passed).toBe(false);
  });

  test("applies the same advanced miss rate to short and long phrases", () => {
    const perfect: RhythmHit = { grade: "perfect", offsetMs: 0 };
    const miss: RhythmHit = {
      grade: "miss",
      offsetMs: null,
      reason: "omitted",
    };
    for (const length of [20, 40, 96]) {
      const allowed = Math.floor(length * 0.1);
      const hits = Array.from({ length }, (_, index) =>
        index < allowed ? miss : perfect,
      );
      expect(summarizeRhythm(hits, 4).passed).toBe(true);
      hits[allowed] = miss;
      expect(summarizeRhythm(hits, 4).passed).toBe(false);
    }
    expect(summarizeRhythm([], 4).passed).toBe(false);
  });
});

describe("rhythm calibration", () => {
  test("uses the median of the eight measured taps and rejects misses or excessive spread", () => {
    const offsets = [10, 10, 20, 20, 30, 30, 40, 100];
    expect(measureRhythmOffset(offsets)).toBe(25);
    offsets[7] = 300;
    expect(measureRhythmOffset(offsets)).toBeNull();
    expect(measureRhythmOffset(Array(CALIBRATION_TAPS).fill(null))).toBeNull();
  });

  test("assigns a calibration tap to the nearest flash", () => {
    expect(calibrationTapIndex(374, 750)).toBe(-1);
    expect(calibrationTapIndex(375, 750)).toBe(0);
    expect(calibrationTapIndex(749, 750)).toBe(0);
    expect(calibrationTapIndex(750, 750)).toBe(0);
    expect(calibrationTapIndex(750 + 374, 750)).toBe(0);
    expect(calibrationTapIndex(750 + 375, 750)).toBe(1);
    expect(calibrationTapIndex(750 + (CALIBRATION_TAPS - 1) * 750, 750)).toBe(
      CALIBRATION_TAPS - 1,
    );
    expect(calibrationTapIndex(750 + CALIBRATION_TAPS * 750 - 376, 750)).toBe(
      CALIBRATION_TAPS - 1,
    );
    expect(calibrationTapIndex(750 + CALIBRATION_TAPS * 750 - 375, 750)).toBe(
      -1,
    );
  });

  test("converts audio-guide taps with the output clock and falls back to latency", () => {
    const context = { currentTime: 4, baseLatency: 0.02, outputLatency: 0.05 };
    const output = {
      ...context,
      getOutputTimestamp: () => ({ contextTime: 3.87, performanceTime: 990 }),
    };
    expect(rhythmEventTimeMs(output, 1000, "audio", 1012)).toBe(3880);
    expect(rhythmEventTimeMs(output, 1000, "visual", 1012)).toBe(3988);
    expect(rhythmEventTimeMs(context, 1000, "audio", 1012)).toBe(3938);
    expect(
      rhythmEventTimeMs(
        {
          ...context,
          getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
        },
        1000,
        "audio",
        1012,
      ),
    ).toBe(3938);
    expect(
      rhythmEventTimeMs(
        { currentTime: 4, baseLatency: 0.02 },
        1000,
        "audio",
        1012,
      ),
    ).toBe(3968);
  });
});

describe("rhythm progress", () => {
  test("only unlocks after consecutive passes and preserves earlier clears and the best rate", () => {
    const progress = newRhythmProgress();
    const [first, second] = RHYTHM_STEPS;
    const now = new Date().toISOString();
    const pass = () =>
      recordRhythmAttempt(
        progress,
        first,
        { passed: true, perfectRate: 0.8 },
        now,
      );
    const fail = () =>
      recordRhythmAttempt(
        progress,
        first,
        { passed: false, perfectRate: 0.5 },
        now,
      );
    expect(pass().streak).toBe(1);
    expect(rhythmStepUnlocked(progress, second)).toBe(false);
    expect(fail().streak).toBe(0);
    expect(pass().cleared).toBe(false);
    expect(pass().cleared).toBe(true);
    expect(fail()).toEqual({
      lastPlayedAt: now,
      attempts: 5,
      cleared: true,
      bestPerfectRate: 0.8,
      streak: 0,
    });
    expect(rhythmStepUnlocked(progress, second)).toBe(true);
  });

  test("restores old streaks and out-of-order progress, uses defaults, and reports storage failure once", () => {
    const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    let data = "{";
    let blocked = false;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string) {
          if (blocked) throw new Error("blocked");
          if (key === "rhythm-course:v1:progress")
            return '{"version":1,"currentStepId":"4-3"}';
          return data;
        },
        setItem(_key: string, value: string) {
          if (!blocked) {
            data = value;
            return;
          }
          throw new Error("quota exceeded");
        },
      },
    });
    try {
      let failures = 0;
      const store = createRhythmProgressStore(() => {
        failures++;
      });
      expect(store.loadProgress()).toEqual(newRhythmProgress());
      expect(failures).toBe(0);
      data = '{"version":2,"currentStepId":"3-4"}';
      expect(store.loadProgress()).toEqual(newRhythmProgress());
      expect(store.loadCalibration()).toBeNull();
      const date = "2026-11-23T00:00:00.000Z";
      const record = {
        cleared: true,
        streak: 2,
        bestPerfectRate: 0.9,
        attempts: 4,
        lastPlayedAt: date,
      };
      data = JSON.stringify({
        version: 1,
        currentStepId: "3-3",
        steps: {
          "1-1": record,
          "1-2": record,
          "1-3": { ...record, cleared: false, streak: 1 },
          "3-2": record,
          "4-4": record,
        },
      });
      const restored = store.loadProgress();
      expect(restored.currentStepId).toBe("3-3");
      expect(restored.steps["1-2"]).toEqual(record);
      expect(restored.steps["1-3"]).toMatchObject({
        cleared: false,
        streak: 1,
      });
      expect(restored.steps["3-2"]).toMatchObject({ cleared: true, streak: 2 });
      expect(restored.steps["4-3"]).toBeUndefined();
      expect(restored.steps["4-4"]).toMatchObject({ cleared: true, streak: 2 });
      const furusato = RHYTHM_STEPS.find((step) => step.id === "4-3");
      if (!furusato) throw new Error("Step 4-3 is missing.");
      recordRhythmAttempt(
        restored,
        furusato,
        { perfectRate: 0.9, passed: true },
        date,
      );
      store.saveProgress(restored);
      expect(store.loadProgress().steps["4-3"]).toMatchObject({
        attempts: 1,
        streak: 1,
      });
      expect(rhythmStepUnlocked(restored, RHYTHM_STEPS[2])).toBe(true);
      expect(rhythmStepUnlocked(restored, RHYTHM_STEPS[3])).toBe(false);
      expect(rhythmStepUnlocked(restored, RHYTHM_STEPS[14])).toBe(false);
      data = '{"freePlay":true}';
      expect(store.loadSettings().freePlay).toBe(true);
      data = "{}";
      expect(store.loadSettings().freePlay).toBe(false);
      data = JSON.stringify({
        version: 1,
        visualOffsetMs: null,
        audioOffsetMs: 24,
      });
      expect(store.loadCalibration()).toMatchObject({
        visualOffsetMs: null,
        audioOffsetMs: 24,
      });
      data = JSON.stringify({
        version: 1,
        visualOffsetMs: 15,
        audioOffsetMs: null,
      });
      expect(store.loadCalibration()).toMatchObject({
        visualOffsetMs: 15,
        audioOffsetMs: null,
      });
      store.saveProgress(newRhythmProgress());
      blocked = true;
      expect(store.loadProgress()).toEqual(newRhythmProgress());
      expect(failures).toBe(1);
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
