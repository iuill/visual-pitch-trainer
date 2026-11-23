import type { SongDrum } from "./rhythmArrangement";
import {
  getRhythmNoteValue,
  type RhythmStep,
  rhythmPulseLevel,
} from "./rhythmCourse";
import type { RhythmGrade } from "./rhythmJudge";
import type { RhythmCountVoice, RhythmSound } from "./rhythmProgressStore";

const countFiles = ["one", "two", "three", "four", "and"];
const maxCountRate = 1.4;
const countVoiceRms = 0.15;
const countVoicePeak = 0.97;
const countVoiceWindowSeconds = 0.02;
const countVoiceEnergyFloorRatio = 0.03;

function prepareCountVoice(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const windowFrames = Math.max(
    1,
    Math.round(buffer.sampleRate * countVoiceWindowSeconds),
  );
  const windowEnergies: number[] = [];
  let loudestWindow = 0;
  let peak = 0;
  for (let start = 0; start < buffer.length; start += windowFrames) {
    const end = Math.min(start + windowFrames, buffer.length);
    let squareSum = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const sample = channel[frame];
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    // Treat the last partial window as zero-padded to the same duration.
    const meanSquare = squareSum / (windowFrames * channels.length);
    loudestWindow = Math.max(loudestWindow, meanSquare);
    windowEnergies.push(meanSquare);
  }
  // Ignore windows whose energy is below 3% of the loudest speech window.
  const activeEnergies = windowEnergies.filter(
    (energy) => energy > loudestWindow * countVoiceEnergyFloorRatio,
  );
  const rms = activeEnergies.length
    ? Math.sqrt(
        activeEnergies.reduce((sum, energy) => sum + energy, 0) /
          activeEnergies.length,
      )
    : 0;
  const gain =
    rms > 0 ? Math.min(countVoiceRms / rms, countVoicePeak / peak) : 1;
  return { buffer, gain };
}

export interface RhythmCount {
  timeMs: number;
  voiceIndex: number;
  sound?: RhythmSound;
  volume?: number;
  pulseLevel?: number;
}

export type RhythmCue =
  | RhythmCount
  | {
      timeMs: number;
      countdown: 1 | 2 | 3;
      sound?: never;
      volume?: never;
    };

export class RhythmScheduler {
  private voices = new Map<
    RhythmCountVoice,
    ReturnType<typeof prepareCountVoice>[]
  >();
  private percussion = new Map<SongDrum, AudioBuffer>();
  private timer: number | null = null;
  private trackTimer: number | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();

  constructor(private readonly context: AudioContext) {}

