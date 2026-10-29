// ══ 安全闸:唯一红线 —— 顾问方案、顾问写的今晚、离线阶梯、今晚的小改,上脸之前都过这一道 ═══════════════
// 只拦真危险的,只看**硬事实**(最近几天记了什么、HRT 记录、货架上真有什么),不看推断出来的分数。
//   ① 近 3 天记了 泛红/敏感/爆痘/变差 → 猛酸、磨砂、泥膜、维 A 不上;温和酸最多 1 次/周
//      (「持续但没恶化」保留 1 次/周维持量是 8/20 定的:主诉闭口的人停光去角质只会被永久锁死)
//      记了「比昨天差」、或刺激出现在刷酸后两天内 → 酸也停(0)
//   ② 近两周有炎症 → 猛酸不上;近两周有炎症或闷闭口 → 磨砂不上(8/26 的配套闸门)
//   ③ HRT 波动 / 爆发期(只看**本人**开了 HRT 的记录)→ 酸 ≤1 次/周、停面油、不上猛酸和维 A
//   ④ 就医红线亮着 → 所有酸都停(含温和酸),今晚只留清洁 + 保湿 + 修护 + 眼霜(Cait 10/29;眼周不在口周皮炎范围)
//   ⑤ 第一晚(刚走完引导那天)→ 不上任何活性
//   ⑥ 只排产品库里真有、没被标「我不用」的 —— gateBlocks()
//   ⑦ 分区避开项永远生效,顾问只能加不能减 —— rules.js 的 zonesAvoiding()
//   ⑧ 引导里说的起点:「有发红刺痛」头三晚不上活性;「在看医生 / 用药」只做基础几样,直到她在设置里关掉
import { daysBetween } from '../clock.js';
import { memo, lastNDays, statusDays, acidTags, isGone } from './util.js';
import { medicalRedLine } from './redline.js';
import { hasTrait } from '../model/products.js';
import { IRRITATION_TAGS, tagLabel } from '../model/journal.js';

// 两条口径写成常量,一行就能改(Cait 2026-10-29 已拍板)
export const MEDICAL_STOPS_ALL_ACID = true;
export const MEDICAL_BASICS = ['precleanse', 'cleanse', 'moist', 'repair', 'spf', 'eye'];
// 极简模式的记录:'optional' = 默认全做 + 例外点一下「今晚没做」+ 皮肤状态想记就记、从不催
export const MINIMAL_LOGGING = 'optional';

