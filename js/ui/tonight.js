// ══ 今晚 ══════════════════════════════════════════════════════════════════════════════
// 四层(IA 10/29,Cait 拍板):① 「今晚 · 夜型」+ 一句为什么 ② 今晚的情况(洗澡吗 / 刮胡吗,点了用真实排班的差异说影响)
//   ③ 最多一张提醒卡(就医 > 注意 > 其余),其余折成「还有 N 条」;「顾问改了今晚 · 撤销」单独一行,始终可见
//   ④ 步骤(每步一句为什么)→ 完整模式「完成今晚」进记皮肤流程 /「只记皮肤」;极简模式不打卡,只有活性步骤的「今晚没做」和「记一下皮肤」。
// 【AI 为核心】今晚由顾问写(POST /api/tonight),结果过安全闸(ai/apply.js tonightPlan → gateTonightPlan),被拦的写明原因;
//   顾问不可用 / 离线 / 没开通 / 没登录 → 离线排法(engine/schedule.js),界面标明「离线排法」。
//   缓存在本机 sk_ai_tonight1 = {uid, date, sig, data | err, at}:sig = 日期 + 洗澡 / 刮胡 + 模式 + 方案版本 + 货架签名。
//   什么时候调(和「要不要买」同一套口径):
//     · 新的一天(这个账号今天还没有任何一份)→ 自动调一次;
//     · 本机操作(这一屏的洗澡 / 刮胡开关、「让顾问重排」;别的屏通过 localChange(app, why))→ 签名变了才调,防抖;
//     · 同步来的改动、自动重出的方案:**不调**,只标「情况变了,先用离线排法」+「让顾问重排」。
//   顾问的今晚小改(sk_tnai1)直接叠在顾问版上再过闸,撤销立刻生效,不用重调。
// 【事故守卫】安全提示(engine 的 warnings)任何模式都显示;就医红线卡任何模式都显示,亮时所有酸停、眼霜照用;
//   刮胡夜不上酸(闸里也拦);极简模式「今晚没做」只在活性步骤上,点了第二天不会被推定成用了(model/journal.js);
//   极简模式下顾问版里**排班之外**的活性不上(第二天的推定按排班记,多上一次酸会漏记)。
import { K, LOCAL_KEYS } from '../store.js';
import { dowOf } from '../clock.js';
import { jrnlEntry, saveJrnl, toggleSkipped } from '../model/journal.js';
import { toggleTn } from '../model/week.js';
import { setMedical } from '../model/profile.js';
import { ROLE_LABEL, ROLE_ORDER, cleanseStrength } from '../model/products.js';
import { tonight as offlineTonight, computePlan, acidHistory } from '../engine/schedule.js';
import { safetyGate } from '../engine/gate.js';
import { shelfSignature } from '../engine/regimen.js';
import { prodByName } from '../engine/util.js';
import { acidTiming, tonightOverride, repairUse } from '../engine/rules.js';
import { tonightPlan, TONIGHT_TXT, applyTonight, undoTonightChange } from '../ai/apply.js';
import { buildSkincareContext } from '../ai/context.js';
import { esc, ico, toast } from './sheets.js';
import { openSkinSheet, feedbackHtml, hasLog } from './record.js';

export const id = 'tonight';
export const title = '今晚';
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ACTIVE = ['acid', 'mask', 'retinol'];
const ACT_N = { acid: '酸', retinol: '维 A', mask: '面膜' };
const DEBOUNCE = 1500;
const st = { more: false, busy: false, pending: '', timer: null, tried: {}, lastProbe: 0, redo: null, fx: null };

