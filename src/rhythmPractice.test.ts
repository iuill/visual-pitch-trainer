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
  rhythmPulseDynamics,
  rhythmPulseLevel,
  rhythmPulseUnits,
  rhythmSlotsPerBeat,
} from "./rhythmCourse";
import { createRhythmGamepadPoller } from "./rhythmGamepad";
import {
  collectOmittedRhythmNotes,
  createRhythmTargets,
  judgeRhythmTap,
  type RhythmHit,
  summarizeRhythm,
} from "./rhythmJudge";
import {
  createRhythmPattern,
  createRhythmPatternLegend,
} from "./rhythmPracticeModel";
import {
  createRhythmProgressStore,
  newRhythmProgress,
  recordRhythmAttempt,
  rhythmStepUnlocked,
} from "./rhythmProgressStore";

describe("rhythm pattern previews", () => {
  test("retains original slot numbers and hides the note legend for feet-only practice", () => {
    const step = { ...RHYTHM_STEPS[0], feetOnly: true };
    const preview = createRhythmPattern(step, "x-x-x-x-");
    expect(preview.subdivided).toBe(false);
    expect(preview.slots.map(({ index }) => index)).toEqual([0, 2, 4, 6]);
    expect(preview.slots.every(({ foot }) => foot)).toBe(true);
    expect(preview.label).toBe("足で1、2、3、4拍を刻み、各拍でタップ");
    expect(createRhythmPatternLegend(step, ["x-x-x-x-"])).toEqual([]);
  });

  test("labels sixteenth subdivisions, notes and rests in a pattern", () => {
    const step = {
      ...RHYTHM_STEPS[0],
      feetOnly: false,
      countSubdivision: "sixteenth" as const,
    };
    const pattern = "zzs-";
    const preview = createRhythmPattern(step, pattern);
    expect(preview.subdivided).toBe(true);
    expect(preview.slots.map(({ count }) => count)).toEqual([
      "1",
      "・",
      "&",
      "・",
    ]);
    expect(preview.slots.map(({ foot }) => foot)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(preview.label).toBe(
      "足で毎拍を刻む。手で叩く位置は1拍目に16分音符、1拍目の2つ目に16分音符。1拍目の裏に8分休符",
    );
    expect(createRhythmPatternLegend(step, [pattern])).toEqual([
      { kind: "note", value: "sixteenth", label: "16分音符（0.25拍）" },
      { kind: "rest", value: "eighth", label: "8分休符（半拍休む）" },
    ]);
  });

  test("restarts counting within 7/8 groups and labels eighth notes without beat lengths", () => {
    const step = {
      ...RHYTHM_STEPS[0],
      feetOnly: false,
      beatsPerBar: 7 as const,
      beatGroups: [2, 4],
    };
    const pattern = "eeesxe-";
    const { slots } = createRhythmPattern(step, pattern);
    expect(slots.map(({ count }) => count)).toEqual([
      "1",
      "2",
      "1",
      "2",
      "1",
      "2",
      "3",
    ]);
    expect(
      slots.filter(({ groupStart }) => groupStart).map(({ index }) => index),
    ).toEqual([2, 4]);
    expect(createRhythmPatternLegend(step, [pattern])).toEqual([
      { kind: "note", value: "quarter", label: "4分音符（8分音符2つ分）" },
      { kind: "note", value: "eighth", label: "8分音符" },
      { kind: "rest", value: "eighth", label: "8分休符" },
    ]);
  });
});

describe("rhythm course", () => {
  test("keeps spoken subdivisions quieter than weak beats", () => {
    const [downbeat, offbeat, weak, secondary, last] = [0, 0.5, 1, 2, 3].map(
      (pulse) => rhythmPulseDynamics(RHYTHM_STEPS[0], pulse).voiceLevel,
    );
    expect(downbeat).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(weak);
    expect(weak).toBe(last);
    expect(weak).toBeGreaterThan(offbeat);
  });
  test("distinguishes downbeats, secondary accents and weak beats by meter", () => {
    const step = RHYTHM_STEPS[0];
    const levels = (meter: typeof step, pulses: number[]) =>
      pulses.map((pulse) => rhythmPulseLevel(meter, pulse));
    expect(levels(step, [0, 1, 2, 3])).toEqual([1, 0.5, 0.75, 0.5]);
    expect(levels({ ...step, beatsPerBar: 3 }, [0, 1, 2])).toEqual([
      1, 0.5, 0.5,
    ]);
    expect(levels({ ...step, beatsPerBar: 2 }, [0, 1, 1.5])).toEqual([
      1, 0.5, 0.35,
    ]);
    expect(
      levels(
        { ...step, beatsPerBar: 7, beatGroups: [2, 4] },
        [0, 1, 2, 3, 4, 5, 6],
      ),
    ).toEqual([1, 0.5, 0.88, 0.5, 0.88, 0.5, 0.5]);
  });
  test("uses 36 ordered steps, in 5 chapters", () => {
    expect(RHYTHM_STEPS.map((step) => step.bpm)).toEqual([
      60, 60, 60, 60, 60, 60, 70, 70, 90, 105, 125, 150, 60, 60, 90, 90, 95,
      130, 60, 60, 76, 100, 80, 76, 72, 88, 92, 96, 52, 60, 52, 72, 116, 144,
      128, 180,
    ]);
    expect(new Set(RHYTHM_STEPS.map((step) => step.id)).size).toBe(36);
    for (const step of RHYTHM_STEPS) {
      expect(step.requiredStreak).toBe(step.chapter === 5 ? 1 : 2);
      const bars = createRhythmBars(step, () => 0);
      const slotsPerBeat = rhythmSlotsPerBeat(step);
      if (step.melody) {
        expect(bars.length).toBeGreaterThanOrEqual(8);
        expect(step.melody).toHaveLength(bars.length);
        expect(bars).toEqual([...step.patterns]);
      } else {
        const lengthByMeter = { 2: 8, 3: 6, 4: 4, 7: 3 };
        expect(bars).toHaveLength(lengthByMeter[step.beatsPerBar ?? 4]);
      }
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
    const kick = buildSongEvents(step, 0, 1, 0, true).flatMap((event) =>
      "drum" in event && event.drum === "kick" ? [event.level] : [],
    );
    expect(kick).toHaveLength(7);
    expect(kick[0]).toBeGreaterThan(kick[2]);
    expect(kick[2]).toBeGreaterThan(kick[1]);
    expect(kick[4]).toBeGreaterThan(kick[3]);
  });

  test("keeps every 7/8 event on the eighth-note grid, including the flute answers", () => {
    const step = RHYTHM_STEPS.find(({ id }) => id === "5-3");
    if (!step) throw new Error("Missing 7/8 song");
    const pulseMs = 60_000 / step.bpm;
    const events = buildSongEvents(step, 0, step.patterns.length, 0, true);
    for (const { timeMs } of events) {
      const slot = timeMs / pulseMs;
      expect(slot).toBeCloseTo(Math.round(slot), 8);
    }
    const fluteSlots = events.flatMap((event) =>
      "instrument" in event && event.instrument === "flute" && event.level < 0.5
        ? [Math.round(event.timeMs / pulseMs) % 7]
        : [],
    );
    expect(fluteSlots).toEqual([
      ...Array.from({ length: 15 }, () => [2, 4]).flat(),
      0,
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

  test("introduces triplets between quarter notes and rests", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "3-7");
    if (!step) throw new Error("Step 3-7 is missing.");
    const bars = createRhythmBars(step);
    const taps = bars.map((bar) =>
      createRhythmTargets([bar], step.bpm, 0, rhythmSlotsPerBeat(step)),
    );
    expect(taps.map((bar) => bar.length)).toEqual([6, 8, 9, 12]);
    expect(taps[0].map(({ timeMs }) => Math.round(timeMs))).toEqual([
      0, 1000, 2000, 2333, 2667, 3000,
    ]);
    expect(taps[2].some(({ pulse }) => pulse >= 2 && pulse < 3)).toBe(false);
  });

  test("introduces sixteenths alongside eighth notes, dotted eighth notes, and rests", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "3-8");
    if (!step) throw new Error("Step 3-8 is missing.");
    const taps = createRhythmBars(step).map((bar) =>
      createRhythmTargets([bar], step.bpm, 0, rhythmSlotsPerBeat(step)),
    );
    expect(taps.map((bar) => bar.length)).toEqual([7, 7, 12, 16]);
    expect(taps[0].map(({ timeMs }) => timeMs)).toEqual([
      0, 1000, 2000, 2250, 2500, 2750, 3000,
    ]);
    expect(taps[1].map(({ timeMs, noteValue }) => [timeMs, noteValue])).toEqual(
      [
        [0, "eighth"],
        [500, "eighth"],
        [1000, "dotted-eighth"],
        [1750, "sixteenth"],
        [2000, "quarter"],
        [3000, "dotted-eighth"],
        [3750, "sixteenth"],
      ],
    );
    expect(taps[2].some(({ pulse }) => pulse >= 2 && pulse < 3)).toBe(false);
  });

  test("keeps the song's pitches, offbeat and rest aligned in 3/4", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "4-3");
    if (!step) throw new Error("Step 4-3 is missing.");
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

  test("starts the offbeat chapter with eighth rests on every beat", () => {
    const first = RHYTHM_STEPS.find((step) => step.id === "3-1");
    if (!first) throw new Error("Missing offbeat introduction");
    expect(first.patterns).toEqual(["sesesese"]);
    expect(
      createRhythmTargets(first.patterns, 60, 0).map((target) => target.timeMs),
    ).toEqual([500, 1500, 2500, 3500]);
  });

  test("practices isolated late offbeats and the following beat in 4/4", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "3-3");
    if (!step) throw new Error("Step 3-3 is missing.");
    const bars = createRhythmBars(step, () => 0.99);
    expect(
      bars.map((bar) =>
        createRhythmTargets([bar], step.bpm, 0).map(({ pulse }) => pulse),
      ),
    ).toEqual([[1.5], [1.5, 2], [2.5], [3.5]]);
  });

  test("mixes runs of eighth notes, rests, and a held offbeat at 90 BPM", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "3-4");
    if (!step) throw new Error("Step 3-4 is missing.");
    const bars = createRhythmBars(step);
    const targets = bars.map((bar) => createRhythmTargets([bar], step.bpm, 0));
    expect(targets.map((bar) => bar.map(({ pulse }) => pulse))).toEqual([
      [0, 1, 1.5, 2, 2.5, 3, 3.5],
      [0.5, 1, 2, 2.5, 3],
      [0, 0.5, 1, 2.5],
      [0, 0.5, 1, 2, 2.5, 3, 3.5],
    ]);
    expect(targets[2].at(-1)?.noteValue).toBe("dotted-quarter");
  });

  test("practices isolated and held offbeats in 3/4 before the song", () => {
    const step = RHYTHM_STEPS.find((item) => item.id === "3-5");
    const song = RHYTHM_STEPS.find((item) => item.id === "4-3");
    if (!step || !song) throw new Error("Missing 3/4 offbeat steps");
    const bars = createRhythmBars(step);
    expect(step.beatsPerBar).toBe(3);
    expect(bars).toEqual([...step.patterns]);
    expect(bars[4]).toBe(song.patterns[1]);
    expect(
      createRhythmTargets([bars[2]], step.bpm, 0).map(({ pulse }) => pulse),
    ).toEqual([1.5, 2]);
    expect(
      createRhythmTargets([bars[5]], step.bpm, 0).map(
        ({ pulse, noteValue }) => [pulse, noteValue],
      ),
    ).toEqual([
      [0.5, "dotted-quarter"],
      [2, "quarter"],
    ]);
  });

  test("reviews both 4/4 offbeat patterns in the 130 BPM challenge", () => {
    const challenge = RHYTHM_STEPS.find((item) => item.id === "3-6");
    if (!challenge) throw new Error("Step 3-6 is missing.");
    expect(challenge.patterns).toContain("r-sex-r-");
    expect(challenge.patterns).toContain("eex-sd--");
  });

  test("maps eighth slots and bar boundaries to the common time axis", () => {
    expect(
      createRhythmTargets(["-e---e--", "w-------", "h---x-x-"], 60, 1000),
    ).toEqual([
      { timeMs: 1500, downbeat: false, pulse: 0.5, noteValue: "eighth" },
      { timeMs: 3500, downbeat: false, pulse: 2.5, noteValue: "eighth" },
      { timeMs: 5000, downbeat: true, pulse: 0, noteValue: "whole" },
      { timeMs: 9000, downbeat: true, pulse: 0, noteValue: "half" },
      { timeMs: 11000, downbeat: false, pulse: 2, noteValue: "quarter" },
      { timeMs: 12000, downbeat: false, pulse: 3, noteValue: "quarter" },
    ]);
  });

  test("quarter rests leave time for the beat but never become tap targets", () => {
    const targets = createRhythmTargets(["x-x-r-x-"], 60, 1000);
    expect(targets.map((target) => target.timeMs)).toEqual([1000, 2000, 4000]);
    expect(judgeRhythmTap(targets, 3000).reason).toBe("extra");
  });
});

