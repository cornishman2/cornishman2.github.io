const CACHE_NAME = "trekta-cache-v11"; // <-- bump this on every deployment
const TILE_CACHE = "trekta-tiles-v3";  // OpenFreeMap pictures you have viewed, kept for use without signal (v2 held MapTiler pictures and is removed)
const TILE_CACHE_MAX = 4000;            // about 100-200 MB; the oldest are removed first

// Since V1.872 every library is built into index.html, so this list is
// everything the app needs to run with no signal.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/London.png",
  "./assets/screenshot-home.jpeg",
  "./assets/screenshot-map.jpeg",
  "./assets/screenshot-places.jpeg",
  "./assets/screenshot-settings.jpeg"
];

// Install: pre-cache the app. Each file is added on its own, so one missing
// picture can't stop the whole app being saved for offline use.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch((err) => {
          console.warn("SW: could not pre-cache", url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old copies of the app (and the old unlimited map cache), then take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key !== CACHE_NAME && key !== TILE_CACHE ? caches.delete(key) : Promise.resolve()))
      );
      await self.clients.claim();
    })()
  );
});

// HTML: network first, so updates arrive; the saved copy when there is no signal
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok && fresh.type === "basic") {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match("./index.html"))
      || (await cache.match("./"));
    return cached || Promise.reject(err);
  }
}

// Icons and pictures: the saved copy first
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok && fresh.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

// Map pictures: the saved copy at once (works without signal), refreshed in the background.
// The cache is kept to TILE_CACHE_MAX pictures so it can't fill the phone.
let trimming = false;
async function trimTileCache() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();          // oldest first
    const extra = keys.length - TILE_CACHE_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } catch (e) { /* ignore */ }
  trimming = false;
}
async function tileStaleWhileRevalidate(event) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (resp) => {
    if (resp && (resp.ok || resp.type === "opaque")) {
      await cache.put(event.request, resp.clone());
      trimTileCache();
    }
    return resp;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Map service: OpenFreeMap (styles, map pictures, fonts and symbols)
  if (url.hostname === "tiles.openfreemap.org") {
    event.respondWith(tileStaleWhileRevalidate(event));
    return;
  }

  // Everything else from other sites (e.g. place search) goes straight to the network
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate";
  const isHtml = req.headers.get("accept")?.includes("text/html");
  if (isNavigation || isHtml || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});