// ══ 顾问写今晚:缓存 / 什么时候调 ════════════════════════════════════════════════════════
function uidOf(app) { const u = app.sync && app.sync.state && app.sync.state.user; return u ? u.uid : ''; }
function readCache(app) { try { return JSON.parse(app.store.getLocal(LOCAL_KEYS.aiTonight) || 'null'); } catch (e) { return null; } }
function writeCache(app, v) { app.store.setLocal(LOCAL_KEYS.aiTonight, JSON.stringify(v)); }
export function tonightSig(W, off) {
    const reg = (W.regimen || []).slice(-1)[0];
    return [W.today, off.shower ? 1 : 0, off.shave ? 1 : 0, (W.profile || {}).minimalMode ? 1 : 0, reg ? (reg.id || reg.v || '') : '', shelfSignature(W)].join('|');
}
function aiStatus(app, W, off) {
    const ai = app.ai, acc = ai ? ai.access() : 'out';
    const sig = tonightSig(W, off), uid = uidOf(app);
    const out = { acc, sig, data: null, at: '', state: '', err: '' };
    if (acc !== 'on') { out.state = acc; return out; }
    const c = readCache(app), mine = c && c.uid === uid && c.date === W.today ? c : null;
    if (mine && mine.data && mine.sig === sig) { out.data = mine.data; out.at = mine.at; out.state = 'fresh'; }
    else if (mine && mine.data) out.state = 'stale';
    else if (mine && mine.err) { out.state = mine.quota ? 'quota' : mine.down ? 'down' : 'err'; out.err = mine.err; out.errSig = mine.sig; }
    else if (ai.state && ai.state.down) out.state = 'down';
    else out.state = 'pending';
    if (st.busy) out.busy = true;
    const q = ai.quotaText && ai.quotaText();
    if (q && !out.data) { out.state = 'quota'; out.err = q; }
    return out;
}
function repaint(app) { try { app.renderScreen('tonight'); } catch (e) { } }
async function fetchTonight(app, why) {
    const ai = app.ai;
    if (!ai || ai.access() !== 'on') return;
    if (st.busy) { st.pending = why || 'again'; return; }
    if (!ai.ready()) { try { await ai.probe(); } catch (e) { } if (!ai.ready()) { repaint(app); return; } }
    const uid = uidOf(app), W = app.world();
    if (!(W.products || []).some(p => !p.hidden)) return;   // 货架是空的:没什么可排
    const off = offlineTonight(W), sig = tonightSig(W, off);
    st.busy = true; st.tried[uid + '|' + W.today] = true;
    repaint(app);
    let rec;
    try {
        const u = app.sync.state.user;
        const r = await ai.api.tonight(buildSkincareContext(W, { name: u && u.displayName ? String(u.displayName).split(' ')[0] : '' }));
        const d = r && r.data;
        if (!d || !Array.isArray(d.steps) || !d.steps.length) throw new Error('顾问这次没排出步骤');
        rec = { uid, date: W.today, sig, data: d, at: new Date(app.store.now()).toISOString(), model: (r && r.model) || '', why: String(why || '').slice(0, 40) };
    } catch (e) {
        rec = { uid, date: W.today, sig, err: e.message || '顾问出错了', quota: e.quota || '', down: e.code === 0, at: new Date(app.store.now()).toISOString() };
    }
    st.busy = false;
    if (uidOf(app) === uid && app.today() === rec.date) writeCache(app, rec);   // 换了账号 / 过了零点:这一份作废
    repaint(app);
    if (st.pending) {
        const p = st.pending; st.pending = '';
        const W2 = app.world();
        if (tonightSig(W2, offlineTonight(W2)) !== rec.sig) fetchTonight(app, p);
    }
}
// 本机操作之后(这一屏的开关、别的屏用完了 / 换方案 / 撤销……):签名变了才调,防抖
export function localChange(app, why) {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
        const ai = app.ai; if (!ai || ai.access() !== 'on') return;
        const W = app.world(), s = aiStatus(app, W, offlineTonight(W));
        if (s.state === 'fresh') return;
        fetchTonight(app, why || 'local');
    }, DEBOUNCE);
}
// 新的一天:这个账号今天还没有任何一份(连失败的也没有)才自动调;顾问刚确认开通(probe 完)时也走这里
export function onAiReady(app) { maybeAuto(app); }
function maybeAuto(app) {
    const ai = app.ai; if (!ai || ai.access() !== 'on') return;
    const W = app.world(), uid = uidOf(app), key = uid + '|' + W.today;
    const c = readCache(app);
    if (c && c.uid === uid && c.date === W.today) return;   // 今天已经有一份:签名对不上也不自动调,只标「情况变了」
    if (st.tried[key] || st.busy) return;
    if (!ai.ready()) {
        if (Date.now() - st.lastProbe < 60000) return;
        st.lastProbe = Date.now();
        Promise.resolve(ai.probe()).then(() => { if (ai.ready()) maybeAuto(app); }, () => { });
        return;
    }
    fetchTonight(app, 'newday');
}

