// ══ Firebase 登录 + Firestore 同步(信封版)════════════════════════════════════════════════
// 语义原样搬自 v1(legacy/index.v1.html.txt「Firebase 云同步(信封版)」一段 + 启动脚本的窗口锁)。对照表见 ARCHITECTURE.md §4。
// 一句话:本机改动先落进信封(rev+1),云端确认了才算数(ack);云端只在「本机没有未确认改动」时盖本机;
// 两边都改了 → 暂停同步、两份都另存恢复副本、让她选一整份。上传走 Firestore 事务:云端还是上次确认的那份才写。
// 旧事故的守卫都还在,换了形式:
//   8/15 旧云盖新本地:不再靠 cloudAt <= lastPush 猜 —— rev > ack 就绝不接受覆盖;
//        cloudAt <= lastPush 只在旧版数据升级的那一次用来判断谁新(legacySyncDecision)
//   8/15 键序:指纹 syncHash 建在 _stableStr 上 / 缺键补拉:applyCloudData 叠加云端有的键,升级判成「本机新」时先补上本机缺的
//   8/15 极简模式跨天推定:hooks.absorbPrescribedHistory 用 'derived' 写,云端的键盖进来之前先跑
//   8/15 关页冲刷:flushPendingPush / 8/29 无限对推:回声期间 rev 不涨、'system' 写盘不推、hasPendingWrites 的快照不理
// 这个模块 import 时不碰任何存储和 DOM;所有依赖从 createSync(env) 传进来(测试里换成假替身)。
import { CLOUD_KEYS, K, UIDK, LOCAL_KEYS, syncKey, syncHash, cloneSync, _stableStr } from './store.js';

const OWNER_B64 = 'Y2FpdGx5ZUBnbWFpbC5jb20=';
export const RECOVERY_LABEL = { 'before-sync-upgrade': '升级前这台设备的', 'before-login': '登录前这台设备的', 'local-before-upgrade': '升级时这台设备的', 'cloud-before-upgrade': '升级时云端的',
    'local-before-choice': '选之前这台设备的', 'cloud-before-choice': '选之前云端的', 'before-restore': '恢复之前这台设备的', 'corrupt-envelope': '读不出来的旧存档' };

// 「真有记录」= 日志里有状态 / 产品 / 备注(只是装了 App、点了几下设置不算)
export function hasRealRecords(data) {
    return ((data && data.sk_jrnl1) || []).some(e => e && ((e.status || []).length || (e.products || []).length || (e.note && String(e.note).trim())));
}
function _subset(a, b) { const s = new Set((b || []).map(String)); return (a || []).every(x => s.has(String(x))); }
// 本机有、云端没有的「记录」:某天的日志(状态 / 产品 / 没做 / 备注有云端没有的)、自己加的产品、用完了
export function localOnlyRecords(local, cloud) {
    const out = [], cj = {};
    (cloud.sk_jrnl1 || []).forEach(e => { if (e && e.date) cj[e.date] = e; });
    (local.sk_jrnl1 || []).forEach(e => {
        if (!e || !e.date) return;
        const note = e.note && String(e.note).trim();
        if (!((e.status || []).length || (e.products || []).length || (e.skipped || []).length || note)) return;
        const c = cj[e.date];
        const inside = c && _subset(e.status, c.status) && _subset(e.products, c.products) && _subset(e.skipped, c.skipped) && (!note || String(c.note || '').indexOf(note) >= 0);
        if (!inside) out.push('jrnl:' + e.date);
    });
    const cIds = new Set((cloud.sk_proddefs1 || []).map(p => p && p.id));
    (local.sk_proddefs1 || []).forEach(p => { if (p && p.id && !p.builtin && !cIds.has(p.id)) out.push('prod:' + p.id); });
    const cg = new Set(cloud.sk_gone1 || []);
    (local.sk_gone1 || []).forEach(id => { if (!cg.has(id)) out.push('gone:' + id); });
    return out;
}
export function cloudSyncData(doc) {
    const d = {};
    CLOUD_KEYS.forEach(k => { if (doc && k in doc && doc[k] !== undefined) d[k] = cloneSync(doc[k]); });
    return d;
}
export function syncSummary(data) {
    data = data || {};
    const j = (data.sk_jrnl1 || []).filter(e => e && e.date);
    const last = j.map(e => e.date).sort().pop();
    const shelf = (data.sk_proddefs1 || []).filter(p => p && !p.hidden && !p.dropped).length;
    const md = last ? Number(last.slice(5, 7)) + '月' + Number(last.slice(8, 10)) + '日' : '';
    return j.length + ' 天的记录' + (md ? '，最近一天 ' + md : '') + (data.sk_proddefs1 ? '；货架 ' + shelf + ' 件' : '');
}
export function isOwnerEmail(email, atobFn) {
    try { return !!(email && String(email).toLowerCase() === (atobFn || atob)(OWNER_B64)); } catch (e) { return false; }
}

