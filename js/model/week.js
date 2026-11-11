// ══ 洗澡 / 刮胡:单一来源 ══════════════════════════════════════════════════════════════════════
// 【11/10 洗澡改成「隔 x 天」】Cait:「洗澡是隔 x 天洗而不是周几洗」。洗澡的数据全在已同步的 sk_profile1(不加云键):
//   showerEvery 1..7     每几天洗一次:1 = 每天,2 = 隔 1 天,3 = 隔 2 天……;没有 = 还没排(照旧按老数据)
//   showerSince 'YYYY-MM-DD'  从这天起按间隔算;它之前的日子照旧走 sk_wk1 / sk_preset1(历史不变)
//   showerMarks {'YYYY-MM-DD': true|false}  明确记下的「洗了 / 没洗 / 今晚不洗 / 今晚要洗」,任何日期都认,优先级最高
//   showerHist  {'YYYY-MM-DD': true|false}  since 挪走时冻结下来的「那天本来排的是什么」(不是她改的):since 之前的日子先认它、再认老数据。
//     和 showerMarks 分开放,洗澡页的日历才分得清「改过的」(她记的)和「按当时的间隔排的」(冻结的),改间隔以后过去的格子不会全标成改过
//   排上的默认算洗了(和极简模式「排上的默认算做了」一个道理):该洗的晚上点「今晚不洗」→ 明晚变成该洗;
//   没排但临时洗了 →「今晚要洗」→ 间隔从今天重新算。
// 刮胡不变:每周习惯 sk_preset1([{dow, shower, shave}] × 7)+ 某一周改过的 sk_wk1,只有 profile.shaving 的人才有。
//   sk_preset1 / sk_wk1 里的 shower 位和 profile.showerDays(镜像)现在只给 showerSince 之前的老日子用,也留给旧版本读。
// 今晚(sk_tn1)是排班的镜像:改了洗澡的记录 / 间隔、影响到今天,就同步写它(syncTn)。
import { K, LOCAL_KEYS } from '../store.js';
import { isoWeek, wkIdxForDate, addDays, daysBetween } from '../clock.js';

export function presetOk(p) { return Array.isArray(p) && p.length === 7 && p.every(x => x && typeof x.dow === 'number' && x.dow >= 0 && x.dow <= 6) && new Set(p.map(x => x.dow)).size === 7; }
export function habitPreset(preset, profile) {
    if (presetOk(preset)) return preset;
    const days = (profile && Array.isArray(profile.showerDays)) ? profile.showerDays : [];
    return [1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, shower: days.indexOf(d) >= 0, shave: false }));
}
export function habitWeek(preset, profile) {
    const hp = habitPreset(preset, profile), sh = Array(7).fill(false), sv = Array(7).fill(false);
    hp.forEach(x => { const i = x.dow === 0 ? 6 : x.dow - 1; sh[i] = !!x.shower; sv[i] = !!x.shave; });
    return { shower: sh, shave: sv };
}

