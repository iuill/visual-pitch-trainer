import { describe, expect, test } from "bun:test";
import {
  awardGameRound,
  createChallenge,
  earChoiceOffsets,
  observeChallenge,
  pitchGameRank,
  randomNoteIndex,
} from "./pitchGameModel";

describe("pitch games", () => {
  test("rewards streaks without removing earned points on a miss", () => {
    let score = { points: 0, streak: 0, bestStreak: 0 };
    for (let i = 0; i < 3; i++) score = awardGameRound(score, true);
    expect(score).toEqual({ points: 375, streak: 3, bestStreak: 3 });
    score = awardGameRound(score, false);
    expect(score).toEqual({ points: 375, streak: 0, bestStreak: 3 });
    expect(awardGameRound(score, true).points).toBe(475);
    expect(pitchGameRank(5, 5)).toBe("S");
    expect(pitchGameRank(4, 5)).toBe("A");
    expect(pitchGameRank(1, 5)).toBe("B");
    expect(pitchGameRank(0, 5)).toBe("チャレンジ");
  });
  test("requires arrival by the deadline and a separate continuous hold", () => {
    let state = createChallenge(440, 0, 2000);
    state = observeChallenge(state, 900, 440, 25);
    expect(state.phase).toBe("hold");
    expect(state.heldMs).toBe(0);
    for (let at = 1000; at <= 2800; at += 100)
      state = observeChallenge(state, at, 440, 25);
    expect(state.phase).toBe("hold");
    state = observeChallenge(state, 2900, 440, 25);
    expect(state.phase).toBe("success");
    expect(
      observeChallenge(createChallenge(440, 0, 2000), 1001, 440, 25).phase,
    ).toBe("failure");
    expect(
      observeChallenge(createChallenge(440, 0, 2000), 1000, 440, 25).phase,
    ).toBe("hold");
    expect(
      observeChallenge(createChallenge(440, 0, 2000), 1001, null, 25).phase,
    ).toBe("failure");
  });
  test("rejects silence, octave errors, broken holds and long gaps", () => {
    const start = createChallenge(440, 0, 2000);
    expect(observeChallenge(start, 200, 880, 50).phase).toBe("approach");
    expect(observeChallenge(start, 200, Number.NaN, 50).phase).toBe("approach");
    const holding = observeChallenge(start, 200, 440, 25);
    expect(observeChallenge(holding, 300, null, 25).phase).toBe("failure");
    expect(observeChallenge(holding, 300, 466.16, 25).phase).toBe("failure");
    expect(observeChallenge(holding, 451, 440, 25).phase).toBe("failure");
    expect(observeChallenge(holding, 100, 440, 25).phase).toBe("failure");
  });
  test("builds explicit semitone difficulty levels and never repeats adjacent targets", () => {
    expect(earChoiceOffsets(3)).toEqual([0, 3, 6, 9, 12]);
    expect(earChoiceOffsets(1)).toHaveLength(13);
    expect(randomNoteIndex(13, 0, () => 0)).toBe(1);
    expect(randomNoteIndex(13, 12, () => 0.9999)).toBe(11);
    expect(randomNoteIndex(1, 0)).toBe(0);
    expect(() => randomNoteIndex(0, null)).toThrow();
    for (let previous = 0; previous < 13; previous++) {
      for (let i = 0; i < 100; i++) {
        const next = randomNoteIndex(13, previous, () => i / 100);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(13);
        expect(next).not.toBe(previous);
      }
    }
  });
});
