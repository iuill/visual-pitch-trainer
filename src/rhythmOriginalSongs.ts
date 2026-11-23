import type { SongBar, SongPart } from "./rhythmArrangement";
import type { RhythmStep } from "./rhythmCourse";

const chords = {
  C: [48, 55, 64],
  G: [43, 50, 59],
  Am: [45, 52, 60],
  F: [41, 48, 57],
  Dm: [50, 57, 65],
  Bb: [46, 53, 62],
  Gm: [43, 50, 58],
  Em: [40, 47, 55],
  D: [50, 57, 66],
  Bm: [47, 54, 62],
  B: [47, 54, 63],
  A: [45, 52, 61],
} as const;

type Bar = readonly [
  pattern: string,
  pitches: readonly number[],
  chord: keyof typeof chords,
  bends?: SongBar["bends"],
];
type Phrase = readonly Bar[];
type ScoredPhrase = readonly [Phrase, SongPart];
type Section = readonly [title: string, ...phrases: ScoredPhrase[]];

function song(
  details: Pick<
    RhythmStep,
    | "id"
    | "title"
    | "hint"
    | "bpm"
    | "beatsPerBar"
    | "beatGroups"
    | "countSubdivision"
  >,
  form: readonly Section[],
): RhythmStep {
  const bars: Bar[] = [];
  const arrangement: SongBar[] = [];
  const sections = form.map(([title, ...phrases], sectionIndex) => {
    const startBar = bars.length;
    for (const [phraseIndex, [phrase, part]] of phrases.entries()) {
      for (const [barIndex, bar] of phrase.entries()) {
        const lastBar = barIndex === phrase.length - 1;
        bars.push(bar);
        arrangement.push({
          chord: chords[bar[2]],
          part,
          bends: bar[3],
          entrance: barIndex === 0,
          fill: lastBar,
          ending:
            lastBar &&
            phraseIndex === phrases.length - 1 &&
            sectionIndex === form.length - 1,
        });
      }
    }
    return { title, startBar, endBar: bars.length };
  });
  return {
    ...details,
    chapter: 5,
    requiredStreak: 1,
    patterns: bars.map(([pattern]) => pattern),
    melody: bars.map(([, pitches]) => pitches),
    arrangement,
    sections,
  };
}

// 「窓辺の余白」 A is understated, B rises, and the coda leaves room to breathe.
const windowVerse: Phrase = [
  ["x-eed--e", [60, 64, 67, 69, 67], "C"],
  ["h---x-r-", [67, 62], "G"],
  ["r-eex-x-", [64, 67, 69, 72], "Am"],
  ["j-----ee", [69, 67, 65], "F"],
  ["x-eed--e", [65, 69, 72, 74, 72], "Dm"],
  ["h---x-r-", [71, 67], "G"],
  ["x-x-h---", [69, 67, 64], "Am"],
  ["h---r-r-", [65], "F"],
];
const windowRefrain: Phrase = [
  ["x-x-d--e", [67, 72, 76, 74], "C"],
  ["d--ex-x-", [74, 71, 67, 71], "G"],
  ["eex-d--e", [69, 72, 76, 77, 76], "Am"],
  ["h---x-r-", [72, 69], "F"],
  ["x-x-d--e", [69, 74, 77, 76], "Dm"],
  ["d--ex-x-", [74, 72, 71, 67], "G"],
  ["d--ex-x-", [69, 67, 64, 62], "Em"],
  ["w-------", [60], "C"],
];
const windowBridge: Phrase = [
  ["r-x-d--e", [69, 76, 74], "Am"],
  ["x-x-h---", [72, 69, 65], "F"],
  ["r-eex-x-", [62, 65, 69, 74], "Dm"],
  ["j-----ee", [71, 69, 67], "G"],
  ["x-eed--e", [67, 72, 74, 76, 74], "Em"],
  ["h---x-r-", [72, 69], "Am"],
  ["x-x-h---", [65, 69, 74], "Dm"],
  ["j-----r-", [71], "G"],
];
const windowCoda: Phrase = [
  ...windowVerse.slice(0, 4),
  ["x-x-d--e", [65, 69, 74, 72], "Dm"],
  ["h---x-r-", [71, 67], "G"],
  ["x-x-h---", [64, 62, 60], "C"],
  ["w-------", [60], "C"],
];

