// 引擎 + 模型 + 顾问层的不开浏览器单测。业务断言提炼自 v1 的 s-10 / s-16 / s-20 / s-33 / s-36 / s-70(那些是整页测试,针对旧单文件)。
// 引擎全是纯函数:造一份假 localStorage → createStore → buildWorld,直接问引擎。数据全是虚构的。
//   跑:  node t/engine-unit.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { createStore, CLOUD_KEYS, K, LOCAL_KEYS } from '../js/store.js';
import { addDays } from '../js/clock.js';
import { buildWorld, planNow } from '../js/model/world.js';
import { safetyGate, gateBlocks, isHrtFluctuation } from '../js/engine/gate.js';
import { medicalRedLine } from '../js/engine/redline.js';
import { acidLadder } from '../js/engine/ladder.js';
import { barrierScore } from '../js/engine/score.js';
import { regimenRules, acidTiming, maxAcidPerWeek } from '../js/engine/rules.js';
import { computePlan, tonight, next7, plandayOf, acidHistory } from '../js/engine/schedule.js';
import { regimenGaps, gapsIfGone, shopItems } from '../js/engine/needs.js';
import { skinSignature, regimenSig } from '../js/engine/regimen.js';
import { inferRole } from '../js/model/products.js';
import { setMedical } from '../js/model/profile.js';
import { toggleTn, setDayState, syncHabitSources, dayState } from '../js/model/week.js';
import { cleanPhotoAssess, setPhotoAssess } from '../js/model/journal.js';
import { syncRegimen, currentRegimen, commitAiRegimen } from '../js/model/regimen.js';
import { buildSkincareContext } from '../js/ai/context.js';
import { applyTonight, undoTonightChange, applyRegimen, validatePlan, gateTonightPlan, onShopLocalChange, undoRegimenChange, localToggleLow,
         shownTonight, next7Shown, localMarkRunOut, localUndoRunOut } from '../js/ai/apply.js';
import { liveContext } from '../js/ai/context.js';
import { medicalFollowUp } from '../js/ui/tonight.js';
import { parseSseBlock, aiClean, createAiClient } from '../js/ai/client.js';
import { localEditProduct, localDropProduct } from '../js/ui/products.js';
import { localUnGone as localUnGone2 } from '../js/ai/apply.js';
import { DEFAULT_PD } from '../js/model/products.js';
import { pushFacts, factsSig, nightOf, keyStepOf, shopNowIds, pushPrefs, PUSH_DEF } from '../js/ai/push.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = '2026-10-29';
const d = i => addDays(T, i);
const PC = "Paula's Choice 6%杏仁酸+2%乳酸", GG = 'Sunday Riley Good Genes';