// ── 洗澡:隔 x 天(纯函数;w = {wk, preset, profile},W 也是这个形状)──
export const SHOWER_MAX = 7;   // 最多「隔 6 天」
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
// 每几天洗一次;0 = 还没排
export function showerEvery(P) { const n = P && P.showerEvery; return typeof n === 'number' && n >= 1 && n <= SHOWER_MAX && n === Math.floor(n) ? n : 0; }
function intervalOf(P) { const n = showerEvery(P), s = P && P.showerSince; return n && isDate(s) ? { every: n, since: s } : null; }
function boolAt(o, date) { const v = o && typeof o === 'object' ? o[date] : undefined; return v === true || v === false ? v : undefined; }
function markOf(P, date) { return boolAt(P && P.showerMarks, date); }
// since 之前的日子:冻结下来的排法(showerHist)优先;没有就是老数据(sk_wk1 里那一周改过的以改过的为准,没动过就按每周习惯)
function legacyDay(w, date) {
    const d = (w.wk || {})[isoWeek(date)] || habitWeek(w.preset, w.profile), i = wkIdxForDate(date), h = boolAt((w.profile || {}).showerHist, date);
    return { shower: h !== undefined ? h : !!(d.shower || [])[i], shave: !!(d.shave || [])[i] };
}
// 从 since 往后逐日模拟。状态只有一个:离上次洗澡几天(gap)。
//   L 的初值 = since 之前最后一次洗澡:往前最多看 21 天,记下的(marks)优先,否则老数据;一次都没有 = null(since 那天就该洗)。
//   每天:s = marks[D] ?? (L 为空 || D - L >= every);s 为真则 L = D。纯函数、确定性、不看 today。
// 【为什么一直从 since 算,不从 date - 180 起算】起算点跟着 date 走,相邻两天的 L 初值来源不同,结果会对不上(连着两天都洗 / 一天都不洗);
//   记录又按 90 天修剪,修掉 since 之后的一条「没洗」会把之后的节奏整个挪一天。所以永远从 since 算,
//   长度靠写入时的 tidyShower 收住:since 早于 60 天前,就把近 30 天按当时的结果冻结成记录、since 挪到今天(结果一天不变)。
// 缓存:按 w 对象(buildWorld 每次给新的一份),数据变了(签名 / 引用对不上)就重算;只往后延,不回头。
const RUN = new WeakMap();
function runOf(w, iv) {
    const P = w.profile || {}, sig = iv.every + '|' + iv.since + '|' + JSON.stringify(P.showerMarks || null) + '|' + JSON.stringify(P.showerHist || null);
    let r = RUN.get(w);
    if (!r || r.sig !== sig || r.P !== P || r.wk !== w.wk || r.preset !== w.preset) {
        let L = null;
        for (let i = 1; i <= 21 && !L; i++) { const d = addDays(iv.since, -i), m = markOf(P, d); if (m === undefined ? legacyDay(w, d).shower : m) L = d; }
        r = { sig, P, wk: w.wk, preset: w.preset, at: {}, next: iv.since, gap: L ? daysBetween(L, iv.since) - 1 : null };
        RUN.set(w, r);
    }
    return r;
}
function simAt(w, iv, date) {
    const r = runOf(w, iv), P = w.profile || {};
    while (r.next <= date) {
        const D = r.next;
        if (r.gap !== null) r.gap++;
        const due = r.gap === null || r.gap >= iv.every, m = markOf(P, D), on = m === undefined ? due : m;
        r.at[D] = { on, due };
        if (on) r.gap = 0;
        r.next = addDays(D, 1);
    }
    return r.at[date];
}
// 某天洗不洗:{on 洗不洗, due 不算这天自己的记录时排的是什么, mark 这天记下的(没有 = undefined)}
export function showerDay(w, date) {
    const P = w.profile || {}, iv = intervalOf(P), m = markOf(P, date);
    if (iv && date >= iv.since) { const x = simAt(w, iv, date); return { on: x.on, due: x.due, mark: m }; }
    const lg = legacyDay(w, date).shower;
    return { on: m === undefined ? lg : m, due: lg, mark: m };
}
// 某天的洗澡 / 刮胡(全 App 都从这里读:排班、7 晚、提醒、顾问上下文)
export function dayState(w, date) {
    return { shower: showerDay(w, date).on, shave: legacyDay(w, date).shave };
}
// 洗澡模块 / 洗澡页要的那一句:今晚 + 上次(往前最多 60 天)+ 下次(往后最多 21 天)
export function showerInfo(w, today) {
    const P = w.profile || {}, x = showerDay(w, today);
    let last = '', next = '';
    for (let i = 1; i <= 60 && !last; i++) { const d = addDays(today, -i); if (showerDay(w, d).on) last = d; }
    for (let i = 1; i <= 21 && !next; i++) { const d = addDays(today, i); if (showerDay(w, d).on) next = d; }
    return { every: showerEvery(P), since: (intervalOf(P) || {}).since || '', on: x.on, due: x.due, mark: x.mark, last, next };
}
// 老习惯每周洗几天 → 每几天一次(迁移、旧入口 applyShowerPlan 用)
export function everyFromWeekly(n) { return n > 0 ? Math.min(SHOWER_MAX, Math.max(1, Math.round(7 / n))) : 0; }

