export type RhythmGuide = "visual" | "audio";

export const CALIBRATION_PREP_BEATS = 4;
export const CALIBRATION_TAPS = 8;
export const CALIBRATION_BEAT_MS = 750;
export const CALIBRATION_COUNTDOWN_MS = 3000;

export function calibrationTapIndex(tapMs: number, startMs: number): number {
  const index = Math.floor(
    (tapMs - startMs + CALIBRATION_BEAT_MS / 2) / CALIBRATION_BEAT_MS,
  );
  return index >= 0 && index < CALIBRATION_TAPS ? index : -1;
}

export function measureRhythmOffset(
  offsets: readonly (number | null)[],
): number | null {
  if (offsets.length !== CALIBRATION_TAPS) return null;
  const samples = offsets.filter(
    (offset): offset is number => offset !== null && Number.isFinite(offset),
  );
  if (samples.length !== offsets.length) return null;
  const mean =
    samples.reduce((sum, offset) => sum + offset, 0) / samples.length;
  const spread = Math.sqrt(
    samples.reduce((sum, offset) => sum + (offset - mean) ** 2, 0) /
      samples.length,
  );
  if (spread > 60) return null;
  samples.sort((a, b) => a - b);
  const middle = samples.length / 2;
  return (samples[Math.ceil(middle) - 1] + samples[Math.floor(middle)]) / 2;
}

export function rhythmEventTimeMs(
  context: Pick<AudioContext, "currentTime"> &
    Partial<
      Pick<AudioContext, "outputLatency" | "baseLatency" | "getOutputTimestamp">
    >,
  eventTimestamp: number,
  guide: RhythmGuide,
  performanceTimeMs: number,
): number {
  let seconds = context.currentTime;
  if (guide === "audio") {
    const stamp = context.getOutputTimestamp?.();
    if (
      stamp?.contextTime !== undefined &&
      stamp.performanceTime !== undefined &&
      Number.isFinite(stamp.contextTime) &&
      Number.isFinite(stamp.performanceTime) &&
      stamp.contextTime >= 0 &&
      stamp.performanceTime > 0
    )
      return stamp.contextTime * 1000 + eventTimestamp - stamp.performanceTime;
    seconds -= context.outputLatency ?? context.baseLatency ?? 0;
  }
  return seconds * 1000 + eventTimestamp - performanceTimeMs;
}
