import { describe, expect, test } from "bun:test";
import {
  midiToFrequency,
  midiToKaraokeName,
  midiToSolfegeWithOctave,
} from "./pitchMath";
import { createVoiceRange, observeVoiceRange } from "./voiceRange";

describe("voice range", () => {
  test("maps solfege octaves and karaoke A boundaries without mixing scientific C boundaries", () => {
    for (const [midi, name] of [
      [24, "LowLowC"],
      [43, "LowG"],
      [44, "LowG#"],
      [45, "mid1A"],
      [48, "mid1C"],
      [55, "mid1G"],
      [57, "mid2A"],
      [60, "mid2C"],
      [68, "mid2G#"],
      [69, "hiA"],
      [72, "hiC"],
      [81, "hihiA"],
      [84, "hihiC"],
    ] as const) {
      expect(midiToKaraokeName(midi)).toBe(name);
    }
    expect(midiToSolfegeWithOctave(60)).toBe("ド4");
    expect(midiToSolfegeWithOctave(61)).toBe("ド#4");
  });
  test("requires a sustained note, rejects isolated octave errors, and records unique sorted notes", () => {
    const state = createVoiceRange();
    const observe = (midi: number | null, now: number) =>
      observeVoiceRange(
        state,
        midi === null ? null : midiToFrequency(midi),
        now,
      );
    for (let at = 0; at <= 500; at += 100) observe(60, at);
    expect(state.notes).toEqual([]);
    observe(60, 600);
    expect(state.notes).toEqual([60]);
    observe(72, 700);
    observe(60, 800);
    expect(state.notes).toEqual([60]);
    observe(null, 900);
    for (let at = 1000; at <= 1700; at += 100) observe(43, at);
    expect(state.notes).toEqual([43, 60]);
    observe(43, 1800);
    expect(state.notes).toEqual([43, 60]);
  });
  test("resets holds on silence, long gaps and out-of-range input", () => {
    const state = createVoiceRange();
    for (const [frequency, at] of [
      [440, 0],
      [440, 100],
      [440, 900],
      [null, 1000],
      [Infinity, 1100],
      [10, 1200],
      [4000, 1300],
    ] as const)
      observeVoiceRange(state, frequency, at);
    expect(state.notes).toEqual([]);
    expect(state.candidate).toBe(null);
    expect(state.heldMs).toBe(0);
  });
});
