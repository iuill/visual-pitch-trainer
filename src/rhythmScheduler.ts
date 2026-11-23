import { getRhythmNoteValue } from "./rhythmCourse";
import type { RhythmGrade } from "./rhythmJudge";
import type { RhythmCountVoice, RhythmSound } from "./rhythmProgressStore";

const countFiles = ["one", "two", "three", "four", "and"];
type RhythmPercussion = "kick" | "high-tom";

export interface RhythmCount {
  timeMs: number;
  voiceIndex: number;
  sound?: RhythmSound;
  volume?: number;
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
  private voices = new Map<RhythmCountVoice, AudioBuffer[]>();
  private percussion = new Map<RhythmPercussion, AudioBuffer>();
  private timer: number | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();

  constructor(private readonly context: AudioContext) {}

  async loadPercussion(feetOnly: boolean) {
    const samples: RhythmPercussion[] = feetOnly
      ? ["kick"]
      : ["kick", "high-tom"];
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
      this.voices.set(voice, buffers);
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
        const accent = count.voiceIndex === 0;
        const available =
          Math.min(counts[next]?.timeMs ?? endMs, endMs) / 1000 - when;
        const buffer = cue === "voice" ? voices?.[count.voiceIndex] : undefined;
        if (buffer && available > 0) {
          const source = this.context.createBufferSource();
          source.buffer = buffer;
          const duration = Math.min(buffer.duration, available);
          source.playbackRate.value = buffer.duration / duration;
          this.play(source, when, duration, level * (accent ? 1 : 0.72));
        } else {
          this.tone(
            "sine",
            accent ? 1340 : 930,
            when,
            0.033,
            level * (accent ? 0.36 : 0.26),
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
    bpm: number,
    options: {
      beatsPerBar: number;
      feetOnly: boolean;
      eighths: boolean;
      voice: RhythmCountVoice | null;
    },
  ) {
    const beatSeconds = 60 / bpm;
    const startAt = this.context.currentTime + 0.12;
    const { beatsPerBar } = options;
    const beatCount = patterns.length * beatsPerBar;
    if (options.voice) {
      const counts: RhythmCount[] = [];
      for (let beat = 0; beat < beatCount; beat++) {
        const timeMs = (startAt + beat * beatSeconds) * 1000;
        counts.push({ timeMs, voiceIndex: beat % beatsPerBar });
        if (options.eighths)
          counts.push({ timeMs: timeMs + beatSeconds * 500, voiceIndex: 4 });
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
    for (let beat = 0; beat < beatCount; beat++) {
      const downbeat = beat % beatsPerBar === 0;
      const when = startAt + beat * beatSeconds;
      this.scheduleBassDrum(when, downbeat, downbeat ? 0.29 : 0.21);
    }
    if (options.feetOnly) return startAt;
    const highTom = this.percussion.get("high-tom");
    for (const [slot, symbol] of Array.from(patterns.join("")).entries()) {
      if (!getRhythmNoteValue(symbol)) continue;
      const when =
        startAt + (slot * beatSeconds * beatsPerBar) / patterns[0].length;
      if (highTom) {
        const source = this.context.createBufferSource();
        source.buffer = highTom;
        this.play(source, when, highTom.duration, 0.55);
      } else {
        this.tone("triangle", 660, when, 0.065, 0.12);
      }
    }
    return startAt;
  }

  scheduleBassDrum(when: number, downbeat: boolean, volume: number) {
    const kick = this.percussion.get("kick");
    if (kick) {
      const source = this.context.createBufferSource();
      source.buffer = kick;
      this.play(source, when, kick.duration, volume);
    } else {
      this.tone("triangle", downbeat ? 235 : 175, when, 0.06, volume * 0.65);
    }
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
