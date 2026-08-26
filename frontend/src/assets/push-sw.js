/**
 * Service worker for parent push notifications (the public student page).
 * Push-only: no caching, no offline — it exists so the browser has somewhere
 * to deliver notifications when the page is closed.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* show something anyway */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Netrofit', {
    body: data.body || '',
    dir: 'auto',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
