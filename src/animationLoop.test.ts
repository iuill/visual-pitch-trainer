import { expect, test } from "bun:test";
import { AnimationLoop } from "./animationLoop";

test("stopping from a frame callback does not schedule another frame", () => {
  const request = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const cancel = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value(callback: FrameRequestCallback) {
      frames.set(++nextId, callback);
      return nextId;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => frames.delete(id),
  });
  try {
    const loop = new AnimationLoop();
    const times: number[] = [];
    loop.start((now) => {
      times.push(now);
      if (now === 32) loop.stop();
    });
    for (const now of [16, 32]) {
      const frame = frames.get(nextId);
      expect(frames.delete(nextId)).toBe(true);
      frame?.(now);
    }
    expect(times).toEqual([16, 32]);
    expect(frames.size).toBe(0);
  } finally {
    if (request)
      Object.defineProperty(globalThis, "requestAnimationFrame", request);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (cancel)
      Object.defineProperty(globalThis, "cancelAnimationFrame", cancel);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  }
});
