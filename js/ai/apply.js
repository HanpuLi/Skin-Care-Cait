// ══ 顾问的改动:直接生效 + 一键撤销 + 每条过安全闸 ═══════════════════════════════════════════
// Cait 2026-10-29「别光小改,放开了动」:change_tonight(今晚的小改)和 propose_regimen(整套方案)都**直接应用、留撤销**,
// 不做「采纳」门槛;只有安全闸(engine/gate.js,和离线规则同一道)能拦下某条,被拦的写明为什么没生效。
// 顾问写的今晚(/api/tonight)也走 gateTonightPlan 过闸;顾问不可用 → engine/schedule.js 的离线今晚。
// 【要紧 · 要不要买】shopLocalChange 只在**本机操作入口**触发(这个文件里的 apply* / undo* / restore* / local*),
//    云端同步、syncRegimen 自动重出、第一次打开一律不触发(10/29 定案:否则每台设备各花一次钱)。
//    store.js / sync.js / model/world.js / model/regimen.js 里不许出现 shopLocalChange(t/engine-unit.mjs 静态检查守着)。
import { K } from '../store.js';
import { buildWorld } from '../model/world.js';
import { commitAiRegimen, undoRegimen, restoreRegimen, regimenHistory, syncRegimen, currentRegimen as curReg } from '../model/regimen.js';
import { jrnlEntry, saveJrnl } from '../model/journal.js';
import { markRunOut, unGone, toggleLow } from '../model/products.js';
import { PHASES } from '../model/profile.js';
import { safetyGate, gateBlocks } from '../engine/gate.js';
import { regimenRules, maxAcidPerWeek, zonesAvoiding } from '../engine/rules.js';
import { tonight as offlineTonight } from '../engine/schedule.js';
import { exfoliantCountInLastNDays, prodByName } from '../engine/util.js';
import { shelfSignature } from '../engine/regimen.js';

// ── 本机改了货架 / 方案之后的通知(防抖、签名比对、真正去调后端都由监听方自己管)──
//   监听方有两个:产品页「要不要买」的 runner(ui/products.js ensureShopRunner)和今晚的「顾问重排」(app.js 接 ui/tonight.js localChange)。
//   onShopLocalChange(fn) 返回取消函数;onShopLocalChange(null) 清空全部(只给单测用)。
const _shopListeners = new Set();
export function onShopLocalChange(fn) {
    if (!fn) { _shopListeners.clear(); return () => { }; }
    _shopListeners.add(fn);
    return () => { _shopListeners.delete(fn); };
}
export function shopLocalChange(why) {
    const w = String(why || '').slice(0, 80);
    _shopListeners.forEach(fn => { try { fn(w); } catch (e) { } });
}
export function shopSig(W) {
    const reg = (W.regimen || []).slice(-1)[0];
    return shelfSignature(W) + '|low:' + (W.low || []).filter(id => (W.products || []).some(p => p.id === id)).sort().join(',') + '|v' + (reg ? (reg.v || 0) : 0);
}

