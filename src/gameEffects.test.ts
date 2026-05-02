import { describe, expect, test } from "bun:test";
import {
  createInitialGameEffectState,
  getTargetGlowStrength,
  updateGameEffectState,
} from "./gameEffects";
import { midiToFrequency } from "./pitchMath";
import { createPitchSample } from "./session";

const TARGET = midiToFrequency(60);

function sampleAt(now: number, centsFromTarget = 0) {
  return createPitchSample(
    now,
    {
      frequency: TARGET * 2 ** (centsFromTarget / 1200),
      clarity: 0.9,
    },
    0.03,
    TARGET,
    0,
  );
}

describe("game effects", () => {
  test("calculates target glow from pitch distance", () => {
    expect(getTargetGlowStrength(null, 50)).toBe(0);
    expect(getTargetGlowStrength(0, 50)).toBe(1);
    expect(getTargetGlowStrength(25, 50)).toBe(0.5);
    expect(getTargetGlowStrength(-50, 50)).toBe(0);
    expect(getTargetGlowStrength(80, 50)).toBe(0);
    expect(getTargetGlowStrength(0, 0)).toBe(0);
  });

  test("accumulates combo time across consecutive in-tune samples", () => {
    const first = sampleAt(100);
    const second = sampleAt(280);
    const state = updateGameEffectState({
      state: createInitialGameEffectState(),
      sample: second,
      previousSample: first,
      isInTune: true,
      tolerance: 50,
      now: 280,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 8,
    });

    expect(state.stableComboMs).toBe(180);
    expect(state.previousSampleWasInTune).toBe(true);
  });

  test("caps combo time and resets when pitch leaves range", () => {
    const first = sampleAt(100);
    const second = sampleAt(900);
    const inTune = updateGameEffectState({
      state: createInitialGameEffectState(),
      sample: second,
      previousSample: first,
      isInTune: true,
      tolerance: 50,
      now: 900,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 8,
    });
    const outOfTune = updateGameEffectState({
      state: inTune,
      sample: sampleAt(1000, 70),
      previousSample: second,
      isInTune: false,
      tolerance: 50,
      now: 1000,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 8,
    });

    expect(inTune.stableComboMs).toBe(250);
    expect(outOfTune.stableComboMs).toBe(0);
    expect(outOfTune.previousSampleWasInTune).toBe(false);
  });

  test("creates a landing ripple only when entering the in-tune range", () => {
    const first = sampleAt(100, 10);
    const entered = updateGameEffectState({
      state: createInitialGameEffectState(),
      sample: first,
      previousSample: undefined,
      isInTune: true,
      tolerance: 50,
      now: 100,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 8,
    });
    const held = updateGameEffectState({
      state: entered,
      sample: sampleAt(250, 5),
      previousSample: first,
      isInTune: true,
      tolerance: 50,
      now: 250,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 8,
    });

    expect(entered.landingRipples).toHaveLength(1);
    expect(entered.landingRipples[0]?.intensity).toBeCloseTo(0.8, 8);
    expect(held.landingRipples).toHaveLength(1);
  });

  test("drops expired ripples and keeps only the newest ripple limit", () => {
    const state = {
      stableComboMs: 0,
      previousSampleWasInTune: false,
      landingRipples: [
        { createdAt: 0, timeMs: 0, midi: 60, intensity: 1 },
        { createdAt: 600, timeMs: 600, midi: 60, intensity: 1 },
        { createdAt: 700, timeMs: 700, midi: 60, intensity: 1 },
      ],
    };

    const updated = updateGameEffectState({
      state,
      sample: sampleAt(1000),
      previousSample: undefined,
      isInTune: true,
      tolerance: 50,
      now: 1000,
      maxStableGapMs: 250,
      rippleDurationMs: 850,
      maxRipples: 2,
    });

    expect(updated.landingRipples.map((ripple) => ripple.createdAt)).toEqual([
      700, 1000,
    ]);
  });
});
