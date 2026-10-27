import { hzToMidi } from "./pitchMath";
import type { PitchSample } from "./session";

export type GraphPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type GraphViewport = {
  width: number;
  height: number;
  padding: GraphPadding;
  plotWidth: number;
  plotHeight: number;
  minMidi: number;
  maxMidi: number;
  targetMidi: number;
  zeroY: number;
  toleranceTop: number;
  toleranceBottom: number;
  startTime: number;
  latestTime: number;
};

export type GraphPoint = {
  x: number;
  y: number;
  startsLine: boolean;
};

export const DEFAULT_GRAPH_PADDING: GraphPadding = {
  top: 38,
  right: 20,
  bottom: 34,
  left: 54,
};

export function createGraphViewport(
  width: number,
  height: number,
  targetFrequency: number,
  tolerance: number,
  samples: PitchSample[],
  graphSeconds: number,
  graphRangeSemitones: number,
  padding: GraphPadding = DEFAULT_GRAPH_PADDING,
): GraphViewport {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const targetMidi = hzToMidi(targetFrequency);
  const minMidi = targetMidi - graphRangeSemitones;
  const maxMidi = targetMidi + graphRangeSemitones;
  const latestSampleTime = samples.at(-1)?.timeMs;
  const latestTime = latestSampleTime ?? graphSeconds * 1000;
  const startTime =
    latestSampleTime === undefined ? 0 : latestTime - graphSeconds * 1000;
  const toleranceSemitone = tolerance / 100;

  return {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    minMidi,
    maxMidi,
    targetMidi,
    zeroY: midiToY(targetMidi, minMidi, maxMidi, padding, plotHeight),
    toleranceTop: midiToY(
      targetMidi + toleranceSemitone,
      minMidi,
      maxMidi,
      padding,
      plotHeight,
    ),
    toleranceBottom: midiToY(
      targetMidi - toleranceSemitone,
      minMidi,
      maxMidi,
      padding,
      plotHeight,
    ),
    startTime,
    latestTime,
  };
}

export function buildGraphPoints(
  samples: PitchSample[],
  viewport: GraphViewport,
  graphSeconds: number,
): GraphPoint[] {
  const points: GraphPoint[] = [];
  let nextPointStartsLine = true;

  for (const sample of samples) {
    if (sample.midi === null || sample.timeMs < viewport.startTime) {
      nextPointStartsLine = true;
      continue;
    }

    points.push({
      x:
        viewport.padding.left +
        ((sample.timeMs - viewport.startTime) / (graphSeconds * 1000)) *
          viewport.plotWidth,
      y: midiToY(
        sample.midi,
        viewport.minMidi,
        viewport.maxMidi,
        viewport.padding,
        viewport.plotHeight,
      ),
      startsLine: nextPointStartsLine,
    });
    nextPointStartsLine = false;
  }

  return points;
}

export function getVisibleSamples(
  samples: PitchSample[],
  limit: number,
): PitchSample[] {
  return samples.slice(-limit);
}

export function midiToY(
  midi: number,
  minMidi: number,
  maxMidi: number,
  padding: GraphPadding,
  plotHeight: number,
): number {
  const clamped = clamp(midi, minMidi, maxMidi);
  return padding.top + ((maxMidi - clamped) / (maxMidi - minMidi)) * plotHeight;
}

export function resolveCanvasBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number; pixelRatio: number } {
  const pixelRatio = clamp(devicePixelRatio || 1, 1, 3);

  return {
    width: Math.round(Math.max(1, cssWidth) * pixelRatio),
    height: Math.round(Math.max(1, cssHeight) * pixelRatio),
    pixelRatio,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createMelodyGraphLayout(
  frequencies: readonly number[],
  seconds: number,
  availableWidth: number,
  height: number,
) {
  const midis = frequencies.map((frequency) => Math.round(hzToMidi(frequency)));
  const minMidi = Math.floor(Math.min(...midis)) - 2;
  const maxMidi = Math.ceil(Math.max(...midis)) + 2;
  const padding = { top: 28, right: 18, bottom: 36, left: 52 };
  const width = Math.max(
    availableWidth,
    frequencies.length * 42 + padding.left + padding.right,
  );
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const duration = frequencies.length * seconds;
  return {
    width,
    height,
    padding,
    minMidi,
    maxMidi,
    duration,
    midis,
    plotWidth,
    plotHeight,
    x: (time: number) =>
      padding.left + clamp(time / duration, 0, 1) * plotWidth,
    y: (midi: number) => midiToY(midi, minMidi, maxMidi, padding, plotHeight),
  };
}

/** Piano geometry in white-key units, with black keys between their neighbors. */
export function createMelodyKeyboardLayout(frequencies: readonly number[]) {
  if (!frequencies.length) return { keys: [], whiteCount: 0 };
  const midis = frequencies.map((frequency) => Math.round(hzToMidi(frequency)));
  const isBlack = (midi: number) =>
    [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
  let first = Math.min(...midis);
  let last = Math.max(...midis);
  if (last - first < 12) {
    first = Math.floor(first / 12) * 12;
    last = Math.max(first + 12, last);
  }
  if (isBlack(first)) first--;
  if (isBlack(last)) last++;
  const keys = [];
  let whiteCount = 0;
  for (let midi = first; midi <= last; midi++) {
    const black = isBlack(midi);
    keys.push({
      midi,
      black,
      left: black ? whiteCount - 0.31 : whiteCount,
      width: black ? 0.62 : 1,
    });
    if (!black) whiteCount++;
  }
  return {
    whiteCount,
    keys: keys.map((key) => ({
      ...key,
      left: (key.left / whiteCount) * 100,
      width: (key.width / whiteCount) * 100,
    })),
  };
}
