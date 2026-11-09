import {
  findNearestSample,
  REFERENCE_INSTRUMENTS,
  type ReferenceInstrumentId,
} from "./referenceInstruments";

type Voice = {
  source: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
};

type IntervalHandle = number | ReturnType<typeof setInterval>;

type PlayerOptions = {
  loadSample?: (url: string) => Promise<AudioBuffer>;
  setInterval?: (callback: () => void, ms: number) => IntervalHandle;
  clearInterval?: (id: IntervalHandle) => void;
};

// Both sample instruments and synthesized tones share volume, scheduling and cleanup.
export class ReferencePlayer {
  private readonly output: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<ReferenceInstrumentId, Promise<void>>();
  private readonly referenceVoices = new Set<Voice>();
  private readonly scaleVoices = new Set<Voice>();
  private reference: {
    instrument: ReferenceInstrumentId;
    frequency: number;
  } | null = null;
  private repeatTimer: IntervalHandle | null = null;
  private nextRepeatAt = 0;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    private readonly options: PlayerOptions = {},
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(context.destination);
  }

  async prepare(instrument: ReferenceInstrumentId): Promise<void> {
    if (this.disposed) throw new Error("Reference player is closed.");
    const definition = REFERENCE_INSTRUMENTS[instrument];
    if (definition.kind === "oscillator") return;
    const existing = this.loading.get(instrument);
    if (existing) return existing;
    const pending = Promise.all(
      definition.samples.map(async (sample) => {
        const key = `${instrument}/${sample.file}`;
        if (this.buffers.has(key)) return;
        const url = `${import.meta.env.BASE_URL ?? "/"}audio/${instrument}/${sample.file}`;
        const buffer = this.options.loadSample
          ? await this.options.loadSample(url)
          : await this.fetchSample(url);
        if (!this.disposed) this.buffers.set(key, buffer);
      }),
    ).then(() => {});
    this.loading.set(instrument, pending);
    try {
      await pending;
    } finally {
      if (this.loading.get(instrument) === pending)
        this.loading.delete(instrument);
    }
  }

  private async fetchSample(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Sample request failed (${response.status}).`);
    return this.context.decodeAudioData(await response.arrayBuffer());
  }

  setVolume(volume: number) {
    this.output.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)) * 0.5,
      this.context.currentTime,
      0.015,
    );
  }

  startReference(instrument: ReferenceInstrumentId, frequency: number) {
    this.stopReference();
    this.reference = { instrument, frequency };
    this.scheduleReference(this.context.currentTime + 0.01);
    const definition = REFERENCE_INSTRUMENTS[instrument];
    if (definition.kind === "samples" && definition.playback === "repeat") {
      this.repeatTimer = (this.options.setInterval ?? globalThis.setInterval)(
        () => {
          // Avoid a burst of missed notes when returning from a background tab.
          if (this.nextRepeatAt < this.context.currentTime) {
            this.nextRepeatAt = this.context.currentTime + 0.01;
          }
          if (this.nextRepeatAt <= this.context.currentTime + 0.1) {
            this.scheduleReference(this.nextRepeatAt);
          }
        },
        50,
      );
    }
  }

  private scheduleReference(at: number) {
    if (!this.reference) return;
    const { instrument, frequency } = this.reference;
    const definition = REFERENCE_INSTRUMENTS[instrument];
    this.createVoice(
      instrument,
      frequency,
      at,
      definition.kind === "samples" && definition.playback === "repeat"
        ? definition.noteSeconds
        : null,
      this.referenceVoices,
    );
    if (definition.kind === "samples" && definition.playback === "repeat")
      this.nextRepeatAt = at + definition.repeatSeconds;
  }

  setFrequency(frequency: number) {
    if (!this.reference) return;
    if (
      REFERENCE_INSTRUMENTS[this.reference.instrument].kind === "oscillator"
    ) {
      this.reference.frequency = frequency;
      for (const voice of this.referenceVoices) {
        (voice.source as OscillatorNode).frequency.setTargetAtTime(
          frequency,
          this.context.currentTime,
          0.015,
        );
      }
    } else {
      this.startReference(this.reference.instrument, frequency);
    }
  }

  playScale(
    instrument: ReferenceInstrumentId,
    frequencies: readonly number[],
    options: {
      noteSeconds?: number;
      practiceNoteSeconds?: number;
      startAt?: number;
      practiceAt?: number;
      countdownSound?: boolean;
    } = {},
  ) {
    this.stopScale();
    const at = options.startAt ?? this.context.currentTime + 0.01;
    const seconds = options.noteSeconds ?? 0.5;
    const starts = [{ at, seconds }];
    if (options.practiceAt !== undefined) {
      starts.push({
        at: options.practiceAt,
        seconds: options.practiceNoteSeconds ?? seconds,
      });
      if (options.countdownSound) {
        for (let remaining = 3; remaining >= 0; remaining--) {
          this.createVoice(
            "sine",
            remaining === 0 ? 1046.5 : 784,
            options.practiceAt - remaining,
            0.12,
            this.scaleVoices,
          );
        }
      }
    }
    for (const { at: start, seconds: duration } of starts)
      frequencies.forEach((frequency, index) => {
        this.createVoice(
          instrument,
          frequency,
          start + index * duration,
          duration - 0.08,
          this.scaleVoices,
        );
      });
  }

  private createVoice(
    instrument: ReferenceInstrumentId,
    frequency: number,
    at: number,
    duration: number | null,
    group: Set<Voice>,
  ) {
    if (this.disposed) throw new Error("Reference player is closed.");
    const definition = REFERENCE_INSTRUMENTS[instrument];
    let source: OscillatorNode | AudioBufferSourceNode;
    if (definition.kind === "oscillator") {
      const oscillator = this.context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      source = oscillator;
    } else {
      const sample = findNearestSample(definition.samples, frequency);
      const buffer = this.buffers.get(`${instrument}/${sample.file}`);
      if (!buffer) throw new Error("Reference instrument is not loaded.");
      const sampler = this.context.createBufferSource();
      sampler.buffer = buffer;
      if (definition.playback === "loop") {
        sampler.loop = true;
        sampler.loopStart = 0;
        sampler.loopEnd = buffer.duration;
      }
      sampler.playbackRate.setValueAtTime(frequency / sample.rootFrequency, at);
      source = sampler;
    }
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(
      1,
      at +
        (definition.kind === "samples" && definition.playback === "loop"
          ? 0.05
          : 0.01),
    );
    if (duration !== null) {
      gain.gain.setValueAtTime(1, at + duration - 0.06);
      gain.gain.linearRampToValueAtTime(0, at + duration);
    }
    source.connect(gain);
    gain.connect(this.output);
    const voice = { source, gain };
    group.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      group.delete(voice);
    };
    source.start(at);
    if (duration !== null) source.stop(at + duration + 0.02);
  }

  stopReference() {
    this.reference = null;
    if (this.repeatTimer !== null) {
      (this.options.clearInterval ?? globalThis.clearInterval)(
        this.repeatTimer,
      );
      this.repeatTimer = null;
    }
    this.stopVoices(this.referenceVoices);
  }

  stopScale() {
    this.stopVoices(this.scaleVoices);
  }

  private stopVoices(voices: Set<Voice>) {
    const at = this.context.currentTime;
    for (const voice of voices) {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setTargetAtTime(0, at, 0.01);
      voice.source.stop(at + 0.06);
    }
    voices.clear();
  }

  dispose() {
    this.stopReference();
    this.stopScale();
    this.disposed = true;
    this.buffers.clear();
    this.output.disconnect();
  }
}
