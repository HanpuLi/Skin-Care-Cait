// ══ 本地存储:键表 + 读写唯一入口 + 按账号的同步信封 ══════════════════════════════════════════
// 语义原样搬自 v1(legacy/index.v1.html.txt 的「Storage:按账号的同步信封」一段;Codex 10/14 59f770c 的设计,10/29 按新代码重写)。
// 数据格式和 v1 逐字兼容:同一个信封键 sk_sync_v1:<uid>、同样的 19 个云键、同样的镜像、同样的恢复副本前缀。
// v1 和 v2 可以在同一台设备 / 同一份云端数据上交替打开(同一把窗口锁,见 sync.js 的 startWithLock)。
//
// 本机记录的正本 = localStorage['sk_sync_v1:<uid>'] 这一个信封:
//   data   19 个云键的值        rev  本机改动计数        ack  云端已确认到第几次
//   base   上次确认的云端内容指纹(syncHash)            sent 推出去还没确认的几次指纹(超时后才落地的那次也认得是自己写的)
//   legacy 旧版升级来 / 登录前攒下的数据,还没跟云端对过(对过之前不上传)
// rev > ack = 有没传上去的改动:关页、断网、超时都留在信封里,下次打开接着传,云端绝不能盖它。
// 旧的 sk_* 键只是镜像(回退到旧版本时还能读到),读写一律以信封为准。
// ls(k, v, origin):
//   'user'    用户操作 —— rev+1、排推送;云端回声期间(applyingCloud)例外,只落盘
//   'derived' 自动推出来、过了今天就推不出来的事实(极简模式的跨天推定)—— 回声期间也 rev+1
//   'system'  每次加载都会重算的(货架迁移、方案重出、状态清洗、新的一天)—— 只落盘,跟着下一次真实改动一起上传
// 【要紧 · 8/29 无限对推】云端数据正在落到本机的这一小段(applyingCloud)里,本机的自动写盘绝不能反弹回云端:
//    云端盖本地 → 重绘时迁移 / 方案重出 → 写盘 → 推送 → 云端变新 → 另一台又盖回来 → 无限对推。
//    回声期间的写盘照样落进信封,但 rev 不涨 —— 不算「本机改动」,也就不会被推回去。
// 这个模块 import 时不碰任何存储:只有 app.js 拿到窗口锁之后调 createStore() / store.open() 才开始读写。

