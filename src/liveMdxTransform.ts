import {
  MDX_BINS,
  MDX_FFT,
  MDX_FRAMES,
  MDX_HOP,
  MDX_SAMPLES,
} from "./liveSeparation";

/** Mixed-radix FFT, including the 3 and 5 factors of MDX's 7680-sample window.
 * Scratch buffers and twiddles are reused across frames. No pitch estimation here.
 */
export class MixedRadixFft {
  readonly real: Float64Array;
  readonly imag: Float64Array;
  private readonly radix: number;
  private readonly child: MixedRadixFft | null;
  private readonly scratchReal: Float64Array;
  private readonly scratchImag: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly size: number) {
    this.radix =
      size === 1 ? 1 : ([2, 3, 5].find((n) => size % n === 0) ?? size);
    this.child = size === 1 ? null : new MixedRadixFft(size / this.radix);
    this.real = new Float64Array(size);
    this.imag = new Float64Array(size);
    this.scratchReal = new Float64Array(size);
    this.scratchImag = new Float64Array(size);
    this.cos = Float64Array.from({ length: size }, (_, i) =>
      Math.cos((2 * Math.PI * i) / size),
    );
    this.sin = Float64Array.from({ length: size }, (_, i) =>
      Math.sin((2 * Math.PI * i) / size),
    );
  }
  run(
    real: ArrayLike<number>,
    imag?: ArrayLike<number>,
    inverse = false,
    offset = 0,
    stride = 1,
  ) {
    if (!this.child) {
      this.real[0] = real[offset];
      this.imag[0] = imag?.[offset] ?? 0;
      return;
    }
    const width = this.size / this.radix;
    for (let q = 0; q < this.radix; q++) {
      this.child.run(
        real,
        imag,
        inverse,
        offset + q * stride,
        stride * this.radix,
      );
      this.scratchReal.set(this.child.real, q * width);
      this.scratchImag.set(this.child.imag, q * width);
    }
    const sign = inverse ? 1 : -1;
    for (let k = 0; k < this.size; k++) {
      let re = 0;
      let im = 0;
      for (let q = 0; q < this.radix; q++) {
        const at = q * width + (k % width);
        const twiddle = (q * k) % this.size;
        const c = this.cos[twiddle];
        const s = sign * this.sin[twiddle];
        re += this.scratchReal[at] * c - this.scratchImag[at] * s;
        im += this.scratchReal[at] * s + this.scratchImag[at] * c;
      }
      // Each level normalizes by its radix, yielding 1/N overall for inverse.
      this.real[k] = inverse ? re / this.radix : re;
      this.imag[k] = inverse ? im / this.radix : im;
    }
  }
}

export class LiveMdxTransform {
  private readonly fft = new MixedRadixFft(MDX_FFT);
  private readonly window = Float64Array.from(
    { length: MDX_FFT },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / MDX_FFT),
  );
  private readonly re = new Float64Array(MDX_FFT);
  private readonly im = new Float64Array(MDX_FFT);

  /** Mono microphone is duplicated as stereo. Layout: L real, L imag, R real, R imag. */
  forward(samples: Float32Array): Float32Array {
    if (samples.length !== MDX_SAMPLES)
      throw new Error("MDX入力の長さが不正です。");
    const output = new Float32Array(4 * MDX_BINS * MDX_FRAMES);
    const plane = MDX_BINS * MDX_FRAMES;
    for (let t = 0; t < MDX_FRAMES; t++) {
      for (let i = 0; i < MDX_FFT; i++) {
        let at = t * MDX_HOP + i - MDX_FFT / 2;
        if (at < 0) at = -at;
        if (at >= samples.length) at = 2 * samples.length - at - 2;
        this.re[i] = samples[at] * this.window[i];
      }
      this.fft.run(this.re);
      for (let f = 3; f < MDX_BINS; f++) {
        const at = f * MDX_FRAMES + t;
        output[at] = output[2 * plane + at] = this.fft.real[f];
        output[plane + at] = output[3 * plane + at] = this.fft.imag[f];
      }
    }
    return output;
  }

  /** Reconstruct both predicted channels, averaging only after inverse STFT. */
  inverse(spectrum: Float32Array): Float32Array {
    if (spectrum.length !== 4 * MDX_BINS * MDX_FRAMES)
      throw new Error("MDX出力の形が不正です。");
    const length = MDX_SAMPLES + MDX_FFT;
    const envelope = new Float64Array(length);
    const sum = new Float64Array(length);
    const plane = MDX_BINS * MDX_FRAMES;
    for (let t = 0; t < MDX_FRAMES; t++) {
      for (let i = 0; i < MDX_FFT; i++)
        envelope[t * MDX_HOP + i] += this.window[i] ** 2;
      for (let channel = 0; channel < 2; channel++) {
        this.re.fill(0);
        this.im.fill(0);
        for (let f = 0; f < MDX_BINS; f++) {
          const at = 2 * channel * plane + f * MDX_FRAMES + t;
          this.re[f] = spectrum[at];
          this.im[f] = spectrum[at + plane];
          if (f > 0) {
            this.re[MDX_FFT - f] = this.re[f];
            this.im[MDX_FFT - f] = -this.im[f];
          }
        }
        this.fft.run(this.re, this.im, true);
        for (let i = 0; i < MDX_FFT; i++)
          sum[t * MDX_HOP + i] += (this.fft.real[i] * this.window[i]) / 2;
      }
    }
    return Float32Array.from({ length: MDX_SAMPLES }, (_, i) => {
      const at = i + MDX_FFT / 2;
      return sum[at] / Math.max(envelope[at], 1e-8);
    });
  }
}
