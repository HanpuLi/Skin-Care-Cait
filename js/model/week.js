// ══ 洗澡 / 刮胡:sk_wk1(具体哪天)+ sk_preset1(每周习惯)—— 合并后的单一来源 ════════════════════
// 【10/29 合并】洗澡 / 刮胡习惯全 App 只有一份:sk_preset1([{dow, shower, shave}] × 7,本来就在 CLOUD_KEYS)。
//   PROFILE.showerDays 是旧数据(B3 的设置)和旧版本 App 读的那份:写的时候一起写(镜像),读的时候只在 sk_preset1 还没有时兜底。
// 某天洗不洗 / 刮不刮:sk_wk1 里那一周改过的以改过的为准;那一周还没动过就按习惯。
// 今晚(sk_tn1)和「接下来 7 晚」的今晚那行是同一份:都走 toggleTn → setDayState。
import { K } from '../store.js';
import { isoWeek, wkIdxForDate } from '../clock.js';

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
// 纯函数:w = {wk, preset, profile}
export function dayState(w, date) {
    const all = w.wk || {};
    const d = all[isoWeek(date)] || habitWeek(w.preset, w.profile);
    const i = wkIdxForDate(date);
    return { shower: !!d.shower[i], shave: !!d.shave[i] };
}

// ── 写(第一个参数 store)──
function wctx(store) { return { wk: store.lg(K.wk) || {}, preset: store.lg(K.preset), profile: store.lg(K.profile) || {} }; }
export function getDayState(store, date) { return dayState(wctx(store), date); }
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
// 写习惯:sk_preset1 + PROFILE.showerDays 镜像,一次写全(设置里和顾问页「存成每周习惯」都走这里)
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
        store.ls(K.tnsteps, { date: today, done: [] }, 'system');
    }
    return tn;
}
// 今晚开关:回写到排班本身(否则今晚跳过酸、7 晚里却还排着)
export function toggleTn(store, k, v, today) {
    const tn = initTN(store, today);
    tn[k] = v === undefined ? !tn[k] : !!v; tn.date = today;
    const s = getDayState(store, today);
    tn.manual = (tn.shower !== s.shower || tn.shave !== s.shave);
    setDayState(store, today, tn.shower, tn.shave, today);
    store.ls(K.tn, tn);
    return tn;
}