test("introduces two- and three-beat measures before the fastest steps", () => {
  const steps = RHYTHM_STEPS.filter((step) => step.chapter === 2);
  expect(steps.map((step) => step.beatsPerBar ?? 4)).toEqual([
    4, 4, 2, 3, 4, 4,
  ]);
});

test("timestamps gamepad press edges and falls back to the current poll time", () => {
  const poll = createRhythmGamepadPoller();
  const gamepad = (values: Record<number, number>, timestamp = 0) => ({
    id: "Xbox Controller",
    connected: true,
    mapping: "standard" as const,
    index: 0,
    timestamp,
    buttons: Array.from({ length: 17 }, (_, index) => {
      const value = values[index] ?? 0;
      return { value, pressed: value === 1, touched: value > 0 };
    }),
  });
  expect([...poll([gamepad({ 0: 1, 6: 0.6 }, 95)], 100)]).toEqual([
    ["hand", 95],
    ["foot", 95],
  ]);
  expect([...poll([gamepad({ 0: 1, 6: 0.8 }, 112)], 116)]).toEqual([]);
  expect([...poll([gamepad({ 0: 1, 2: 1, 6: 0.4 }, 95)], 132)]).toEqual([
    ["hand", 132],
  ]);
  expect([...poll([gamepad({ 6: 0.5 })], 148)]).toEqual([["foot", 148]]);
  expect([...poll([null], 164)]).toEqual([]);
  expect([...poll([gamepad({ 7: 1 }, 181)], 180)]).toEqual([["foot", 180]]);
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

  test("rejects prior progress versions, restores current progress, and reports storage failure once", () => {
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
      for (const version of [1, 2]) {
        data = JSON.stringify({ version, currentStepId: "3-4" });
        expect(store.loadProgress()).toEqual(newRhythmProgress());
      }
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
        version: 3,
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
      expect(store.loadSettings().judgeFeet).toBe(false);
      data = '{"judgeFeet":true}';
      expect(store.loadSettings().judgeFeet).toBe(true);
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
