export type Note = {
  solfege: string;
  name: string;
  frequency: number;
};

export type PitchCandidate = {
  frequency: number;
  confidence: number;
  source: "yin" | "macleod";
};

export const SOLFEGE_NAMES = [
  "ド",
  "ド#",
  "レ",
  "レ#",
  "ミ",
  "ファ",
  "ファ#",
  "ソ",
  "ソ#",
  "ラ",
  "ラ#",
  "シ",
  "ド",
] as const;

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const DETECTION_MIN_HZ = 80;
const DETECTION_MAX_HZ = 1600;
const MIN_CLARITY = 0.52;
const TARGET_DISTANCE_CONFIDENCE_WEIGHT = 0.18;

export function buildNoteRange(startMidi: number): Note[] {
  return SOLFEGE_NAMES.map((solfege, index) => {
    const midi = startMidi + index;

    return {
      solfege,
      name: midiToNoteName(midi),
      frequency: midiToFrequency(midi),
    };
  });
}

export function chooseBestLibraryPitch(
  candidates: PitchCandidate[],
  targetFrequency: number,
): PitchCandidate | null {
  const targetMinHz = Math.max(DETECTION_MIN_HZ, targetFrequency / 2);
  const targetMaxHz = Math.min(DETECTION_MAX_HZ, targetFrequency * 2);
  let bestCandidate: PitchCandidate | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.frequency) ||
      candidate.frequency < targetMinHz ||
      candidate.frequency > targetMaxHz
    ) {
      continue;
    }

    const distanceSemitones = Math.abs(
      12 * Math.log2(candidate.frequency / targetFrequency),
    );
    const sourceBonus = candidate.source === "yin" ? 0 : 0.04;
    const score =
      distanceSemitones * TARGET_DISTANCE_CONFIDENCE_WEIGHT +
      (1 - candidate.confidence) +
      sourceBonus;

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestCandidate.confidence < MIN_CLARITY) {
    return null;
  }

  return bestCandidate;
}

export function formatPitchGap(value: number | null): string {
  return value === null ? "--" : `半音の${Math.round(value)}%`;
}

export function getRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    sum += buffer[i] * buffer[i];
  }

  return Math.sqrt(sum / buffer.length);
}

export function hzToCents(frequency: number, targetFrequency: number): number {
  return 1200 * Math.log2(frequency / targetFrequency);
}

export function hzToNoteName(frequency: number): string {
  const midi = Math.round(hzToMidi(frequency));
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

export function hzToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

export function midiToSolfegeName(midi: number): string {
  const rounded = Math.round(midi);
  return SOLFEGE_NAMES[((rounded % 12) + 12) % 12];
}
