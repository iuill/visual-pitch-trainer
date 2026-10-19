import { describe, expect, test } from "bun:test";
import { LiveMdxTransform, MixedRadixFft } from "./liveMdxTransform";
import {
  LiveSampleBuffer,
  MDX_SAMPLES,
  stemsAreAmbiguous,
  updateLiveMatch,
} from "./liveSeparation";

describe("live capture and comparison", () => {
  test("bounded buffer keeps newest samples while inference is busy", () => {
    const buffer = new LiveSampleBuffer(4);
    buffer.push(new Float32Array([1, 2]));
    expect(buffer.snapshot()).toBeNull();
    buffer.push(new Float32Array([3, 4, 5]));
    expect(Array.from(buffer.snapshot() ?? [])).toEqual([2, 3, 4, 5]);
    buffer.push(new Float32Array([6, 7, 8, 9, 10]));
    expect(Array.from(buffer.snapshot() ?? [])).toEqual([7, 8, 9, 10]);
  });
  test("identical leaked stems, missing stems and very unequal levels are ambiguous", () => {
    const wave = Float32Array.from({ length: 4096 }, (_, i) =>
      Math.sin(i / 16),
    );
    expect(stemsAreAmbiguous(wave, wave)).toBe(true);
    expect(stemsAreAmbiguous(wave, new Float32Array(4096))).toBe(true);
    expect(
      stemsAreAmbiguous(
        wave,
        wave.map((v) => v * 0.001),
      ),
    ).toBe(true);
    expect(
      stemsAreAmbiguous(
        wave,
        Float32Array.from({ length: 4096 }, (_, i) => Math.cos(i / 13)),
      ),
    ).toBe(false);
  });
  test("match requires continuous, unambiguous two-stem observations without octave folding", () => {
    let state = {
      lastTimeMs: null as number | null,
      targetMidi: null as number | null,
      heldMs: 0,
    };
    const point = { timeMs: 0, pianoHz: 440, voiceHz: 440, uncertain: false };
    for (let i = 0; i <= 12; i++)
      state = updateLiveMatch(state, { ...point, timeMs: i * 50 }, 25);
    expect(state.heldMs).toBe(600);
    expect(
      updateLiveMatch(state, { ...point, timeMs: 650, uncertain: true }, 25)
        .heldMs,
    ).toBe(0);
    expect(updateLiveMatch(state, { ...point, timeMs: 900 }, 25).heldMs).toBe(
      0,
    );
    expect(
      updateLiveMatch(state, { ...point, timeMs: 650, voiceHz: 880 }, 25)
        .heldMs,
    ).toBe(0);
    expect(
      updateLiveMatch(state, { ...point, timeMs: 650, pianoHz: null }, 25)
        .heldMs,
    ).toBe(0);
    expect(
      updateLiveMatch(
        state,
        { ...point, timeMs: 650, pianoHz: 466, voiceHz: 466 },
        25,
      ).heldMs,
    ).toBe(0);
  });
});

describe("MDX transforms", () => {
  test("mixed-radix FFT agrees with direct DFT, including sign and complex input", () => {
    const n = 30;
    const re = Float64Array.from(
      { length: n },
      (_, i) => Math.sin(i / 2) + i / n,
    );
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i / 3));
    const fft = new MixedRadixFft(n);
    fft.run(re, im);
    for (let k = 0; k < n; k++) {
      let expectedReal = 0;
      let expectedImag = 0;
      for (let i = 0; i < n; i++) {
        const a = (-2 * Math.PI * k * i) / n;
        expectedReal += re[i] * Math.cos(a) - im[i] * Math.sin(a);
        expectedImag += re[i] * Math.sin(a) + im[i] * Math.cos(a);
      }
      expect(fft.real[k]).toBeCloseTo(expectedReal, 8);
      expect(fft.imag[k]).toBeCloseTo(expectedImag, 8);
    }
    const transformedReal = fft.real.slice();
    const transformedImag = fft.imag.slice();
    fft.run(transformedReal, transformedImag, true);
    for (let i = 0; i < n; i++) {
      expect(fft.real[i]).toBeCloseTo(re[i], 8);
      expect(fft.imag[i]).toBeCloseTo(im[i], 8);
    }
  });
  test("MDX STFT and inverse preserve amplitude and timing in both channels", () => {
    const source = Float32Array.from(
      { length: MDX_SAMPLES },
      (_, i) =>
        0.2 * Math.sin((2 * Math.PI * 440 * i) / 44100) +
        0.1 * Math.cos((2 * Math.PI * 880 * i) / 44100),
    );
    const stft = new LiveMdxTransform();
    const result = stft.inverse(stft.forward(source));
    let error = 0;
    // Masking low/high bins affects the reflected edges; evaluate stable interior.
    for (let i = 7680; i < source.length - 7680; i++)
      error += (source[i] - result[i]) ** 2;
    expect(Math.sqrt(error / (source.length - 15360))).toBeLessThan(0.0001);
  });
});
