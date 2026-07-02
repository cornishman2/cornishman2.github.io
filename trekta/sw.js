const CACHE_NAME = "trekta-cache-v1"; // <-- bump this on every deployment
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/London.png",
  "./assets/screenshot-home.jpg",
  "./assets/screenshot-map.jpg",
  "./assets/screenshot-places.jpg",
  "./assets/screenshot-favourites.jpg"
];

// Install: pre-cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
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
    const cached = await cache.match(request);
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
  if (isNavigation || isHtml || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/Trekta.html")) {
    event.respondWith(networkFirst(req));
    return;
  }
  // Everything else: cache-first
  event.respondWith(cacheFirst(req));
});
