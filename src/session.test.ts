import { describe, expect, test } from "bun:test";
import {
  addSampleToSession,
  createInitialSessionStats,
  createPitchSample,
  createSessionSummary,
  formatAnalysisStatus,
  resolveAnalysisStatus,
  trimSamples,
} from "./session";

describe("session", () => {
  test("creates pitch samples relative to session start", () => {
    const sample = createPitchSample(
      1250,
      { frequency: 440, clarity: 0.9 },
      0.03,
      440,
      1000,
    );

    expect(sample.timeMs).toBe(250);
    expect(sample.note).toBe("A4");
    expect(sample.midi).toBeCloseTo(69, 8);
    expect(sample.centsFromTarget).toBeCloseTo(0, 8);
  });

  test("records stable time and pitch averages only for valid pitch samples", () => {
    let stats = createInitialSessionStats(1000);
    stats = addSampleToSession(
      stats,
      createPitchSample(
        1100,
        { frequency: 440, clarity: 0.9 },
        0.03,
        440,
        1000,
      ),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(
        1300,
        { frequency: 440 * 2 ** (10 / 1200), clarity: 0.9 },
        0.03,
        440,
        1000,
      ),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(
        1500,
        { frequency: null, clarity: null },
        0.03,
        440,
        1000,
      ),
      20,
    );

    const summary = createSessionSummary(stats, 1600);

    expect(stats.totalValidSamples).toBe(2);
    expect(stats.stableMs).toBe(200);
    expect(summary.elapsedSec).toBeCloseTo(0.6, 8);
    expect(summary.overallAverage).toBeCloseTo(5, 8);
    expect(summary.formattedOverallAverage).toBe("半音の5%");
  });

  test("counts stable time only across consecutive in-range pitch samples", () => {
    let stats = createInitialSessionStats(0);

    stats = addSampleToSession(
      stats,
      createPitchSample(100, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(300, { frequency: null, clarity: null }, 0.03, 440, 0),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(600, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(800, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      20,
    );

    const summary = createSessionSummary(stats, 1000);

    expect(stats.stableMs).toBe(200);
    expect(summary.elapsedSec).toBe(1);
  });

  test("caps stable time across long frame gaps", () => {
    let stats = createInitialSessionStats(0);

    stats = addSampleToSession(
      stats,
      createPitchSample(100, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      20,
    );
    stats = addSampleToSession(
      stats,
      createPitchSample(2100, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      20,
    );

    expect(stats.stableMs).toBe(250);
  });

  test("trims samples outside the graph retention window", () => {
    const samples = [
      createPitchSample(1000, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
      createPitchSample(14_000, { frequency: 440, clarity: 0.9 }, 0.03, 440, 0),
    ];

    expect(trimSamples(samples, 15_000, 12)).toHaveLength(1);
  });

  test("resolves status messages without relying on color alone", () => {
    const target = 440;

    expect(
      formatAnalysisStatus(
        resolveAnalysisStatus(
          createPitchSample(
            0,
            { frequency: null, clarity: null },
            0.001,
            target,
            0,
          ),
          0.006,
          20,
        ),
      ),
    ).toBe("声が小さい、または無音です");
    expect(
      resolveAnalysisStatus(
        createPitchSample(
          0,
          { frequency: null, clarity: null },
          0.02,
          target,
          0,
        ),
        0.006,
        20,
      ),
    ).toBe("undetected");
    expect(
      formatAnalysisStatus(
        resolveAnalysisStatus(
          createPitchSample(
            0,
            { frequency: target, clarity: 0.9 },
            0.02,
            target,
            0,
          ),
          0.006,
          20,
        ),
      ),
    ).toBe("お手本の間合いです");
    expect(
      formatAnalysisStatus(
        resolveAnalysisStatus(
          createPitchSample(
            0,
            { frequency: target * 2 ** (30 / 1200), clarity: 0.9 },
            0.02,
            target,
            0,
          ),
          0.006,
          20,
        ),
      ),
    ).toBe("お手本より高めです");
    expect(
      formatAnalysisStatus(
        resolveAnalysisStatus(
          createPitchSample(
            0,
            { frequency: target * 2 ** (-30 / 1200), clarity: 0.9 },
            0.02,
            target,
            0,
          ),
          0.006,
          20,
        ),
      ),
    ).toBe("お手本より低めです");
    expect(formatAnalysisStatus("undetected")).toBe("声の高さをつかめません");
  });
});
