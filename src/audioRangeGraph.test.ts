import { expect, test } from "bun:test";
import type { AudioPitchPoint } from "./audioFileAnalysis";
import { audioPitchLabelAt } from "./audioRangeGraph";

test("playback pitch labels pick the nearest voiced point within 300 ms", () => {
  const points: AudioPitchPoint[] = [
    { timeMs: 1000, midi: 60, frequency: 261.63, clarity: 0.9, volume: 0.2 },
    { timeMs: 1100, midi: null, frequency: null, clarity: null, volume: 0 },
    { timeMs: 1200, midi: 62, frequency: 293.66, clarity: 0.9, volume: 0.2 },
  ];

  expect(audioPitchLabelAt(points, 699)).toBeNull();
  expect(audioPitchLabelAt(points, 700)).toMatch(/C4$/);
  expect(audioPitchLabelAt(points, 1100)).toMatch(/C4$/);
  expect(audioPitchLabelAt(points, 1101)).toMatch(/D4$/);
  expect(audioPitchLabelAt(points, 1500)).toMatch(/D4$/);
  expect(audioPitchLabelAt(points, 1501)).toBeNull();
});