  async loadPercussion(samples: readonly SongDrum[]) {
    const missing = samples.filter((sample) => !this.percussion.has(sample));
    if (missing.length === 0) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const loaded = await Promise.allSettled(
        missing.map(async (sample) => {
          const buffer = await this.loadSample(
            `./audio/rhythm/${sample}.wav`,
            controller.signal,
          );
          this.percussion.set(sample, buffer);
        }),
      );
      if (loaded.some((result) => result.status === "rejected"))
        throw new Error("Rhythm percussion is unavailable.");
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
    }
  }

  private async loadSample(path: string, signal: AbortSignal) {
    const response = await fetch(new URL(path, document.baseURI), { signal });
    if (!response.ok) throw new Error(`Audio sample is unavailable: ${path}`);
    return this.context.decodeAudioData(await response.arrayBuffer());
  }

  async loadVoices(voice: RhythmCountVoice) {
    if (this.voices.has(voice)) return;
    const directory =
      voice === "female" ? "./audio/count/female/" : "./audio/count/";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const buffers = await Promise.all(
        countFiles.map((count) =>
          this.loadSample(`${directory}${count}.wav`, controller.signal),
        ),
      );
      this.voices.set(voice, buffers.map(prepareCountVoice));
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
    }
  }

  start(
    counts: RhythmCue[],
    sound: RhythmSound,
    volume: number,
    voice: RhythmCountVoice,
    endMs = Number.POSITIVE_INFINITY,
  ) {
    this.stop();
    if (
      !counts.some(
        (count) =>
          (count.sound ?? sound) !== "none" && (count.volume ?? volume) > 0,
      )
    )
      return;
    const voices = this.voices.get(voice);
    let next = 0;
    const schedule = () => {
      const now = this.context.currentTime * 1000;
      while (next < counts.length && counts[next].timeMs <= now + 200) {
        const count = counts[next++];
        const cue = count.sound ?? sound;
        const level = count.volume ?? volume;
        if (count.timeMs < now || cue === "none" || level === 0) continue;
        const when = count.timeMs / 1000;
        if ("countdown" in count) {
          const frequency = { 3: 523, 2: 659, 1: 880 }[count.countdown];
          const duration = count.countdown === 1 ? 0.2 : 0.1;
          this.tone("triangle", frequency, when, duration, level * 0.32);
          continue;
        }
        const pulseLevel =
          count.pulseLevel ?? (count.voiceIndex === 0 ? 1 : 0.72);
        const available =
          Math.min(counts[next]?.timeMs ?? endMs, endMs) / 1000 - when;
        const sample = cue === "voice" ? voices?.[count.voiceIndex] : undefined;
        const buffer = sample?.buffer;
        // Leave a short gap before the next beat or the start of the song.
        const rate =
          buffer && available > 0
            ? Math.max(1, buffer.duration / (available * 0.97))
            : Infinity;
        if (sample && rate <= maxCountRate) {
          const source = this.context.createBufferSource();
          source.buffer = sample.buffer;
          source.playbackRate.setValueAtTime(rate, when);
          const voiceLevel =
            pulseLevel === 0.5 ? 0.32 : 0.34 + 0.66 * pulseLevel;
          this.play(
            source,
            when,
            sample.buffer.duration / rate,
            level * sample.gain * voiceLevel,
          );
        } else {
          this.tone(
            "sine",
            620 + 720 * pulseLevel,
            when,
            0.033,
            level * (0.2 + 0.16 * pulseLevel),
          );
        }
      }
      if (next < counts.length) this.timer = window.setTimeout(schedule, 50);
      else this.timer = null;
    };
    schedule();
  }

  playExample(
    patterns: readonly string[],
    step: RhythmStep,
    options: {
      feetOnly: boolean;
      eighths: boolean;
      voice: RhythmCountVoice | null;
      scheduleDrums?: boolean;
    },
  ) {
    const beatSeconds = 60 / step.bpm;
    const startAt = this.context.currentTime + 0.12;
    const beatsPerBar = step.beatsPerBar ?? 4;
    const beatCount = patterns.length * beatsPerBar;
    if (options.voice) {
      const speakOffbeats =
        options.eighths &&
        this.voices
          .get(options.voice)
          ?.every(({ buffer }) => buffer.duration <= beatSeconds / 2);
      const counts: RhythmCount[] = [];
      for (let beat = 0; beat < beatCount; beat++) {
        const timeMs = (startAt + beat * beatSeconds) * 1000;
        const pulse = beat % beatsPerBar;
        counts.push({
          timeMs,
          voiceIndex: pulse,
          pulseLevel: rhythmPulseLevel(step, pulse),
        });
        if (speakOffbeats)
          counts.push({
            timeMs: timeMs + beatSeconds * 500,
            voiceIndex: 4,
            pulseLevel: rhythmPulseLevel(step, pulse + 0.5),
          });
      }
      this.start(
        counts,
        "voice",
        0.45,
        options.voice,
        (startAt + beatCount * beatSeconds) * 1000,
      );
    } else {
      this.stop();
    }
    if (options.scheduleDrums !== false) {
      for (let beat = 0; beat < beatCount; beat++) {
        const pulse = beat % beatsPerBar;
        const when = startAt + beat * beatSeconds;
        this.scheduleBassDrum(
          when,
          pulse === 0,
          0.1 + 0.3 * rhythmPulseLevel(step, pulse),
        );
      }
    }
    if (options.feetOnly) return startAt;
    const highTom = this.percussion.get("high-tom");
    for (const [slot, symbol] of Array.from(patterns.join("")).entries()) {
      if (!getRhythmNoteValue(symbol)) continue;
      const when =
        startAt + (slot * beatSeconds * beatsPerBar) / patterns[0].length;
      const pulse =
        ((slot % patterns[0].length) * beatsPerBar) / patterns[0].length;
      const level = 0.6 + 0.4 * rhythmPulseLevel(step, pulse);
      if (highTom) {
        const source = this.context.createBufferSource();
        source.buffer = highTom;
        this.play(source, when, highTom.duration, 0.55 * level);
      } else {
        this.tone("triangle", 660, when, 0.065, 0.12 * level);
      }
    }
    return startAt;
  }

  scheduleBassDrum(when: number, downbeat: boolean, volume: number) {
    this.scheduleDrum("kick", when, volume, downbeat);
  }

  scheduleDrum(drum: SongDrum, when: number, volume: number, downbeat = false) {
    const sample = this.percussion.get(drum);
    if (sample) {
      const source = this.context.createBufferSource();
      source.buffer = sample;
      this.play(source, when, sample.duration, volume);
    } else {
      const frequency = {
        kick: downbeat ? 235 : 175,
        snare: 430,
        "hi-hat": 1290,
        "high-tom": 660,
        "low-tom": 345,
        crash: 1710,
        ride: 1530,
      }[drum];
      this.tone("triangle", frequency, when, 0.06, volume * 0.65);
    }
  }

  scheduleTrack<T extends { timeMs: number }>(
    events: readonly T[],
    play: (event: T) => void,
  ) {
    if (this.trackTimer !== null) window.clearTimeout(this.trackTimer);
    let next = 0;
    const schedule = () => {
      const now = this.context.currentTime * 1000;
      while (next < events.length && events[next].timeMs <= now + 200) {
        const event = events[next++];
        if (event.timeMs >= now) play(event);
      }
      this.trackTimer =
        next < events.length ? window.setTimeout(schedule, 50) : null;
    };
    schedule();
  }

  feedback(grade: RhythmGrade) {
    const when = this.context.currentTime;
    if (grade === "perfect") {
      this.tone("triangle", 920, when, 0.045, 0.19);
      this.tone("sine", 1500, when, 0.023, 0.09);
    } else if (grade === "close") {
      this.tone("sine", 410, when, 0.085, 0.18);
    } else {
      this.tone("triangle", 116, when, 0.16, 0.17);
    }
  }

  stop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.trackTimer !== null) window.clearTimeout(this.trackTimer);
    this.trackTimer = null;
    for (const node of this.nodes) node.stop();
    this.nodes.clear();
  }

  private tone(
    type: OscillatorType,
    frequency: number,
    when: number,
    duration: number,
    volume: number,
    release = duration,
  ) {
    const source = this.context.createOscillator();
    source.type = type;
    source.frequency.value = frequency;
    this.play(source, when, duration, volume, release);
  }

  private play(
    source: AudioScheduledSourceNode,
    when: number,
    duration: number,
    volume: number,
    release = 0,
  ) {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, when);
    if (release > 0) {
      gain.gain.setValueAtTime(volume, when + duration - release);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    }
    source.connect(gain).connect(this.context.destination);
    this.nodes.add(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.nodes.delete(source);
    };
    source.start(when);
    source.stop(when + duration);
  }
}
