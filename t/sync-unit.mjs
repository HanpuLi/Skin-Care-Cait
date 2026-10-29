// 同步信封的逻辑测试(移植自 Codex 10/14 的 tests/sync-state.test.mjs,按 10/29 新代码重写)。
// 不开浏览器:把 index.html 里**真的**存储 / 同步函数原样抽出来放进 vm 跑,Firestore / DOM / 计时器用确定性的假替身。
// 这里不重新实现任何同步算法。数据全是虚构的。
//   直接跑:  node t/sync-unit.mjs        (CI 里 npm run test:sync 就是它;不需要 Chrome)
//   随全量:  node t/run.mjs sync         (t/s-80-sync.mjs 调这里)
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const json = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('找不到代码段: ' + a); return html.slice(i, j); }
function fn(name) {
    const re = new RegExp('^        (?:async )?function ' + name + '\\(', 'm');
    const start = html.search(re); if (start < 0) throw new Error('找不到函数 ' + name);
    const lineEnd = html.indexOf('\n', start);
    if (html.slice(start, lineEnd).trim().endsWith('}')) return html.slice(start, lineEnd);
    return html.slice(start, html.indexOf('\n        }\n', lineEnd) + 10);
}
const STORAGE = between('        let _applyingCloud = false;', '        function esc(s)');
const SYNC = between('        // ══ Firebase 云同步(信封版)', '        function signInGoogle()');
const EXTRA = ['flushPendingPush', 'saveProfile', 'absorbPrescribedHistory', 'initTN', 'syncLineText'].map(fn).join('\n');
const BOOT = between('        let _appLockStarted', '    </script>');

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function envelope(uid, data = {}, rev = 0, ack = rev, base = data) {
    return { sk_uid: uid, ['sk_sync_v1:' + encodeURIComponent(uid)]: JSON.stringify({ version: 1, uid, rev, ack, base: base === null ? null : '__HASH__', sent: [], legacy: false, data, __base: base }) };
}

