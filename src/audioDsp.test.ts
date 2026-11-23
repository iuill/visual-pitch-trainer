import { expect, test } from "bun:test";
import { createPeriodicHannWindow, fftInPlace, reflectPad } from "./audioDsp";

test("applies the forward FFT with the original sign and scale", () => {
  const real = Float32Array.of(1, 2, 3, 4);
  const imag = new Float32Array(4);
  fftInPlace(real, imag);
  expect([...real]).toEqual([10, -2, -2, -2]);
  expect([...imag]).toEqual([0, 2, 0, -2]);
});

test("creates a periodic Hann window", () => {
  expect([...createPeriodicHannWindow(4)]).toEqual([0, 0.5, 1, 0.5]);
  expect([...createPeriodicHannWindow(1)]).toEqual([0]);
});

test("preserves the model-specific padding when reflection reaches the far edge", () => {
  const signal = Float32Array.of(1, 2, 3);
  const repeated = "repeat-reflection";
  const single = "single-reflection";

  expect([...reflectPad(signal, 2, repeated)]).toEqual([3, 2, 1, 2, 3, 2, 1]);
  expect(reflectPad(signal, 2, single)).toEqual(
    reflectPad(signal, 2, repeated),
  );
  expect([...reflectPad(signal, 4, repeated)]).toEqual([
    1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3,
  ]);
  expect([...reflectPad(signal, 4, single)]).toEqual([
    0, 0, 3, 2, 1, 2, 3, 2, 1, 1, 1,
  ]);
  expect([...reflectPad(Float32Array.of(5), 2, repeated)]).toEqual([
    5, 5, 5, 5, 5,
  ]);
  expect([...reflectPad(Float32Array.of(5), 2, single)]).toEqual([
    0, 0, 5, 5, 5,
  ]);
  expect([...reflectPad(new Float32Array(0), 2, repeated)]).toEqual([
    0, 0, 0, 0,
  ]);
  expect([...reflectPad(new Float32Array(0), 2, single)]).toEqual([0, 0, 0, 0]);
});
