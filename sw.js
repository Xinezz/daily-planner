/* sw.js - lets the planner open offline and be installed on a phone.
   Strategy: always try the network first (so updates show up), and fall back to the saved copy when offline.
   Bump CACHE_NAME when the list of files below changes. */

const CACHE_NAME = "daily-planner-v1";

const FILES = [
  "./",
  "index.html",
  "focus.html",
  "gallery.html",
  "museum.html",
  "manifest.json",
  "css/base.css",
  "css/planner.css",
  "css/focus.css",
  "css/museum.css",
  "js/theme.js",
  "js/shared.js",
  "js/planner-core.js",
  "js/planner.js",
  "js/focus.js",
  "js/museum-data.js",
  "js/museum.js",
  "assets/fonts/PatrickHand-latin.woff2",
  "assets/fonts/PatrickHand-latin-ext.woff2",
  "assets/add-btn.png",
  "assets/arrow.png",
  "assets/dtd-frame.png",
  "assets/focus-btn.gif",
  "assets/gallery-btn.png",
  "assets/notes-icon.gif",
  "assets/picture-frame.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("index.html"))
      )
  );
});
