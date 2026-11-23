import {
  type AudioAnalysisProgress,
  getEstimatorLabel,
} from "./audioAnalysisPipeline";
import { clamp } from "./graphModel";
import type { VocalSeparationProgress } from "./vocalSeparation";

export function createAudioAnalysisReporter(status: (message: string) => void) {
  const timings = new Map<string, number>();

  return (event: AudioAnalysisProgress) => {
    switch (event.kind) {
      case "preflight":
        status("モデルファイルにアクセスできるか確認しています。");
        break;
      case "decoding":
        status("音源を読み込んでいます。長い曲は少し時間がかかります。");
        break;
      case "estimating":
        status("声の高さを推定しています。");
        break;
      case "vocal":
        updateVocalExtractionProgress(event.progress);
        break;
      case "pitch": {
        const label = getEstimatorLabel(event.estimator);
        const { phase, processedFrames, totalFrames } = event.progress;
        const key = `${event.estimator}:${phase}`;
        if (phase === "loading-runtime") {
          status(`${label}推定の実行環境を読み込んでいます。`);
        } else if (phase === "loading-model") {
          status(
            `${label}モデルを読み込んでいます。初回は時間がかかります。（${formatElapsedProgress(key)}）`,
          );
        } else {
          const message =
            phase === "extracting-features"
              ? `${label}用の特徴量を作成しています。`
              : `${label}で声の高さを推定しています。`;
          status(
            processedFrames !== undefined && totalFrames
              ? `${message}${processedFrames} / ${totalFrames} フレーム（${formatProgressTiming(key, processedFrames, totalFrames)}）`
              : message,
          );
        }
        break;
      }
    }
  };

  function formatProgressTiming(
    key: string,
    completedUnits: number,
    totalUnits: number,
  ): string {
    const total = Math.max(0, totalUnits);
    if (total <= 0) {
      return formatElapsedProgress(key);
    }

    const completed = clamp(completedUnits, 0, total);
    const elapsedSec = getProgressElapsedSec(key);
    const parts = [
      formatPercent(completed / total),
      `経過 ${formatProgressDuration(elapsedSec)}`,
    ];

    if (completed > 0 && completed < total) {
      const remainingSec = (elapsedSec / completed) * (total - completed);
      parts.push(`残り 約${formatProgressDuration(remainingSec)}`);
    } else if (completed >= total) {
      parts.push("残り 0秒");
    }

    return parts.join(" / ");
  }

  function formatElapsedProgress(key: string): string {
    return `経過 ${formatProgressDuration(getProgressElapsedSec(key))}`;
  }

  function getProgressElapsedSec(key: string): number {
    const startedAt = timings.get(key) ?? performance.now();
    if (!timings.has(key)) {
      timings.set(key, startedAt);
    }

    return Math.max(0, (performance.now() - startedAt) / 1000);
  }

  function formatProgressDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "0秒";
    }

    const roundedSeconds = Math.round(seconds);
    if (roundedSeconds < 60) {
      return `${roundedSeconds}秒`;
    }

    const minutes = Math.floor(roundedSeconds / 60);
    const secondsPart = roundedSeconds % 60;
    if (minutes < 60) {
      return `${minutes}分${secondsPart}秒`;
    }

    const hours = Math.floor(minutes / 60);
    const minutesPart = minutes % 60;
    return `${hours}時間${String(minutesPart).padStart(2, "0")}分`;
  }

  function updateVocalExtractionProgress(progress: VocalSeparationProgress) {
    const modelLabel = progress.modelLabel ?? "ボーカル抽出モデル";

    if (progress.phase === "loading-runtime") {
      status("ボーカル抽出の実行環境を読み込んでいます。");
      return;
    }

    if (progress.phase === "loading-model") {
      const progressKey = `vocal:${modelLabel}:loading-model`;
      status(
        progress.loadedBytes !== undefined && progress.totalBytes !== undefined
          ? `${modelLabel}を読み込んでいます。${formatBytes(
              progress.loadedBytes,
            )} / ${formatBytes(progress.totalBytes)}（${formatProgressTiming(
              progressKey,
              progress.loadedBytes,
              progress.totalBytes,
            )}）`
          : `${modelLabel}を読み込んでいます。初回は時間がかかります。（${formatElapsedProgress(progressKey)}）`,
      );
      return;
    }

    const progressKey = `vocal:${modelLabel}:separating`;
    status(
      progress.currentSegment !== undefined &&
        progress.totalSegments !== undefined
        ? `${modelLabel}でボーカルを抽出しています。${progress.currentSegment} / ${progress.totalSegments} Chunks（${formatProgressTiming(
            progressKey,
            progress.currentSegment,
            progress.totalSegments,
          )}）`
        : `${modelLabel}でボーカルを抽出しています。${formatProgressTiming(
            progressKey,
            progress.progress ?? 0,
            1,
          )}`,
    );
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "--";
  }

  const mib = bytes / 1024 / 1024;

  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(1)} GB`;
  }

  return `${Math.round(mib)} MB`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(clamp(ratio, 0, 1) * 100)}%`;
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}
