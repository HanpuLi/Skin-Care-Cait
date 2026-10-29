// ══ 皮肤分 v3:「没有损伤信号 = 健康」(2026-10-29 推翻重做)══════════════════════════════════
// 旧版以 60 为底、只有勾「稳定 / 好转」才加分、出油 -2 → 混油皮诚实勾「出油 + 闭口」永远 53–60 → 酸被锁 1 次/周半年(B1.5 查实)。
// 体质(出油 / 闭口)不是屏障损伤。现在每个标签只扣它真正伤到的那条轴;没记坏信号 = 100。
// 【要紧】这些分**只用来描述**(给人看 / 给顾问看),不卡酸频率:酸频率由方案定,危险由 gate.js 按硬事实拦。
import { lastNDays, offset } from './util.js';

export const AX_PENALTY = {
    '变差': { barrier: 30, calm: 25, congestion: 10 }, '泛红': { barrier: 25, calm: 25 }, '敏感': { barrier: 20, calm: 10 },
    '干燥': { barrier: 15 }, '爆痘': { calm: 25, congestion: 10 }, '出油': { oil: 30 }, '闭口': { congestion: 30 }, '粗糙': { congestion: 15 }
};
export const AX_RELIEF = 10, SCORE_PRIOR = 80, SCORE_FULL_N = 3;
export const AXES = [{ key: 'barrier', name: '屏障' }, { key: 'oil', name: '控油' }, { key: 'congestion', name: '清透' }, { key: 'calm', name: '无炎' }];
export function dayAxisScore(key, e) {
    const st = (e && e.status) || [];
    const ps = st.map(t => (AX_PENALTY[t] || {})[key] || 0).filter(x => x > 0).sort((a, b) => b - a);
    let pen = 0;
    ps.forEach((p, i) => { pen += i === 0 ? p : p * 0.5; });   // 同一天几个标签:最重的全额,其余减半
    if (st.indexOf('好转') >= 0) pen = Math.max(0, pen - AX_RELIEF);
    return Math.max(0, 100 - pen);
}
// 只吃记了皮肤状态的条目:只传照片 / 只写备注 / 极简模式推定的空条目不进分母;记录不足 3 天向 80 收敛
export function axisScore(key, entries) {
    entries = (entries || []).filter(e => e && (e.status || []).length);
    if (!entries.length) return null;
    const raw = entries.reduce((s, e) => s + dayAxisScore(key, e), 0) / entries.length;
    const conf = Math.min(1, entries.length / SCORE_FULL_N);
    return Math.max(0, Math.min(100, Math.round(SCORE_PRIOR + (raw - SCORE_PRIOR) * conf)));
}
export function barrierScore(W) { return axisScore('barrier', lastNDays(W, 7)); }
export function barrierSampleN(W) { return lastNDays(W, 7).filter(e => (e.status || []).length).length; }
export function barrierLabel(s) {
    if (s >= 85) return { label: '屏障优秀', cls: 'great' };
    if (s >= 65) return { label: '状态良好', cls: 'good' };
    if (s >= 45) return { label: '需要注意', cls: 'caution' };
    return { label: '重点修护', cls: 'repair' };
}
// 趋势:方向只认**明确的变化信号**(比昨天好 / 差),不拿标签多寡去猜(8/20:少勾一个标签被判成「好转」,红线被吞)
export function axisTrend(W, key) {
    const recent = lastNDays(W, 4);
    if (!recent.length) return { dir: 'flat', delta: 0, enough: false };
    const better = recent.filter(e => (e.status || []).includes('好转')).length;
    const worse = recent.filter(e => (e.status || []).includes('变差')).length;
    if (better || worse) { const d = (better - worse) * 8; return { dir: d >= 6 ? 'up' : d <= -6 ? 'down' : 'flat', delta: d, enough: true }; }
    const neg = es => es.some(e => (e.status || []).some(t => ((AX_PENALTY[t] || {})[key] || 0) > 0));
    const nowBad = neg(lastNDays(W, 2));
    const wasBad = neg((W.journal || []).filter(x => x && x.date && x.date >= offset(W, -6) && x.date <= offset(W, -3)));
    if (wasBad && !nowBad) return { dir: 'up', delta: 8, enough: true };
    if (!wasBad && nowBad) return { dir: 'down', delta: -8, enough: true };
    return { dir: 'flat', delta: 0, enough: recent.length >= 2 };
}