function harness(seed = {}, opts = {}) {
    const values = new Map(Object.entries(seed)), timers = new Map(), listeners = [], writes = [], statuses = [], sheets = new Map(), toasts = [];
    const remote = new Map();
    let timerId = 0, fail = () => false, today = opts.today || '2026-10-29', retryWith = null, autoWrite = !!opts.autoWrite, renders = 0;
    const node = () => ({ textContent: '', hidden: false, classList: { add() { }, remove() { } } });
    const nodes = new Map();
    const localStorage = {
        get length() { return values.size; }, key(i) { return [...values.keys()][i] ?? null; },
        getItem(k) { return values.has(k) ? values.get(k) : null; },
        setItem(k, v) { if (fail(k, v)) throw Object.assign(Error('quota'), { name: 'QuotaExceededError' }); values.set(k, String(v)); },
        removeItem(k) { values.delete(k); }
    };
    const db = {
        collection(name) { if (name !== 'users') throw Error('bad collection'); return { doc(uid) { return { uid,
            onSnapshot(options, cb, err) { const l = { uid, options, cb, err }; listeners.push(l); return () => { l.off = true; }; },
            set() { throw Error('不经事务的 set 不允许'); } }; } }; },
        async runTransaction(cb) {
            for (let attempt = 0; ; attempt++) {
                let staged = null, uid = null;
                const tx = { async get(ref) { uid = ref.uid; const d = remote.get(ref.uid); return { exists: d !== undefined, data: () => json(d || {}) }; },
                    set(ref, data, o) { staged = { uid: ref.uid, data: json(data), options: o }; } };
                const result = await cb(tx);
                if (retryWith && attempt === 0) { remote.set(uid, json(retryWith)); retryWith = null; continue; }   // 模拟并发:Firestore 重跑回调
                if (staged) { const d = deferred(); writes.push(Object.assign(staged, { request: d })); if (autoWrite) d.resolve(); await d.promise; remote.set(staged.uid, staged.data); }
                return result;
            }
        }
    };
    const ctx = vm.createContext({
        localStorage, JSON, Date, Math, Error, Number, String, Object, Array, Promise, Set, Map, isNaN, encodeURIComponent, decodeURIComponent,
        console: { warn() { }, log() { } },
        navigator: { onLine: true },
        document: {
            getElementById(id) { if (sheets.has(id)) return sheets.get(id); if (['sync-conflict', 'claim', 'sync-recovery'].includes(id)) return null; if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
            addEventListener() { }, createElement: node
        },
        window: { addEventListener(n, f) { (ctx.__events[n] = ctx.__events[n] || []).push(f); } },
        __events: {},
        atob: s => Buffer.from(s, 'base64').toString(),
        setTimeout(f, ms) { const id = ++timerId; timers.set(id, { f, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
        today: () => today, localD: d => d.toISOString().slice(0, 10),
        K: { wk: 'sk_wk1', jrnl: 'sk_jrnl1', prods: 'sk_prods1', popen: 'sk_popen1', tn: 'sk_tn1', tnsteps: 'sk_tnsteps1', profile: 'sk_profile1', planday: 'sk_planday1', gone: 'sk_gone1', empty: 'sk_empty1', low: 'sk_low1', regimen: 'sk_regimen1', prodDefs: 'sk_proddefs1', mig: 'sk_mig1' },
        getDayState: () => ({ shower: false, shave: false }), loadPD: () => [], invalidatePlanCache() { }, applyProfileVisibility() { }, syncSettingsUI() { }, renderAuthBtn() { },
        initPhotoDB(cb) { cb(); }, needsOOBE: () => false, startOOBE() { }, oobeNext() { }, hasLegacyData: () => true,
        esc: s => String(s), toast(m) { toasts.push(m); }, sysAlert(m) { toasts.push(m); }, sysConfirm(m, ok) { ok(); },
        openSheet(o) { sheets.set(o.id, Object.assign({ textContent: o.text || '' }, o)); }, closeSheet(id) { sheets.delete(id); },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } }, Blob: class { },
    });
    ctx.run = src => vm.runInContext(src, ctx);
    ctx.run('var _idb = null, _oobe = null; let PROFILE = { minimalMode: false }, PD = [], PS = {}, POPEN = {}, GONE = [], EMPTIES = {}, LOW = [], TN = {};');
    // 种子里的 '__HASH__' 换成真指纹(哈希函数在 App 代码里,先借它算一下)
    const hashCtx = vm.createContext({ JSON, Math, Number, String, Object, Array });
    vm.runInContext(fn('_stableStr') + '\n' + fn('syncHash'), hashCtx);
    for (const [k, v] of values) if (k.startsWith('sk_sync_v1:') && v.includes('__HASH__')) {
        const d = JSON.parse(v); d.base = vm.runInContext('syncHash(' + JSON.stringify(d.__base) + ')', hashCtx); delete d.__base; values.set(k, JSON.stringify(d));
    }
    ctx.run(STORAGE); ctx.run(EXTRA); ctx.run(SYNC);
    ctx.run('function renderAll() { PROFILE = lg(K.profile) || PROFILE; __render(); }');
    ctx.__render = () => { renders++; if (ctx.onRender) ctx.onRender(); };
    ctx.showSyncStatusSpy = statuses;
    ctx.__db = db; ctx.run('_db = __db;');
    const H = {
        ctx, values, timers, listeners, writes, statuses, sheets, toasts, remote, run: ctx.run,
        get renders() { return renders; },
        state() { return json(ctx.run('_syncDoc')); }, data(k) { return json(ctx.run('lg(' + JSON.stringify(k) + ')')); },
        ls(k, v, o) { return ctx.run(`ls(${JSON.stringify(k)}, ${JSON.stringify(v)}${o ? ', ' + JSON.stringify(o) : ''})`); },
        pending() { return ctx.run('hasPendingSync()'); },
        fail(f) { fail = f; }, setToday(v) { today = v; }, retry(d) { retryWith = d; }, auto(v) { autoWrite = v; }, server(uid, d) { remote.set(uid, json(d)); },
        async login(uid, email) { await ctx.run('handleAuthChange(' + JSON.stringify(uid ? { uid, email: email || uid + '@example.invalid' } : null) + ')'); await flush(); },
        emit(data = {}, metadata = {}, exists = true, idx = listeners.length - 1) {
            const l = listeners[idx];
            if (!metadata.fromCache && !metadata.hasPendingWrites) { if (exists) remote.set(l.uid, json(data)); else remote.delete(l.uid); }
            l.cb({ exists, metadata: Object.assign({ fromCache: false, hasPendingWrites: false }, metadata), data: () => json(data) });
        },
        emitServer(uid) { const d = remote.get(uid); H.emit(d || {}, {}, d !== undefined); },
        async fire(ms) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.f(); } await flush(); await flush(); },
        timerMs() { return [...timers.values()].map(t => t.ms).sort((a, b) => a - b); },
        async push() { const p = ctx.run('pushToCloud()'); await flush(); return p; },
        recovery() { return json(ctx.run('syncRecoveryCopies()')); },
        async click(sheet, label) { const s = sheets.get(sheet); const a = s && s.actions.find(x => x.label === label); if (!a) throw Error('没有按钮 ' + label); sheets.delete(sheet); if (a.fn) a.fn(); await flush(); },
        restart(o) { return harness(Object.fromEntries(values), Object.assign({ today }, o || {})); }
    };
    return H;
}

const OLD = [{ date: '2026-10-27', status: ['稳定'], products: [], note: 'cloud-old' }];
const EDIT = [{ date: '2026-10-28', status: ['闭口'], products: ['虚构酸'], note: 'offline-new' }];

