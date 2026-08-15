/*
 * The service worker, kept deliberately dumb.
 *
 * There was none for a long time, with a good reason written in `index.html`: this bundle is served
 * by the audioserver itself, and a cache-first shell on a wall panel would keep replaying an old
 * build after every upgrade. That reason has not gone away — but a browser will not offer to
 * install an app without one, and putting the player on a home screen is most of what makes it feel
 * like an app on a phone.
 *
 * So the rule is **network first, always**, and the cache exists for exactly one situation: the
 * server is unreachable and the app would otherwise be a blank page. What the network returns is
 * what you get and what gets stored; the cache is never consulted while a response is coming.
 *
 * Three things are deliberately never touched:
 *
 *  - **`/api/…`** — commands, state, the event stream. A cached command is a lie about the house,
 *    and an SSE response is a stream that never completes and must not be held.
 *  - **Anything that is not a GET**, for the same reason.
 *  - **Cover art**, which is per-zone and changes per track: the browser's own HTTP cache handles
 *    it correctly and a second copy here would only go stale.
 */
const CACHE = 'sonn-player-v1';

self.addEventListener('install', () => {
  // Take over as soon as the new build lands rather than waiting for every tab to close: the
  // whole point of network-first is that the newest code wins.
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Whether this request is part of the app shell — the only thing worth keeping a copy of. */
function shellRequest(request) {
  if (request.method !== 'GET') {
    return false;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return false;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/audio/')) {
    return false;
  }
  // A navigation, or one of the built assets beside this file.
  return request.mode === 'navigate' || url.pathname.startsWith('/player/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!shellRequest(request)) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        // Opaque and error responses are not worth storing; a 200 from our own origin is.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          void cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        // A navigation with nothing cached still has to answer with *something* the browser can
        // render, or the tab shows its own offline page over ours.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/player/');
          if (shell) {
            return shell;
          }
        }
        throw new Error('offline');
      }
    })(),
  );
});
