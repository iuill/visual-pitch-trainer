import type { SongBar } from "./rhythmArrangement";
import { ORIGINAL_RHYTHM_STEPS } from "./rhythmOriginalSongs";

export interface RhythmStep {
  id: string;
  chapter: 1 | 2 | 3 | 4 | 5;
  title: string;
  hint: string;
  bpm: number;
  beatsPerBar?: 2 | 3 | 4 | 7;
  beatGroups?: readonly number[];
  patterns: readonly string[];
  feetOnly?: boolean;
  melody?: readonly (readonly number[])[];
  arrangement?: readonly SongBar[];
  sections?: readonly { title: string; startBar: number; endBar: number }[];
  requiredStreak: number;
  countSubdivision?: "eighth" | "triplet" | "sixteenth";
  mixed?: boolean;
}

const RHYTHM_MIN_BEATS = 16;

export function rhythmSlotsPerBeat(step: RhythmStep) {
  if (step.beatsPerBar === 7) return 1;
  if (step.countSubdivision === "sixteenth") return 4;
  return step.countSubdivision === "triplet" ? 3 : 2;
}

export function rhythmPulseUnits(step: RhythmStep) {
  return step.beatsPerBar === 7 ? 2 : 1;
}

export function rhythmBeatAccent(step: RhythmStep, pulse: number) {
  return pulse === 0 || step.beatGroups?.includes(pulse) === true;
}

const pulseDynamics = {
  downbeat: { level: 1, voiceLevel: 1 },
  groupStart: { level: 0.88, voiceLevel: 0.921 },
  secondary: { level: 0.75, voiceLevel: 0.835 },
  weak: { level: 0.5, voiceLevel: 0.32 },
  subdivision: { level: 0.35, voiceLevel: 0.25 },
} as const;

export function rhythmPulseDynamics(step: RhythmStep, pulse: number) {
  if (pulse === 0) return pulseDynamics.downbeat;
  if (!Number.isInteger(pulse)) return pulseDynamics.subdivision;
  if (rhythmBeatAccent(step, pulse)) return pulseDynamics.groupStart;
  return (step.beatsPerBar ?? 4) === 4 && pulse === 2
    ? pulseDynamics.secondary
    : pulseDynamics.weak;
}

export function rhythmPulseLevel(step: RhythmStep, pulse: number) {
  return rhythmPulseDynamics(step, pulse).level;
}

export const RHYTHM_CHAPTERS = [
  "ゆっくり基礎",
  "だんだん速く",
  "裏拍",
  "実践編",
  "実践編2",
];

export type RhythmNoteValue =
  | "whole"
  | "dotted-half"
  | "half"
  | "dotted-quarter"
  | "quarter"
  | "triplet-eighth"
  | "dotted-eighth"
  | "eighth"
  | "sixteenth";

export const RHYTHM_NOTE_BEATS: Record<RhythmNoteValue, number> = {
  whole: 4,
  "dotted-half": 3,
  half: 2,
  "dotted-quarter": 1.5,
  quarter: 1,
  "triplet-eighth": 1 / 3,
  "dotted-eighth": 0.75,
  eighth: 0.5,
  sixteenth: 0.25,
};

const noteValues: Record<string, RhythmNoteValue | undefined> = {
  w: "whole",
  j: "dotted-half",
  h: "half",
  d: "dotted-quarter",
  x: "quarter",
  t: "triplet-eighth",
  f: "dotted-eighth",
  e: "eighth",
  z: "sixteenth",
};

export function getRhythmNoteValue(symbol: string) {
  return noteValues[symbol];
}

export type RhythmRestValue = "quarter" | "eighth";

const restValues: Record<string, RhythmRestValue | undefined> = {
  r: "quarter",
  s: "eighth",
};

export function getRhythmRestValue(symbol: string) {
  return restValues[symbol];
}

const quarters = ["x-x-x-x-"];
const halves = ["h---h---"];
const wholes = ["w-------", "h---x-x-"];
const eighths = ["eeeeeeee", "x-x-eeee"];
const rests = ["x-x-r-x-", "r-x-x-x-"];
const offbeats = ["sesesese"];
const alternating = ["x-x-sese", "sesex-x-", "x-r-sese", "sesseex-"];
const longerNotes = [...quarters, ...halves, ...wholes];
const shortNotesAndRests = [...eighths, ...rests];
const basics = [...longerNotes, ...shortNotesAndRests];
const offbeatMix = [...offbeats, ...alternating, "x-seeese", "sd--x-x-"];

