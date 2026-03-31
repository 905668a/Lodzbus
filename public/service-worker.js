const CACHE_NAME = "lodz-bus-v1";
const API_CACHE_NAME = "lodz-bus-api-v1";
const ASSETS_TO_CACHE = ["/", "/index.html", "/manifest.json"];

console.log("Service Worker: Instalando...");

// Install event
self.addEventListener("install", (event) => {
  console.log("Service Worker instalado");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Cache abierto, cacheando assets...");
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Error cacheando assets (es normal si el servidor no está listo):", err);
        // No fallar si no se pueden cachear los assets inicialmente
      });
    })
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener("activate", (event) => {
  console.log("Service Worker activado");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            console.log("Borrando cache viejo:", cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Network first para API, cache first para assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests a extensiones y otras URLs especiales
  if (
    request.method !== "GET" ||
    url.protocol === "chrome-extension:" ||
    url.protocol === "moz-extension:"
  ) {
    return;
  }

  // API requests - network first, fallback to cache
  if (
    url.origin === "http://localhost:3000" ||
    url.pathname.startsWith("/api")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Si todo está bien, cachear la response
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          console.warn("Network failed, trying cache for:", request.url);
          // Fall back to cache if network fails
          return caches.match(request).then((cachedResponse) => {
            return (
              cachedResponse ||
              new Response("Offline - No cached response available", {
                status: 503,
              })
            );
          });
        })
    );
  } else {
    // Assets - cache first, network fallback
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((response) => {
            // Cache new assets
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            console.warn("Failed to fetch:", request.url);
            // Return offline page or generic offline response
            if (request.destination === "document") {
              return caches.match("/index.html");
            }
          });
      })
    );
  }
});

// Handle messages from clients
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

