/** Forward transform over equally sized buffers whose length is a power of two. */
export function fftInPlace(real: Float32Array, imag: Float32Array) {
  const length = real.length;
  for (let index = 1, reverseIndex = 0; index < length; index += 1) {
    let bit = length >> 1;

    for (; reverseIndex & bit; bit >>= 1) {
      reverseIndex ^= bit;
    }

    reverseIndex ^= bit;

    if (index < reverseIndex) {
      const realValue = real[index] ?? 0;
      real[index] = real[reverseIndex] ?? 0;
      real[reverseIndex] = realValue;

      const imagValue = imag[index] ?? 0;
      imag[index] = imag[reverseIndex] ?? 0;
      imag[reverseIndex] = imagValue;
    }
  }

  for (let fftLength = 2; fftLength <= length; fftLength <<= 1) {
    const halfLength = fftLength >> 1;
    const angle = (-2 * Math.PI) / fftLength;
    const twiddleReal = Math.cos(angle);
    const twiddleImag = Math.sin(angle);

    for (let offset = 0; offset < length; offset += fftLength) {
      let currentReal = 1;
      let currentImag = 0;

      for (let index = 0; index < halfLength; index += 1) {
        const leftIndex = offset + index;
        const rightIndex = leftIndex + halfLength;
        const tempReal =
          currentReal * (real[rightIndex] ?? 0) -
          currentImag * (imag[rightIndex] ?? 0);
        const tempImag =
          currentReal * (imag[rightIndex] ?? 0) +
          currentImag * (real[rightIndex] ?? 0);

        real[rightIndex] = (real[leftIndex] ?? 0) - tempReal;
        imag[rightIndex] = (imag[leftIndex] ?? 0) - tempImag;
        real[leftIndex] = (real[leftIndex] ?? 0) + tempReal;
        imag[leftIndex] = (imag[leftIndex] ?? 0) + tempImag;

        const nextCurrentReal =
          currentReal * twiddleReal - currentImag * twiddleImag;
        currentImag = currentReal * twiddleImag + currentImag * twiddleReal;
        currentReal = nextCurrentReal;
      }
    }
  }
}

export function createPeriodicHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / length));
  }

  return window;
}

/** A single reflection fills the remaining left pad with zeros and holds the first sample on the right. */
export function reflectPad(
  signal: Float32Array,
  padSize: number,
  edgeMode: "repeat-reflection" | "single-reflection",
): Float32Array {
  const length = signal.length;
  const padded = new Float32Array(length + padSize * 2);
  if (length === 0) return padded;
  padded.set(signal, padSize);

  const repeats = edgeMode === "repeat-reflection" && padSize >= length;
  const period = 2 * (length - 1);
  for (let distance = 1; distance <= padSize; distance += 1) {
    let offset = distance;
    if (repeats) {
      const step = period === 0 ? 0 : distance % period;
      offset = Math.min(step, period - step);
    }
    padded[padSize - distance] = signal[offset] ?? 0;
    padded[padSize + length + distance - 1] =
      signal[Math.max(0, length - 1 - offset)] ?? 0;
  }
  return padded;
}