// 「曲がり角のステップ」 Downbeat riffs alternate with pickups and offbeats.
const cornerVerse: Phrase = [
  ["x-eeex-e", [62, 66, 69, 71, 69, 66], "D"],
  ["sex-ex-e", [66, 69, 73, 71, 69], "A"],
  ["x-eeex-e", [59, 62, 66, 69, 66, 62], "Bm"],
  ["sex-ex-e", [62, 67, 71, 69, 67], "G"],
  ["x-x-sex-", [64, 67, 71, 74], "Em"],
  ["eex-eex-", [73, 71, 69, 66, 64, 61], "A"],
  ["x-eeex-e", [62, 66, 69, 71, 69, 66], "D"],
  ["x-r-sese", [62, 64, 66], "D"],
];
const cornerRefrain: Phrase = [
  ["sex-eex-", [69, 74, 73, 71, 69], "D"],
  ["x-eex-ee", [76, 73, 71, 69, 71, 73], "A"],
  ["sex-eex-", [71, 74, 76, 74, 71], "Bm"],
  ["x-eex-ee", [79, 76, 74, 71, 69, 67], "G"],
  ["eex-sex-", [67, 69, 71, 74, 76], "Em"],
  ["sex-eex-", [76, 73, 71, 69, 66], "A"],
  ["x-eeex-e", [69, 71, 73, 74, 73, 69], "A"],
  ["x-x-h---", [66, 64, 62], "D"],
];
const cornerBreak: Phrase = [
  ["r-eesese", [66, 69, 71, 74], "Bm"],
  ["x-r-sex-", [71, 69, 67], "G"],
  ["r-eesese", [64, 67, 69, 71], "Em"],
  ["x-r-sex-", [73, 71, 69], "A"],
  ["sex-eex-", [66, 71, 74, 76, 74], "Bm"],
  ["eex-sex-", [71, 69, 67, 69, 71], "G"],
  ["r-eeex-e", [73, 71, 69, 76, 73], "A"],
  ["x-x-r-ee", [69, 66, 64, 66], "A"],
];
const cornerCoda: Phrase = [
  ...cornerRefrain.slice(0, 4),
  ["x-x-sex-", [67, 69, 71, 74], "Em"],
  ["eex-eex-", [73, 71, 69, 66, 64, 61], "A"],
  ["x-x-x-x-", [62, 66, 69, 73], "A"],
  ["w-------", [74], "D"],
];

// 「七つの灯」 The 7/8 motifs alternate accents across groups of 2, 2 and 3.
const lanternVerse: Phrase = [
  ["x-x-d--", [64, 67, 71], "Em"],
  ["x-eesx-", [69, 67, 64, 67], "Em"],
  ["x-x-d--", [65, 69, 72], "F"],
  ["eesex-e", [72, 69, 67, 65, 64], "F"],
  ["x-x-d--", [62, 65, 69], "Dm"],
  ["x-eesx-", [72, 69, 65, 69], "Dm"],
  ["x-eesx-", [71, 69, 66, 63], "B"],
  ["x-x-d--", [66, 63, 64], "Em"],
];
const lanternRefrain: Phrase = [
  ["eex-eee", [71, 72, 76, 74, 72, 71], "Em"],
  ["x-eex-e", [76, 74, 72, 67, 69], "C"],
  ["eex-eee", [69, 71, 72, 74, 76, 77], "Am"],
  ["sx-eex-", [76, 74, 72, 69], "Am"],
  ["eex-eee", [69, 72, 77, 76, 74, 72], "F"],
  ["x-eex-e", [74, 72, 69, 65, 69], "Dm"],
  ["eesex-e", [71, 72, 71, 66, 63], "B"],
  ["x-x-d--", [66, 63, 64], "Em"],
];
const lanternBridge: Phrase = [
  ["sx-sd--", [67, 72], "C"],
  ["eesex-e", [71, 72, 74, 76, 74], "Em"],
  ["sx-sd--", [65, 69], "Dm"],
  ["x-eesx-", [72, 69, 65, 64], "F"],
  ["sx-seee", [69, 72, 74, 76], "Am"],
  ["eesex-e", [77, 76, 74, 72, 69], "Dm"],
  ["x-ex-ee", [71, 72, 71, 66, 63], "B"],
  ["x-x-see", [64, 67, 66, 67], "Em"],
];
const lanternCoda: Phrase = [
  ...lanternVerse.slice(0, 4),
  ["x-x-d--", [62, 65, 69], "Dm"],
  ["eesex-e", [71, 72, 71, 66, 63], "B"],
  ["x-x-d--", [67, 66, 64], "Em"],
  ["x-x-d--", [64, 67, 64], "Em"],
];

