// ══ 离线兜底:按真实反应爬坡的刷酸阶梯 ════════════════════════════════════════════════════
// 只在**没有顾问方案**时生效(不在白名单 / 后端连不上 / 离线)。从 1 次/周温和酸起步(Cait:她基本没用过酸,没有耐受史):
//   完整模式:刷酸后 48 小时内(当天 / 次日 / 第三天)**记了状态而且没有** 泛红/敏感/爆痘/变差 = 一次「干净」;
//            连续 3 次干净 → 升一档,封顶 3 次/周;一记到刺激 → 降一档(最低 1,当晚停不停交给安全闸);
//            那几天什么状态都没记 = 不算数(没数据不是证据);两次刷酸隔了 3 周以上 → 降一档(耐受会退)。
//   【要紧】极简模式:她不记录,排上的酸会被推定「用了」(absorbPrescribedHistory)。「没记到刺激」在这里**不是**耐受的证据,
//      把它当耐受自动加量,就是 8/15 连排三晚酸的老路。所以极简模式**从不自动升档**:停在她手动设的档(默认 1),
//      只在记到刺激时降;要升只能由顾问或她自己在设置里改。
import { memo, acidTags } from './util.js';
import { addDays, daysBetween } from '../clock.js';
import { IRRITATION_TAGS } from '../model/journal.js';

export const LADDER_MAX = 3, LADDER_STEP_N = 3, LADDER_WINDOW = 60, LADDER_GAP_RESET = 21;
export function acidLadder(W) {
    return memo(W, 'ladder', () => {
        const P = W.profile || {};
        const manual = [1, 2, 3].indexOf(+P.acidLevel) >= 0 ? +P.acidLevel : null;
        const minimal = !!P.minimalMode;
        const t = W.today;
        let from = addDays(t, -LADDER_WINDOW);
        if (manual && P.acidLevelAt && P.acidLevelAt > from) from = P.acidLevelAt;
        const byDate = {};
        (W.journal || []).forEach(e => { if (e && e.date && !byDate[e.date]) byDate[e.date] = e; });
        const tags = acidTags(W);
        const uses = Object.keys(byDate).filter(d => d >= from && d <= t && (byDate[d].products || []).some(p => tags.includes(p))).sort();
        let level = manual || 1, streak = 0, prev = null;
        const events = [];
        uses.forEach(d => {
            if (prev && !minimal && daysBetween(prev, d) > LADDER_GAP_RESET && level > 1) { level--; streak = 0; events.push({ date: d, kind: 'gap', level }); }
            prev = d;
            const win = [0, 1, 2].map(i => byDate[addDays(d, i)]).filter(Boolean);
            const irritated = win.some(e => (e.status || []).some(s => IRRITATION_TAGS.indexOf(s) >= 0));
            if (irritated) { if (level > 1) level--; streak = 0; events.push({ date: d, kind: 'react', level }); return; }
            if (minimal) { events.push({ date: d, kind: 'nolog', level }); return; }   // 极简:没记到 ≠ 耐受
            if (addDays(d, 2) > t) { events.push({ date: d, kind: 'pending', level }); return; }   // 两天还没过完,先不下结论
            const logged = win.some(e => (e.status || []).length && !e.auto);
            if (!logged) { events.push({ date: d, kind: 'unknown', level }); return; }
            streak++;
            if (streak >= LADDER_STEP_N && level < LADDER_MAX) { level++; streak = 0; events.push({ date: d, kind: 'up', level }); }
            else events.push({ date: d, kind: 'clean', level, streak });
        });
        const last = events[events.length - 1];
        let why;
        if (minimal) why = manual ? `你设的 ${manual} 次/周；极简模式不会自己加，想加跟顾问说或在设置里改` : '起步 1 次/周；极简模式不记录，不会自己往上加';
        else if (!uses.length) why = manual ? `你设的 ${manual} 次/周，还没有刷酸记录` : '起步：每周 1 次温和酸，盯两天反应';
        else if (last && last.kind === 'up') why = `连续 ${LADDER_STEP_N} 次刷酸后两天内都没泛红、新痘，升到每周 ${level} 次`;
        else if (last && last.kind === 'react') why = `${last.date} 刷酸后两天内记到刺激，回到每周 ${level} 次`;
        else if (last && last.kind === 'gap') why = '隔了 3 周以上没刷，耐受会退，降一档';
        else if (level >= LADDER_MAX) why = `已到 ${LADDER_MAX} 次/周（离线阶梯封顶）`;
        else why = `再干净 ${LADDER_STEP_N - streak} 次（刷完两天内记了状态、没泛红/爆痘）就加到 ${level + 1} 次/周`;
        return { level, streak, manual, minimal, events, why, uses: uses.length };
    });
}
