/* The build replaces the asset list and cache version. No microphone data is cached. */
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = `visual-pitch:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}shell:__CACHE_VERSION__`;
const AUDIO_CACHE_NAME = `${CACHE_PREFIX}audio:__AUDIO_VERSION__`;
const ASSETS = new Set(
  PRECACHE.map((path) => new URL(path, self.registration.scope).href),
);
const INDEX = new URL("index.html", self.registration.scope).href;
const LICENSE = new URL("THIRD_PARTY_NOTICES.txt", self.registration.scope)
  .href;
const ROOT_PATH = new URL(self.registration.scope).pathname;
const AUDIO_PATH = new URL("audio/", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(
        [...ASSETS].map(
          (url) =>
            new Request(url, {
              // Hashed JS/CSS can reuse the browser's HTTP cache on the first visit.
              cache: /\/assets\/[^/]+-[\w-]+\.(js|css)$/.test(
                new URL(url).pathname,
              )
                ? "default"
                : "reload",
            }),
        ),
      ),
    ),
  );
  // Wait for existing app windows to close; never interrupt an active practice.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (
          key.startsWith(CACHE_PREFIX) &&
          key !== CACHE_NAME &&
          key !== AUDIO_CACHE_NAME
        )
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
    (url.pathname === ROOT_PATH || url.pathname === new URL(INDEX).pathname)
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
      const cache = await caches.open(isAudio ? AUDIO_CACHE_NAME : CACHE_NAME);
      const cached = await cache.match(request);
      const response = cached ?? (await fetch(request));
      if (!cached && response.ok && response.type === "basic") {
        // Audio is cached only on use; models, WASM and external requests bypass this worker.
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      if (url.href === LICENSE) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "text/plain; charset=utf-8");
        headers.delete("Content-Encoding");
        headers.delete("Content-Length");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    })(),
  );
});
