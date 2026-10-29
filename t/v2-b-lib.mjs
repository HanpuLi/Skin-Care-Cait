// B 路(顾问 + 产品 + 设置 + 引导 + 常识)无头测试的共用部分。不联网、不登录真账号、不碰真顾问(全用假后端,不花钱)。
//   · page-helpers.js 的种子和假顾问后端(拦 127.0.0.1:8808);这里补 /api/tonight、/api/assess(今晚页 A 路会调)
//   · 假 Firebase(compat 形状,同 s-85 / v2-a-lib):fakeCloud.auth(user) 走 App 真正的登录路径;fakeCloud.emit(data) 给一份服务器快照
//   · 【整合前】index.html 还没挂 settings.css / oobe.css,app.js 还没接引导 / 改版说明 / 要不要买的 runner / 跟随系统深浅色:
//     测试时在仓库根目录临时生成一份外壳(.v2-b-shell.html)和一份打了补丁的 app.js(.v2-b-app.js),补丁内容 = 返回给整合阶段的
//     sharedChanges(原样);跑完删掉。整合后真文件里已经有这些,就直接用 index.html,不再生成。
// 这台 Mac 上无头 Chrome 跑 30 来秒会被 SIGTERM:每个测试块开一个新的 Chrome,块内保持在 25 秒以内。
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, suite, sleep } from './harness.mjs';

export const DIR = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.resolve(DIR, '..');
const HELPERS = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
export const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
const EXTRA = `(function(){
  const json = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  const inner = window.fetch;
  window.fetch = async function (url, init) {
    const u = String(url && url.url || url);
    if (u.startsWith('http://127.0.0.1:8808')) {
      const F = window.__AIF || { mode: 'down' };
      const p = new URL(u).pathname;
      const key = p === '/api/tonight' ? 'tonight' : p === '/api/assess' ? 'assess' : '';
      if (key && F.mode === 'on') {
        let body = null; try { body = JSON.parse(init.body); } catch (e) { }
        (F.log = F.log || []).push({ p, body });
        const d = typeof F[key] === 'function' ? F[key](body) : F[key];
        if (!d) return json(502, { error: '假后端没给 ' + key });
        return json(200, { data: d, model: 'claude-test', effort: 'medium', cost: 0.06 });
      }
      if (p === '/api/me' && F.mode === 'on' && F.meErr) { (F.log = F.log || []).push({ p }); return json(500, { error: 'boom' }); }
    }
    return inner(url, init);
  };
  const clone = v => JSON.parse(JSON.stringify(v));
  window.fakeCloud = { listeners: [], writes: [], server: null, auth: null,
    emit(data, metadata, exists) {
      metadata = Object.assign({ fromCache: false, hasPendingWrites: false }, metadata || {});
      if (exists === undefined) exists = true;
      if (!metadata.fromCache && !metadata.hasPendingWrites) this.server = exists ? clone(data) : null;
      this.listeners[this.listeners.length - 1].fn({ exists, metadata, data: () => clone(data) });
    } };
  const db = { collection() { return { doc(uid) { return { uid,
      onSnapshot(o, fn) { fakeCloud.listeners.push({ uid, o, fn }); return () => {}; },
      set() { throw Error('unguarded set'); } }; } }; },
    async runTransaction(cb) {
      let staged = null;
      const res = await cb({ get: async () => ({ exists: !!fakeCloud.server, data: () => clone(fakeCloud.server || {}) }), set(ref, d) { staged = clone(d); } });
      if (staged) { fakeCloud.writes.push(staged); fakeCloud.server = staged; }
      return res;
    } };
  window.firebase = { apps: [{}], initializeApp() {}, firestore: () => db,
    auth() { return { currentUser: null, onAuthStateChanged(fn) { fakeCloud.auth = fn; }, signOut() {} }; } };
})();`;
export const PRE = HELPERS + '\n' + EXTRA;
export const BOOTED = 'document.documentElement.dataset.boot==="ok"';
export const OWNER_EMAIL = Buffer.from('Y2FpdGx5ZUBnbWFpbC5jb20=', 'base64').toString();