// ── 安全闸:AI 的改动上脸前逐条核。返回 '' = 放行;否则返回原因 ──
export function validateTonight(c, g, stepNames, W) {
    if (c.op === 'acid') return (c.level === 'stop' || c.level === 'down') ? '' : '不认识的降档方式';
    if (c.op === 'note') return String(c.text || '').trim() ? '' : '没写内容';
    if (c.op === 'skip') return stepNames.indexOf(c.product) >= 0 ? '' : '今晚的步骤里没有这支';
    const p = prodByName(W, c.op === 'swap' ? c.to : c.product);
    if (!p) return '产品库里没有「' + (c.op === 'swap' ? c.to : c.product) + '」';
    if (c.op === 'swap' && stepNames.indexOf(c.product) < 0) return '今晚的步骤里没有「' + c.product + '」';
    const gb = gateBlocks(p, g, W);
    if (gb) return gb;
    const t = p.schedule && p.schedule.type;
    const ACT = ['acid', 'mask', 'retinol'];
    if (c.op === 'swap') {
        // 活性只能和同一类活性互换:否则保湿被换成酸 / 泥膜,绕过本周额度、同晚冲突,planday 也记不上(第二天推定不到这次酸)
        const o = prodByName(W, c.product), ot = (o && o.schedule && o.schedule.type) || '';
        if ((ACT.indexOf(t) >= 0 || ACT.indexOf(ot) >= 0) && t !== ot) return ACT.indexOf(t) >= 0 ? '今晚不能把「' + c.product + '」换成活性；要加活性得过本周额度' : '活性只能换成同一类的活性；想停就说跳过';
    }
    if (t === 'acid' && c.op === 'add') {
        if (exfoliantCountInLastNDays(W, 7) >= Math.min(g.acidCapMax, 7)) return '这周的刷酸已经到安全闸的上限了';
        const tn = W.tn || {};
        if (tn.date === W.today && tn.shave && (W.profile || {}).shaving) return '刮胡夜不上酸';
    }
    return '';
}
// 整套方案的改动(对话 propose_regimen / 复盘 adjustments)。base = 正在拼的新规矩(会被改)。返回 {why, partial}
export function validateRegimenChange(c, g, base, W) {
    const P = W.profile || {}, op = c.op;
    if (op === 'acid_freq') {
        const n = Math.round(+c.value);
        if (!(n >= 0 && n <= 7)) return { why: '次数不对' };
        if (c.product) {
            const p = prodByName(W, c.product);
            if (!p || p.role !== 'acid') return { why: '产品库里没有「' + c.product + '」这支酸' };
            const gb = gateBlocks(p, g, W);
            if (gb) return { why: '「' + p.name + '」' + gb };
        }
        const partial = n > g.acidCapMax ? '现在先按 ' + g.acidCapMax + ' 次/周（' + (g.notes[0] || '安全闸') + '），好了自动按 ' + n + ' 次' : '';
        base.acidCap = n;
        if (c.product) base.acidName = prodByName(W, c.product).name;
        return { why: '', partial };
    }
    if (op === 'add_product') {
        const p = prodByName(W, c.product);
        if (!p) return { why: '产品库里没有「' + c.product + '」' };
        const gb = gateBlocks(p, g, W);
        if (gb) return { why: '「' + p.name + '」' + gb };
        if (base.include.indexOf(p.name) < 0) base.include.push(p.name);
        base.resting = base.resting.filter(x => x.name !== p.name);
        if (p.role === 'acid' && !base.acidName) base.acidName = p.name;
        return { why: '' };
    }
    if (op === 'remove_product') {
        const p = prodByName(W, c.product);
        if (!p) return { why: '产品库里没有「' + c.product + '」' };
        if (!base.resting.some(x => x.name === p.name)) base.resting.push({ name: p.name, why: c.why || '顾问这一版先不排' });
        base.include = base.include.filter(n => n !== p.name);
        if (String(base.acidName || '').split(' / ').indexOf(p.name) >= 0) base.acidName = '';
        return { why: '' };
    }
    if (op === 'phase') {
        if (!PHASES[c.value]) return { why: '不认识的阶段' };
        base.phase = c.value;
        return { why: '', partial: g.irritated && c.value !== 'repair' ? '阶段记下了；但近 3 天在发炎，今晚照安全闸来' : '' };
    }
    if (op === 'zone') {
        const zn = String(c.product || '').trim().slice(0, 20), av = c.value;
        if (!zn || ['acid', 'retinol', 'mask', 'scrub'].indexOf(av) < 0) return { why: '部位或避开类型不对' };
        let z = base.zonesAdd.find(x => x.name === zn);
        if (!z) { z = { name: zn, avoid: [] }; base.zonesAdd.push(z); }
        if (z.avoid.indexOf(av) < 0) z.avoid.push(av);
        if (av === 'acid' && base.acidZones.indexOf(zn) < 0) base.acidZones.push(zn);
        return { why: '' };
    }
    if (op === 'cleanse') { const v = String(c.value || '').trim(); if (!v) return { why: '没写内容' }; base.cleanse = v.slice(0, 60); return { why: '' }; }
    if (op === 'repair') {
        if (c.value !== 'spot' && c.value !== 'full') return { why: '修护霜用法只能是点涂 / 全脸薄涂' };
        base.repair = c.value; base.repairWhy = c.why || '';
        return { why: '', partial: P.repairUse ? '你在「设置」里手动定了修护霜用法，那个优先' : '' };
    }
    return { why: '不认识的改法' };
}
// 新规矩的起点:当前顾问方案的规矩;没有就从离线阶梯现在的状态出发(别从零开始)
export function baseRules(W) {
    const rr = regimenRules(W);
    const r = JSON.parse(JSON.stringify({
        acidCap: Math.round(+rr.acidCap || 0), acidName: rr.source === 'ai' ? (rr.acidName || '') : '', acidZones: rr.acidZones || [], cleanse: rr.cleanse || '',
        repair: rr.source === 'ai' ? (rr.repair || '') : '', repairWhy: rr.source === 'ai' ? (rr.repairWhy || '') : '',
        resting: rr.resting || [], include: rr.include || [], zonesAdd: rr.zonesAdd || [], phase: rr.source === 'ai' ? (rr.phase || '') : ''
    }));
    ['acidZones', 'resting', 'include', 'zonesAdd'].forEach(k => { if (!Array.isArray(r[k])) r[k] = []; });
    return r;
}
// /api/plan 的结果 → 一套规矩(过闸)。返回 {rules, blocked[]}
export function validatePlan(data, g, W) {
    const R = (data && data.rules) || {}, blocked = [];
    const rules = { acidCap: 1, acidName: '', acidZones: [], cleanse: '', repair: '', repairWhy: '', resting: [], include: [], zonesAdd: [], phase: '' };
    const n = Math.round(+R.acidCap);
    rules.acidCap = (n >= 0 && n <= 7) ? n : 1;
    if (rules.acidCap > g.acidCapMax) blocked.push({ text: '每周 ' + rules.acidCap + ' 次', why: '现在先按 ' + g.acidCapMax + ' 次（' + (g.notes[0] || '安全闸') + '），好了自动恢复', partial: true });
    if (R.acidName) {
        const p = prodByName(W, R.acidName);
        const gb = !p ? '产品库里没有这支' : (p.role !== 'acid' ? '它不是酸' : gateBlocks(p, g, W));
        if (gb) blocked.push({ text: '用「' + R.acidName + '」', why: gb }); else rules.acidName = p.name;
    }
    rules.acidZones = (Array.isArray(R.acidZones) ? R.acidZones : []).map(x => String(x || '').trim().slice(0, 20)).filter(Boolean);
    rules.cleanse = String(R.cleanse || '').slice(0, 80);
    if (R.repair === 'spot' || R.repair === 'full') { rules.repair = R.repair; rules.repairWhy = String(R.repairWhy || '').slice(0, 80); }
    (Array.isArray(data && data.resting) ? data.resting : []).forEach(x => {
        const p = x && prodByName(W, x.name);
        if (p && !rules.resting.some(y => y.name === p.name)) rules.resting.push({ name: p.name, why: String(x.why || '').slice(0, 60) });
    });
    return { rules, blocked };
}
// 顾问写的今晚(/api/tonight)过闸:产品必须在库;被闸拦的挪进「今晚不用」并写明为什么;酸还要看本周额度和刮胡夜。
// 和离线排法(engine/schedule.js)同一套:
//   · 泥膜和酸共用去角质额度(产品备注「使用当晚视为酸类占用」);
//   · 酸和声明了 avoidAcid 的泥膜 / 维 A 不同晚,泥膜和维 A 也不同晚(schedule.js 第 4 段冲突规则);
//   · 分区避开项永远生效(gate ⑦):活性步骤的「怎么用」里顾问没提到的避开区,照离线那句补上;
//   · 纯动作(product 为空)的文字点到了某支产品,就按那支产品过同一道闸;闸收紧的晚上(额度 0 / 刮胡 / 第一晚 / 就医)
//     文字里带「酸 / 去角质 / 维 A / 视黄 / 面膜 / 磨砂」的纯动作一律拦下(否则红线亮着也能借一句话把酸写进来)。
// 返回 {title, why, steps[{product, how, why, kind}], skips[{product, why}], blocked[{product, why}], dropped[]};一步都不剩 → null(退回离线)
// 不用后行断言(老 iOS Safari 不认,整个模块会解析失败):先抹掉保湿类的「酸」再查
const actWords = x => /酸|去角质|维\s*A|视黄|面膜|磨砂|换肤/i.test(String(x || '').replace(/透明质酸|玻尿酸|氨基酸/g, ''));
const squash = x => String(x || '').replace(/\s+/g, '').toLowerCase();
// 纯动作的文字里点名了哪支产品(名字或打卡标签,忽略空格大小写;取最长的那个,免得短标签误配)
export function productNamedIn(W, text) {
    const t = squash(text);
    if (!t) return null;
    let best = null, len = 0;
    (W.products || []).forEach(p => {
        [p.name, p.journalTag].forEach(k => {
            const q = squash(k);
            if (q.length >= 2 && t.indexOf(q) >= 0 && q.length > len) { best = p; len = q.length; }
        });
    });
    return best;
}
export function gateTonightPlan(W, data) {
    if (!data || !Array.isArray(data.steps)) return null;
    const g = safetyGate(W), P = W.profile || {}, tn = W.tn || {};
    const shave = tn.date === W.today && !!tn.shave && !!P.shaving;
    const cap = maxAcidPerWeek(W), used = exfoliantCountInLastNDays(W, 7);
    const tight = g.acidCapMax === 0 || cap === 0 || shave || g.firstNight || g.medical;
    const steps = [], blocked = [], dropped = (data.dropped || []).slice(0, 8);
    const skips = (Array.isArray(data.skips) ? data.skips : []).filter(x => x && x.product).map(x => ({ product: String(x.product), why: String(x.why || '') }));
    const taken = [];   // 今晚已放行的活性 [{type, p}]
    const avoidsAcid = p => !(p.schedule && p.schedule.avoidAcid === false);
    // 顾问在步骤里明写了的产品:纯动作点到它们只是那一步的补充说明,跟着那一步走(那一步被拦,说明也拿掉)
    const explicit = new Set(data.steps.slice(0, 14).map(s => s && prodByName(W, String(s.product || '').trim())).filter(Boolean).map(p => p.name));
    data.steps.slice(0, 14).forEach(s => {
        if (!s) return;
        let name = String(s.product || '').trim();
        let how = String(s.how || '');
        const why = String(s.why || '');
        if (!name) {   // 纯动作(凉水冲洗之类)
            if (!how) return;
            const named = productNamedIn(W, how + ' ' + why);
            if (named && explicit.has(named.name)) { steps.push({ product: '', how, why, kind: 'base', ref: named.name }); return; }
            if (named) name = named.name;   // 点名了某支没单列的产品 → 当成那支产品走下面同一段闸
            else if (tight && actWords(how + ' ' + why)) {
                const gbw = g.medical ? '就医提醒亮着：今晚不上任何去角质 / 活性' : shave ? '刮胡夜不上酸、维 A、泥膜' : g.firstNight ? '第一晚：先不上任何活性' : '这周去角质额度是 0';
                blocked.push({ product: how.slice(0, 40), why: gbw, act: true });
                return;
            } else { steps.push({ product: '', how, why, kind: 'base' }); return; }
        }
        const p = prodByName(W, name);
        if (!p) { dropped.push(name); return; }
        const t = (p.schedule && p.schedule.type) || '';
        const act = ['acid', 'mask', 'retinol'].indexOf(t) >= 0 ? t : (p.role === 'acid' ? 'acid' : (p.role === 'mask' || p.role === 'retinol') ? p.role : '');
        let gb = gateBlocks(p, g, W);
        if (!gb && act && shave) gb = '刮胡夜不上酸、维 A、泥膜';
        if (!gb && (act === 'acid' || act === 'mask')) {
            const ex = taken.filter(x => x.type === 'acid' || x.type === 'mask').length;
            if (cap === 0) gb = '这周去角质额度是 0';
            else if (used + ex >= cap) gb = (act === 'acid' && !ex ? '这周已经刷过 ' + used + ' 次，到上限了' : (ex ? '算上今晚已排的，' : '') + '这周已经刷酸 / 敷泥膜 ' + (used + ex) + ' 次（两样一起算），到上限了');
            else if (act === 'acid' && taken.some(x => x.type === 'acid')) gb = '一晚只上一支酸';
        }
        if (!gb && act) {
            const hasT = ty => taken.find(x => x.type === ty);
            if (act === 'acid') {
                const m = taken.find(x => (x.type === 'mask' || x.type === 'retinol') && avoidsAcid(x.p));
                if (m) gb = (m.type === 'mask' ? '面膜' : '维 A') + '和酸不同晚';
            } else if (act === 'mask') {
                if (hasT('acid') && avoidsAcid(p)) gb = '面膜和酸不同晚';
                else if (hasT('retinol')) gb = '面膜和维 A 不同晚';
                else if (hasT('mask')) gb = '一晚只敷一种面膜';
            } else if (act === 'retinol') {
                if (hasT('acid') && avoidsAcid(p)) gb = '维 A 和酸不同晚';
                else if (hasT('mask')) gb = '面膜和维 A 不同晚';
            }
        }
        if (gb) { blocked.push({ product: p.name, why: gb }); skips.push({ product: p.name, why: gb }); return; }
        if (act) {
            taken.push({ type: act, p });
            const miss = zonesAvoiding(W, act).filter(z => how.indexOf(z) < 0);   // 顾问没写到的避开区,照离线那句补
            if (miss.length) how += '（避开' + miss.join('、') + '）';
        }
        steps.push({ product: p.name, how, why, kind: act || 'base' });
    });
    const out = steps.filter(s => !s.ref || steps.some(y => y.product === s.ref)).map(s => { if (s.ref) { const c = Object.assign({}, s); delete c.ref; return c; } return s; });
    if (!out.some(s => s.product)) return null;
    return { title: String(data.title || ''), why: String(data.why || ''), steps: out, skips, blocked, dropped };
}
// 今晚:顾问版能用就用(已过闸),否则离线版。aiData = 按天缓存的 /api/tonight data(没有就 null)
export function tonightPlan(W, aiData) {
    const ai = aiData ? gateTonightPlan(W, aiData) : null;
    if (ai) return Object.assign({ source: 'ai' }, ai);
    const off = offlineTonight(W);
    return { source: 'offline', title: '', why: '', steps: off.steps.map(s => ({ product: s.p, how: s.h, why: '', kind: s.kind, t: s.t, chg: s.chg })),
             skips: off.skips.map(x => ({ product: x, why: '' })), warnings: off.warnings, blocked: [], dropped: [] };
}

