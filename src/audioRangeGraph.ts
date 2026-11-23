import type { AudioFileAnalysis, AudioPitchPoint } from "./audioFileAnalysis";
import { type GraphPadding, midiToY } from "./graphModel";
import { midiToNoteName, midiToSolfegeName } from "./pitchMath";

const AUDIO_RANGE_MIN_WIDTH = 960;
const AUDIO_RANGE_MAX_WIDTH = 28800;
const AUDIO_RANGE_PIXELS_PER_SECOND = 32;
export const AUDIO_RANGE_GRAPH_PADDING: GraphPadding = {
  top: 28,
  right: 20,
  bottom: 34,
  left: 54,
};
export function audioRangeGraphWidth(
  durationSec: number,
  visibleWidth: number,
) {
  const minWidth = durationSec > 0 ? AUDIO_RANGE_MIN_WIDTH : visibleWidth;
  const expandedWidth =
    durationSec > 0
      ? Math.ceil(durationSec * AUDIO_RANGE_PIXELS_PER_SECOND)
      : visibleWidth;
  return Math.min(
    AUDIO_RANGE_MAX_WIDTH,
    Math.max(visibleWidth, minWidth, expandedWidth),
  );
}

export function renderAudioRangeGraph(
  context: CanvasRenderingContext2D,
  options: {
    axisContext?: CanvasRenderingContext2D;
    pixelRatio: number;
    analysis: AudioFileAnalysis | null;
    durationSec: number;
  },
) {
  const { canvas } = context;
  const { axisContext, pixelRatio, analysis, durationSec } = options;
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  const padding = AUDIO_RANGE_GRAPH_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  const summary = analysis?.summary;
  const midiBounds = getAudioRangeMidiBounds(summary);
  const minMidi = Math.floor(midiBounds.min - 2);
  const maxMidi = Math.ceil(midiBounds.max + 2);

  drawAudioRangeGrid(context, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec,
    width,
    height,
  });
  if (axisContext)
    drawAudioRangeAxis(axisContext, pixelRatio, {
      padding,
      plotHeight,
      minMidi,
      maxMidi,
    });

  if (!analysis || analysis.summary.validFrames === 0) {
    context.fillStyle = "#5c6870";
    context.font = "16px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(
      "音源を選んで解析すると、推定した声域を表示します",
      width / 2,
      height / 2,
    );
    context.textAlign = "left";
    return;
  }

  drawVoiceRangeBand(context, {
    summary: analysis.summary,
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
  });
  drawAudioPitchCloud(context, analysis.points, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec: analysis.summary.durationSec,
  });
  drawAudioPitchTrend(context, analysis.points, {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec: analysis.summary.durationSec,
  });
}

function drawAudioRangeGrid(
  context: CanvasRenderingContext2D,
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
    width: number;
    height: number;
  },
) {
  const {
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    durationSec,
    width,
    height,
  } = options;

  context.strokeStyle = "#e8edf0";
  context.lineWidth = 1;
  context.font = "14px system-ui, sans-serif";

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = midiToY(midi, minMidi, maxMidi, padding, plotHeight);
    const isOctave = midi % 12 === 0;

    context.strokeStyle = isOctave ? "#c6d4d8" : "#e8edf0";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + plotWidth, y);
    context.stroke();

    if (isOctave || midi % 2 === 0) {
      context.fillStyle = "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  drawAudioTimeGrid(context, {
    padding,
    plotWidth,
    plotHeight,
    durationSec,
    height,
  });

  context.fillStyle = "#5c6870";
  context.fillText("音名", 8, 20);
  context.fillText("開始", padding.left, height - 10);
  context.fillText("終わり", width - padding.right - 44, height - 10);
}