// 【要紧】一个不能少、名字和顺序都不改(qa.yml 和 t/engine-unit.mjs 守着)
export const CLOUD_KEYS = ['sk_wk1', 'sk_jrnl1', 'sk_cd1', 'sk_prods1', 'sk_popen1', 'sk_tn1', 'sk_tnsteps1', 'sk_amsteps1', 'sk_proddefs1', 'sk_profile1', 'sk_preset1', 'sk_planday1', 'sk_mig1', 'sk_empty1', 'sk_gone1', 'sk_low1', 'sk_regimen1', 'sk_tnai1', 'sk_ai1'];
export const K = {
    wk: 'sk_wk1',            // 每周的洗澡 / 刮胡:{ '2026-W44': {shower:[7], shave:[7]} },只留 12 周
    jrnl: 'sk_jrnl1',        // 每天的记录(见 model/journal.js 的条目形状)
    cd: 'sk_cd1',
    prods: 'sk_prods1',      // 产品状态 {id: 'owned'|'active'|'paused'}
    popen: 'sk_popen1',      // 开封日期 {id: 'YYYY-MM-DD'}
    tn: 'sk_tn1',            // 今晚洗澡 / 刮胡 {shower, shave, date, manual}
    tnsteps: 'sk_tnsteps1',  // 今晚步骤的勾选 {date, done[], skipped[]}
    amsteps: 'sk_amsteps1',
    prodDefs: 'sk_proddefs1',// 货架(产品定义)
    profile: 'sk_profile1',  // 每人档案(model/profile.js)
    preset: 'sk_preset1',    // 洗澡 / 刮胡的每周习惯 [{dow, shower, shave}] × 7 —— 全 App 唯一一份(model/week.js)
    planday: 'sk_planday1',  // 今天排了哪些活性 —— 极简模式跨天后据此推定已执行(absorbPrescribedHistory)
    mig: 'sk_mig1',          // 已跑过的货架迁移 id
    empty: 'sk_empty1',      // 空瓶记录 {id: [{date, weeks, uses, name}]}
    gone: 'sk_gone1',        // 用完删掉的产品 id
    low: 'sk_low1',          // 快用完的产品 id
    regimen: 'sk_regimen1',  // 方案版本历史(model/regimen.js)
    tnai: 'sk_tnai1',        // 今晚的小改(顾问 change_tonight){date, id, ops[], undo}
    ai: 'sk_ai1'             // 顾问的跨设备状态(每周复盘做过没有等)
};
// 只在本机、不进信封的键(按设备存;换账号时顾问那几个由 ai 层清掉)
export const LOCAL_KEYS = { theme: 'sk_theme', type: 'sk_type', uid: 'sk_uid', lastPush: 'sk_lastpush', aiChat: 'sk_aichat1', aiNote: 'sk_ainote1', aiAcc: 'sk_aiacc1', aiOpts: 'sk_aiopts1', aiPrivacy: 'sk_aiprivacy1', aiShop: 'sk_ai_shop1', aiTonight: 'sk_ai_tonight1' };
export const UIDK = 'sk_uid';
export const SYNC_PREFIX = 'sk_sync_v1:', SYNC_RECOVERY = 'sk_sync_recovery:', SYNC_RECOVERY_MAX = 4;
export const STORAGE_FULL_MSG = '这台设备存不进去了，刚才的改动没保存。先导出备份、腾点空间再试。';
// 更早的旧键(sc_*)
const OLDER_KEYS = { sk_jrnl1: 'sc_jrnl2', sk_prods1: 'sc_prods1', sk_cd1: 'sc_cd1' };

// 【8/15 键序】递归按键名排序的序列化 —— 只用于云 / 本地数据的等价比较。
// Firestore 回来的 map 键序和本地不同,比原串会永远「脏」→ 无限互推。tests/firestore-roundtrip.test.mjs 拿真 Firestore 验它。
export function _stableStr(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_stableStr).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _stableStr(v[k])).join(',') + '}';
}
// 内容指纹:建在 _stableStr 上(键序无关),只用来判断「两份是不是同一份」
export function syncHash(v) {
    const s = _stableStr(v === undefined ? null : v);
    let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return s.length.toString(36) + '.' + (h2 >>> 0).toString(36) + '.' + (h1 >>> 0).toString(36);
}
export function cloneSync(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
export function syncKey(uid) { return SYNC_PREFIX + encodeURIComponent(uid || ''); }
export function recoveryPrefix(uid) { return SYNC_RECOVERY + encodeURIComponent(uid || '') + ':'; }
export function validEnvelope(doc, uid) {
    return !!doc && doc.version === 1 && doc.uid === uid && !!doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data)
        && Number.isSafeInteger(doc.rev) && Number.isSafeInteger(doc.ack) && doc.ack >= 0 && doc.ack <= doc.rev;
}

