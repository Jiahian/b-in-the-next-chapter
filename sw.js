// B in the Next Chapter! — minimal service worker
// Caches the app shell so the installed PWA opens instantly (and shows
// something even when offline). Data (Sheet entries, Drive media) always
// comes from the network — this never caches API responses.

var CACHE_NAME = "bnext-shell-v55";
var SHELL_FILES = [
  "./",
  "./index.html",
  "./gifenc.browser.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/block-party-2026.svg"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.map(function (n) {
          if (n !== CACHE_NAME) return caches.delete(n);
        })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first strategy for index.html and dynamic requests so layout updates appear immediately
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || req.url.indexOf(location.origin) !== 0) return;

  if (req.url.endsWith("/config.js") || req.mode === "navigate" || req.url.endsWith("/") || req.url.endsWith("/index.html")) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) {
          var resClone = res.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(function (cache) {
              return cache.put(req, resClone);
            })
          );
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

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

