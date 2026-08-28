const CACHE_NAME = 'skincare-app-v16';
const ASSETS = [
  './护肤计划.html',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 清掉旧版本缓存并立刻接管：否则离线回退会命中旧缓存，升 CACHE_NAME 对已装 App 的用户无效
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the latest version if successful
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // 只回退到当前版本的缓存，避免命中残留的旧版本
        return caches.match(event.request, { cacheName: CACHE_NAME })
          .then((hit) => hit || caches.match(event.request));
      })
  );
});
