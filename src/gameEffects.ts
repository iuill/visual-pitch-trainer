import { clamp } from "./graphModel";
import type { PitchSample } from "./session";

export type LandingRipple = {
  createdAt: number;
  timeMs: number;
  midi: number;
  intensity: number;
};

export type GameEffectState = {
  stableComboMs: number;
  previousSampleWasInTune: boolean;
  landingRipples: LandingRipple[];
};

export type GameEffectUpdate = {
  state: GameEffectState;
  sample: PitchSample;
  previousSample: PitchSample | undefined;
  isInTune: boolean;
  tolerance: number;
  now: number;
  maxStableGapMs: number;
  rippleDurationMs: number;
  maxRipples: number;
};

export function createInitialGameEffectState(): GameEffectState {
  return {
    stableComboMs: 0,
    previousSampleWasInTune: false,
    landingRipples: [],
  };
}

export function getTargetGlowStrength(
  centsFromTarget: number | null,
  tolerance: number,
): number {
  if (centsFromTarget === null || tolerance <= 0) {
    return 0;
  }

  return clamp(1 - Math.abs(centsFromTarget) / tolerance, 0, 1);
}

export function updateGameEffectState({
  state,
  sample,
  previousSample,
  isInTune,
  tolerance,
  now,
  maxStableGapMs,
  rippleDurationMs,
  maxRipples,
}: GameEffectUpdate): GameEffectState {
  const stableComboMs =
    isInTune && previousSample
      ? state.stableComboMs +
        Math.min(
          Math.max(0, sample.capturedAt - previousSample.capturedAt),
          maxStableGapMs,
        )
      : 0;
  const nextRipples =
    isInTune &&
    !state.previousSampleWasInTune &&
    sample.midi !== null &&
    sample.centsFromTarget !== null
      ? [
          ...state.landingRipples.slice(-(maxRipples - 1)),
          {
            createdAt: now,
            timeMs: sample.timeMs,
            midi: sample.midi,
            intensity: getTargetGlowStrength(sample.centsFromTarget, tolerance),
          },
        ]
      : state.landingRipples;

  return {
    stableComboMs,
    previousSampleWasInTune: isInTune,
    landingRipples: nextRipples.filter(
      (ripple) => now - ripple.createdAt <= rippleDurationMs,
    ),
  };
}