// ── 写(第一个参数 store)──
function wctx(store, P) { return { wk: store.lg(K.wk) || {}, preset: store.lg(K.preset), profile: P || store.lg(K.profile) || {} }; }
export function getDayState(store, date) { return dayState(wctx(store), date); }
// 把 [from, to] 按现在的规则「排的是什么」(due)冻结进 showerHist。先全算完再写。
//   她自己记的(showerMarks)原样留着、照旧优先:那天洗没洗不变,「改过的」标记也不变;没记的那天 due 就是结果。所以任何一天的结果都不变
function freezeShower(P, w, from, to) {
    const vals = {};
    for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) vals[d] = showerDay(w, d).due;
    P.showerHist = Object.assign({}, P.showerHist || {}, vals);
}
// 写入前收拾。只在她点了东西('user' 写盘)时跑;每次加载的维护里不跑(写盘 = 推送,别引出 8/29 那种对推):
//   · since 早于 60 天前:近 30 天冻结成记录,since 挪到今天 —— 今天往后的结果不变,模拟长度有上限
//   · 记录和冻结的排法都只留 90 天:这时 since 一定晚于 60 天前,90 天前的早于「since 前 21 天」,不影响任何一天的计算
function tidyShower(P, store, today) {
    const iv = intervalOf(P);
    if (iv && iv.since < addDays(today, -60)) {
        freezeShower(P, wctx(store, P), addDays(today, -30), addDays(today, -1));
        P.showerSince = today;
    }
    const cut = addDays(today, -90);
    ['showerMarks', 'showerHist'].forEach(f => {
        const m = P[f], out = {};
        if (m && typeof m === 'object') Object.keys(m).forEach(k => { if (isDate(k) && k >= cut && (m[k] === true || m[k] === false)) out[k] = m[k]; });
        if (Object.keys(out).length) P[f] = out; else delete P[f];
    });
}
// 今晚的 sk_tn1 跟上排班(改了记录 / 间隔、影响到今天时)。'user':这是她点出来的
function syncTn(store, today) {
    const tn = initTN(store, today), s = getDayState(store, today);
    if (tn.shower === s.shower) return false;
    tn.shower = s.shower; tn.manual = tn.shave !== s.shave;
    return store.ls(K.tn, tn);
}
// 记下某天洗没洗(v = true / false;null = 撤回,回到按间隔排的)。任何日期都能记:过去的是记录,今天和以后是计划
export function setShowerMark(store, date, v, today) {
    if (!isDate(date) || !isDate(today)) return false;
    const P = store.lg(K.profile) || {};
    const m = Object.assign({}, P.showerMarks || {});
    if (v === true || v === false) m[date] = v; else delete m[date];
    P.showerMarks = m;
    delete P.noShowerPlan;   // 旧版的「先不排」不再用
    tidyShower(P, store, today);
    const ok = store.ls(K.profile, P);
    syncTn(store, today);
    return ok;
}
// 改间隔:先把 [max(since, 今天 - 30), 昨天] 按现在的规则冻结成记录(过去不跟着变),再从今天起按新间隔算
export function setShowerEvery(store, n, today) {
    n = Math.round(+n);
    if (!(n >= 1 && n <= SHOWER_MAX) || !isDate(today)) return false;
    const P = store.lg(K.profile) || {}, iv = intervalOf(P);
    if (iv && iv.every === n) return true;   // 没变(迁移那天 since 是明天:点同一个值也不动它)
    if (iv) {
        const from = iv.since > addDays(today, -30) ? iv.since : addDays(today, -30);
        if (from <= addDays(today, -1)) freezeShower(P, wctx(store, P), from, addDays(today, -1));
    }
    P.showerEvery = n; P.showerSince = today;
    delete P.noShowerPlan; delete P.showerFrom;   // 她自己定了,不再说「按以前每周 n 次折算的」
    tidyShower(P, store, today);
    const ok = store.ls(K.profile, P);
    syncTn(store, today);
    return ok;
}
// 迁移(每次加载 maintain() 都会调;'system'、幂等):showerEvery 还没有时,按老数据换算一次。
//   每周习惯 n 天 → 每 round(7 / n) 天一次(1..7);since = 第一次迁移那天的明天:今天照旧按老数据(保住今天手动改过的)。
//   习惯一天都没有、但 sk_wk1 里某几周按天点过洗澡(旧版页头胶囊 / 7 晚格子只写 sk_wk1,不写习惯)→ 按那几周的密度换算,
//     不然模块说「还没排」,今晚步骤、提醒、顾问却还照 sk_wk1 排着洗澡,两边说法打架。两样都没有 → 不设(模块显示「还没排」),也不写盘。
//   P.showerFrom = 折算前每周几次:洗澡页据此说一句「按你以前每周 n 次折算的」,她改了间隔就删。
// 【since 记在本机,不跟着 today 走】迁移是 'system' 写盘、不推送;在出现第一次会推送的写盘之前,每份云端快照都会把
//   sk_profile1 整份盖回没迁移的那份,渲染时再迁一次。since 要是取「今天的明天」,就会天天往后挪一天,间隔一直管不到今晚,
//   模块昨天说的「下次周五」今天就对不上。所以第一次迁出来的 since 按账号存在本机 sk_shmig1,重迁沿用同一天。
//   不改成 'derived' 推上去:两台设备各迁出不同的 since、各有待推改动,会弹整份冲突让她选。
export function migrateShowerInterval(store, today) {
    const P = store.lg(K.profile);
    if (!P || (P.showerEvery !== undefined && P.showerEvery !== null) || !isDate(today)) return false;
    const n = habitPreset(store.lg(K.preset), P).filter(x => x.shower).length;
    let every = everyFromWeekly(n), from = n;
    if (!every) {
        const wk = store.lg(K.wk) || {};
        let days = 0, on = 0;
        for (let i = -21; i <= 13; i++) { const dt = addDays(today, i), x = wk[isoWeek(dt)]; if (!x) continue; days++; if ((x.shower || [])[wkIdxForDate(dt)]) on++; }
        if (!on) return false;
        every = Math.min(SHOWER_MAX, Math.max(1, Math.round(days / on)));
        from = Math.max(1, Math.round(7 * on / days));
    }
    P.showerEvery = every;
    P.showerSince = migSince(store, today);
    P.showerFrom = from;
    return store.ls(K.profile, P, 'system');
}
const MIG_KEY = LOCAL_KEYS.showerMig;
function migSince(store, today) {
    if (typeof store.getLocal !== 'function') return addDays(today, 1);
    const uid = store.getLocal(LOCAL_KEYS.uid) || '';
    let r = null;
    try { r = JSON.parse(store.getLocal(MIG_KEY)); } catch (e) { }
    if (r && r.uid === uid && isDate(r.since)) return r.since;
    const since = addDays(today, 1);
    store.setLocal(MIG_KEY, JSON.stringify({ uid, since }));
    return since;
}

