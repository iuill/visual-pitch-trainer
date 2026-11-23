import type { GeneratedInstrument } from "./generatedInstruments";
import type { ReferenceInstrumentId } from "./referenceInstruments";
import {
  RHYTHM_NOTE_BEATS,
  type RhythmStep,
  rhythmBeatAccent,
  rhythmPulseUnits,
  rhythmSlotsPerBeat,
} from "./rhythmCourse";
import { createRhythmTargets } from "./rhythmJudge";

const songDrums = [
  "kick",
  "snare",
  "hi-hat",
  "high-tom",
  "low-tom",
  "crash",
  "ride",
] as const;
export type SongDrum = (typeof songDrums)[number];
const sampleInstruments = [
  "piano",
  "violin",
  "flute",
] as const satisfies readonly ReferenceInstrumentId[];
type SampleInstrument = (typeof sampleInstruments)[number];
export type SongInstrument = SampleInstrument | GeneratedInstrument;

export interface SongPart {
  lead: SongInstrument;
  keys:
    | "arpeggio"
    | "offbeats"
    | "ostinato"
    | "held"
    | "mellotron"
    | "symphonic"
    | "power-chords"
    | "muted-power-chords";
  support?: "violin" | "flute";
  drums?: Partial<Record<SongDrum, string>>;
  fill?: Partial<Record<"high-tom" | "low-tom", string>>;
}

export interface SongBar {
  chord: readonly [bass: number, fifth: number, third: number];
  part: SongPart;
  entrance: boolean;
  fill: boolean;
  ending: boolean;
  bends?: Readonly<Record<number, number>>;
}

type SongEvent =
  | { timeMs: number; drum: SongDrum; level: number }
  | {
      timeMs: number;
      instrument: SongInstrument;
      midi: number;
      seconds: number;
      level: number;
      bendSemitones?: number;
    };

const drumLevels: Record<SongDrum, number> = {
  kick: 0.4,
  snare: 0.26,
  "hi-hat": 0.13,
  "high-tom": 0.24,
  "low-tom": 0.28,
  crash: 0.31,
  ride: 0.17,
};

export function songSampleInstruments(
  step: RhythmStep,
): readonly SampleInstrument[] {
  const { arrangement } = step;
  if (!arrangement) return ["piano"];
  const requested = new Set<SongInstrument>();
  for (const { part } of arrangement) {
    requested.add(part.lead);
    if (part.support) requested.add(part.support);
    if (
      part.lead === "violin" ||
      part.lead === "flute" ||
      (part.keys !== "power-chords" &&
        part.keys !== "muted-power-chords" &&
        part.keys !== "symphonic")
    )
      requested.add("piano");
    if (part.keys === "symphonic" || part.keys === "mellotron")
      requested.add("violin");
  }
  return sampleInstruments.filter((instrument) => requested.has(instrument));
}

export function songDrumsForStep(step: RhythmStep): readonly SongDrum[] {
  return songDrums.filter(
    (drum) =>
      drum === "kick" ||
      step.arrangement?.some(
        ({ part }) =>
          part.drums?.[drum] ||
          ((drum === "high-tom" || drum === "low-tom") && part.fill?.[drum]),
      ),
  );
}

