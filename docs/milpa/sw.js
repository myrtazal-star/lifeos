/* Офлайн-кэш Milpa.
   Страница — «сначала сеть» (чтобы обновления доходили),
   код и стили — «из кэша, обновить в фоне» (чтобы открывалось мгновенно). */

const VERSION = 'milpa-v1-202609212007';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.js',
  './data.js',
  './dict.js',
  './forms.js',
  './views.js',
  './news.js',
  './goals.js',
  './csv.js',
  './zip.js',
  './ai.js',
  './import-view.js',
  './data/news.json',
  './tax-mx.js',
  './nomina.js',
  './nomina-view.js',
  './shared/css/base.css',
  './shared/js/store.js',
  './shared/js/i18n.js',
  './shared/js/ui.js',
  './shared/js/format.js',
  './shared/js/pwa.js',
  './shared/js/shell.js',
  './shared/js/sync.js',
  './shared/js/sync-runner.js',
  './shared/js/cloud.js',
  './shared/js/cloud-ui.js',
  './sync.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // по одному: один недостающий файл не должен обрушить установку целиком
    await Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // чужие домены не трогаем

  // Переходы по страницам: свежая версия, при отсутствии сети — из кэша
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Новости должны быть свежими: сеть в приоритете, кэш — на случай её отсутствия
  if (url.pathname.includes('/data/')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(VERSION)).put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Остальное: отдаём из кэша немедленно, параллельно обновляя
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
