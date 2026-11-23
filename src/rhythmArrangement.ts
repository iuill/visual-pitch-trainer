import {
  type GeneratedInstrument,
  isGeneratedInstrument,
} from "./generatedInstruments";
import type { ReferenceInstrumentId } from "./referenceInstruments";
import {
  RHYTHM_NOTE_BEATS,
  type RhythmStep,
  rhythmPulseLevel,
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
type SampleInstrument = Extract<
  ReferenceInstrumentId,
  "piano" | "violin" | "flute"
>;
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

export type SongEvent =
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
  events: readonly SongEvent[] | undefined,
): readonly SampleInstrument[] {
  if (!events) return ["piano"];
  return [
    ...new Set(
      events.flatMap((event) =>
        "instrument" in event && !isGeneratedInstrument(event.instrument)
          ? [event.instrument]
          : [],
      ),
    ),
  ];
}

export function songDrumsForEvents(
  events: readonly SongEvent[],
): readonly SongDrum[] {
  return [
    ...new Set(
      events.flatMap((event) => ("drum" in event ? [event.drum] : [])),
    ),
  ];
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
  const groupStarts = step.beatGroups?.map((pulse) => pulse * slotsPerPulse);
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
      const durationSlots = Math.min(duration, length - slot);
      if (durationSlots <= 0) return;
      events.push({
        timeMs: barStart + slot * slotMs,
        instrument,
        midi,
        seconds: (durationSlots * slotMs) / 1000,
        level,
        bendSemitones,
      });
    }
    function accompaniment(
      instrument: SongInstrument,
      midi: number,
      slot: number,
      duration: number,
      level: number,
    ) {
      const scale = length / 8;
      note(instrument, midi, Math.round(slot * scale), duration * scale, level);
    }
    function drum(id: SongDrum, slot: number, level: number) {
      events.push({ timeMs: barStart + slot * slotMs, drum: id, level });
    }

    const targets = createRhythmTargets([pattern], step.bpm, 0, slotsPerPulse);
    for (const [targetIndex, target] of targets.entries()) {
      const midi = melody[bar][targetIndex];
      const slot = target.pulse * slotsPerPulse;
      const duration =
        RHYTHM_NOTE_BEATS[target.noteValue] *
        rhythmPulseUnits(step) *
        slotsPerPulse;
      note(
        part.lead,
        midi,
        slot,
        duration,
        0.5 + 0.22 * rhythmPulseLevel(step, target.pulse),
        bends?.[targetIndex],
      );
      if (part.lead === "violin" || part.lead === "flute")
        note(
          "piano",
          midi,
          slot,
          Math.min(duration, 1),
          0.19 + 0.07 * rhythmPulseLevel(step, target.pulse),
        );
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
        accompaniment("electric-bass", bassRoot, 0, ending ? 8 : 4, 0.49);
        if (!ending) {
          accompaniment("electric-bass", bassRoot, 4, 2.75, 0.38);
          accompaniment(
            "electric-bass",
            bassRoot + (bar % 2 === 0 ? 7 : 12),
            7,
            1,
            0.25,
          );
        }
      } else {
        note("piano", bass, 0, length, 0.23);
        if (!ending) accompaniment("piano", fifth, 4, 3, 0.17);
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
        const duration = ending ? 8 : muted ? 0.8 : 3.75;
        accompaniment("electric-guitar", bass + 12, slot, duration, 0.37);
        accompaniment("electric-guitar", bass + 19, slot, duration, 0.26);
      }
      for (const slot of bassSlots) {
        const pitch = slot === 6 ? bass + 7 : bass + (slot === 7 ? 12 : 0);
        accompaniment(
          "electric-bass",
          pitch,
          slot,
          ending ? 8 : muted ? 0.9 : 1.8,
          0.36 +
            0.2 *
              rhythmPulseLevel(
                step,
                Math.round((slot * length) / 8) / slotsPerPulse,
              ),
        );
      }
    } else if (ending || part.keys === "held") {
      note("piano", bass, 0, length, 0.31);
      note("piano", fifth, 0, length, 0.17);
      note("piano", third, 0, length, 0.18);
    } else if (part.keys === "arpeggio") {
      accompaniment("piano", bass, 0, 4, 0.3);
      accompaniment("piano", fifth, 2, 2, 0.21);
      accompaniment("piano", third, 4, 3, 0.19);
      accompaniment("piano", fifth, 6, 2, 0.16);
    } else if (part.keys === "offbeats") {
      accompaniment("piano", bass, 0, 2.5, 0.38);
      accompaniment("piano", bass + (bar % 2 ? 12 : 7), 3, 1, 0.24);
      accompaniment("piano", bass, 5, 2, 0.3);
      for (const slot of [1, 3, 7]) {
        accompaniment("piano", fifth, slot, 0.8, 0.19);
        accompaniment("piano", third, slot, 0.8, 0.18);
      }
    } else {
      const pitches = [bass, fifth, bass + 12, third];
      const levels = [0.34, 0.23, 0.26, 0.19];
      const starts = groupStarts
        ? [0, ...groupStarts]
        : [0, 2, 4, 6].map((slot) => Math.round((slot * length) / 8));
      for (const [index, slot] of starts.entries())
        note(
          "piano",
          pitches[index % pitches.length],
          slot,
          (starts[index + 1] ?? length) - slot,
          levels[index % levels.length],
        );
    }
    if (part.support) {
      if (part.support === "violin" || ending)
        note(part.support, third + 12, 0, length, 0.23);
      else if (groupStarts) {
        for (const [index, slot] of groupStarts.entries())
          note(
            "flute",
            (index % 2 ? third : fifth) + 12,
            slot,
            (index % 2 ? 2 : 1) * slotsPerPulse,
            0.2,
          );
      } else {
        accompaniment("flute", fifth + 12, 3, 1, 0.21);
        accompaniment("flute", third + 12, 5, 2, 0.2);
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
        const pulse = slot / slotsPerPulse;
        const level = rhythmPulseLevel(step, pulse);
        if (hit === "X" || hit === "x")
          drum(
            id,
            slot,
            drumLevels[id] *
              (hit === "X" ? 1 : 0.62) *
              (id === "kick" ? 0.5 + 0.5 * level : 1),
          );
        else if (footGuide && id === "kick" && Number.isInteger(pulse))
          drum(id, slot, 0.3 * level);
      }
    }
  }
  return events.sort((a, b) => a.timeMs - b.timeMs);
}
