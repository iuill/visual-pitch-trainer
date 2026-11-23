import { expect, test } from "bun:test";
import { decodeCrepeFrame } from "./crepePitchDetection";
import { pitchBinToFrequency } from "./pitchModelDecoding";
import { decodeRmvpeFrame } from "./rmvpePitchDetection";

test("decodes independent frames and preserves edges, ties and silent frames", () => {
  const bins = 360;
  const activation = new Float32Array(bins * 4);
  activation[0] = 1;
  activation[1] = 0.5;
  activation[4] = 0.25;
  activation[5] = 0.5; // Just outside the averaging window.
  activation[bins + 359] = 1;
  activation[bins + 355] = 0.5;
  activation[2 * bins + 7] = 0.75;
  activation[2 * bins + 8] = 0.25;
  activation[2 * bins + 33] = 0.75; // The first peak wins the tie.

  for (const decode of [decodeCrepeFrame, decodeRmvpeFrame]) {
    const expected = [
      { bin: (0.5 + 4 * 0.25) / 1.75, confidence: 1 },
      { bin: (359 + 355 * 0.5) / 1.5, confidence: 1 },
      { bin: 7 * 0.75 + 8 * 0.25, confidence: 0.75 },
      { bin: 0, confidence: 0 },
    ];
    for (const [index, { bin, confidence }] of expected.entries()) {
      const prediction = decode(activation, index);
      expect(prediction.frequency).toBeCloseTo(pitchBinToFrequency(bin), 10);
      expect(prediction.confidence).toBe(confidence);
    }
  }
});