function drawAudioRangeAxis(
  context: CanvasRenderingContext2D,
  pixelRatio: number,
  options: {
    padding: GraphPadding;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
  },
) {
  const { canvas } = context;
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  const { padding, plotHeight, minMidi, maxMidi } = options;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfc";
  context.fillRect(0, 0, width, height);

  context.font = "14px system-ui, sans-serif";

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = midiToY(midi, minMidi, maxMidi, padding, plotHeight);
    const isOctave = midi % 12 === 0;

    if (isOctave || midi % 2 === 0) {
      context.fillStyle = "#73808a";
      context.fillText(midiToNoteName(midi), 8, y + 5);
    }
  }

  context.fillStyle = "#5c6870";
  context.fillText("音名", 8, 20);
}

function drawAudioTimeGrid(
  context: CanvasRenderingContext2D,
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    durationSec: number;
    height: number;
  },
) {
  const { padding, plotWidth, plotHeight, durationSec, height } = options;
  const intervalSec = getAudioTimeGridInterval(durationSec);
  const safeDurationSec = Math.max(1, durationSec);

  context.strokeStyle = "#d7dee2";
  context.fillStyle = "#73808a";
  context.textAlign = "center";

  if (durationSec <= 0) {
    for (let ratio = 0; ratio <= 1; ratio += 0.25) {
      const x = padding.left + plotWidth * ratio;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, padding.top + plotHeight);
      context.stroke();
    }
    context.textAlign = "left";
    return;
  }

  for (
    let seconds = intervalSec;
    seconds < durationSec;
    seconds += intervalSec
  ) {
    const x = padding.left + (seconds / safeDurationSec) * plotWidth;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + plotHeight);
    context.stroke();

    context.fillText(formatTimeLabel(seconds), x, height - 10);
  }

  context.textAlign = "left";
}

function getAudioTimeGridInterval(durationSec: number): number {
  return durationSec > 0 ? 5 : 15;
}

function formatTimeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatClockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  return formatTimeLabel(seconds);
}

function getAudioRangeMidiBounds(
  summary: AudioFileAnalysis["summary"] | undefined,
): { min: number; max: number } {
  if (
    !summary ||
    summary.robustLowestMidi === null ||
    summary.robustHighestMidi === null
  ) {
    return { min: 48, max: 72 };
  }

  const center =
    summary.medianMidi ??
    midpoint(summary.robustLowestMidi, summary.robustHighestMidi);
  const minSpan = 18;
  const halfSpan = Math.max(
    minSpan / 2,
    Math.abs(summary.robustHighestMidi - summary.robustLowestMidi) / 2,
  );

  return {
    min: center - halfSpan,
    max: center + halfSpan,
  };
}

function midpoint(a: number, b: number): number {
  return (a + b) / 2;
}