// ── 整合前的外壳(见文件头)──
const SHELL = '.v2-b-shell.html', APPJS = '.v2-b-app.js';
export const NEED_CSS = ['css/screens/settings.css', 'css/screens/oobe.css', 'css/screens/capture.css'];
export function integrated() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    return NEED_CSS.every(c => html.indexOf(c) >= 0) && /from '\.\/ui\/oobe\.js'/.test(app) && /ensureShopRunner\(app\)/.test(app) && /watchTheme\(\)/.test(app);
}
// 打在 app.js 上的补丁 = sharedChanges 里给整合阶段的那几处(路径按根目录改写)
export function patchApp(src) {
    let s = src;
    if (!/from '\.\/ui\/oobe\.js'/.test(s)) s = s.replace("import { openSettings } from './ui/settings.js';",
        "import { openSettings, watchTheme } from './ui/settings.js';\nimport { onBoot as oobeOnBoot, onFirstSnapshot as oobeOnFirstSnapshot } from './ui/oobe.js';\nimport { ensureShopRunner } from './ui/products.js';");
    s = s.replace("onFirstSnapshot: () => { /* 新用户引导 / 改版说明:P2 */ }", 'onFirstSnapshot: () => oobeOnFirstSnapshot(app)');
    if (!/ensureShopRunner\(app\)/.test(s.replace(/import[^\n]*\n/g, ''))) s = s.replace("    show(location.hash.replace(/^#\\/?/, '') || 'tonight');",
        "    show(location.hash.replace(/^#\\/?/, '') || 'tonight');\n    ensureShopRunner(app);   // 「要不要买」的后台判断:只听本机操作入口(ai/apply.js)\n    watchTheme();            // 深浅色跟随系统 / 晚上自动\n    oobeOnBoot(app);         // 新用户引导 / 改版说明(没登录时 1.8 秒后按本机数据判断)");
    return s.replace(/from '\.\//g, "from './js/");
}
let shellMade = false;
export function shellPath() {
    if (integrated()) return '/index.html';
    if (!shellMade) {
        let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const links = NEED_CSS.filter(c => html.indexOf(c) < 0).map(c => `    <link rel="stylesheet" href="${c}">`).join('\n');
        html = html.replace('    <link rel="stylesheet" href="css/screens/products.css">', '    <link rel="stylesheet" href="css/screens/products.css">\n' + links);
        html = html.replace('src="js/app.js"', 'src="' + APPJS + '"');
        fs.writeFileSync(path.join(ROOT, SHELL), html);
        const app = patchApp(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));
        if (!/oobeOnBoot\(app\)/.test(app) || !/oobeOnFirstSnapshot\(app\)/.test(app)) throw new Error('app.js 的补丁没打上(app.js 改过了?看 patchApp)');
        fs.writeFileSync(path.join(ROOT, APPJS), app);
        shellMade = true;
    }
    return '/' + SHELL;
}
export function cleanShell() { [SHELL, APPJS].forEach(f => { try { fs.unlinkSync(path.join(ROOT, f)); } catch (e) { } }); shellMade = false; }

let srv = null;
export async function server() { if (!srv) srv = await serve(); return { srv, origin: 'http://127.0.0.1:' + srv.address().port }; }
export function stopServer() { if (srv) srv.close(); srv = null; }

