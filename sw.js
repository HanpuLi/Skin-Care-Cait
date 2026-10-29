// 护肤计划 PWA 的离线缓存。
// · 安装时预缓存:页面、js/ 和 css/ 下所有模块(v2)、manifest、主屏图标、三份自托管字体(中文宋体子集约 1.3MB,一次装好以后离线也是宋体)
//   核心文件缺一个就不装(老版本继续用);字体单独装,某一份没下完不连累整体,运行时再补。
// · 同源请求:网络优先,拿到就更新缓存;断网回退到当前版本的缓存。
// · Google 字体域(子集外的生僻字兜底):stale-while-revalidate,先给缓存、后台更新。
const CACHE_NAME = 'skincare-app-v28';
const CORE = [
  './',
  './index.html',
  './护肤计划.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  // v2:模块和样式(和仓库里 js/、css/ 的文件一一对应;t/engine-unit.mjs 核对,多一个少一个都报错)
  './css/base.css',
  './css/components.css',
  './css/screens/advisor.css',
  './css/screens/products.css',
  './css/screens/record.css',
  './css/screens/tonight.css',
  './css/tokens.css',
  './js/ai/apply.js',
  './js/ai/client.js',
  './js/ai/context.js',
  './js/app.js',
  './js/clock.js',
  './js/engine/assess.js',
  './js/engine/gate.js',
  './js/engine/ladder.js',
  './js/engine/needs.js',
  './js/engine/redline.js',
  './js/engine/regimen.js',
  './js/engine/rules.js',
  './js/engine/schedule.js',
  './js/engine/score.js',
  './js/engine/util.js',
  './js/firebase-config.js',
  './js/model/journal.js',
  './js/model/photos.js',
  './js/model/products.js',
  './js/model/profile.js',
  './js/model/regimen.js',
  './js/model/week.js',
  './js/model/world.js',
  './js/store.js',
  './js/sync.js',
  './js/ui/advisor.js',
  './js/ui/facemap.js',
  './js/ui/products.js',
  './js/ui/record.js',
  './js/ui/settings.js',
  './js/ui/sheets.js',
  './js/ui/tonight.js'
];
const FONTS = [
  './fonts/noto-serif-sc-400-skin.woff2',
  './fonts/eb-garamond-latin-400.woff2',
  './fonts/courier-prime-latin-400.woff2'
];
const ASSETS = CORE.concat(FONTS);
const SWR_DOMAINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE).then(() => Promise.all(FONTS.map((f) => cache.add(f).catch(() => null)))))
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
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (SWR_DOMAINS.indexOf(url.hostname) >= 0) {
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;   // Firebase、顾问后端等:不经过缓存
  // 字体:缓存优先(文件名带内容,不会变)
  if (url.pathname.indexOf('/fonts/') >= 0) {
    event.respondWith(caches.match(req, { cacheName: CACHE_NAME }).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, c)); }
      return res;
    })));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(req, { cacheName: CACHE_NAME, ignoreSearch: true })
        .then((hit) => hit || caches.match(req)))
  );
});
