// 离线:Service Worker 把三套自托管字体和 App 本身预缓存;断网重开,今晚页照样出来,宋体照样是宋体。
// 另外检查宋体子集覆盖了界面源码里出现的每一个汉字(字表 fonts/noto-serif-sc-400-skin.chars.txt,由 tools/build-fonts.py 生成)。
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FONTS = ['fonts/noto-serif-sc-400-skin.woff2', 'fonts/eb-garamond-latin-400.woff2', 'fonts/courier-prime-latin-400.woff2'];
export default async function ({ origin, S, open }) {
    // ── 静态:sw.js 的预缓存清单里有三套字体;manifest 用 PNG 图标 ──
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    S.ok(FONTS.every(f => sw.indexOf("'./" + f + "'") >= 0), 'sw.js 的预缓存清单里有三套字体', FONTS.filter(f => sw.indexOf(f) < 0));
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    S.ok(mf.icons.every(i => /\.png$/.test(i.src) && fs.existsSync(path.join(ROOT, i.src))) && mf.icons.some(i => /maskable/.test(i.purpose || '')), 'manifest 图标都是 PNG,有 maskable', mf.icons);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    S.ok(/rel="apple-touch-icon"[^>]*icon-180\.png/.test(html) && fs.existsSync(path.join(ROOT, 'icon-180.png')), '主屏图标:apple-touch-icon 是 180 的 PNG');
    // 子集覆盖:index.html / ai.js 里出现的汉字都在字表里
    const have = new Set([...fs.readFileSync(path.join(ROOT, 'fonts/noto-serif-sc-400-skin.chars.txt'), 'utf8')]);
    // 正则里的字符区间(比如 [一-鿿])不是界面用字,先去掉
    const src = (html + fs.readFileSync(path.join(ROOT, 'ai.js'), 'utf8')).replace(/[\u3000-\u9fff]-[\u3000-\u9fff]/g, '');
    const used = [...new Set(src.match(/[一-鿿]/g) || [])];
    const miss = used.filter(c => !have.has(c));
    S.ok(!miss.length, `宋体子集覆盖界面源码里的全部 ${used.length} 个汉字`, miss.join(''));
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/noto-serif-sc-400-skin.meta.json'), 'utf8'));
    S.ok(have.size >= 3700 && fs.statSync(path.join(ROOT, FONTS[0])).size < 1.6e6, `子集 ${have.size} 字、${(fs.statSync(path.join(ROOT, FONTS[0])).size / 1e6).toFixed(2)} MB(一次性预缓存)`, meta);
    S.ok(fs.existsSync(path.join(ROOT, 'fonts/LICENSES.txt')) && /SIL OPEN FONT LICENSE/i.test(fs.readFileSync(path.join(ROOT, 'fonts/LICENSES.txt'), 'utf8')), 'fonts/LICENSES.txt 带 OFL 原文');

    // ── 运行时:装好 SW → 缓存里有字体 → 断网重开 → 今晚页 + 宋体 ──
    const p = await open();
    await p.nav(origin + '/index.html', 300);
    await p.eval(`return __seed.full()`);
    await p.reload(600);
    await p.eval(`await navigator.serviceWorker.ready;return 1`);
    await p.reload(800);   // 让这一页由 SW 接管
    const c = await p.eval(`const ks=await caches.keys();const cache=await caches.open(ks.find(k=>/^skincare-app-/.test(k)));
        const urls=(await cache.keys()).map(r=>new URL(r.url).pathname);return {keys:ks,urls,ctrl:!!navigator.serviceWorker.controller}`);
    S.ok(c.ctrl, 'Service Worker 接管了页面', c);
    S.ok(FONTS.every(f => c.urls.indexOf('/' + f) >= 0), '缓存里有三套字体', c.urls);
    S.ok(['/index.html', '/ai.js', '/manifest.json', '/icon-192.png'].every(u => c.urls.indexOf(u) >= 0), '缓存里有 App 本身和图标', c.urls);
    await p.send('Network.enable');
    await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.reload(1200);
    const off = await p.eval(`await document.fonts.ready;const fams=['Skin Serif SC','Skin Garamond','Skin Mono'];
        const loaded=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/["']/g,''));
        return {online:navigator.onLine,steps:document.querySelectorAll('#tn-plan .step').length,title:document.getElementById('tn-title').textContent,
            serif:document.fonts.check('16px "Skin Serif SC"','今晚'),loaded,fam:getComputedStyle(document.getElementById('tn-title')).fontFamily.split(',')[0]}`);
    S.ok(off.steps >= 3 && off.title, '断网重开:今晚页照常(标题 + 步骤)', off);
    S.ok(off.loaded.indexOf('Skin Serif SC') >= 0 && off.serif, '断网重开:宋体子集从缓存加载', off);
    S.ok(off.loaded.indexOf('Skin Garamond') >= 0 || off.loaded.indexOf('Skin Mono') >= 0, '断网重开:西文字体也从缓存加载', off.loaded);
    S.ok(!p.errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(e)).length, '断网 0 报错(网络错误除外)', p.errors);
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}
