const CACHE_VERSION = "auditoria-shell-v1";
const SHELL_CACHE = CACHE_VERSION;

const scopeUrl = new URL(self.registration.scope);
const basePath = scopeUrl.pathname.endsWith("/") ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const indexPath = `${basePath}index.html`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([basePath, indexPath]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  // Navegação da SPA: tenta rede, cai para cache quando offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const cloned = networkResponse.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, cloned));
          return networkResponse;
        })
        .catch(async () => {
          const cachedRoute = await caches.match(request);
          if (cachedRoute) return cachedRoute;
          const cachedIndex = await caches.match(indexPath);
          if (cachedIndex) return cachedIndex;
          return caches.match(basePath);
        })
    );
    return;
  }

  // Cache para assets estáticos locais (js/css/img/font) com stale-while-revalidate.
  if (isSameOrigin) {
    const staticDestinations = new Set(["script", "style", "image", "font"]);
    if (staticDestinations.has(request.destination)) {
      event.respondWith(
        caches.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                const cloned = networkResponse.clone();
                void caches.open(SHELL_CACHE).then((cache) => cache.put(request, cloned));
              }
              return networkResponse;
            })
            .catch(() => cached);

          return cached || networkFetch;
        })
      );
    }
  }
});