function mkStore(seed) {
    const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    const LS = { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    return createStore({ localStorage: LS }).open();
}
// 和 v1 的 t/page-helpers.js __seed 同一套场景
const MIG = ['avene-remove-2026-08-26', 'all-normal-2026-08-26', 'tolerianeSens-open-2026-08-29'];
function full(o) {
    o = o || {};
    const j = [];
    for (let i = o.today ? 0 : -1; i >= -13; i--) j.push({ date: d(i), status: (o.status && o.status(i)) || ['出油', '闭口'], products: (o.products && o.products(i)) || [], note: '', phase: (o.phase && o.phase(i)) || '' });
    return mkStore(Object.assign({ sk_profile1: Object.assign({ shaving: true, hrt: false, minimalMode: false, showJournal: true, skinType: '混油皮 · 屏障修护', onboarded: true, autoMatched: 'cait' }, o.profile || {}),
        sk_jrnl1: o.jrnl || j, sk_gone1: ['avene', 'toleriane'].concat(o.gone || []), sk_mig1: MIG, sk_prods1: { goodGenes: 'active', drorganic: 'owned' } }, o.extra || {}));
}
function minimal(o) {
    o = o || {};
    const j = [];
    for (let i = -1; i >= -13; i--) j.push({ date: d(i), status: (o.status && o.status(i)) || [], products: (o.products && o.products(i)) || [], note: '', phase: '', auto: true });
    return mkStore(Object.assign({ sk_profile1: Object.assign({ shaving: false, hrt: false, minimalMode: true, showJournal: false, skinType: '油偏混 · 抗闭口', onboarded: true, autoMatched: 'cici',
        zones: [{ name: '人中/鼻下', avoid: ['acid', 'mask', 'retinol'], care: '只温和清洁 + 修护霜点涂' }] }, o.profile || {}),
        sk_jrnl1: o.jrnl || j, sk_gone1: ['avene', 'toleriane'].concat(o.nomoist ? ['tolerianeSens'] : []), sk_mig1: MIG, sk_prods1: { goodGenes: 'active', drorganic: 'owned' } }, o.extra || {}));
}
const W = (s, o) => buildWorld(s, Object.assign({ today: T }, o || {}));
const P = (w, id) => w.products.find(p => p.id === id);
const futureTypes = w => computePlan(w).filter(x => !x.isPast).flatMap(x => x.items.map(i => i.type));
const roleOf = (w, n) => ((w.products.find(p => p.name === n) || {}).role || '');

export async function runEngineUnit(S) {
    const t = (name, f) => { try { f(); } catch (e) { S.ok(false, name + ':抛异常 ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); } };

    // ═══ 安全闸(s-20)═══
    t('爆痘拦猛酸', () => {
        const s = full({ status: i => i === -1 ? ['爆痘'] : ['稳定'] }), w = W(s), g = safetyGate(w);
        const b = gateBlocks(P(w, 'goodGenes'), g, w);
        S.ok(g.irritated && /猛酸不上/.test(b || '') && b.indexOf('新痘') >= 0, '近 3 天爆痘:猛酸被拦,理由里写着是哪种刺激(新痘)', b);
        S.ok(g.notes.some(n => /近 3 天有/.test(n)) && g.acidCapMax === 1, '……notes 写「近 3 天有…」;持续没恶化保留温和酸 1 次/周(8/20)', g.notes);
        S.ok(tonight(w).steps.every(x => x.p !== GG) && futureTypes(w).length >= 0 && !computePlan(w).some(x => x.items.some(i => i.label === GG && !i.logged)), '今晚和未来几晚都没有猛酸');
        const r = applyTonight(s, { id: 't-gg', changes: [{ op: 'add', product: GG, why: '测试' }] }, T);
        S.ok(/猛酸不上/.test(r.result[0] || '') && r.state === 'failed' && !s.lg(K.tnai), '顾问想今晚加猛酸:同一道闸拦下,原因原样带回,sk_tnai1 没写', r.result);
        const s2 = full({ status: i => i === -1 ? ['爆痘', '变差'] : ['稳定'] });
        S.ok(safetyGate(W(s2)).acidCapMax === 0, '记了「差些」:酸也停(0)');
        const s3 = full({ status: i => i === -1 ? ['泛红'] : ['稳定'], products: i => i === -2 ? ['PC酸'] : [] });
        S.ok(safetyGate(W(s3)).react && safetyGate(W(s3)).acidCapMax === 0, '刷酸后两天内记到刺激:这次酸可能就是诱因,酸停');
    });
    for (const who of ['minimal', 'full']) t('就医红线 ' + who, () => {
        const s = (who === 'minimal' ? minimal : full)({ status: i => i >= -6 ? ['泛红'] : [] });
        let w = W(s); const g = safetyGate(w);
        S.ok(medicalRedLine(w).on && g.acidCapMax === 0, `${who}:就医红线亮了,酸的上限是 0`, g.notes);
        S.ok(/所有酸先停/.test(gateBlocks(P(w, 'pc'), g, w) || '') && /所有酸先停/.test(gateBlocks(P(w, 'votary'), g, w) || ''), `${who}:温和酸(杏仁酸 / 乳酸)也停`);
        const tn = tonight(w);
        const bad = tn.steps.filter(x => roleOf(w, x.p) && ['precleanse', 'cleanse', 'moist', 'repair', 'eye'].indexOf(roleOf(w, x.p)) < 0);
        S.ok(!bad.length && tn.steps.every(x => x.kind === 'base'), `${who}:今晚只排清洁 + 保湿 + 修护 + 眼霜`, tn.steps.map(x => x.p));
        S.ok(tn.skips.some(x => /今晚只做清洁、保湿、修护/.test(x)), `${who}:精华进了「今晚不用」并写明原因`, tn.skips);
        S.ok(!tn.skips.some(x => /眼/.test(x) && /今晚只做清洁/.test(x)) && tn.steps.some(x => roleOf(w, x.p) === 'eye'), `${who}:眼霜照用(Cait 10/29)`, tn.steps.map(x => x.p));
        S.ok(futureTypes(w).every(x => ['acid', 'mask', 'retinol'].indexOf(x) < 0), `${who}:未来几晚的离线排班也没有酸 / 面膜 / 维 A`, futureTypes(w));
        const v = validatePlan({ rules: { acidCap: 3, acidName: PC } }, g, w);
        S.ok(!v.rules.acidName && v.blocked.some(b => /所有酸先停/.test(b.why)), `${who}:顾问方案里点名的温和酸被闸拦下`, v.blocked);
        commitAiRegimen(s, v.rules, { kind: 'plan', reason: '测试', blocked: v.blocked }, T);
        w = W(s);
        S.ok(regimenRules(w).source === 'ai' && tonight(w).steps.every(x => x.kind === 'base') && futureTypes(w).every(x => x !== 'acid'), `${who}:顾问方案在位时,今晚和未来几晚照样没有酸`);
        const r = applyTonight(s, { id: 't-med', changes: [{ op: 'add', product: PC }] }, T);
        S.ok(/所有酸先停/.test(r.result[0] || ''), `${who}:顾问想今晚加温和酸,被拦`, r.result);
        setMedical(s, 'later', { until: d(7) }, T);
        S.ok(safetyGate(W(s)).acidCapMax === 0, `${who}:点「先不」:酸照样停`);
        setMedical(s, 'seen', { note: '测试备注' }, T);
        w = W(s);
        S.ok(!medicalRedLine(w).on && w.profile.medical.state === 'seen' && w.profile.medical.seenAt === T && safetyGate(w).acidCapMax > 0, `${who}:点「看过了」→ 红线解除`, w.profile.medical);
    });
    t('红线口径', () => {
        const days = (n, tag, from = -1) => Array.from({ length: n }, (_, k) => ({ date: d(from - k), status: tag, products: [], note: '', phase: '' }));
        const red = (jrnl, profile) => medicalRedLine(W(full({ jrnl, profile })));
        const a = red(days(7, ['爆痘']));
        S.ok(!a.on && a.acneDays === 7, '单颗痘拖 7 天(只记新痘):不亮(旧口径合计 5 天会误报)', a);
        const b = red(days(10, ['爆痘']));
        S.ok(b.on && b.by === 'acne' && b.why === '近两周冒痘 10 天', '新痘 10 天、最近还在:亮,写「近两周冒痘 10 天」', b);
        S.ok(!red(days(10, ['爆痘'], -4)).on, '新痘 10 天但最近 3 天没冒:不亮');
        const c = red(days(5, ['泛红']));
        S.ok(c.on && c.by === 'red' && c.why === '近两周泛红 5 天', '泛红 5 天、最近还在:亮', c);
        S.ok(!red(days(4, ['泛红'])).on, '泛红 4 天:不亮');
        S.ok(!red(days(5, ['泛红'], -4)).on, '泛红 5 天但最近 3 天没有:不亮');
        const mix = [-1, -2].map(i => ({ date: d(i), status: ['爆痘'] })).concat([-5, -6, -7, -8, -9].map(i => ({ date: d(i), status: ['泛红'] })));
        S.ok(!red(mix).on, '泛红 5 天但都在 5 天前、最近 3 天只有痘:不亮(那一类自己最近 3 天要还在)');
        const e = red(days(6, ['泛红', '爆痘']));
        S.ok(e.on && e.by === 'red' && e.redDays === 6 && e.acneDays === 6, '泛红 + 新痘同一天记 6 天:按泛红那条亮', e);
        const f = red(days(8, ['泛红']), { medical: { state: 'seen', seenAt: d(-5) } });
        S.ok(!f.on && f.redDays === 4, '看过医生(5 天前)后重新计数:之后只有 4 天泛红,不亮', f);
        const f2 = red(days(12, ['泛红']), { medical: { state: 'seen', seenAt: d(-7) } });
        S.ok(f2.on && f2.redDays === 6, '看过医生后又泛红 6 天、最近还在:重新亮', f2);
        const spotsOnly = Array.from({ length: 10 }, (_, k) => ({ date: d(-1 - k), status: [], spots: [{ zone: '口周', type: '泛红' }],
            photoAssess: cleanPhotoAssess({ usable: true, zones: [{ zone: '口周', findings: [{ type: '泛红', level: '多', confidence: '高' }] }] }) }));
        S.ok(!red(spotsOnly).on, '脸部地图的位置、照片分析的结果都不参与红线(只看记的状态)');
    });
    t('其他闸', () => {
        const first = W(full({ status: () => ['稳定'], profile: { oobeAt: T } }));
        S.ok(safetyGate(first).acidCapMax === 0 && safetyGate(first).notes.some(n => /第一晚/.test(n)), '第一晚(刚走完引导):不上任何活性');
        const hrtJ = i => i >= -2 ? '波动' : '';
        const cait = W(full({ status: () => ['稳定'], phase: hrtJ, profile: { hrt: true } })), g = safetyGate(cait);
        S.ok(g.hrtFlare && g.acidCapMax <= 1 && g.banOil && g.banStrong && g.banRetinol, 'HRT 波动期(本人开了 HRT):酸 ≤1、面油停、猛酸 / 维 A 不上', g);
        const cici = W(full({ status: () => ['稳定'], phase: hrtJ, profile: { hrt: false } }));
        S.ok(!safetyGate(cici).hrtFlare && !isHrtFluctuation('波动', { hrt: false }), '没开 HRT 的人:日志里残留的 phase 不算');
    });
    t('阶梯', () => {
        const uses = [-30, -26, -22, -18, -14, -10, -6];
        const j = []; for (let i = -1; i >= -40; i--) j.push({ date: d(i), status: [], products: uses.includes(i) ? ['PC酸'] : [], note: '', phase: '', auto: true });
        const m = acidLadder(W(minimal({ jrnl: j })));
        S.ok(m.uses >= 6 && m.level === 1 && m.events.every(e => e.kind === 'nolog') && /不会自己/.test(m.why), '极简:刷了 6 次以上、从没记到刺激,也停在 1 次/周(不自动升档)', m);
        const mr = acidLadder(W(minimal({ jrnl: j.map(e => e.date === d(-6) ? Object.assign({}, e, { status: ['泛红', '变差'] }) : e) })));
        S.ok(mr.level === 1, '极简:记了「差些 + 泛红」前后阶梯都是第 1 档(当晚停酸是闸的事)');
        const jf = []; for (let i = -1; i >= -40; i--) { const st = uses.map(u => u + 1).concat(uses).includes(i) ? ['稳定'] : []; const pr = uses.includes(i) ? ['PC酸'] : []; if (st.length || pr.length) jf.push({ date: d(i), status: st, products: pr, note: '', phase: '' }); }
        const f = acidLadder(W(full({ jrnl: jf })));
        S.ok(f.level >= 2 && f.events.some(e => e.kind === 'up'), '对照:完整模式刷完两天内记了「稳定」,连续 3 次干净会升档', f.events.map(e => e.kind));
    });
    t('屏障 + 角色', () => {
        const w = W(full({ today: true }));
        S.ok(w.journal.length >= 14 && barrierScore(w) >= 65, '14 天「出油 + 闭口」、从没「稳定」:屏障 ≥65(体质不是屏障损伤)', barrierScore(w));
        const ir = { gly: inferRole({ name: 'The Ordinary Glycolic Acid 7% Toning Solution' }), bha: inferRole({ name: '2% BHA Liquid Exfoliant' }), mask: inferRole({ name: 'Clarifying Clay Mask' }),
            ret: inferRole({ name: 'Differin Adapalene Gel' }), spf: inferRole({ name: 'Anthelios UVMune 400' }), unk: inferRole({ name: 'Mystery Bottle' }) };
        S.ok(ir.gly === 'acid' && ir.bha === 'acid' && ir.mask === 'mask' && ir.ret === 'retinol' && ir.spf === 'spf', 'inferRole:甘醇酸 / BHA → 酸,泥膜 → 面膜,阿达帕林 → 维 A,Anthelios → 防晒', ir);
        S.ok(ir.unk === '', 'inferRole:认不出的留空(不兜底成保湿)', ir.unk);
    });

    // ═══ 排班 / 今晚(s-10 / s-16)═══
    t('排班', () => {
        const s = full({ status: () => ['稳定'] });
        let w = W(s);
        S.ok(maxAcidPerWeek(w) === 1 && futureTypes(w).filter(x => x === 'acid').length === 1, '离线阶梯第 1 档:未来 7 晚只排 1 次酸', futureTypes(w));
        S.ok(!computePlan(w).some(x => !x.isPast && x.items.some(i => i.label === GG)), '猛酸从不自动排(状态启用也不排,只能顾问点名)');
        const acidDay = computePlan(w).find(x => !x.isPast && x.items.some(i => i.type === 'acid')).date;
        setDayState(s, acidDay, false, true, T);
        w = W(s);
        const moved = computePlan(w).find(x => x.date === acidDay);
        S.ok(!moved.items.some(i => i.type === 'acid') && futureTypes(w).filter(x => x === 'acid').length === 1, '把那晚改成刮胡:那晚不再刷酸,酸挪到别的晚上', moved.items);
        S.ok(!setDayState(s, d(-2), true, true, T), '过去的日子不能改(返回 false)');
        const n7 = next7(w);
        S.ok(n7.length === 7 && n7[0].date === T && n7.every(x => typeof x.shower === 'boolean' && typeof x.shave === 'boolean'), '接下来 7 晚:从今晚起 7 行,每行有洗澡 / 刮胡');
        toggleTn(s, 'shave', true, T);
        const tn = tonight(W(s));
        S.ok(tn.shave && !tn.steps.some(x => x.kind === 'acid') && tn.skips.some(x => /刮胡夜/.test(x)), '今晚刮胡:不上酸 / 维 A / 泥膜,「今晚不用」写明', tn.skips);
        S.ok(dayState({ wk: s.lg(K.wk), preset: s.lg(K.preset), profile: s.lg(K.profile) }, T).shave, '今晚开关回写到排班本身(sk_wk1 今天那格)');
    });
    t('刷酸时机', () => {
        const preset = [1, 2, 3, 4, 5, 6, 0].map(x => ({ dow: x, shower: x !== 0, shave: false }));
        const w = W(minimal({ status: () => [], extra: { sk_preset1: preset } }));
        const day = computePlan(w).find(x => !x.isPast && x.items.some(i => i.type === 'acid'));
        S.ok(acidTiming(w) === 'avoid' && day && !day.shower, '有关注区域 → 自动「避开洗澡夜」:酸排在没洗澡的那晚(热水后屏障通透,8/08 循证)', day && day.date);
    });
    t('极简推定', () => {
        const pd = { date: d(-1), items: [{ type: 'acid', name: PC, tag: 'PC酸' }] };
        const a = minimal({ extra: { sk_planday1: pd } }), before = a.state.doc.rev;
        const wa = W(a);
        const ea = wa.journal.find(e => e.date === d(-1));
        S.ok(ea.products.includes('PC酸') && ea.auto && a.state.doc.rev === before + 1, '极简:昨天排上的酸 → buildWorld 时推定成用了(derived,rev+1)—— 咽喉点在 buildWorld', ea);
        const j = []; for (let i = -1; i >= -13; i--) j.push({ date: d(i), status: [], products: [], note: '', phase: '', auto: true, skipped: i === -1 ? ['PC酸'] : undefined });
        const b = minimal({ jrnl: j, extra: { sk_planday1: pd } });
        S.ok(!W(b).journal.find(e => e.date === d(-1)).products.includes('PC酸'), '极简:点了「今晚没做」的酸第二天不补记');
        const c = full({ status: () => ['稳定'], extra: { sk_planday1: pd } });
        S.ok(!W(c).journal.find(e => e.date === d(-1)).products.includes('PC酸'), '完整模式:空白日不推定');
        const p = planNow(minimal({ status: () => [] }), { today: T });
        S.ok(p.W && JSON.stringify(plandayOf(p.W)) === JSON.stringify(p.W && minimalPlanday(p)), 'planNow 把今天的活性写进 sk_planday1');
    });
    t('今晚的小改', () => {
        const s = full({ status: () => ['稳定'] });
        const acidToday = computePlan(W(s)).find(x => x.isToday).items.some(i => i.type === 'acid');
        const r = applyTonight(s, { id: 't1', changes: [{ op: 'acid', level: 'stop', why: '测试' }] }, T);
        const w = W(s);
        S.ok(r.state === 'applied' && !computePlan(w).find(x => x.isToday).items.some(i => i.type === 'acid') && !plandayOf(w).items.some(i => i.type === 'acid'),
            '顾问停今晚的酸:今天的槽位里真的没有酸(第二天不会被推定成用了)', { acidToday, items: computePlan(w).find(x => x.isToday).items });
        const moist = tonight(w).steps.find(x => roleOf(w, x.p) === 'moist').p;
        applyTonight(s, { id: 't2', changes: [{ op: 'skip', product: moist }, { op: 'note', text: '顾问备注' }] }, T);
        S.ok(!tonight(W(s)).steps.some(x => x.p === moist) && W(s).journal.find(e => e.date === T).note.indexOf('顾问备注') >= 0, '跳过一步 + 记一笔:今晚步骤少了它,备注写进今天');
        S.ok(undoTonightChange(s, 't1', T) !== '' && undoTonightChange(s, 't2', T) === '', '只能撤最近一次');
        S.ok(tonight(W(s)).steps.some(x => x.p === moist) && (W(s).journal.find(e => e.date === T) || { note: '' }).note.indexOf('顾问备注') < 0, '撤销:步骤回来,顾问追加的备注一起退');
        const s2 = full({ status: () => ['稳定'] });
        applyTonight(s2, { id: 't3', changes: [{ op: 'note', text: '顾问备注' }] }, T);
        const jl = s2.lg(K.jrnl), en = jl.find(e => e.date === T); en.note += '；我自己写的'; s2.ls(K.jrnl, jl);
        undoTonightChange(s2, 't3', T);
        S.ok(s2.lg(K.jrnl).find(e => e.date === T).note === '我自己写的', '撤销只摘掉顾问追加的那段:中间她自己写的字留着(v1 会整段回到快照)', s2.lg(K.jrnl).find(e => e.date === T).note);
    });
    t('没有保湿', () => {
        const w = W(minimal({ nomoist: true, status: () => ['闭口'] }));
        S.ok(tonight(w).warnings.some(x => /洗完全脸没有能涂的东西了/.test(x.text)), '极简 + 没有保湿、修护霜只点涂:安全提示「洗完全脸没有能涂的东西了」(任何模式都给)');
    });

    // ═══ 要不要买(s-33 离线部分 + 8/28、8/29 的口径)═══
    t('要不要买', () => {
        const a = W(full({ gone: ['tolerianeSens'], status: i => i >= -2 ? ['泛红', '爆痘'] : ['出油'] }));
        const keys = shopItems(a).map(x => x.key);
        S.ok(keys.indexOf('hydrate+calm') >= 0 && keys.indexOf('hydrate') < 0 && keys.indexOf('calm-light') < 0, '没保湿 + 泛红:「缺保湿」「缺镇静」合并成一条(一支顶两档)', keys);
        const b = W(full({ status: i => i >= -2 ? ['泛红'] : ['出油'] }));
        S.ok(!regimenGaps(b).some(g => g.key === 'calm-light'), 'Toleriane Sensitive(烟酰胺)算「轻薄的镇静」:不报假缺口');
        const s = full({ status: () => ['出油', '闭口'] });
        localToggleLow(s, 'tolerianeSens', T);
        const c = W(s);
        const soon = shopItems(c).filter(x => x.soon);
        S.ok(gapsIfGone(c, 'tolerianeSens').some(g => g.key === 'hydrate') && soon.length === 1 && /提前买/.test(soon[0].what), '唯一的保湿标了快用完:提前买一条(排在真缺口后面)', soon);
        S.ok(!regimenGaps(c).length, '假设推演不落盘:推演完货架照旧,没有缺口(v1 的 _simExclude 复位问题在 v2 不存在)');
        S.ok(tonight(c).steps.some(x => /这支快用完了/.test(x.h)), '步骤上贴「这支快用完了」(在出口统一贴)');
        const e = W(full({ status: () => ['闭口'], profile: { excluded: ['pc', 'votary'] } }));
        S.ok(regimenGaps(e).some(g => g.key === 'gentle-exfo'), '近两周闭口、家里没有能用的温和酸:缺「温和疏通」(磨砂不算)');
    });

    // ═══ 方案版本 ═══
    t('方案版本', () => {
        const s0 = full({ status: () => ['稳定'] });
        const r1 = syncRegimen(s0, '', false, T), sig1 = skinSignature(W(s0));
        const j = s0.lg(K.jrnl); j.unshift({ date: T, status: ['泛红', '变差'], products: [], note: '', phase: '' }); s0.ls(K.jrnl, j);
        S.ok(r1 && r1.v === 1 && skinSignature(W(s0)) === sig1 && syncRegimen(s0, '', false, T) === null, '点状态不出新版本(指纹不含当天状态标签,AUDIT-ux P0-4)');
        S.ok(regimenSig(W(s0)).indexOf('e4||') === 0, '引擎版本 e4 不变(v1 / v2 同开时不互相重出方案)');
        let n = 0; onShopLocalChange(() => { n++; });
        const s = full({ status: i => i === -1 ? ['爆痘'] : ['稳定'] });   // 新的一份(上面那份今天记了「差些」,酸本来就停);昨天冒痘 → 闸把酸压到 1 次/周
        syncRegimen(s, '', false, T);
        const rec = applyRegimen(s, [{ op: 'acid_freq', value: 3, product: PC, why: '测试' }], { id: 'p1' }, T);
        S.ok(rec.state === 'applied' && rec.blocked.some(b => b.partial && /先按 1 次/.test(b.why)) && currentRegimen(s).source === 'ai' && n === 1, '顾问改刷酸频率:直接生效成新一版;超过闸的部分写明「先按 N 次」;触发一次「要不要买」重判', { blocked: rec.blocked, n });
        S.ok(undoRegimenChange(s, rec.versionId, T) === '' && currentRegimen(s).source === 'engine' && currentRegimen(s).kind === 'undo' && n === 2, '撤销:回到上一版(本身也记成一版),也算本机操作');
        S.ok(undoRegimenChange(s, rec.versionId, T) !== '', '撤销过的那版不能再撤(后面已经有新的一版)');
        onShopLocalChange(null);
    });
    t('要不要买只在本机操作后触发', () => {
        const bad = ['js/store.js', 'js/sync.js', 'js/model/world.js', 'js/model/regimen.js', 'js/app.js'].filter(f => /shopLocalChange/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '')));
        S.ok(!bad.length, '同步 / 自动重出方案 / 启动路径的代码里没有 shopLocalChange(静态检查)', bad);
        let n = 0; onShopLocalChange(() => { n++; });
        const s = full({ status: () => ['稳定'] });
        syncRegimen(s, '', false, T); planNow(s, { today: T });
        S.ok(n === 0, '自动重出方案、排今天:不触发(行为计数 0)', n);
        onShopLocalChange(null);
    });

    // ═══ 顾问上下文(s-30 / s-36 / 主会话 10/29 要求)═══
    t('上下文', () => {
        const j = [{ date: d(-1), status: ['闭口'], products: ['PC酸'], note: '', phase: '稳定期', spots: [{ zone: '下巴', type: '闭口' }, { zone: '不存在', type: 'x' }] },
                   { date: d(-3), status: [], products: [], note: '', phase: '波动' }, { date: d(-9), status: ['稳定'], products: ['PC酸'], note: '', phase: '' }];
        const cici = buildSkincareContext(W(full({ jrnl: j, profile: { hrt: false } })), { name: 'C' });
        S.ok(!('hrt' in cici) && cici.recentLogs.every(x => !('hrtPhase' in x)), 'Cici 视角(没开 HRT):不带 hrt,日志里残留的 HRT 阶段也不带(per-user 门控)', cici.recentLogs);
        const cait = buildSkincareContext(W(full({ jrnl: j, profile: { hrt: true } })), { name: 'Cait' });
        S.ok(cait.hrt && cait.hrt.on && cait.recentLogs.some(x => x.hrtPhase === '波动'), 'Cait 开了 HRT:带 hrt 和每天的阶段');
        const day = cici.recentLogs.find(x => x.date === d(-1));
        S.ok(JSON.stringify(day.spots) === JSON.stringify([{ zone: '下巴', type: '闭口' }]) && cici.recentLogs.every(x => Array.isArray(x.spots)), '每天带 spots(清洗过;没标就是空数组)', day.spots);
        S.ok(cici.acid.thisWeek.length === 1 && cici.acid.thisWeek[0].date === d(-1) && cici.acid.thisWeek[0].product === PC
            && cici.acid.recent.map(x => x.date).join() === [d(-1), d(-9)].join() && cici.acid.daysSinceLast === 1, '带本周刷过酸的晚上(日期 + 哪支)和最近几次刷酸日期(真测时顾问说看不到)', cici.acid);
        S.ok(cici.week.length === 7 && cici.week[0].date === T && cici.week.every(x => 'shower' in x && 'shave' in x && Array.isArray(x.plan)), '带未来 7 晚的洗澡 / 刮胡安排(week)', cici.week[0]);
        S.ok(cici.region === 'GB' && Array.isArray(cici.low) && Array.isArray(cici.emptied) && cici.regimen.ladder && cici.products.length > 5, '带 low / emptied / region / 离线阶梯 / 产品库');
        const s = full({ status: () => ['稳定'] });
        setPhotoAssess(s, d(-1), { usable: true, overall: '下巴闭口少', zones: [{ zone: '下巴', findings: [{ type: '闭口', level: '少', confidence: '中' }, { type: '乱写', level: 'x' }] }] }, '2026-10-28T21:00:00Z');
        const pa = W(s).journal.find(e => e.date === d(-1)).photoAssess;
        S.ok(pa && pa.zones[0].findings.length === 1 && pa.zones[0].findings[0].confidence === '中' && buildSkincareContext(W(s)).recentLogs.find(x => x.date === d(-1)).photo, '照片分析结果:清洗后存进当天 photoAssess,顾问快照带上(照片本身不进)');
    });
    t('顾问写的今晚过闸', () => {
        const w = W(full({ status: i => i === -1 ? ['爆痘'] : ['稳定'] }));
        const r = gateTonightPlan(w, { title: '今晚', why: '稳住', steps: [{ product: '', how: '凉水冲洗' }, { product: 'Lacura 温和洗面奶', how: '洗' }, { product: GG, how: '涂' }, { product: '不存在的', how: '' }], skips: [] });
        S.ok(r && r.steps.length === 2 && r.blocked[0].product === GG && /猛酸不上/.test(r.blocked[0].why) && r.skips.some(x => x.product === GG) && r.dropped.indexOf('不存在的') >= 0,
            '/api/tonight:纯动作留着、闸拦的挪进「今晚不用」写明原因、库里没有的丢掉', r);
        const used = W(full({ status: () => ['稳定'], products: i => i === -2 ? ['PC酸'] : [] }));
        const r2 = gateTonightPlan(used, { steps: [{ product: PC, how: '涂' }, { product: 'Lacura 温和洗面奶', how: '洗' }] });
        S.ok(r2 && r2.blocked.some(b => b.product === PC && /这周已经刷过/.test(b.why)), '这周已经刷到上限:顾问写的酸也拦下', r2 && r2.blocked);
        S.ok(gateTonightPlan(w, { steps: [{ product: GG }] }) === null, '一步都不剩:返回 null(退回离线今晚)');
    });
    t('顾问写的今晚过闸(修复员 r1)', () => {
        const TS = 'La Roche-Posay Toleriane Sensitive Fluide', IPSA = 'IPSA 深层净化泥面膜', VOT = 'Votary 10%乳酸', LAC = 'Lacura 温和洗面奶';
        // ⑦ 分区避开项:顾问自己没写避开,也得补上和离线同一句
        const zw = W(full({ status: () => ['稳定'], profile: { zones: [{ name: '人中/鼻下', avoid: ['acid', 'mask', 'retinol'] }] } }));
        const z = gateTonightPlan(zw, { steps: [{ product: LAC, how: '洗' }, { product: PC, how: '全脸薄涂' }, { product: TS, how: '封层' }] });
        const zs = z && z.steps.find(x => x.product === PC);
        S.ok(zs && /避开人中\/鼻下/.test(zs.how) && /^全脸薄涂/.test(zs.how), '顾问那步没写避开:how 补上「（避开人中/鼻下）」', zs);
        const z2 = gateTonightPlan(zw, { steps: [{ product: PC, how: '薄涂，避开人中/鼻下' }] });
        S.ok(z2 && (z2.steps[0].how.match(/人中\/鼻下/g) || []).length === 1, '顾问已经写了避开:不重复补', z2 && z2.steps[0]);
        // 纯动作点名了酸:红线亮着也不能借一句话写进来
        const red = W(full({ status: () => ['泛红'] }));
        S.ok(safetyGate(red).medical, '(前提)近 14 天天天泛红:就医红线亮');
        const r = gateTonightPlan(red, { steps: [{ product: LAC, how: '洗' }, { product: '', how: "T 区薄涂一层 Paula's Choice 6%杏仁酸+2%乳酸，停 3 分钟" }, { product: '', how: 'T 区再刷一层酸' }, { product: '', how: '凉水冲洗' }, { product: TS, how: '封层' }] });
        S.ok(r && !r.steps.some(x => /杏仁酸|刷一层酸/.test(x.how) || x.product === PC) && r.steps.some(x => x.how === '凉水冲洗')
            && r.blocked.some(b => b.product === PC) && r.blocked.some(b => b.act && /就医/.test(b.why)), '红线亮:点名 PC 的纯动作按 PC 过闸被拦;没点名但写了「酸」的纯动作也拦;普通纯动作留着', r);
        const sw = W(full({ status: () => ['稳定'] }));
        const r3 = gateTonightPlan(sw, { steps: [{ product: PC, how: '薄涂' }, { product: '', how: '等 PC 酸干了再上保湿' }, { product: TS, how: '封层' }] });
        S.ok(r3 && r3.steps.length === 3 && r3.steps[1].product === '' && !r3.blocked.length, '纯动作点到的是已经单列的那支:当补充说明留着,不重复过闸', r3);
        // 泥膜和酸:同晚冲突 + 共用去角质额度
        const m = gateTonightPlan(sw, { steps: [{ product: LAC, how: '洗' }, { product: PC, how: '薄涂' }, { product: IPSA, how: '敷' }, { product: TS, how: '封层' }] });
        S.ok(m && m.steps.some(x => x.product === PC) && !m.steps.some(x => x.product === IPSA) && m.blocked.some(b => b.product === IPSA), '完整模式:顾问把 PC 酸和泥膜排同一晚 → 泥膜拦下', m && m.blocked);
        const mu = W(full({ status: () => ['稳定'], products: i => i === -2 ? ['泥面膜'] : [] }));
        const m2 = gateTonightPlan(mu, { steps: [{ product: LAC, how: '洗' }, { product: PC, how: '薄涂' }, { product: TS, how: '封层' }] });
        S.ok(m2 && m2.blocked.some(b => b.product === PC), '本周已经敷过泥膜(和酸共用额度,上限 1):顾问写的酸拦下', m2 && m2.blocked);
        const m3 = gateTonightPlan(sw, { steps: [{ product: IPSA, how: '敷' }, { product: PC, how: '薄涂' }, { product: TS, how: '封层' }] });
        S.ok(m3 && !m3.steps.some(x => x.product === PC) && m3.blocked.some(b => b.product === PC), '先排了泥膜、后排酸:酸也拦下(反过来同理)', m3 && m3.blocked);
        // change_tonight 的 swap:保湿不能被换成酸 / 泥膜
        const s1 = full({ status: () => ['稳定'], products: i => i === -1 ? ['PC酸'] : [] });
        const a1 = applyTonight(s1, { id: 'sw1', changes: [{ op: 'swap', product: TS, to: VOT }] }, T);
        const w1 = W(s1);
        S.ok(a1 && a1.result[0] && a1.state === 'failed' && !tonight(w1).steps.some(x => x.p === VOT), '本周额度已满:swap 保湿 → Votary 被拦,今晚没有 Votary', a1 && a1.result);
        const s2 = minimal();
        const a2 = applyTonight(s2, { id: 'sw2', changes: [{ op: 'swap', product: TS, to: IPSA }] }, T);
        S.ok(a2 && a2.result[0], '极简:swap 唯一的保湿 → 泥膜被拦', a2 && a2.result);
        // 就算 sk_tnai1 里已经有这种 swap(旧设备写的):离线今晚也不把活性换进来,保湿空了要报
        const s3 = minimal({ extra: { sk_tnai1: { date: T, id: 'old', ops: [{ op: 'swap', product: TS, to: IPSA }] } } });
        const tn3 = tonight(W(s3));
        S.ok(!tn3.steps.some(x => x.p === IPSA && x.kind === 'base'), '旧记录里的「保湿换泥膜」:离线今晚不把泥膜当普通步骤换进来', tn3.steps);
        const s4 = full({ status: () => ['稳定'], extra: { sk_tnai1: { date: T, id: 'old2', ops: [{ op: 'skip', product: TS }] } } });
        const tn4 = tonight(W(s4));
        S.ok(!tn4.steps.some(x => x.p === TS) && tn4.warnings.some(x => /保湿这一档是空的/.test(x.text)), '顾问跳过了唯一的保湿:「保湿这一档是空的」在小改落地之后才判', tn4);
    });
    t('client', () => {
        const b = parseSseBlock('event: delta\ndata: {"t":"好"}');
        S.ok(b.event === 'delta' && b.data.t === '好' && parseSseBlock('event: x\ndata: {bad') === null, 'SSE 块解析(坏 JSON 跳过)');
        S.ok(aiClean({ a: ['好的\u{1F600}'] }).a[0] === '好的', '顾问回来的字去 emoji');
    });
    t('货架:v1 写过的 sk_proddefs1 缺内置产品(用完过的)→ 买回来后能改、能拿掉', () => {
        // v1 每次改货架写的是滤掉了「用完了」的那份:Votary 不在 sk_proddefs1 里,但在 sk_gone1
        const v1defs = JSON.parse(JSON.stringify(DEFAULT_PD.filter(x => x.id !== 'votary')));
        const s = full({ extra: { sk_proddefs1: v1defs, sk_gone1: ['avene', 'toleriane', 'votary'] } });
        localUnGone2(s, 'votary', T);
        const e = localEditProduct(s, 'votary', { name: 'Votary 10%乳酸 新瓶' }, T);
        const defs1 = s.lg(K.prodDefs) || [];
        S.ok(e && defs1.some(x => x.id === 'votary' && x.name === 'Votary 10%乳酸 新瓶'), '编辑:落盘了(补回来的内置定义第一次写入就持久化)', e && e.name);
        const d = localDropProduct(s, 'votary', '不想用', T);
        const defs2 = s.lg(K.prodDefs) || [];
        S.ok(d && defs2.some(x => x.id === 'votary' && x.hidden && x.dropped), '不要了:能拿掉(返回非 null,定义上标 hidden + dropped)', d);
        S.ok(defs2.filter(x => x.id === 'votary').length === 1 && defs2.length === DEFAULT_PD.length, '补回来的不重复,其余内置不受影响', defs2.length);
    });
    t('client:去 emoji 去干净(肤色修饰符 / 国旗 / §3.12 符号)', () => {
        const cases = [['\u{1F44D}\u{1F3FB} 好的', '好的'], ['\u{1F1EC}\u{1F1E7} 英国', '英国'], ['\u2713 做完了', '做完了'], ['\u2605 重点', '重点'], ['\u{1F3FB} 今晚照常', '今晚照常'], ['前 7 天 \u2192 这 7 天', '前 7 天 \u2192 这 7 天']];
        const got = cases.map(([a]) => aiClean(a));
        S.ok(cases.every(([, b], i) => got[i] === b), '修饰符单独来也删(流式分段)、区域指示符、✓ ★ 都删;→ 不误删', got);
    });
    await (async () => {
        const LS0 = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
        const user = { uid: 'u1', getIdToken: async () => 'tok' };
        const mkc = (fetch, extra) => createAiClient(Object.assign({ base: 'http://x', getUser: () => user, fetch, localStorage: LS0(), today: () => T, wait: () => Promise.resolve(), limits: { point: 120, streamHead: 120, streamIdle: 120, assess: 120, shop: 120 } }, extra || {}));
        const hang = (u, init) => new Promise((res, rej) => { if (init && init.signal) init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
        try {
            // 卡住的请求到点放弃,后面排队的照常跑
            let calls = 0;
            const c = mkc((u, init) => { calls++; return /review/.test(u) ? hang(u, init) : Promise.resolve(new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 })); });
            const rv = c.api.review({}).catch(e => e);
            const tn = await c.api.tonight({});
            const e1 = await rv;
            S.ok(e1 && e1.code === 0 && /太久没回应/.test(e1.message) && tn && tn.data && tn.data.ok === 1, '卡住的请求超时放弃(code 0,中文提示),排在后面的今晚照常拿到', { e: e1 && e1.message, tn });
            // 流式中途断开:半截不当完整回答
            const enc = new TextEncoder();
            const brk = () => Promise.resolve(new Response(new ReadableStream({ start(ctl) { ctl.enqueue(enc.encode('event: delta\ndata: {"t":"今晚可以刷酸，但先"}\n\n')); setTimeout(() => ctl.error(new TypeError('Load failed')), 5); } }), { status: 200 }));
            const o = await mkc(brk).api.chat({ message: 'x' });
            S.ok(o.partial === true && o.code === 0 && /没收完/.test(o.err) && !/Load failed/.test(o.err), '流式断在半截:partial、code 0、中文提示(不透传 Load failed)', o);
            const eof = () => Promise.resolve(new Response(new ReadableStream({ start(ctl) { ctl.enqueue(enc.encode('event: delta\ndata: {"t":"半句"}\n\n')); ctl.close(); } }), { status: 200 }));
            const o2 = await mkc(eof).api.chat({ message: 'x' });
            S.ok(o2.partial === true && o2.err, '读到结尾却没有 done:也算半截', o2);
            const idle = () => Promise.resolve(new Response(new ReadableStream({ start(ctl) { ctl.enqueue(enc.encode('event: delta\ndata: {"t":"想"}\n\n')); } }), { status: 200 }));
            const o3 = await mkc(idle).api.chat({ message: 'x' });
            S.ok(o3.partial === true && o3.code === 0, '流式太久没动静:空闲超时断开,不会永远停在「在想」', o3);
            // abort:她点「停一下」
            const c4 = mkc(idle, { limits: { streamIdle: 5000, streamHead: 5000, point: 5000 } });
            const p4 = c4.api.chat({ message: 'x' });
            await new Promise(r => setTimeout(r, 30));
            const ab = c4.abort();
            const o4 = await p4;
            S.ok(ab && o4.aborted === true, 'abort() 取消当前这条流', o4);
            // token 刷新失败(离线):code 0、中文,不透 Firebase 英文
            const c5 = createAiClient({ base: 'http://x', getUser: () => ({ uid: 'u1', getIdToken: async () => { const e = new Error('Firebase: Error (auth/network-request-failed).'); e.code = 'auth/network-request-failed'; throw e; } }), fetch: () => { throw new Error('不该到这'); }, localStorage: LS0(), today: () => T });
            const e5 = await c5.api.tonight({}).catch(e => e);
            S.ok(e5 && e5.code === 0 && !/Firebase/.test(e5.message), 'getIdToken 抛 auth/network-request-failed:按连不上处理(code 0)', e5 && { m: e5.message, c: e5.code });
            // 401:先强制刷新 token 重试一次;仍 401 换成中文说明,不说「请先登录」
            const forced = [];
            const u6 = { uid: 'u1', getIdToken: async f => { forced.push(!!f); return f ? 'tok2' : 'tok1'; } };
            const f6 = (u, init) => Promise.resolve(new Response(JSON.stringify(init.headers.Authorization === 'Bearer tok2' ? { data: { ok: 2 } } : { error: '请先登录。', status: 'signed_out' }), { status: init.headers.Authorization === 'Bearer tok2' ? 200 : 401 }));
            const c6 = createAiClient({ base: 'http://x', getUser: () => u6, fetch: f6, localStorage: LS0(), today: () => T });
            const r6 = await c6.api.tonight({});
            S.ok(r6 && r6.data && r6.data.ok === 2 && forced.join() === 'false,true', '401:强制刷新 token 重试一次就过', { r6, forced });
            const c7 = createAiClient({ base: 'http://x', getUser: () => user, fetch: () => Promise.resolve(new Response(JSON.stringify({ error: '请先登录。', status: 'signed_out' }), { status: 401 })), localStorage: LS0(), today: () => T });
            const e7 = await c7.api.tonight({}).catch(e => e);
            S.ok(e7 && e7.code === 401 && !/请先登录/.test(e7.message) && /没认出你的登录/.test(e7.message), '一直 401:换成「暂时没认出你的登录」', e7 && e7.message);
        } catch (e) { S.ok(false, 'client 异步测试抛异常 ' + e.message, e.stack); }
    })();

    // ═══ 修复第 2 轮的回归 ═══
    const CLAY = 'IPSA 深层净化泥面膜', VOT = 'Votary 10%乳酸', LACURA = 'Lacura 温和洗面奶', TSENS = 'La Roche-Posay Toleriane Sensitive Fluide';
    t('泥膜:顾问「加一支」也查去角质额度和刮胡夜', () => {
        // HRT 波动期(酸 / 泥膜一起 ≤1 次/周),3 天前刷过 PC 酸
        const s = full({ profile: { hrt: true }, phase: i => i === -1 ? '剂量调整' : '', products: i => i === -3 ? ['PC酸'] : [], status: () => ['稳定'] });
        const w = W(s), g = safetyGate(w);
        S.ok(g.hrtFlare && g.acidCapMax === 1, '(前提)HRT 波动期,额度 1 次/周', g.notes);
        const r = applyTonight(s, { id: 't-clay', changes: [{ op: 'add', product: CLAY, why: '测试' }] }, T);
        S.ok(r.state === 'failed' && /上限/.test(r.result[0] || '') && !s.lg(K.tnai), '这周已经去角质 1 次:加泥膜被拦,sk_tnai1 没写', r.result);
        // 以前写进去的(或另一台设备同步来的)加泥膜小改:离线排法也不放进今晚的槽位
        s.ls(K.tnai, { date: T, id: 't-old', ops: [{ op: 'add', product: CLAY, to: '', level: '', why: '' }] });
        const w2 = W(s);
        S.ok(!tonight(w2).steps.some(x => x.p === CLAY) && !(plandayOf(w2).items || []).some(x => x.name === CLAY), '离线今晚和 planday 都没有泥膜', plandayOf(w2).items);
        // 极简 + 刮胡夜
        const m = minimal({ profile: { shaving: true } });
        toggleTn(m, 'shave', true, T);
        const r2 = applyTonight(m, { id: 't-clay2', changes: [{ op: 'add', product: CLAY }] }, T);
        S.ok(r2.state === 'failed' && /刮胡夜/.test(r2.result[0] || ''), '刮胡夜加泥膜:被拦,写明「刮胡夜不上酸、维 A、泥膜」', r2.result);
        m.ls(K.tnai, { date: T, id: 't-old2', ops: [{ op: 'add', product: CLAY, to: '', level: '', why: '' }] });
        const wm = W(m);
        S.ok(!(plandayOf(wm).items || []).some(x => x.type === 'mask'), '刮胡夜:planday 里没有泥膜(第二天不会被推定成敷过)', plandayOf(wm).items);
        S.ok(!computePlan(wm).filter(d => !d.isPast && d.shave).some(d => d.items.some(i => i.type === 'mask' && !i.logged)), '刮胡的晚上槽位里都没有泥膜');
    });
    const AI_ACID = { title: '刷酸夜', why: '测试', steps: [{ product: LACURA, how: '洗', why: '' }, { product: VOT, how: '薄涂', why: '顾问排的酸' }, { product: TSENS, how: '封层', why: '' }], skips: [] };
    t('她眼前的今晚:对话的上下文和 change_tonight 对的是今晚页上那份', () => {
        const s = full({ status: () => ['稳定'] }), w = W(s);
        const sh = shownTonight(w, AI_ACID);
        S.ok(sh.source === 'ai' && sh.steps.some(x => x.product === VOT && x.kind === 'acid'), '(前提)顾问版今晚有 Votary 酸', sh.steps.map(x => x.product));
        const ctx = buildSkincareContext(w, { shown: sh }), live = liveContext(w, sh);
        S.ok(/顾问版/.test(ctx.tonight.source) && ctx.tonight.steps.some(x => x.product === VOT) && live.tonight.steps.indexOf(VOT) >= 0, '上下文 tonight / live 都是顾问版(带来源)', { src: ctx.tonight.source, live: live.tonight });
        const n7 = next7Shown(w, sh);
        S.ok(n7[0].items.some(i => i.type === 'acid' && i.name === VOT), '未来 7 晚的今晚那格按顾问版标「酸」', n7[0].items);
        const r = applyTonight(s, { id: 't-skipv', changes: [{ op: 'skip', product: VOT, why: '有点刺' }] }, T, { aiData: AI_ACID });
        S.ok(r.state === 'applied' && !r.result[0], '对话里跳过眼前这支酸:生效', r.result);
        const sh2 = shownTonight(W(s), AI_ACID);
        S.ok(!sh2.steps.some(x => x.product === VOT) && sh2.skips.some(x => x.product === VOT), '今晚页上这支消失,进「今晚不用」', sh2.steps.map(x => x.product));
        const r2 = applyTonight(s, { id: 't-skipx', changes: [{ op: 'skip', product: 'Dr Sebagh Rose de Vie 精华' }] }, T, { aiData: AI_ACID });
        S.ok(r2.state === 'failed' && /没有这支/.test(r2.result[0] || ''), '跳过顾问版里根本没有的一步:记为没改成,不算 applied', r2.result);
    });
    t('顾问版今晚也要「洗完全脸有东西护着」', () => {
        const bare = { title: '刷酸夜', why: '', steps: [{ product: LACURA, how: '', why: '' }, { product: PC, how: '', why: '' }] };
        const s = full({ status: () => ['稳定'] }), sh = shownTonight(W(s), bare);
        const moist = sh.steps.find(x => x.added);
        S.ok(sh.source === 'ai' && moist && roleOf(W(s), moist.product) === 'moist' && /按规则补上/.test(moist.why) && !(sh.warnings || []).some(x => x.key === 'cover'),
            '顾问只排洁面 + 酸:按规则补上一支保湿(写明是补的),不再出「没东西涂」', sh.steps.map(x => x.product + (x.added ? '+' : '')));
        const s2 = full({ status: () => ['稳定'], gone: ['tolerianeSens'], extra: { sk_profile1: { shaving: true, hrt: false, minimalMode: false, showJournal: true, onboarded: true, autoMatched: 'cait', repairUse: 'spot' } } });
        const sh2 = shownTonight(W(s2), bare);
        S.ok((sh2.warnings || []).some(x => x.key === 'cover'), '货架上没有能补的保湿:出「洗完全脸没有能涂的」安全提示', sh2.warnings);
    });
    t('引导里说的起点真的生效', () => {
        const s = full({ status: () => ['稳定'], profile: { startState: 'irritated', oobeAt: d(-1) } }), w = W(s), g = safetyGate(w);
        S.ok(g.startIrritated && g.acidCapMax === 0 && !tonight(w).steps.some(x => x.kind === 'acid'), '「有发红刺痛」:引导后第二晚也不上酸', g.notes);
        const s2 = full({ status: () => ['稳定'], profile: { startState: 'irritated', oobeAt: d(-3) } });
        S.ok(!safetyGate(W(s2)).startIrritated, '三晚之后恢复照常');
        const s3 = full({ status: () => ['稳定'], profile: { startState: 'care', careAt: d(-20), oobeAt: d(-20) } }), w3 = W(s3), g3 = safetyGate(w3);
        const bad = tonight(w3).steps.map(x => w3.products.find(p => p.name === x.p)).filter(p => p && ['precleanse', 'cleanse', 'moist', 'repair', 'spf', 'eye'].indexOf(p.role) < 0);
        S.ok(g3.care && g3.acidCapMax === 0 && !bad.length && /设置里能改/.test(g3.notes.join()), '「在看医生 / 用药」:只排清洁、保湿、修护、眼霜,写明设置里能改', bad.map(p => p.name));
        S.ok(/在看医生/.test(buildSkincareContext(w3, {}).user.care || ''), '顾问的上下文里带着这一条');
        S.ok(!safetyGate(W(full({ status: () => ['稳定'], profile: { startState: 'care', oobeAt: d(-200) } }))).care, 'v1 引导里选过、没有 careAt 的老账号:不凭空收紧(和 v1 算的一样)');
    });
    t('「其实没用完」原样退回', () => {
        const s = full({ extra: { sk_popen1: { pc: '2026-03-01' }, sk_prods1: { goodGenes: 'active', drorganic: 'owned', pc: 'paused' }, sk_low1: ['pc'] } });
        const KS = [K.popen, K.prods, K.low, K.empty, K.gone], snap = () => KS.map(k => JSON.stringify(s.lg(k)));
        const before = snap(), nReg = (s.lg(K.regimen) || []).length;
        const out = localMarkRunOut(s, 'pc', T);
        S.ok(out && JSON.stringify(s.lg(K.empty)) !== 'null' && s.lg(K.gone).indexOf('pc') >= 0, '(前提)用完了:记了空瓶、进了「已删掉」');
        localUndoRunOut(s, out, T);
        const after = snap();
        S.ok(JSON.stringify(after) === JSON.stringify(before), '撤销之后开封日、状态、快用完、空瓶记录、已删掉五个键逐字和用完之前一样', { before, after });
        S.ok(!(s.lg(K.regimen) || []).some(r => /补货/.test(r.reason || '')) && (s.lg(K.regimen) || []).length > nReg, '方案回到用完之前那一版(撤销是新的一版),没出「补货」');
    });
    t('编辑没写 role 的内置产品:只改保质期不动排法', () => {
        const s = full(), nReg = (s.lg(K.regimen) || []).length;
        localEditProduct(s, 'pc', { role: 'acid', paoMonths: 6 }, T);
        const pc = (s.lg(K.prodDefs) || []).find(x => x.id === 'pc');
        S.ok(pc && pc.paoMonths === 6 && pc.schedule.preferShowerNight === true && pc.cat === '去角质 · T区' && pc.role === 'acid', '排法(洗澡夜偏好)和分类名都没被重置,角色落了盘', pc && { cat: pc.cat, pref: pc.schedule.preferShowerNight });
        S.ok((s.lg(K.regimen) || []).length === nReg, '不出新的方案版本');
    });
    t('就医卡:「先不」过期、上一轮的回应不算这一轮', () => {
        const red = { followUp: 'later', start: '2026-10-20' };
        S.ok(medicalFollowUp(red, { state: 'later', at: '2026-10-25', until: '2026-11-01' }, T) === 'later', '「先不」7 天内:按她的回应显示');
        S.ok(medicalFollowUp(red, { state: 'later', at: '2026-10-21', until: '2026-10-28' }, T) === '', '过了 until:回到完整的就医理由');
        S.ok(medicalFollowUp({ followUp: 'booked', start: '2026-10-20' }, { state: 'booked', at: '2026-09-30', date: '2026-10-03' }, T) === '', '「已约了」是上一轮点的:不算这一轮的回应');
    });
    await (async () => {
        const LS0 = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
        try {
            let who = { uid: 'uA', getIdToken: async () => 'tokA' };
            const hits = [];
            const fetch = (u, init) => { hits.push(u.replace('http://x', '') + '|' + init.headers.Authorization); if (/review|assess/.test(u)) return new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }); return Promise.resolve(new Response('event: done\ndata: {"text":"hi"}\n\n', { status: 200 })); };
            const c = createAiClient({ base: 'http://x', getUser: () => who, fetch, localStorage: LS0(), today: () => T, wait: () => Promise.resolve(), limits: { point: 150, streamHead: 150, streamIdle: 150, assess: 150, shop: 150 } });
            const rv = c.api.review({}).catch(e => e);
            const ch = c.api.chat({ message: 'x' });
            await new Promise(r => setTimeout(r, 20));
            const ab = c.abort();
            const o = await ch;
            await rv;
            S.ok(ab && o.aborted && !hits.some(h => /\/api\/chat/.test(h)), '排在后面的对话点「停一下」:马上停,轮到它时也没发出去', { o, hits });
            // 排着队的时候换了账号:出队时不拿新账号的 token 发上一个人的请求
            hits.length = 0;
            const rv2 = c.api.review({}).catch(e => e);
            const fb = c.api.feedback({ who: 'A' }, {}).catch(e => e);
            await new Promise(r => setTimeout(r, 20));
            who = { uid: 'uB', getIdToken: async () => 'tokB' }; c.clearLocal();
            const e2 = await fb; await rv2;
            S.ok(e2 && e2.switched && !hits.some(h => /feedback/.test(h)), '换了账号:排着的 A 的反馈不发', { e: e2 && e2.message, hits });
            // 429「还没跑完」按退避多等几次(总时长对齐 busyWait),不是 6 秒就放弃
            let n429 = 0;
            const c3 = createAiClient({ base: 'http://x', getUser: () => who, localStorage: LS0(), today: () => T, wait: () => Promise.resolve(), limits: { busyWait: 90000 },
                fetch: () => Promise.resolve(++n429 < 5 ? new Response(JSON.stringify({ error: '上一个请求还没跑完，稍等。' }), { status: 429 }) : new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 })) });
            const r3 = await c3.api.tonight({}).catch(e => e);
            S.ok(r3 && r3.data && r3.data.ok === 1 && n429 === 5, '429「还没跑完」:退避重试到后端空出来', { n429, r3: r3 && (r3.message || r3.data) });
            // /api/me 401:原因留着(界面说「退出再登录」)
            const c4 = createAiClient({ base: 'http://x', getUser: () => who, localStorage: LS0(), today: () => T, fetch: () => Promise.resolve(new Response(JSON.stringify({ error: '请先登录。', status: 'signed_out' }), { status: 401 })) });
            await c4.probe(true);
            S.ok(c4.state.meErr && c4.state.meErr.code === 401 && !c4.ready(), 'probe 失败的原因留在 state.meErr(401)', c4.state.meErr);
        } catch (e) { S.ok(false, '修复第 2 轮 client 测试抛异常 ' + e.message, e.stack); }
    })();

    // ═══ 存储 / 兼容 / 文件表(s-70 的静态部分)═══
    t('CLOUD_KEYS', () => {
        const legacy = fs.readFileSync(path.join(ROOT, 'legacy/index.v1.html.txt'), 'utf8');
        const m = legacy.match(/const CLOUD_KEYS = (\[[^\]]+\]);/);
        S.ok(m && JSON.stringify(JSON.parse(m[1].replace(/'/g, '"'))) === JSON.stringify(CLOUD_KEYS) && CLOUD_KEYS.length === 19, 'CLOUD_KEYS 和 v1 逐字一致(19 个,一个不少、顺序不变)', CLOUD_KEYS);
        S.ok(Object.values(K).every(k => CLOUD_KEYS.indexOf(k) >= 0), '每个 K.* 存档键都进云');
        S.ok(Object.values(LOCAL_KEYS).every(k => CLOUD_KEYS.indexOf(k) < 0), '本机键(顾问对话、开通状态、深浅色、sk_uid…)不进云');
        const s = minimal({ profile: { showerDays: [2, 4] } }), r0 = s.state.doc.rev;
        syncHabitSources(s, T);
        S.ok(s.lg(K.preset).filter(x => x.shower).map(x => x.dow).join() === '2,4' && s.state.doc.rev === r0, '只有 showerDays(旧设置)→ 补出 sk_preset1,system 写(不推送)');
    });
    t('文件表', () => {
        const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name]);
        const files = ['js', 'css'].flatMap(walk).filter(f => /\.(js|css)$/.test(f)).map(f => './' + f).sort();
        const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
        const listed = (sw.match(/'\.\/(?:js|css)\/[^']+'/g) || []).map(x => x.slice(1, -1)).sort();
        S.ok(JSON.stringify(files) === JSON.stringify(listed), 'sw.js 的缓存清单和 js/、css/ 的文件一一对应', { missing: files.filter(f => listed.indexOf(f) < 0), extra: listed.filter(f => files.indexOf(f) < 0) });
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        S.ok(!/legacy\//.test(sw) && !/legacy\//.test(html) && !/ai\.js/.test(sw), '旧单文件(legacy/)不被新 index.html 加载,也不进 sw 缓存');
        const css = (html.match(/href="(css\/[^"]+)"/g) || []).map(x => x.slice(6, -1)).sort();
        S.ok(JSON.stringify(css) === JSON.stringify(files.filter(f => f.startsWith('./css/')).map(f => f.slice(2)).sort()), 'index.html 引了全部样式表', css);
        // SW 缓存优先(一次启动只用一个版本):改了任何预缓存的文件而 CACHE_NAME 没升,已装 App 的人永远拿不到新版。
        //   清单直接从 sw.js 的 CORE + FONTS 解析(页面、js/、css/、manifest、图标、字体、旧 URL 重定向页),不手抄
        const precached = [...(sw.match(/const CORE = \[([\s\S]*?)\];/) || [, ''])[1].matchAll(/'\.\/([^']*)'/g), ...(sw.match(/const FONTS = \[([\s\S]*?)\];/) || [, ''])[1].matchAll(/'\.\/([^']*)'/g)]
            .map(m => m[1]).filter(Boolean);
        S.ok(['index.html', 'manifest.json', 'icon-192.png', 'fonts/noto-serif-sc-400-skin.woff2', '护肤计划.html'].every(f => precached.indexOf(f) >= 0) && precached.some(f => f.startsWith('js/')),
            '从 sw.js 解析出了预缓存清单(含字体、manifest、图标)', precached.length);
        try {
            const sh = c => execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            const base = sh('git merge-base HEAD main').trim();
            const name = x => (x.match(/const CACHE_NAME = '([^']+)'/) || [])[1];
            const changed = sh('git -c core.quotepath=off diff --name-only ' + base + ' -- ' + precached.map(f => JSON.stringify(f)).join(' ')).trim();
            const was = name(sh('git show ' + base + ':sw.js'));
            S.ok(!changed || name(sw) !== was, '预缓存的文件(页面 / js / css / 字体 / manifest / 图标)相对 main 有改动时,sw.js 的 CACHE_NAME 也升了版', { was, now: name(sw), changed: changed.split('\n').slice(0, 5) });
        } catch (e) { S.ok(true, '(没有 git / main,跳过 CACHE_NAME 升版检查)'); }
        // 老 iOS Safari(15.4–16.3,README 写的支持范围)不认的语法:模块顶层一出现,整个模块图解析失败、App 打不开
        //   后行断言 (?<= / (?<!、正则 v 标志、类的 static 块
        const OLD_SAFARI = [[/\(\?<[=!]/, '正则后行断言'], [/\/[a-z]*v[a-z]*\.test\(|new RegExp\([^)]*,\s*'[a-z]*v/, '正则 v 标志'], [/\bstatic\s*\{/, '类的 static 块']];
        const oldHits = files.filter(f => f.endsWith('.js')).flatMap(f => { const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); return OLD_SAFARI.filter(([re]) => re.test(src)).map(([, n]) => f + ':' + n); });
        S.ok(!oldHits.length, 'js/ 里没有 iOS 15.4 不认的语法(后行断言、正则 v 标志、static 块)', oldHits);
        const emo = files.concat(['./index.html', './sw.js', './manifest.json']).filter(f => /\p{Extended_Pictographic}/u.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
        S.ok(!emo.length, 'App 源码里 0 emoji', emo);
    });

    // ═══ 「主动找你」的判断用事实(ai/push.js pushFacts):只放最小字段,不带 HRT / 用药 / 皮肤记录 ═══
    const FACT_KEYS = ['today', 'mode', 'done', 'night', 'key', 'times', 'photo', 'lastPhoto', 'redline', 'redStart', 'shopNow'];
    t('提醒事实:字段白名单、完成今晚时刻、HRT 不带', () => {
        const jr = [];
        for (let i = -1; i >= -13; i--) jr.push({ date: d(i), status: ['泛红'].slice(0, i === -1 ? 0 : 0), products: [], note: '私密的话', phase: 'late',
            ...(i >= -4 ? { done: true, doneAt: new Date(2026, 9, 29 + i, 22, 10 + i).toISOString() } : {}), ...(i === -5 ? { photoAssess: { usable: true, zones: [] } } : {}) });
        const s = full({ jrnl: jr, profile: { hrt: true, startState: 'care', careAt: d(-2) } }), w = W(s);
        const f = pushFacts(w, { plan: shownTonight(w, null), photoOn: true, shop: null, uid: 'u1' });
        const js = JSON.stringify(f);
        S.ok(Object.keys(f).every(k => FACT_KEYS.includes(k)), '提醒事实:只有契约里的字段', Object.keys(f));
        S.ok(!/late|私密|hrt|phase|care|泛红/i.test(js), '提醒事实:不带 HRT 阶段、备注、在看医生、肤况标签', js);
        S.ok(f.mode === 'full' && f.done === false && f.today === T && f.times.length === 4 && f.times.every(x => /^\d\d:\d\d$/.test(x.hm)) && f.times[3].date === d(-1), '提醒事实:模式、今晚没完成、最近几次完成今晚的本地时刻', f.times);
        S.ok(f.photo === true && f.lastPhoto === d(-5) && f.redline === false && Array.isArray(f.shopNow) && !f.shopNow.length, '提醒事实:拍照开关和上次分析的日子、红线没亮', f);
        S.ok(['刷酸夜', '修护夜', '维 A 夜', '面膜夜', '刮胡夜'].includes(f.night), '提醒事实:今晚的类型是今晚页那五种说法之一', f.night);
    });
    t('提醒事实:就医红线亮了 → redline + 起始日,不报产品名', () => {
        const s = full({ status: i => i >= -6 ? ['泛红'] : [] }), w = W(s);
        const f = pushFacts(w, { plan: shownTonight(w, null) });
        S.ok(f.redline === true && f.redStart === medicalRedLine(w).start && !('key' in f) && !/泛红|红线|就医/.test(JSON.stringify(f)), '红线:只传亮没亮和起始日,不传为什么,也不报关键一步', f);
    });
    t('提醒事实:极简模式、今晚类型和关键一步', () => {
        const w = W(minimal());
        const f = pushFacts(w, { plan: shownTonight(w, null) });
        S.ok(f.mode === 'minimal', '极简模式标出来(后端据此只报今晚排什么,不说「还没做」)', f.mode);
        const w2 = W(full());
        const plan = { steps: [{ product: '', how: '温水洗脸', kind: 'base' }, { product: PC, kind: 'acid' }, { product: 'X 保湿', kind: 'base' }] };
        S.ok(nightOf(w2, plan) === (tonight(w2).shave ? '刮胡夜' : '刷酸夜') && keyStepOf(w2, plan) === PC, '有酸 → 刷酸夜(刮胡夜优先),关键一步是那支酸', [nightOf(w2, plan), keyStepOf(w2, plan)]);
        S.ok(keyStepOf(w2, { steps: [{ product: '', how: '洗脸' }] }) === '' && nightOf(w2, null) === '', '没有产品步骤 → 不报名字;没有今晚 → 不报类型');
        const f1 = pushFacts(w2, { plan }), f2 = pushFacts(w2, { plan: { steps: plan.steps.filter(x => x.kind !== 'acid') } });
        S.ok(factsSig(f1) !== factsSig(f2) && factsSig(f1) === factsSig(pushFacts(w2, { plan })), '事实指纹:今晚换了才变(节流上传按它)');
    });
    t('提醒事实:「要不要买」只取现在就缺、按账号', () => {
        const rec = { uid: 'u1', data: { items: [{ need: '温和疏通', what: '杏仁酸', urgency: 'now' }, { need: '保湿', what: '', urgency: 'soon' }, { need: '防晒', what: 'SPF50', urgency: 'now' }] } };
        const ids = shopNowIds(rec, 'u1');
        S.ok(ids.length === 2 && ids.every(x => /^[A-Za-z0-9_-]{1,40}$/.test(x)) && ids[0] !== ids[1] && shopNowIds(rec, 'u1')[0] === ids[0], '现在就缺 → 两个稳定的短 id(后端 ID_RE 认得)', ids);
        S.ok(!shopNowIds(rec, 'u2').length && !shopNowIds(null, 'u1').length, '别的账号的结果不算');
        S.ok(!ids.some(x => /疏通|防晒/.test(x)), 'id 里不带缺什么的原文');
    });
    t('提醒设置:默认关,存在档案 profile.push', () => {
        S.ok(pushPrefs({}).on === false && pushPrefs({}).qs === PUSH_DEF.qs && pushPrefs({ push: { on: true, max: 2 } }).max === 2, '默认关、23–08、每天 1 条;档案里有就用档案的');
        S.ok(skinSignature(W(full({ profile: { push: { on: true } } }))) === skinSignature(W(full())), '档案里多了 push 不改皮肤指纹(不会因此重出方案)');
    });
}
function minimalPlanday(p) { return p.W ? plandayOf(p.W) : null; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    let fail = 0, n = 0; const t0 = Date.now();
    const S = { ok(c, label, detail) { n++; if (!c) fail++; console.log((c ? '  ✓ ' : '  ✗ ') + label + (!c && detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 700) : '')); return !!c; } };
    console.log('■ engine-unit');
    await runEngineUnit(S);
    console.log(`\n${fail ? '✗ ' + fail + ' 条失败' : '✓ 全部通过'}(${n} 条)· ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(fail ? 1 : 0);
}
