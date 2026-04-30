import { formatPitchGap, hzToCents, hzToMidi, hzToNoteName } from "./pitchMath";

export type PitchDetection = {
  frequency: number | null;
  clarity: number | null;
};

export type PitchSample = {
  timeMs: number;
  capturedAt: number;
  frequency: number | null;
  midi: number | null;
  note: string | null;
  centsFromTarget: number | null;
  volume: number;
  clarity: number | null;
};

export type SessionStats = {
  samples: PitchSample[];
  totalAbsCents: number;
  totalValidSamples: number;
  sessionStart: number | null;
  stableMs: number;
  lastSampleAt: number | null;
};

export type SessionSummary = {
  elapsedSec: number;
  stableSec: number;
  overallAverage: number | null;
  recentAverage: number | null;
  formattedOverallAverage: string;
  formattedRecentAverage: string;
};

export type AnalysisStatus = "quiet" | "undetected" | "inRange" | "high" | "low";

export function createInitialSessionStats(startAt: number | null = null): SessionStats {
  return {
    samples: [],
    totalAbsCents: 0,
    totalValidSamples: 0,
    sessionStart: startAt,
    stableMs: 0,
    lastSampleAt: null,
  };
}

export function createPitchSample(
  now: number,
  detection: PitchDetection,
  volume: number,
  targetFrequency: number,
  sessionStart: number | null,
): PitchSample {
  const elapsedMs = sessionStart !== null ? now - sessionStart : 0;
  const pitch = detection.frequency;
  const cents = pitch ? hzToCents(pitch, targetFrequency) : null;

  return {
    timeMs: elapsedMs,
    capturedAt: now,
    frequency: pitch,
    midi: pitch ? hzToMidi(pitch) : null,
    note: pitch ? hzToNoteName(pitch) : null,
    centsFromTarget: cents,
    volume,
    clarity: detection.clarity,
  };
}

export function addSampleToSession(
  stats: SessionStats,
  sample: PitchSample,
  tolerance: number,
): SessionStats {
  const previousSample = stats.samples.at(-1);
  const stableDelta =
    stats.lastSampleAt !== null &&
    previousSample?.centsFromTarget !== null &&
    previousSample?.centsFromTarget !== undefined &&
    Math.abs(previousSample.centsFromTarget) <= tolerance &&
    sample.centsFromTarget !== null &&
    Math.abs(sample.centsFromTarget) <= tolerance
      ? sample.capturedAt - stats.lastSampleAt
      : 0;
  const absCents = sample.centsFromTarget === null ? 0 : Math.abs(sample.centsFromTarget);
  const validSampleCount = sample.centsFromTarget === null ? 0 : 1;

  return {
    ...stats,
    samples: [...stats.samples, sample],
    totalAbsCents: stats.totalAbsCents + absCents,
    totalValidSamples: stats.totalValidSamples + validSampleCount,
    stableMs: stats.stableMs + stableDelta,
    lastSampleAt: sample.capturedAt,
  };
}

export function trimSamples(samples: PitchSample[], now: number, graphSeconds: number): PitchSample[] {
  const keepAfter = now - graphSeconds * 1000 - 1000;
  return samples.filter((sample) => sample.capturedAt >= keepAfter);
}

export function createSessionSummary(stats: SessionStats, now: number): SessionSummary {
  const elapsedSec = stats.sessionStart !== null ? (now - stats.sessionStart) / 1000 : 0;
  const recentSamples = stats.samples.filter((sample) => sample.centsFromTarget !== null);
  const recentAverage =
    recentSamples.length === 0
      ? null
      : recentSamples.reduce((sum, sample) => sum + Math.abs(sample.centsFromTarget ?? 0), 0) /
        recentSamples.length;
  const overallAverage =
    stats.totalValidSamples === 0 ? null : stats.totalAbsCents / stats.totalValidSamples;

  return {
    elapsedSec,
    stableSec: stats.stableMs / 1000,
    overallAverage,
    recentAverage,
    formattedOverallAverage: formatPitchGap(overallAverage),
    formattedRecentAverage: formatPitchGap(recentAverage),
  };
}

export function resolveAnalysisStatus(
  sample: PitchSample,
  minRms: number,
  tolerance: number,
): AnalysisStatus {
  const cents = sample.centsFromTarget;

  if (sample.volume < minRms) {
    return "quiet";
  }

  if (sample.frequency === null) {
    return "undetected";
  }

  if (cents !== null && Math.abs(cents) <= tolerance) {
    return "inRange";
  }

  return cents !== null && cents > 0 ? "high" : "low";
}

export function formatAnalysisStatus(status: AnalysisStatus): string {
  switch (status) {
    case "quiet":
      return "音が小さい、または無音です";
    case "undetected":
      return "音程を検出できません";
    case "inRange":
      return "目標範囲内です";
    case "high":
      return "目標より高い傾向です";
    case "low":
      return "目標より低い傾向です";
  }
}