function drawVoiceRangeBand(
  context: CanvasRenderingContext2D,
  options: {
    summary: AudioFileAnalysis["summary"];
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
  },
) {
  const { summary, padding, plotWidth, plotHeight, minMidi, maxMidi } = options;

  if (
    summary.robustLowestMidi === null ||
    summary.robustHighestMidi === null ||
    summary.commonLowestMidi === null ||
    summary.commonHighestMidi === null ||
    summary.medianMidi === null
  ) {
    return;
  }

  const robustTop = midiToY(
    summary.robustHighestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const robustBottom = midiToY(
    summary.robustLowestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const commonTop = midiToY(
    summary.commonHighestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const commonBottom = midiToY(
    summary.commonLowestMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );
  const medianY = midiToY(
    summary.medianMidi,
    minMidi,
    maxMidi,
    padding,
    plotHeight,
  );

  context.fillStyle = "rgba(20, 108, 117, 0.1)";
  context.fillRect(
    padding.left,
    robustTop,
    plotWidth,
    robustBottom - robustTop,
  );
  context.fillStyle = "rgba(47, 133, 90, 0.16)";
  context.fillRect(
    padding.left,
    commonTop,
    plotWidth,
    commonBottom - commonTop,
  );
  context.strokeStyle = "#0d4f56";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(padding.left, medianY);
  context.lineTo(padding.left + plotWidth, medianY);
  context.stroke();
}

function drawAudioPitchCloud(
  context: CanvasRenderingContext2D,
  points: AudioPitchPoint[],
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
  },
) {
  const { padding, plotWidth, plotHeight, minMidi, maxMidi, durationSec } =
    options;

  context.save();

  points.forEach((point) => {
    if (point.midi === null) {
      return;
    }

    const x =
      padding.left +
      (point.timeMs / Math.max(1, durationSec * 1000)) * plotWidth;
    const y = midiToY(point.midi, minMidi, maxMidi, padding, plotHeight);
    const alpha = 0.18 + 0.5 * Math.max(0, Math.min(1, point.clarity ?? 0));

    context.fillStyle = `rgba(43, 108, 176, ${alpha})`;
    context.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
  });

  context.restore();
}

function drawAudioPitchTrend(
  context: CanvasRenderingContext2D,
  points: AudioPitchPoint[],
  options: {
    padding: GraphPadding;
    plotWidth: number;
    plotHeight: number;
    minMidi: number;
    maxMidi: number;
    durationSec: number;
  },
) {
  const { padding, plotWidth, plotHeight, minMidi, maxMidi, durationSec } =
    options;
  const trendPoints = buildAudioPitchTrend(points);
  let startsLine = true;

  context.save();
  context.strokeStyle = "#1f5f93";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  trendPoints.forEach((point) => {
    const x =
      padding.left +
      (point.timeMs / Math.max(1, durationSec * 1000)) * plotWidth;
    const y = midiToY(point.midi, minMidi, maxMidi, padding, plotHeight);

    if (point.startsLine || startsLine) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }

    startsLine = false;
  });

  context.stroke();
  context.restore();
}

export function audioPitchLabelAt(
  points: readonly AudioPitchPoint[],
  timeMs: number,
): string | null {
  const maxDistanceMs = 300;
  let start = 0;
  let end = points.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (points[middle].timeMs < timeMs - maxDistanceMs) start = middle + 1;
    else end = middle;
  }

  let nearestMidi: number | null = null;
  let nearestDistance = Infinity;
  for (let index = start; index < points.length; index++) {
    const point = points[index];
    if (point.timeMs > timeMs + maxDistanceMs) break;
    if (point.midi === null) continue;
    const distance = Math.abs(point.timeMs - timeMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestMidi = point.midi;
    }
  }
  return nearestMidi === null
    ? null
    : `${midiToSolfegeName(nearestMidi)} ${midiToNoteName(nearestMidi)}`;
}

function buildAudioPitchTrend(
  points: AudioPitchPoint[],
): { timeMs: number; midi: number; startsLine: boolean }[] {
  const trendPoints: { timeMs: number; midi: number; startsLine: boolean }[] =
    [];
  let previousTimeMs: number | null = null;

  points.forEach((point, index) => {
    if (point.midi === null) {
      previousTimeMs = null;
      return;
    }

    const nearbyMidi = getNearbyAudioMidiValues(points, index, 5);

    if (nearbyMidi.length < 3) {
      previousTimeMs = null;
      return;
    }

    nearbyMidi.sort((a, b) => a - b);
    const median = percentile(nearbyMidi, 0.5);

    if (median === null) {
      previousTimeMs = null;
      return;
    }

    trendPoints.push({
      timeMs: point.timeMs,
      midi: median,
      startsLine:
        previousTimeMs === null || point.timeMs - previousTimeMs > 1600,
    });
    previousTimeMs = point.timeMs;
  });

  return trendPoints;
}

function getNearbyAudioMidiValues(
  points: AudioPitchPoint[],
  index: number,
  radius: number,
): number[] {
  const values: number[] = [];
  const start = Math.max(0, index - radius);
  const end = Math.min(points.length - 1, index + radius);

  for (let nearbyIndex = start; nearbyIndex <= end; nearbyIndex += 1) {
    const midi = points[nearbyIndex]?.midi;

    if (midi !== null && midi !== undefined && Number.isFinite(midi)) {
      values.push(midi);
    }
  }

  return values;
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = (sortedValues.length - 1) * Math.max(0, Math.min(1, ratio));
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;
  const lower = sortedValues[lowerIndex] ?? sortedValues[0];
  const upper = sortedValues[upperIndex] ?? sortedValues.at(-1) ?? lower;

  return lower + (upper - lower) * weight;
}