export const RHYTHM_STEPS: readonly RhythmStep[] = [
  {
    id: "1-1",
    chapter: 1,
    title: "足だけで拍を感じる",
    hint: "足で拍を刻み、下段の足あとの中心線が判定ラインに重なるたびにタップします。",
    bpm: 60,
    patterns: quarters,
    feetOnly: true,
    requiredStreak: 2,
  },
  {
    id: "1-2",
    chapter: 1,
    title: "4分音符：足と手を同時に",
    hint: "下段の足あとで拍を取り、上段の音符に合わせてタップしましょう。このステップでは、足と手が同じタイミングです。",
    bpm: 60,
    patterns: quarters,
    requiredStreak: 2,
  },
  {
    id: "1-3",
    chapter: 1,
    title: "2分音符：2拍に1回",
    hint: "足は毎拍、手は1拍目と3拍目に叩きます。",
    bpm: 60,
    patterns: halves,
    requiredStreak: 2,
  },
  {
    id: "1-4",
    chapter: 1,
    title: "全音符と組み合わせ",
    hint: "白い楕円の全音符は4拍分、棒の付いた白い2分音符は2拍分です。音符の頭で一度タップし、足では毎拍を刻みましょう。",
    bpm: 60,
    patterns: wholes,
    requiredStreak: 2,
  },
  {
    id: "1-5",
    chapter: 1,
    title: "8分音符：足1回で手2回",
    hint: "足で刻むのは数字の拍だけです。手は音符に合わせ、拍と拍の間に音符があればそこでもタップします。",
    bpm: 60,
    patterns: eighths,
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "1-6",
    chapter: 1,
    title: "4分休符：叩かない拍",
    hint: "上段に休符が来た拍はタップを休み、足で拍を刻み続けましょう。",
    bpm: 60,
    patterns: rests,
    requiredStreak: 2,
  },
  {
    id: "2-1",
    chapter: 2,
    title: "4分・2分の復習",
    hint: "少し速いテンポで、足と手を合わせます。",
    bpm: 70,
    patterns: longerNotes,
    requiredStreak: 2,
    mixed: true,
  },
  {
    id: "2-2",
    chapter: 2,
    title: "8分・休符の復習",
    hint: "足の間の音と、手を休める拍を確かめます。",
    bpm: 70,
    patterns: shortNotesAndRests,
    requiredStreak: 2,
    countSubdivision: "eighth",
    mixed: true,
  },
  {
    id: "2-3",
    chapter: 2,
    title: "2拍子のテンポアップ",
    hint: "強・弱の2拍を繰り返します。毎回ワンに戻るところを意識しましょう。",
    bpm: 90,
    beatsPerBar: 2,
    patterns: ["x-x-", "h---", "eex-", "x-ee", "x-r-", "r-x-"],
    requiredStreak: 2,
    countSubdivision: "eighth",
    mixed: true,
  },
  {
    id: "2-4",
    chapter: 2,
    title: "3拍子のテンポアップ",
    hint: "強・弱・弱のまとまりを感じながら、足の速さを一定に保ちます。",
    bpm: 105,
    beatsPerBar: 3,
    patterns: ["x-x-x-", "h---x-", "j-----", "x-eex-", "eex-x-", "x-r-x-"],
    requiredStreak: 2,
    countSubdivision: "eighth",
    mixed: true,
  },
  ...[125, 150].map(
    (bpm, index): RhythmStep => ({
      id: `2-${index + 5}`,
      chapter: 2,
      title: "テンポアップ",
      hint: "小節ごとに変わるリズムを、同じ速さの足に合わせて叩きます。",
      bpm,
      patterns: basics,
      requiredStreak: 2,
      countSubdivision: "eighth",
      mixed: true,
    }),
  ),
  {
    id: "3-1",
    chapter: 3,
    title: "裏だけ叩く",
    hint: "足で表拍を踏み、足と足の真ん中だけを手で叩きます。",
    bpm: 60,
    patterns: offbeats,
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "3-2",
    chapter: 3,
    title: "表と裏の切り替え",
    hint: "足は毎拍刻み、手は表と裏を行き来します。休符のあとの裏拍も、足と足の真ん中です。",
    bpm: 60,
    patterns: alternating,
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "3-3",
    chapter: 3,
    title: "3拍子の裏拍",
    hint: "足は3拍でひとまとまりです。休符のあとの裏拍や、裏拍から次の表拍まで続く音も、音の頭で一度だけ叩きます。",
    bpm: 95,
    beatsPerBar: 3,
    patterns: ["sesese", "x-x-se", "r-sex-", "sex-se", "d--ex-", "sd--x-"],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "3-4",
    chapter: 3,
    title: "裏拍のテンポアップ",
    hint: "休符、連続する8分音符、裏拍から伸ばす音が混ざります。手のリズムが変わっても足の拍を保ちます。",
    bpm: 130,
    patterns: offbeatMix,
    requiredStreak: 2,
    countSubdivision: "eighth",
    mixed: true,
  },
  {
    id: "4-1",
    chapter: 4,
    title: "きらきら星",
    hint: "足で4拍ずつ刻みながら、メロディーの音が始まるところでタップしましょう。伸ばす音も、タップは最初の1回です。",
    bpm: 76,
    patterns: [
      "x-x-x-x-",
      "x-x-h---",
      "x-x-x-x-",
      "x-x-h---",
      "x-x-x-x-",
      "x-x-h---",
      "x-x-x-x-",
      "x-x-h---",
      "x-x-x-x-",
      "x-x-h---",
      "x-x-x-x-",
      "x-x-h---",
    ],
    melody: [
      [60, 60, 67, 67],
      [69, 69, 67],
      [65, 65, 64, 64],
      [62, 62, 60],
      [67, 67, 65, 65],
      [64, 64, 62],
      [67, 67, 65, 65],
      [64, 64, 62],
      [60, 60, 67, 67],
      [69, 69, 67],
      [65, 65, 64, 64],
      [62, 62, 60],
    ],
    requiredStreak: 2,
  },
  {
    id: "4-2",
    chapter: 4,
    title: "美しく青きドナウ",
    hint: "ワルツの1・2・3を足で刻みましょう。1・5小節目は3拍とも、それ以外の小節は1拍目と3拍目にタップします。",
    bpm: 100,
    beatsPerBar: 3,
    patterns: [
      "x-x-x-",
      "x-r-x-",
      "x-r-x-",
      "x-r-x-",
      "x-x-x-",
      "x-r-x-",
      "x-r-x-",
      "x-r-x-",
    ],
    melody: [
      [62, 66, 69],
      [69, 81],
      [81, 78],
      [78, 62],
      [62, 66, 69],
      [69, 81],
      [81, 79],
      [79, 60],
    ],
    requiredStreak: 2,
  },
  {
    id: "4-3",
    chapter: 4,
    title: "ふるさと",
    hint: "足は1・2・3を繰り返し、1拍目を意識しましょう。2・6小節目では、2拍目の裏でもタップします。",
    bpm: 80,
    beatsPerBar: 3,
    patterns: [
      "x-x-x-",
      "d--ex-",
      "x-x-x-",
      "h---r-",
      "x-x-x-",
      "d--ex-",
      "x-x-x-",
      "h---r-",
    ],
    melody: [
      [67, 67, 67],
      [69, 71, 69],
      [71, 71, 72],
      [74],
      [72, 74, 76],
      [71, 72, 71],
      [69, 69, 66],
      [67],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-4",
    chapter: 4,
    title: "パッヘルベルのカノン",
    hint: "冒頭は足と手を同時に。7小節目から手が8分音符になっても、足の速さを保ちましょう。",
    bpm: 76,
    patterns: [...Array<string>(6).fill("x-x-x-x-"), "eeeeeeee", "eeeeeeee"],
    melody: [
      [62, 57, 59, 54],
      [55, 50, 55, 57],
      [78, 76, 74, 73],
      [71, 69, 71, 73],
      [74, 73, 71, 69],
      [67, 66, 67, 64],
      [62, 66, 69, 67, 66, 62, 64, 64],
      [62, 59, 62, 69, 67, 71, 69, 67],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-5",
    chapter: 4,
    title: "メヌエット ト長調",
    hint: "足はゆっくり1・2・3。手の細かい音が増えても、各小節の1拍目を感じながら叩きましょう。",
    bpm: 72,
    beatsPerBar: 3,
    patterns: [
      "x-eeee",
      "x-x-x-",
      "x-eeee",
      "x-x-x-",
      "x-eeee",
      "x-eeee",
      "x-eeee",
      "j-----",
    ],
    melody: [
      [74, 67, 69, 71, 72],
      [74, 67, 67],
      [76, 72, 74, 76, 78],
      [79, 67, 67],
      [72, 74, 72, 71, 69],
      [71, 72, 71, 69, 67],
      [66, 67, 69, 71, 67],
      [69],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-6",
    chapter: 4,
    title: "トルコ行進曲（モーツァルト）",
    hint: "明るいイ長調の一節です。足は1・2を保ち、8分音符が続くところでは足1回に手を2回入れましょう。",
    bpm: 88,
    beatsPerBar: 2,
    patterns: ["x-ee", "eeee", "eeee", "eeee", "x-ee", "eeee", "eeee", "x-r-"],
    melody: [
      [73, 69, 71],
      [73, 71, 69, 68],
      [66, 68, 69, 71],
      [68, 64, 69, 71],
      [73, 69, 71],
      [73, 71, 69, 68],
      [66, 71, 68, 64],
      [69],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-7",
    chapter: 4,
    title: "運命（交響曲第5番）",
    hint: "「ジャジャジャジャーン」は、1拍目の裏から入ります。長い音でも足は1・2を刻み続けましょう。見本は練習用の一定テンポです。",
    bpm: 92,
    beatsPerBar: 2,
    patterns: ["seee", "h---", "seee", "h---", "seee", "eeee", "eeee", "h---"],
    melody: [
      [67, 67, 67],
      [63],
      [65, 65, 65],
      [62],
      [67, 67, 67],
      [63, 68, 68, 68],
      [67, 75, 75, 75],
      [72],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-8",
    chapter: 4,
    title: "エリーゼのために",
    hint: "原曲の3/8拍子を、足で1・2・3と数えやすい3/4拍子にしました。最初のタップは、1小節目の3拍目からです。",
    bpm: 96,
    beatsPerBar: 3,
    patterns: [
      "r-r-ee",
      "eeeeee",
      "x-seee",
      "x-seee",
      "x-seee",
      "eeeeee",
      "x-seee",
      "x-seee",
      "j-----",
    ],
    melody: [
      [76, 75],
      [76, 75, 76, 71, 74, 72],
      [69, 60, 64, 69],
      [71, 64, 68, 71],
      [72, 64, 76, 75],
      [76, 75, 76, 71, 74, 72],
      [69, 60, 64, 69],
      [71, 64, 72, 71],
      [69],
    ],
    requiredStreak: 2,
    countSubdivision: "eighth",
  },
  {
    id: "4-9",
    chapter: 4,
    title: "新世界より 第2楽章（家路）",
    hint: "ゆっくりした拍の中で長い音と短い音を叩き分けます。長い音は始まりだけタップしましょう。",
    bpm: 52,
    patterns: [
      "f--zx---f--zx---",
      "f--ze-e-h-------",
      "f--zx---f--zx---",
      "f--zf--zh-------",
      "f--zx---e-e-x---",
      "e-e-e-e-h-------",
      "f--zx---e-e-x---",
      "e-e-e-e-h-------",
    ],
    melody: [
      [64, 67, 67, 64, 62, 60],
      [62, 64, 67, 64, 62],
      [64, 67, 67, 64, 62, 60],
      [62, 64, 62, 60, 60],
      [69, 72, 72, 71, 67, 69],
      [69, 72, 71, 67, 69],
      [69, 72, 72, 71, 67, 69],
      [69, 72, 71, 67, 69],
    ],
    requiredStreak: 2,
    countSubdivision: "sixteenth",
  },
  {
    id: "4-10",
    chapter: 4,
    title: "カルメン〈ハバネラ〉",
    hint: "冒頭の伴奏を叩きます。1拍目の最後の短い音のあと、2拍目には等間隔で2回タップしましょう。",
    bpm: 60,
    beatsPerBar: 2,
    patterns: Array<string>(8).fill("f--ze-e-"),
    melody: Array<readonly number[]>(8).fill([50, 57, 65, 57]),
    requiredStreak: 2,
    countSubdivision: "sixteenth",
  },
  {
    id: "4-11",
    chapter: 4,
    title: "月光 第1楽章",
    hint: "冒頭の伴奏を練習します。足で1拍刻む間に、手で等間隔に3回タップしましょう。",
    bpm: 52,
    patterns: Array<string>(8).fill("tttttttttttt"),
    melody: [
      [56, 61, 64, 56, 61, 64, 56, 61, 64, 56, 61, 64],
      [56, 61, 64, 56, 61, 64, 56, 61, 64, 56, 61, 64],
      [57, 61, 64, 57, 61, 64, 57, 62, 66, 57, 62, 66],
      [56, 60, 66, 56, 61, 64, 56, 61, 63, 54, 60, 63],
      [52, 56, 61, 56, 61, 64, 56, 61, 64, 56, 61, 64],
      [56, 63, 66, 56, 63, 66, 56, 63, 66, 56, 63, 66],
      [56, 61, 64, 56, 61, 64, 57, 61, 66, 57, 61, 66],
      [56, 59, 64, 56, 59, 64, 57, 59, 63, 57, 59, 63],
    ],
    requiredStreak: 2,
    countSubdivision: "triplet",
  },
  ...ORIGINAL_RHYTHM_STEPS,
];

export function createRhythmBars(
  step: RhythmStep,
  random = Math.random,
): string[] {
  if (step.melody) return [...step.patterns];
  const bars: string[] = [];
  const barCount = Math.ceil(RHYTHM_MIN_BEATS / (step.beatsPerBar ?? 4));
  for (let index = 0; index < barCount; index++) {
    const choices =
      step.mixed && step.patterns.length > 1
        ? step.patterns.filter((pattern) => pattern !== bars.at(-1))
        : step.patterns;
    bars.push(
      choices[
        step.mixed
          ? Math.floor(random() * choices.length)
          : index % choices.length
      ],
    );
  }
  return bars;
}
