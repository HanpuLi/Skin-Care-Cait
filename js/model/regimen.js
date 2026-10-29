// ══ 方案版本 sk_regimen1:离线引擎 / 顾问的每一版、撤销、回到某一版 ══════════════════════════════
// 只留最近 12 版;挤出去时优先留顾问的版本。只有「当前这一版」能撤;撤销本身也记成一版,历史保持一条线。
// 【要紧】这里的函数**不**触发「要不要买」的重判:那件事只能由本机操作入口触发(ai/apply.js 的 local* 包装),
//    因为 syncRegimen 每次加载 / 云端落地后都会跑 —— 让它触发,每台设备各花一次钱(10/29 定案)。
import { K } from '../store.js';
import { buildWorld } from './world.js';
import { buildRegimen, regimenSig, regimenDiffReason, REGIMEN_ENGINE, usingList, gapList } from '../engine/regimen.js';
import { currentPhase } from '../engine/rules.js';
import { computePlan, buildNightSteps } from '../engine/schedule.js';

export function regimenHistory(store) { return store.lg(K.regimen) || []; }
export function currentRegimen(store) { const h = regimenHistory(store); return h.length ? h[h.length - 1] : null; }
export function newRegimenId(nowMs) { return 'r' + (nowMs || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6); }
export function trimRegimenHist(hist) {
    while (hist.length > 12) {
        const i = hist.findIndex((h, k) => k < hist.length - 1 && h.source !== 'ai');
        hist.splice(i >= 0 ? i : 0, 1);
    }
    return hist;
}
const W0 = (store, today) => buildWorld(store, { today, noAbsorb: true });
const iso = store => new Date(store.now()).toISOString();

