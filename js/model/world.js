// ══ world:把存储里的数据拼成引擎要的那一份(只读快照)══════════════════════════════════════
// 引擎全是纯函数,吃 world。每次界面要算东西就 buildWorld 一份新的(便宜:都是已解析好的缓存),算完即弃,没有「忘了清缓存」这回事。
// 【要紧 · 8/15 极简模式失忆】buildWorld 第一件事是 absorbPrescribedHistory(推定昨天的处方已执行,'derived' 写盘):
//    v1 里它在 computePlanRolling 顶部,是「唯一咽喉点」;v2 里任何引擎计算都从 buildWorld 进来,所以咽喉点在这里。
//    planNow() 算完今天的排班后把 sk_planday1 写回('system'),第二天据此推定。两者缺一个,酸就会天天排在「今晚」。
import { K } from '../store.js';
import { today as clockToday } from '../clock.js';
import { loadPD } from './products.js';
import { loadProfile } from './profile.js';
import { absorbPrescribedHistory } from './journal.js';
import { computePlan, plandayOf } from '../engine/schedule.js';

export function buildWorld(store, opts) {
    opts = opts || {};
    const t = opts.today || clockToday();
    if (!opts.noAbsorb) absorbPrescribedHistory(store, t);
    const lg = k => store.lg(k);
    return {
        today: t,
        profile: loadProfile(store),
        products: loadPD(store),
        ps: lg(K.prods) || {}, popen: lg(K.popen) || {},
        journal: lg(K.jrnl) || [],
        wk: lg(K.wk) || {}, preset: lg(K.preset),
        low: lg(K.low) || [], gone: lg(K.gone) || [], empties: lg(K.empty) || {},
        regimen: lg(K.regimen) || [], tnai: lg(K.tnai), tn: lg(K.tn), tnsteps: lg(K.tnsteps),
        ai: lg(K.ai) || {}
    };
}
// 今天的排班 + 写回 sk_planday1(只在变了时写,'system':每次加载都会重算,不推送,见 8/29 对推)
export function planNow(store, opts) {
    const W = buildWorld(store, opts);
    const days = computePlan(W);
    const pd = plandayOf(W, days);
    if (pd) {
        const prev = store.lg(K.planday);
        if (!prev || prev.date !== pd.date || JSON.stringify(prev.items || []) !== JSON.stringify(pd.items)) store.ls(K.planday, pd, 'system');
    }
    return { W, days };
}