const windowIntro: SongPart = { lead: "piano", keys: "arpeggio" };
const windowStrings: SongPart = {
  lead: "violin",
  keys: "arpeggio",
  drums: { kick: "x---x---", "hi-hat": "----x---" },
};
const windowChorus: SongPart = {
  ...windowStrings,
  support: "flute",
  drums: { kick: "X---x---", snare: "------x-", "hi-hat": "--x---x-" },
  fill: { "high-tom": "------xx" },
};
const windowWoodwind: SongPart = {
  lead: "flute",
  keys: "held",
  support: "violin",
};

const cornerGroove: SongPart = {
  lead: "piano",
  keys: "offbeats",
  drums: { kick: "X---x---", snare: "--X---X-", "hi-hat": "XxxxXxxx" },
  fill: { "high-tom": "-----xxX" },
};
const cornerChorus: SongPart = {
  ...cornerGroove,
  lead: "flute",
  support: "violin",
  drums: { kick: "X--xx--x", snare: "--X---X-", "hi-hat": "XxXxXxXx" },
};
const cornerInterlude: SongPart = {
  lead: "violin",
  keys: "offbeats",
  drums: { kick: "X----x--", "hi-hat": "-x-x-x-x" },
  fill: { "high-tom": "----x-xX" },
};

const lanternIntro: SongPart = {
  lead: "piano",
  keys: "ostinato",
  drums: { kick: "X-x-x--", "high-tom": "------x" },
};
const lanternGroove: SongPart = {
  lead: "flute",
  keys: "ostinato",
  drums: { kick: "X-x-X--", snare: "--x---x", "hi-hat": "XxXxXxx" },
  fill: { "high-tom": "----xxX" },
};
const lanternChorus: SongPart = { ...lanternGroove, support: "violin" };
const lanternInterlude: SongPart = {
  lead: "violin",
  keys: "held",
  support: "flute",
  drums: { kick: "X---x--", "high-tom": "--x---x" },
};

// 「火花の先へ」 Low E riffs open out into a higher chorus in G.
const sparkRiff: Phrase = [
  ["eesex-ee", [52, 52, 55, 57, 55, 52], "Em"],
  ["x-eex-ee", [52, 55, 57, 59, 57, 55], "Em"],
  ["eesex-ee", [55, 55, 59, 62, 59, 55], "G"],
  ["x-sesex-", [57, 60, 62, 64], "Am"],
  ["eesex-ee", [52, 52, 55, 57, 55, 52], "Em"],
  ["x-eex-ee", [52, 55, 57, 59, 62, 64], "Em"],
  ["x-x-d--e", [60, 64, 67, 64], "C"],
  ["r-x-eex-", [57, 62, 64, 66], "D"],
];
const sparkBuild: Phrase = [
  ["x-x-d--e", [60, 64, 67, 69], "C"],
  ["eex-eex-", [69, 66, 62, 64, 66, 69], "D"],
  ["x-x-d--e", [67, 71, 76, 74], "Em"],
  ["h---x-r-", [71, 67], "G"],
  ["x-x-d--e", [60, 64, 67, 69], "C"],
  ["eex-eex-", [69, 66, 62, 64, 66, 69], "D"],
  ["x-eex-ee", [71, 74, 76, 79, 76, 74], "Em"],
  ["x-x-x-x-", [74, 72, 69, 66], "D"],
];
const sparkChorus: Phrase = [
  ["d--ex-x-", [67, 71, 74, 79], "G"],
  ["h---x-r-", [78, 74], "D"],
  ["eex-d--e", [71, 74, 76, 79, 76], "Em"],
  ["x-x-h---", [76, 74, 72], "C"],
  ["d--ex-x-", [71, 74, 79, 83], "G"],
  ["eex-d--e", [81, 79, 78, 74, 76], "D"],
  ["x-x-d--e", [76, 72, 71, 67], "C"],
  ["x-x-h---", [69, 66, 67], "D"],
];
const sparkSolo: Phrase = [
  ["r-eex-x-", [67, 69, 71, 76], "Em"],
  ["eex-eex-", [79, 76, 74, 76, 74, 71], "G"],
  ["x-eex-ee", [72, 76, 79, 84, 83, 79], "C"],
  ["d--ex-x-", [78, 76, 74, 69], "D"],
  ["r-eex-x-", [71, 74, 76, 79], "Em"],
  ["eex-eex-", [83, 79, 76, 79, 76, 74], "G"],
  ["x-eex-ee", [76, 79, 81, 84, 81, 79], "C"],
  ["x-x-x-x-", [78, 74, 69, 66], "D"],
];
const sparkCoda: Phrase = [
  ...sparkRiff.slice(0, 4),
  ["x-x-d--e", [60, 64, 67, 64], "C"],
  ["x-eex-ee", [62, 66, 69, 74, 69, 66], "D"],
  ["x-x-x-x-", [67, 64, 59, 55], "Em"],
  ["w-------", [52], "Em"],
];

