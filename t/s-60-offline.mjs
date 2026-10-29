// 离线:Service Worker 把三套自托管字体和 App 本身预缓存;断网重开,今晚页照样出来,宋体照样是宋体。
// 另外检查宋体子集覆盖了界面源码里出现的每一个汉字(字表 fonts/noto-serif-sc-400-skin.chars.txt,由 tools/build-fonts.py 生成)。
// v2 迁移(P3):界面源码 = index.html + js/ 下全部模块(原来是 index.html + ai.js);App 本身 = index.html + js/app.js;
//   断网后看的是 v2 今晚页(#tonight-h、#tn-plan 的步骤);sw 的缓存清单另由 engine-unit / qa 逐个文件核对。
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
    // 子集覆盖:index.html / js/ 下所有模块里出现的汉字都在字表里
    const have = new Set([...fs.readFileSync(path.join(ROOT, 'fonts/noto-serif-sc-400-skin.chars.txt'), 'utf8')]);
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const mods = walk(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
    // 正则里的字符区间(比如 [一-鿿])不是界面用字,先去掉
    const src = (html + mods.map(f => fs.readFileSync(f, 'utf8')).join('\n')).replace(/[\u3000-\u9fff]-[\u3000-\u9fff]/g, '');
    const used = [...new Set(src.match(/[一-鿿]/g) || [])];
    const miss = used.filter(c => !have.has(c));
    S.ok(!miss.length, `宋体子集覆盖界面源码里的全部 ${used.length} 个汉字`, miss.join(''));
    // 领域字表(护肤成分、症状、病名、HRT 药名:顾问回答里常见、不在 GB 2312 一级里的字)每个字都在子集里
    const extra = [...new Set((fs.readFileSync(path.join(ROOT, 'fonts/extra-chars.txt'), 'utf8').split('\n').filter(l => !l.startsWith('#')).join('').match(/[一-鿿]/g) || []))];
    const missX = extra.filter(c => !have.has(c));
    S.ok(extra.length > 200 && !missX.length && ['鲨', '疱', '钛', '睾', '荟', '螨'].every(c => have.has(c)), `宋体子集覆盖领域字表的全部 ${extra.length} 个字(鲨 疱 钛 睾 荟 螨 ……)`, missX.join(''));
    // 界面用到的非 ASCII 字符都得落在三款自托管字体的 unicode-range 里(否则 iPhone 上落到系统字体,字形和粗细对不上;比如「→」)
    //   范围从 css/tokens.css 现读;源码里先去掉注释、正则里的字符区间
    const tok = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
    const ranges = (tok.match(/unicode-range:([^;}]+)/g) || []).flatMap(r => r.replace('unicode-range:', '').split(',')).map(x => x.trim().replace(/^U\+/i, '').split('-').map(h => parseInt(h, 16))).map(a => [a[0], a.length > 1 ? a[1] : a[0]]);
    const inFont = c => { const n = c.codePointAt(0); return n < 0x80 || ranges.some(([a, b]) => n >= a && n <= b); };
    const strip = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1').replace(/[\u3000-\u9fff]-[\u3000-\u9fff]/g, '');
    const outside = [...new Set([...strip(html + mods.map(f => fs.readFileSync(f, 'utf8')).join('\n'))].filter(c => !inFont(c)))];
    S.ok(ranges.length >= 10 && !outside.length, '界面源码里的非 ASCII 字符都在三款自托管字体的 unicode-range 里', outside.map(c => c + ' U+' + c.codePointAt(0).toString(16).toUpperCase()));
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
    S.ok(['/index.html', '/js/app.js', '/js/ui/tonight.js', '/css/tokens.css', '/manifest.json', '/icon-192.png'].every(u => c.urls.indexOf(u) >= 0), '缓存里有 App 本身(外壳 + 模块 + 样式)和图标', c.urls);
    const listed = (sw.match(/'\.\/(?:js|css)\/[^']+'/g) || []).map(x => x.slice(3, -1));
    S.ok(listed.length > 30 && listed.every(u => c.urls.indexOf('/' + u) >= 0), `sw 清单里的 ${listed.length} 个模块 / 样式都真进了缓存(装好了才接管)`, listed.filter(u => c.urls.indexOf('/' + u) < 0));
    await p.send('Network.enable');
    await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.reload(1200);
    const off = await p.eval(`await document.fonts.ready;const fams=['Skin Serif SC','Skin Garamond','Skin Mono'];
        const loaded=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/["']/g,''));
        const h=document.getElementById('tonight-h');
        return {online:navigator.onLine,boot:document.documentElement.dataset.boot,steps:document.querySelectorAll('#tn-plan [data-step], #tn-plan li').length,title:h&&h.textContent,
            serif:document.fonts.check('16px "Skin Serif SC"','今晚'),loaded,fam:h&&getComputedStyle(h).fontFamily.split(',')[0]}`);
    S.ok(off.boot === 'ok' && off.steps >= 3 && /^今晚 · \S/.test(off.title || ''), '断网重开:今晚页照常(标题 + 步骤)', off);
    S.ok(off.loaded.indexOf('Skin Serif SC') >= 0 && off.serif, '断网重开:宋体子集从缓存加载', off);
    S.ok(off.loaded.indexOf('Skin Garamond') >= 0 || off.loaded.indexOf('Skin Mono') >= 0, '断网重开:西文字体也从缓存加载', off.loaded);
    S.ok(!p.errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(e)).length, '断网 0 报错(网络错误除外)', p.errors);
    await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}
