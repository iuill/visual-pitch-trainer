import { hzToCents } from "./pitchMath";

export type Challenge = {
  phase: "approach" | "hold" | "success" | "failure";
  targetHz: number;
  startedAt: number;
  holdMs: number;
  heldMs: number;
  lastAt: number | null;
};
export const APPROACH_MS = 1000;
export const CHALLENGE_MAX_GAP_MS = 250;

export function createChallenge(
  targetHz: number,
  startedAt: number,
  holdMs: number,
): Challenge {
  return {
    phase: "approach",
    targetHz,
    startedAt,
    holdMs,
    heldMs: 0,
    lastAt: null,
  };
}

/** Reach within one second, then sustain continuously. Missing input never earns time. */
export function observeChallenge(
  state: Challenge,
  now: number,
  frequency: number | null,
  tolerance: number,
): Challenge {
  if (state.phase === "success" || state.phase === "failure") return state;
  const matches =
    frequency !== null &&
    Number.isFinite(frequency) &&
    frequency > 0 &&
    Math.abs(hzToCents(frequency, state.targetHz)) <= tolerance;
  if (state.phase === "approach") {
    if (now - state.startedAt > APPROACH_MS)
      return { ...state, phase: "failure" };
    return matches ? { ...state, phase: "hold", lastAt: now } : state;
  }
  const gap = state.lastAt === null ? Infinity : now - state.lastAt;
  if (!matches || gap > CHALLENGE_MAX_GAP_MS || gap < 0)
    return { ...state, phase: "failure" };
  const heldMs = state.heldMs + gap;
  return {
    ...state,
    heldMs,
    lastAt: now,
    phase: heldMs >= state.holdMs ? "success" : "hold",
  };
}

/** Sample uniformly from available notes, avoiding an immediate repeat when possible. */
export function randomNoteIndex(
  count: number,
  previous: number | null,
  random = Math.random,
): number {
  if (count < 1) throw new Error("出題できる音がありません。");
  const pool = Array.from({ length: count }, (_, i) => i).filter(
    (i) => count === 1 || i !== previous,
  );
  return pool[
    Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  ];
}

export function earChoiceOffsets(step: 1 | 3): number[] {
  return Array.from({ length: Math.floor(12 / step) + 1 }, (_, i) => i * step);
}

export type PitchGameScore = {
  points: number;
  streak: number;
  bestStreak: number;
};
export function awardGameRound(
  previous: PitchGameScore,
  success: boolean,
): PitchGameScore {
  const streak = success ? previous.streak + 1 : 0;
  return {
    points: previous.points + (success ? 100 + (streak - 1) * 25 : 0),
    streak,
    bestStreak: Math.max(previous.bestStreak, streak),
  };
}
export function pitchGameRank(correct: number, rounds: number): string {
  if (correct >= rounds) return "S";
  if (correct / rounds >= 0.7) return "A";
  return correct > 0 ? "B" : "チャレンジ";
}
