const CACHE_VERSION = "v4";
const CACHE_NAME    = `serie-b-cache-${CACHE_VERSION}`;
const BASE          = "/pwa-test-1/";

// ── Dominios CDN permitidos para cachear ──────────────────────────────────
// Solo cacheamos lo estrictamente necesario para funcionar offline.
// Tesseract WASM (~10 MB) es el más crítico — sin él el escaneo no funciona.
const CDN_WHITELIST = [
  "cdn.jsdelivr.net",   // Tesseract.js
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

// ── Archivos propios a precargar en install ───────────────────────────────
const PRECACHE_ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
];

// ── Assets CDN críticos a precargar (Tesseract bundle) ───────────────────
// Precachear Tesseract garantiza que el OCR funcione offline desde el 1er uso.
const PRECACHE_CDN = [
  "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js",
];

// ─────────────────────────────────────────────────────────────────────────
// INSTALL — precachear todo lo necesario para funcionar offline
// ─────────────────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Usamos individual adds con manejo de errores para que un fallo
      // en un asset CDN no bloquee el install completo
      Promise.allSettled([
        cache.addAll(PRECACHE_ASSETS),
        ...PRECACHE_CDN.map(url =>
          cache.add(new Request(url, { mode: "cors" })).catch(err =>
            console.warn("[SW] No se pudo precargar:", url, err)
          )
        ),
      ])
    ).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────────────────────────
// ACTIVATE — limpiar cachés viejos de versiones anteriores
// ─────────────────────────────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith("serie-b-cache-") && k !== CACHE_NAME)
          .map(k => {
            console.log("[SW] Eliminando caché viejo:", k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────────────────────────
// FETCH — estrategia por tipo de recurso
// ─────────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  // Ignorar peticiones non-GET (POST, etc.)
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // ── 1. Archivos propios del sitio → Cache First ───────────────────────
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── 2. CDN en whitelist → Cache First ────────────────────────────────
  // Tesseract y Fonts: una vez descargados, siempre desde caché.
  // Evita re-descargar el bundle WASM de ~10 MB en cada visita.
  if (CDN_WHITELIST.includes(url.hostname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── 3. Cualquier otra petición → Network only (no cachear) ───────────
  // No cacheamos recursos de terceros desconocidos para no crecer
  // indefinidamente el storage del dispositivo del usuario.
});

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== "opaque") {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn("[SW] Sin red y sin caché para:", request.url);
    // Fallback a index.html para navegación
    if (request.destination === "document") {
      return caches.match(BASE + "index.html");
    }
    throw err;
  }
}