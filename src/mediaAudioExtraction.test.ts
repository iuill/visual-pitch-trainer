import { describe, expect, test } from "bun:test";
import {
  createWavBlobFromDecodedAudio,
  decodeMediaAudio,
  mixChannelsToMono,
} from "./mediaAudioExtraction";

describe("media audio extraction", () => {
  test("mixes multiple channels to mono", () => {
    const mono = mixChannelsToMono([
      new Float32Array([1, 0.5, -1]),
      new Float32Array([-1, 0.5]),
    ]);

    expect([...mono]).toEqual([0, 0.5, -0.5]);
  });

  test("returns an empty mono buffer when no channels are provided", () => {
    expect(mixChannelsToMono([]).length).toBe(0);
  });

  test("creates a 16-bit PCM WAV blob from decoded audio", async () => {
    const wav = createWavBlobFromDecodedAudio({
      sampleRate: 44_100,
      channels: [new Float32Array([-1, 0, 1])],
      durationSec: 3 / 44_100,
      source: "web-audio",
    });
    const view = new DataView(await wav.arrayBuffer());

    expect(wav.type).toBe("audio/wav");
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(readAscii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  test("decodes supported audio through Web Audio first", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "tone.wav");
    const decoded = await decodeMediaAudio(file, {
      decodeAudioData: async (arrayBuffer: ArrayBuffer) => {
        expect(arrayBuffer.byteLength).toBe(3);

        return createFakeAudioBuffer([
          new Float32Array([0.1, 0.2]),
          new Float32Array([0.3, 0.4]),
        ]);
      },
    } as unknown as AudioContext);

    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.durationSec).toBeCloseTo(2 / 48_000, 8);
    expect(decoded.source).toBe("web-audio");
    expect(decoded.channels[0]?.[0]).toBeCloseTo(0.1, 7);
    expect(decoded.channels[0]?.[1]).toBeCloseTo(0.2, 7);
    expect(decoded.channels[1]?.[0]).toBeCloseTo(0.3, 7);
    expect(decoded.channels[1]?.[1]).toBeCloseTo(0.4, 7);
  });

  test("wraps Web Audio and Mediabunny failures in an aggregate error", async () => {
    const file = new File([new Uint8Array([0])], "broken.wav", {
      type: "audio/wav",
    });
    const decodeError = new Error("decodeAudioData failed");

    try {
      await decodeMediaAudio(file, {
        decodeAudioData: async () => {
          throw decodeError;
        },
      } as unknown as AudioContext);
      throw new Error("Expected decodeMediaAudio to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(decodeError);
    }
  });

  test("sends video files directly to Mediabunny without Web Audio decoding", async () => {
    const file = new File([new Uint8Array([0])], "clip.mp4", {
      type: "video/mp4",
    });
    let triedWebAudio = false;

    try {
      await decodeMediaAudio(file, {
        decodeAudioData: async () => {
          triedWebAudio = true;
          throw new Error("Web Audio should not be used for video files.");
        },
      } as unknown as AudioContext);
      throw new Error("Expected decodeMediaAudio to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(triedWebAudio).toBe(false);
    }
  });
});

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

function createFakeAudioBuffer(channels: Float32Array[]): AudioBuffer {
  return {
    sampleRate: 48_000,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    duration: (channels[0]?.length ?? 0) / 48_000,
    getChannelData: (channel: number) =>
      channels[channel] ?? new Float32Array(),
  } as AudioBuffer;
}