// ══ 顾问版 + 今晚的小改(sk_tnai1)→ 过闸 ══════════════════════════════════════════════════
// 小改叠在顾问写的原始步骤上,再交给 tonightPlan 过闸(加的 / 换的产品也要过闸)。返回 {data, changed:Set(产品名)}
function withOverride(W, data, ov) {
    const changed = new Set();
    if (!ov) return { data, changed };
    const d = JSON.parse(JSON.stringify(data));
    d.steps = Array.isArray(d.steps) ? d.steps : []; d.skips = Array.isArray(d.skips) ? d.skips : [];
    const kindOf = n => { const p = prodByName(W, n); const t = p && p.schedule && p.schedule.type; return ACTIVE.indexOf(t) >= 0 ? t : (p && p.role === 'acid' ? 'acid' : ''); };
    const roleIdx = n => { const p = prodByName(W, n); return p ? ROLE_ORDER.indexOf(p.role) : -1; };
    ov.ops.forEach(c => {
        const why = c.why ? '：' + c.why : '';
        if (c.op === 'skip') {
            const i = d.steps.findIndex(s => s && s.product === c.product);
            if (i >= 0) { d.steps.splice(i, 1); d.skips.push({ product: c.product, why: '顾问：今晚先跳过' + why }); }
        } else if (c.op === 'swap') {
            const s = d.steps.find(x => x && x.product === c.product);
            if (s && c.to) { s.product = c.to; s.why = '顾问今晚换的' + why; changed.add(c.to); }
        } else if (c.op === 'add') {
            if (!c.product || d.steps.some(x => x && x.product === c.product)) return;
            const ri = roleIdx(c.product);
            let at = d.steps.findIndex(x => x && x.product && roleIdx(x.product) > ri);
            if (at < 0) at = d.steps.length;
            d.steps.splice(at, 0, { product: c.product, how: '', why: '顾问今晚加的' + why });
            changed.add(c.product);
        } else if (c.op === 'acid') {
            const i = d.steps.findIndex(x => x && x.product && kindOf(x.product) === 'acid');
            if (i < 0) return;
            if (c.level === 'stop') { const p = d.steps[i].product; d.steps.splice(i, 1); d.skips.push({ product: p, why: '顾问：今晚的酸停掉' + why }); }
            else { const s = d.steps[i]; s.how = (s.how || '') + '（今晚降一档：只薄涂一层、时间减半，刺痛马上洗掉）'; changed.add(s.product); }
        }
    });
    return { data: d, changed };
}
// 极简模式:第二天按排班(sk_planday1)推定「排上的都用了」—— 顾问版里排班之外的活性今晚不上,不然多上的那次会漏记
function minimalGuard(W, plan, off) {
    const slot = new Set(((off.slot && off.slot.items) || []).filter(it => ACTIVE.indexOf(it.type) >= 0).map(it => { const p = (W.products || []).find(q => q.id === it.id); return p ? p.name : it.label; }));
    const keep = [], blocked = plan.blocked.slice(), skips = plan.skips.slice();
    plan.steps.forEach(s => {
        if (s.product && ACTIVE.indexOf(s.kind) >= 0 && !slot.has(s.product)) {
            const why = '只看今晚的用法按排班走，排班外的' + (ACT_N[s.kind] || '活性') + '今晚不加';
            blocked.push({ product: s.product, why }); skips.push({ product: s.product, why });
        } else keep.push(s);
    });
    if (!keep.some(s => s.product)) return null;
    return Object.assign({}, plan, { steps: keep, blocked, skips });
}

