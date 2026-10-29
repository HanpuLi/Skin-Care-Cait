// ══ 皮肤评估(描述用)+ 规则化行动建议 ══════════════════════════════════════════════════════
// 旧版的评估分数卡、多分数在 v2 里砍掉或并进顾问;这里只留给离线方案快照、记录页和顾问上下文用的那份。
import { memo, lastNDays } from './util.js';
import { AXES, axisScore, axisTrend } from './score.js';
import { safetyGate } from './gate.js';
import { maxAcidPerWeek } from './rules.js';
import { CONCERN_ADVICE, userZones } from '../model/profile.js';
import { tagLabel } from '../model/journal.js';

export function assessSkin(W) {
    return memo(W, 'assess', () => {
        const e7 = lastNDays(W, 7);
        const axes = AXES.map(a => Object.assign({}, a, { score: axisScore(a.key, e7), trend: axisTrend(W, a.key) }));
        const scored = axes.filter(a => a.score !== null);
        const overall = scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : null;
        return { axes, overall, sampleN: e7.filter(e => (e.status || []).length).length, recs: buildRecs(W, axes, overall) };
    });
}
// 按优先级排(就医 > 注意 > 信息 > 好),最多 5 条。就医红线只看硬事实(gate → redline)
export function buildRecs(W, axes, overall) {
    const recs = [], P = W.profile || {};
    const ax = k => axes.find(a => a.key === k) || {};
    const zs = userZones(P);
    if (zs.length) {
        const z = zs[0];
        recs.push({ level: 'info', text: `${z.name}：${z.care || '避开刺激性成分'}${(z.avoid || []).length ? '（该区不用' + z.avoid.map(a => ({ acid: '酸', mask: '面膜、磨砂', retinol: '维 A', scrub: '磨砂' })[a] || a).join('、') + '）' : ''}` });
    }
    const gc = P.goal && P.goal.concern;
    if (gc && CONCERN_ADVICE[gc]) recs.push({ level: 'info', text: CONCERN_ADVICE[gc] });
    const g = safetyGate(W);
    if (g.medical) recs.push({ level: 'safety', text: g.medicalText });
    if (g.irritated) recs.push({ level: 'warn', text: g.acidCapMax === 0
        ? `近 3 天记了${g.tags.map(tagLabel).join('、')}${g.worsening ? '，还记了「差些」' : '，而且是刷酸后两天内出现的'}：酸先停，猛酸、磨砂、泥膜、维 A 都不上，只做清洁、保湿、修护。`
        : `近 3 天记了${g.tags.map(tagLabel).join('、')}：猛酸、磨砂、泥膜、维 A 先不上；温和酸最多每周 1 次（避开发红处）。` });
    const barrier = ax('barrier').score, cong = ax('congestion').score, oil = ax('oil').score;
    if (barrier != null && barrier < 45) recs.push({ level: 'warn', text: '屏障这一项偏低：以修护为主，洗完全脸要有东西护着，别为了控油把脸洗干。' });
    if (cong != null && cong < 60 && !g.irritated) recs.push({ level: 'info', text: `闭口、粗糙偏多：温和酸按节奏走（现在每周 ${maxAcidPerWeek(W)} 次），没刺激就一档档往上加；别上磨砂搓脸。` });
    if (oil != null && oil < 60) recs.push({ level: 'info', text: 'T 区出油：控油但别过度清洁，越剥越油；防晒选无油款。' });
    if (!recs.filter(r => r.level !== 'info').length && overall !== null && overall >= 80) recs.push({ level: 'good', text: '没有损伤信号，保持当前节奏。' });
    if (lastNDays(W, 7).filter(e => (e.status || []).length).length < 2) recs.push({ level: 'info', text: '多记几天皮肤状态，评估会更准。' });
    const order = { safety: 0, warn: 1, info: 2, good: 3 };
    recs.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
    return recs.slice(0, 5);
}
