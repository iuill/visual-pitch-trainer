export type Note = {
  solfege: string;
  name: string;
  frequency: number;
};

export type PitchCandidate = {
  frequency: number;
  confidence: number;
  source: "pitchy";
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
    const score =
      distanceSemitones * TARGET_DISTANCE_CONFIDENCE_WEIGHT +
      (1 - candidate.confidence);

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

// Use the same sharp spelling as midiToNoteName(), not a semitone-only lookup.
// For example, C–D# is an augmented second while D–F is a minor third.
function intervalName(fromMidi: number, toMidi: number): string {
  const diatonicIndex = (midi: number) =>
    Math.floor(midi / 12) * 7 + "CDEFGAB".indexOf(midiToNoteName(midi)[0]);
  const steps = Math.abs(diatonicIndex(toMidi) - diatonicIndex(fromMidi));
  const simple = steps % 7;
  const normal = [0, 2, 4, 5, 7, 9, 11][simple] + Math.floor(steps / 7) * 12;
  const adjustment = Math.abs(toMidi - fromMidi) - normal;
  const perfect = simple === 0 || simple === 3 || simple === 4;
  const quality =
    adjustment === 0
      ? perfect
        ? "完全"
        : "長"
      : adjustment === -1 && !perfect
        ? "短"
        : adjustment > 0
          ? "増"
          : "減";
  return `${quality}${steps + 1}度`;
}

/** Adjacent target notes, rather than the microphone's momentary pitch error. */
export function formatPitchMovement(
  fromFrequency: number,
  toFrequency: number,
  compact = false,
): string {
  const fromMidi = Math.round(hzToMidi(fromFrequency));
  const toMidi = Math.round(hzToMidi(toFrequency));
  const semitones = toMidi - fromMidi;
  if (semitones === 0) return "同じ高さ";
  const distance = Math.abs(semitones);
  const direction = semitones > 0 ? "上がる" : "下がる";
  const name = intervalName(fromMidi, toMidi);
  if (compact) {
    const amount =
      distance === 1
        ? "半音"
        : distance === 2
          ? "全音"
          : distance === 12
            ? "1オクターブ"
            : name;
    return amount;
  }
  if (distance === 1) return `半音${direction}`;
  if (distance === 2) return `全音${direction}（2半音）`;
  if (distance === 12) return `1オクターブ${direction}（12半音）`;
  return `${name}${direction}（${distance}半音）`;
}