// ── 直接应用 + 撤销 ──
export const TONIGHT_TXT = {
    skip: c => '今晚跳过「' + c.product + '」', swap: c => '今晚「' + c.product + '」换成「' + c.to + '」',
    add: c => '今晚加「' + c.product + '」', acid: c => c.level === 'stop' ? '今晚的酸停掉' : '今晚的酸降一档', note: c => '记一笔：' + c.text
};
export const REG_TXT = {
    acid_freq: c => '刷酸改成每周 ' + c.value + ' 次' + (c.product ? '，用「' + c.product + '」' : ''),
    add_product: c => '把「' + c.product + '」正式排进来', remove_product: c => '「' + c.product + '」这一版先不排',
    phase: c => '阶段：' + ((PHASES[c.value] || {}).name || c.value), zone: c => c.product + '避开' + ({ acid: '酸', retinol: '维 A', mask: '面膜', scrub: '磨砂' }[c.value] || c.value),
    cleanse: c => '洗脸：' + c.value, repair: c => '修护霜' + (c.value === 'spot' ? '只点涂' : '全脸薄涂')
};
// 今晚的小改(change_tonight)→ 写 sk_tnai1(撤销用的「改之前」存在它自己身上)+ 今天日志的备注。返回一条记录挂在那条助手消息上。
export function applyTonight(store, j, today) {
    if (!j || !Array.isArray(j.changes) || !j.changes.length) return null;
    const W = buildWorld(store, { today });
    const changes = j.changes.slice(0, 6).filter(c => c && typeof c === 'object');
    const g = safetyGate(W);
    let stepNames = [];
    try { stepNames = offlineTonight(W).steps.map(s => s.p); } catch (e) { }
    const prev = store.lg(K.tnai);
    const cur = (prev && prev.date === today) ? JSON.parse(JSON.stringify(prev)) : { date: today, ops: [] };
    const jr0 = (store.lg(K.jrnl) || []).find(x => x.date === today);
    const snapNote = jr0 ? (jr0.note || '') : null;
    const result = changes.map(c => validateTonight(c, g, stepNames, W));
    let n = 0, noteAdded = '';
    changes.forEach((c, k) => {
        if (result[k]) return;
        n++;
        if (c.op === 'note') {
            const { list, en } = jrnlEntry(store, today, true);
            const add = (en.note ? '；' : '') + String(c.text).trim();
            en.note = (en.note || '') + add; noteAdded += add;
            saveJrnl(store, list);
            return;
        }
        if (c.op === 'acid') cur.ops = cur.ops.filter(o => o.op !== 'acid');
        cur.ops.push({ op: c.op, product: c.product || '', to: c.to || '', level: c.level || '', why: c.why || '' });
    });
    const id = String(j.id || ('t' + store.now())).slice(0, 80);
    if (n) {
        cur.id = id; cur.at = new Date(store.now()).toISOString();
        const prevPlain = prev && prev.date === today ? Object.assign({}, prev) : null;
        if (prevPlain) delete prevPlain.undo;
        // noteAdded:撤销时只摘掉顾问追加的那一段(中间她自己又写的字不动);note 字段留给 v1 读(只在真追加过时给)
        cur.undo = noteAdded ? { prev: prevPlain, note: snapNote, noteAdded } : { prev: prevPlain };
        store.ls(K.tnai, cur);
    }
    return { kind: 'tonight', id, changes, result, dropped: (j.dropped || []).slice(0, 6), state: n ? 'applied' : 'failed', applied: n };
}
// 撤销今晚的小改 = 回到改之前那一份(顾问追加的备注一起退)。返回 '' = 撤了
export function undoTonightChange(store, id, today) {
    const cur = store.lg(K.tnai);
    if (!cur || cur.date !== today) return '已经不是那天了，不用撤';
    if (id && cur.id !== id) return '后面又改过一次，先撤最近那次';
    const u = cur.undo || {};
    store.ls(K.tnai, u.prev || null);
    if (u.noteAdded) {
        const { list, en } = jrnlEntry(store, today, false);
        const at = en && typeof en.note === 'string' ? en.note.lastIndexOf(u.noteAdded) : -1;
        if (at >= 0) { en.note = (en.note.slice(0, at) + en.note.slice(at + u.noteAdded.length)).replace(/^；/, ''); saveJrnl(store, list); }
    } else if (u.note !== undefined && u.note !== null) {   // v1 写的撤销记录
        const { list, en } = jrnlEntry(store, today, false);
        if (en) { en.note = u.note; saveJrnl(store, list); }
    }
    return '';
}
// 整套方案的改动 → 新的一版方案(source:'ai'),撤销 = 回到上一版
export function applyRegimen(store, changes, meta, today) {
    meta = meta || {};
    const W = buildWorld(store, { today });
    const g = safetyGate(W), base = baseRules(W);
    const result = [], blocked = [];
    let n = 0;
    (changes || []).forEach(c => {
        const v = validateRegimenChange(c, g, base, W);
        const txt = (REG_TXT[c.op] || (() => c.op))(c);
        if (v.why) { result.push(v.why); blocked.push({ text: txt, why: v.why }); return; }
        n++; result.push('');
        if (v.partial) blocked.push({ text: txt, why: v.partial, partial: true });
    });
    let reg = null;
    if (n) {
        reg = commitAiRegimen(store, base, { kind: meta.kind || 'chat', reason: meta.reason || '顾问改了方案', rationale: meta.rationale || '', blocked, model: meta.model, cost: meta.cost }, today);
        shopLocalChange('顾问把方案换成了 v' + reg.v);   // 本机落成(对话 / 出方案 / 复盘),同步来的不走这里
    }
    return { kind: 'regimen', id: String(meta.id || ('p' + store.now())).slice(0, 80), changes, result, blocked, versionId: reg ? reg.id : null, v: reg ? reg.v : null, state: n ? 'applied' : 'failed' };
}
// /api/plan 的整套方案 → 过闸 → 落成一版
export function applyPlan(store, data, meta, today) {
    const W = buildWorld(store, { today });
    const v = validatePlan(data, safetyGate(W), W);
    const reg = commitAiRegimen(store, v.rules, Object.assign({ kind: 'plan', reason: '顾问出的方案', rationale: (data && data.rationale) || '' }, meta || {}, { blocked: v.blocked }), today);
    shopLocalChange('顾问把方案换成了 v' + reg.v);
    return reg;
}
export function undoRegimenChange(store, id, today) {
    const last = curReg(store);
    const why = undoRegimen(store, id, today);
    if (!why) shopLocalChange('撤销了方案 v' + (last ? last.v : ''));
    return why;
}
export function restoreRegimenLocal(store, id, reason, today) {
    const src = regimenHistory(store).find(h => h.id === id);
    const reg = restoreRegimen(store, id, reason, today);
    if (reg) shopLocalChange('方案换回了 v' + (src ? src.v : ''));
    return reg;
}
// ── 货架上的本机操作(产品页 P2 调这些,不要直接调 model 层):改货架 → 方案 force 重出一版 → 触发「要不要买」──
export function localMarkRunOut(store, id, today) {
    const rec = markRunOut(store, id, today); if (!rec) return null;
    const reg = syncRegimen(store, '用完了：' + rec.name, true, today);
    shopLocalChange('「' + rec.name + '」用完了');
    return { rec, reg };
}
export function localUnGone(store, id, today) {
    const def = unGone(store, id, today);
    const reg = syncRegimen(store, '补货：' + (def ? def.name : id), true, today);
    shopLocalChange('「' + (def ? def.name : id) + '」买回来了');
    return { def, reg };
}
export function localToggleLow(store, id, today) {
    const on = toggleLow(store, id);
    const p = buildWorld(store, { today, noAbsorb: true }).products.find(x => x.id === id);
    shopLocalChange(p ? (on ? '标了「' + p.name + '」快用完了' : '「' + p.name + '」又够用了') : '快用完的有变化');
    return on;
}
