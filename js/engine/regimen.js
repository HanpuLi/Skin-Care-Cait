// ══ 一版方案的快照(离线引擎出的那一版,source:'engine')════════════════════════════════════
// Cait 2026-08-26:「每次皮肤状态有改变、有产品用完,都用现有产品针对当前皮肤状况作出一版新的护肤方案」。
// 版本的写入 / 撤销 / 顾问版落成在 model/regimen.js;这里只算(纯函数)。
// regimen 形状(和 v1 一样):{ id, v, date, at, source:'engine'|'ai', kind?, sig, prevId, reason, rationale?, blocked?[], stale?,
//   skin{overall, barrier, phase, tags[], axes[]}, ladder?{level, why}, rules{acidCap, acidName, acidZones[], repair, repairWhy, cleanse, resting[{name,why}], include[], zonesAdd[], phase},
//   steps[{p,h}], using[{id,name,role}], gaps[{key,label,why}], notes[{level,text}] }
import { lastNDays } from './util.js';
import { assessSkin } from './assess.js';
import { barrierScore } from './score.js';
import { safetyGate, gateBlocks } from './gate.js';
import { acidLadder } from './ladder.js';
import { maxAcidPerWeek, allowRetinol, currentPhase, zonesAvoiding, repairUse, repairReason, activeProducts, shelfProducts, restedNow, pickCleanser } from './rules.js';
import { computePlan, buildNightSteps } from './schedule.js';
import { regimenGaps } from './needs.js';
import { hasTrait, statusOf } from '../model/products.js';
import { userZones } from '../model/profile.js';

