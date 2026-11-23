import { expect, test } from "bun:test";
import {
  formatMicrophoneError,
  MicrophoneInput,
  PRACTICE_MIC_FFT_SIZE,
} from "./microphone";

test("microphone failures distinguish permission, stale device IDs and capture startup failures", () => {
  expect(
    formatMicrophoneError(new DOMException("denied", "NotAllowedError")),
  ).toContain("マイク許可");
  for (const name of ["OverconstrainedError", "NotFoundError"]) {
    const message = formatMicrophoneError({ name });
    expect(message).toContain(name);
    expect(message).toContain("既定のマイク");
  }
  for (const name of ["NotReadableError", "AbortError"]) {
    expect(formatMicrophoneError({ name })).toContain(name);
    expect(formatMicrophoneError({ name })).toContain("ほかのアプリ");
  }
  expect(formatMicrophoneError(null)).toContain("UnknownError");
});

test("stopping a pending microphone acquisition releases the late stream before connecting it", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const pending = Promise.withResolvers<MediaStream>();
  let stops = 0;
  let analyserStarts = 0;
  const track = { stop: () => stops++ };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const context = {
    createAnalyser() {
      analyserStarts++;
      throw new Error("A cancelled acquisition must not connect audio nodes.");
    },
  } as unknown as AudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => pending.promise },
  });
  try {
    const microphone = new MicrophoneInput();
    const starting = microphone.start(context, {
      deviceId: "",
      fftSize: PRACTICE_MIC_FFT_SIZE,
      onEnded() {
        throw new Error("A cancelled acquisition must not notify the view.");
      },
    });
    microphone.stop();
    pending.resolve(stream);

    expect(await starting).toBeNull();
    expect(stops).toBe(1);
    expect(analyserStarts).toBe(0);
  } finally {
    if (previous) Object.defineProperty(navigator, "mediaDevices", previous);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
