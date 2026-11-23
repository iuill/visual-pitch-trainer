import { buildNoteRange, type Note, SOLFEGE_NAMES } from "./pitchMath";

const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];

export const MELODY_PATTERNS = [
  { id: "two-tone", label: "2トーンスケール", tones: 2 },
  { id: "three-tone", label: "3トーンスケール", tones: 3 },
  { id: "five-tone", label: "5トーンスケール", tones: 5 },
  { id: "major", label: "ドレミ上行", offsets: MAJOR_OFFSETS },
  {
    id: "descending",
    label: "ドレミ下行",
    offsets: [12, 11, 9, 7, 5, 4, 2, 0],
  },
  { id: "triad", label: "ドミソミド", offsets: [0, 4, 7, 4, 0] },
  {
    id: "chromatic",
    label: "半音ずつ上行",
    offsets: Array.from({ length: 13 }, (_, i) => i),
  },
] as const;

export function getToneScaleSize(patternId: string): number {
  const pattern = MELODY_PATTERNS.find((item) => item.id === patternId);
  return pattern && "tones" in pattern ? pattern.tones : 0;
}

export function getToneScaleStartBounds(tones: number, offsets?: number[]) {
  return {
    first: offsets ? -Math.min(...offsets) : 0,
    last:
      MAJOR_OFFSETS.length - 1 - (offsets ? Math.max(...offsets) : tones - 1),
  };
}

export function pickToneScalePattern(
  tones: number,
  maxSteps: number,
  currentOffsets?: number[],
  random = Math.random,
) {
  const candidates: { startDegree: number; offsets: number[] }[] = [];
  function addPatterns(degrees: number[]) {
    if (degrees.length === tones) {
      const startDegree = degrees[0];
      const offsets = degrees.map((degree) => degree - startDegree);
      if (
        offsets.some(
          (offset, index) => offset !== (currentOffsets?.[index] ?? index),
        )
      ) {
        candidates.push({ startDegree, offsets });
      }
      return;
    }
    const previous = degrees.at(-1);
    for (let degree = 0; degree < MAJOR_OFFSETS.length; degree++) {
      if (
        previous !== undefined &&
        (degrees.includes(degree) || Math.abs(degree - previous) > maxSteps)
      )
        continue;
      addPatterns([...degrees, degree]);
    }
  }
  addPatterns([]);
  return candidates[Math.floor(random() * candidates.length)];
}

export function buildMelody(
  patternId: string,
  custom: string,
  startMidi: number,
  startDegree = 0,
  toneScaleOffsets?: number[],
): Note[] {
  const range = buildNoteRange(startMidi);
  const pattern = MELODY_PATTERNS.find((item) => item.id === patternId);
  if (pattern && "tones" in pattern) {
    const { first, last } = getToneScaleStartBounds(
      pattern.tones,
      toneScaleOffsets,
    );
    const start = Math.max(first, Math.min(startDegree, last));
    const offsets =
      toneScaleOffsets ??
      Array.from({ length: pattern.tones }, (_, index) => index);
    const outward = offsets.map(
      (offset) => range[MAJOR_OFFSETS[start + offset]],
    );
    // The turn plays once, and the next lap supplies the return to the start.
    return [...outward, ...outward.slice(1, -1).reverse()];
  }
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
export const MELODY_GRACE_SECONDS = 0.4;

export type MelodyPosition = {
  phase: "countdown" | "sing";
  lap: number;
  elapsedInLap: number;
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
  if (elapsed < MELODY_COUNTDOWN_SECONDS) {
    return {
      phase: "countdown",
      index: -1,
      remaining: MELODY_COUNTDOWN_SECONDS - Math.max(0, elapsed),
      noteElapsed: 0,
      lap: 0,
      elapsedInLap: 0,
    };
  }
  const singingElapsed = elapsed - MELODY_COUNTDOWN_SECONDS;
  const duration = count * seconds;
  const lap = Math.floor(singingElapsed / duration);
  const elapsedInLap = singingElapsed - lap * duration;
  const index = Math.min(count - 1, Math.floor(elapsedInLap / seconds));
  const noteElapsed = elapsedInLap - index * seconds;
  return {
    phase: "sing",
    lap,
    elapsedInLap,
    index,
    remaining: seconds - noteElapsed,
    noteElapsed,
  };
}

// Include silence and only the portion actually practiced, including a partial last lap.
export function getMelodyAssessedSeconds(
  elapsed: number,
  count: number,
  seconds: number,
  index: number,
  firstLap = 0,
): number {
  const duration = count * seconds;
  const singingElapsed = Math.max(
    0,
    elapsed - MELODY_COUNTDOWN_SECONDS - firstLap * duration,
  );
  const laps = Math.floor(singingElapsed / duration);
  const local = singingElapsed - laps * duration - index * seconds;
  const grace = index === 0 ? MELODY_GRACE_SECONDS : 0;
  return (
    laps * (seconds - grace) + Math.max(0, Math.min(seconds, local) - grace)
  );
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
  const grace = current.index === 0 ? MELODY_GRACE_SECONDS : 0;
  const assessedMs = Math.max(
    0,
    Math.min(delta, (localStart + delta / 1000 - grace) * 1000),
  );
  const result = results[current.index];
  result.detectedMs += assessedMs;
  if (
    Math.abs(previous.cents) <= tolerance &&
    Math.abs(current.cents) <= tolerance
  )
    result.inTuneMs += assessedMs;
}
