import {
  AUDIO_PITCH_ESTIMATORS,
  estimateAudioPitch,
  getEstimatorLabel,
  getEstimatorSupportMessage,
  separateAudio,
} from "./audioAnalysisPipeline";
import {
  createAudioAnalysisReporter,
  waitForPaint,
} from "./audioAnalysisProgress";
import { closeAudioContext, getAudioContext } from "./audioContext";
import {
  audioFileBaseName,
  downloadBlob,
  vocalDownloadName,
} from "./audioDownloads";
import { audioRangeGraphWidth, renderAudioRangeGraph } from "./audioRangeGraph";
import { queryElement } from "./dom";
import { getGraphTheme } from "./graphCanvas";
import {
  createMp3BlobFromDecodedAudio,
  type DecodedMediaAudio,
  decodeMediaAudio,
  mixChannelsToMono,
} from "./mediaAudioExtraction";
import {
  assertVocalSeparationSupported,
  VOCAL_SEPARATION_MODELS,
  type VocalSeparationModelId,
} from "./vocalSeparation";
import "../styles/comparison.css";

const COMPARISON_PNG_BACKGROUND = "#f7faf8";

const elements = {
  controls: queryElement<HTMLFieldSetElement>("#comparisonControls"),
  file: queryElement<HTMLInputElement>("#comparisonFile"),
  vocalModel: queryElement<HTMLSelectElement>("#comparisonVocalModel"),
  pitch: queryElement<HTMLButtonElement>("#comparePitch"),
  vocals: queryElement<HTMLButtonElement>("#compareVocals"),
  status: queryElement<HTMLElement>("#comparisonStatus"),
};

const vocalModels = (
  Object.keys(VOCAL_SEPARATION_MODELS) as VocalSeparationModelId[]
).filter((id) => VOCAL_SEPARATION_MODELS[id].isAvailableInBuild);

elements.vocalModel.replaceChildren(
  new Option("抽出せずに比較", ""),
  ...vocalModels.map((id) => new Option(VOCAL_SEPARATION_MODELS[id].label, id)),
);

elements.file.addEventListener("change", () => {
  const selected = Boolean(elements.file.files?.length);
  elements.pitch.disabled = !selected;
  elements.vocals.disabled = !selected;
});
elements.pitch.addEventListener("click", () => void runComparison("pitch"));
elements.vocals.addEventListener("click", () => void runComparison("vocals"));
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) closeAudioContext();
});

function status(message: string) {
  elements.status.textContent = message;
}

async function runComparison(kind: "pitch" | "vocals") {
  const file = elements.file.files?.[0];
  if (!file || elements.controls.disabled) return;
  elements.controls.disabled = true;
  const vocalModel = vocalModels.find((id) => id === elements.vocalModel.value);
  try {
    if (kind === "pitch") {
      for (const estimator of AUDIO_PITCH_ESTIMATORS) {
        const unsupported = getEstimatorSupportMessage(estimator);
        if (unsupported) throw new Error(unsupported);
      }
    }
    if (kind === "vocals" || vocalModel) await assertVocalSeparationSupported();
    status("比較用の音源を読み込んでいます。");
    await waitForPaint();
    const audio = await decodeMediaAudio(file, getAudioContext());
    if (kind === "pitch") {
      await comparePitch(file, audio, vocalModel);
    } else {
      await compareVocals(file, audio);
    }
  } catch (error) {
    status(error instanceof Error ? error.message : "比較に失敗しました。");
    console.error(error);
  } finally {
    elements.controls.disabled = false;
  }
}

async function comparePitch(
  file: File,
  source: DecodedMediaAudio,
  vocalModel: VocalSeparationModelId | undefined,
) {
  const report = createAudioAnalysisReporter(status);
  const audio = vocalModel
    ? await separateAudio(source, vocalModel, report)
    : source;
  const mono = mixChannelsToMono(audio.channels);
  const width = audioRangeGraphWidth(mono.length / audio.sampleRate, 960);
  const graphHeight = 260;
  const titleHeight = 52;
  const rowHeight = graphHeight + titleHeight;

  const combined = createCanvas(
    width,
    rowHeight * AUDIO_PITCH_ESTIMATORS.length,
  );
  const graph = createCanvas(width, graphHeight);
  combined.fillStyle = COMPARISON_PNG_BACKGROUND;
  combined.fillRect(0, 0, combined.canvas.width, combined.canvas.height);

  for (const [index, estimator] of AUDIO_PITCH_ESTIMATORS.entries()) {
    const label = getEstimatorLabel(estimator);
    status(`${label}の比較用グラフを作成しています。`);
    await waitForPaint();
    const analysis = await estimateAudioPitch(
      estimator,
      mono,
      audio.sampleRate,
      report,
    );
    renderAudioRangeGraph(graph, {
      analysis,
      durationSec: analysis.summary.durationSec,
      pixelRatio: 1,
    });
    const top = index * rowHeight;
    combined.fillStyle = getGraphTheme().text;
    combined.font = "18px system-ui, sans-serif";
    combined.fillText(label, 18, top + 32);
    combined.drawImage(graph.canvas, 0, top + titleHeight);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    combined.canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("グラフPNGを作成できませんでした。"));
    }, "image/png");
  });
  downloadBlob(blob, `${audioFileBaseName(file)}-crepe-comparison.png`);
  status("ピッチ推定モデル比較PNGを出力しました。");
}

async function compareVocals(file: File, audio: DecodedMediaAudio) {
  const report = createAudioAnalysisReporter(status);
  const failures: string[] = [];
  for (const id of vocalModels) {
    const { label } = VOCAL_SEPARATION_MODELS[id];
    try {
      status(`${label}でボーカルを抽出しています。`);
      await waitForPaint();
      const vocals = await separateAudio(audio, id, report);
      status(`${label}の抽出ボーカルをMP3に変換しています。`);
      const blob = await createMp3BlobFromDecodedAudio(vocals);
      downloadBlob(blob, vocalDownloadName(file, id));
    } catch (error) {
      failures.push(label);
      console.error(`${label} vocal separation failed.`, error);
    }
  }
  if (failures.length === 0)
    status("全ボーカル抽出モデルのMP3を出力しました。");
  else if (failures.length === vocalModels.length)
    status(`ボーカル抽出に失敗しました。対象モデル ${failures.join("、")}`);
  else
    status(
      `ボーカル抽出MP3の出力が完了しました。一部のモデルで失敗しました（${failures.join("、")}）。`,
    );
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("比較用グラフを作成できませんでした。");
  return context;
}
