import { describe, expect, test } from "bun:test";
import {
  buildNoteRange,
  chooseBestLibraryPitch,
  formatPitchGap,
  formatPitchMovement,
  getRms,
  hzToCents,
  hzToMidi,
  hzToNoteName,
  midiToFrequency,
  midiToNoteName,
  midiToSolfegeName,
} from "./pitchMath";

describe("pitch math", () => {
  test("converts MIDI, hertz, and note names around A4", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 8);
    expect(hzToMidi(440)).toBeCloseTo(69, 8);
    expect(hzToNoteName(440)).toBe("A4");
    expect(midiToNoteName(60)).toBe("C4");
    expect(midiToSolfegeName(68)).toBe("ソ#");
  });

  test("builds a chromatic one-octave note range with repeated do", () => {
    const notes = buildNoteRange(60);

    expect(notes).toHaveLength(13);
    expect(notes[0]).toMatchObject({ solfege: "ド", name: "C4" });
    expect(notes[12]).toMatchObject({ solfege: "ド", name: "C5" });
  });

  test("calculates cents and formatted semitone percentages", () => {
    expect(hzToCents(880, 440)).toBeCloseTo(1200, 8);
    expect(formatPitchGap(null)).toBe("--");
    expect(formatPitchGap(19.6)).toBe("半音の20%");
  });

  test("calculates RMS volume", () => {
    expect(getRms(new Float32Array([0, 1, 0, -1]))).toBeCloseTo(
      Math.SQRT1_2,
      8,
    );
  });

  test("describes adjacent targets including repeated notes, semitones and octave changes", () => {
    const describe = (from: number, to: number) =>
      formatPitchMovement(midiToFrequency(from), midiToFrequency(to));
    expect(describe(60, 60)).toBe("同じ高さ");
    expect(describe(64, 65)).toBe("半音上げる");
    expect(describe(60, 59)).toBe("半音下げる");
    expect(describe(60, 62)).toBe("全音上げる（半音2個分）");
    expect(describe(62, 60)).toBe("全音下げる（半音2個分）");
    expect(describe(60, 64)).toBe("半音4個分上げる");
    expect(describe(67, 60)).toBe("半音7個分下げる");
    expect(describe(60, 72)).toBe("1オクターブ上げる");
    expect(describe(72, 60)).toBe("1オクターブ下げる");
    expect(describe(76, 77)).toBe(describe(64, 65));
    expect(describe(60, 63)).toBe("半音3個分上げる");
    expect(describe(62, 65)).toBe(describe(60, 63));
    expect(describe(65, 62)).toBe("半音3個分下げる");
    expect(describe(60, 76)).toBe("半音16個分上げる");
    expect(
      formatPitchMovement(midiToFrequency(60), midiToFrequency(61), true),
    ).toBe("半音");
    expect(
      formatPitchMovement(midiToFrequency(62), midiToFrequency(60), true),
    ).toBe("全音");
    expect(
      formatPitchMovement(midiToFrequency(60), midiToFrequency(72), true),
    ).toBe("1オクターブ");
    expect(
      formatPitchMovement(midiToFrequency(60), midiToFrequency(60), true),
    ).toBe("同じ高さ");
  });

  test("chooses the closest confident pitch inside the target range", () => {
    const target = midiToFrequency(60);
    const best = chooseBestLibraryPitch(
      [
        { frequency: target * 2.2, confidence: 0.99, source: "pitchy" },
        {
          frequency: target * 2 ** (1 / 12),
          confidence: 0.8,
          source: "pitchy",
        },
        { frequency: target, confidence: 0.86, source: "pitchy" },
      ],
      target,
    );

    expect(best?.frequency).toBeCloseTo(target, 8);
  });

  test("prefers a target-aligned candidate over a more confident semitone miss", () => {
    const target = midiToFrequency(60);
    const best = chooseBestLibraryPitch(
      [
        {
          frequency: target * 2 ** (1 / 12),
          confidence: 0.99,
          source: "pitchy",
        },
        { frequency: target, confidence: 0.86, source: "pitchy" },
      ],
      target,
    );

    expect(best?.frequency).toBeCloseTo(target, 8);
  });

  test("rejects low-confidence pitch candidates", () => {
    expect(
      chooseBestLibraryPitch(
        [{ frequency: 440, confidence: 0.3, source: "pitchy" }],
        440,
      ),
    ).toBeNull();
  });
});
