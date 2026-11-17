import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const scope = "https://example.test/trainer/";
const prefix = `visual-pitch:${scope}:`;
const template = readFileSync(
  new URL("../scripts/service-worker.js", import.meta.url),
  "utf8",
);
type RequestLike = {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
};
type WorkerEvent = {
  request?: RequestLike;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<Response>): void;
};

function harness() {
  const stores = new Map<string, Map<string, Response>>();
  const requests: Request[] = [];
  const contents = new Map([
    [`${scope}index.html`, "app shell"],
    [`${scope}THIRD_PARTY_NOTICES.txt`, "third-party licenses"],
  ]);
  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      if (!store) throw new Error("missing cache");
      return {
        async addAll(input: Request[]) {
          requests.push(...input);
          for (const request of input)
            store.set(
              request.url,
              new Response(contents.get(request.url) ?? "asset"),
            );
        },
        async match(request: string | RequestLike) {
          return store
            .get(typeof request === "string" ? request : request.url)
            ?.clone();
        },
        async put(request: RequestLike, response: Response) {
          store.set(request.url, response);
        },
      };
    },
  };
  function load(version: string) {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    runInNewContext(
      template
        .replace(
          "__PRECACHE__",
          JSON.stringify([
            "index.html",
            "THIRD_PARTY_NOTICES.txt",
            "assets/main-abc.js",
          ]),
        )
        .replace("__CACHE_VERSION__", version)
        .replace("__AUDIO_VERSION__", "recordings"),
      {
        self: {
          registration: { scope },
          location: new URL(scope),
          clients: { claim: async () => {} },
          addEventListener(
            type: string,
            callback: (event: WorkerEvent) => void,
          ) {
            listeners.set(type, callback);
          },
        },
        caches,
        URL,
        Request,
        Response,
        Headers,
        fetch: async () =>
          new Response("network", {
            headers: { "Content-Type": "text/plain" },
          }),
      },
    );
    return async (type: string, path = "", mode = "navigate") => {
      const waits: Promise<unknown>[] = [];
      let response: Promise<Response> | undefined;
      listeners.get(type)?.({
        request: {
          url: new URL(path, scope).href,
          mode,
          method: "GET",
          headers: new Headers(),
        },
        waitUntil(promise) {
          waits.push(promise);
        },
        respondWith(promise) {
          response = promise;
        },
      });
      const result = await response;
      await Promise.all(waits);
      return result;
    };
  }
  return { stores, requests, load };
}

describe("service worker", () => {
  test("only app entry navigations receive the shell; licenses work online and offline", async () => {
    const h = harness();
    const dispatch = h.load("one");
    await dispatch("install");
    for (const path of [
      "./",
      "./?from=home",
      "index.html",
      "index.html?from=home",
    ]) {
      expect(await (await dispatch("fetch", path))?.text()).toBe("app shell");
    }
    expect(
      await (await dispatch("fetch", "THIRD_PARTY_NOTICES.txt"))?.text(),
    ).toBe("third-party licenses");
    expect(
      (await dispatch("fetch", "THIRD_PARTY_NOTICES.txt"))?.headers.get(
        "Content-Type",
      ),
    ).toBe("text/plain; charset=utf-8");
    expect(await dispatch("fetch", "other.txt")).toBeUndefined();
    expect(
      await dispatch("fetch", "models/model.onnx", "cors"),
    ).toBeUndefined();
    expect(
      h.requests.find((request) => request.url.endsWith("main-abc.js"))?.cache,
    ).toBe("default");
    expect(
      h.requests.find((request) => request.url.endsWith("index.html"))?.cache,
    ).toBe("reload");
  });
  test("app updates retain used recordings and other scopes while retiring the previous shell", async () => {
    const h = harness();
    await h.load("one")("install");
    const audio = new Map([
      [`${scope}audio/piano/c3.wav`, new Response("recording")],
    ]);
    h.stores.set(`${prefix}audio:recordings`, audio);
    const other = `visual-pitch:https://example.test/other/:shell:one`;
    h.stores.set(other, new Map());
    const updated = h.load("two");
    await updated("install");
    await updated("activate");
    expect(h.stores.has(`${prefix}shell:one`)).toBe(false);
    expect(h.stores.has(`${prefix}shell:two`)).toBe(true);
    expect(h.stores.has(other)).toBe(true);
    expect(
      await (await updated("fetch", "audio/piano/c3.wav", "cors"))?.text(),
    ).toBe("recording");
  });
});
