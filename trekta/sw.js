const CACHE_NAME = "trekta-cache-v4";
const TILE_CACHE_NAME = "trekta-tiles-v1";  // separate cache for map tiles

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
  "./assets/screenshot-settings.jpg"
];

// Install: pre-cache app shell, ignore individual failures
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: cleanup old caches + take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          // Keep current app cache and tile cache, delete everything else
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

// Helper: network-first (HTML, style JSON)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok && fresh.type === "basic") {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || Promise.reject(err);
  }
}

// Helper: cache-first (icons, assets)
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

// Helper: stale-while-revalidate for map tiles
// Serve cached tile immediately, update cache in background
async function staleWhileRevalidate(request) {
  const tileCache = await caches.open(TILE_CACHE_NAME);
  const cached = await tileCache.match(request);

  // Fetch fresh in background regardless
  const fetchPromise = fetch(request).then(fresh => {
    if (fresh && fresh.ok) {
      tileCache.put(request, fresh.clone());
    }
    return fresh;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise;
}

// Is this a MapTiler tile or resource request?
function isMapTilerRequest(url) {
  return url.hostname === 'api.maptiler.com';
}

// Is this a MapLibre CDN request (sprites, glyphs, etc)?
function isMapLibreResource(url) {
  return url.hostname === 'unpkg.com' && url.pathname.includes('maplibre-gl');
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // MapTiler tiles and resources — stale-while-revalidate
  // This serves cached tiles immediately while updating in background
  if (isMapTilerRequest(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // MapLibre GL JS library — cache-first (rarely changes)
  if (isMapLibreResource(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Only handle same-origin requests for everything else
  if (url.origin !== self.location.origin) return;

  // HTML/navigation — network-first
  const isNavigation = req.mode === "navigate";
  const isHtml = req.headers.get("accept")?.includes("text/html");
  if (isNavigation || isHtml || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/Trekta.html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else same-origin — cache-first
  event.respondWith(cacheFirst(req));
});