// ── 刮胡(连带老数据里的洗澡位)──
// 只能改今天或以后(过去的日子是事实,界面上标着不可更改)
export function setDayState(store, date, shower, shave, today, origin) {
    if (date < today) return false;
    const w = wctx(store), all = w.wk;
    const wk = isoWeek(date);
    if (!all[wk]) all[wk] = habitWeek(w.preset, w.profile);
    const i = wkIdxForDate(date);
    all[wk].shower[i] = !!shower; all[wk].shave[i] = !!shave;
    const keys = Object.keys(all).sort();
    while (keys.length > 12) delete all[keys.shift()];
    return store.ls(K.wk, all, origin);
}
// 写习惯:sk_preset1 + PROFILE.showerDays 镜像,一次写全(「接下来 7 晚」的刮胡习惯走这里;洗澡位原样带着,给旧版本读)
export function saveHabit(store, preset) {
    store.ls(K.preset, preset);
    const p = store.lg(K.profile) || {};
    p.showerDays = preset.filter(x => x.shower).map(x => x.dow).sort((a, b) => a - b);
    return store.ls(K.profile, p);
}
// 两份旧数据对齐(加载、云端落地后跑;只在对不上时写,写盘记 'system' 不推送 —— 别引出 8/29 那种对推):
//   · 两份都有、洗澡日对不上 → 洗澡日以 showerDays 为准(App 一直在按它默认排),刮胡日留 sk_preset1 的;
//     原来那份 sk_preset1 第一次被改之前原样存进 PROFILE.habitPrev(不丢)。
//   · 只有 sk_preset1 → 补出 showerDays 镜像。 · 只有 showerDays → 补出 sk_preset1。
export function syncHabitSources(store, today) {
    const p = store.lg(K.preset), ok = presetOk(p);
    const prof = store.lg(K.profile) || {};
    const sd = Array.isArray(prof.showerDays) ? prof.showerDays : null;
    if (ok && sd) {
        if (!p.some(x => !!x.shower !== (sd.indexOf(x.dow) >= 0))) return false;
        if (!prof.habitPrev) { prof.habitPrev = { at: today, preset: p }; store.ls(K.profile, prof, 'system'); }
        return store.ls(K.preset, p.map(x => Object.assign({}, x, { shower: sd.indexOf(x.dow) >= 0 })), 'system');
    } else if (ok) {
        prof.showerDays = p.filter(x => x.shower).map(x => x.dow).sort((a, b) => a - b);
        return store.ls(K.profile, prof, 'system');
    } else if (sd && sd.length) {
        return store.ls(K.preset, [1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, shower: sd.indexOf(d) >= 0, shave: false })), 'system');
    }
    return false;
}
// 今晚洗澡 / 刮胡。新的一天:按排班重置,清空今晚步骤的勾选('system':每天都会重算,不算改动)
export function initTN(store, today) {
    let tn = store.lg(K.tn) || { shower: false, shave: false, date: '', manual: false };
    if (tn.date !== today) {
        const s = getDayState(store, today);
        tn = { shower: s.shower, shave: s.shave, date: today, manual: false };
        store.ls(K.tn, tn, 'system');
        store.ls(K.tnsteps, { date: today, done: [], skipped: [] }, 'system');
    }
    return tn;
}
// 今晚开关。刮胡:回写到排班本身(否则今晚跳过酸、7 晚里却还排着)。
//   洗澡:排了间隔的走记录(setShowerMark;改回和排的一样 = 撤回记录);还没排间隔的照旧写老数据
export function toggleTn(store, k, v, today) {
    if (k === 'shower' && intervalOf(store.lg(K.profile) || {})) {
        const x = showerDay(wctx(store), today), want = v === undefined ? !x.on : !!v;
        setShowerMark(store, today, want === x.due ? null : want, today);
        return initTN(store, today);
    }
    const tn = initTN(store, today);
    tn[k] = v === undefined ? !tn[k] : !!v; tn.date = today;
    const s = getDayState(store, today);
    tn.manual = (tn.shower !== s.shower || tn.shave !== s.shave);
    setDayState(store, today, tn.shower, tn.shave, today);
    store.ls(K.tn, tn);
    return tn;
}
