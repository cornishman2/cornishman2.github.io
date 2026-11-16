const CACHE_NAME = "detekta-cache-v76"; // <-- bump this on every deployment
// Since V1.31 every library is built into index.html, so this list is
// everything the app needs to run with no signal.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/dig-it-hero.png",
  "./assets/shot-digs.jpg",
  "./assets/shot-dig-card.jpg",
  "./assets/shot-map.jpg",
  "./assets/shot-map-lidar.jpg",
  "./assets/shot-scout.jpg",
  "./assets/shot-pin-card.jpg",
  "./assets/shot-fullscreen.jpg",
  "./assets/shot-explore.jpg",
  "./assets/shot-map-grid.jpg",
  "./assets/shot-finds.jpg",
  "./assets/shot-find-card.jpg",
  "./assets/shot-place-map.jpg",
  "./assets/shot-sunlight.jpg",
  "./assets/shot-settings.jpg",
  "./assets/shot-backup.jpg"
];
// Install: pre-cache app shell.
// Each file is added on its own, so one missing picture can't stop the
// whole app being saved for offline use.
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
// Activate: cleanup old caches + take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))
      );
      await self.clients.claim();
    })()
  );
});
// Helper: network-first (good for HTML so updates land)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    // Only cache successful basic (same-origin) responses
    if (fresh && fresh.ok && fresh.type === "basic") {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    // Offline: the saved copy of this address, or failing that the saved app page
    const cached = (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match("./index.html"))
      || (await cache.match("./"));
    return cached || Promise.reject(err);
  }
}
// Helper: cache-first (good for icons/assets)
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
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only same-origin requests (avoid caching third-party)
  if (url.origin !== self.location.origin) return;
  // Treat navigations + HTML as network-first so index updates
  const isNavigation = req.mode === "navigate";
  const isHtml = req.headers.get("accept")?.includes("text/html");
  if (isNavigation || isHtml || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) {
    event.respondWith(networkFirst(req));
    return;
  }
  // Everything else: cache-first
  event.respondWith(cacheFirst(req));
});
