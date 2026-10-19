export type ReferenceSample = {
  file: string;
  midi: number;
  rootFrequency: number;
};

type ReferenceInstrument = {
  id: string;
  label: string;
  description: string;
} & (
  | { kind: "oscillator" }
  | {
      kind: "samples";
      samples: readonly ReferenceSample[];
      repeatSeconds: number;
      noteSeconds: number;
    }
);

// VCSL uses C3 for middle C (MIDI 60). These file names use scientific pitch.
// rootFrequency is the median pitchy estimate from 0.2–1.5s of each recording.
export const PIANO_SAMPLES: readonly ReferenceSample[] = [
  { file: "c3.wav", midi: 48, rootFrequency: 130.622537 },
  { file: "e3.wav", midi: 52, rootFrequency: 164.25826 },
  { file: "gs3.wav", midi: 56, rootFrequency: 207.136728 },
  { file: "c4.wav", midi: 60, rootFrequency: 261.357876 },
  { file: "e4.wav", midi: 64, rootFrequency: 328.541162 },
  { file: "gs4.wav", midi: 68, rootFrequency: 414.519652 },
  { file: "c5.wav", midi: 72, rootFrequency: 521.830892 },
  { file: "e5.wav", midi: 76, rootFrequency: 658.50811 },
  { file: "gs5.wav", midi: 80, rootFrequency: 830.496458 },
  { file: "c6.wav", midi: 84, rootFrequency: 1046.164375 },
];

export const REFERENCE_INSTRUMENTS = {
  sine: {
    id: "sine",
    label: "正弦波",
    description: "同じ音を鳴らし続けます。",
    kind: "oscillator",
  },
  piano: {
    id: "piano",
    label: "ピアノ",
    description: "生ピアノの録音です。お手本音は約2.5秒ごとに鳴ります。",
    kind: "samples",
    samples: PIANO_SAMPLES,
    repeatSeconds: 2.5,
    noteSeconds: 2.4,
  },
} as const satisfies Record<string, ReferenceInstrument>;

export type ReferenceInstrumentId = keyof typeof REFERENCE_INSTRUMENTS;

export function isReferenceInstrumentId(
  value: string,
): value is ReferenceInstrumentId {
  return Object.hasOwn(REFERENCE_INSTRUMENTS, value);
}

export function findNearestSample(
  samples: readonly ReferenceSample[],
  frequency: number,
): ReferenceSample {
  if (samples.length === 0 || !Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("Invalid reference note or empty instrument.");
  }
  return samples.reduce((best, sample) =>
    Math.abs(Math.log2(frequency / sample.rootFrequency)) <
    Math.abs(Math.log2(frequency / best.rootFrequency))
      ? sample
      : best,
  );
}
