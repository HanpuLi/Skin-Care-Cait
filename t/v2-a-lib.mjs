// A 路(今晚 + 记录 + 拍照)无头测试的共用部分。不联网、不登录真账号、不碰真顾问:
//   · page-helpers.js 的种子和假顾问后端(拦 127.0.0.1:8808);这里再补上 /api/tonight、/api/assess 两个(__AIF.tonight / __AIF.assess)
//   · 假 Firebase(compat 形状,同 s-85):fakeCloud.auth(user) 走 App 真正的登录路径(sync.handleAuthChange → 顾问 probe)
//   · 假相机:__CAM=true 时 getUserMedia 给一个 canvas 画面;默认拒绝(= 没权限 / 没相机)
//   · capture.css 还没进 index.html(整合阶段加),测试页先自己挂上
// 这台 Mac 上无头 Chrome 跑 30 来秒会被 SIGTERM:每个测试块开一个新的 Chrome(fresh()),块内保持在 25 秒以内。
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
        if (F[key + 'Ms']) await new Promise(r => setTimeout(r, F[key + 'Ms']));
        if (F[key + 'Err']) return json(502, { error: F[key + 'Err'] });
        const d = typeof F[key] === 'function' ? F[key](body) : F[key];
        return json(200, { data: d || {}, model: 'claude-test', effort: 'medium', cost: 0.06 });
      }
    }
    return inner(url, init);
  };
  // 假 Firebase(compat):登录 / 快照由测试手动给
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
  // 假相机
  try {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      if (!window.__CAM) throw new Error('NotAllowedError');
      const c = document.createElement('canvas'); c.width = 480; c.height = 640;
      const g = c.getContext('2d'); let n = 0;
      setInterval(() => { g.fillStyle = n++ % 2 ? '#c8b8a8' : '#c9b9a9'; g.fillRect(0, 0, 480, 640); g.fillStyle = '#8a6a5a'; g.beginPath(); g.ellipse(240, 300, 150, 200, 0, 0, 7); g.fill(); }, 50);
      return c.captureStream(20);
    };
  } catch (e) { }
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('link[href$="capture.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/screens/capture.css'; document.head.appendChild(l); }
  });
})();`;
export const PRE = HELPERS + '\n' + EXTRA;
export const BOOTED = 'document.documentElement.dataset.boot==="ok"';
export const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;

// 顾问写的今晚(假):用种子货架里真有的名字
export const TONIGHT_FULL = {
    title: '刷酸夜', why: '前两周没反应，今晚洗澡后刷一次温和酸。',
    steps: [
        { product: '', how: '温水把脸打湿', why: '先软化角质。' },
        { product: 'Lacura 温和洗面奶', how: '打圈 30 秒', why: '洗干净，后面才上得去。' },
        { product: "Paula's Choice 6%杏仁酸+2%乳酸", how: '只涂 T 区和额头，避开口周', why: '这周第 1 次；杏仁酸分子大，对闭口温和。' },
        { product: 'MZ Skin Soothe & Smooth 眼部精华', how: '无名指轻拍眼眶骨', why: '眼周不碰酸，眼霜照常。' },
        { product: 'La Roche-Posay Toleriane Sensitive Fluide', how: '全脸一层', why: '刷完酸直接封层。' },
        { product: '不在货架上的神仙水', how: '拍', why: '测试:不在库' }
    ],
    skips: [{ product: 'Sunday Riley Good Genes', why: '猛酸，先不用。' }], dropped: []
};

let srv = null;
export async function server() { if (!srv) srv = await serve(); return { srv, origin: 'http://127.0.0.1:' + srv.address().port }; }
export function stopServer() { if (srv) srv.close(); srv = null; }

// 开一个新的 Chrome + 页面;seed 之后重载;login=true 时走假 Firebase 登录并认领本机记录
export async function fresh(origin, o = {}) {
    const br = await browser();
    const p = await page(br, origin, { pre: PRE, scheme: o.scheme, width: o.width, height: o.height });
    p.br = br;
    p.done = () => { try { p.send('Page.close'); } catch (e) { } p.close(); br.close(); };
    await p.send('Page.navigate', { url: origin + '/index.html' + (o.hash || '') });
    await p.waitFor(BOOTED, 15000);
    if (o.seed) {
        await p.eval(`__seed.${o.seed}(${o.seedArg || ''});${o.after || ''};return 1`);
        await p.send('Page.reload', {}); await sleep(300);
        await p.waitFor(BOOTED, 8000);
    }
    await p.eval(`window.__AIF=Object.assign({mode:'${o.mode || 'down'}'},${o.aif || '{}'});return 1`);
    if (o.login) {
        // 默认当她已经看过「顾问会看到什么」(自动外发要先看过;o.notice === false 测没看过的情形)
        if (o.notice !== false) await p.eval(`localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test',at:1}));return 1`);
        await p.waitFor('!!(window.fakeCloud && fakeCloud.auth)', 5000);
        await p.eval(`fakeCloud.auth({uid:'u-test',email:'t@example.com',displayName:'Tester Name',getIdToken:async()=>'fake-id-token'});return 1`);
        // 这台设备登录前有记录 → 认领 sheet:点「是我的」
        try { await p.waitFor(`!!document.querySelector('#claim .btn-primary')`, 3000); await p.eval(`document.querySelector('#claim .btn-primary').click();return 1`); } catch (e) { }
        await p.waitFor(`!!(window.__AIF.log||[]).some(x=>x.p==='/api/me') || __AIF.mode!=='on'`, 5000).catch(() => { });
        await sleep(300);
    }
    return p;
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
export const ENV = `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k)).data})()`;
export const TODAY_EN = `((${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(0))||{})`;
export function log(p, path) { return p.eval(`return (__AIF.log||[]).filter(x=>x.p===${JSON.stringify(path)}).length`); }
export { suite, sleep };
// 一个测试文件的骨架:块按顺序跑,每块自己开 / 关 Chrome;块里抛异常记一条失败,继续下一块
export async function run(name, blocks) {
    const S = suite(name);
    const { origin } = await server();
    const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // ONLY=正则:只跑名字对得上的块(排查 / 变异检查用)
    for (const [label, fn] of blocks) {
        if (only && !only.test(label)) continue;
        let p = null;
        try { await fn({ S, origin, open: async o => (p = await fresh(origin, o)) }); }
        catch (e) { S.ok(false, label + ' 抛异常: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); }
        finally { if (p && p.done) p.done(); await sleep(300); }
    }
    stopServer();
    console.log(`\n${S.failed.length ? '✗ ' + S.failed.length + ' 条失败' : '✓ 全部通过'}(${S.res.length} 条)`);
    process.exit(S.failed.length ? 1 : 0);
}