// HRT 激素波动判断:对没开 HRT 的人直接短路(Cici 的日志里就算有 phase 字段也不算)
export function isHrtFluctuation(phase, profile) {
    if (!profile || !profile.hrt) return false;
    const ph = phase || '';
    return ph.includes('波动') || ph.includes('调整') || ph.includes('加量') || ph.includes('减量') || ph.includes('出血');
}
// 最近一次刷酸后 48 小时内(当天 / 次日 / 第三天)记到刺激 —— 这次酸很可能就是诱因
export function acidReactedRecently(W) {
    const tags = acidTags(W), recent = lastNDays(W, 3);
    const used = recent.filter(e => (e.products || []).some(p => tags.includes(p))).map(e => e.date).sort();
    if (!used.length) return false;
    return recent.some(e => e.date >= used[0] && (e.status || []).some(s => IRRITATION_TAGS.indexOf(s) >= 0));
}
export function safetyGate(W) {
    return memo(W, 'gate', () => {
        const P = W.profile || {};
        const irr3 = statusDays(W, 3, IRRITATION_TAGS);
        const tags = [];
        irr3.forEach(e => (e.status || []).forEach(s => { if (IRRITATION_TAGS.indexOf(s) >= 0 && tags.indexOf(s) < 0) tags.push(s); }));
        const irritated = irr3.length > 0;
        const worsening = statusDays(W, 4, ['变差']).length > 0;
        const react = irritated && acidReactedRecently(W);
        const inflamed14 = statusDays(W, 14, ['泛红', '敏感', '爆痘']).length > 0;
        const clogged14 = statusDays(W, 14, ['闭口']).length > 0;
        const hrtFlare = !!P.hrt && lastNDays(W, 5).some(x => isHrtFluctuation(x.phase, P));
        const red = medicalRedLine(W);
        const medical = red.on;
        const firstNight = !!P.oobeAt && P.oobeAt === W.today;
        // ⑧ 引导里说的起点(安全输入,只认引导写下的 oobeAt 之后):
        //    「有发红刺痛」→ 引导那天起 3 晚酸先停(当天日志记的泛红只让温和酸降到 1 次 / 周,第二晚就会排酸);
        //    「在看医生 / 用药」→ 一直只做清洁、保湿、修护(和就医红线同一套基础),直到她在设置里关掉。
        const startDays = P.oobeAt ? daysBetween(P.oobeAt, W.today) : -1;
        const startIrritated = P.startState === 'irritated' && startDays >= 0 && startDays < 3;
        // careAt:v2 引导 / 设置里选的才算(v1 引导时选过「在看医生」的老账号,v1 没按它收紧排法;不凭空改她们的排法,两版也不互相重排)
        const care = P.startState === 'care' && !!P.careAt;
        let acidCapMax = 7;
        const notes = [];
        if (medical && MEDICAL_STOPS_ALL_ACID) { acidCapMax = 0; notes.push('就医提醒亮着（' + red.why + '）：所有酸先停，看过医生点「看过了」才解除'); }
        if (firstNight) { acidCapMax = 0; notes.push('第一晚：先不上任何活性'); }
        if (care && !medical) { acidCapMax = 0; notes.push('在看医生 / 用药：护肤只做清洁、保湿、修护，医生开的药优先（设置里能改）'); }
        if (startIrritated && !firstNight) { acidCapMax = 0; notes.push('刚开始用时说了有发红刺痛：头三晚酸、面膜、维 A 都先不上'); }
        if (irritated) {
            const cap = (worsening || react) ? 0 : 1;
            acidCapMax = Math.min(acidCapMax, cap);
            notes.push(cap === 0
                ? `近 3 天有${tags.map(tagLabel).join('、')}${worsening ? '，还记了「差些」' : '，出现在刷酸后两天内'}：酸先停`
                : `近 3 天有${tags.map(tagLabel).join('、')}：温和酸最多每周 1 次，猛酸、磨砂、泥膜、维 A 不上`);
        }
        if (hrtFlare) { acidCapMax = Math.min(acidCapMax, 1); notes.push('HRT 波动期：酸最多每周 1 次，面油先停'); }
        return {
            irritated, tags, worsening, react, inflamed14, clogged14, hrtFlare, medical, firstNight, care, startIrritated, acidCapMax, notes, red,
            medicalText: `${red.why}，最近还在。要是集中在嘴周、鼻下，可能是口周皮炎，越刷酸越糟，这种要医生看。`,
            medicalWhy: red.why,
            banStrong: irritated || inflamed14 || hrtFlare || medical || firstNight || care || startIrritated,
            banScrub: irritated || inflamed14 || clogged14 || medical || firstNight || care || startIrritated,
            banRetinol: irritated || hrtFlare || medical || firstNight || care || startIrritated,
            banMask: irritated || medical || firstNight || care || startIrritated,
            banOil: hrtFlare
        };
    });
}
// 某支产品现在能不能上脸:null = 可以;否则返回原因(界面上原样告诉她为什么没生效)
export function gateBlocks(p, g, W) {
    g = g || safetyGate(W);
    if (!p) return '产品库里没有这支';
    if (p.hidden || isGone(W, p.id)) return '家里已经没有这支了';
    if (((W.profile || {}).excluded || []).includes(p.id)) return '你标了不要了';
    const type = (p.schedule && p.schedule.type) || '';
    const why = g.medical ? '就医提醒亮着' : g.firstNight ? '第一晚' : g.care ? '在看医生 / 用药' : g.startIrritated ? '刚开始有发红刺痛' : (g.tags.length ? '近 3 天有' + g.tags.map(tagLabel).join('、') : '');
    if (hasTrait(p, 'scrub')) {
        if (g.banScrub) return (why || (g.inflamed14 ? '近两周有泛红 / 新痘' : '近两周在闷闭口')) + '：磨砂不上';
    } else if (hasTrait(p, 'strong-exfo')) {
        if (g.banStrong) return (why || (g.hrtFlare ? 'HRT 波动期' : '近两周有泛红 / 新痘')) + '：猛酸不上';
    }
    if (g.banRetinol && (p.role === 'retinol' || type === 'retinol')) return (why || 'HRT 波动期') + '：维 A 先停';
    if (g.banMask && (p.role === 'mask' || type === 'mask' || hasTrait(p, 'clay'))) return why + '：泥膜 / 去角质面膜先停';
    if (g.banOil && p.role === 'oil') return 'HRT 波动期：面油先停';
    if (g.acidCapMax === 0 && (p.role === 'acid' || type === 'acid'))
        return g.medical ? '就医提醒亮着：所有酸先停' : g.firstNight ? '第一晚：先不上活性' : g.care ? '在看医生 / 用药：酸先不上' : g.startIrritated ? '刚开始有发红刺痛：头三晚酸先不上'
            : g.worsening ? '记了「差些」：酸先停' : '刷酸后两天内记到刺激：酸先停';
    if (g.medical && MEDICAL_BASICS.indexOf(p.role) < 0) return '就医提醒亮着：今晚只做清洁、保湿、修护';
    if (g.care && MEDICAL_BASICS.indexOf(p.role) < 0) return '在看医生 / 用药：只做清洁、保湿、修护';
    return null;
}
