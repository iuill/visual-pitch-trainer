import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  findNearestSample,
  isReferenceInstrumentId,
  PIANO_SAMPLES,
} from "./referenceInstruments";
import { ReferencePlayer } from "./referencePlayer";

class FakeParam {
  value = 0;
  events: { method: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ method: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ method: "ramp", value, time });
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ method: "target", value, time });
  }
  cancelScheduledValues(time: number) {
    this.events.push({ method: "cancel", value: 0, time });
  }
}

class FakeNode {
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  frequency = new FakeParam();
  playbackRate = new FakeParam();
  buffer: AudioBuffer | null = null;
  type = "";
  startedAt = -1;
  stops: number[] = [];
  onended: (() => void) | null = null;
  start(at: number) {
    this.startedAt = at;
  }
  stop(at: number) {
    this.stops.push(at);
  }
}

function createHarness(
  loadSample: (url: string) => Promise<AudioBuffer> = async () =>
    ({}) as AudioBuffer,
) {
  const oscillators: FakeSource[] = [];
  const samplers: FakeSource[] = [];
  const gains: (FakeNode & { gain: FakeParam })[] = [];
  let tick: (() => void) | null = null;
  const context = {
    currentTime: 0,
    destination: new FakeNode(),
    createGain() {
      const gain = Object.assign(new FakeNode(), { gain: new FakeParam() });
      gains.push(gain);
      return gain;
    },
    createOscillator() {
      const node = new FakeSource();
      oscillators.push(node);
      return node;
    },
    createBufferSource() {
      const node = new FakeSource();
      samplers.push(node);
      return node;
    },
  };
  const player = new ReferencePlayer(context as unknown as AudioContext, {
    loadSample,
    setInterval(callback) {
      tick = callback;
      return 1;
    },
    clearInterval() {
      tick = null;
    },
  });
  return {
    player,
    context,
    oscillators,
    samplers,
    gains,
    tick: () => tick?.(),
  };
}

describe("reference instruments", () => {
  test("covers C3–C6 with at most two semitones of sample transposition", () => {
    for (let midi = 48; midi <= 84; midi++) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const sample = findNearestSample(PIANO_SAMPLES, frequency);
      expect(Math.abs(midi - sample.midi)).toBeLessThanOrEqual(2);
      expect(
        Math.abs(12 * Math.log2(frequency / sample.rootFrequency)),
      ).toBeLessThan(2.1);
    }
    expect(isReferenceInstrumentId("piano")).toBe(true);
    expect(isReferenceInstrumentId("toString")).toBe(false);
    expect(() => findNearestSample([], 440)).toThrow();
  });

  test("bundled PCM recordings match the published provenance manifest", async () => {
    const root = new URL("../public/audio/piano/", import.meta.url);
    const manifest = await Bun.file(new URL("sources.json", root)).json();
    expect(manifest.license).toBe("CC0-1.0");
    expect(manifest.samples.length).toBe(PIANO_SAMPLES.length);
    for (const sample of manifest.samples) {
      const bytes = Buffer.from(
        await Bun.file(new URL(sample.file, root)).arrayBuffer(),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        sample.sha256,
      );
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.readUInt16LE(22)).toBe(1);
      expect(bytes.readUInt32LE(24)).toBe(44100);
      expect(bytes.readUInt16LE(34)).toBe(16);
      expect(bytes.length).toBe(sample.bytes);
      expect(
        PIANO_SAMPLES.find((item) => item.file === sample.file)?.rootFrequency,
      ).toBe(sample.rootFrequency);
    }
  });
});

describe("reference player", () => {
  test("keeps sine playback available without loading recordings and retunes it smoothly", async () => {
    const h = createHarness(async () => {
      throw new Error("Unexpected sample download");
    });
    await h.player.prepare("sine");
    h.player.startReference("sine", 440);
    h.context.currentTime = 1;
    h.player.setFrequency(880);
    expect(h.oscillators.length).toBe(1);
    expect(h.oscillators[0].frequency.value).toBe(880);
    h.player.setVolume(0);
    expect(h.gains[0].gain.value).toBe(0);
    h.player.stopReference();
    expect(h.oscillators[0].stops.at(-1)).toBeCloseTo(1.06);
    h.oscillators[0].onended?.();
    expect(h.oscillators[0].disconnected).toBe(true);
  });

  test("shares simultaneous sample loads, caches them, and retries a failed request", async () => {
    const calls: string[] = [];
    let fail = true;
    const h = createHarness(async (url) => {
      calls.push(url);
      if (url.endsWith("c3.wav") && fail) throw new Error("offline");
      return {} as AudioBuffer;
    });
    const outcomes = await Promise.allSettled([
      h.player.prepare("piano"),
      h.player.prepare("piano"),
    ]);
    expect(outcomes.every((item) => item.status === "rejected")).toBe(true);
    expect(calls.length).toBe(10);
    fail = false;
    await h.player.prepare("piano");
    await h.player.prepare("piano");
    expect(calls.length).toBe(11);
  });

  test("uses measured sample tuning and repeats piano without replaying a background backlog", async () => {
    const h = createHarness();
    await h.player.prepare("piano");
    h.player.startReference("piano", 440);
    const sample = findNearestSample(PIANO_SAMPLES, 440);
    expect(h.samplers[0].playbackRate.value).toBeCloseTo(
      440 / sample.rootFrequency,
      8,
    );
    h.context.currentTime = 2.45;
    h.tick();
    expect(h.samplers.length).toBe(2);
    expect(h.samplers[1].startedAt).toBeCloseTo(2.51);
    h.context.currentTime = 100;
    h.tick();
    expect(h.samplers.length).toBe(3);
    expect(h.samplers[2].startedAt).toBeCloseTo(100.01);
    h.player.setFrequency(880);
    expect(h.samplers.length).toBe(4);
    expect(h.samplers[2].stops.at(-1)).toBeCloseTo(100.06);
    h.player.stopReference();
    h.context.currentTime = 200;
    h.tick();
    expect(h.samplers.length).toBe(4);
  });

  test("cancels future scale notes as well as sounding voices on stop and dispose", async () => {
    const h = createHarness();
    await h.player.prepare("piano");
    h.player.playScale("piano", [261.63, 293.66, 329.63]);
    expect(h.samplers.map((voice) => voice.startedAt)).toEqual([
      0.01, 0.51, 1.01,
    ]);
    h.context.currentTime = 0.1;
    h.player.stopScale();
    expect(
      h.samplers.every(
        (voice) => Math.abs((voice.stops.at(-1) ?? 0) - 0.16) < 0.0001,
      ),
    ).toBe(true);
    h.player.startReference("piano", 440);
    h.player.dispose();
    expect(h.gains[0].disconnected).toBe(true);
    await expect(h.player.prepare("piano")).rejects.toThrow("closed");
  });
});
