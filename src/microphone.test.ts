import { expect, test } from "bun:test";
import { formatMicrophoneError } from "./microphone";

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
