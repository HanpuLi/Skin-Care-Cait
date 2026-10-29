// 护肤计划 PWA 的离线缓存。
// · 安装时预缓存:页面、js/ 和 css/ 下所有模块(v2)、manifest、主屏图标、三份自托管字体(中文宋体子集约 1.3MB,一次装好以后离线也是宋体)
//   一律绕过 HTTP 缓存(cache:'reload'):Pages 给文件 max-age=600,不绕过的话部署后 10 分钟内装的新版可能混进旧模块。
//   核心文件缺一个就不装(老版本继续用);字体、Firebase SDK 单独装,某一份没下完不连累整体,运行时再补。
// · 同源请求:缓存优先,只用当前版本(CACHE_NAME)那一套 —— 一次启动只用一个版本,不会拼出新旧混合的模块集;
//   缓存里没有的才走网络并补进缓存,已有的不拿网络结果覆盖。版本更新只靠 CACHE_NAME 升版走 SW 更新(原子切换),
//   所以改了 index.html / js/ / css/ 必须给 CACHE_NAME +1(t/engine-unit.mjs 对着 main 核)。
// · Firebase SDK(URL 带版本、内容不变):缓存优先。iOS 会清 HTTP 缓存,不放进 SW 的话离线首开就成了「没登录」。
// · Google 字体域(子集外的生僻字兜底):stale-while-revalidate,先给缓存、后台更新。
const CACHE_NAME = 'skincare-app-v30';
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
  './css/screens/capture.css',
  './css/screens/oobe.css',
  './css/screens/products.css',
  './css/screens/record.css',
  './css/screens/settings.css',
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
  './js/ui/capture.js',
  './js/ui/facemap.js',
  './js/ui/guide.js',
  './js/ui/oobe.js',
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
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/9.23.0/';
const SDK = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'].map((f) => FIREBASE_SDK + f);
const SWR_DOMAINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const fresh = (u) => new Request(u, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE.map(fresh)).then(() => Promise.all(
        FONTS.map((f) => cache.add(fresh(f)).catch(() => null))
          .concat(SDK.map((u) => fetch(new Request(u, { mode: 'no-cors' })).then((r) => (r && (r.ok || r.type === 'opaque')) ? cache.put(u, r) : null).catch(() => null))))))
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

// 缓存优先;没有的才上网,拿到就补进当前版本的缓存
function cacheFirst(req, opts) {
  return caches.open(CACHE_NAME).then((cache) => cache.match(req, opts).then((hit) => hit || fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => null);
    return res;
  })));
}

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
  if (req.url.indexOf(FIREBASE_SDK) === 0) { event.respondWith(cacheFirst(req)); return; }
  if (url.origin !== self.location.origin) return;   // Firestore、登录、顾问后端等:不经过缓存
  if (req.mode === 'navigate') {
    // 页面:当前版本缓存里的那一份(带 #/tab 或 ?query 也认);缓存里没有才上网
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(req, { ignoreSearch: true })
      .then((hit) => hit || (/\/$/.test(url.pathname) ? cache.match('./index.html') : null))
      .then((hit) => hit || fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => null);
        return res;
      }))));
    return;
  }
  event.respondWith(cacheFirst(req, { ignoreSearch: true }));
});
