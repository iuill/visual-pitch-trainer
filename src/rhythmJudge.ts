import { getRhythmNoteValue, type RhythmNoteValue } from "./rhythmCourse";

export const RHYTHM_MATCH_MS = 150;
export const RHYTHM_BEGINNER_PASS_RATE = 0.85;
export const RHYTHM_ADVANCED_PERFECT_RATE = 0.6;
export const RHYTHM_ADVANCED_MISS_RATE = 0.1;

export type RhythmGrade = "perfect" | "close" | "miss";

export interface RhythmHit {
  grade: RhythmGrade;
  offsetMs: number | null;
  reason?: "extra" | "omitted";
}

export interface RhythmTarget {
  timeMs: number;
  hit?: RhythmHit;
}

export function createRhythmTargets(
  bars: readonly string[],
  bpm: number,
  startMs: number,
  slotsPerBeat = 2,
): (RhythmTarget & { downbeat: boolean; noteValue: RhythmNoteValue })[] {
  return bars.flatMap((pattern, bar) =>
    Array.from(pattern).flatMap((symbol, slot) => {
      const noteValue = getRhythmNoteValue(symbol);
      return noteValue
        ? [
            {
              timeMs:
                startMs +
                ((bar * pattern.length + slot) * 60_000) / (bpm * slotsPerBeat),
              downbeat: slot === 0,
              noteValue,
            },
          ]
        : [];
    }),
  );
}

export function judgeRhythmTap(
  targets: RhythmTarget[],
  tapMs: number,
): RhythmHit {
  let closest: RhythmTarget | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const difference = Math.abs(tapMs - target.timeMs);
    if (!target.hit && difference <= RHYTHM_MATCH_MS && difference < distance) {
      closest = target;
      distance = difference;
    }
  }
  if (!closest) return { grade: "miss", reason: "extra", offsetMs: null };
  const grade = distance <= 40 ? "perfect" : distance <= 80 ? "close" : "miss";
  closest.hit = { grade, offsetMs: tapMs - closest.timeMs };
  return closest.hit;
}

export function collectOmittedRhythmNotes(
  targets: RhythmTarget[],
  nowMs: number,
): RhythmHit[] {
  const hits: RhythmHit[] = [];
  for (const target of targets) {
    if (target.hit || nowMs <= target.timeMs + RHYTHM_MATCH_MS) continue;
    target.hit = { grade: "miss", reason: "omitted", offsetMs: null };
    hits.push(target.hit);
  }
  return hits;
}

export const RHYTHM_HISTOGRAM_LABELS = [
  "早い 80ms超",
  "早い 40〜80ms",
  "±40ms",
  "遅い 40〜80ms",
  "遅い 80ms超",
];

export function summarizeRhythm(hits: RhythmHit[], chapter: number) {
  const counts = { perfect: 0, close: 0, miss: 0 };
  const histogram = [0, 0, 0, 0, 0];
  let offsetSum = 0;
  let matched = 0;
  for (const hit of hits) {
    counts[hit.grade]++;
    if (hit.offsetMs === null) continue;
    const offset = hit.offsetMs;
    offsetSum += offset;
    matched++;
    const bin =
      offset < -80
        ? 0
        : offset < -40
          ? 1
          : offset <= 40
            ? 2
            : offset <= 80
              ? 3
              : 4;
    histogram[bin]++;
  }
  const perfectRate = hits.length ? counts.perfect / hits.length : 0;
  const missRate = hits.length ? counts.miss / hits.length : 0;
  const onBeatRate = hits.length
    ? (counts.perfect + counts.close) / hits.length
    : 0;
  return {
    counts,
    perfectRate,
    missRate,
    onBeatRate,
    meanOffsetMs: matched ? offsetSum / matched : null,
    histogram,
    passed:
      chapter === 1
        ? onBeatRate >= RHYTHM_BEGINNER_PASS_RATE
        : perfectRate >= RHYTHM_ADVANCED_PERFECT_RATE &&
          missRate <= RHYTHM_ADVANCED_MISS_RATE,
  };
}
