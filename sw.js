/* PWA: شبكة أولًا دائمًا (لا محتوى قديم)، والنسخة المخزنة فقط عند انقطاع الاتصال. طلبات Supabase وغيرها من النطاقات لا تُلمس */
const C = 'almatarid-ce163a4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./') : Response.error()))));
});

/* Web Push (E-01): عرض الإشعارات الواردة من خادم الإرسال الخارجي.
   لا إرسال من هنا إطلاقاً — الاشتراكات تُجمع في التطبيق، والإرسال يتم من
   خادم خارجي بمفتاح VAPID الخاص (tools/push-sender-example.mjs). */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || '🌳 أسرة آل مطارد';
  const body = data.body || 'تحديث جديد من شجرة العائلة';
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: data.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