// env: { localStorage, onStorageError(msg)?, now()? }
// store.onDurable:有一次真实改动(rev+1)之后调 —— sync.js 把它设成 schedulePush
export function createStore(env) {
    const LS = env.localStorage;
    const nowMs = () => (env.now ? env.now() : Date.now());
    const S = {
        doc: { version: 1, uid: '', rev: 0, ack: 0, base: null, sent: [], legacy: false, data: {} },
        owner: '', applyingCloud: false, storageBlocked: false
    };
    const raw = {}, gen = {};   // lg() 的解析缓存 / 每个键改过几次(给别处做缓存键)
    const store = { state: S, onDurable: null };

    function storageError() {
        S.storageBlocked = true;
        if (env.onStorageError) try { env.onStorageError(STORAGE_FULL_MSG); } catch (e) { }
    }
    function readMirrors() {
        const data = {};
        CLOUD_KEYS.forEach(k => { const r = LS.getItem(k); if (r !== null) { try { data[k] = JSON.parse(r); } catch { } } });
        Object.entries(OLDER_KEYS).forEach(([key, old]) => {
            if (!(key in data)) { const r = LS.getItem(old); if (r !== null) { try { data[key] = JSON.parse(r); } catch { } } }
        });
        return data;
    }
    // 恢复副本:按账号存在本机,同一份内容只存一次,每个账号最多留 SYNC_RECOVERY_MAX 份(旧的先删)
    function backup(uid, data, reason) {
        const prefix = recoveryPrefix(uid), hash = syncHash(data || {});
        const mine = [];
        for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith(prefix)) mine.push(k); }
        const same = mine.find(k => k.endsWith(':' + hash));
        if (same) return same;
        mine.sort((a, b) => Number(a.slice(prefix.length).split(':')[0]) - Number(b.slice(prefix.length).split(':')[0]));
        const key = prefix + nowMs() + ':' + hash;
        const rec = JSON.stringify({ uid: uid || '', reason, savedAt: new Date(nowMs()).toISOString(), data: data || {} });
        for (; ;) {
            try { LS.setItem(key, rec); break; }
            catch (e) { if (!mine.length) throw e; LS.removeItem(mine.shift()); }   // 满了:先挤掉最旧的副本再试
        }
        while (mine.length >= SYNC_RECOVERY_MAX) LS.removeItem(mine.shift());
        return key;
    }
    function recoveryCopies(uid) {
        const prefix = recoveryPrefix(uid == null ? S.owner : uid), out = [];
        for (let i = 0; i < LS.length; i++) {
            const key = LS.key(i);
            if (key && key.startsWith(prefix)) { try { out.push(Object.assign({ key }, JSON.parse(LS.getItem(key)))); } catch (e) { } }
        }
        return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    }
    // 打开某个账号的信封;没有就新建。initial = 新建时的内容(启动时是旧版镜像,换账号时是认领过来的数据)
    // opts.lastPush:旧版的 sk_lastpush(升级判断用);opts.adopted:'claimed'(她说是自己的)/ 'weak'(登录前随手点的设置)
    function openEnvelope(uid, initial, opts) {
        opts = opts || {};
        let r = null;
        try { r = LS.getItem(syncKey(uid)); } catch (e) { }
        if (r !== null) {
            try { const doc = JSON.parse(r); if (validEnvelope(doc, uid)) return doc; } catch (e) { }
            // 信封坏了:原样另存一份(不当作可以覆盖的许可),再按旧版数据重建,让云端那边去判断
            try { LS.setItem(recoveryPrefix(uid) + nowMs() + ':corrupt', JSON.stringify({ uid, reason: 'corrupt-envelope', savedAt: new Date(nowMs()).toISOString(), data: null, raw: r })); } catch (e) { }
        }
        const init = typeof initial === 'function' ? initial() : (initial || {});
        const has = Object.keys(init).length > 0;
        const doc = { version: 1, uid, rev: 0, ack: 0, base: null, sent: [], legacy: has, data: cloneSync(init) };
        if (has) { doc.legacyLastPush = Number(opts.lastPush || 0); if (opts.adopted) doc.adopted = opts.adopted; }
        try {
            if (has) doc.recoveryKey = backup(uid, init, opts.adopted ? 'before-login' : 'before-sync-upgrade');
            LS.setItem(syncKey(uid), JSON.stringify(doc));
        } catch (e) { storageError(); }
        return doc;
    }
    // 镜像写失败不丢东西:正本在信封里,lg() 和下次启动都读信封
    function mirror(data, keys) {
        try { (keys || CLOUD_KEYS).forEach(k => { if (k in data) LS.setItem(k, JSON.stringify(data[k])); else LS.removeItem(k); }); }
        catch (e) { /* 本机镜像没写上,信封里的记录不受影响 */ }
    }
    function bumpKeys(keys) { keys.forEach(k => { delete raw[k]; gen[k] = (gen[k] || 0) + 1; }); }
    // 一次写入 = 数据和 rev 一起落进信封,成功了才算数;之后才更新镜像
    function commit(next, changedKeys) {
        try { LS.setItem(syncKey(next.uid), JSON.stringify(next)); }
        catch (e) { storageError(); throw e; }
        const keys = changedKeys || CLOUD_KEYS;
        S.doc = next; S.storageBlocked = false;
        bumpKeys(keys);
        if (keys.length) mirror(next.data, keys);
    }
    // 换账号:信封换成 next(已落盘),所有缓存作废
    function switchTo(uid, next) { S.owner = uid; S.doc = next; S.storageBlocked = false; bumpKeys(CLOUD_KEYS); }
    function hasPending() { return S.doc.rev > S.doc.ack; }
    function keyGen(k) { return gen[k] || 0; }

    function lg(k) {
        if (CLOUD_KEYS.indexOf(k) >= 0) {
            if (!(k in S.doc.data) || S.doc.data[k] === null) return null;
            if (!(k in raw)) raw[k] = JSON.stringify(S.doc.data[k]);
            return JSON.parse(raw[k]);
        }
        try { const v = LS.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
    }
    function ls(k, v, origin = 'user') {
        if (CLOUD_KEYS.indexOf(k) < 0) { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
        if (S.storageBlocked && origin !== 'user') return false;
        const nv = cloneSync(v);
        if (nv === undefined ? !(k in S.doc.data) : (k in S.doc.data && _stableStr(S.doc.data[k]) === _stableStr(nv))) return true;   // 没变就不算一次改动
        const durable = origin === 'derived' || (origin === 'user' && !S.applyingCloud);   // 云端回声,别推回去
        const data = Object.assign({}, S.doc.data);
        if (nv === undefined) delete data[k]; else data[k] = nv;
        try { commit(Object.assign({}, S.doc, { data, rev: S.doc.rev + (durable ? 1 : 0) }), [k]); }
        catch (e) {
            if (origin === 'user') throw e;   // 用户操作:别让调用方接着显示「存好了」
            return false;
        }
        if (durable && store.onDurable) store.onDurable();
        return true;
    }
    // 本机才有的键(不进信封):直接读写 localStorage
    function getLocal(k) { try { return LS.getItem(k); } catch (e) { return null; } }
    function setLocal(k, v) { try { if (v === null || v === undefined) LS.removeItem(k); else LS.setItem(k, String(v)); return true; } catch (e) { return false; } }

    // 启动(拿到窗口锁之后):打开本机当前归属账号的信封;没有信封 = 旧版数据,按镜像建一个待核对的
    function open() {
        try { S.owner = LS.getItem(UIDK) || ''; } catch (e) { S.owner = ''; }
        S.doc = { version: 1, uid: S.owner, rev: 0, ack: 0, base: null, sent: [], legacy: false, data: {} };
        try { S.doc = openEnvelope(S.owner, readMirrors, { lastPush: S.owner ? +LS.getItem(LS_LAST) || 0 : 0 }); }
        catch (e) { storageError(); }
        return store;
    }
    const LS_LAST = LOCAL_KEYS.lastPush;
    // 一次性:更早的 sc_* 旧键搬进来('system',只落盘)
    function migrateOlderKeys() {
        const old = { jrnl: 'sc_jrnl2', prods: 'sc_prods1', cd: 'sc_cd1' };
        Object.keys(old).forEach(k => { if (!lg(K[k]) && lg(old[k])) ls(K[k], lg(old[k]), 'system'); });
    }

    Object.assign(store, { lg, ls, open, hasPending, keyGen, commit, switchTo, mirror, backup, recoveryCopies, openEnvelope, readMirrors,
        storageError, getLocal, setLocal, migrateOlderKeys, localStorage: LS, now: nowMs });
    return store;
}
