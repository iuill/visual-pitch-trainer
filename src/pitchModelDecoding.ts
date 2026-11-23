const PITCH_BIN_COUNT = 360;
const FIRST_BIN_CENTS = 1997.3794084376191;
const CENTS_PER_BIN = 20;
const WEIGHTED_ARGMAX_RADIUS = 4;

function binToCents(bin: number): number {
  return FIRST_BIN_CENTS + CENTS_PER_BIN * bin;
}

function centsToFrequency(cents: number): number {
  return 10 * 2 ** (cents / 1200);
}

export function pitchBinToFrequency(bin: number): number {
  return centsToFrequency(binToCents(bin));
}

export function decodePitchModelFrame(
  activation: Float32Array,
  frameIndex: number,
  averaging: "bins" | "cents",
): { frequency: number; confidence: number } {
  const offset = frameIndex * PITCH_BIN_COUNT;
  let maxIndex = 0;
  let confidence = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < PITCH_BIN_COUNT; index += 1) {
    const value = activation[offset + index] ?? 0;
    if (value > confidence) {
      confidence = value;
      maxIndex = index;
    }
  }

  // The two models historically average in different units. Keep the operation
  // order for each one to preserve rounding at the decoder boundary.
  const useCents = averaging === "cents";
  const start = Math.max(0, maxIndex - WEIGHTED_ARGMAX_RADIUS);
  const end = Math.min(PITCH_BIN_COUNT - 1, maxIndex + WEIGHTED_ARGMAX_RADIUS);
  let weightedSum = 0;
  let weightTotal = 0;
  for (let index = start; index <= end; index += 1) {
    const weight = Math.max(0, activation[offset + index] ?? 0);
    weightedSum += (useCents ? binToCents(index) : index) * weight;
    weightTotal += weight;
  }

  const peak = useCents ? binToCents(maxIndex) : maxIndex;
  const estimate = weightTotal > 0 ? weightedSum / weightTotal : peak;
  return {
    frequency: useCents
      ? centsToFrequency(estimate)
      : pitchBinToFrequency(estimate),
    confidence: Math.max(0, confidence),
  };
}
