// ══ 给顾问的上下文快照 buildSkincareContext(W, who) ═══════════════════════════════════════════
// 形状照后端契约:{user, skinType, concerns[], phase, products[], regimen{}, tonight{}, recentLogs[], assess{}, zones[], acid{}, week[], medical?, hrt?, low[], emptied[], region}
// 【要紧 · per-user HRT 门控】hrt 只在**当前用户本人**开了 HRT 时才带;日志里的 phase(HRT 阶段)也只在开了时才进快照。
//    数据本来就按 uid 隔离,Cici 的快照里永远没有 Cait 的东西;这里再保证 Cici 视角下即使日志里残留 phase 字段也不带。
// v2 新加(主会话 10/29 真测时顾问说「看不到这周是否已经刷过」):
//    acid{thisWeek[{date, product, auto}], recent[{date, product}], lastDate, daysSinceLast} —— 本周刷过酸的晚上 + 最近几次
//    week[{date, dayName, shower, shave, plan[]}] —— 未来 7 晚的洗澡 / 刮胡安排和离线排上的活性
// 纯函数:输入 world + 当前用户的少量信息,不碰存储、不碰 DOM。
import { safetyGate } from '../engine/gate.js';
import { assessSkin } from '../engine/assess.js';
import { barrierScore } from '../engine/score.js';
import { regimenRules, currentRegimen, maxAcidPerWeek, zonesAvoiding, repairUse, repairReason, currentPhase, restedNow, includedNow, introNightsLeft } from '../engine/rules.js';
import { tonight as tonightSteps, next7, acidHistory, offset } from '../engine/schedule.js';
import { lastNDays, acidTags, isExcluded } from '../engine/util.js';
import { regimenGaps } from '../engine/needs.js';
import { ROLE_LABEL, traitsOf, isSchedActive, statusOf, emptyLogRows } from '../model/products.js';
import { PHASES, userZones } from '../model/profile.js';
import { cleanSpots } from '../model/journal.js';