// 判断口径一改,旧方案会一直挂在那儿(指纹只看皮肤和货架,不看代码)→ 把引擎版本写进指纹,改口径就 +1。
// e4(2026-10-29):指纹去掉状态标签;同一天的离线版本合并成一版。【v2 不改口径,保持 e4:两版同开时不互相重出】
export const REGIMEN_ENGINE = 'e4';
// 方案的「指纹」只认**有意义的变化**:刷酸档位 / 手动覆盖 / 分区 / 诉求。
// 【要紧】不含当天的状态标签和安全闸(那些实时生效),否则一晚上点错几下就把只留 12 版的历史冲掉(AUDIT-ux P0-4)。
export function skinSignature(W) {
    const P = W.profile || {}, L = acidLadder(W);
    return [L.level, P.acidLevel || '', P.repairUse || '', P.acidTiming || '', userZones(P).map(z => z.name).sort().join(','), (P.concerns || []).join(',')].join('|');
}
export function shelfSignature(W) { return shelfProducts(W).map(p => p.id + ':' + statusOf(p, W.ps)).sort().join(','); }
export function regimenSig(W) { return REGIMEN_ENGINE + '||' + skinSignature(W) + '||' + shelfSignature(W); }
export function regimenSkinTags(W) { const set = []; lastNDays(W, 3).forEach(e => (e.status || []).forEach(t => { if (set.indexOf(t) < 0) set.push(t); })); return set; }
// 家里有、但这一版**故意不排**的活性 + 为什么。【注意】只看**未来**排上没有(过去推定的那一次不算)
export function restingProducts(W) {
    const out = [], cap = maxAcidPerWeek(W), g = safetyGate(W), planIds = new Set();
    let acidPlanned = false;
    computePlan(W).forEach(d => { if (d.isPast) return; (d.items || []).forEach(it => { if (it.id) planIds.add(it.id); if (it.type === 'acid') acidPlanned = true; }); });
    activeProducts(W).forEach(p => {
        const t = p.schedule && p.schedule.type;
        if (!(t === 'acid' || t === 'mask' || t === 'retinol') || planIds.has(p.id)) return;
        let why = '这一版没排上';
        const gb = gateBlocks(p, g, W);
        if (gb) why = gb;
        else if (hasTrait(p, 'scrub')) why = '磨砂：闭口、发炎的脸上搓只会更糟';
        else if (hasTrait(p, 'strong-exfo')) why = '猛酸：离线规则不自动排，想用跟顾问说（还得先过安全闸）';
        else if (t === 'acid' && cap === 0) why = '这周刷酸额度是 0';
        else if (t === 'acid') why = acidPlanned ? '同类里这一版先用另一支，别叠' : '这两周还没排上';
        else if (t === 'retinol' && !allowRetinol(W)) why = '先把温和酸练出耐受再加维 A';
        out.push({ id: p.id, name: p.name, why });
    });
    return out;
}
export function usingList(W) { return activeProducts(W).filter(p => !restedNow(W, p)).map(x => ({ id: x.id, name: x.name, role: x.role })); }
export function gapList(W) { return regimenGaps(W).map(g => ({ key: g.key, label: g.label, why: g.why })); }
export function buildRegimen(W) {
    const a = assessSkin(W), L = acidLadder(W), t = W.today;
    const plan = computePlan(W);
    const slot = plan.find(d => d.date === t) || { items: [] };
    const ns = buildNightSteps(W, false, false, { items: slot.items || [] });   // 版本快照不带「今晚的小改」
    const acidIds = [];
    plan.forEach(dd => { if (!dd.isPast) (dd.items || []).forEach(it => { if (it.type === 'acid' && it.id && acidIds.indexOf(it.id) < 0) acidIds.push(it.id); }); });
    const acidNames = acidIds.map(id => ((W.products || []).find(x => x.id === id) || {}).name).filter(Boolean);
    const cleanser = pickCleanser(W, activeProducts(W).filter(p => p.role === 'cleanse' && ((p.schedule && p.schedule.time) || ['pm']).indexOf('pm') >= 0), { shower: false, acidTonight: false });
    return {
        date: t, source: 'engine',
        skin: { overall: a.overall, barrier: barrierScore(W), phase: currentPhase(W), tags: regimenSkinTags(W), axes: a.axes.map(x => ({ key: x.key, name: x.name, score: x.score, dir: x.trend.dir })) },
        ladder: { level: L.level, why: L.why },
        rules: { acidCap: maxAcidPerWeek(W), acidName: acidNames.length ? acidNames.join(' / ') : null, acidZones: zonesAvoiding(W, 'acid'),
                 repair: repairUse(W), repairWhy: repairReason(W), cleanse: cleanser ? cleanser.name : null, resting: restingProducts(W), phase: currentPhase(W) },
        steps: ns.steps.map(x => ({ p: x.p, h: x.h })),
        using: usingList(W), gaps: gapList(W),
        notes: (a.recs || []).filter(r => r.level === 'safety' || r.level === 'warn').map(r => ({ level: r.level, text: r.text }))
    };
}
export function regimenDiffReason(prev, next) {
    const bits = [];
    const pIds = (prev.using || []).map(x => x.id), nIds = (next.using || []).map(x => x.id);
    (prev.using || []).forEach(x => { if (nIds.indexOf(x.id) < 0) bits.push('少了' + x.name); });
    (next.using || []).forEach(x => { if (pIds.indexOf(x.id) < 0) bits.push('多了' + x.name); });
    if (prev.rules && prev.rules.acidCap !== next.rules.acidCap) bits.push('刷酸从每周 ' + prev.rules.acidCap + ' 次改成 ' + next.rules.acidCap + ' 次' + (next.ladder ? '（' + next.ladder.why + '）' : ''));
    if (prev.rules && prev.rules.repair !== next.rules.repair) bits.push('修护霜改成' + (next.rules.repair === 'spot' ? '点涂' : '全脸薄涂'));
    if (prev.source === 'ai' && next.source !== 'ai') bits.push('回到离线规则');
    return bits.length ? bits.join('；') : '方案更新了';
}
export function regimenSummary(reg) {
    if (!reg) return '';
    const r = reg.rules || {}, bits = [];
    bits.push('刷酸：' + (r.acidCap ? (r.acidCap + ' 次/周' + (r.acidName ? '，用' + r.acidName : '') + (r.acidZones && r.acidZones.length ? '（避开' + r.acidZones.join('、') + '）' : '')) : '这一版先停'));
    if (r.cleanse) bits.push('洗脸：' + r.cleanse);
    bits.push('修护霜：' + (r.repair === 'spot' ? '只点涂' : '全脸薄涂') + (r.repairWhy ? '（' + r.repairWhy + '）' : ''));
    if ((r.resting || []).length) bits.push('先不排：' + r.resting.map(x => x.name).join('、'));
    if ((reg.gaps || []).length) bits.push('缺一环：' + reg.gaps.map(g => g.label).join('、') + '，家里没有能顶的了');
    return bits.join('\n');
}
