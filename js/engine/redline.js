// ══ 就医红线 ══════════════════════════════════════════════════════════════════════════════
// 只看**硬事实**(8/20:安全类提示不许挂在推断量上),痘和泛红分开算(Cait 10/29 拍板):近 14 天里
//   · 记了「泛红」的天数 ≥ 5,而且最近 3 天里还有泛红 → 亮;
//   · 记了「新痘」(爆痘)的天数 ≥ 10,而且最近 3 天里还在冒 → 亮(一颗痘一周左右走完,两周还在冒才算)。
//   点了「看过了」之后只数那天以后的。
// 脸部地图的位置**不参与**(Cait 10/29 撤掉了「口周 ≥3 天提前亮」);照片分析(photoAssess)**也不参与**(v2:交给顾问建议)。
// 亮着时:所有酸停(含温和酸),今晚只排清洁 / 保湿 / 修护 / 眼霜 —— 那部分在 gate.js。任何模式都显示(界面层的事)。
import { lastNDays, offset } from './util.js';

export const MEDICAL_RED_DAYS = 5, MEDICAL_ACNE_DAYS = 10;
export function medicalRedLine(W) {
    const m = (W.profile || {}).medical || {};
    const since = (m.state === 'seen' && m.seenAt) ? m.seenAt : '';
    const r14 = lastNDays(W, 14).filter(e => e.date > since);
    const has = (e, t) => (e.status || []).indexOf(t) >= 0;
    const recent = list => list.some(e => e.date >= offset(W, -2));
    const red = r14.filter(e => has(e, '泛红')), acne = r14.filter(e => has(e, '爆痘'));
    const byRed = red.length >= MEDICAL_RED_DAYS && recent(red);
    const byAcne = acne.length >= MEDICAL_ACNE_DAYS && recent(acne);
    const why = [byRed ? '泛红 ' + red.length + ' 天' : '', byAcne ? '冒痘 ' + acne.length + ' 天' : ''].filter(Boolean).join('、');
    return { on: byRed || byAcne, by: byRed && byAcne ? 'both' : byRed ? 'red' : byAcne ? 'acne' : '',
             redDays: red.length, acneDays: acne.length, days: new Set(red.concat(acne).map(e => e.date)).size, why: why ? '近两周' + why : '',
             // 这一轮从哪天开始(近 14 天里第一次泛红 / 冒痘):上一轮点的「先不 / 已约了」早于它,就不算这一轮的回应
             start: red.concat(acne).map(e => e.date).sort()[0] || '',
             followUp: m.state || '' };
}
