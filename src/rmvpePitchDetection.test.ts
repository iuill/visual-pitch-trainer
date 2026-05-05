import { describe, expect, test } from "bun:test";
import {
  createLogMelSpectrogram,
  decodeRmvpeFrame,
} from "./rmvpePitchDetection";

describe("RMVPE pitch detection helpers", () => {
  test("creates a 128-bin log mel spectrogram", () => {
    const sampleRate = 16_000;
    const audioData = new Float32Array(sampleRate);

    for (let index = 0; index < audioData.length; index += 1) {
      audioData[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    }

    const mel = createLogMelSpectrogram(audioData);

    expect(mel.length % 128).toBe(0);
    expect(mel.length / 128).toBeGreaterThan(90);
    expect([...mel].every(Number.isFinite)).toBe(true);
  });

  test("decodes an RMVPE activation frame with local averaging", () => {
    const activation = new Float32Array(360);
    activation[100] = 0.2;
    activation[101] = 0.8;
    activation[102] = 0.4;

    const result = decodeRmvpeFrame(activation, 0);

    expect(result.confidence).toBeCloseTo(0.8, 6);
    expect(result.frequency).toBeGreaterThan(95);
    expect(result.frequency).toBeLessThan(105);
  });
});