// ══ 一步一句为什么(离线排法没有顾问的理由时,按角色给一句;顾问版用顾问写的)══════════════════════════
function offlineWhy(W, name, kind, off) {
    const p = prodByName(W, name), role = p ? p.role : '';
    if (kind === 'acid') { const n = acidHistory(W, 6).thisWeek.length; return '按方案排的' + (n ? '，这 7 天第 ' + (n + 1) + ' 次' : '') + '；温和酸疏通闭口，看反应一档档加。'; }
    if (kind === 'mask') return '面膜按每周上限排，不和酸同一晚。';
    if (kind === 'retinol') return '维 A 单独一晚上，不和酸叠。';
    if (/^凉水冲洗/.test(name)) return '刮完先降温，减少泛红。';
    if (!p) return '';
    return ({ precleanse: '化了妆或涂了厚防晒，先卸干净。', cleanse: off.shower ? '洗澡时一起洗，后面的才上得去。' : '先洗干净，后面的才上得去。',
              soothe: '最近有泛红，先镇静。', serum: '修护夜用，帮皮肤稳住。', oil: '量少，锁水；闭口时会停。', eye: '眼周不碰酸，眼霜照常。',
              moist: '封住水分，屏障靠这一层。', repair: repairUse(W) === 'spot' ? '封闭性强，点涂兜住刺激就够，不闷闭口。' : '全脸薄涂一层，护住屏障。', spf: '' })[role] || '';
}
function splitWhy(x) { const m = String(x || '').match(/^(.*?)（(.*)）$/); return m ? { product: m[1], why: m[2] } : { product: String(x || ''), why: '' }; }
function hm(iso) { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function joinCn(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join('、') + '和' + a[a.length - 1]; }
function nextAcidNight(W) {
    try { const d = computePlan(W).find(x => x.isFuture && (x.items || []).some(it => it.type === 'acid')); return d ? WEEK[dowOf(d.date)] : ''; } catch (e) { return ''; }
}

// ── 今晚的情况:点了以后拿「点之前 / 点之后」两份真实排班比,说影响了什么(不写死)──
function snapOf(W) { try { return offlineTonight(W).steps.map(x => ({ p: x.p, kind: x.kind })); } catch (e) { return []; } }
function effectText(W, k, on, b, a) {
    const lead = k === 'shave' ? (on ? '刮胡夜' : '今晚不刮') : (on ? '洗澡夜' : '今晚不洗澡');
    const has = (L, p) => L.some(x => x.p === p);
    const gone = b.filter(x => !has(a, x.p)), come = a.filter(x => !has(b, x.p));
    const kinds = L => [...new Set(L.filter(x => ACT_N[x.kind]).map(x => ACT_N[x.kind]))];
    const parts = [], kg = kinds(gone), kc = kinds(come);
    if (kg.length) {
        const why = (k === 'shower' && on && acidTiming(W) === 'avoid' && kg.indexOf('酸') >= 0) ? '（刚洗完热水澡更容易刺激）' : '';
        const nxt = kg.indexOf('酸') >= 0 ? nextAcidNight(W) : '';
        parts.push(joinCn(kg) + '今晚不上' + why + (nxt ? '，下次刷酸在' + nxt : ''));
    }
    if (kc.length) parts.push(joinCn(kc) + '今晚排上' + (k === 'shower' && on && acidTiming(W) === 'prefer' && kc.indexOf('酸') >= 0 ? '（洗澡后角质软，适合刷）' : ''));
    const pOf = x => x && prodByName(W, x.p);
    const isCl = x => { const q = pOf(x); return !!q && (q.role === 'cleanse' || q.role === 'precleanse'); };
    const cb = b[0], ca = a[0], swapped = isCl(cb) && isCl(ca) && cb.p !== ca.p;
    if (swapped) { const cs = cleanseStrength(pOf(ca)); parts.push('洁面换成' + (cs === 'strong' ? '清洁力强一点的' : cs === 'gentle' ? '温和的' : '') + '「' + ca.p + '」'); }
    if (come.some(x => /^凉水冲洗/.test(x.p))) parts.push('刮完先用凉水冲');
    const roleOf = x => { const q = pOf(x); return q ? (ROLE_LABEL[q.role] || '') : ''; };
    const base = L => [...new Set(L.filter(x => !ACT_N[x.kind] && !(swapped && (x.p === cb.p || x.p === ca.p))).map(roleOf).filter(Boolean))];
    const rg = base(gone), rc = base(come);
    if (rg.length) parts.push(rg.join('、') + '今晚不用');
    if (rc.length) parts.push(rc.join('、') + '排回来');
    return lead + '：' + (parts.length ? parts.join('，') : '今晚步骤不变') + '。';
}
function defaultFx(k, on, acidTonight, g) {
    if (k === 'shave') {
        if (g.medical) return '就医提醒亮着，今晚本来就不上酸。';
        return on ? '刮胡夜：酸、维 A、泥膜今晚都不上，刮完先用凉水冲。' : (acidTonight ? '不刮，今晚照常刷酸。' : '不刮。');
    }
    return on ? (acidTonight ? '洗澡后角质软，今晚适合刷酸。' : '洗澡时一起洗脸。') : (acidTonight ? '不洗澡也能刷：洗手池洗脸，等脸干透再上酸。' : '不洗澡就在洗手池洗脸。');
}

// ══ 步骤打卡(完整模式):sk_tnsteps1 + 当天日志的 stepsDone / products(和 v1 同一种写法)══════════════
function entryOf(W, date) { return (W.journal || []).find(e => e && e.date === date) || null; }
function stepState(W) {
    const d = W.tnsteps || {};
    const done = new Set(d.date === W.today ? (d.done || []) : []);
    const en = entryOf(W, W.today);
    ((en && en.products) || []).forEach(tag => { const p = (W.products || []).find(x => x.journalTag && x.journalTag === tag); if (p) done.add(p.name); });
    const skipped = new Set((en && en.skipped) || []);
    skipped.forEach(n => done.delete(n));
    return { done, skipped };
}
function tickStep(app, name) {
    const store = app.store, t = app.today(), W = app.world();
    const s = stepState(W);
    if (s.done.has(name)) s.done.delete(name); else { s.done.add(name); s.skipped.delete(name); }
    store.ls(K.tnsteps, { date: t, done: [...s.done] });
    const { list, en } = jrnlEntry(store, t, true);
    if (s.done.size) en.stepsDone = [...s.done]; else delete en.stepsDone;
    if (s.skipped.size) en.skipped = [...s.skipped]; else delete en.skipped;
    const p = prodByName(W, name), tag = p && p.journalTag;
    if (tag) { en.products = en.products.filter(x => x !== tag); if (s.done.has(name)) en.products.push(tag); }
    saveJrnl(store, list);
}

// ══ 渲染 ══════════════════════════════════════════════════════════════════════════════
function model(app) {
    const W = app.world(), P = W.profile || {}, t = W.today, minimal = !!P.minimalMode;
    const hasShelf = (W.products || []).some(p => !p.hidden);
    let off;
    try { off = offlineTonight(W); } catch (e) { off = { slot: { items: [] }, shower: false, shave: false, steps: [], skips: [], warnings: [] }; }
    const g = safetyGate(W);
    const ai = aiStatus(app, W, off);
    const ov = tonightOverride(W);
    let changed = new Set(), plan = null, fellBack = false;
    if (ai.data && hasShelf) {
        const o = withOverride(W, ai.data, ov); changed = o.changed;
        plan = tonightPlan(W, o.data);
        if (plan.source === 'ai' && minimal) { const m = minimalGuard(W, plan, off); if (m) plan = m; else { plan = null; fellBack = true; } }
        else if (plan.source !== 'ai') { fellBack = true; plan = null; }
    }
    if (!plan) plan = tonightPlan(W, null);
    const isAi = plan.source === 'ai';
    const steps = plan.steps.map(s => {
        const name = s.product || s.how, p = s.product ? prodByName(W, s.product) : null;
        return { key: name, name, role: p ? (ROLE_LABEL[p.role] || '') : '', how: s.product ? s.how : '', kind: s.kind || 'base',
                 why: isAi ? (s.why || '') : offlineWhy(W, name, s.kind, off), chg: !!s.chg || changed.has(s.product),
                 low: !!(p && (W.low || []).indexOf(p.id) >= 0), product: !!s.product };
    });
    const skips = plan.skips.map(x => isAi ? x : Object.assign({}, x, splitWhy(x.product)));
    const kinds = steps.map(s => s.kind);
    const type = !hasShelf ? '还没排' : off.shave ? '刮胡夜' : kinds.indexOf('acid') >= 0 ? '刷酸夜' : kinds.indexOf('mask') >= 0 ? '面膜夜' : kinds.indexOf('retinol') >= 0 ? '维 A 夜' : '修护夜';
    const blockedAct = (plan.blocked || []).some(b => { const p = prodByName(W, b.product); return p && (ACTIVE.indexOf((p.schedule || {}).type) >= 0 || p.role === 'acid'); });
    const nxt = nextAcidNight(W);
    let lead;
    if (!hasShelf) lead = '家里有什么还没告诉 App，今晚先用温水洗脸。';
    else if (g.medical) lead = '就医提醒亮着：所有酸先停，今晚只做清洁、保湿、修护，眼霜照用。';
    else if (isAi && plan.why && !blockedAct) lead = plan.why;
    else if (g.firstNight) lead = '第一晚先不上活性，看皮肤对基础的几样有没有反应。';
    else if (off.shave) lead = '刮胡夜不上酸、维 A 和泥膜，今晚只做修护' + (nxt ? '；下次刷酸在' + nxt : '') + '。';
    else if (type === '刷酸夜') lead = off.shower ? '今晚洗澡，皮肤软，正好刷酸。' : '今晚刷酸：洗完等脸完全干了再涂。';
    else if (g.acidCapMax === 0 || g.irritated) lead = (g.notes[0] || '最近皮肤有点闹，今晚先修护') + '。';
    else lead = '今晚修护，让皮肤歇一晚' + (nxt ? '；下次刷酸在' + nxt : '') + '。';
    // 提醒:就医 > 注意(安全提示、闸、被拦下的)> 其余
    const cards = [];
    if (g.medical) cards.push({ tone: 'medical' });
    (off.warnings || []).forEach(w => cards.push({ tone: 'caution', text: w.text, safety: true }));
    if (hasShelf && !(W.products || []).some(p => !p.hidden && p.role === 'spf')) cards.push({ tone: 'caution', text: (type === '刷酸夜' ? '今晚刷酸，' : '') + '明早没有防晒可用，去「产品」加一支。', safety: true });
    if (!g.medical) g.notes.forEach(n => cards.push({ tone: 'caution', text: n + '。' }));
    (plan.blocked || []).forEach(b => cards.push({ tone: 'caution', text: '顾问排了「' + b.product + '」，没上：' + b.why + '。' }));
    const reg = (W.regimen || []).slice(-1)[0];
    if (reg && reg.date === t && (W.regimen || []).length > 1 && reg.reason) cards.push({ tone: 'info', head: '方案变了', text: '方案 v' + reg.v + '：' + reg.reason + (/[。！？]$/.test(reg.reason) ? '' : '。') });
    steps.filter(s => s.low).forEach(s => cards.push({ tone: 'info', text: '「' + s.name + '」快用完了，去「产品」看看要不要买。' }));
    (plan.dropped || []).forEach(n => cards.push({ tone: 'info', text: '顾问提到的「' + n + '」不在货架上，没排。' }));
    if (type === '刷酸夜' && cards.every(c => !/防晒/.test(c.text || ''))) cards.push({ tone: 'info', text: '明早防晒别忘：刷酸后第二天对光更敏感。' });
    return { W, P, t, minimal, hasShelf, off, g, ai, ov, plan, isAi, fellBack, steps, skips, type, lead, cards };
}

function srcLine(m) {
    const a = m.ai;
    if (!m.hasShelf) return '';
    if (m.isAi) return '';
    let txt = '', btn = '';
    if (a.busy) txt = '顾问在排今晚，排好了会换上；先看离线排法。';
    else if (m.fellBack) txt = '顾问排的步骤都没过安全闸，用的是离线排法。';
    else if (a.state === 'out') txt = '没登录，用的是离线排法。';
    else if (a.state === 'none' || a.state === 'mismatch') txt = '顾问没开通，用的是离线排法。';
    else if (a.state === 'quota') txt = a.err + '今晚用的是离线排法。';
    else if (a.state === 'down') { txt = '顾问连不上，用的是离线排法。'; btn = '再试一次'; }
    else if (a.state === 'err') { txt = '顾问这次没排成（' + a.err + '），用的是离线排法。'; btn = '让顾问重排'; }
    else if (a.state === 'stale') { txt = '情况变了，先用离线排法。'; btn = '让顾问重排'; }
    else if (a.state === 'pending') { txt = '用的是离线排法。'; btn = '让顾问排今晚'; }
    return `<p class="note tn-src" id="tn-src">${esc(txt)}${btn ? ` <button type="button" class="btn-link sm" data-act="ask">${btn}</button>` : ''}</p>`;
}
function medicalCard(m) {
    const red = m.g.red || {}, fu = red.followUp;
    const by = red.by === 'both' ? '泛红和冒痘' : red.by === 'acne' ? '冒痘' : '泛红';
    const days = red.by === 'acne' ? red.acneDays : red.by === 'both' ? red.days : red.redDays;
    const text = fu === 'booked' ? '已约了。看过之后点「看过了」，酸才会恢复；在这之前全停，眼霜照用。'
        : fu === 'later' ? '先不也行，之后还会提醒。点「看过了」之前，所有酸照样停，眼霜照用。'
            : m.g.medicalText + '看过之前所有酸都停，包括温和酸；眼霜照用。';
    const btns = [['booked', '已约了'], ['seen', '看过了'], ['later', '先不']];
    return `<div class="note-medical" id="tn-med" role="note"><div class="med-h"><span class="med-eb">就医 · ${esc(by)}</span><span class="meta">近 14 天里 ${days} 天 · 最近 3 天还在</span></div>
        <p>${esc(text)}</p><div class="med-acts">${btns.map(([k, l]) => `<button type="button" class="btn" data-med="${k}" aria-pressed="${fu === k}">${l}</button>`).join('')}</div></div>`;
}
function cardHtml(c) {
    if (c.tone === 'medical') return '';
    if (c.tone === 'caution') return `<div class="note-caution" role="note"${c.safety ? ' data-safety="1"' : ''}><div class="nc-eb">注意</div><p>${esc(c.text)}</p></div>`;
    return `<div class="note-info" role="note"><div class="ni-eb">${esc(c.head || '提醒')}</div><p>${esc(c.text)}</p></div>`;
}
function revHtml(m) {
    const ov = m.ov;
    if (ov) {
        const txt = ov.ops.map(c => (TONIGHT_TXT[c.op] ? TONIGHT_TXT[c.op](c) : c.op) + (c.why ? '：' + c.why : '')).join('；');
        return `<div class="revbar" id="tn-rev"><div class="rev-main"><span class="who">顾问${ov.at ? ' · ' + esc(hm(ov.at)) : ''} · 改了今晚</span><span class="what">${esc(txt)}</span></div>
            <button type="button" class="btn-link" data-act="undo">撤销</button></div>`;
    }
    if (st.redo && st.redo.date === m.t) {
        return `<div class="revbar" id="tn-rev"><div class="rev-main"><span class="who">顾问 · 改了今晚</span><span class="what">已撤销，今晚恢复成上一版。</span></div>
            <button type="button" class="btn-link" data-act="redo">重做</button></div>`;
    }
    return '';
}

export function render(app) {
    const m = model(app);
    const { W, P, t, minimal, hasShelf, off, g, steps, skips, cards } = m;
    let h = `<h1 class="page-title" id="tonight-h"><span class="pre">今晚 · </span>${esc(m.type)}</h1><p class="tn-lead" id="tn-lead">${esc(m.lead)}</p>`;
    h += revHtml(m);
    // ② 今晚的情况(完整模式;极简模式不问,按每周习惯)
    if (hasShelf && !minimal) {
        const acidTonight = m.type === '刷酸夜';
        const q = (k, label, yes, no, on) => {
            const fx = st.fx && st.fx.date === t && st.fx.k === k ? st.fx.text : defaultFx(k, on, acidTonight, g);
            return `<div class="sit-q" id="tn-q-${k}"><div class="sit-row"><span class="sit-l" id="tn-ql-${k}">${label}</span><div class="sit-btns" role="group" aria-labelledby="tn-ql-${k}">
                <button type="button" data-sit="${k}" data-v="1" aria-pressed="${on}" id="tn-${k}-y">${yes}</button><button type="button" data-sit="${k}" data-v="0" aria-pressed="${!on}" id="tn-${k}-n">${no}</button></div></div>
                <p class="note sit-fx${st.fx && st.fx.date === t && st.fx.k === k ? ' changed' : ''}" id="tn-fx-${k}" aria-live="polite">${esc(fx)}</p></div>`;
        };
        h += `<section class="tn-sit" id="tn-sit" aria-label="今晚的情况"><div class="sec-h"><span class="sec-t">今晚的情况</span><span class="note faint">按每周习惯先填好了</span></div>`
            + q('shower', '今晚洗澡吗？', '洗', '不洗', !!off.shower) + (P.shaving ? q('shave', '今晚刮胡吗？', '刮', '不刮', !!off.shave) : '') + '</section>';
    }
    // ③ 最多一张提醒卡 + 「还有 N 条」
    if (cards.length) {
        const first = cards[0], rest = cards.slice(1);
        h += `<div class="tn-cards" id="tn-cards">${first.tone === 'medical' ? medicalCard(m) : cardHtml(first)}`;
        if (rest.length) {
            const nCaution = rest.filter(c => c.tone === 'caution').length;
            h += `<button type="button" class="btn-link sm quiet tn-more-b" data-act="more" aria-expanded="${st.more}" aria-controls="tn-more" id="tn-more-b">${st.more ? '收起' : '还有 ' + rest.length + ' 条' + (nCaution ? '（' + nCaution + ' 条注意）' : '')}${ico('chev', 'sm')}</button>
                <ul class="list tn-more" id="tn-more"${st.more ? '' : ' hidden'}>${rest.map(c => `<li class="${c.tone === 'caution' ? 'is-caution' : ''}"${c.safety ? ' data-safety="1"' : ''}>${c.tone === 'caution' ? '<span class="nc-eb">注意 · </span>' : ''}${esc(c.text)}</li>`).join('')}</ul>`;
        }
        h += '</div>';
    }
    // ④ 步骤
    if (!hasShelf) {
        h += `<div class="empty" id="tn-empty"><p class="lede">货架还是空的。</p><p class="note">先放一支洁面和一支保湿，今晚就能排。</p><div class="btn-row"><button type="button" class="btn" data-act="products">去「产品」添加</button></div></div>`;
        return h;
    }
    const s = stepState(W);
    const doneN = minimal ? 0 : steps.filter(x => s.done.has(x.key)).length;
    const head = m.isAi ? '今晚的步骤 · 顾问' + (m.ai.at ? ' ' + hm(m.ai.at) : '') + ' 排的' : '今晚的步骤 · 离线排法';
    const missed = n => s.skipped.has(n);
    const nMiss = minimal ? steps.filter(x => missed(x.key)).length : 0;
    h += `<section class="tn-steps" aria-labelledby="tn-steps-h"><div class="sec-h"><span class="sec-t" id="tn-steps-h">${esc(head)}</span><span class="meta" id="tn-progress">${minimal ? (nMiss ? (steps.length - nMiss) + ' 步做了 · ' + nMiss + ' 步没做' : '默认全做') : doneN + ' / ' + steps.length}</span></div>`;
    h += srcLine(m);
    if (minimal) h += `<p class="note tn-mini-hint">不用打勾，排上的默认都算做了。${steps.some(x => ACTIVE.indexOf(x.kind) >= 0) ? '刷酸这类哪一步没做，点一下「今晚没做」。' : ''}</p>`;
    h += `<ol class="steps" id="tn-plan" aria-label="今晚的步骤">${steps.map((x, i) => {
        const idx = String(i + 1).padStart(2, '0');
        const how = x.how ? `<span class="step-how">${esc(x.how)}${x.low ? '<span class="faint"> · 快用完</span>' : ''}</span>` : '';
        const why = x.why ? `<span class="step-why">${esc(x.why)}</span>` : '';
        if (minimal) {
            const act = ACTIVE.indexOf(x.kind) >= 0, ms = missed(x.key);
            return `<li class="step-li"><div class="step mini${ms ? ' missed' : ''}${x.chg ? ' changed' : ''}" data-kind="${x.kind}"><span class="step-idx">${idx}<span class="step-role">${esc(x.role)}</span></span>
                <span class="step-body"><span class="step-name">${esc(x.name)}</span>${how}${why}</span>
                ${act ? `<button type="button" class="btn-link sm step-miss" data-miss="${esc(x.key)}" aria-pressed="${ms}">${ms ? '撤回' : '今晚没做'}</button>` : '<span></span>'}</div></li>`;
        }
        const dn = s.done.has(x.key);
        return `<li class="step-li"><button type="button" class="step${dn ? ' done' : ''}${x.chg ? ' changed' : ''}" role="checkbox" aria-checked="${dn}" data-step="${esc(x.key)}" data-kind="${x.kind}" id="tn-step-${i}">
            <span class="step-idx">${dn ? ico('check', 'sm') : idx}<span class="step-role">${esc(x.role)}</span></span>
            <span class="step-body"><span class="step-name">${esc(x.name)}</span>${how}${why}</span><span class="step-box" aria-hidden="true">${ico('check', 'sm')}</span></button></li>`;
    }).join('')}</ol>`;
    if (skips.length) {
        h += `<details class="skips" id="tn-skips"><summary><span>今晚不用的 ${skips.length} 样</span></summary><ul class="rows">${skips.map(x =>
            `<li class="row"><span class="row-main"><span class="lede skip-name">${esc(x.product)}</span>${x.why ? `<span class="note">${esc(x.why)}</span>` : ''}</span><span class="note">今晚不用</span></li>`).join('')}</ul></details>`;
    }
    h += '</section>';
    // 完成今晚 / 记一下皮肤
    const en = entryOf(W, t);
    if (minimal) {
        h += `<div class="tn-finish" id="tn-finish"><button type="button" class="btn btn-block" data-act="skin" id="tn-logskin">${hasLog(en) ? '今天的皮肤 · 再看看' : '记一下皮肤'}</button>
            <div class="fb-box" data-fb-date="${esc(t)}">${feedbackHtml(app, t)}</div></div>`;
    } else if (en && en.done) {
        h += `<div class="tn-finish done" id="tn-finish"><span class="meta tn-done-at">做完了${en.doneAt ? ' · ' + esc(hm(en.doneAt)) : ''}</span>
            <div class="btn-row"><button type="button" class="btn" data-act="done-sheet">皮肤和反馈</button><button type="button" class="btn-link sm quiet" data-act="unfinish">撤回</button></div>
            <div class="fb-box" data-fb-date="${esc(t)}">${feedbackHtml(app, t)}</div></div>`;
    } else {
        h += `<div class="tn-finish" id="tn-finish"><button type="button" class="btn btn-primary btn-block" data-act="finish" id="tn-finish-b">完成今晚</button>
            <p class="note faint tn-finish-n">没点的步骤记成「没做」，顾问会看到。</p><button type="button" class="btn-link sm quiet" data-act="skin">只记皮肤</button></div>`;
    }
    return h;
}

// ══ 事件 ══════════════════════════════════════════════════════════════════════════════
const _bound = new WeakSet();
export function mount(root, app) {
    maybeAuto(app);
    if (_bound.has(root)) return;
    _bound.add(root);
    root.addEventListener('click', e => {
        const tg = e.target && e.target.closest && e.target.closest('[data-act],[data-step],[data-miss],[data-sit],[data-med]');
        if (!tg || !root.contains(tg)) return;
        const store = app.store, t = app.today();
        if (tg.dataset.step !== undefined) { if (!(app.world().profile || {}).minimalMode) { tickStep(app, tg.dataset.step); app.renderAll(); } return; }
        if (tg.dataset.miss !== undefined) { toggleSkipped(store, t, tg.dataset.miss); app.renderAll(); return; }
        if (tg.dataset.sit) {
            const k = tg.dataset.sit, v = tg.dataset.v === '1';
            const W0 = app.world(), off0 = offlineTonight(W0);
            if ((k === 'shower' ? !!off0.shower : !!off0.shave) === v) return;
            const before = snapOf(W0);
            toggleTn(store, k, v, t);
            const W1 = app.world();
            st.fx = { date: t, k, text: effectText(W1, k, v, before, snapOf(W1)) };
            app.renderAll();
            localChange(app, k === 'shave' ? '今晚刮胡改了' : '今晚洗澡改了');
            return;
        }
        if (tg.dataset.med) {
            const k = tg.dataset.med;
            setMedical(store, k, {}, t);
            if (k === 'seen') toast('记下了：从今天起重新计数，酸按方案慢慢恢复');
            app.renderAll();
            return;
        }
        const a = tg.dataset.act;
        if (a === 'more') { st.more = !st.more; app.renderScreen('tonight'); }
        else if (a === 'ask') fetchTonight(app, 'manual');
        else if (a === 'undo') {
            const rec = app.world().tnai;
            if (!rec) return;
            const err = undoTonightChange(store, rec.id, t);
            if (err) { toast(err); return; }
            st.redo = { date: t, rec: JSON.parse(JSON.stringify(rec)) };
            app.renderAll();
        } else if (a === 'redo') {
            const r = st.redo && st.redo.rec; st.redo = null;
            if (r && r.date === t) {
                const res = applyTonight(store, { id: r.id, changes: (r.ops || []).map(o => ({ op: o.op, product: o.product, to: o.to, level: o.level, why: o.why })) }, t);
                if (res && res.state === 'failed') toast('这次重做没生效：' + (res.result || []).filter(Boolean).join('；'));
            }
            app.renderAll();
        } else if (a === 'finish') finishTonight(app);
        else if (a === 'unfinish') {
            const { list, en } = jrnlEntry(store, t, true);
            const back = new Set(en.doneSkipped || []);
            if (en.skipped) { en.skipped = en.skipped.filter(n => !back.has(n)); if (!en.skipped.length) delete en.skipped; }
            delete en.done; delete en.doneAt; delete en.doneSkipped;
            saveJrnl(store, list); app.renderAll();
        } else if (a === 'done-sheet') openSkinSheet(app, { date: t, mode: 'done', summary: doneSummary(app) });
        else if (a === 'skin') openSkinSheet(app, { date: t, mode: 'skin' });
        else if (a === 'products') app.show('products');
    });
}
function doneSummary(app) {
    const m = model(app), s = stepState(m.W);
    const dn = m.steps.filter(x => s.done.has(x.key)).length, miss = m.steps.filter(x => !s.done.has(x.key)).map(x => x.name);
    return (dn ? '做了 ' + dn + ' 步' : '') + (miss.length ? (dn ? '，' : '') + '没做：' + miss.join('、') : '') + (dn || miss.length ? '。' : '') + '顺手记一下今天皮肤，顾问会参考。';
}
// 完成今晚:当天日志 done + doneAt;没点的步骤记进 skipped(撤回时只退这次加的)→ 记皮肤的 sheet,关掉后要顾问反馈
function finishTonight(app) {
    const store = app.store, t = app.today(), m = model(app), s = stepState(m.W);
    const summary = doneSummary(app);
    const { list, en } = jrnlEntry(store, t, true);
    const skipped = new Set(en.skipped || []);
    const added = m.steps.filter(x => x.product && !s.done.has(x.key) && !skipped.has(x.key)).map(x => x.key);
    added.forEach(n => skipped.add(n));
    if (skipped.size) en.skipped = [...skipped];
    if (added.length) en.doneSkipped = added; else delete en.doneSkipped;
    en.done = true; en.doneAt = new Date(store.now()).toISOString();
    saveJrnl(store, list);
    app.renderAll();
    openSkinSheet(app, { date: t, mode: 'done', summary });
}
