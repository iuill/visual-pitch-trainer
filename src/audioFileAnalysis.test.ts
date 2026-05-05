import { describe, expect, test } from "bun:test";
import {
  analyzeAudioData,
  formatDuration,
  formatMidiRange,
  getVoiceCoverage,
  refineAudioPitchPoints,
  summarizeVoiceRange,
} from "./audioFileAnalysis";
import { midiToFrequency } from "./pitchMath";

describe("audio file analysis", () => {
  test("summarizes voice range with robust and common ranges", () => {
    const summary = summarizeVoiceRange(
      [
        { timeMs: 0, frequency: null, midi: null, clarity: null, volume: 0 },
        { timeMs: 20, frequency: 220, midi: 57, clarity: 0.9, volume: 0.2 },
        { timeMs: 40, frequency: 261, midi: 60, clarity: 0.9, volume: 0.2 },
        { timeMs: 60, frequency: 330, midi: 64, clarity: 0.9, volume: 0.2 },
      ],
      4,
      0.02,
    );

    expect(summary.analyzedFrames).toBe(4);
    expect(summary.validFrames).toBe(3);
    expect(summary.voicedSec).toBeCloseTo(0.06, 8);
    expect(summary.lowestMidi).toBe(57);
    expect(summary.highestMidi).toBe(64);
    expect(summary.medianMidi).toBe(60);
    expect(formatMidiRange(summary.lowestMidi, summary.highestMidi)).toBe(
      "A3 - E4",
    );
    expect(getVoiceCoverage(summary)).toBeCloseTo(0.75, 8);
  });

  test("reports empty summaries when no voiced frames are found", () => {
    const summary = summarizeVoiceRange(
      [{ timeMs: 0, frequency: null, midi: null, clarity: null, volume: 0 }],
      1,
      0.02,
    );

    expect(summary.validFrames).toBe(0);
    expect(summary.lowestMidi).toBeNull();
    expect(formatMidiRange(summary.lowestMidi, summary.highestMidi)).toBe("--");
    expect(getVoiceCoverage(summary)).toBe(0);
  });

  test("detects a stable synthetic tone", () => {
    const sampleRate = 44_100;
    const frequency = midiToFrequency(60);
    const audioData = new Float32Array(sampleRate);

    for (let index = 0; index < audioData.length; index += 1) {
      audioData[index] = Math.sin(
        (2 * Math.PI * frequency * index) / sampleRate,
      );
    }

    const result = analyzeAudioData(audioData, {
      sampleRate,
      minRms: 0.001,
      minClarity: 0.7,
    });

    expect(result.summary.validFrames).toBeGreaterThan(10);
    expect(result.summary.medianMidi).toBeCloseTo(60, 0);
  });

  test("rejects pitch spikes far above the global voice range", () => {
    const points = [
      ...Array.from({ length: 20 }, (_, index) => ({
        timeMs: index * 20,
        frequency: 220,
        midi: 57,
        clarity: 0.9,
        volume: 0.2,
      })),
      {
        timeMs: 420,
        frequency: 659,
        midi: 76,
        clarity: 0.86,
        volume: 0.2,
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        timeMs: 440 + index * 20,
        frequency: 233,
        midi: 58,
        clarity: 0.9,
        volume: 0.2,
      })),
    ];

    const refined = refineAudioPitchPoints(points);

    expect(refined.at(20)?.midi).toBeNull();
  });

  test("keeps short but continuous phrases outside the common range", () => {
    const points = [
      ...Array.from({ length: 40 }, (_, index) => ({
        timeMs: index * 20,
        frequency: 220,
        midi: 57,
        clarity: 0.9,
        volume: 0.2,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        timeMs: 800 + index * 20,
        frequency: 659,
        midi: 76,
        clarity: 0.86,
        volume: 0.2,
      })),
      ...Array.from({ length: 40 }, (_, index) => ({
        timeMs: 960 + index * 20,
        frequency: 233,
        midi: 58,
        clarity: 0.9,
        volume: 0.2,
      })),
    ];

    const refined = refineAudioPitchPoints(points);

    expect(refined.slice(40, 48).every((point) => point.midi === 76)).toBe(
      true,
    );
  });

  test("formats durations for short and minute-long audio", () => {
    expect(formatDuration(12.34)).toBe("12.3秒");
    expect(formatDuration(125.2)).toBe("2分05秒");
  });
});