// 开一个新的 Chrome + 页面。o = {seed, seedArg, after(种子之后、重载之前跑的 js), mode, aif, login(true | {email, uid}), claim(默认点「是我的」),
//   snapshot(登录后给一份服务器快照:'local' = 本机这份 / 'none' = 云端没有这个账号 / 对象 = 那份数据 / 不给就不发), hash, scheme, keepSheets}
export async function fresh(origin, o = {}) {
    const br = await browser();
    const p = await page(br, origin, { pre: PRE, scheme: o.scheme, width: o.width, height: o.height });
    p.br = br;
    p.done = () => { try { p.send('Page.close'); } catch (e) { } p.close(); br.close(); };
    const url = origin + shellPath() + (o.hash || '');
    await p.send('Page.navigate', { url });
    await p.waitFor(BOOTED, 15000);
    if (o.seed) {
        await p.eval(`__seed.${o.seed}(${o.seedArg || ''});${o.after || ''};return 1`);
        await p.send('Page.reload', {}); await sleep(300);
        await p.waitFor(BOOTED, 8000);
    } else if (o.after) { await p.eval(`${o.after};return 1`); await p.send('Page.reload', {}); await sleep(300); await p.waitFor(BOOTED, 8000); }
    await p.eval(`window.__AIF=Object.assign({mode:'${o.mode || 'down'}'},${o.aif || '{}'});return 1`);
    if (o.login) {
        const L = Object.assign({ uid: 'u-test', email: 't@example.com' }, o.login === true ? {} : o.login);
        await p.waitFor('!!(window.fakeCloud && fakeCloud.auth)', 5000);
        await p.eval(`fakeCloud.auth({uid:${JSON.stringify(L.uid)},email:${JSON.stringify(L.email)},displayName:'Tester Name',getIdToken:async()=>'fake-id-token'});return 1`);
        if (o.claim !== false) {
            try { await p.waitFor(`!!document.querySelector('#claim .btn-primary')`, 2000); await p.eval(`document.querySelector('#claim .btn-primary').click();return 1`); } catch (e) { }
        }
        await p.waitFor(`fakeCloud.listeners.length>0`, 4000).catch(() => { });
        if (o.snapshot === 'none') await p.eval(`fakeCloud.emit({},{},false);return 1`);   // 新账号:云端还没有这份
        else if (o.snapshot) {
            const data = o.snapshot === 'local' ? `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k)).data})()` : JSON.stringify(o.snapshot);
            await p.eval(`fakeCloud.emit(${data});return 1`);
        }
        await p.waitFor(`!!(window.__AIF.log||[]).some(x=>x.p==='/api/me') || __AIF.mode!=='on'`, 5000).catch(() => { });
        await sleep(300);
    }
    if (!o.keepSheets) await closeSheets(p);
    return p;
}
// 改版说明 / 引导这类启动后会弹的 sheet:默认关掉,别挡住要测的那一屏
export async function closeSheets(p) {
    await sleep(50);
    await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(o=>o.remove());return 1`);
}
export async function tab(p, id, ms = 250) { await p.eval(`document.getElementById('tab-${id}').click();return 1`); await sleep(ms); }
export async function click(p, sel, ms = 150) {
    const ok = await p.eval(`const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.click();return true`);
    if (!ok) throw new Error('点不到: ' + sel);
    await sleep(ms);
}
export async function setFile(p, sel, file) {
    const doc = await p.send('DOM.getDocument', { depth: -1 });
    const q = await p.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel });
    if (!q.result || !q.result.nodeId) throw new Error('没有文件框: ' + sel);
    await p.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
}
// 当前账号的信封里的记录(登录前是 sk_sync_v1:,认领后是 sk_sync_v1:<uid>)
export const ENV = `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k))})()`;
export const DATA = `(${ENV}.data)`;
export function log(p, path) { return p.eval(`return (__AIF.log||[]).filter(x=>x.p===${JSON.stringify(path)}).length`); }
export const text = (p, sel) => p.eval(`const e=document.querySelector(${JSON.stringify(sel)});return e?e.innerText:''`);
export const has = (p, sel) => p.eval(`return !!document.querySelector(${JSON.stringify(sel)})`);
// 纸墨验收(同 s-50 的口径,只量这一块):0 emoji、字号 ≥12、句子 ≥14、对比度、触控 ≥44、模板里没有 style=
export async function design(p, sel) {
    await p.eval(PROBE + ';return 1');
    return p.eval(`return __probe(${JSON.stringify(sel)})`);
}
// 1×1 的 png(读成分表那条路只要「有一张图」)
export function tinyPng() {
    const f = path.join(ROOT, 'icon-192.png');
    return f;
}
export { suite, sleep };
// 一个测试文件的骨架:块按顺序跑,每块自己开 / 关 Chrome;块里抛异常记一条失败,继续下一块。只跑名字里含 argv 关键词的块
export async function run(name, blocks) {
    const S = suite(name);
    const { origin } = await server();
    const only = process.argv.slice(2);
    try {
        for (const [label, fn] of blocks) {
            if (only.length && !only.some(k => label.indexOf(k) >= 0)) continue;
            let p = null;
            const t0 = Date.now();
            try { await fn({ S, origin, open: async o => (p = await fresh(origin, o)) }); }
            catch (e) { S.ok(false, label + ' 抛异常: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); }
            finally { if (p && p.done) p.done(); await sleep(300); if (process.env.TIMING) console.log('    [' + label + ' ' + (Date.now() - t0) + 'ms]'); }
        }
    } finally { stopServer(); cleanShell(); }
    console.log(`\n${S.failed.length ? '✗ ' + S.failed.length + ' 条失败' : '✓ 全部通过'}(${S.res.length} 条)`);
    process.exit(S.failed.length ? 1 : 0);
}
