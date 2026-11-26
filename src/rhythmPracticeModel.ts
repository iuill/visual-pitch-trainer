import {
  getRhythmNoteValue,
  getRhythmRestValue,
  RHYTHM_NOTE_BEATS,
  type RhythmNoteValue,
  type RhythmRestValue,
  type RhythmStep,
  rhythmBeatAccent,
  rhythmPulseDynamics,
  rhythmPulseUnits,
  rhythmSlotsPerBeat,
} from "./rhythmCourse";
import type { RhythmTarget } from "./rhythmJudge";
import type { RhythmCount } from "./rhythmScheduler";

export const noteNotation: Record<RhythmNoteValue, string> = {
  whole: "全音符",
  "dotted-half": "付点2分音符",
  half: "2分音符",
  "dotted-quarter": "付点4分音符",
  quarter: "4分音符",
  "triplet-eighth": "8分音符（三連符）",
  "dotted-eighth": "付点8分音符",
  eighth: "8分音符",
  sixteenth: "16分音符",
};
export const restNotation: Record<RhythmRestValue, string> = {
  quarter: "4分休符",
  eighth: "8分休符",
};
export function rhythmCountLabel(step: RhythmStep, pulse: number) {
  let start = 0;
  for (const group of step.beatGroups ?? []) {
    if (group > pulse) break;
    start = group;
  }
  return String(pulse - start + 1);
}

export function rhythmBeatLabel(
  beat: number,
  part: number,
  slotsPerBeat: number,
) {
  if (part === 0) return `${beat}拍目`;
  return slotsPerBeat === 2 || (slotsPerBeat === 4 && part === 2)
    ? `${beat}拍目の裏`
    : `${beat}拍目の${part + 1}つ目`;
}

export function createRhythmPattern(step: RhythmStep, pattern: string) {
  const slotsPerBeat = rhythmSlotsPerBeat(step);
  const subdivided = step.countSubdivision !== undefined;
  const stride = subdivided ? 1 : slotsPerBeat;
  const slots = [];

  for (let index = 0; index < pattern.length; index += stride) {
    const beat = Math.floor(index / slotsPerBeat) + 1;
    const part = index % slotsPerBeat;
    const note = pattern[index] === "-" ? "" : pattern[index];
    const noteValue = getRhythmNoteValue(note);
    const restValue = getRhythmRestValue(note);
    const count =
      part === 0
        ? rhythmCountLabel(step, beat - 1)
        : slotsPerBeat === 2 || (slotsPerBeat === 4 && part === 2)
          ? "&"
          : "・";
    slots.push({
      index,
      beatLabel: rhythmBeatLabel(beat, part, slotsPerBeat),
      count,
      note,
      noteValue,
      restValue,
      foot: part === 0,
      accent: rhythmBeatAccent(step, index / slotsPerBeat),
      groupStart: step.beatGroups?.includes(index / stride) === true,
    });
  }

  const handBeats = slots.flatMap(({ beatLabel, noteValue }) =>
    noteValue ? [`${beatLabel}に${noteNotation[noteValue]}`] : [],
  );
  const restBeats = slots.flatMap(({ beatLabel, restValue }) =>
    restValue ? [`${beatLabel}に${restNotation[restValue]}`] : [],
  );
  const label = step.feetOnly
    ? "足で1、2、3、4拍を刻み、各拍でタップ"
    : `足で毎拍を刻む。手で叩く位置は${handBeats.join("、")}${restBeats.length ? `。${restBeats.join("、")}` : ""}`;
  return { slots, subdivided, label };
}

type RhythmLegendItem =
  | { kind: "note"; value: RhythmNoteValue; label: string }
  | { kind: "rest"; value: RhythmRestValue; label: string };

export function createRhythmPatternLegend(
  step: RhythmStep,
  patterns: readonly string[],
) {
  const symbols = patterns.join("");
  const shownNotes = new Set(Array.from(symbols, getRhythmNoteValue));
  const shownRests = new Set(Array.from(symbols, getRhythmRestValue));
  const legend: RhythmLegendItem[] = [];

  for (const value of [
    "whole",
    "dotted-half",
    "half",
    "dotted-quarter",
    "quarter",
    "dotted-eighth",
    "eighth",
    "sixteenth",
    "triplet-eighth",
  ] as const) {
    if (step.feetOnly || !shownNotes.has(value)) continue;
    const pulses = RHYTHM_NOTE_BEATS[value] * rhythmPulseUnits(step);
    const beats =
      value === "triplet-eighth"
        ? "1/3拍"
        : pulses === 0.5
          ? "半拍"
          : step.beatGroups
            ? `8分音符${pulses}つ分`
            : `${RHYTHM_NOTE_BEATS[value]}拍`;
    const label =
      step.beatGroups && value === "eighth"
        ? noteNotation[value]
        : `${noteNotation[value]}（${beats}）`;
    legend.push({ kind: "note", value, label });
  }

  for (const value of ["quarter", "eighth"] as const) {
    if (!shownRests.has(value)) continue;
    const label = step.beatGroups
      ? restNotation[value]
      : `${restNotation[value]}（${value === "quarter" ? "1拍" : "半拍"}休む）`;
    legend.push({ kind: "rest", value, label });
  }
  return legend;
}

export function createRhythmPracticeTimeline(
  step: RhythmStep,
  {
    firstBeatMs,
    barCount,
    countInBars,
    dualLane,
    clickCue,
  }: {
    firstBeatMs: number;
    barCount: number;
    countInBars: number;
    dualLane: boolean;
    clickCue: boolean;
  },
) {
  const beatsPerBar = step.beatsPerBar ?? 4;
  const beatMs = 60_000 / step.bpm;
  const countInBeats = beatsPerBar * countInBars;
  const startMs = firstBeatMs + beatMs * countInBeats;
  const endMs = startMs + barCount * beatsPerBar * beatMs;
  const footTargets: RhythmTarget[] = dualLane
    ? Array.from({ length: barCount * beatsPerBar }, (_, beat) => ({
        timeMs: startMs + beat * beatMs,
      }))
    : [];
  const beatCount = (barCount + countInBars) * beatsPerBar;
  const includeOffbeats =
    !step.melody && clickCue && step.countSubdivision === "eighth";
  const counts: RhythmCount[] = [];

  for (let beat = 0; beat < beatCount; beat++) {
    const timeMs = firstBeatMs + beat * beatMs;
    const pulse = beat % beatsPerBar;
    const voiceIndex = step.beatGroups
      ? rhythmBeatAccent(step, pulse)
        ? 0
        : 1
      : pulse;
    counts.push({
      timeMs,
      voiceIndex,
      dynamics: rhythmPulseDynamics(step, pulse),
    });
    if (beat >= countInBeats && includeOffbeats) {
      counts.push({
        timeMs: timeMs + beatMs / 2,
        voiceIndex: 4,
        dynamics: rhythmPulseDynamics(step, pulse + 0.5),
      });
    }
  }

  return {
    beatsPerBar,
    beatMs,
    countInBeats,
    startMs,
    endMs,
    footTargets,
    beatCount,
    counts,
  };
}
