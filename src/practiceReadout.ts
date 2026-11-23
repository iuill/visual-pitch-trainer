import { queryElement } from "./dom";
import {
  type AnalysisStatus,
  formatAnalysisStatus,
  type PitchSample,
} from "./session";

export function createPracticeReadout(
  getSettings: () => { tolerance: number },
) {
  const status = queryElement<HTMLElement>("#analysisStatus");
  const description = queryElement<HTMLElement>("#graphDescription");
  const volume = queryElement<HTMLElement>("#graphVolume");
  const clarityReadout = queryElement<HTMLElement>("#graphClarity");

  function updatePitchMeters(sample: PitchSample | null) {
    volume.textContent = sample
      ? `${Math.round(Math.min(sample.volume * 500, 100))}%`
      : "--";
    const clarity = sample?.clarity;
    clarityReadout.textContent =
      clarity == null ? "--" : `${Math.round(clarity * 100)}%`;
  }

  function formatGraphDescription(
    sample: PitchSample,
    status: AnalysisStatus,
    targetName: string,
  ): string {
    if (sample.frequency === null || sample.centsFromTarget === null) {
      return `直近の状態: ${formatAnalysisStatus(status)}。声量は${Math.round(
        Math.min(sample.volume * 500, 100),
      )}%、音程検出は${
        sample.clarity === null
          ? "不明"
          : `${Math.round(sample.clarity * 100)}%`
      }です。`;
    }

    const { tolerance } = getSettings();
    const direction =
      sample.centsFromTarget > tolerance
        ? "高め"
        : sample.centsFromTarget < -tolerance
          ? "低め"
          : "範囲内";

    return `直近の声は${sample.note ?? "不明"}、目標${targetName}に対して半音の${Math.round(
      Math.abs(sample.centsFromTarget),
    )}%${direction}です。声量は${Math.round(
      Math.min(sample.volume * 500, 100),
    )}%、音程検出は${
      sample.clarity === null ? "不明" : `${Math.round(sample.clarity * 100)}%`
    }です。`;
  }

  return {
    status,
    showMeters: updatePitchMeters,
    describe(
      sample: PitchSample,
      analysis: AnalysisStatus,
      targetName: string,
    ) {
      description.textContent = formatGraphDescription(
        sample,
        analysis,
        targetName,
      );
    },
    clearDescription() {
      description.textContent = "声の軌跡はまだ記録されていません。";
    },
    describeMelody() {
      description.textContent = "メロディと発声の位置をグラフに表示します。";
    },
  };
}

export type PracticeReadout = ReturnType<typeof createPracticeReadout>;
