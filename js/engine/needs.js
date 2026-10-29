// ══ 离线「要不要买」:按「这套方案对当前皮肤还成不成立」判断,不按产品分类(Cait 2026-08-26 定)═════════════
// 照现在这张脸,一套能起作用的方案需要哪几件事?家里剩下的东西能不能把每件事办了?办不了的那一项才是缺口。
// 【要紧】「会不会真涂上脸」和今晚流程用**同一个**口径(blockedNow / spotOnly / leaveOn,在 rules.js):
//    2026-08-28 实测两把尺子:流程里把它停了、缺口里却算它顶着 → App 说不用买,Cici 洗完脸全脸什么都没有。
// 顾问版(POST /api/shop)由 ai 层跑;顾问用不了 / 出错时界面退回这里。
import { derive, tagInDays, prodById, isExcluded } from './util.js';
import { maxAcidPerWeek, shelfProducts, blockedNow, spotOnly, faceWide, leaveOn, calmDownMode } from './rules.js';
import { barrierScore } from './score.js';
import { capsOf, hasTrait, traitsOf, isSchedActive, statusOf, groupOfRole } from '../model/products.js';

export function regimenNeeds(W) {
    const b = barrierScore(W);
    const needs = [
        { key: 'clean', label: '把脸洗干净', why: '每天都要洗脸，这一档不能空', test: p => capsOf(p).indexOf('clean') >= 0 },
        // 排酸的那一晚流程会跳过精华 → 有排酸时精华不算能顶这一档(那晚恰恰最需要封层,AAD:去角质后立即保湿)
        { key: 'hydrate', label: '洗完脸上要有东西护着', why: '洗完什么都不涂，屏障只会更差',
          test: p => faceWide(p) && leaveOn(p) && capsOf(p).indexOf('hydrate') >= 0 && !blockedNow(W, p) && !spotOnly(W, p) && !(maxAcidPerWeek(W) > 0 && p.role === 'serum') },
        { key: 'spf', label: '白天防晒', why: '有炎症、用过酸之后不防晒 = 留印、更红', test: p => capsOf(p).indexOf('spf') >= 0 }
    ];
    if (tagInDays(W, 14, ['闭口', '粗糙']))
        needs.push({ key: 'gentle-exfo', label: '温和疏通（对付闭口）', why: '近两周记了闭口、粗糙：闭口只能靠温和疏通，搓（磨砂）和闷（厚霜）都只会更糟',
            test: p => hasTrait(p, 'gentle-exfo') && !hasTrait(p, 'scrub') });
    if (tagInDays(W, 14, ['泛红', '敏感', '爆痘']))
        needs.push({ key: 'calm-light', label: '轻薄的镇静', why: '近两周有泛红、敏感、痘：需要能镇静、又不闷不刺激的东西（封闭性膏体、精油类不算）',
            test: p => faceWide(p) && hasTrait(p, 'calm') && !spotOnly(W, p) && !hasTrait(p, 'occlusive') && !hasTrait(p, 'oil-based') && !hasTrait(p, 'fragranced') });
    if (b !== null && b < 45)
        needs.push({ key: 'barrier', label: '修护屏障', why: '屏障这一项只有 ' + b + ' 分：要有能修屏障的东西托底',
            test: p => faceWide(p) && !blockedNow(W, p) && (hasTrait(p, 'calm') || p.role === 'repair') });
    if (tagInDays(W, 7, ['干燥']))
        needs.push({ key: 'moisture', label: '锁水', why: '近一周记了干燥：要有保湿封层', test: p => !blockedNow(W, p) && (p.role === 'moist' || p.role === 'repair' || p.role === 'oil') });
    return needs;
}
export function regimenCoverage(W) {
    const shelf = shelfProducts(W);
    return regimenNeeds(W).map(n => { const have = shelf.filter(n.test); return { key: n.key, label: n.label, why: n.why, have, active: have.filter(p => isSchedActive(p, statusOf(p, W.ps))) }; });
}
export function regimenGaps(W) { return regimenCoverage(W).filter(c => !c.have.length); }
// 「它没了的话,会多出哪几个缺口」—— 在一个假设的 world 上推演(不落盘,也就没有「忘了复位」这种事)
export function gapsIfGone(W, id) {
    const before = regimenGaps(W).map(g => g.key);
    return regimenGaps(derive(W, { simExclude: id })).filter(g => before.indexOf(g.key) < 0);
}
export const SHOP_ADVICE = {
    clean: { what: '一支温和洁面', how: '氨基酸、无皂基、无香精，洗完不紧绷' },
    hydrate: { what: '一支基础保湿', how: '油皮选无油乳液/fluid，干皮选面霜；无香精无精油，成分越简单越好' },
    spf: { what: '一支防晒', how: 'SPF30+、无油、清爽，敏感肌可选纯物理' },
    'gentle-exfo': { what: '一支温和的酸', how: '杏仁酸、乳酸/PHA，浓度别高；不要磨砂、不要高浓度甘醇酸' },
    'calm-light': { what: '一支轻薄的镇静产品', how: '要点：质地是水、精华、凝胶（不是膏体）、无香精无精油、成分表短；泛醇、积雪草、神经酰胺、尿囊素这类修护成分' },
    barrier: { what: '一支修护类产品', how: '神经酰胺、泛醇、积雪草；正在闷闭口就别选厚膏' },
    moisture: { what: '一支保湿封层', how: '按肤质挑质地，别为了"滋润"选香精重的' }
};
// 调研过的具体推荐(2026-08 查成分表定的,英国可买;顾问版会联网查最新的)
export const SHOP_PICKS = {
    hydrate: { name: 'La Roche-Posay Toleriane Sensitive Fluide (40ml)', price: 'Boots £19.55（2026-08-28 实查）',
        why: '全表 10 个成分、无香精无精油无酒精，fluid 质地混油、油皮不闷；含烟酰胺：控油、泛红、痘这三件正好是现在这张脸的问题。' },
    'hydrate+calm': { name: 'La Roche-Posay Toleriane Sensitive Fluide (40ml)', price: 'Boots £19.55（2026-08-28 实查）',
        why: '一支同时办两档：早晚全脸的保湿打底 + 「轻薄的镇静」。10 个成分、无香精无精油无酒精、fluid 不闷；烟酰胺对出油、泛红、痘都有据可依。备选 Avène Tolérance Hydra-10 Fluid（烟酰胺不耐受时换它）。别拿 Cicaplast B5 精华顶这一档：含 Isopropyl Myristate（偏致粉刺）和香料。' },
    'calm-light': { name: 'Avène Tolérance Hydra-10 Hydrating Fluid (40ml)', price: '约 £16–20，Boots/Escentual',
        why: '全表只有 9 个成分、无香精无防腐（无菌泵）、质地是 fluid 不闷，油皮混油都能用。' },
    'gentle-exfo': { name: 'Paula\'s Choice 6% 杏仁酸 + 2% 乳酸', price: '',
        why: '杏仁酸分子大、渗透慢、对微炎症最友好；真要再买就买同类，别升级成甘醇酸。' }
};
// 一支产品能同时补上好几档时合并成一条 —— 否则「缺保湿」+「缺镇静」会被读成要买两支(2026-08-28)
export const SHOP_MERGE = [
    { key: 'hydrate+calm', keys: ['hydrate', 'calm-light'], what: '一支轻薄的保湿（同一支就顶了「镇静」那一档）',
      how: '无香精无精油、质地是 fluid/乳液不是厚膏、非致粉刺；带烟酰胺/泛醇/神经酰胺这类修护成分更好' }
];
// 购物清单唯一入口:缺口 → 合并 → 挑选标准 + 调研推荐;再加「快用完了」的提前量(排在真缺口后面,同样走合并)
export function shopItems(W) {
    const gaps = regimenGaps(W), keys = gaps.map(g => g.key), taken = {}, out = [];
    SHOP_MERGE.forEach(m => {
        if (!m.keys.every(k => keys.indexOf(k) >= 0)) return;
        m.keys.forEach(k => { taken[k] = 1; });
        out.push({ key: m.key, mergedKeys: m.keys, what: m.what, how: m.how, why: gaps.filter(g => m.keys.indexOf(g.key) >= 0).map(g => g.why).join('；'), pick: SHOP_PICKS[m.key] });
    });
    gaps.forEach(g => { if (taken[g.key]) return; const ad = SHOP_ADVICE[g.key] || {}; out.push({ key: g.key, what: ad.what || g.label, how: ad.how, why: g.why, pick: SHOP_PICKS[g.key] }); });
    (W.low || []).forEach(id => {
        const prod = prodById(W, id); if (!prod) return;
        const ng = gapsIfGone(W, id); if (!ng.length) return;   // 有替补的不催(免得又变成按分类催货)
        const nk = ng.map(g => g.key), used = {};
        const covered = k => out.some(o => o.key === k || o.key === 'soon:' + k || (o.mergedKeys || []).indexOf(k) >= 0);
        SHOP_MERGE.forEach(m => {
            if (!m.keys.every(k => nk.indexOf(k) >= 0)) return;
            m.keys.forEach(k => { used[k] = 1; });
            if (covered(m.key)) return;
            out.push({ key: 'soon:' + m.key, mergedKeys: m.keys, soon: true, prod: prod.name, what: m.what + '（提前买：「' + prod.name + '」快用完了）', how: m.how,
                       why: '你标了「' + prod.name + '」快用完：它一没，' + ng.filter(g => m.keys.indexOf(g.key) >= 0).map(g => g.label).join('、') + '就都断了', pick: SHOP_PICKS[m.key] });
        });
        ng.forEach(g => {
            if (used[g.key] || covered(g.key)) return;
            const ad = SHOP_ADVICE[g.key] || {};
            out.push({ key: 'soon:' + g.key, soon: true, prod: prod.name, what: (ad.what || g.label) + '（提前买：「' + prod.name + '」快用完了）', how: ad.how,
                       why: '你标了「' + prod.name + '」快用完：它一没，' + g.label + '就断了：' + g.why, pick: SHOP_PICKS[g.key] });
        });
    });
    return out;
}
// 同品类里「家里还有的下一支」:按能力重合度打分(同角色 100 > 每项重合能力 10 > 同组 3 > 性格接近 4 > 在用 1);
// 候选资格只看同角色 / 同能力 / 同组,性格分只排序(否则一支防晒能靠「都轻薄」挤进来);现在这张脸用不了的不算能顶上。
export function pickReplacement(W, def) {
    const g = groupOfRole(def.role), caps = capsOf(def), dt = traitsOf(def);
    const st = x => statusOf(x, W.ps);
    const score = x => (x.role === def.role ? 100 : 0) + capsOf(x).filter(c => caps.includes(c)).length * 10 + ((g && g.roles.includes(x.role)) ? 3 : 0)
        + traitsOf(x).filter(t => dt.indexOf(t) >= 0).length * 4 - ((calmDownMode(W) && hasTrait(x, 'occlusive')) ? 8 : 0) + (isSchedActive(x, st(x)) ? 1 : 0);
    const ranked = (W.products || []).filter(x => x.id !== def.id && !x.hidden && !isExcluded(W, x) && st(x) !== 'pending')
        .map(x => ({ x, s: score(x) }))
        .filter(o => o.x.role === def.role || capsOf(o.x).some(c => caps.includes(c)) || (g && g.roles.includes(o.x.role)))
        .sort((a, b) => b.s - a.s);
    if (!ranked.length) return null;
    const noGood = x => blockedNow(W, x) || ((leaveOn(def) && faceWide(def) && spotOnly(W, x)) ? '这一版只点涂，顶不了全脸' : null);
    const ok = ranked.filter(o => !noGood(o.x));
    const top = (ok.length ? ok[0] : ranked[0]).x;
    return { p: top, needEnable: !isSchedActive(top, st(top)), blocked: ok.length ? null : noGood(top) };
}
