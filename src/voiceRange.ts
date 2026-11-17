import { hzToMidi } from "./pitchMath";

// Provisional usability setting; not a validated physiological threshold.
export const RANGE_HOLD_MS = 600;
export type VoiceRange = {
  notes: number[];
  candidate: number | null;
  heldMs: number;
  previousAt: number | null;
};

export function createVoiceRange(): VoiceRange {
  return { notes: [], candidate: null, heldMs: 0, previousAt: null };
}

export function removeVoiceRangeNote(state: VoiceRange, midi: number): void {
  state.notes = state.notes.filter((note) => note !== midi);
  if (state.candidate === midi) {
    state.candidate = null;
    state.heldMs = 0;
    state.previousAt = null;
  }
}

export function observeVoiceRange(
  state: VoiceRange,
  frequency: number | null,
  now: number,
): void {
  const midi =
    frequency !== null && Number.isFinite(frequency) && frequency > 0
      ? Math.round(hzToMidi(frequency))
      : null;
  const note = midi !== null && midi >= 24 && midi <= 96 ? midi : null;
  const delta = state.previousAt === null ? 0 : now - state.previousAt;
  if (note === null || note !== state.candidate || delta <= 0 || delta > 150)
    state.heldMs = 0;
  else state.heldMs += delta;
  state.candidate = note;
  state.previousAt = now;
  if (
    note !== null &&
    state.heldMs >= RANGE_HOLD_MS &&
    !state.notes.includes(note)
  ) {
    state.notes.push(note);
    state.notes.sort((a, b) => a - b);
  }
}
