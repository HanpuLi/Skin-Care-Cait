// ══ 当前方案的规矩 ═══════════════════════════════════════════════════════════════════════
// 顾问方案在位时它就是权威(只过安全闸);没有就用离线阶梯。规矩 × 安全闸 = 今晚实际怎么排。
// 外加今晚流程和「要不要买」共用的口径(2026-08-28 事故:两把尺子 → 流程里停了、缺口里却算它顶着)。
import { memo, lastNDays, tagInDays, isExcluded, exfoliantCountInLastNDays, offset } from './util.js';
import { safetyGate } from './gate.js';
import { acidLadder, LADDER_MAX } from './ladder.js';
import { barrierScore } from './score.js';
import { isSchedActive, statusOf, hasTrait, cleanseStrength } from '../model/products.js';
import { PHASES, userZones } from '../model/profile.js';
import { daysBetween } from '../clock.js';

export function currentRegimen(W) { const h = W.regimen || []; return h.length ? h[h.length - 1] : null; }
export function aiRegimen(W) { const r = currentRegimen(W); return (r && r.source === 'ai' && r.rules) ? r : null; }
export function regimenRules(W) {
    return memo(W, 'rules', () => {
        const ai = aiRegimen(W);
        if (ai) return Object.assign({ acidZones: [], resting: [], include: [], zonesAdd: [] }, ai.rules, { source: 'ai' });
        const L = acidLadder(W);
        return { source: 'ladder', acidCap: L.level, acidName: '', acidZones: [], resting: [], include: [], zonesAdd: [], ladder: L };
    });
}
function nameSet(W, field) {
    const ai = aiRegimen(W), set = new Set();
    if (ai) (ai.rules[field] || []).forEach(x => { const n = typeof x === 'string' ? x : (x && x.name); if (n) set.add(String(n).trim()); });
    return set;
}
export function restedNow(W, p) { return !!p && nameSet(W, 'resting').has(p.name); }     // 顾问这一版点名「先不排」的
export function includedNow(W, p) { return !!p && nameSet(W, 'include').has(p.name); }    // 顾问点名「正式排进来」的(备用的也算启用)
// 今晚能不能把它排进流程:家里有、没标不用、这一版没被停、状态启用(或被顾问点名启用)
export function usableTonight(W, p) {
    return !!p && !p.hidden && !isExcluded(W, p) && !restedNow(W, p) && (isSchedActive(p, statusOf(p, W.ps)) || includedNow(W, p));
}
export function shelfProducts(W) { return (W.products || []).filter(p => !p.hidden && !isExcluded(W, p)); }
export function activeProducts(W) { return shelfProducts(W).filter(p => isSchedActive(p, statusOf(p, W.ps))); }
// 每周去角质上限 = 方案定的次数(顾问 / 离线阶梯),再被安全闸压一道
export function maxAcidPerWeek(W) {
    const r = regimenRules(W);
    const cap = Math.max(0, Math.min(7, Math.round(+r.acidCap || 0)));
    return Math.min(cap, safetyGate(W).acidCapMax);
}
// 维 A:安全闸放行 + 有一点耐受(离线阶梯 ≥2 档,或顾问方案)+ 这周刺激负荷没超
export function allowRetinol(W) {
    if (safetyGate(W).banRetinol) return false;
    if (regimenRules(W).source !== 'ai' && acidLadder(W).level < 2) return false;
    const cap = maxAcidPerWeek(W);
    if (cap > 0 && exfoliantCountInLastNDays(W, 7) > cap) return false;
    return true;
}
export function allowMask(W) { return !safetyGate(W).banMask; }
// 阶段只是标签:顾问方案写了就用它;否则在发炎 = 修护,阶梯封顶 = 维持,其余 = 建立耐受
export function currentPhase(W) {
    const ai = aiRegimen(W);
    if (ai && PHASES[ai.rules.phase]) return ai.rules.phase;
    if (safetyGate(W).irritated) return 'repair';
    return acidLadder(W).level >= LADDER_MAX ? 'maintenance' : 'tolerance';
}
// 分区避开项 = 她自己设的 + 顾问方案加的。【要紧】只能加不能减:顾问的方案里漏了某个区,也照样避开
export function zonesAvoiding(W, type) {
    const set = userZones(W.profile).filter(z => (z.avoid || []).includes(type)).map(z => z.name);
    const ai = aiRegimen(W);
    if (ai) {
        (ai.rules.zonesAdd || []).forEach(z => { if (z && z.name && (z.avoid || []).includes(type) && set.indexOf(z.name) < 0) set.push(z.name); });
        if (type === 'acid') (ai.rules.acidZones || []).forEach(n => { if (n && set.indexOf(n) < 0) set.push(n); });
    }
    return set;
}
export function zoneHintFor(W, type) { const zs = zonesAvoiding(W, type); return zs.length ? '（避开' + zs.join('、') + '）' : ''; }
// 刷酸时机偏好:'prefer' 洗澡夜优先 / 'neutral' / 'avoid' 避开洗澡夜。
// 没设过:有关注区域或近 14 天泛红 / 敏感 → 自动 avoid(热水浸泡后 TEWL 翻倍、pH 升高,PMC8778033;「酸优先洗澡夜」已被证据推翻,别改回去)
export function acidTiming(W) {
    const P = W.profile || {};
    if (P.acidTiming) return P.acidTiming;
    return (userZones(P).length > 0 || tagInDays(W, 14, ['泛红', '敏感'])) ? 'avoid' : 'neutral';
}
// 修护霜用法:'full' 全脸薄涂 / 'spot' 只点涂。先看硬事实(近 14 天闭口 / 痘 → 点涂,8/26 Cait 拍板),再退回旧判据。
// 她自己设的优先级最高,其次顾问方案。
export function repairUse(W) {
    const P = W.profile || {};
    if (P.repairUse) return P.repairUse;
    const ai = aiRegimen(W);
    if (ai && (ai.rules.repair === 'spot' || ai.rules.repair === 'full')) return ai.rules.repair;
    if (tagInDays(W, 14, ['闭口', '爆痘'])) return 'spot';
    const b = barrierScore(W);
    return (b !== null && b >= 70 && (P.skinType || '').includes('油')) ? 'spot' : 'full';
}
export function repairReason(W) {
    const P = W.profile || {};
    if (P.repairUse) return '你自己设定的';
    const ai = aiRegimen(W);
    if (ai && (ai.rules.repair === 'spot' || ai.rules.repair === 'full')) return ai.rules.repairWhy || '顾问方案定的';
    if (tagInDays(W, 14, ['闭口', '爆痘'])) return '近期有闭口/痘，全脸厚涂容易更闷';
    const b = barrierScore(W);
    if (b !== null && b >= 70 && (P.skinType || '').includes('油')) return '屏障稳、偏油，不必全脸厚涂';
    return '屏障优先，全脸薄薄一层';
}
// ── 今晚流程和缺口判断共用的口径 ──
export function irritatedNow(W) { return tagInDays(W, 3, ['泛红', '敏感', '爆痘']); }
export function calmDownMode(W) { return irritatedNow(W) || tagInDays(W, 14, ['闭口']); }
// 这支今天会不会真被涂上脸?不会就返回为什么(它也就顶不了任何一档)
export function blockedNow(W, p) {
    if (!p) return '家里没有这件东西';
    if (calmDownMode(W) && (hasTrait(p, 'fragranced') || hasTrait(p, 'oil-based'))) return '含精油/香精，正在泛红或闷闭口时要停';
    return null;
}
export function spotOnly(W, p) { return !!p && p.role === 'repair' && repairUse(W) === 'spot'; }   // 点在痘上的东西护不了整张脸
export function faceWide(p) { return !!p && p.role !== 'eye' && p.role !== 'spf' && p.role !== 'precleanse'; }
export function leaveOn(p) { return !!p && ['cleanse', 'precleanse', 'mask', 'soothe'].indexOf(p.role) < 0; }   // 冲洗掉的顶不了「洗完有东西护着」
// 洁面:泛红 / 敏感期或当晚刷酸 → 温和;洗澡夜或近期出油 → 清洁力强的
export function pickCleanser(W, list, ctx) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const irritated = tagInDays(W, 3, ['泛红', '敏感']), oily = tagInDays(W, 3, ['出油']);
    const want = (irritated || ctx.acidTonight) ? 'gentle' : ((ctx.shower || oily) ? 'strong' : 'normal');
    const hit = list.find(p => cleanseStrength(p) === want);
    if (hit) return hit;
    if (want === 'gentle') return list.find(p => cleanseStrength(p) !== 'strong') || list[0];
    return list[0];
}
export function cleanserReason(W, ctx) {
    if (tagInDays(W, 3, ['泛红', '敏感'])) return '最近有泛红、刺痛，今晚用温和的';
    if (ctx.acidTonight) return '今晚要刷酸，先用温和的洁面';
    if (ctx.shower) return '洗澡夜，用清洁力强一点的';
    return '';
}
// 新进货架的东西,前三晚先避开发红处薄涂(用 addedOn 判断,不依赖开封日期)
export const INTRO_NIGHTS = 3;
export function introNightsLeft(W, p) {
    if (!p || !p.addedOn) return 0;
    const d = daysBetween(p.addedOn, W.today);
    return (d >= 0 && d < INTRO_NIGHTS) ? (INTRO_NIGHTS - d) : 0;
}
export function introHint(W, p) {
    const n = introNightsLeft(W, p); if (!n) return '';
    const zs = zonesAvoiding(W, 'acid');
    return '（新加的，还剩 ' + n + ' 晚试用期：先薄涂一层，' + (zs.length ? '避开' + zs.join('、') : '避开正在发红/破皮的地方') + '；没有刺痛或加重，再全脸用）';
}
// 今晚的小改(顾问 change_tonight,sk_tnai1):只认今天的;过了今天自动失效
export function tonightOverride(W) {
    const o = W.tnai;
    return (o && o.date === W.today && Array.isArray(o.ops) && o.ops.length) ? o : null;
}
export function weekLoggedCount(W) { return new Set((W.journal || []).filter(x => x && x.date && x.date >= offset(W, -6) && x.date <= W.today && (x.status || []).length).map(x => x.date)).size; }
