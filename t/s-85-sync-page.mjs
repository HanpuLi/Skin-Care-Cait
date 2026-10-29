// 同步的整页测试(移植自 Codex 10/14 的 tests/sync-browser.mjs):真页面、真 Web Locks、真刷新,
// Firebase 换成页面里的假替身(登录 / 快照 / 事务都由测试手动控制),外网照旧全掐断。数据全是虚构的。
// 覆盖:离线改动 + 刷新不丢、两个窗口抢锁(第二个一行 App 代码都不跑)、关掉第一个再重试、
//       旧格式数据升级:静默路径 / 冲突 sheet → 稍后再选 → 设置里选 → 恢复副本。
import fs from 'node:fs';
import path from 'node:path';
import { browser, page, sleep } from './harness.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FAKE = `(function(){
  const json = v => JSON.parse(JSON.stringify(v));
  window.fakeCloud = { listeners: [], writes: [], server: null, auth: null,
    emit(data, metadata, exists) {
      metadata = Object.assign({ fromCache: false, hasPendingWrites: false }, metadata || {});
      if (exists === undefined) exists = true;
      if (!metadata.fromCache && !metadata.hasPendingWrites) this.server = exists ? json(data) : null;
      this.listeners[this.listeners.length - 1].fn({ exists, metadata, data: () => json(data) });
    } };
  const db = { collection() { return { doc(uid) { return { uid,
      onSnapshot(o, fn) { fakeCloud.listeners.push({ uid, o, fn }); return () => {}; },
      set() { throw Error('unguarded set'); } }; } }; },
    async runTransaction(cb) {
      let staged = null;
      const res = await cb({ get: async () => ({ exists: !!fakeCloud.server, data: () => json(fakeCloud.server || {}) }), set(ref, d) { staged = json(d); } });
      if (staged) await new Promise((resolve, reject) => fakeCloud.writes.push({ data: staged, resolve() { fakeCloud.server = staged; resolve(); }, reject }));
      return res;
    } };
  window.firebase = { apps: [{}], initializeApp() {}, firestore: () => db,
    auth() { return { currentUser: null, onAuthStateChanged(fn) { fakeCloud.auth = fn; }, signOut() {} }; } };
})();`;
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8') + '\n' + FAKE;
const ready = 'document.readyState==="complete" && typeof renderTn==="function" && !!(window.fakeCloud && fakeCloud.auth)';
const login = uid => `await fakeCloud.auth({uid:'${uid}',email:'${uid}@example.invalid',displayName:'Fic'});await new Promise(r=>setTimeout(r,50));return 1`;

export default async function ({ origin, S }) {
    const CLOUD = { sk_jrnl1: [{ date: '2026-10-10', status: ['稳定'], products: [], note: 'fictional cloud note', phase: '' }],
        sk_profile1: { minimalMode: false, onboarded: true, tour3: true, name: 'Fictional', autoMatched: 'fic-a' } };
    // ── 1. 离线改动 + 刷新 + 两个窗口 ──
    let br = await browser();
    try {
        const a = await page(br, origin, { pre: PRE });
        await a.send('Page.navigate', { url: origin + '/index.html' }); await a.waitFor(ready, 8000);
        await a.eval(`__seed.fresh();return 1`); await a.reload(300); await a.waitFor(ready, 8000);
        await a.eval(login('fic-a'));
        S.ok(await a.eval(`return _syncDoc.rev===0 && fakeCloud.listeners.length===1`), '整页:空设备登录后整条启动 / 渲染链没有产生改动');
        await a.eval(`fakeCloud.emit({},{fromCache:true},false);window.dispatchEvent(new Event('online'));return 1`);
        S.ok(await a.eval(`return _hydrated===false && fakeCloud.writes.length===0`), '整页:离线缓存快照不算数、online 也不会提前推');
        await a.eval(`fakeCloud.emit(${JSON.stringify(CLOUD)});await new Promise(r=>setTimeout(r,80));return 1`);
        const h = await a.eval(`return {note:lg(K.jrnl)[0].note,rev:_syncDoc.rev,writes:fakeCloud.writes.length}`);
        S.ok(h.note === 'fictional cloud note' && h.rev === 0 && h.writes === 0, '整页:服务器快照落地,重绘不产生改动、不推', h);
        await a.eval(`saveOpenDate('fic-prod','2026-10-14');return 1`);
        S.ok(await a.eval(`return _syncDoc.rev===1 && hasPendingSync()`), '整页:用户改一下 → rev 1,等着推');
        await a.reload(300); await a.waitFor(ready, 8000); await a.eval(login('fic-a'));
        await a.eval(`fakeCloud.emit(Object.assign(${JSON.stringify(CLOUD)},{_updatedAt:9999999999999}));await new Promise(r=>setTimeout(r,80));return 1`);
        S.ok(await a.eval(`return lg(K.popen)['fic-prod']==='2026-10-14' && hasPendingSync()`), '整页:没推出去就刷新,重开后云端(时间戳再新)也盖不掉');
        // 第二个窗口
        const b = await page(br, origin, { pre: PRE });
        await b.send('Page.navigate', { url: origin + '/index.html' });
        await b.waitFor(`!!document.getElementById('app-lock') && /关掉另一个窗口再点重试/.test(document.getElementById('app-lock').textContent)`, 8000);
        const blocked = await b.eval(`return {app:typeof handleAuthChange,listeners:fakeCloud.listeners.length,btn:[...document.querySelectorAll('#app-lock button')].map(x=>x.textContent).join()}`);
        S.ok(blocked.app === 'undefined' && blocked.listeners === 0 && blocked.btn === '重试', '整页:第二个窗口拿不到锁 → App 代码一行没跑,提示「关掉另一个窗口再点重试」', blocked);
        await b.eval(`document.querySelector('#app-lock button').click();await new Promise(r=>setTimeout(r,300));return 1`);
        S.ok(await b.eval(`return typeof ls==='undefined' && !!document.getElementById('app-lock')`), '整页:第一个还开着时点重试,照样不让进');
        // 第一个窗口把改动推上去后关掉
        await a.eval(`window.__p=pushToCloud();await new Promise(r=>setTimeout(r,50));fakeCloud.writes[0].resolve();await window.__p;return 1`);
        S.ok(await a.eval(`return !hasPendingSync()`), '整页:第一个窗口推完、确认');
        S.ok(!a.errors.length, '整页:第一个窗口 0 报错', a.errors);
        await Promise.race([a.send('Page.close'), sleep(1500)]); a.close();   // 真的关掉这个页面(锁随之释放)
        await sleep(400);
        await b.eval(`document.querySelector('#app-lock button').click();return 1`);
        await b.waitFor(ready, 8000);
        const after = await b.eval(`return {open:(lg(K.popen)||{})['fic-prod'],pending:hasPendingSync(),lock:!!document.getElementById('app-lock')}`);
        S.ok(after.open === '2026-10-14' && !after.pending && !after.lock, '整页:关掉第一个再点重试 → 打开了,读到的是最新确认过的那份', after);
        await b.waitFor(`typeof aiOnAuth==='function'`, 4000).catch(() => { });
        S.ok(await b.eval(`return typeof aiOnAuth==='function' && typeof renderCoach==='function'`), '整页:App 跑起来之后 ai.js 也加载了');
        S.ok(!b.errors.length, '整页:第二个窗口 0 报错', b.errors);
        b.close();
    } finally { br.close(); }

    // ── 2. 旧格式数据升级:两边都改了 → sheet;稍后再选 → 设置里选;恢复副本 ──
    br = await browser();
    try {
        const p = await page(br, origin, { pre: PRE });
        await p.send('Page.navigate', { url: origin + '/index.html' }); await p.waitFor(ready, 8000);
        await p.eval(`__seed.full();localStorage.setItem('sk_uid','fic-a');localStorage.setItem('sk_lastpush','500');return 1`);
        await p.reload(300); await p.waitFor(ready, 8000); await p.eval(login('fic-a'));
        await p.eval(`fakeCloud.emit(Object.assign(${JSON.stringify(CLOUD)},{_updatedAt:900}));await new Promise(r=>setTimeout(r,120));return 1`);
        const c = await p.eval(`const ov=document.getElementById('sync-conflict');return {open:!!ov,text:ov&&ov.querySelector('.sheet-b').textContent,btns:ov?[...ov.querySelectorAll('.sheet-actions .btn')].map(b=>b.textContent):[],x:ov&&!!ov.querySelector('.sheet-x'),writes:fakeCloud.writes.length}`);
        S.ok(c.open && c.btns.join('|') === '用这台设备的|用云端的|稍后再选' && !c.x && c.writes === 0, '升级整页:旧数据和云端两边都有对方没有的 → App 自己的 sheet(不是原生弹窗),三个选项,没推', c);
        S.ok(/升级后第一次同步/.test(c.text) && /这台设备：\d+ 天的记录/.test(c.text) && /云端：1 天的记录/.test(c.text), '升级整页:sheet 里说清楚为什么、两边各有什么', c.text);
        S.ok(!p.dialogs.length, '升级整页:没有原生 confirm / alert', p.dialogs);
        await p.eval(`[...document.querySelectorAll('#sync-conflict .btn')].find(b=>b.textContent==='稍后再选').click();await new Promise(r=>setTimeout(r,80));return 1`);
        const later = await p.eval(`openSettings();await new Promise(r=>setTimeout(r,150));const nb=document.getElementById('net-badge');const ch=document.getElementById('sync-choose');
            return {badge:nb.hidden?'':nb.textContent,line:document.getElementById('sync-line').textContent,choose:ch&&!ch.hidden,n:lg(K.jrnl).length,writes:fakeCloud.writes.length}`);
        S.ok(later.badge === '同步暂停 · 去设置里选' && later.choose && /同步先停着/.test(later.line) && later.n > 1 && later.writes === 0, '稍后再选:头部小标「同步暂停」、设置里有「选一份记录」,本机记录照旧', later);
        // 设置里的 sheet 也要过美学验收
        const probe = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
        await p.eval(probe + ';return 1');
        const pr = await p.eval(`return __probe()`);
        S.ok(!pr.emoji.length && !pr.styleAttrs.length && !pr.smallN, '设置(同步暂停时):0 emoji、没有 style=、按钮都 ≥44', { emoji: pr.emoji, style: pr.styleAttrs, small: pr.small });
        await p.eval(`document.getElementById('settings-sheet').hidden=true;document.getElementById('sync-choose').click();await new Promise(r=>setTimeout(r,80));
            [...document.querySelectorAll('#sync-conflict .btn')].find(b=>b.textContent==='用云端的').click();await new Promise(r=>setTimeout(r,150));return 1`);
        const chosen = await p.eval(`return {note:lg(K.jrnl)[0].note,n:lg(K.jrnl).length,conflict:!!_syncConflict,legacy:_syncDoc.legacy,badge:document.getElementById('net-badge').hidden}`);
        S.ok(chosen.note === 'fictional cloud note' && chosen.n === 1 && !chosen.conflict && !chosen.legacy && chosen.badge, '设置里点「选一份记录」→ 用云端的:整份换成云端,小标消失', chosen);
        await p.eval(`showSyncRecovery();await new Promise(r=>setTimeout(r,120));return 1`);
        const rec = await p.eval(`const ov=document.getElementById('sync-recovery');return {secs:[...ov.querySelectorAll('.sheet-sec .sec-t')].map(x=>x.textContent),btns:[...ov.querySelectorAll('.sheet-sec .btn')].map(x=>x.textContent)}`);
        S.ok(rec.secs.some(s => /选之前这台设备的/.test(s)) && rec.secs.some(s => /升级前这台设备的/.test(s)) && rec.btns.includes('下载') && rec.btns.includes('换成这份'), '恢复副本:本机那份(升级前 / 选之前)都在,能下载、能换回去', rec);
        await p.eval(probe + ';return 1');
        const pr2 = await p.eval(`return __probe()`);
        S.ok(!pr2.emoji.length && !pr2.styleAttrs.length && !pr2.smallN, '恢复副本 sheet:0 emoji、没有 style=、按钮都 ≥44', { emoji: pr2.emoji, style: pr2.styleAttrs, small: pr2.small });
        const back = await p.eval(`const i=_recoveryList.findIndex(c=>c.reason==='before-sync-upgrade');restoreSyncCopy(i);await new Promise(r=>setTimeout(r,60));
            const ovs=document.querySelectorAll('#sheet-root .sheet-ov');[...ovs[ovs.length-1].querySelectorAll('.sheet-actions .btn')].find(b=>b.textContent==='换成这份').click();await new Promise(r=>setTimeout(r,150));
            return {n:lg(K.jrnl).length,pending:hasPendingSync()}`);
        S.ok(back.n > 1 && back.pending, '「换成这份」:升级前的本机记录回来了,算一次改动等着推', back);
        S.ok(!p.errors.length, '升级整页 0 报错', p.errors);
        p.close();
    } finally { br.close(); }

    // ── 3. 旧格式数据升级的静默路径:云端自从这台设备上次推送后没变 → 不弹,直接传 ──
    br = await browser();
    try {
        const p = await page(br, origin, { pre: PRE });
        await p.send('Page.navigate', { url: origin + '/index.html' }); await p.waitFor(ready, 8000);
        await p.eval(`__seed.minimal();localStorage.setItem('sk_uid','fic-c');localStorage.setItem('sk_lastpush','1000');return 1`);
        await p.reload(300); await p.waitFor(ready, 8000); await p.eval(login('fic-c'));
        await p.eval(`fakeCloud.emit({sk_jrnl1:[],sk_profile1:{minimalMode:true,onboarded:true,tour3:true},_updatedAt:1000});await new Promise(r=>setTimeout(r,2400));return 1`);
        const q = await p.eval(`return {sheet:!!document.getElementById('sync-conflict'),writes:fakeCloud.writes.length,legacy:_syncDoc.legacy,n:(fakeCloud.writes[0]&&fakeCloud.writes[0].data.sk_jrnl1||[]).length}`);
        S.ok(!q.sheet && q.writes === 1 && !q.legacy && q.n >= 13, '升级静默:云端 _updatedAt 没超过本机上次推送 → 不弹,本机这份直接传上去', q);
        S.ok(!p.errors.length && !p.dialogs.length, '升级静默 0 报错、0 原生弹窗', p.errors.concat(p.dialogs));
        p.close();
    } finally { br.close(); }
}