const sparkVerse: SongPart = {
  lead: "electric-guitar",
  keys: "muted-power-chords",
  drums: { kick: "X--xx---", snare: "--X---X-", "hi-hat": "XxXxXxXx" },
  fill: { "high-tom": "----xx--", "low-tom": "------xX" },
};
const sparkIntro: SongPart = {
  ...sparkVerse,
  drums: { kick: "X---x---", snare: "------x-", "hi-hat": "X-x-X-x-" },
};
const sparkOpen: SongPart = {
  ...sparkVerse,
  keys: "power-chords",
  drums: {
    kick: "X--xX--x",
    snare: "--X---X-",
    "hi-hat": "XxxxXxxx",
    crash: "X",
  },
};
const sparkRide: SongPart = {
  ...sparkOpen,
  drums: { kick: "X--xX--x", snare: "--X---X-", ride: "XxXxXxXx", crash: "X" },
};
const sparkBreak: SongPart = {
  ...sparkVerse,
  drums: { kick: "X---x---", snare: "----X---", "hi-hat": "x-x-x-x-" },
};

// 「暁の残響」 A D-minor theme resolves into F major over a half-time backbeat.
const dawnOpening: Phrase = [
  ["h---h---", [62, 69], "Dm"],
  ["x-x-h---", [65, 62, 58], "Bb"],
  ["h---h---", [60, 65], "F"],
  ["j-----ee", [67, 65, 64], "C"],
  ["h---h---", [62, 69], "Dm"],
  ["x-x-h---", [70, 69, 67], "Gm"],
  ["x-x-d--e", [65, 69, 72, 70], "Bb"],
  ["h---h---", [69, 73], "A"],
];
const dawnVerse: Phrase = [
  ["r-eex-x-", [62, 65, 69, 67], "Dm"],
  ["h---x-r-", [65, 62], "Bb"],
  ["x-eed--e", [60, 65, 69, 72, 69], "F"],
  ["x-x-h---", [67, 65, 64], "C"],
  ["r-eex-x-", [65, 69, 74, 72], "Dm"],
  ["d--ex-x-", [70, 69, 67, 70], "Gm"],
  ["eex-d--e", [65, 67, 70, 74, 72], "Bb"],
  ["x-x-h---", [71, 69, 73], "A"],
];
const dawnLift: Phrase = [
  ["x-x-d--e", [67, 70, 74, 72], "Gm"],
  ["h---eex-", [70, 72, 74, 77], "Bb"],
  ["x-eed--e", [76, 77, 79, 81, 79], "Dm"],
  ["h---h---", [77, 76], "C"],
  ["x-x-d--e", [70, 74, 79, 77], "Gm"],
  ["eex-d--e", [74, 76, 77, 82, 81], "Bb"],
  ["x-x-x-x-", [79, 77, 76, 74], "C"],
  ["h---h---", [76, 73], "A"],
];
const dawnChorus: Phrase = [
  ["d--ex-x-", [77, 79, 81, 84], "F"],
  ["h---x-x-", [79, 76, 72], "C"],
  ["eex-d--e", [74, 77, 81, 86, 84], "Dm"],
  ["x-x-h---", [82, 81, 77], "Bb"],
  ["d--ex-x-", [77, 79, 81, 84], "F"],
  ["x-eed--e", [79, 81, 84, 86, 84], "C"],
  ["x-x-d--e", [82, 79, 77, 76], "Gm"],
  ["h---h---", [77, 81], "F"],
];
const dawnBridge: Phrase = [
  ["w-------", [70], "Gm"],
  ["h---x-r-", [74, 77], "Bb"],
  ["r-eex-x-", [76, 77, 79, 81], "C"],
  ["d--ex-x-", [77, 76, 74, 69], "Dm"],
  ["h---h---", [70, 74], "Gm"],
  ["x-x-d--e", [74, 77, 81, 79], "Bb"],
  ["h---eex-", [77, 79, 77, 76], "C"],
  ["j-----r-", [73], "A"],
];
const dawnSolo: Phrase = [
  ["d--ex-x-", [74, 77, 81, 84], "Dm", { 0: 2 }],
  ["h---eex-", [81, 79, 77, 74], "Bb", { 0: 1 }],
  ["x-eed--e", [77, 79, 81, 82, 81], "F", { 3: 2 }],
  ["h---x-x-", [77, 76, 72], "C", { 0: 2 }],
  ["eex-d--e", [74, 77, 81, 84, 81], "Dm", { 3: 2 }],
  ["h---x-x-", [81, 77, 74], "Bb", { 0: 1 }],
  ["x-x-d--e", [77, 79, 79, 77], "Gm", { 2: 2 }],
  ["j-----ee", [76, 74, 73], "A", { 0: 1 }],
];
const dawnSoloReturn: Phrase = [
  ["x-x-d--e", [74, 77, 81, 84], "Dm", { 2: 1 }],
  ["eex-d--e", [82, 84, 86, 84, 82], "Bb", { 3: 2 }],
  ["h---eex-", [84, 81, 77, 81], "F", { 0: 1 }],
  ["x-eed--e", [79, 81, 84, 86, 84], "C", { 3: 2 }],
  ["d--ex-x-", [86, 84, 81, 77], "Dm", { 0: 2 }],
  ["h---x-x-", [82, 81, 77], "Bb", { 0: 2 }],
  ["x-x-d--e", [79, 82, 81, 77], "Gm", { 2: 1 }],
  ["h---h---", [76, 73], "A", { 0: 1 }],
];
const dawnClosing: Phrase = [
  ["h---h---", [77, 81], "F"],
  ["x-x-h---", [79, 77, 76], "C"],
  ["h---x-x-", [74, 77, 81], "Dm"],
  ["j-----ee", [82, 81, 77], "Bb"],
  ["h---h---", [79, 74], "Gm"],
  ["x-x-h---", [72, 74, 76], "C"],
  ["h---h---", [77, 79], "F"],
  ["w-------", [77], "F"],
];

