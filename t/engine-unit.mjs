// 引擎 + 模型 + 顾问层的不开浏览器单测。业务断言提炼自 v1 的 s-10 / s-16 / s-20 / s-33 / s-36 / s-70(那些是整页测试,针对旧单文件)。
// 引擎全是纯函数:造一份假 localStorage → createStore → buildWorld,直接问引擎。数据全是虚构的。
//   跑:  node t/engine-unit.mjs
import fs from 'node:fs';
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
import { applyTonight, undoTonightChange, applyRegimen, validatePlan, gateTonightPlan, onShopLocalChange, undoRegimenChange, localToggleLow } from '../js/ai/apply.js';
import { parseSseBlock, aiClean, createAiClient } from '../js/ai/client.js';

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
    t('client', () => {
        const b = parseSseBlock('event: delta\ndata: {"t":"好"}');
        S.ok(b.event === 'delta' && b.data.t === '好' && parseSseBlock('event: x\ndata: {bad') === null, 'SSE 块解析(坏 JSON 跳过)');
        S.ok(aiClean({ a: ['好的\u{1F600}'] }).a[0] === '好的', '顾问回来的字去 emoji');
    });

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
        const emo = files.concat(['./index.html', './sw.js', './manifest.json']).filter(f => /\p{Extended_Pictographic}/u.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
        S.ok(!emo.length, 'App 源码里 0 emoji', emo);
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
