import { describe, expect, test } from "bun:test";
import {
  createInitialGameEffectState,
  type GameEffectState,
  getComboTier,
  getComboTierProgress,
  getTargetGlowStrength,
  updateGameEffectState,
} from "./gameEffects";
import { midiToFrequency } from "./pitchMath";
import { createPitchSample } from "./session";

const TARGET = midiToFrequency(60);

const EFFECT_TIMINGS = {
  tolerance: 50,
  maxStableGapMs: 250,
  rippleDurationMs: 850,
  maxRipples: 8,
  milestoneDurationMs: 1600,
  maxMilestones: 4,
};

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

function stateWith(overrides: Partial<GameEffectState>): GameEffectState {
  return { ...createInitialGameEffectState(), ...overrides };
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

  test("maps combo time to tier labels and multipliers", () => {
    expect(getComboTier(0)).toEqual({ level: 0, label: null, multiplier: 1 });
    expect(getComboTier(999)).toEqual({ level: 0, label: null, multiplier: 1 });
    expect(getComboTier(1000)).toEqual({
      level: 1,
      label: "Good!",
      multiplier: 2,
    });
    expect(getComboTier(3000)).toEqual({
      level: 2,
      label: "Great!",
      multiplier: 3,
    });
    expect(getComboTier(5000)).toEqual({
      level: 3,
      label: "Excellent!",
      multiplier: 4,
    });
    expect(getComboTier(10000)).toEqual({
      level: 4,
      label: "Perfect!!",
      multiplier: 5,
    });
  });

  test("reports progress toward the next tier", () => {
    const midway = getComboTierProgress(2000);
    expect(midway.current.label).toBe("Good!");
    expect(midway.nextLabel).toBe("Great!");
    expect(midway.nextThresholdMs).toBe(3000);
    expect(midway.progress).toBeCloseTo(0.5, 8);

    const maxed = getComboTierProgress(12000);
    expect(maxed.current.label).toBe("Perfect!!");
    expect(maxed.nextLabel).toBeNull();
    expect(maxed.progress).toBe(1);
  });

  test("accumulates combo time across consecutive in-tune samples", () => {
    const first = sampleAt(100);
    const second = sampleAt(280);
    const state = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: createInitialGameEffectState(),
      sample: second,
      previousSample: first,
      isInTune: true,
      now: 280,
    });

    expect(state.stableComboMs).toBe(180);
    expect(state.previousSampleWasInTune).toBe(true);
  });

  test("caps combo time and resets when pitch leaves range", () => {
    const first = sampleAt(100);
    const second = sampleAt(900);
    const inTune = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: createInitialGameEffectState(),
      sample: second,
      previousSample: first,
      isInTune: true,
      now: 900,
    });
    const outOfTune = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: inTune,
      sample: sampleAt(1000, 70),
      previousSample: second,
      isInTune: false,
      now: 1000,
    });

    expect(inTune.stableComboMs).toBe(250);
    expect(outOfTune.stableComboMs).toBe(0);
    expect(outOfTune.previousSampleWasInTune).toBe(false);
  });

  test("adds score scaled by the combo multiplier", () => {
    const base = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: stateWith({ score: 100 }),
      sample: sampleAt(300),
      previousSample: sampleAt(100),
      isInTune: true,
      now: 300,
    });
    const boosted = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: stateWith({ stableComboMs: 2900, score: 100 }),
      sample: sampleAt(300),
      previousSample: sampleAt(100),
      isInTune: true,
      now: 300,
    });

    expect(base.score).toBe(120);
    expect(boosted.stableComboMs).toBe(3100);
    expect(boosted.score).toBe(160);
  });

  test("keeps score and best combo when the combo breaks", () => {
    const broken = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: stateWith({ stableComboMs: 4200, bestComboMs: 4200, score: 500 }),
      sample: sampleAt(300, 70),
      previousSample: sampleAt(100),
      isInTune: false,
      now: 300,
    });

    expect(broken.stableComboMs).toBe(0);
    expect(broken.bestComboMs).toBe(4200);
    expect(broken.score).toBe(500);
  });

  test("creates a milestone when the combo reaches a new tier", () => {
    const crossed = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: stateWith({ stableComboMs: 950, previousSampleWasInTune: true }),
      sample: sampleAt(300),
      previousSample: sampleAt(200),
      isInTune: true,
      now: 300,
    });
    const held = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: crossed,
      sample: sampleAt(400),
      previousSample: sampleAt(300),
      isInTune: true,
      now: 400,
    });

    expect(crossed.stableComboMs).toBe(1050);
    expect(crossed.comboMilestones).toHaveLength(1);
    expect(crossed.comboMilestones[0]?.label).toBe("Good!");
    expect(crossed.comboMilestones[0]?.multiplier).toBe(2);
    expect(held.comboMilestones).toHaveLength(1);
  });

  test("drops expired milestones and keeps only the newest limit", () => {
    const state = stateWith({
      stableComboMs: 2950,
      previousSampleWasInTune: true,
      comboMilestones: [
        {
          createdAt: 0,
          timeMs: 0,
          midi: 60,
          level: 1,
          label: "Good!",
          multiplier: 2,
        },
        {
          createdAt: 2600,
          timeMs: 2600,
          midi: 60,
          level: 1,
          label: "Good!",
          multiplier: 2,
        },
      ],
    });

    const updated = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state,
      sample: sampleAt(3000),
      previousSample: sampleAt(2900),
      isInTune: true,
      now: 3000,
      maxMilestones: 2,
    });

    expect(updated.comboMilestones.map((milestone) => milestone.label)).toEqual(
      ["Good!", "Great!"],
    );
    expect(updated.comboMilestones.map((m) => m.createdAt)).toEqual([
      2600, 3000,
    ]);
  });

  test("creates a landing ripple only when entering the in-tune range", () => {
    const first = sampleAt(100, 10);
    const entered = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: createInitialGameEffectState(),
      sample: first,
      previousSample: undefined,
      isInTune: true,
      now: 100,
    });
    const held = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state: entered,
      sample: sampleAt(250, 5),
      previousSample: first,
      isInTune: true,
      now: 250,
    });

    expect(entered.landingRipples).toHaveLength(1);
    expect(entered.landingRipples[0]?.intensity).toBeCloseTo(0.8, 8);
    expect(held.landingRipples).toHaveLength(1);
  });

  test("drops expired ripples and keeps only the newest ripple limit", () => {
    const state = stateWith({
      landingRipples: [
        { createdAt: 0, timeMs: 0, midi: 60, intensity: 1 },
        { createdAt: 600, timeMs: 600, midi: 60, intensity: 1 },
        { createdAt: 700, timeMs: 700, midi: 60, intensity: 1 },
      ],
    });

    const updated = updateGameEffectState({
      ...EFFECT_TIMINGS,
      state,
      sample: sampleAt(1000),
      previousSample: undefined,
      isInTune: true,
      now: 1000,
      maxRipples: 2,
    });

    expect(updated.landingRipples.map((ripple) => ripple.createdAt)).toEqual([
      700, 1000,
    ]);
  });
});
