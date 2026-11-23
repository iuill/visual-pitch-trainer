import {
  createInstrumentBuffer,
  type GeneratedInstrument,
  isGeneratedInstrument,
} from "./generatedInstruments";
import {
  findNearestSample,
  REFERENCE_INSTRUMENTS,
  type ReferenceInstrumentId,
} from "./referenceInstruments";

type PhraseInstrument = ReferenceInstrumentId | GeneratedInstrument;

type Voice = {
  source: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
  at: number;
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
  private readonly generatedBuffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<ReferenceInstrumentId, Promise<void>>();
  private readonly referenceVoices = new Set<Voice>();
  private readonly scaleVoices = new Set<Voice>();
  private readonly loopVoices = new Set<Voice>();
  private reference: {
    instrument: ReferenceInstrumentId;
    frequency: number;
  } | null = null;
  private repeatTimer: IntervalHandle | null = null;
  private nextRepeatAt = 0;
  private scaleTimer: IntervalHandle | null = null;
  private replaceLoopFrequencies:
    | ((lap: number, notes: readonly number[]) => boolean)
    | null = null;
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
      startAt?: number;
      countdownSound?: boolean;
      countdownSeconds?: number;
      loop?: boolean;
    } = {},
  ) {
    this.stopScale();
    const at = options.startAt ?? this.context.currentTime + 0.01;
    const seconds = options.noteSeconds ?? 0.5;
    if (!frequencies.length) return;
    const countdown = options.countdownSeconds ?? 0;
    const singingAt = at + countdown;
    if (options.countdownSound && countdown > 0) {
      for (let remaining = countdown; remaining >= 0; remaining--) {
        this.createVoice(
          "sine",
          remaining === 0 ? 1046.5 : 784,
          singingAt - remaining,
          0.12,
          this.scaleVoices,
        );
      }
    }
    if (!options.loop) {
      frequencies.forEach((frequency, index) => {
        this.createVoice(
          instrument,
          frequency,
          singingAt + index * seconds,
          seconds - 0.08,
          this.scaleVoices,
        );
      });
      return;
    }
    let nextNote = 0;
    const count = frequencies.length;
    let current = frequencies;
    let pending: { firstNote: number; notes: readonly number[] } | null = null;
    const schedule = (now = this.context.currentTime) => {
      // Keep a bounded lookahead and skip missed notes after a stalled timer.
      nextNote = Math.max(nextNote, Math.ceil((now - singingAt) / seconds));
      while (singingAt + nextNote * seconds <= now + 0.2) {
        const notes =
          pending && nextNote >= pending.firstNote ? pending.notes : current;
        this.createVoice(
          instrument,
          notes[nextNote % count],
          singingAt + nextNote * seconds,
          seconds - 0.08,
          this.loopVoices,
        );
        nextNote++;
      }
    };
    this.replaceLoopFrequencies = (lap, notes) => {
      const now = this.context.currentTime;
      const firstNote = lap * count;
      const start = singingAt + firstNote * seconds;
      if (start <= now || notes.length !== count) return false;
      if (pending && singingAt + pending.firstNote * seconds <= now)
        current = pending.notes;
      pending = { firstNote, notes };
      if (nextNote > firstNote) {
        for (const voice of this.loopVoices) {
          if (voice.at < start) continue;
          voice.source.stop(now);
          this.loopVoices.delete(voice);
        }
        nextNote = firstNote;
        schedule(now);
      }
      return true;
    };
    schedule();
    this.scaleTimer = (this.options.setInterval ?? globalThis.setInterval)(
      schedule,
      50,
    );
  }

  // Replace the upcoming lap while keeping its start time and note count.
  replaceScaleLap(lap: number, notes: readonly number[]): boolean {
    return this.replaceLoopFrequencies?.(lap, notes) ?? false;
  }

  playPhrase(
    instrument: ReferenceInstrumentId,
    notes: readonly {
      frequency: number;
      seconds: number;
      offsetSeconds?: number;
    }[],
    startAt = this.context.currentTime + 0.01,
    volume?: number,
  ) {
    this.stopScale();
    let offset = 0;
    for (const { frequency, seconds, offsetSeconds = offset } of notes) {
      this.createVoice(
        instrument,
        frequency,
        startAt + offsetSeconds,
        seconds - 0.08,
        this.scaleVoices,
        volume,
      );
      offset = offsetSeconds + seconds;
    }
    return offset;
  }

  schedulePhraseNote(
    instrument: PhraseInstrument,
    frequency: number,
    at: number,
    seconds: number,
    volume: number,
    bendSemitones?: number,
  ) {
    this.createVoice(
      instrument,
      frequency,
      at,
      seconds - 0.03,
      this.scaleVoices,
      volume,
      bendSemitones,
    );
  }

  private createVoice(
    instrument: PhraseInstrument,
    frequency: number,
    at: number,
    duration: number | null,
    group: Set<Voice>,
    volume?: number,
    bendSemitones?: number,
  ) {
    if (this.disposed) throw new Error("Reference player is closed.");
    let source: OscillatorNode | AudioBufferSourceNode;
    let attack = 0.01;
    if (isGeneratedInstrument(instrument)) {
      const key = `${instrument}/${frequency}`;
      let buffer = this.generatedBuffers.get(key);
      if (!buffer) {
        buffer = createInstrumentBuffer(this.context, instrument, frequency);
        this.generatedBuffers.set(key, buffer);
      }
      const player = this.context.createBufferSource();
      player.buffer = buffer;
      if (
        instrument === "electric-guitar" &&
        bendSemitones &&
        duration !== null
      ) {
        player.playbackRate.setValueAtTime(1, at);
        player.playbackRate.linearRampToValueAtTime(
          2 ** (bendSemitones / 12),
          at + Math.min(duration / 2, 0.22),
        );
      }
      source = player;
      attack = instrument === "mellotron" ? 0.035 : 0.004;
    } else {
      const definition = REFERENCE_INSTRUMENTS[instrument];
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
          attack = 0.05;
          sampler.loop = true;
          sampler.loopStart = 0;
          sampler.loopEnd = buffer.duration;
        }
        sampler.playbackRate.setValueAtTime(
          frequency / sample.rootFrequency,
          at,
        );
        source = sampler;
      }
    }
    const gain = this.context.createGain();
    const level =
      volume === undefined ? 1 : Math.max(0, Math.min(1, volume)) * 0.5;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    if (duration !== null) {
      gain.gain.setValueAtTime(level, at + duration - 0.06);
      gain.gain.linearRampToValueAtTime(0, at + duration);
    }
    source.connect(gain);
    // An explicit phrase volume is independent of the common playback volume.
    gain.connect(volume === undefined ? this.output : this.context.destination);
    const voice = { source, gain, at };
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
    this.replaceLoopFrequencies = null;
    if (this.scaleTimer !== null) {
      (this.options.clearInterval ?? globalThis.clearInterval)(this.scaleTimer);
      this.scaleTimer = null;
    }
    this.stopVoices(this.scaleVoices);
    this.stopVoices(this.loopVoices);
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
    this.generatedBuffers.clear();
    this.output.disconnect();
  }
}
