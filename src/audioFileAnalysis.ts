import { PitchDetector } from "pitchy";
import { getRms, hzToMidi, midiToNoteName } from "./pitchMath";

export type AudioPitchPoint = {
  timeMs: number;
  frequency: number | null;
  midi: number | null;
  clarity: number | null;
  volume: number;
};

export type VoiceRangeSummary = {
  durationSec: number;
  analyzedFrames: number;
  validFrames: number;
  voicedSec: number;
  lowestMidi: number | null;
  highestMidi: number | null;
  robustLowestMidi: number | null;
  robustHighestMidi: number | null;
  commonLowestMidi: number | null;
  commonHighestMidi: number | null;
  medianMidi: number | null;
};

export type AudioFileAnalysis = {
  points: AudioPitchPoint[];
  summary: VoiceRangeSummary;
};

export type AnalyzeAudioDataOptions = {
  sampleRate: number;
  frameSize?: number;
  hopSize?: number;
  minRms?: number;
  minClarity?: number;
  minFrequency?: number;
  maxFrequency?: number;
};

const DEFAULT_FRAME_SIZE = 4096;
const DEFAULT_HOP_SIZE = 2048;
const DEFAULT_MIN_RMS = 0.004;
const DEFAULT_MIN_CLARITY = 0.62;
const DEFAULT_MIN_FREQUENCY = 82;
const DEFAULT_MAX_FREQUENCY = 1047;
const DYNAMIC_RMS_PERCENTILE = 0.4;
const DYNAMIC_RMS_RATIO = 0.55;
const OCTAVE_CORRECTION_RADIUS = 8;
const GLOBAL_OUTLIER_PERCENTILE_LOW = 0.03;
const GLOBAL_OUTLIER_PERCENTILE_HIGH = 0.97;
const GLOBAL_OUTLIER_MARGIN_SEMITONES = 3;
const GLOBAL_OUTLIER_MIN_RUN_FRAMES = 6;

export function analyzeAudioData(
  audioData: Float32Array,
  options: AnalyzeAudioDataOptions,
): AudioFileAnalysis {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const minRms = options.minRms ?? DEFAULT_MIN_RMS;
  const minClarity = options.minClarity ?? DEFAULT_MIN_CLARITY;
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;
  const volumeGate = resolveVolumeGate(audioData, frameSize, hopSize, minRms);
  const detector = PitchDetector.forFloat32Array(frameSize);
  const points: AudioPitchPoint[] = [];
  const frame = new Float32Array(frameSize);

  detector.clarityThreshold = minClarity;
  detector.minVolumeAbsolute = volumeGate;

  for (
    let offset = 0;
    offset + frameSize <= audioData.length;
    offset += hopSize
  ) {
    frame.set(audioData.subarray(offset, offset + frameSize));
    const volume = getRms(frame);
    const timeMs = (offset / options.sampleRate) * 1000;

    if (volume < volumeGate) {
      points.push({
        timeMs,
        frequency: null,
        midi: null,
        clarity: null,
        volume,
      });
      continue;
    }

    const [frequency, clarity] = detector.findPitch(frame, options.sampleRate);
    const normalizedClarity = clamp(clarity, 0, 1);
    const isAccepted =
      frequency >= minFrequency &&
      frequency <= maxFrequency &&
      normalizedClarity >= minClarity;

    points.push({
      timeMs,
      frequency: isAccepted ? frequency : null,
      midi: isAccepted ? hzToMidi(frequency) : null,
      clarity: frequency > 0 ? normalizedClarity : null,
      volume,
    });
  }

  const refinedPoints = refineAudioPitchPoints(points);

  return {
    points: refinedPoints,
    summary: summarizeVoiceRange(
      refinedPoints,
      audioData.length / options.sampleRate,
      hopSize / options.sampleRate,
    ),
  };
}