// who = { name?(显示名第一个词), ticked?[](今晚已点了做的步骤), shown?(ai/apply.js shownTonight:她眼前那份今晚;没有就按离线排法) }
export function buildSkincareContext(W, who) {
    who = who || {};
    const P = W.profile || {}, minimal = !!P.minimalMode;
    const reg = currentRegimen(W), rr = regimenRules(W), g = safetyGate(W), a = assessSkin(W);
    const statusText = p => isExcluded(W, p) ? '停' : restedNow(W, p) ? '这一版先不排' : (isSchedActive(p, statusOf(p, W.ps)) || includedNow(W, p)) ? '在用' : '备用';
    const low = W.low || [];
    const products = (W.products || []).filter(p => !p.hidden).map(p => {
        const o = { name: p.name, role: ROLE_LABEL[p.role] || p.role, traits: traitsOf(p), status: statusText(p) };
        if (low.indexOf(p.id) >= 0) o.low = true;
        if (introNightsLeft(W, p)) o.newIntro = true;
        return o;
    });
    const roleOf = n => { const p = (W.products || []).find(x => x.name === n); return p ? (ROLE_LABEL[p.role] || p.role) : ''; };
    let tonight = { steps: [], shower: false, shave: false, done: false };
    try {
        const tn = tonightSteps(W);
        const te = (W.journal || []).find(x => x.date === W.today);
        const sv = shownSteps(W, who.shown);
        tonight = { source: sv.source, steps: sv.steps.map(s => Object.assign({ role: roleOf(s.product), product: s.product }, s.kind && s.kind !== 'base' ? { kind: s.kind } : {})),
                    skipped: sv.skipped, shower: !!tn.shower, shave: !!tn.shave,
                    done: !!(te && te.done), ticked: (who.ticked || []).slice(0, 20), notDone: ((te && te.skipped) || []).slice(0, 8) };
    } catch (e) { }
    const tags = acidTags(W);
    const recentLogs = lastNDays(W, 14).map(e => {
        const o = { date: e.date, status: e.status || [], note: e.note || '' };
        if ((e.products || []).length) o.used = e.products;
        if ((e.products || []).some(x => tags.indexOf(x) >= 0)) o.acid = true;
        if (e.auto) o.auto = true;   // 极简模式按计划推定的,不是她记的
        if ((e.skipped || []).length) o.notDone = e.skipped.slice(0, 8);
        if (e.done) o.done = true;
        if (P.hrt && e.phase) o.hrtPhase = e.phase;   // 只在本人开了 HRT 时带
        o.spots = cleanSpots(e.spots).map(s => ({ zone: s.zone, type: s.type }));   // 没标就是空数组,顾问别猜位置
        if (e.photoAssess && e.photoAssess.usable !== false) o.photo = { overall: e.photoAssess.overall || '', zones: (e.photoAssess.zones || []).slice(0, 11) };
        return o;
    });
    const axes = {}; a.axes.forEach(x => { axes[x.key] = x.score; });
    const rules0 = (reg && reg.rules) || {};
    const ctx = {
        user: Object.assign({ name: who.name || '', mode: minimal ? '极简' : '完整' },
            minimal ? { modeNote: '极简模式：她基本不记录；排上的酸默认按计划用了(日志里 auto=true 是推定的，不是她记的)。没记到刺激不代表耐受，不能据此加量；只有她在对话/照片里明确说了反应才算。' } : {}),
        skinType: P.skinType || '',
        concerns: (P.concerns && P.concerns.length) ? P.concerns : (P.goal && P.goal.concern ? [P.goal.concern] : []),
        phase: (PHASES[currentPhase(W)] || {}).name || '',
        products,
        regimen: {
            v: reg ? reg.v : 0, source: rr.source === 'ai' ? '顾问' : '离线规则',
            rules: {
                acidCap: Math.round(+rr.acidCap || 0), acidCapNow: maxAcidPerWeek(W),
                acidName: rr.source === 'ai' ? (rr.acidName || '') : (rules0.acidName || ''),
                acidZones: zonesAvoiding(W, 'acid'), cleanse: (rr.source === 'ai' ? rr.cleanse : rules0.cleanse) || '',
                repair: repairUse(W), repairWhy: repairReason(W),
                resting: ((rr.source === 'ai' ? rr.resting : rules0.resting) || []).map(x => ({ name: x.name, why: x.why || '' })),
                include: rr.include || [], phase: currentPhase(W)
            },
            gaps: regimenGaps(W).map(x => ({ label: x.label, why: x.why }))
        },
        tonight,
        recentLogs,
        assess: { barrier: barrierScore(W), overall: a.overall, axes,
                  gate: { irritated: g.irritated, tags: g.tags, worsening: g.worsening, acidReaction: g.react, hrtFlare: g.hrtFlare, medical: g.medical, firstNight: g.firstNight, acidCapMax: g.acidCapMax, notes: g.notes } },
        zones: userZones(P).map(z => ({ name: z.name, avoid: z.avoid || [], care: z.care || '' })),
        acid: acidHistory(W, 6),
        week: next7(W).map((d, i) => ({ date: d.date, dayName: d.dayName, shower: d.shower, shave: d.shave,
            plan: (i === 0 && d.date === W.today && who.shown && who.shown.source === 'ai'
                ? who.shown.steps.filter(s => s.product && ['acid', 'mask', 'retinol'].indexOf(s.kind) >= 0).map(s => ({ type: s.kind, name: s.product }))
                : d.items).map(it => ({ type: it.type, product: it.name })) }))
    };
    if (rr.source !== 'ai') ctx.regimen.ladder = { level: rr.ladder.level, why: rr.ladder.why, uses: rr.ladder.uses };
    if (P.medical && P.medical.state) ctx.medical = { state: P.medical.state, date: P.medical.date || '', seenAt: P.medical.seenAt || '', note: P.medical.note || '' };
    // 引导里说的起点:在看医生 / 用药 → 顾问要知道(安全闸那边只排基础几样);刚开始时有发红刺痛也带上
    if (g.care) ctx.user.care = '在看医生 / 用药：医生开的药优先，护肤只做清洁、保湿、修护（她在设置里关掉之前一直这样）';
    else if (g.startIrritated) ctx.user.start = '刚开始用时说了有发红刺痛：头三晚不上酸、面膜、维 A';
    if (P.hrt) ctx.hrt = { on: true, flare: g.hrtFlare, recent: lastNDays(W, 14).filter(e => e.phase).map(e => ({ date: e.date, phase: e.phase })) };
    // 「要不要买新的」要看的:标了快用完的、近 60 天的空瓶、在哪个国家买
    ctx.low = (W.products || []).filter(p => !p.hidden && low.indexOf(p.id) >= 0).map(p => p.name);
    const from60 = offset(W, -59);
    ctx.emptied = emptyLogRows(W.empties, W.products).filter(r => r.date && r.date >= from60).map(r => ({ name: r.name, date: r.date, weeks: (r.weeks === undefined || r.weeks === null) ? null : r.weeks }));
    ctx.region = 'GB';
    return ctx;
}
// 她眼前的今晚(顾问版 / 离线)→ {source, steps[{product, kind}], skipped[]};纯动作(product 为空)不算步骤
function shownSteps(W, shown) {
    if (shown && Array.isArray(shown.steps)) {
        return { source: shown.source === 'ai' ? '顾问版（今晚页上显示的这份）' : '离线排法',
                 steps: shown.steps.filter(s => s.product).map(s => ({ product: s.product, kind: s.kind || 'base' })),
                 skipped: (shown.skips || []).slice(0, 8).map(x => typeof x === 'string' ? x : (x.product + (x.why ? '（' + x.why + '）' : ''))) };
    }
    const tn = tonightSteps(W);
    return { source: '离线排法', steps: tn.steps.filter(s => s.p).map(s => ({ product: s.p, kind: s.kind || 'base' })), skipped: tn.skips.slice(0, 8) };
}
// 每条对话另带的「此刻」:对话开头拍的快照整段不变(缓存命中省钱),会变的放这里。shown = 她眼前那份今晚
export function liveContext(W, shown) {
    const g = safetyGate(W), rr = regimenRules(W), reg = currentRegimen(W);
    let steps = [], source = '离线排法';
    try { const sv = shownSteps(W, shown); steps = sv.steps.map(s => s.product); source = sv.source; } catch (e) { }
    return { tonight: { source, steps }, regimen: { v: reg ? reg.v : 0, source: rr.source === 'ai' ? '顾问' : '离线规则', acidCapNow: maxAcidPerWeek(W), acidName: rr.acidName || '' }, gate: g.notes, acid: acidHistory(W, 3) };
}
