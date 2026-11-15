/* The build replaces the asset list and cache version. No microphone data is cached. */
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = `visual-pitch:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}__CACHE_VERSION__`;
const ASSETS = new Set(
  PRECACHE.map((path) => new URL(path, self.registration.scope).href),
);
const INDEX = new URL("index.html", self.registration.scope).href;
const AUDIO_PATH = new URL("audio/", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(
          [...ASSETS].map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
  // Wait for existing app windows to close; never interrupt an active practice.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("range")
  )
    return;
  const isAudio =
    url.pathname.startsWith(AUDIO_PATH) &&
    url.pathname.endsWith(".wav") &&
    !url.search;
  if (
    request.mode === "navigate" &&
    url.href.startsWith(self.registration.scope)
  ) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(async (cache) => (await cache.match(INDEX)) ?? fetch(request)),
    );
    return;
  }
  if (!ASSETS.has(url.href) && !isAudio) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        // Audio is cached only on use; models, WASM and external requests bypass this worker.
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      return response;
    })(),
  );
});
