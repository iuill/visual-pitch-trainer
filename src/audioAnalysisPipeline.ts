import { analyzeAudioData } from "./audioFileAnalysis";
import {
  analyzeAudioDataWithCrepe,
  assertCrepeModelAccessible,
  type CrepeAnalysisProgress,
  type CrepeModelSize,
  getCrepeModelUrl,
  getCrepePitchDetectionSupportMessage,
  releaseCrepeSessions,
} from "./crepePitchDetection";
import {
  type DecodedMediaAudio,
  decodeMediaAudio,
  mixChannelsToMono,
} from "./mediaAudioExtraction";
import {
  analyzeAudioDataWithRmvpe,
  assertRmvpeModelAccessible,
  getRmvpePitchDetectionSupportMessage,
  type RmvpeAnalysisProgress,
  releaseRmvpeSession,
} from "./rmvpePitchDetection";
import {
  assertVocalSeparationModelAccessible,
  assertVocalSeparationSupported,
  extractVocals,
  type VocalSeparationModelId,
  type VocalSeparationProgress,
} from "./vocalSeparation";

export const AUDIO_PITCH_ESTIMATORS = [
  "pitchy",
  "crepe-small",
  "crepe-medium",
  "crepe-large",
  "crepe-full",
  "rmvpe",
] as const;
export type AudioPitchEstimator = (typeof AUDIO_PITCH_ESTIMATORS)[number];

export function resolveAudioPitchEstimator(value: string): AudioPitchEstimator {
  return (
    AUDIO_PITCH_ESTIMATORS.find((estimator) => estimator === value) ?? "rmvpe"
  );
}

export function getEstimatorLabel(estimator: AudioPitchEstimator): string {
  if (estimator === "pitchy") return estimator;
  if (estimator === "rmvpe") return "RMVPE";
  return `CREPE ${getCrepeModelSize(estimator)}`;
}

function getCrepeModelSize(
  estimator: `crepe-${CrepeModelSize}`,
): CrepeModelSize {
  return estimator.slice("crepe-".length) as CrepeModelSize;
}

export type AudioAnalysisProgress =
  | { kind: "preflight" | "decoding" | "estimating" }
  | { kind: "vocal"; progress: VocalSeparationProgress }
  | {
      kind: "pitch";
      estimator: AudioPitchEstimator;
      progress: CrepeAnalysisProgress | RmvpeAnalysisProgress;
    };

type ReportProgress = (event: AudioAnalysisProgress) => void;

export function getEstimatorSupportMessage(estimator: AudioPitchEstimator) {
  if (estimator === "pitchy") return null;
  return estimator === "rmvpe"
    ? getRmvpePitchDetectionSupportMessage()
    : getCrepePitchDetectionSupportMessage();
}

async function preflightEstimator(estimator: AudioPitchEstimator) {
  if (estimator === "pitchy") return;
  const supportMessage = getEstimatorSupportMessage(estimator);
  if (supportMessage) throw new Error(supportMessage);
  if (estimator === "rmvpe") await assertRmvpeModelAccessible();
  else await assertCrepeModelAccessible(getCrepeModelSize(estimator));
}

export async function separateAudio(
  audio: DecodedMediaAudio,
  modelId: VocalSeparationModelId,
  report: ReportProgress,
) {
  return extractVocals(audio, {
    modelId,
    onProgress: (progress) => report({ kind: "vocal", progress }),
  });
}

export async function estimateAudioPitch(
  estimator: AudioPitchEstimator,
  mono: Float32Array,
  sampleRate: number,
  report: ReportProgress,
) {
  const onProgress = (
    progress: CrepeAnalysisProgress | RmvpeAnalysisProgress,
  ) => report({ kind: "pitch", estimator, progress });

  if (estimator === "pitchy") return analyzeAudioData(mono, { sampleRate });

  try {
    if (estimator === "rmvpe") {
      return await analyzeAudioDataWithRmvpe(mono, { sampleRate, onProgress });
    }
    return await analyzeAudioDataWithCrepe(mono, {
      sampleRate,
      modelUrl: getCrepeModelUrl(getCrepeModelSize(estimator)),
      onProgress,
    });
  } finally {
    if (estimator === "rmvpe") await releaseRmvpeSession();
    else await releaseCrepeSessions();
  }
}

export async function analyzeAudioFile(
  file: File,
  options: {
    context: AudioContext;
    estimator: AudioPitchEstimator;
    vocalModel: VocalSeparationModelId | null;
    report: ReportProgress;
    signal: AbortSignal;
    yieldToUi: () => Promise<void>;
  },
) {
  const { context, estimator, vocalModel, report, signal, yieldToUi } = options;
  async function stage(kind: "preflight" | "decoding" | "estimating") {
    signal.throwIfAborted();
    report({ kind });
    await yieldToUi();
    signal.throwIfAborted();
  }

  await stage("preflight");
  if (vocalModel) {
    await assertVocalSeparationSupported();
    signal.throwIfAborted();
    await assertVocalSeparationModelAccessible(vocalModel);
    signal.throwIfAborted();
  }
  await preflightEstimator(estimator);
  await stage("decoding");
  const decoded = await decodeMediaAudio(file, context);
  signal.throwIfAborted();
  const vocals = vocalModel
    ? await separateAudio(decoded, vocalModel, report)
    : null;
  signal.throwIfAborted();
  const audio = vocals ?? decoded;
  await stage("estimating");
  const analysis = await estimateAudioPitch(
    estimator,
    mixChannelsToMono(audio.channels),
    audio.sampleRate,
    report,
  );
  signal.throwIfAborted();
  return { analysis, vocals };
}
