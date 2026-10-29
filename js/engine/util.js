// ══ 引擎共用:world 读取 + 记忆化 ════════════════════════════════════════════════════════════
// 引擎(engine/*)全是纯函数:输入一个 world(W),输出结果;不碰 DOM、不碰 localStorage、不调 clock.today()。
// W 由 model/world.js 的 buildWorld(store) 拼好(之前先跑 absorbPrescribedHistory,见那里的注释),形状:
//   { today, profile, products(已归位、已滤掉用完的), ps, popen, journal, wk, preset, low[], gone[], empties, regimen(版本历史), tnai, tn, simExclude? }
// W 当作只读:要「假设少了某件」就 derive(W, {simExclude:id}) 造一个新的,别改原来的(记忆化按对象缓存)。
import { addDays } from '../clock.js';

const CACHE = new WeakMap();
export function memo(W, key, fn) {
    let m = CACHE.get(W);
    if (!m) CACHE.set(W, (m = new Map()));
    if (!m.has(key)) m.set(key, fn());
    return m.get(key);
}
export function derive(W, patch) { return Object.assign({}, W, patch); }
export function offset(W, n) { return addDays(W.today, n); }

// 近 n 天(含今天)的日志,按日期去重、降序;全用字符串比较
export function lastNDays(W, n) {
    return memo(W, 'jr' + n, () => {
        const from = offset(W, -(n - 1)), to = W.today, seen = new Set();
        return (W.journal || []).filter(x => x && x.date && x.date >= from && x.date <= to)
            .sort((a, b) => b.date.localeCompare(a.date))
            .filter(x => { if (seen.has(x.date)) return false; seen.add(x.date); return true; });
    });
}
export function statusDays(W, n, tags) { return lastNDays(W, n).filter(e => (e.status || []).some(s => tags.indexOf(s) >= 0)); }
export function tagInDays(W, n, tags) { return statusDays(W, n, tags).length > 0; }

export function isGone(W, id) { return (W.gone || []).indexOf(id) >= 0; }
export function isExcluded(W, p) { return !!p && (((W.profile || {}).excluded || []).includes(p.id) || W.simExclude === p.id); }
export function prodById(W, id) { return (W.products || []).find(p => p.id === id) || null; }
export function prodByName(W, n) { const s = String(n || '').trim(); return s ? ((W.products || []).find(p => p.name === s) || null) : null; }
const typeTags = (W, types) => (W.products || []).filter(p => !p.hidden && p.schedule && types.indexOf(p.schedule.type) >= 0).map(p => p.journalTag || p.name);
export function acidTags(W) { return memo(W, 'acidTags', () => typeTags(W, ['acid'])); }
// 泥膜也占「去角质额度」(产品备注:「使用当晚视为酸类占用」)
export function exfoliantTags(W) { return memo(W, 'exfoTags', () => typeTags(W, ['acid', 'mask'])); }
export function maskTags(W) { return typeTags(W, ['mask']); }
export function retinolTags(W) { return typeTags(W, ['retinol']); }
// 近 n 天(滚动窗口,不用自然周)里有几天用过去角质
export function exfoliantCountInLastNDays(W, n) {
    const tags = exfoliantTags(W);
    return lastNDays(W, n).filter(x => (x.products || []).some(p => tags.includes(p))).length;
}
export function lastAcidEntry(W) {
    return memo(W, 'lastAcid', () => {
        const tags = acidTags(W);
        const e = (W.journal || []).filter(x => (x.products || []).some(p => tags.includes(p)));
        if (!e.length) return null;
        return e.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    });
}
export function lastAcidUsed(W) { const e = lastAcidEntry(W); return e ? ((e.products || []).find(p => acidTags(W).includes(p)) || null) : null; }