export function summarizeVoiceRange(
  points: AudioPitchPoint[],
  durationSec: number,
  secondsPerFrame: number,
): VoiceRangeSummary {
  const midiValues = points
    .map((point) => point.midi)
    .filter((midi): midi is number => midi !== null && Number.isFinite(midi))
    .sort((a, b) => a - b);

  if (midiValues.length === 0) {
    return {
      durationSec,
      analyzedFrames: points.length,
      validFrames: 0,
      voicedSec: 0,
      lowestMidi: null,
      highestMidi: null,
      robustLowestMidi: null,
      robustHighestMidi: null,
      commonLowestMidi: null,
      commonHighestMidi: null,
      medianMidi: null,
    };
  }

  return {
    durationSec,
    analyzedFrames: points.length,
    validFrames: midiValues.length,
    voicedSec: midiValues.length * secondsPerFrame,
    lowestMidi: midiValues[0],
    highestMidi: midiValues.at(-1) ?? null,
    robustLowestMidi: percentile(midiValues, 0.05),
    robustHighestMidi: percentile(midiValues, 0.95),
    commonLowestMidi: percentile(midiValues, 0.25),
    commonHighestMidi: percentile(midiValues, 0.75),
    medianMidi: percentile(midiValues, 0.5),
  };
}

export function formatMidiRange(
  lowestMidi: number | null,
  highestMidi: number | null,
): string {
  if (lowestMidi === null || highestMidi === null) {
    return "--";
  }

  return `${midiToNoteName(lowestMidi)} - ${midiToNoteName(highestMidi)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const roundedSeconds = Math.round(seconds);
    const minutes = Math.floor(roundedSeconds / 60);
    const remainingSeconds = roundedSeconds % 60;
    return `${minutes}分${remainingSeconds.toString().padStart(2, "0")}秒`;
  }

  return `${seconds.toFixed(1)}秒`;
}

export function getVoiceCoverage(summary: VoiceRangeSummary): number {
  if (summary.analyzedFrames === 0) {
    return 0;
  }

  return summary.validFrames / summary.analyzedFrames;
}

export function refineAudioPitchPoints(
  points: AudioPitchPoint[],
): AudioPitchPoint[] {
  return rejectGlobalPitchOutliers(refinePitchTrack(points));
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = (sortedValues.length - 1) * clamp(ratio, 0, 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;
  const lower = sortedValues[lowerIndex] ?? sortedValues[0];
  const upper = sortedValues[upperIndex] ?? sortedValues.at(-1) ?? lower;

  return lower + (upper - lower) * weight;
}

function resolveVolumeGate(
  audioData: Float32Array,
  frameSize: number,
  hopSize: number,
  minRms: number,
): number {
  const frame = new Float32Array(frameSize);
  const volumes: number[] = [];

  for (
    let offset = 0;
    offset + frameSize <= audioData.length;
    offset += hopSize
  ) {
    frame.set(audioData.subarray(offset, offset + frameSize));
    const volume = getRms(frame);

    if (Number.isFinite(volume) && volume > 0) {
      volumes.push(volume);
    }
  }

  volumes.sort((a, b) => a - b);
  const dynamicFloor =
    (percentile(volumes, DYNAMIC_RMS_PERCENTILE) ?? minRms) * DYNAMIC_RMS_RATIO;

  return Math.max(minRms, dynamicFloor);
}

function refinePitchTrack(points: AudioPitchPoint[]): AudioPitchPoint[] {
  return points.map((point, index) => {
    if (point.midi === null) {
      return point;
    }

    const nearbyMidi = getNearbyMidiValues(
      points,
      index,
      OCTAVE_CORRECTION_RADIUS,
    );

    if (nearbyMidi.length < 2) {
      return {
        ...point,
        frequency: null,
        midi: null,
      };
    }

    nearbyMidi.sort((a, b) => a - b);
    const nearbyMedian = percentile(nearbyMidi, 0.5) ?? point.midi;
    const octaveCorrectedMidi = correctLikelyOctaveError(
      point.midi,
      nearbyMedian,
    );

    if (octaveCorrectedMidi !== point.midi && point.frequency !== null) {
      return {
        ...point,
        frequency:
          point.frequency * 2 ** ((octaveCorrectedMidi - point.midi) / 12),
        midi: octaveCorrectedMidi,
      };
    }

    const isLikelyOutlier =
      Math.abs(point.midi - nearbyMedian) > 7 && (point.clarity ?? 0) < 0.82;

    if (!isLikelyOutlier) {
      return point;
    }

    return {
      ...point,
      frequency: null,
      midi: null,
    };
  });
}

function rejectGlobalPitchOutliers(
  points: AudioPitchPoint[],
): AudioPitchPoint[] {
  const midiValues = points
    .map((point) => point.midi)
    .filter((midi): midi is number => midi !== null && Number.isFinite(midi))
    .sort((a, b) => a - b);
  const low =
    percentile(midiValues, GLOBAL_OUTLIER_PERCENTILE_LOW) ??
    Number.NEGATIVE_INFINITY;
  const high =
    percentile(midiValues, GLOBAL_OUTLIER_PERCENTILE_HIGH) ??
    Number.POSITIVE_INFINITY;
  const minMidi = low - GLOBAL_OUTLIER_MARGIN_SEMITONES;
  const maxMidi = high + GLOBAL_OUTLIER_MARGIN_SEMITONES;

  return points.map((point, index) => {
    if (
      point.midi === null ||
      (point.midi >= minMidi && point.midi <= maxMidi)
    ) {
      return point;
    }

    if (
      countContiguousOutOfRangeFrames(points, index, minMidi, maxMidi) >=
      GLOBAL_OUTLIER_MIN_RUN_FRAMES
    ) {
      return point;
    }

    return {
      ...point,
      frequency: null,
      midi: null,
    };
  });
}

function countContiguousOutOfRangeFrames(
  points: AudioPitchPoint[],
  index: number,
  minMidi: number,
  maxMidi: number,
): number {
  let count = 0;

  for (
    let currentIndex = index;
    currentIndex >= 0 &&
    isOutOfRangePitchPoint(points[currentIndex], minMidi, maxMidi);
    currentIndex -= 1
  ) {
    count += 1;
  }

  for (
    let currentIndex = index + 1;
    currentIndex < points.length &&
    isOutOfRangePitchPoint(points[currentIndex], minMidi, maxMidi);
    currentIndex += 1
  ) {
    count += 1;
  }

  return count;
}

function isOutOfRangePitchPoint(
  point: AudioPitchPoint | undefined,
  minMidi: number,
  maxMidi: number,
): boolean {
  return (
    point?.midi !== null &&
    point?.midi !== undefined &&
    Number.isFinite(point.midi) &&
    (point.midi < minMidi || point.midi > maxMidi)
  );
}

function correctLikelyOctaveError(midi: number, nearbyMedian: number): number {
  const candidates = [midi - 12, midi, midi + 12];
  const bestCandidate = candidates.reduce((best, candidate) =>
    Math.abs(candidate - nearbyMedian) < Math.abs(best - nearbyMedian)
      ? candidate
      : best,
  );
  const originalDistance = Math.abs(midi - nearbyMedian);
  const correctedDistance = Math.abs(bestCandidate - nearbyMedian);

  if (originalDistance >= 9 && correctedDistance <= 4) {
    return bestCandidate;
  }

  return midi;
}

function getNearbyMidiValues(
  points: AudioPitchPoint[],
  index: number,
  radius: number,
): number[] {
  const values: number[] = [];
  const start = Math.max(0, index - radius);
  const end = Math.min(points.length - 1, index + radius);

  for (let nearbyIndex = start; nearbyIndex <= end; nearbyIndex += 1) {
    if (nearbyIndex === index) {
      continue;
    }

    const midi = points[nearbyIndex]?.midi;

    if (midi !== null && midi !== undefined && Number.isFinite(midi)) {
      values.push(midi);
    }
  }

  return values;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