export function buildSongEvents(
  step: RhythmStep,
  from: number,
  to: number,
  startMs: number,
  footGuide: boolean,
): SongEvent[] {
  const slotsPerPulse = rhythmSlotsPerBeat(step);
  const slotMs = 60_000 / (step.bpm * slotsPerPulse);
  const events: SongEvent[] = [];
  const { arrangement, melody } = step;
  if (!arrangement || !melody || from >= to) return events;
  const patterns = step.patterns.slice(from, to);
  const length = patterns[0].length;
  for (const [index, pattern] of patterns.entries()) {
    const bar = from + index;
    const {
      chord: [bass, fifth, third],
      part,
      entrance,
      fill,
      ending,
      bends,
    } = arrangement[bar];
    const barStart = startMs + index * length * slotMs;
    function note(
      instrument: SongInstrument,
      midi: number,
      slot: number,
      duration: number,
      level: number,
      bendSemitones?: number,
    ) {
      events.push({
        timeMs: barStart + slot * slotMs,
        instrument,
        midi,
        seconds: (Math.min(duration, length - slot) * slotMs) / 1000,
        level,
        bendSemitones,
      });
    }
    function drum(id: SongDrum, slot: number, level: number) {
      events.push({ timeMs: barStart + slot * slotMs, drum: id, level });
    }

    const targets = createRhythmTargets([pattern], step.bpm, 0, slotsPerPulse);
    for (const [targetIndex, target] of targets.entries()) {
      const midi = melody[bar][targetIndex];
      const slot = target.timeMs / slotMs;
      const duration =
        RHYTHM_NOTE_BEATS[target.noteValue] *
        rhythmPulseUnits(step) *
        slotsPerPulse;
      note(
        part.lead,
        midi,
        slot,
        duration,
        slot === 0 ? 0.72 : 0.63,
        bends?.[targetIndex],
      );
      if (part.lead === "violin" || part.lead === "flute")
        note("piano", midi, slot, Math.min(duration, 1), 0.26);
    }

    if (part.keys === "mellotron" || part.keys === "symphonic") {
      const full = part.keys === "symphonic";
      note("mellotron", bass + 12, 0, length, full ? 0.19 : 0.26);
      note("mellotron", third + 12, 0, length, full ? 0.16 : 0.22);
      note("violin", fifth + 12, 0, length, full ? 0.26 : 0.2);
      if (full) {
        const bassRoot = bass >= 48 ? bass - 12 : bass;
        note("violin", bass + 24, 0, length, 0.2);
        note("electric-guitar", bass + 12, 0, length, 0.29);
        note("electric-guitar", bass + 19, 0, length, 0.22);
        note("electric-bass", bassRoot, 0, ending ? length : 4, 0.49);
        if (!ending) {
          note("electric-bass", bassRoot, 4, 2.75, 0.38);
          note(
            "electric-bass",
            bassRoot + (bar % 2 === 0 ? 7 : 12),
            7,
            1,
            0.25,
          );
        }
      } else {
        note("piano", bass, 0, length, 0.23);
        if (!ending) note("piano", fifth, 4, 3, 0.17);
      }
    } else if (
      part.keys === "power-chords" ||
      part.keys === "muted-power-chords"
    ) {
      const muted = part.keys === "muted-power-chords";
      const guitarSlots = ending ? [0] : muted ? [0, 3, 4, 7] : [0, 4];
      const bassSlots = ending
        ? [0]
        : muted
          ? [0, 2, 3, 4, 6, 7]
          : [0, 2, 4, 6];
      for (const slot of guitarSlots) {
        const duration = ending ? length : muted ? 0.8 : 3.75;
        note("electric-guitar", bass + 12, slot, duration, 0.37);
        note("electric-guitar", bass + 19, slot, duration, 0.26);
      }
      for (const slot of bassSlots) {
        const pitch = slot === 6 ? bass + 7 : bass + (slot === 7 ? 12 : 0);
        note(
          "electric-bass",
          pitch,
          slot,
          ending ? length : muted ? 0.9 : 1.8,
          0.56,
        );
      }
    } else if (ending || part.keys === "held") {
      note("piano", bass, 0, length, 0.31);
      note("piano", fifth, 0, length, 0.17);
      note("piano", third, 0, length, 0.18);
    } else if (part.keys === "arpeggio") {
      note("piano", bass, 0, 4, 0.3);
      note("piano", fifth, 2, 2, 0.21);
      note("piano", third, 4, 3, 0.19);
      note("piano", fifth, 6, 2, 0.16);
    } else if (part.keys === "offbeats") {
      note("piano", bass, 0, 2.5, 0.38);
      note("piano", bass + (bar % 2 ? 12 : 7), 3, 1, 0.24);
      note("piano", bass, 5, 2, 0.3);
      for (const slot of [1, 3, 7]) {
        note("piano", fifth, slot, 0.8, 0.19);
        note("piano", third, slot, 0.8, 0.18);
      }
    } else {
      note("piano", bass, 0, 2, 0.34);
      note("piano", fifth, 2, 2, 0.23);
      note("piano", bass + 12, 4, 2, 0.26);
      note("piano", third, 6, 1, 0.19);
    }
    if (part.support) {
      if (part.support === "violin" || ending)
        note(part.support, third + 12, 0, length, 0.23);
      else {
        note("flute", fifth + 12, 3, 1, 0.21);
        note("flute", third + 12, 5, 2, 0.2);
      }
    }

    for (const id of songDrums) {
      const drumFill =
        fill && (id === "high-tom" || id === "low-tom")
          ? part.fill?.[id]
          : undefined;
      let groove = drumFill ?? part.drums?.[id] ?? "";
      if (id === "crash" && !entrance && !ending) groove = "";
      if (ending && id !== "crash") groove = id === "kick" ? "X" : "";
      for (let slot = 0; slot < length; slot++) {
        const hit = groove[slot];
        if (hit === "X" || hit === "x")
          drum(id, slot, drumLevels[id] * (hit === "X" ? 1 : 0.62));
        else if (footGuide && id === "kick" && slot % slotsPerPulse === 0) {
          const accent = rhythmBeatAccent(step, slot / slotsPerPulse);
          drum(id, slot, accent ? 0.3 : 0.15);
        }
      }
    }
  }
  return events.sort((a, b) => a.timeMs - b.timeMs);
}