export async function runSyncUnit(S) {
    const T = async (name, f) => { try { await f(); } catch (e) { S.ok(false, name + ':抛异常 ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); } };

    // ── 离线改动保留 + 关页恢复:任何 _updatedAt 的云端都盖不掉没确认的改动 ──
    for (const cloudAt of [0, 100, 9999999999999]) await T('离线改动 cloudAt=' + cloudAt, async () => {
        const h = harness(envelope('a', { sk_jrnl1: OLD }));
        h.ls('sk_jrnl1', EDIT);
        S.ok(h.state().rev === 1 && h.timers.size === 0, `离线改一下:rev=1,没登录不排推送 (cloudAt=${cloudAt})`, h.state());
        const r = h.restart(); await r.login('a');
        r.emit({ sk_jrnl1: OLD, _updatedAt: cloudAt });
        S.ok(r.data('sk_jrnl1')[0].note === 'offline-new' && r.state().ack === 0, `关页重开:云端(_updatedAt=${cloudAt})盖不掉没确认的改动`, r.data('sk_jrnl1'));
        await r.fire(2000);
        S.ok(r.writes.length === 1 && r.writes[0].data.sk_jrnl1[0].note === 'offline-new', `重开后接着推上去 (cloudAt=${cloudAt})`, r.writes.length);
    });

    await T('等服务器快照', async () => {
        const h = harness(); h.ls('sk_profile1', { name: 'default' }, 'system'); await h.login('a');
        S.ok(h.writes.length === 0 && h.state().rev === 0 && h.listeners[0].options.includeMetadataChanges === true, '空设备登录:启动默认值不算改动、不推送,监听带 includeMetadataChanges');
        h.ctx.__events.online.forEach(f => f()); await h.fire(2000);
        h.emit({}, { fromCache: true }, false); h.emit({ sk_jrnl1: OLD }, { hasPendingWrites: true });
        S.ok(h.ctx.run('_hydrated') === false && h.writes.length === 0, '离线缓存 / 本机回声的快照不算水合,不会拿它初始化账号');
        h.emit({ sk_jrnl1: OLD, sk_profile1: { name: 'from-cloud' } });
        S.ok(h.data('sk_jrnl1')[0].note === 'cloud-old' && h.data('sk_profile1').name === 'from-cloud' && h.state().rev === 0 && h.writes.length === 0,
            '服务器快照到了才落地;启动时的默认档案没有盖掉云端已有账号', h.data('sk_profile1'));
    });

    await T('新账号 + 回声', async () => {
        const h = harness(); await h.login('a', 'caitlye@gmail.com'); h.emit({}, {}, false);
        S.ok(h.data('sk_profile1').autoMatched === 'a' && h.state().rev === 0, '新的主账号:autoMatch 只落盘(system),不算改动', h.state());
        h.ctx.onRender = () => h.run("ls('sk_mig1',['m1']); ls('sk_regimen1',[{v:2}],'system');");
        h.emit(Object.assign({}, h.state().data, { sk_cd1: 'x' })); h.emit(h.remote.get('a')); h.ctx.onRender = null;
        h.ctx.__events.online.forEach(f => f()); await h.fire(2000);
        S.ok(h.state().rev === 0 && h.writes.length === 0, '云端落地重绘期间的自动写盘(迁移 / 方案)不推回去,反复快照也不对推', { rev: h.state().rev, w: h.writes.length });
        const r0 = h.renders; h.emit(h.remote.get('a'));
        S.ok(h.renders === r0, '内容没变的快照不重绘');
    });

    await T('键序', async () => {
        const h = harness(envelope('a', { sk_prods1: { a: 1, b: { c: 2, d: 3 } } }));
        h.ls('sk_prods1', { b: { d: 3, c: 2 }, a: 1 }); const r1 = h.state().rev;
        h.ls('sk_prods1', { a: 2, b: { c: 2, d: 3 } }); h.ls('sk_prods1', { b: { d: 3, c: 2 }, a: 2 });
        S.ok(r1 === 0 && h.state().rev === 1, '键序不同的同一份不算改动(_stableStr);真改了才 +1', h.state().rev);
    });

    await T('只确认推出去的那一版', async () => {
        const h = harness(envelope('a', { sk_jrnl1: OLD })); await h.login('a'); h.emit({ sk_jrnl1: OLD });
        h.ls('sk_jrnl1', EDIT); const first = h.push(); await flush();
        h.ls('sk_jrnl1', [{ date: '2026-10-29', note: 'during-upload' }]);
        h.writes[0].request.resolve(); await first;
        S.ok(h.state().ack === 1 && h.state().rev === 2, '推送途中又改了:只确认推出去的 rev 1,rev 2 还挂着', h.state());
        await h.fire(1500); h.writes[1].request.resolve(); await flush();
        S.ok(h.state().ack === 2 && !h.pending(), '新改动接着推,确认到 rev 2');
        h.emitServer('a'); await h.fire(2000);
        S.ok(h.writes.length === 2, '自己的回声不再推');
        S.ok(h.writes[0].options === undefined, '整份替换写入(不用 merge)', h.writes[0].options);
    });

    await T('失败退避 + 超时 + 关页', async () => {
        const h = harness(envelope('a', { sk_jrnl1: EDIT }, 1, 0, { sk_jrnl1: OLD })); await h.login('a'); h.emit({ sk_jrnl1: OLD });
        const p1 = h.push(); await flush(); h.writes[0].request.reject(Error('offline')); await p1;
        S.ok(h.state().ack === 0 && h.pending() && h.timerMs().includes(4000), '推送失败:改动还挂着,4 秒后重试', h.timerMs());
        h.ls('sk_cd1', 'edit-while-offline');
        S.ok(h.timerMs().join() === '4000', '退避中再改:不每改一下就撞一次网络', h.timerMs());
        await h.fire(4000); h.writes[1].request.reject(Error('offline')); await flush(); await flush();
        S.ok(h.timerMs().includes(8000), '再失败:退避加倍到 8 秒', h.timerMs());
        h.ctx.__events.online.forEach(f => f()); await flush();
        S.ok(h.writes.length === 3, '网络回来(online):立刻补推,不等退避', h.writes.length);
        // 超时:15 秒没回 → 当失败;它后来又写成了
        await h.fire(15000);
        S.ok(h.state().ack === 0 && h.pending(), '15 秒超时:不算确认', h.state());
        h.writes[2].request.resolve(); await flush();
        S.ok(h.state().ack === 0, '超时后才落地的成功不会偷偷确认');
        h.ls('sk_cd1', 'newer-after-timeout');
        h.emitServer('a'); await flush();
        S.ok(!h.ctx.run('_syncConflict') && h.state().ack >= 1, '云端是自己超时那次写的:认得是自己,不弹冲突,确认那一版', h.state());
        await h.fire(4000); await h.fire(2000); await h.fire(1500);
        const last = h.writes[h.writes.length - 1]; last && last.request.resolve(); await flush(); await flush();
        S.ok(!h.pending() && h.remote.get('a').sk_cd1 === 'newer-after-timeout', '之后的新改动照样推上去', h.state());
        // 关页冲刷
        h.ls('sk_cd1', 'before-pagehide'); const n = h.writes.length;
        h.run('flushPendingPush()'); await flush();
        S.ok(h.writes.length === n + 1, 'pagehide:不等 2 秒防抖,立刻推', h.writes.length - n);
        const r = h.restart(); S.ok(r.pending(), '冲刷没等到确认就关了:重开时改动还在、还挂着');
    });

    for (const outcome of ['resolve', 'reject']) await T('换账号 ' + outcome, async () => {
        const h = harness(envelope('a', { sk_jrnl1: EDIT }, 1, 0, { sk_jrnl1: OLD })); await h.login('a'); h.emit({ sk_jrnl1: OLD });
        const req = h.push(); await flush(); await h.login(null); await h.login('b');
        h.emit({ sk_jrnl1: [{ date: '2026-10-01', note: 'b-only' }] });
        const before = h.state();
        h.writes[0].request[outcome](outcome === 'reject' ? Error('late') : undefined); await req;
        h.emit({ sk_jrnl1: [{ note: 'late-a' }] }, {}, true, 0);
        S.ok(JSON.stringify(h.state()) === JSON.stringify(before) && h.data('sk_jrnl1')[0].note === 'b-only', `A 的推送晚到(${outcome})、A 的快照晚到:都碰不到 B`, h.data('sk_jrnl1'));
        S.ok(JSON.parse(h.values.get('sk_sync_v1:a')).ack === 0, 'A 的信封原样留着,改动还没确认');
        await h.login('a');
        S.ok(h.data('sk_jrnl1')[0].note === 'offline-new' && h.pending(), '换回 A:A 没传上去的改动还在,接着推');
    });

    await T('不归属的数据', async () => {
        const seed = { sk_jrnl1: JSON.stringify(EDIT) };
        const h = harness(seed); const p = h.login('b'); await flush();
        S.ok(h.sheets.has('claim') && /是你的吗/.test(h.sheets.get('claim').title), '登录前有真记录:用 App 的 sheet 问「这些记录是你的吗」(不是原生 confirm)');
        await h.click('claim', '不是我的'); await p;
        h.emit({ sk_jrnl1: [{ date: '2026-10-02', note: 'b' }] });
        S.ok(h.data('sk_jrnl1')[0].note === 'b' && JSON.parse(h.values.get('sk_sync_v1:')).data.sk_jrnl1[0].note === 'offline-new' && h.writes.length === 0,
            '「不是我的」:B 只看到自己云端的,那份原样放在一边,没推给 B');
        const y = harness(seed); const p2 = y.login('b'); await flush(); await y.click('claim', '是我的'); await p2;
        y.emit({}, {}, false); await y.fire(2000);
        S.ok(y.writes.length === 1 && y.writes[0].data.sk_jrnl1[0].note === 'offline-new' && !y.values.has('sk_sync_v1:'), '「是我的」+ 新账号(云端空):直接归过去、传上去');
        const w = harness({ sk_profile1: JSON.stringify({ minimalMode: true, oobe: { step: 'mode' } }) }); await w.login('c');
        S.ok(!w.sheets.has('claim'), '只点过设置 / 引导、没有真记录:不问');
        w.emit({ sk_jrnl1: OLD, sk_profile1: { name: 'cloud-c' } });
        S.ok(w.data('sk_profile1').name === 'cloud-c' && !w.ctx.run('_syncConflict') && w.writes.length === 0, '……云端已有这个账号:悄悄用云端,不弹选择', w.data('sk_profile1'));
        const w2 = harness({ sk_profile1: JSON.stringify({ minimalMode: true, oobe: { step: 'mode' } }) }); await w2.login('d'); w2.emit({}, {}, false); await w2.fire(2000);
        S.ok(w2.writes.length === 1 && w2.writes[0].data.sk_profile1.oobe.step === 'mode', '……新账号:引导里选的带过去');
    });

    await T('身份写失败', async () => {
        const h = harness(envelope('a', { sk_jrnl1: EDIT }, 1, 0, { sk_jrnl1: OLD })); h.fail(k => k === 'sk_uid'); await h.login('b');
        S.ok(h.ctx.run('_syncOwner') === 'a' && h.ctx.run('_user') === null && h.state().uid === 'a', '记身份失败:不切换,A 的信封不会挂到 B 名下');
        h.fail(() => false); await h.login('b'); h.emit({ sk_jrnl1: [{ note: 'b' }] });
        S.ok(h.state().uid === 'b' && h.data('sk_jrnl1')[0].note === 'b', '好了以后再登录:正常切到 B');
    });

    await T('存不进去', async () => {
        const h = harness(envelope('a', { sk_jrnl1: OLD })); h.fail(k => k === 'sk_sync_v1:a');
        let threw = false; try { h.ls('sk_jrnl1', EDIT); } catch (e) { threw = true; }
        S.ok(threw && h.data('sk_jrnl1')[0].note === 'cloud-old' && h.state().rev === 0 && /存不进去/.test(h.ctx.document.getElementById('sync-toast-el').textContent),
            '信封写失败:用户操作抛出(调用方不会显示存好了),数据和 rev 都没动,有提示');
        h.fail(() => false); h.ls('sk_jrnl1', EDIT); S.ok(h.state().rev === 1, '腾出空间后照常保存');
        const m = harness(envelope('a', { sk_jrnl1: OLD })); m.fail(k => k === 'sk_jrnl1'); m.ls('sk_jrnl1', EDIT);
        const r = m.restart(); S.ok(r.data('sk_jrnl1')[0].note === 'offline-new' && r.state().rev === 1, '镜像写失败:正本在信封里,重开不丢');
        const a = harness(envelope('a', { sk_jrnl1: EDIT }, 1, 0, { sk_jrnl1: OLD })); await a.login('a'); a.emit({ sk_jrnl1: OLD });
        const p = a.push(); await flush(); a.fail(k => k === 'sk_sync_v1:a'); a.writes[0].request.resolve(); await p;
        S.ok(JSON.parse(a.values.get('sk_sync_v1:a')).ack === 0 && !a.statuses.some(s => s === '已同步'), '确认写不进本机:改动照旧算没确认(下次再推,云端是同一份会直接认)');
    });

    // ── 旧格式数据升级(Cait / Cici 手机上现在的样子):静默 / 弹窗的判断 ──
    const legacy = (data, lastPush) => Object.assign({ sk_uid: 'a' }, lastPush ? { sk_lastpush: String(lastPush) } : {}, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)])));
    await T('升级 L1', async () => {
        const h = harness(legacy({ sk_jrnl1: OLD }, 500)); await h.login('a');
        h.emit({ sk_jrnl1: OLD, sk_profile1: { name: 'only-in-cloud' }, _updatedAt: 900 }); await h.fire(2000);
        S.ok(!h.state().legacy && !h.ctx.run('_syncConflict') && h.data('sk_profile1').name === 'only-in-cloud' && h.writes.length === 0,
            '升级 L1:本机有的都和云端一样 → 静默,补上云端多的键,不推', h.state());
    });
    await T('升级 L2', async () => {
        const h = harness(legacy({ sk_jrnl1: EDIT }, 0)); await h.login('a'); h.emit({}, {}, false); await h.fire(2000);
        S.ok(h.writes.length === 1 && !h.ctx.run('_syncConflict'), '升级 L2:云端空 → 静默把本机这份传上去');
    });
    await T('升级 L4', async () => {
        const h = harness(legacy({ sk_jrnl1: EDIT, sk_cd1: 'local-only' }, 1000)); await h.login('a');
        h.emit({ sk_jrnl1: OLD, sk_regimen1: [{ v: 3 }], _updatedAt: 1000 }); await h.fire(2000);
        S.ok(!h.ctx.run('_syncConflict') && h.writes.length === 1 && h.writes[0].data.sk_jrnl1[0].note === 'offline-new' && h.data('sk_regimen1')[0].v === 3,
            '升级 L4:云端 _updatedAt <= 本机 sk_lastpush(云端从上次推送后没变)→ 静默用本机、补上本机缺的键、传上去', h.writes[0] && h.writes[0].data);
        S.ok(h.recovery().some(c => c.reason === 'cloud-before-upgrade') && h.recovery().some(c => c.reason === 'before-sync-upgrade'), '……升级前本机那份、当时云端那份都另存了');
    });
    await T('升级 L5 静默', async () => {
        const stale = [{ date: '2026-10-20', status: ['稳定'], products: [], note: '' }];
        const cloudJ = [{ date: '2026-10-21', status: ['好转'], products: [], note: '' }, { date: '2026-10-20', status: ['稳定', '出油'], products: ['x'], note: '' }];
        const h = harness(legacy({ sk_jrnl1: stale, sk_tn1: { date: '2026-10-20' }, sk_prods1: { a: 'owned' } }, 500)); await h.login('a');
        h.emit({ sk_jrnl1: cloudJ, sk_tn1: { date: '2026-10-29' }, sk_prods1: { a: 'active' }, _updatedAt: 900 }); await h.fire(2000);
        S.ok(!h.ctx.run('_syncConflict') && h.data('sk_jrnl1').length === 2 && h.writes.length === 0 && !h.sheets.has('sync-conflict'),
            '升级 L5:云端变过、本机只是旧(记录都在云端里)→ 静默用云端,不弹', h.data('sk_jrnl1'));
        S.ok(h.recovery().some(c => c.data.sk_prods1 && c.data.sk_prods1.a === 'owned'), '……本机那份另存了恢复副本');
    });
    await T('升级 L5 冲突', async () => {
        const h = harness(legacy({ sk_jrnl1: EDIT }, 500)); h.ls('sk_mig1', ['automatic'], 'system'); await h.login('a');
        h.emit({ sk_jrnl1: OLD, _updatedAt: 900 }); await h.fire(2000);
        S.ok(h.ctx.run('_syncConflict !== null') && h.sheets.has('sync-conflict') && h.writes.length === 0 && h.data('sk_jrnl1')[0].note === 'offline-new',
            '升级 L5:云端变过、本机有云端没有的记录 → 暂停同步、弹 sheet 让她选,没写云端,本机没动');
        const sh = h.sheets.get('sync-conflict');
        S.ok(sh.actions.map(a => a.label).join('|') === '用这台设备的|用云端的|稍后再选' && /升级后第一次同步/.test(sh.text) && /恢复副本/.test(sh.text), '冲突 sheet 的按钮和文案', sh.text);
        const rc = h.recovery();
        S.ok(rc.some(c => c.reason === 'local-before-choice') && rc.some(c => c.reason === 'cloud-before-choice'), '选之前两份都另存了恢复副本', rc.map(c => c.reason));
        await h.click('sync-conflict', '稍后再选');
        h.ls('sk_cd1', 'still-saving'); await h.fire(2000);
        S.ok(h.ctx.run('_syncConflict !== null') && h.writes.length === 0 && h.data('sk_cd1') === 'still-saving' && h.pending() && h.toasts.some(t => /先不同步/.test(t)),
            '「稍后再选」:同步停着,本机照常存,不推');
        h.emit({ sk_jrnl1: OLD.concat([{ date: '2026-10-29', status: ['好转'], products: [], note: 'latest' }]), _updatedAt: 950 });
        S.ok(!h.sheets.has('sync-conflict') && h.ctx.run('_syncConflict.cloud.sk_jrnl1.length') === 2, '点过稍后再选:云端又变了只更新候选,不追着弹');
        h.run('showSyncConflict()');
        S.ok(/云端：2 天的记录/.test(h.sheets.get('sync-conflict').text), '再打开时摘要是最新的云端', h.sheets.get('sync-conflict').text);
        await h.click('sync-conflict', '用云端的');
        S.ok(h.data('sk_jrnl1').length === 2 && !h.state().legacy && !h.ctx.run('_syncConflict') && h.writes.length === 0, '选云端:整份换成云端的,不推');
        S.ok(h.recovery().some(c => c.data.sk_jrnl1 && c.data.sk_jrnl1[0].note === 'offline-new'), '……本机那份还在恢复副本里');
    });
    await T('选本机', async () => {
        const h = harness(legacy({ sk_jrnl1: EDIT }, 0)); await h.login('a');
        h.fail(k => k.startsWith('sk_sync_recovery:')); h.emit({ sk_jrnl1: OLD, sk_regimen1: [{ v: 7 }], _updatedAt: 900 });
        await h.click('sync-conflict', '用云端的');
        S.ok(h.data('sk_jrnl1')[0].note === 'offline-new' && h.ctx.run('_syncConflict !== null'), '恢复副本存不上:不让选(选了就回不去)');
        h.fail(() => false); closeAll(h); h.run("resolveSyncConflict('local','a',_syncSession)"); await h.fire(2000);
        S.ok(h.writes.length === 1 && h.writes[0].data.sk_jrnl1[0].note === 'offline-new', '选本机:带着「云端还是我看到的那份」的检查推上去');
        S.ok(h.writes[0].data.sk_regimen1 && h.writes[0].data.sk_regimen1[0].v === 7, '选本机:只有云端有的键补进来,不顺手删掉', h.writes[0].data);
        h.writes[0].request.resolve(); await flush();
        S.ok(!h.pending() && !h.restart().state().legacy, '确认后不再是旧版数据');
    });
    await T('更早的旧键', async () => {
        const h = harness({ sk_uid: 'a', sc_jrnl2: JSON.stringify(EDIT) }); await h.login('a');
        S.ok(h.state().legacy && h.data('sk_jrnl1')[0].note === 'offline-new' && h.writes.length === 0, 'sc_jrnl2 这类更早的旧键也收进升级判断');
    });

    await T('别处改过', async () => {
        const base = { sk_jrnl1: OLD, sk_prods1: { x: 'old' } };
        const h = harness(envelope('a', base)); h.ls('sk_jrnl1', EDIT); await h.login('a');
        h.emit(Object.assign({}, base, { sk_prods1: { x: 'changed-elsewhere' } }));
        S.ok(h.writes.length === 0 && h.ctx.run('_syncConflict.reason') === 'remote' && h.data('sk_jrnl1')[0].note === 'offline-new' && /别的设备改过/.test(h.sheets.get('sync-conflict').text),
            '本机有没传的改动、云端也被别处改过:暂停让她选,不盖云端也不盖本机');
        S.ok(h.recovery().some(c => c.data.sk_prods1 && c.data.sk_prods1.x === 'changed-elsewhere'), '云端那份另存了');
        h.emit(h.state().data);
        S.ok(!h.ctx.run('_syncConflict') && !h.pending(), '两边后来变成同一份:自己解开,不用选');
    });
    await T('事务比对', async () => {
        const h = harness(envelope('a', { sk_jrnl1: OLD })); await h.login('a'); h.emit({ sk_jrnl1: OLD }); h.ls('sk_jrnl1', EDIT);
        h.server('a', { sk_jrnl1: OLD, sk_cd1: 'changed-on-server' }); await h.push();
        S.ok(h.writes.length === 0 && h.ctx.run('_syncConflict !== null') && h.state().ack === 0, '上次快照之后服务器又被改过:事务里读到就不写,转成让她选');
        const r = harness(envelope('a', { sk_jrnl1: OLD })); await r.login('a'); r.emit({ sk_jrnl1: OLD }); r.ls('sk_jrnl1', EDIT);
        r.retry({ sk_jrnl1: [{ note: 'concurrent' }] }); await r.push();
        S.ok(r.writes.length === 0 && r.recovery().length === 2 && r.statuses.length >= 0 && r.state().ack === 0, 'Firestore 重跑事务回调:第二次读到并发改动,不写;回调里没碰本机状态', r.recovery().length);
    });
    await T('没有基线', async () => {
        const seed = envelope('a', { sk_jrnl1: EDIT }, 1, 0, null);
        const h = harness(seed); await h.login('a'); h.emit({ sk_jrnl1: OLD });
        S.ok(h.writes.length === 0 && h.ctx.run('_syncConflict !== null'), '本机有改动但不知道上次确认的是哪份、云端又有数据:不猜,停下来问');
        const e = harness(envelope('a', { sk_jrnl1: EDIT }, 1, 0, null)); await e.login('a'); e.emit({}, {}, false); await e.fire(2000);
        S.ok(e.writes.length === 1 && !e.ctx.run('_syncConflict'), '……云端是空的:没什么会被盖掉,直接推');
    });
    await T('删掉的字段', async () => {
        const h = harness(envelope('a', { sk_popen1: { a: '2026-10-01', b: '2026-10-02' } })); h.auto(true); await h.login('a');
        h.emit({ sk_popen1: { a: '2026-10-01', b: '2026-10-02' }, extraField: 'keep-me' });
        h.ls('sk_popen1', { a: '2026-10-01' }); await h.fire(2000); h.emitServer('a');
        S.ok(!('b' in h.remote.get('a').sk_popen1) && !('b' in h.data('sk_popen1')) && h.remote.get('a').extraField === 'keep-me',
            '本机删掉的字段在云端也删掉、下次快照不会带回来;云键以外的字段原样留着', h.remote.get('a'));
    });

    await T('跨天推定', async () => {
        const d = { sk_profile1: { minimalMode: true }, sk_planday1: { date: '2026-10-28', items: [{ tag: '虚构酸' }] }, sk_jrnl1: [{ date: '2026-10-28', products: ['manual'], note: 'kept' }] };
        const h = harness(envelope('a', d)); h.run('PROFILE = lg(K.profile); _applyingCloud = true; absorbPrescribedHistory(); _applyingCloud = false;');
        const e = h.data('sk_jrnl1')[0];
        S.ok(e.products.join() === 'manual,虚构酸' && e.note === 'kept' && e.auto === true && h.state().rev === 1, '极简模式跨天推定:合并进当天,云端回声期间也算本机改动(derived)', e);
        h.run('absorbPrescribedHistory()'); S.ok(h.state().rev === 1, '只并一次');
        S.ok(h.restart().data('sk_jrnl1')[0].products.length === 2, '重开还在');
        const f = harness(envelope('a', d)); f.run('PROFILE.minimalMode = false; absorbPrescribedHistory()'); S.ok(f.state().rev === 0, '完整模式不推定');
        // 快照来时先推定、再让云端盖 planday
        const s = harness(envelope('a', d)); s.run('PROFILE = lg(K.profile)'); await s.login('a');
        s.emit({ sk_jrnl1: d.sk_jrnl1, sk_planday1: d.sk_planday1, sk_profile1: d.sk_profile1 }); await s.fire(2000);
        S.ok(s.writes.length === 1 && s.writes[0].data.sk_jrnl1[0].products.includes('虚构酸'), '云端快照落地前先把昨天的处方落成记录,再推上去', s.writes.length);
    });
    await T('新的一天', async () => {
        const h = harness(envelope('a', { sk_tn1: { date: '2026-10-28', shower: true }, sk_tnsteps1: { date: '2026-10-28', done: ['x'] } }));
        h.run('initTN()');
        S.ok(h.state().rev === 0 && h.data('sk_tnsteps1').date === '2026-10-29', '新的一天清空今晚步骤:system,不算改动');
    });

    await T('恢复副本', async () => {
        const h = harness(envelope('a', { sk_jrnl1: OLD }));
        for (let i = 0; i < 6; i++) h.run(`backupSyncData('a', {sk_cd1: 'v${i}'}, 'local-before-choice')`);
        h.run(`backupSyncData('a', {sk_cd1: 'v5'}, 'cloud-before-choice')`);
        const rc = h.recovery();
        S.ok(rc.length === 4 && rc.some(c => c.data.sk_cd1 === 'v5') && !rc.some(c => c.data.sk_cd1 === 'v0'), '每个账号最多留 4 份、同一份只存一次、先删最旧的', rc.map(c => c.data.sk_cd1));
        h.run('showSyncRecovery()');
        S.ok(h.sheets.has('sync-recovery') && /换成这份/.test(h.sheets.get('sync-recovery').html), '设置里能列出、能换成某一份');
        const idx = h.run("_recoveryList.findIndex(c => c.data.sk_cd1 === 'v5')");
        h.run(`restoreSyncCopy(${idx})`);
        S.ok(h.data('sk_cd1') === 'v5' && h.pending() && h.recovery().some(c => c.reason === 'before-restore'), '换成某一份:现在的先另存,换完算一次改动照常同步');
        const o = harness(envelope('b', {})); S.ok(o.recovery().length === 0 || o.recovery().every(c => c.uid === 'b'), '别的账号看不到这个账号的副本');
    });
    await T('坏信封', async () => {
        const h = harness({ sk_uid: 'a', 'sk_sync_v1:a': '{broken', sk_jrnl1: JSON.stringify(EDIT) });
        S.ok(h.state().legacy && h.data('sk_jrnl1')[0].note === 'offline-new' && [...h.values.keys()].some(k => k.endsWith(':corrupt')), '信封读不出来:原样另存,从镜像重建成待核对的旧数据(不白屏、不当作可以覆盖)');
    });

    // ── 单窗口锁(启动脚本):没有 locks / 出错 / 被占着 都不运行 App;占着时自己重试几次 ──
    for (const mode of ['missing', 'rejected', 'occupied', 'busy-then-free', 'available']) await T('锁 ' + mode, async () => {
        let appended = 0, calls = 0; const timers = [];
        const notice = { title: '', text: '', hidden: null };
        const ov = { dataset: {}, remove() { ov.removed = true; }, set innerHTML(v) { }, querySelector(q) {
            if (q === '.sheet-t') return { set textContent(v) { notice.title = v; } };
            if (q === '.sheet-b') return { set textContent(v) { notice.text = v; } };
            if (q === '.sheet-actions') return { set hidden(v) { notice.hidden = v; } };
            return { onclick: null };
        } };
        let shown = null;
        const c = vm.createContext({
            navigator: mode === 'missing' ? {} : { locks: { request(name, o, cb) {
                calls++;
                if (name !== 'skincare-account-storage' || o.ifAvailable !== true || o.mode !== 'exclusive') throw Error('参数不对');
                if (mode === 'rejected') return Promise.reject(Error('denied'));
                const free = mode === 'available' || (mode === 'busy-then-free' && calls >= 3);
                return Promise.resolve(cb(free ? {} : null));
            } } },
            setTimeout(f, ms) { timers.push(f); },
            window: { addEventListener() { } },
            document: {
                getElementById(id) { if (id === 'skincare-app-source') return { textContent: 'app' }; if (id === 'app-lock') return shown; return null; },
                createElement(k) { return k === 'script' ? { kind: 'script' } : (shown = ov); },
                body: { appendChild(e) { if (e.kind === 'script') appended++; } }
            }
        });
        vm.runInContext(BOOT, c); await flush();
        for (let i = 0; i < 6 && timers.length; i++) { timers.shift()(); await flush(); }
        const started = appended > 0;
        if (mode === 'available' || mode === 'busy-then-free') S.ok(started && appended === 2, `锁 ${mode}:拿到锁才运行 App,再加载 ai.js`, { appended, calls });
        else S.ok(!started && notice.title && notice.text, `锁 ${mode}:App 一行都不跑,给提示`, notice);
        if (mode === 'occupied') S.ok(calls === 5 && /关掉另一个窗口再点重试/.test(notice.text) && notice.hidden === false, '被别的窗口占着:先悄悄重试几次,再提示「关掉另一个窗口再点重试」,有重试按钮', { calls, notice });
        if (mode === 'missing') S.ok(notice.hidden === true && /记录都还在/.test(notice.text), '浏览器没有 Web Locks:暂停,说明记录没动,不给没用的重试', notice);
    });
}
function closeAll(h) { h.sheets.clear(); }

// 直接跑(CI)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    let fail = 0, n = 0; const t0 = Date.now();
    const S = { ok(c, label, detail) { n++; if (!c) fail++; console.log((c ? '  ✓ ' : '  ✗ ') + label + (!c && detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 600) : '')); return !!c; } };
    console.log('■ sync-unit');
    await runSyncUnit(S);
    console.log(`\n${fail ? '✗ ' + fail + ' 条失败' : '✓ 全部通过'}(${n} 条)· ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(fail ? 1 : 0);
}
