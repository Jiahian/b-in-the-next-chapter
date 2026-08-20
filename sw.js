// B in the Next Chapter! — minimal service worker
// Caches the app shell so the installed PWA opens instantly (and shows
// something even when offline). Data (Sheet entries, Drive media) always
// comes from the network — this never caches API responses.

var CACHE_NAME = "bnext-shell-v1";
var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first for navigations/API calls, cache-first for the static shell.
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || req.url.indexOf(location.origin) !== 0) return; // let cross-origin (Apps Script, Drive, CDN) pass through untouched

  var isShellFile = SHELL_FILES.some(function (f) {
    return req.url.indexOf(f.replace("./", "")) !== -1;
  });

  if (isShellFile) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req);
      })
    );
  }
});