// 唯一入口:指纹变了就出新版本。force = 用完了 / 补货 / 撤销 这类明确事件('user');自动重出一版 = 'system'(8/29 对推)。
// 顾问方案在位时它就是权威:皮肤状况的变化交给安全闸实时处理,不拿离线引擎的新版本盖掉它;只有货架真变了(force)才派生一版。
// 同一天里离线规则又变了 → 改写当天那一版(版本号不涨),别把历史冲掉。
export function syncRegimen(store, reason, force, today) {
    let hist = regimenHistory(store);
    const last = hist.length ? hist[hist.length - 1] : null;
    if (last && last.source === 'ai') return force ? deriveAiRegimen(store, last, reason, today) : null;
    const W = W0(store, today);
    const sig = regimenSig(W);
    if (!force && last && last.sig === sig) return null;
    const reg = buildRegimen(W);
    reg.sig = sig; reg.id = newRegimenId(store.now()); reg.at = iso(store);
    const sameDay = !!last && last.source === 'engine' && last.date === today && last.kind !== 'undo' && !force && !reason;
    const base = sameDay ? (hist.length > 1 ? hist[hist.length - 2] : null) : last;
    reg.v = sameDay ? last.v : (last ? (last.v || 0) : 0) + 1;
    reg.prevId = base ? base.id : null;
    const engChanged = !!last && last.source !== 'ai' && String(last.sig || '').indexOf(REGIMEN_ENGINE + '||') !== 0;
    reg.reason = reason || (engChanged ? '方案更新了：出油、闭口不再拉低屏障；刷酸从每周 1 次温和酸起步，按真实反应一档档加'
        : (base ? regimenDiffReason(base, reg) : '第一版：按家里现有的东西排'));
    if (sameDay) hist[hist.length - 1] = reg; else hist = hist.concat([reg]);
    store.ls(K.regimen, trimRegimenHist(hist), force ? 'user' : 'system');
    return reg;
}
// 货架变了(用完 / 补货)而当前是顾问方案:沿用顾问的规矩,只把家里已经没有的东西摘掉,标「待重排」
export function deriveAiRegimen(store, last, reason, today) {
    let W = W0(store, today);
    const have = n => !!W.products.find(p => p.name === n && !p.hidden);
    const r = JSON.parse(JSON.stringify(last.rules || {}));
    const dropped = [];
    if (r.acidName && !String(r.acidName).split(' / ').every(n => have(n.trim()))) { dropped.push(r.acidName); r.acidName = ''; }
    r.include = (r.include || []).filter(n => { if (have(n)) return true; dropped.push(n); return false; });
    r.resting = (r.resting || []).filter(x => x && have(x.name));
    const reg = Object.assign({}, last, {
        id: newRegimenId(store.now()), v: (last.v || 0) + 1, date: today, at: iso(store), rules: r, kind: 'derived', stale: true, blocked: [], prevId: last.id,
        reason: (reason || '货架变了') + (dropped.length ? '；方案里的「' + dropped.join('、') + '」家里没有了，这一版先摘掉' : '') + '。规矩沿用顾问上一版，可以让顾问按新货架重排。'
    });
    const hist = regimenHistory(store).concat([reg]).slice(-12);
    store.ls(K.regimen, hist);
    W = W0(store, today);
    reg.gaps = gapList(W); reg.using = usingList(W);
    hist[hist.length - 1] = reg; store.ls(K.regimen, hist);
    return reg;
}
// 顾问的方案落成一版(规矩已经过安全闸 —— ai/apply.js 的 validate*)。快照部分照常算;rules 用顾问的。
// meta = {kind:'plan'|'chat'|'review'|'tonight', reason, rationale, blocked[], model, cost}
export function commitAiRegimen(store, rules, meta, today) {
    meta = meta || {};
    let hist = regimenHistory(store);
    const last = hist.length ? hist[hist.length - 1] : null;
    const base = buildRegimen(W0(store, today));
    const reg = Object.assign(base, {
        id: newRegimenId(store.now()), v: (last ? (last.v || 0) : 0) + 1, source: 'ai', kind: meta.kind || 'plan',
        at: iso(store), sig: 'ai', prevId: last ? last.id : null,
        reason: meta.reason || '顾问出的方案', rationale: meta.rationale || '',
        blocked: meta.blocked || [], model: meta.model || '', cost: meta.cost == null ? null : meta.cost,
        rules: Object.assign({ acidCap: 1, acidName: '', acidZones: [], cleanse: '', repair: '', repairWhy: '', resting: [], include: [], zonesAdd: [], phase: '' }, rules)
    });
    delete reg.ladder;
    hist = hist.concat([reg]).slice(-12);
    store.ls(K.regimen, hist);
    // 规矩换了 → 按新规矩把「这一版的流程 / 在用 / 缺口」再算一遍写进快照
    const W = W0(store, today);
    try { const slot = computePlan(W).find(d => d.isToday) || { items: [] }; reg.steps = buildNightSteps(W, false, false, { items: slot.items || [] }).steps.map(x => ({ p: x.p, h: x.h })); } catch (e) { }
    reg.using = usingList(W); reg.gaps = gapList(W); reg.skin.phase = currentPhase(W);
    hist[hist.length - 1] = reg;
    store.ls(K.regimen, hist);
    return reg;
}
// 回到某一版:把那一版复制成新的一版(source 照旧)
export function restoreRegimen(store, id, reason, today) {
    const hist = regimenHistory(store);
    const src = hist.find(h => h.id === id); if (!src) return null;
    const last = hist[hist.length - 1];
    const reg = Object.assign(JSON.parse(JSON.stringify(src)), {
        id: newRegimenId(store.now()), v: (last ? (last.v || 0) : 0) + 1, date: today, at: iso(store), kind: 'undo', prevId: src.id, reason: reason || ('回到 v' + src.v)
    });
    if (reg.source !== 'ai') reg.sig = regimenSig(W0(store, today));
    store.ls(K.regimen, trimRegimenHist(hist.concat([reg])));
    return reg;
}
// 撤销 = 回到上一版。只有「当前这一版」能撤。返回 '' = 撤了;否则返回原因
export function undoRegimen(store, id, today) {
    const hist = regimenHistory(store);
    const last = hist[hist.length - 1];
    if (!last || last.id !== id) return '后面已经有新的一版了，这一版撤不了；要改回去直接跟顾问说';
    const prev = (last.prevId && hist.find(h => h.id === last.prevId)) || (hist.length > 1 ? hist[hist.length - 2] : null);
    if (!prev) {
        hist.pop(); store.ls(K.regimen, hist);
        syncRegimen(store, '撤销了 v' + last.v + '，回到离线规则', true, today);
        return '';
    }
    restoreRegimen(store, prev.id, '撤销了 v' + last.v + '，回到 v' + prev.v, today);
    return '';
}