const dawnTape: SongPart = { lead: "mellotron", keys: "mellotron" };
const dawnStrings: SongPart = { ...dawnTape, lead: "violin" };
const dawnQuiet: SongPart = {
  ...dawnTape,
  lead: "synth-lead",
  drums: { kick: "x-------", "hi-hat": "--x---x-" },
};
const dawnFull: SongPart = {
  lead: "electric-guitar",
  keys: "symphonic",
  drums: {
    kick: "X-----x-",
    snare: "----X---",
    "hi-hat": "X-x-x-x-",
    crash: "X",
  },
  fill: { "high-tom": "-----x--", "low-tom": "------xX" },
};
const dawnKeys: SongPart = { ...dawnFull, lead: "synth-lead" };
const dawnLead: SongPart = {
  ...dawnFull,
  drums: { kick: "X-----x-", snare: "----X---", ride: "X-x-x-x-", crash: "X" },
};

export const ORIGINAL_RHYTHM_STEPS = [
  song(
    {
      id: "5-1",
      title: "窓辺の余白",
      hint: "バラード。長い音や休符の間も、足の拍を一定に保ちましょう。",
      bpm: 72,
      countSubdivision: "eighth",
    },
    [
      ["導入とAメロ", [windowVerse, windowIntro], [windowVerse, windowStrings]],
      ["サビ", [windowRefrain, windowStrings], [windowRefrain, windowChorus]],
      [
        "間奏とサビ",
        [windowBridge, windowWoodwind],
        [windowRefrain, windowChorus],
      ],
      [
        "サビと終結部",
        [windowRefrain, windowChorus],
        [windowCoda, windowIntro],
      ],
    ],
  ),
  song(
    {
      id: "5-2",
      title: "曲がり角のステップ",
      hint: "軽快な曲。裏拍に音が続いても、足は下段の足あとに合わせましょう。",
      bpm: 116,
      countSubdivision: "eighth",
    },
    [
      ["導入とAメロ", [cornerVerse, cornerGroove], [cornerVerse, cornerGroove]],
      ["サビ", [cornerRefrain, cornerChorus], [cornerRefrain, cornerChorus]],
      [
        "Aメロとサビ",
        [cornerVerse, cornerGroove],
        [cornerRefrain, cornerChorus],
      ],
      ["間奏", [cornerBreak, cornerInterlude], [cornerBreak, cornerGroove]],
      [
        "サビの繰り返し",
        [cornerRefrain, cornerChorus],
        [cornerRefrain, cornerChorus],
      ],
      ["終結部", [cornerVerse, cornerGroove], [cornerCoda, cornerChorus]],
    ],
  ),
  song(
    {
      id: "5-3",
      title: "七つの灯",
      hint: "変拍子。8分音符7つを「1・2｜1・2｜1・2・3」に分け、大きな足あとで各まとまりの頭を確認しましょう。",
      bpm: 144,
      beatsPerBar: 7,
      beatGroups: [2, 4],
    },
    [
      [
        "導入とAメロ",
        [lanternVerse, lanternIntro],
        [lanternVerse, lanternGroove],
      ],
      [
        "サビ",
        [lanternRefrain, lanternGroove],
        [lanternRefrain, lanternChorus],
      ],
      [
        "間奏とサビ",
        [lanternBridge, lanternInterlude],
        [lanternRefrain, lanternChorus],
      ],
      [
        "Aメロとサビ",
        [lanternVerse, lanternGroove],
        [lanternRefrain, lanternChorus],
      ],
      ["終結部", [lanternCoda, lanternInterlude]],
    ],
  ),
  song(
    {
      id: "5-4",
      title: "火花の先へ",
      hint: "ギターリフが主役のロック。2拍目と4拍目にスネアが鳴っても、足は毎拍、手はリフの音符に合わせましょう。",
      bpm: 128,
      countSubdivision: "eighth",
    },
    [
      ["導入とAメロ", [sparkRiff, sparkIntro], [sparkRiff, sparkVerse]],
      ["Bメロとサビ", [sparkBuild, sparkVerse], [sparkChorus, sparkOpen]],
      ["AメロとBメロ", [sparkRiff, sparkVerse], [sparkBuild, sparkOpen]],
      ["サビ", [sparkChorus, sparkOpen], [sparkChorus, sparkRide]],
      ["ブレイクとギターソロ", [sparkRiff, sparkBreak], [sparkSolo, sparkRide]],
      ["最後のサビ", [sparkChorus, sparkOpen], [sparkChorus, sparkRide]],
      ["終結部", [sparkCoda, sparkOpen]],
    ],
  ),
  song(
    {
      id: "5-5",
      title: "暁の残響",
      hint: "シンフォニック・ロック・バラード。ドラムは半分の速さに感じます。足は180 BPMの足あと、手は主旋律の音符に合わせましょう。",
      bpm: 180,
      countSubdivision: "eighth",
    },
    [
      ["導入", [dawnOpening, dawnTape], [dawnOpening, dawnStrings]],
      ["Aメロ", [dawnVerse, dawnQuiet], [dawnVerse, dawnStrings]],
      ["Bメロとサビ", [dawnLift, dawnKeys], [dawnChorus, dawnFull]],
      ["AメロとBメロ", [dawnVerse, dawnQuiet], [dawnLift, dawnKeys]],
      ["サビ", [dawnChorus, dawnFull], [dawnChorus, dawnKeys]],
      ["弦の間奏", [dawnBridge, dawnStrings], [dawnBridge, dawnTape]],
      ["ギターソロ", [dawnSolo, dawnLead], [dawnSoloReturn, dawnFull]],
      ["最後のサビ", [dawnChorus, dawnLead], [dawnChorus, dawnKeys]],
      ["終結部", [dawnClosing, dawnFull], [dawnClosing, dawnTape]],
    ],
  ),
];
