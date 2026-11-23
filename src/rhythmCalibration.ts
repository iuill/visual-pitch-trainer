export type RhythmGuide = "visual" | "audio";

export const CALIBRATION_TAPS = 12;
export const CALIBRATION_BEAT_MS = 750;
export const CALIBRATION_COUNTDOWN_MS = 3000;

export function calibrationTapIndex(tapMs: number, startMs: number): number {
  if (tapMs < startMs) return -1;
  const index = Math.round((tapMs - startMs) / CALIBRATION_BEAT_MS);
  return index >= 0 && index < CALIBRATION_TAPS ? index : -1;
}

export function measureRhythmOffset(
  offsets: readonly (number | null)[],
): number | null {
  if (
    offsets.length !== CALIBRATION_TAPS ||
    offsets.some((offset) => offset === null || !Number.isFinite(offset))
  )
    return null;
  const samples = offsets
    .slice(4)
    .filter((offset): offset is number => offset !== null);
  const mean =
    samples.reduce((sum, offset) => sum + offset, 0) / samples.length;
  const spread = Math.sqrt(
    samples.reduce((sum, offset) => sum + (offset - mean) ** 2, 0) /
      samples.length,
  );
  if (spread > 60) return null;
  samples.sort((a, b) => a - b);
  return (samples[3] + samples[4]) / 2;
}

export function rhythmEventTimeMs(
  audioNowSeconds: number,
  eventTimestamp: number,
  performanceTimeMs: number,
  outputLatencyMs: number,
): number {
  return (
    audioNowSeconds * 1000 +
    eventTimestamp -
    performanceTimeMs -
    outputLatencyMs
  );
}