// env = { store, db?, ui, hooks, timers, today(), localD(d), navigator?, window? }
//   ui    = { openSheet(o), closeSheet(id), hasSheet(id), toast(msg, ms), sysAlert(msg, title), sysConfirm(msg, ok, opts), status(view), download(name, body) }
//   hooks = { reloadFromStore(), renderAll(), absorbPrescribedHistory(), autoMatchProfile(uid, user) → bool,
//             clearLocalExtras(), onAuthUser(user|null), onFirstSnapshot(exists, uid) }
export function createSync(env) {
    const store = env.store, S = store.state, ui = env.ui, hooks = env.hooks || {};
    const T = env.timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id) };
    const st = { db: env.db || null, user: null, unsub: null, pushTimer: null, pushing: false, pushDirty: false, pushBackoff: 0,
                 session: 0, hydrated: false, conflict: null, syncState: 'ok', recoveryList: [] };
    const hook = (n, ...a) => { if (typeof hooks[n] === 'function') return hooks[n](...a); };
    const LS = store.localStorage;

    function storageErr() { store.storageError(); }
    function hasPending() { return store.hasPending(); }
    function sessionMatches(uid, session) { return !!(st.user && st.user.uid === uid && S.owner === uid && st.session === session); }
    function localData() { return cloudSyncData(S.doc.data); }
    function meta(extra) {
        const next = Object.assign({}, S.doc, { legacy: false }, extra || {});
        delete next.adopted; delete next.legacyLastPush;
        return next;
    }
    // 云端出现的是本机早先推出去、还没确认的某一版(比如超时后才落地的那次)→ 是自己写的,不算别人改过
    function ownSentRev(hash) { const s = (S.doc.sent || []).find(x => x.hash === hash); return s ? s.rev : -1; }

    // 云端数据落地后的重绘:期间的自动写盘只落本机、不反弹
    function applyCloudThenRender() {
        S.applyingCloud = true;
        try { hook('renderAll'); } finally { S.applyingCloud = false; }
    }

    // ── 状态显示:不弹吐司;离线 / 暂停时头部挂一个安静的小标,设置里显示上次同步时间 ──
    function syncLineText() {
        if (S.storageBlocked) return '这台设备存不进去了：先导出备份、腾点空间。';
        if (!st.user && st.sdkMissing && S.owner) return '离线 · 登录服务没加载出来，改动先存在这台设备上，连上会接着传。';
        if (!st.user) return '没登录：数据只在这台设备上。';
        if (st.conflict) return '同步先停着：这台设备和云端都改过，等你选一份。改动照样存在这台设备上。';
        const lp = S.doc.pushedAt || +(store.getLocal(LOCAL_KEYS.lastPush) || 0) || 0;
        if (st.syncState === 'err') return '这会儿连不上，改动先存在本机，连上会自动传。';
        return lp ? '上次同步 ' + new Date(lp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '已登录，正在同步。';
    }
    function showSyncStatus(msg, state) {
        state = state || 'ok';
        if (state !== 'syncing') st.syncState = state;
        const paused = !!st.conflict;
        const offline = !!(env.navigator && env.navigator.onLine === false && st.user) || !!(st.sdkMissing && S.owner && !st.user);   // 登录服务没加载出来(离线首开):照样挂离线小标
        if (ui.status) ui.status({ msg, state, paused, badge: paused || st.syncState === 'err' || offline,
            badgeText: paused ? '同步暂停 · 去设置里选' : '离线 · 改动先存在本机', line: syncLineText() });
    }

    // ── 登录 / 换账号 ──
    function askClaim(user) {
        return new Promise(res => ui.openSheet({ id: 'claim', title: '这些记录是你的吗？', noClose: true,
            text: '这台设备上有登录前记下的护肤记录。\n\n是你的：归到「' + (user.email || '这个账号') + '」名下，接着用。\n不是你的：先放一边不动，载入你自己云端的数据。',
            actions: [{ label: '不是我的', fn: () => res(false) }, { label: '是我的', primary: true, fn: () => res(true) }] }));
    }
    // 换账号:两个人的信封各自留在本机、互不相见;这里只清本机缓存里属于上一个人的东西
    function clearLocalUserData() {
        store.mirror(S.doc.data);   // 镜像换成新账号的
        hook('clearLocalExtras');   // 顾问的本机缓存、未加账号前缀的旧照片
        store.setLocal(LOCAL_KEYS.lastPush, null);
        hook('reloadFromStore');
    }
    async function handleAuthChange(user) {
        const session = ++st.session;
        if (st.unsub) { st.unsub(); st.unsub = null; }
        T.clearTimeout(st.pushTimer); st.pushTimer = null;
        st.pushing = false; st.pushDirty = false; st.pushBackoff = 0; st.hydrated = false; st.conflict = null;
        ui.closeSheet('sync-conflict'); ui.closeSheet('claim');
        st.user = null;
        if (!user) {   // 登出:本机记录照旧属于刚才那个账号的信封,离线改的下次登录接着传。换成别的账号登录时才换信封。
            showSyncStatus('', 'ok');
            hook('onAuthUser', null);
            return;
        }
        try {
            if (S.owner !== user.uid) {
                const switched = !!S.owner;
                let adopt = null, adopted = '';
                // 这台设备从没登录过、却攒了数据(真实场景:Cici 在 Cait 的电脑上第一次登录)。
                // 只在**真有记录**时才问;只是点过设置 / 走过引导的,悄悄带过去,云端已有这个账号的数据就以云端为准。
                if (!S.owner && Object.keys(S.doc.data).length) {
                    if (hasRealRecords(S.doc.data)) {
                        const mine = await askClaim(user);
                        if (session !== st.session) return;   // 等她选的时候账号又变了
                        if (mine) { adopt = cloneSync(S.doc.data); adopted = 'claimed'; }
                    } else { adopt = cloneSync(S.doc.data); adopted = 'weak'; }
                }
                const next = store.openEnvelope(user.uid, adopt || {}, { adopted });
                // 先把信封落盘、再记身份:哪一步失败,重启时都还能找到自己的那份;身份没写上就不切换
                LS.setItem(syncKey(user.uid), JSON.stringify(next));
                LS.setItem(UIDK, user.uid);
                const prevKey = syncKey(S.owner);
                store.switchTo(user.uid, next);
                if (adopt) { try { LS.removeItem(prevKey); } catch (e) { } }   // 认领走了:数据已在新信封里(另有升级前副本)
                clearLocalUserData();
                applyCloudThenRender();
                if (switched) ui.toast('换了账号，正在载入…');
            } else LS.setItem(UIDK, user.uid);
            st.user = user;
            hook('onAuthUser', user);
            showSyncStatus('', st.syncState);
            setupRealtimeSync();
        } catch (e) { storageErr(); hook('onAuthUser', null); }
    }

    // ── 旧版数据升级 ──
    // 能用现有元数据无歧义判断的都静默处理;只有「云端变过、本机也有云端没有的记录」才让她选。
    //   L1 本机有的每个键都和云端一样(云端可能多几个键)          → 用云端(等于补拉)
    //   L2 云端没有任何数据                                      → 用本机,传上去
    //   L3 登录前随手点的设置 / 引导(没有真记录),云端已有数据   → 用云端
    //   L4 云端自从这台设备上次成功推送后没变过(cloudAt <= lastPush) → 差别全是本机的,用本机(云端那份另存副本)
    //   L5 其余(云端变过,或没有时间戳可比):本机有云端没有的记录 → 问;没有 → 用云端
    function legacySyncDecision(local, cloud, cloudAt) {
        if (Object.keys(local).every(k => _stableStr(local[k]) === _stableStr(cloud[k]))) return 'same';
        if (!Object.keys(cloud).length) return 'local';
        if (S.doc.adopted === 'weak') return 'cloud';
        const lastPush = Number(S.doc.legacyLastPush || 0);
        if (lastPush && cloudAt && cloudAt <= lastPush) return 'local';
        return localOnlyRecords(local, cloud).length ? 'conflict' : 'cloud';
    }
    // 返回 true = 接着按普通流程走
    function settleLegacy(cloud, raw, uid, session) {
        const local = localData();
        const d = legacySyncDecision(local, cloud, Number(raw._updatedAt || 0));
        if (d === 'conflict') { pauseSyncConflict(cloud, uid, session, 'legacy'); return false; }
        if (d === 'local') {
            if (Object.keys(cloud).length) store.backup(uid, cloud, 'cloud-before-upgrade');
            const pulled = Object.keys(cloud).filter(k => !(k in S.doc.data));   // 本机缺、云端有 → 补拉(换账号后载入不了的老坑)
            const data = Object.assign({}, cloudSyncData(cloud), S.doc.data);
            store.commit(meta({ data, base: syncHash(cloud), sent: [], rev: S.doc.rev + 1 }), pulled);
            if (pulled.length) hook('reloadFromStore');
            return true;
        }
        if (d === 'cloud') store.backup(uid, S.doc.data, 'local-before-upgrade');
        // 'same' / 'cloud':升级前遗留的未确认改动作废(副本在),下面按普通流程把云端落下来
        store.commit(meta({ ack: S.doc.rev, sent: [] }), []);
        return true;
    }
    // 云端的键叠到本机上(云端没有的键本机照留)。排班表逐日合并:本机已成为"过去"的日子保留本地值,
    // 否则另一台设备(时区/日期不同)推上来的整份 K.wk 会改写这边界面上标着"不可更改"的历史。
    function applyCloudData(cloud) {
        const data = Object.assign({}, S.doc.data), changed = [];
        CLOUD_KEYS.forEach(k => {
            if (!(k in cloud)) return;
            let v = cloud[k];
            if (k === K.wk && v && typeof v === 'object') {
                const localWk = data[k] || {};
                const merged = JSON.parse(JSON.stringify(v));
                const t = env.today();
                Object.keys(localWk).forEach(wkKey => {
                    const lw = localWk[wkKey]; if (!lw) return;
                    if (!merged[wkKey]) merged[wkKey] = { shower: Array(7).fill(false), shave: Array(7).fill(false) };
                    for (let i = 0; i < 7; i++) {
                        const mon = new Date(wkKey.slice(0, 4) + '-01-04T12:00:00');
                        mon.setDate(mon.getDate() + (Number(wkKey.slice(6)) - 1) * 7 - ((mon.getDay() + 6) % 7) + i);
                        if (env.localD(mon) < t) {
                            merged[wkKey].shower[i] = !!(lw.shower || [])[i];
                            merged[wkKey].shave[i] = !!(lw.shave || [])[i];
                        }
                    }
                });
                v = merged;
            }
            if (!(k in data) || _stableStr(data[k]) !== _stableStr(v)) { data[k] = cloneSync(v); changed.push(k); }
        });
        store.commit(meta({ data, base: syncHash(cloud), sent: [] }), changed);
        return changed;
    }
    // 本机有未确认改动时来了一份云端快照。返回 true = 已处理
    function handlePendingSnapshot(cloud, h, uid, session) {
        if (!hasPending()) return false;
        if (h === syncHash(localData())) {   // 云端已经就是本机这份(自己刚推上去的回声)
            store.commit(Object.assign({}, S.doc, { ack: S.doc.rev, base: h, sent: [] }), []);
            showSyncStatus('已同步', 'ok');
            return true;
        }
        const own = ownSentRev(h);
        if (own >= 0) {   // 本机早先推的那一版落地了;之后又改的接着推
            store.commit(Object.assign({}, S.doc, { ack: Math.max(S.doc.ack, own), base: h, sent: (S.doc.sent || []).filter(x => x.rev > own) }), []);
            schedulePush(); return true;
        }
        const empty = !Object.keys(cloud).length;
        if (S.doc.base == null ? !empty : h !== S.doc.base) { pauseSyncConflict(cloud, uid, session, 'remote'); return true; }   // 别处也改过 → 停下来让她选
        if (S.doc.base == null) store.commit(Object.assign({}, S.doc, { base: h }), []);   // 云端是空的,没什么会被盖掉
        showSyncStatus('有改动等待同步', 'syncing');
        schedulePush(); return true;
    }
    function onCloudSnapshot(doc, uid, session) {
        if (!sessionMatches(uid, session)) return;
        // 本机自己刚写、还没到服务器的回声 / 离线缓存:都不是服务器的版本,不拿它判断任何事
        if (doc.metadata && (doc.metadata.hasPendingWrites || doc.metadata.fromCache)) return;
        const raw = doc.exists ? (doc.data() || {}) : {};
        const cloud = cloudSyncData(raw), h = syncHash(cloud);
        const first = !st.hydrated; st.hydrated = true;
        if (S.storageBlocked) { storageErr(); return; }
        try {
            if (st.conflict) {
                if (h === syncHash(localData())) {   // 两边又变成同一份了:不用选了
                    store.commit(meta({ ack: S.doc.rev, base: h, sent: [] }), []);
                    st.conflict = null; ui.closeSheet('sync-conflict'); showSyncStatus('已同步', 'ok');
                } else pauseSyncConflict(cloud, uid, session, st.conflict.reason);
                return;
            }
            if (S.doc.legacy && !settleLegacy(cloud, raw, uid, session)) return;
            if (handlePendingSnapshot(cloud, h, uid, session)) return;
            // 极简模式:昨天的处方先落成记录('derived'),再让云端的键盖进来(sk_planday1 会被盖掉)
            hook('absorbPrescribedHistory');
            if (S.storageBlocked) return;
            if (handlePendingSnapshot(cloud, h, uid, session)) return;
            const changed = applyCloudData(cloud);
            if (changed.length) hook('reloadFromStore');
            const matched = !!hook('autoMatchProfile', uid, st.user);
            if (matched) hook('reloadFromStore');
            if (changed.length || matched) applyCloudThenRender();
            if (hasPending()) schedulePush();
            showSyncStatus(changed.length ? '已从云端更新' : '云端已连接', 'ok');
            if (first) hook('onFirstSnapshot', !!doc.exists, uid);
        } catch (e) { storageErr(); }
    }
    function setupRealtimeSync() {
        if (!st.db || !st.user) return;
        if (st.unsub) st.unsub();
        const uid = st.user.uid, session = st.session;
        st.unsub = st.db.collection('users').doc(uid).onSnapshot({ includeMetadataChanges: true }, doc => onCloudSnapshot(doc, uid, session),
            e => { if (sessionMatches(uid, session)) showSyncStatus('连不上云端', 'err'); });
    }

    // ── 两边都改了:暂停同步,两份都另存,让她选一整份(不自动合并)──
    function pauseSyncConflict(cloud, uid, session, reason) {
        if (!sessionMatches(uid, session)) return;
        const prev = st.conflict;
        st.conflict = { uid, session, cloud: cloneSync(cloud), reason };
        T.clearTimeout(st.pushTimer); st.pushTimer = null;
        try { store.backup(uid, S.doc.data, 'local-before-choice'); store.backup(uid, cloud, 'cloud-before-choice'); }
        catch (e) { storageErr(); }
        showSyncStatus('同步暂停', 'paused');
        // 第一次发现就弹;点过「稍后再选」的,云端又变了只更新状态,不追着弹(sheet 开着就刷新内容)
        if (!prev || ui.hasSheet('sync-conflict')) showSyncConflict();
    }
    function showSyncConflict() {
        const c = st.conflict; if (!c) return;
        const head = c.reason === 'legacy'
            ? '升级后第一次同步，这台设备和云端的记录对不上，分不清哪份新。'
            : '这台设备有还没传上去的改动，云端同时也被别的设备改过。';
        ui.openSheet({ id: 'sync-conflict', title: '两边的记录对不上', noClose: true, stack: true,
            text: head + '不会自动合并，选一份接着用。\n\n这台设备：' + syncSummary(S.doc.data) + '\n云端：' + syncSummary(c.cloud)
                + '\n\n两份都已另存，选哪份，另一份都还在「设置 › 数据 › 恢复副本」里。',
            actions: [
                { label: '用这台设备的', fn: () => resolveSyncConflict('local', c.uid, c.session) },
                { label: '用云端的', fn: () => resolveSyncConflict('cloud', c.uid, c.session) },
                { label: '稍后再选', fn: () => { showSyncStatus('同步暂停', 'paused'); ui.toast('先不同步，改动照样存在这台设备上。想好了去设置里选。', 4000); } }
            ] });
    }
    function resolveSyncConflict(choice, uid, session) {
        if (!sessionMatches(uid, session) || !st.conflict || ['local', 'cloud'].indexOf(choice) < 0) return false;
        const cloud = st.conflict.cloud;
        try {
            // 两份副本没存上就不让选(选了就回不去)
            store.backup(uid, S.doc.data, 'local-before-choice');
            store.backup(uid, cloud, 'cloud-before-choice');
            // 用这台设备的:两边都有的以本机为准;只有云端有的键(比如旧版本 App 没有的顾问状态)先补进来,别顺手删掉
            if (choice === 'local') {
                const pulled = Object.keys(cloud).filter(k => !(k in S.doc.data));
                store.commit(meta({ data: Object.assign({}, cloudSyncData(cloud), S.doc.data), base: syncHash(cloud), sent: [], rev: S.doc.rev + 1 }), pulled);
            }
            else store.commit(meta({ base: syncHash(cloud), sent: [], ack: S.doc.rev, data: cloneSync(cloud) }), CLOUD_KEYS);
        } catch (e) { storageErr(); showSyncConflict(); return false; }
        st.conflict = null; ui.closeSheet('sync-conflict');
        hook('reloadFromStore');
        hook('autoMatchProfile', uid, st.user);
        applyCloudThenRender();
        showSyncStatus(choice === 'local' ? '有改动等待同步' : '已同步', choice === 'local' ? 'syncing' : 'ok');
        schedulePush();
        return true;
    }

    // ── 恢复副本:列出 / 下载 / 换成某一份 ──
    function syncRecoveryCopies(uid) { return store.recoveryCopies(uid); }
    function showSyncRecovery() {
        st.recoveryList = syncRecoveryCopies();
        if (!st.recoveryList.length) { ui.sysAlert('这个账号在这台设备上没有恢复副本。升级、或者同步时两边对不上，才会自动存一份。', '恢复副本'); return; }
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const when = s => { const d = new Date(s); return isNaN(d) ? '' : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
        const rows = st.recoveryList.map((c, i) => `<div class="sheet-sec"><div class="sec-t">${esc(when(c.savedAt))} · ${esc(RECOVERY_LABEL[c.reason] || '副本')}</div>`
            + `<p class="note">${esc(c.data ? syncSummary(c.data) : '原样留着，下载下来能看')}</p><div class="btn-row"><button class="btn" type="button" data-rc-dl="${i}">下载</button>`
            + (c.data ? `<button class="btn" type="button" data-rc-use="${i}">换成这份</button>` : '') + `</div></div>`).join('');
        ui.openSheet({ id: 'sync-recovery', title: '恢复副本', full: true,
            html: '<p class="note">升级、或者同步时两边对不上，会自动另存一份，只存在这台设备上。换成某一份之前，现在的记录也会先另存一份。</p>' + rows,
            actions: [{ label: '关闭' }],
            onMount: ov => {
                ov.querySelectorAll('[data-rc-dl]').forEach(b => { b.onclick = () => downloadSyncCopy(+b.dataset.rcDl); });
                ov.querySelectorAll('[data-rc-use]').forEach(b => { b.onclick = () => restoreSyncCopy(+b.dataset.rcUse); });
            } });
    }
    function downloadSyncCopy(i) {
        const c = st.recoveryList[i]; if (!c) return;
        const body = c.data ? JSON.stringify(Object.assign({ _meta: { version: 3, exported: c.savedAt, app: '护肤计划', recovery: c.reason } }, c.data), null, 2) : String(c.raw || '');
        if (ui.download) ui.download('skincare_recovery_' + String(c.savedAt).slice(0, 19).replace(/[:T]/g, '-') + '.json', body);
    }
    // 「换成这一份」(恢复副本 / 导入备份共用):先另存恢复副本,存不上就不换;整份一次提交(不会只换进一半);重画;推送。返回 true = 换好了
    function replaceWithData(data, reason) {
        try {
            store.backup(S.owner, S.doc.data, reason || 'before-restore');
            store.commit(Object.assign({}, S.doc, { data: cloudSyncData(data), rev: S.doc.rev + 1 }), CLOUD_KEYS);
        } catch (e) { storageErr(); return false; }
        hook('reloadFromStore'); hook('renderAll');
        schedulePush();
        return true;
    }
    function restoreSyncCopy(i) {
        const c = st.recoveryList[i]; if (!c || !c.data) return;
        ui.sysConfirm('换成这份记录？现在的记录会先另存一份副本，换完会照常同步。', () => {
            if (!replaceWithData(c.data, 'before-restore')) return;
            ui.closeSheet('sync-recovery');
            ui.toast('换好了');
        }, { title: '换成这份', ok: '换成这份' });
    }

    // ── 推送 ──
    function schedulePush(delay) {
        if (!st.db || !st.user || !st.hydrated || S.doc.legacy || st.conflict || S.storageBlocked || !hasPending()) return;
        if (st.pushing) { st.pushDirty = true; return; }
        if (st.pushBackoff && st.pushTimer) return;   // 正在退避:别每改一下就再撞一次网络,等那次重试(或 online)
        const uid = st.user.uid, session = st.session;
        T.clearTimeout(st.pushTimer);
        st.pushTimer = T.setTimeout(() => { if (sessionMatches(uid, session)) pushToCloud(); }, delay == null ? 2000 : delay);
    }
    // 上传:Firestore 事务里先读云端,还是「上次确认的那份」(或本机自己早先推的某一版)才写;否则是别处改过 → 暂停让她选。
    // 推送失败:指数退避(4s → 8s → … 最多 1 分钟),恢复网络(online 事件)立刻补推。离线时事务完成不了,改动留在信封里。
    async function pushToCloud() {
        if (!st.db || !st.user || !st.hydrated || S.doc.legacy || st.conflict || S.storageBlocked || !hasPending()) return;
        T.clearTimeout(st.pushTimer); st.pushTimer = null;   // 计时器已触发/被冲刷,清掉句柄
        if (st.pushing) { st.pushDirty = true; return; }      // 别丢掉推送中到来的改动
        const uid = st.user.uid, session = st.session, revision = S.doc.rev, base = S.doc.base;
        const payload = localData(), hash = syncHash(payload), stamp = store.now();
        try {   // 先记下「这一版推出去过」:超时后它才落地,下次在云端看到它也认得是自己写的
            const sent = (S.doc.sent || []).filter(x => x.hash !== hash).concat([{ rev: revision, hash }]).slice(-5);
            store.commit(Object.assign({}, S.doc, { sent }), []);
        } catch (e) { return; }
        const own = new Set(S.doc.sent.map(x => x.hash));
        st.pushing = true; st.pushDirty = false;
        let timer = null, failed = false;
        const db = st.db;
        try {
            // 加超时:离线时事务可能永不 settle,旧版会把 pushing 永久卡死 → 之后所有修改再也不上传
            const res = await Promise.race([
                db.runTransaction(async tx => {
                    // Firestore 可能重跑这个回调:这里只读只算,不碰本机任何状态
                    const ref = db.collection('users').doc(uid);
                    const snap = await tx.get(ref);
                    const raw = snap.exists ? (snap.data() || {}) : {};
                    const cloud = cloudSyncData(raw), h = syncHash(cloud);
                    if (h === hash) return h;   // 云端已经是这一版(上次超时其实写成了)
                    const known = base == null ? !Object.keys(cloud).length : (h === base || own.has(h));
                    if (!known) throw Object.assign(new Error('sync-conflict'), { syncCloud: cloud });
                    const out = {};
                    Object.keys(raw).forEach(k => { if (CLOUD_KEYS.indexOf(k) < 0) out[k] = raw[k]; });   // 云键以外的字段原样留着
                    Object.assign(out, payload, { _updatedAt: stamp });   // 版本戳:旧版本 App 还靠它判断新旧
                    tx.set(ref, out);   // 整份替换(不用 merge):本机删掉的字段在云端也真的删掉,不会被下一次快照带回来
                    return hash;
                }),
                new Promise((_, rej) => { timer = T.setTimeout(() => rej(new Error('timeout')), 15000); })
            ]);
            if (!sessionMatches(uid, session)) return;
            if (S.doc.ack < revision) store.commit(Object.assign({}, S.doc, { ack: revision, base: res, pushedAt: stamp, sent: (S.doc.sent || []).filter(x => x.rev > revision) }), []);
            store.setLocal(LOCAL_KEYS.lastPush, String(stamp));
            st.pushBackoff = 0;
            showSyncStatus(hasPending() ? '有改动等待同步' : '已同步', hasPending() ? 'syncing' : 'ok');
        } catch (e) {
            if (!sessionMatches(uid, session)) return;
            if (e && e.syncCloud) { st.pushing = false; pauseSyncConflict(e.syncCloud, uid, session, 'remote'); return; }
            failed = true;
            st.pushBackoff = Math.min(60000, st.pushBackoff ? st.pushBackoff * 2 : 4000);
            showSyncStatus('离线 · 改动先存在本机', 'err');
        } finally {
            T.clearTimeout(timer);
            if (sessionMatches(uid, session)) {
                st.pushing = false;
                if (hasPending() && !st.conflict && !S.storageBlocked) {
                    T.clearTimeout(st.pushTimer);
                    st.pushTimer = T.setTimeout(() => { if (sessionMatches(uid, session)) pushToCloud(); }, failed ? st.pushBackoff : 1500);
                }
            }
        }
    }
    // 切后台 / 关页立即冲刷(8/15:手机一进后台 setTimeout 就冻结,2 秒防抖里攒着的「最后几下」永远推不出去)。
    // 冲刷不算确认:没等到云端确认的改动留在信封里(rev > ack),重开后接着推。
    function flushPendingPush() {
        if (!st.db || !st.user || !st.hydrated || st.conflict || !hasPending()) return;
        T.clearTimeout(st.pushTimer); st.pushTimer = null; pushToCloud();
    }
    function onOnline() {
        st.pushBackoff = 0;
        if (st.db && st.user && hasPending()) { T.clearTimeout(st.pushTimer); st.pushTimer = null; pushToCloud(); }
        else showSyncStatus('', st.syncState === 'err' ? 'ok' : st.syncState);
    }
    if (env.window && env.window.addEventListener) {
        env.window.addEventListener('online', onOnline);
        env.window.addEventListener('pagehide', flushPendingPush);
    }
    store.onDurable = () => schedulePush();

    return {
        state: st, get doc() { return S.doc; },
        setDb(db) { st.db = db; },
        setSdkMissing(v) { st.sdkMissing = !!v; },
        isOwner(user) { return isOwnerEmail(user && user.email); },
        handleAuthChange, onCloudSnapshot, schedulePush, pushToCloud, flushPendingPush, onOnline,
        showSyncConflict, resolveSyncConflict, showSyncRecovery, restoreSyncCopy, replaceWithData, downloadSyncCopy, syncRecoveryCopies,
        backupSyncData: (uid, data, reason) => store.backup(uid, data, reason),
        legacySyncDecision, syncLineText, showSyncStatus, hasPendingSync: hasPending, applyCloudThenRender
    };
}

// ══ 单窗口锁 ══════════════════════════════════════════════════════════════════════
// 【要紧】同一台设备同一时间只让一个窗口碰记录(Web Locks)。两个窗口各拿一份信封、各自上传会互相盖掉 ——
//    信封 + 事务防得住「两台设备」,防不住「同一台设备开了两个窗口」(它们共用一个 localStorage)。
//    拿不到锁:boot() 不跑,本机记录一个字不动(所有模块 import 时都不碰存储,见 store.js 顶部)。
//    浏览器没有 Web Locks:同样暂停。锁名和 v1 一样:v1、v2 的窗口互相排斥。
//    支持:Safari 与 iOS Safari 15.4 起、iOS 主屏 App(WKWebView)15.4 起、Chrome / Edge 69 起;只在 https 或本机地址下有。
//    刚刷新 / 导入后自动重开时,上一页的锁可能还没放,先自己悄悄重试几次再提示。
export const LOCK_NAME = 'skincare-account-storage';
export function startWithLock(env, boot) {
    const { navigator: nav, document: doc, window: win } = env;
    const setT = env.setTimeout || ((f, ms) => setTimeout(f, ms));
    let started = false, pending = false, tries = 0;
    function notice(title, text, retry) {
        let ov = doc.getElementById('app-lock');
        if (!ov) {
            ov = doc.createElement('div'); ov.id = 'app-lock'; ov.className = 'sheet-ov'; ov.dataset.noesc = '1';
            ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="app-lock-t"><div class="sheet-h"><h2 class="sheet-t" id="app-lock-t"></h2></div>'
                + '<div class="sheet-b text"></div><div class="sheet-actions"><button class="btn btn-primary" type="button">重试</button></div></div>';
            (doc.getElementById('sheet-root') || doc.body).appendChild(ov);
            ov.querySelector('button').onclick = () => { tries = 4; start(); };
        }
        ov.querySelector('.sheet-t').textContent = title;
        ov.querySelector('.sheet-b').textContent = text;
        ov.querySelector('.sheet-actions').hidden = !retry;
    }
    // boot() 的异常不能穿进锁回调:那样锁会被放掉、提示错写成「浏览器没给这一页加上保护」、重试按钮也点不动(v1 是另起 <script> 跑 App,天然隔离)
    function bootFailed(e) {
        let ov = doc.getElementById('boot-fail');
        if (!ov) {
            ov = doc.createElement('div'); ov.id = 'boot-fail'; ov.className = 'sheet-ov'; ov.dataset.noesc = '1';
            ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="boot-fail-t"><div class="sheet-h"><h2 class="sheet-t" id="boot-fail-t">启动时出错了</h2></div>'
                + '<div class="sheet-b text"><p class="lede">记录都在这台设备上，一个字没动。重新加载一次通常就好。</p><p class="note" id="boot-fail-msg"></p></div>'
                + '<div class="sheet-actions"><button class="btn btn-primary" type="button">重新加载</button></div></div>';
            (doc.getElementById('sheet-root') || doc.body).appendChild(ov);
            ov.querySelector('button').onclick = () => { try { win.location.reload(); } catch (x) { } };
        }
        const m = ov.querySelector('#boot-fail-msg'); if (m) m.textContent = (e && e.message) ? String(e.message).slice(0, 200) : '';
        try { console.error(e); } catch (x) { }
    }
    function run() {
        started = true;
        const ov = doc.getElementById('app-lock'); if (ov) ov.remove();
        try { boot(); } catch (e) { bootFailed(e); }   // 锁照样拿着(下面返回一个永不结束的 Promise)
    }
    function start() {
        if (started || pending) return;
        if (!nav.locks || !nav.locks.request) {
            notice('这个浏览器打不开', '这个浏览器保护不了「同时开两个窗口」，为了不弄乱记录，先不打开。这台设备上的记录都还在，一个字没动。换新版的 Safari 或 Chrome 打开就好。', false);
            return;
        }
        pending = true;
        nav.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, lock => {
            pending = false;
            if (!lock) {
                if (++tries < 5) { setT(start, 200 * tries); return; }
                notice('已经在别的窗口打开了', '护肤计划同一时间只能开一个窗口，免得两边的记录互相盖掉。关掉另一个窗口再点重试。这里什么都没改。', true);
                return;
            }
            run();
            return new Promise(() => { });   // 一直拿着;页面关掉时浏览器自己放
        }).catch(() => {
            pending = false;
            notice('暂时打不开', '浏览器没给这一页加上保护，先不打开，记录都还在。关掉别的护肤计划窗口再点重试。', true);
        });
    }
    // 模块都加载到了(能跑到这里):告诉 index.html 的看门狗别报「没加载完整」(等锁 / 锁提示另有它们自己的界面)
    try { const de = doc.documentElement; if (de && de.dataset && de.dataset.boot !== 'ok') de.dataset.boot = 'locking'; } catch (e) { }
    // 关掉另一个窗口回到这里时自己再试一次
    if (win && win.addEventListener) win.addEventListener('focus', () => { if (!started && doc.getElementById('app-lock')) { tries = 4; start(); } });
    start();
    return { get started() { return started; } };
}
