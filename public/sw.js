/* Charm service worker: web push + notification clicks */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Charm", body: "", link: "" };
  try { data = { ...data, ...event.data.json() }; } catch { /* ignore */ }
  event.waitUntil(
    self.registration.showNotification(data.title || "Charm", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: data.link || "" },
      tag: data.link || undefined,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "";
  const url = link ? "/?nlink=" + encodeURIComponent(link) : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.focus();
          if (link) w.postMessage({ type: "nlink", link });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
