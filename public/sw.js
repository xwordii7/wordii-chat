// Minimal service worker: network first, cached copy if offline.
const CACHE = "wordii-web-v1.5.20-20261119";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith("wordii-") && name !== CACHE).map(name => caches.delete(name)));
  await self.clients.claim();
})()); });
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : clients.openWindow("/"))));
});

// Phone push from the Wordii push server. If the app is open in front, the app shows its own alert instead.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Wordii Chat", {
      body: d.body || "", tag: d.tag || "wordii", renotify: true,
      icon: "icon-192-v18.png", badge: "icon-192-v18.png",
      vibrate: d.call ? [300, 150, 300, 150, 300] : [150], requireInteraction: !!d.call,
    });
  })());
});
