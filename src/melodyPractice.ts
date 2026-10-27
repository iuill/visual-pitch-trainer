import { buildNoteRange, type Note, SOLFEGE_NAMES } from "./pitchMath";

export const MELODY_PATTERNS = [
  { id: "major", label: "ドレミ上行", offsets: [0, 2, 4, 5, 7, 9, 11, 12] },
  {
    id: "descending",
    label: "ドレミ下行",
    offsets: [12, 11, 9, 7, 5, 4, 2, 0],
  },
  {
    id: "five",
    label: "ドレミファソの往復",
    offsets: [0, 2, 4, 5, 7, 5, 4, 2, 0],
  },
  { id: "triad", label: "ドミソミド", offsets: [0, 4, 7, 4, 0] },
  {
    id: "chromatic",
    label: "半音ずつ上行",
    offsets: Array.from({ length: 13 }, (_, i) => i),
  },
] as const;

export function buildMelody(
  patternId: string,
  custom: string,
  startMidi: number,
): Note[] {
  const range = buildNoteRange(startMidi);
  const pattern = MELODY_PATTERNS.find((item) => item.id === patternId);
  if (pattern) return pattern.offsets.map((offset) => range[offset]);
  if (patternId !== "custom") throw new Error("メロディを選んでください。");
  const tokens = custom
    .trim()
    .replaceAll("♯", "#")
    .replaceAll("＃", "#")
    .split(/[\s、,]+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 32) {
    throw new Error("音名を空白で区切って2〜32音入力してください。");
  }
  return tokens.map((token) => {
    const offset =
      token === "高ド"
        ? 12
        : SOLFEGE_NAMES.indexOf(token as (typeof SOLFEGE_NAMES)[number]);
    if (offset < 0)
      throw new Error(
        `「${token}」は使えません。ド〜シ、ド#などの半音、高ドを入力してください。`,
      );
    return range[offset];
  });
}

export const MELODY_COUNTDOWN_SECONDS = 3;
export const MELODY_LISTEN_SECONDS = 2;
export const MELODY_GRACE_SECONDS = 0.4;

export type MelodyPosition = {
  phase: "listen" | "countdown" | "sing" | "finished";
  index: number;
  remaining: number;
  noteElapsed: number;
};

// AudioContext time is shared with scheduled notes, rather than accumulating timer drift.
export function getMelodyPosition(
  elapsed: number,
  count: number,
  seconds: number,
): MelodyPosition {
  const listenSeconds = count * MELODY_LISTEN_SECONDS;
  const singingAt = listenSeconds + MELODY_COUNTDOWN_SECONDS;
  if (elapsed >= singingAt + count * seconds) {
    return {
      phase: "finished",
      index: count - 1,
      remaining: 0,
      noteElapsed: 0,
    };
  }
  if (elapsed >= listenSeconds && elapsed < singingAt) {
    return {
      phase: "countdown",
      index: -1,
      remaining: singingAt - elapsed,
      noteElapsed: 0,
    };
  }
  const phase = elapsed < listenSeconds ? "listen" : "sing";
  const noteSeconds = phase === "listen" ? MELODY_LISTEN_SECONDS : seconds;
  const inPass = Math.max(
    0,
    phase === "listen" ? elapsed : elapsed - singingAt,
  );
  const index = Math.min(count - 1, Math.floor(inPass / noteSeconds));
  const noteElapsed = inPass - index * noteSeconds;
  return { phase, index, remaining: noteSeconds - noteElapsed, noteElapsed };
}

export type MelodyNoteResult = { detectedMs: number; inTuneMs: number };
export type MelodyObservation = {
  index: number;
  elapsed: number;
  cents: number | null;
};

export function recordMelodyObservation(
  results: MelodyNoteResult[],
  previous: MelodyObservation | null,
  current: MelodyObservation,
  seconds: number,
  tolerance: number,
): void {
  // Require two observations within the same note. Silence stays in the denominator.
  if (
    !previous ||
    previous.index !== current.index ||
    current.cents === null ||
    previous.cents === null
  )
    return;
  const delta = (current.elapsed - previous.elapsed) * 1000;
  if (delta <= 0 || delta > 250) return;
  const localStart = previous.elapsed - current.index * seconds;
  const assessedMs = Math.max(
    0,
    Math.min(delta, (localStart + delta / 1000 - MELODY_GRACE_SECONDS) * 1000),
  );
  const result = results[current.index];
  result.detectedMs += assessedMs;
  if (
    Math.abs(previous.cents) <= tolerance &&
    Math.abs(current.cents) <= tolerance
  )
    result.inTuneMs += assessedMs;
}
