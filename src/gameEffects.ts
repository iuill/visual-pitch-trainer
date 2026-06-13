import { clamp } from "./graphModel";
import type { PitchSample } from "./session";

export type LandingRipple = {
  createdAt: number;
  timeMs: number;
  midi: number;
  intensity: number;
};

export type ComboTier = {
  level: number;
  label: string | null;
  multiplier: number;
};

export type ComboTierProgress = {
  current: ComboTier;
  nextLabel: string | null;
  nextThresholdMs: number | null;
  progress: number;
};

export type ComboMilestone = {
  createdAt: number;
  timeMs: number;
  midi: number;
  level: number;
  label: string;
  multiplier: number;
};

export type GameEffectState = {
  stableComboMs: number;
  bestComboMs: number;
  score: number;
  previousSampleWasInTune: boolean;
  landingRipples: LandingRipple[];
  comboMilestones: ComboMilestone[];
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
  milestoneDurationMs: number;
  maxMilestones: number;
};

const COMBO_TIER_STEPS: {
  thresholdMs: number;
  label: string | null;
  multiplier: number;
}[] = [
  { thresholdMs: 0, label: null, multiplier: 1 },
  { thresholdMs: 1000, label: "Good!", multiplier: 2 },
  { thresholdMs: 3000, label: "Great!", multiplier: 3 },
  { thresholdMs: 5000, label: "Excellent!", multiplier: 4 },
  { thresholdMs: 10000, label: "Perfect!!", multiplier: 5 },
];

const SCORE_PER_STABLE_MS = 0.1;

export function createInitialGameEffectState(): GameEffectState {
  return {
    stableComboMs: 0,
    bestComboMs: 0,
    score: 0,
    previousSampleWasInTune: false,
    landingRipples: [],
    comboMilestones: [],
  };
}

export function getComboTier(stableComboMs: number): ComboTier {
  let tier: ComboTier = { level: 0, label: null, multiplier: 1 };

  COMBO_TIER_STEPS.forEach((step, level) => {
    if (stableComboMs >= step.thresholdMs) {
      tier = { level, label: step.label, multiplier: step.multiplier };
    }
  });

  return tier;
}

export function getComboTierProgress(stableComboMs: number): ComboTierProgress {
  const current = getComboTier(stableComboMs);
  const nextStep = COMBO_TIER_STEPS[current.level + 1];

  if (!nextStep) {
    return { current, nextLabel: null, nextThresholdMs: null, progress: 1 };
  }

  const baseThresholdMs = COMBO_TIER_STEPS[current.level]?.thresholdMs ?? 0;

  return {
    current,
    nextLabel: nextStep.label,
    nextThresholdMs: nextStep.thresholdMs,
    progress: clamp(
      (stableComboMs - baseThresholdMs) /
        (nextStep.thresholdMs - baseThresholdMs),
      0,
      1,
    ),
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
  milestoneDurationMs,
  maxMilestones,
}: GameEffectUpdate): GameEffectState {
  const stableDeltaMs =
    isInTune && previousSample
      ? Math.min(
          Math.max(0, sample.capturedAt - previousSample.capturedAt),
          maxStableGapMs,
        )
      : 0;
  const stableComboMs =
    isInTune && previousSample ? state.stableComboMs + stableDeltaMs : 0;
  const tier = getComboTier(stableComboMs);
  const previousTier = getComboTier(state.stableComboMs);
  const reachedTierLabel =
    isInTune && tier.level > previousTier.level ? tier.label : null;
  const nextMilestones =
    reachedTierLabel !== null && sample.midi !== null
      ? [
          ...state.comboMilestones.slice(-(maxMilestones - 1)),
          {
            createdAt: now,
            timeMs: sample.timeMs,
            midi: sample.midi,
            level: tier.level,
            label: reachedTierLabel,
            multiplier: tier.multiplier,
          },
        ]
      : state.comboMilestones;
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
    bestComboMs: Math.max(state.bestComboMs, stableComboMs),
    score: state.score + stableDeltaMs * SCORE_PER_STABLE_MS * tier.multiplier,
    previousSampleWasInTune: isInTune,
    landingRipples: nextRipples.filter(
      (ripple) => now - ripple.createdAt <= rippleDurationMs,
    ),
    comboMilestones: nextMilestones.filter(
      (milestone) => now - milestone.createdAt <= milestoneDurationMs,
    ),
  };
}
