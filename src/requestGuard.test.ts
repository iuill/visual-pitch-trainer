import { expect, test } from "bun:test";
import { createRequestGuard } from "./requestGuard";

test("supersedes requests and invalidates pending requests on cancellation", () => {
  const guard = createRequestGuard();
  const first = guard.begin();
  expect(first()).toBe(true);

  const second = guard.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);

  guard.cancel();
  expect(second()).toBe(false);

  const restarted = guard.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(false);
  expect(restarted()).toBe(true);
});
