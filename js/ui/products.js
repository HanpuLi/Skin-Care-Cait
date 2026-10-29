// ══ 产品 ══════════════════════════════════════════════════════════════════════════════
// 一屏三块(样稿 Main.dc.html「产品」):顶上「拍成分表 / 手动添加」→ 读完的成分表(确认才入库,入库后能撤销)
//   →「要不要买新的」(顾问在后台判断;离线退回 engine/needs)→ 货架(按角色排,一行一件:状态点、开封几周、保质期)
//   → 不要了的 / 空瓶记录(折叠)。
// 【要紧】「用完了 / 买回来了 / 快用完了」只走 ai/apply.js 的 localMarkRunOut / localUnGone / localToggleLow
//    (它们会让方案重出一版,并触发「要不要买」重判);添加 / 编辑 / 不要了 / 恢复 / 写成分特性走下面那组 local*(同样的两件事)。
// 【要紧 · 要不要买】只在本机操作后防抖触发(onShopLocalChange 的监听方就在这里);同步来的 / 方案自动重出 / 第一次打开都不调,
//    签名对不上只标「货架变了,结果可能过时」;没结果给「让顾问判断」;顾问用不了 → engine/needs 的离线清单。
//    结果按账号存本机 sk_ai_shop1(LOCAL_KEYS.aiShop),不进 CLOUD_KEYS。
import { K, LOCAL_KEYS } from '../store.js';
import { esc, ico, openSheet, closeSheet, toast, sysAlert } from './sheets.js';
import { shelfSeeded, DEFAULT_PD, ROLE_LABEL, ROLE_ORDER, TRAIT_DEFS, TRAIT_MAP, cleanTraits, traitsOf, hasTrait, statusOf, isSchedActive,
         normalStatusOf, normalizeStatuses, weeksOpen, prodUsageCount, emptyLogRows, visNotes, capsOf, ESSENTIAL_CAPS, ROLE_MAP, inferRole } from '../model/products.js';
import { updateProfile } from '../model/profile.js';
import { syncRegimen } from '../model/regimen.js';
import { localMarkRunOut, localUnGone, localUndoRunOut, localToggleLow, onShopLocalChange, shopLocalChange, shopSig } from '../ai/apply.js';
import { buildSkincareContext } from '../ai/context.js';
import { shopItems, gapsIfGone, pickReplacement } from '../engine/needs.js';
import { restedNow, includedNow, introNightsLeft, regimenRules } from '../engine/rules.js';
import { safetyGate, gateBlocks } from '../engine/gate.js';
import { isExcluded } from '../engine/util.js';
import { mdOf } from '../clock.js';
import { askAdvisor, probeOnce, dataNoticeSeen } from './advisor.js';

export const id = 'products';
export const title = '产品';

// ══ 货架写入 ══════════════════════════════════════════════════════════════════════════
// 【整合时搬家】这一组是「本机操作入口」:改 sk_proddefs1 / sk_prods1 / sk_popen1 / 档案 → 方案 force 重出一版 → shopLocalChange。
//   纯写盘的那半该进 model/products.js,包装那半该进 ai/apply.js(和 localMarkRunOut 一排)。P2 不许动共享文件,先放这里;
//   数据形状和 v1 逐字一样(新产品 id = custom_<时间>、statuses active/paused、不要了 = hidden + dropped{at, why})。
export const ADD_ROLES = [['cleanse', '洁面'], ['precleanse', '卸妆'], ['acid', '刷酸'], ['retinol', '维 A'], ['serum', '精华'], ['moist', '保湿'],
    ['repair', '修护'], ['spf', '防晒'], ['eye', '眼部'], ['mask', '面膜'], ['oil', '面油'], ['soothe', '舒缓面膜']];
export const ROLE_SHORT = { precleanse: '卸妆', cleanse: '洁面', acid: '刷酸', mask: '面膜', soothe: '舒缓', retinol: '维 A', serum: '精华', oil: '面油', eye: '眼部', moist: '保湿', repair: '修护', spf: '防晒' };
// 顾问读成分标回来的角色是中文
export const ROLE_FROM_CN = { '洁面': 'cleanse', '卸妆': 'precleanse', '去角质': 'acid', '刷酸': 'acid', '精华': 'serum', '眼部': 'eye', '修护': 'repair', '防晒': 'spf', '面膜': 'mask', '保湿': 'moist', '舒缓': 'soothe', '面油': 'oil', '维A': 'retinol', '维 A': 'retinol' };
export function defaultScheduleFor(role) {
    const base = { time: ['pm'], maxPerWeek: 1, minDaysBetween: 0, preferShowerNight: false, avoidShaveDay: false, avoidAcid: false, avoidRetinol: false, enableAutoSchedule: false };
    if (role === 'acid') return Object.assign(base, { type: 'acid', minDaysBetween: 2, avoidShaveDay: true, avoidAcid: true, avoidRetinol: true, enableAutoSchedule: true });
    if (role === 'mask') return Object.assign(base, { type: 'mask', minDaysBetween: 6, avoidShaveDay: true, avoidAcid: true, enableAutoSchedule: true });
    if (role === 'retinol') return Object.assign(base, { type: 'retinol', minDaysBetween: 3, avoidShaveDay: true, avoidAcid: true, enableAutoSchedule: true });
    if (role === 'spf') return Object.assign(base, { type: 'daily', time: ['am'], maxPerWeek: 0 });
    return Object.assign(base, { type: 'base', maxPerWeek: 0, time: ['eye', 'moist', 'serum', 'cleanse'].indexOf(role) >= 0 ? ['am', 'pm'] : ['pm'] });
}
// 存档里的货架原样(没存过的老账号 = 内置种子;新账号 = 空)。注意别拿 loadPD() 的结果写回:它滤掉了用完的,买回来时就找不到定义了
// 【和 v1 loadPD 同一条规则】种子货架(老账号)缺的内置产品从 DEFAULT_PD 补回来(不按「用完了」过滤,留着定义给「买回来」):
//   v1 每次改货架写的是滤掉了用完的那份,v1 时代用完过的内置产品不在 sk_proddefs1 里;不补的话买回来后在 v2 改不了、拿不掉。
//   第一次写入时就把补回来的持久化了。
function rawDefs(store) {
    const saved = store.lg(K.prodDefs);
    const seeded = shelfSeeded(store);
    if (saved) {
        if (!seeded) return saved;
        const miss = DEFAULT_PD.filter(d => d.builtin && !saved.some(x => x && x.id === d.id));
        return miss.length ? saved.concat(normalizeStatuses(JSON.parse(JSON.stringify(miss)))) : saved;
    }
    return seeded ? normalizeStatuses(JSON.parse(JSON.stringify(DEFAULT_PD))) : [];
}
const PLAN_KEYS = ['role', 'traits', 'schedule'];
function after(store, why, shop, today) { syncRegimen(store, why, true, today); shopLocalChange(shop); }
export function localAddProduct(store, o, today) {
    const name = String((o && o.name) || '').trim().slice(0, 80), role = (o && o.role) || '';
    if (!name || !role) return null;
    const list = rawDefs(store);
    const schedule = defaultScheduleFor(role);
    const np = { id: 'custom_' + store.now(), name, cat: ROLE_LABEL[role] || '', notes: (o.notes || []).map(String).filter(Boolean).slice(0, 8),
        journalTag: ['acid', 'mask', 'retinol'].indexOf(schedule.type) >= 0 ? name.slice(0, 16) : '',
        statuses: ['active', 'paused'], labels: { active: '正常使用', paused: '备用' }, pillCls: { active: 'active', paused: 'paused' },
        schedule, paoMonths: Math.max(0, Math.min(60, +o.paoMonths || 0)), builtin: false, addedOn: today, role };
    while (list.some(p => p.id === np.id)) np.id += 'x';
    const tr = cleanTraits(o.traits); if (tr.length) np.traits = tr;
    store.ls(K.prodDefs, list.concat([np]));
    const PS = store.lg(K.prods) || {}; PS[np.id] = 'active'; store.ls(K.prods, PS);
    if (o.opened !== '') { const po = store.lg(K.popen) || {}; po[np.id] = o.opened || today; store.ls(K.popen, po); }
    after(store, '多了：' + name, '添加了「' + name + '」', today);
    return np;
}
// patch:{name, role, traits(null = 删掉自己标的,回到默认), notes[], paoMonths, opened('' = 清掉开封日)}
export function localEditProduct(store, id, patch, today) {
    const list = rawDefs(store), p = list.find(x => x.id === id);
    if (!p) return null;
    // 存档里没写 role 的内置产品(DEFAULT_PD 那 6 支、没存过 sk_proddefs1 的种子账号):编辑 sheet 拿到的是推出来的角色,
    //   和推出来的一样就不算「改了类别」—— 只把角色落盘,排法(洗澡夜偏好这些)、分类名都不动,也不出新的一版方案
    const eff = p.role || ROLE_MAP[p.id] || inferRole(p);
    const planOf = () => JSON.stringify(PLAN_KEYS.map(k => k === 'role' ? (p.role || eff || null) : (p[k] === undefined ? null : p[k])));
    const before = planOf();
    if (patch.name !== undefined && String(patch.name).trim()) p.name = String(patch.name).trim().slice(0, 80);
    if (patch.role && !p.role && patch.role === eff) p.role = eff;
    else if (patch.role && patch.role !== eff) {
        p.role = patch.role; p.cat = ROLE_LABEL[patch.role] || p.cat;
        p.schedule = Object.assign(defaultScheduleFor(patch.role), { time: (p.schedule && p.schedule.time) || defaultScheduleFor(patch.role).time });
    }
    if (patch.traits !== undefined) {
        const tr = cleanTraits(patch.traits || []), dflt = TRAIT_MAP[p.id] || [];
        if (patch.traits === null || (!tr.length && !Array.isArray(p.traits))) delete p.traits;
        else if (tr.join() !== dflt.join() || Array.isArray(p.traits)) p.traits = tr;
    }
    if (Array.isArray(patch.notes)) {
        const hidden = (p.notes || []).filter(n => /刮胡/.test(n) && patch.notes.indexOf(n) < 0);   // 不刮胡的人看不到的那几条原样留着
        p.notes = patch.notes.map(String).filter(Boolean).slice(0, 8).concat(hidden);
    }
    if (patch.paoMonths !== undefined) p.paoMonths = Math.max(0, Math.min(60, +patch.paoMonths || 0));
    const t = p.schedule && p.schedule.type;
    if (!p.journalTag && ['acid', 'mask', 'retinol'].indexOf(t) >= 0) p.journalTag = p.name.slice(0, 16);
    store.ls(K.prodDefs, list);
    if (patch.opened !== undefined) {
        const po = store.lg(K.popen) || {};
        if (patch.opened) po[id] = patch.opened; else delete po[id];
        store.ls(K.popen, po);
    }
    if (planOf() !== before) after(store, '改了：' + p.name, '改了「' + p.name + '」', today);
    return p;
}
export function localSetTraits(store, id, traits, today) { return localEditProduct(store, id, { traits }, today); }
// 撤销用:把某件产品的定义整份换回快照
export function localReplaceDef(store, def, today) {
    const list = rawDefs(store), i = list.findIndex(x => x.id === def.id);
    if (i < 0) return false;
    list[i] = JSON.parse(JSON.stringify(def));
    store.ls(K.prodDefs, list);
    after(store, '撤销了对「' + def.name + '」的改动', '撤销了对「' + def.name + '」的改动', today);
    return true;
}
// 撤销「刚加的这一支」:定义、状态、开封日一起拿掉(只给刚入库、还没用过的那支用)
export function localRemoveNewProduct(store, id, today) {
    const list = rawDefs(store), p = list.find(x => x.id === id);
    if (!p) return false;
    store.ls(K.prodDefs, list.filter(x => x.id !== id));
    const PS = store.lg(K.prods) || {}; if (id in PS) { delete PS[id]; store.ls(K.prods, PS); }
    const po = store.lg(K.popen) || {}; if (id in po) { delete po[id]; store.ls(K.popen, po); }
    after(store, '撤销了添加：' + p.name, '撤销了添加「' + p.name + '」', today);
    return true;
}
// 不要了:从流程和货架上拿掉,收进「不要了的」随时能恢复;原因(选填)给顾问看。合并了旧的 备用 / 我不用这个 / 隐藏 / 删除(AUDIT-ux P1-8)
export function localDropProduct(store, id, why, today) {
    const list = rawDefs(store), p = list.find(x => x.id === id);
    if (!p) return null;
    p.hidden = true; p.dropped = { at: today, why: String(why || '').slice(0, 40) };
    store.ls(K.prodDefs, list);
    updateProfile(store, pr => { if ((pr.excluded || []).indexOf(id) >= 0) pr.excluded = pr.excluded.filter(x => x !== id); });
    after(store, '不要了：' + p.name, '「' + p.name + '」不要了' + (why ? '（' + why + '）' : ''), today);
    return p;
}
export function localRestoreProduct(store, id, today) {
    const list = rawDefs(store), p = list.find(x => x.id === id);
    if (!p) return null;
    delete p.hidden; delete p.dropped;
    store.ls(K.prodDefs, list);
    updateProfile(store, pr => { if ((pr.excluded || []).indexOf(id) >= 0) pr.excluded = pr.excluded.filter(x => x !== id); });
    const PS = store.lg(K.prods) || {};
    if (!isSchedActive(p, PS[id] || (p.statuses || [])[0])) { PS[id] = normalStatusOf(p); store.ls(K.prods, PS); }
    after(store, '恢复：' + p.name, '「' + p.name + '」又拿回来用了', today);
    return p;
}

// ══ 照片:压到长边 max、JPEG,别上传原图 ═══════════════════════════════════════════════════
export function imageToDataURL(file, max) {
    max = max || 1280;
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            const k = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            res(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('读不了这张图')); };
        img.src = url;
    });
}

// ══ 小工具 ══════════════════════════════════════════════════════════════════════════════
const hm = t => { const d = new Date(t); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const md = t => { const d = new Date(t); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); };
const traitLabel = k => (TRAIT_DEFS.find(t => t.k === k) || {}).l || k;
function curUser(app) { return (app && app.sync && app.sync.state && app.sync.state.user) || null; }
function whoOf(app) { const u = curUser(app); let shown = null; try { shown = app.shownTonight ? app.shownTonight() : null; } catch (e) { } return { name: u && u.displayName ? String(u.displayName).split(' ')[0] : '', shown }; }
function nowMsOf(W) { return new Date(W.today + 'T12:00:00').getTime(); }
export function paoState(W, p) {
    if (!p || p.hidden || !(p.paoMonths > 0)) return null;
    const wo = weeksOpen(W.popen, p.id, nowMsOf(W)); if (wo === null) return null;
    const lim = Math.round(p.paoMonths * 4.345);
    const lead = Math.max(1, Math.min(4, Math.round(lim * 0.15), lim - 1));
    if (wo >= lim) return { over: true, short: '过了保质期', msg: '开封 ' + wo + ' 周，保质期 ' + p.paoMonths + ' 个月，建议换掉' };
    if (wo >= lim - lead) return { over: false, short: '快到保质期', msg: '开封 ' + wo + ' 周，' + lim + ' 周到期' };
    return null;
}
// 货架上的一件 = 还在家、没标不要了、状态启用;其余的(不要了 / 备用)收进「不要了的」(和 v1 一样)
function isDropped(W, p) { return !!p && (p.hidden || isExcluded(W, p) || !isSchedActive(p, statusOf(p, W.ps))); }
function liveShelf(W) {
    return (W.products || []).filter(p => !isDropped(W, p)).sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(a.role), rb = ROLE_ORDER.indexOf(b.role);
        return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
}
// 这件一没、哪一档就断(只看「把脸洗干净 / 洗完有东西护着 / 防晒」这种基本档,和 v1 的 planCriticalProducts 同一口径;判断走 engine/needs)
function criticalGaps(W, p) {
    if (!capsOf(p).some(c => ESSENTIAL_CAPS.indexOf(c) >= 0 || c === 'spf')) return [];
    return gapsIfGone(W, p.id).filter(g => g.key === 'clean' || g.key === 'hydrate' || g.key === 'spf');
}
const ACTIVE_TYPES = ['acid', 'mask', 'retinol'];
function isActive(p) { return ACTIVE_TYPES.indexOf((p.schedule && p.schedule.type) || '') >= 0 || ACTIVE_TYPES.indexOf(p.role) >= 0; }
function rowState(W, p) {
    const pao = paoState(W, p), low = (W.low || []).indexOf(p.id) >= 0;
    if (!p.role) return ['hollow', '还没选它是什么，点开选一下'];
    if (pao && pao.over) return ['caution', '过了保质期'];
    if (low) return ['caution', '快用完'];
    if (pao) return ['hollow', '快到保质期'];
    const intro = introNightsLeft(W, p);
    if (intro) return ['hollow', '新加的 · 试用期还剩 ' + intro + ' 晚'];
    if (restedNow(W, p)) return ['hollow', '这一版先不排'];
    // 和 engine/schedule.js computePlan 的口径一致:猛酸从不自动排;关了自动排班的活性也不排 —— 除非顾问方案点名
    const rr = regimenRules(W), named = rr.source === 'ai' && (includedNow(W, p) || String(rr.acidName || '').split(' / ').map(x => x.trim()).indexOf(p.name) >= 0);
    if (p.role === 'acid' && hasTrait(p, 'strong-exfo') && !named) return ['hollow', '先不排 · 猛酸，皮肤连续稳 4 周后再评估'];
    const sc = p.schedule || {};
    if (isActive(p) && !named && !(sc.enableAutoSchedule && (sc.maxPerWeek ?? 1) > 0)) return ['hollow', '不自动排 · 想用跟顾问说'];
    // 活性的东西被安全闸拦着(就医提醒 / 近 3 天刺激 / 第一晚 / HRT 波动):照实说为什么现在不上
    if (isActive(p) || hasTrait(p, 'scrub')) { const gb = gateBlocks(p, safetyGate(W), W); if (gb) return ['hollow', '现在不上 · ' + gb]; }
    if (criticalGaps(W, p).length) return ['ok', '在用 · 没有能顶替的'];
    return ['ok', p.role === 'spf' ? '在用 · 早上' : '在用'];
}
function rowMeta(W, p) {
    const wo = weeksOpen(W.popen, p.id, nowMsOf(W)), uses = ['acid', 'mask', 'retinol'].indexOf((p.schedule || {}).type) >= 0 ? prodUsageCount(W.journal, p) : 0;
    return [wo === null ? '未开封' : '开封 ' + wo + ' 周', uses ? '用过 ' + uses + ' 次' : ''].filter(Boolean).join(' · ');
}

// ══ 要不要买新的:后台 runner ═══════════════════════════════════════════════════════════
export const SHOP = { delay: 5000 };   // 防抖(毫秒);无头测试 import 本模块把它调小
const URG = [['now', '现在就缺'], ['before_out', '快用完前备上'], ['optional', '可买可不买']];
const R = { app: null, bound: false, timer: null, whyQ: [], again: false, running: null, err: null, hold: false };
// 新用户引导期间(一支一支往空货架上加)不自动判断:那等于「第一次打开」,做完引导她自己点「让顾问判断」(oobe.js 调)
export function holdShop(on) { R.hold = !!on; if (on) { clearTimeout(R.timer); R.timer = null; R.whyQ = []; } }
// 挂监听(幂等)。整合时在 app.js 启动里调一次;没调之前,进顾问 / 产品页也会挂上
export function ensureShopRunner(app) {
    if (app) R.app = app;
    if (!R.bound) { R.bound = true; onShopLocalChange(why => shopLocal(why)); }
}
function shopUid() { const u = curUser(R.app); return u ? u.uid : null; }
export function shopRec(app) {
    let r = null;
    try { r = JSON.parse(app.store.getLocal(LOCAL_KEYS.aiShop)); } catch (e) { }
    const u = curUser(app);
    return (r && u && r.uid === u.uid && r.data && typeof r.data === 'object') ? r : null;
}
export function shopLocal(why) {
    const app = R.app;
    if (R.hold || !app || !app.ai || !app.ai.ready()) return;
    if (!dataNoticeSeen(app)) return;   // 还没看过「顾问会看到什么」:不在后台自动外发(她到产品页点「让顾问判断」照样能用)
    if (why && R.whyQ.indexOf(why) < 0) R.whyQ.push(String(why).slice(0, 80));
    if (R.running) { R.again = true; paintShop(); return; }
    const uid = shopUid();
    clearTimeout(R.timer);
    R.timer = setTimeout(() => {
        R.timer = null;
        const q = R.whyQ; R.whyQ = [];
        if (!app.ai.ready() || shopUid() !== uid) return;
        const rec = shopRec(app);
        if (rec && rec.sig === shopSig(app.world())) { paintShop(); return; }   // 改了又改回来:和上次判断时一样,不花这笔钱
        shopRun(q.slice(0, 4).join('；') || '货架有变化');
    }, SHOP.delay);
    paintShop();
}
export function shopRedo() {
    clearTimeout(R.timer); R.timer = null; R.whyQ = [];
    return shopRun(R.app && shopRec(R.app) ? '她点了「重新判断」' : '她点了「让顾问判断」');
}
// 后端已经 clean_shop 过;这里只保证形状,url 只认 https
export function normShop(d) {
    if (!d || typeof d !== 'object') return null;
    const str = x => String(x == null ? '' : x).trim();
    const items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x === 'object' && (str(x.need) || str(x.what))).map(x => ({
        need: str(x.need), urgency: URG.some(u => u[0] === x.urgency) ? x.urgency : 'optional',
        what: str(x.what), why: str(x.why), cover: str(x.cover), replaces: str(x.replaces),
        picks: (Array.isArray(x.picks) ? x.picks : []).filter(k => k && str(k.name)).slice(0, 4).map(k => ({
            name: str(k.name), where: str(k.where), price: str(k.price), why: str(k.why), url: /^https:\/\//.test(str(k.url)) ? str(k.url) : '' }))
    }));
    const skip = (Array.isArray(d.skip) ? d.skip : []).filter(x => x && str(x.name)).map(x => ({ name: str(x.name), why: str(x.why) }));
    return { verdict: items.length ? 'buy' : 'none', summary: str(d.summary), items, skip };
}
export async function shopRun(why) {
    const app = R.app;
    if (!app || !app.ai.ready() || R.running) return;
    const uid = shopUid(), W = app.world(), sig = shopSig(W), trigger = why || '货架有变化';
    R.running = { uid, sig }; R.err = null;
    paintShop();
    try {
        const r = await app.ai.api.shop(buildSkincareContext(W, whoOf(app)), trigger);
        const d = normShop(r && r.data);
        if (!d) throw new Error('顾问这次没给出结论');
        if (shopUid() === uid) app.store.setLocal(LOCAL_KEYS.aiShop, JSON.stringify({ uid, sig, at: new Date().toISOString(), trigger, data: d, model: (r && r.model) || '', cost: (r && r.cost) || 0 }));
    } catch (e) {
        if (shopUid() === uid) R.err = { uid, sig, msg: e.message || '顾问出错了' };
    }
    R.running = null;
    paintShop();
    if (R.again) { R.again = false; if (shopUid() === uid) shopLocal(''); else R.whyQ = []; }
}
function shopOfflineHtml(W) {
    const shop = shopItems(W);
    if (!shop.length) return '<p class="note">家里现有的东西够凑一套完整方案，暂时不用买。</p>';
    return `<p class="note">看的是这套方案缺不缺一环。家里剩下的东西都顶不了的那一项，才需要买。</p>
        <ol class="shop-off">${shop.map(g => `<li>
            <span class="lede">${g.soon ? '快了：' : ''}${esc(g.what)}</span>
            <span class="note ink">${esc(g.why)}</span>
            ${g.how ? `<span class="note">挑选标准：${esc(g.how)}</span>` : ''}
            ${g.pick ? `<span class="note">参考：${esc(g.pick.name)}${g.pick.price ? '（' + esc(g.pick.price) + '）' : ''}，${esc(g.pick.why)}</span>` : ''}</li>`).join('')}</ol>`;
}
export function shopHtml(app, W) {
    const acc = app.ai.access(), ready = app.ai.ready();
    const head = (btn, meta) => `<div class="sec-h"><h2 class="pr-h">要不要买新的</h2>${btn}</div>${meta ? `<p class="meta" id="pr-shop-meta">${meta}</p>` : ''}`;
    const copy = `<button type="button" class="btn-link sm quiet" id="pr-shop-copy">复制清单</button>`;
    if (acc !== 'on') {
        const why = acc === 'out' ? '登录并开通顾问后，顾问会联网查英国有售的型号。下面是离线判断。' : acc === 'none' ? '顾问还没开通（邀请制），下面是离线判断。' : '这个账号用不了顾问，下面是离线判断。';
        return head(copy, '') + `<p class="note faint" id="pr-shop-st">${esc(why)}</p><div id="pr-shop-off">${shopOfflineHtml(W)}</div>`;
    }
    const uid = (curUser(app) || {}).uid, rec = shopRec(app);
    const busy = !!(R.running && R.running.uid === uid), queued = !!R.timer;
    const err = R.err && R.err.uid === uid ? R.err : null;
    const fresh = !!rec && rec.sig === shopSig(W);
    const redo = ready ? `<button type="button" class="btn-link sm" id="pr-shop-redo"${busy ? ' disabled' : ''}>${busy ? '在查…' : rec ? '重新判断' : '让顾问判断'}</button>` : '';
    if (!rec || (!fresh && err && !busy)) {
        const line = busy ? '顾问在查英国有售的型号，大约一分钟。下面先按离线规则看。'
            : err ? '顾问这次没查成（' + err.msg + '），下面先按离线规则看。'
                : queued ? '货架变了，过几秒让顾问判断。下面先按离线规则看。'
                    : ready ? '还没让顾问判断过。下面先按离线规则看。' : '顾问连上之后能联网查型号。下面先按离线规则看。';
        return head(`<span class="btn-row">${redo}${copy}</span>`, '') + `<p class="note" id="pr-shop-st" role="status">${esc(line)}</p><div id="pr-shop-off">${shopOfflineHtml(W)}</div>`;
    }
    const d = rec.data;
    const st = busy ? '顾问在查…（上次的结果先留着）' : !fresh ? '货架变了，结果可能过时' + (queued ? '，过几秒重判' : '') : '';
    const meta = esc('顾问 · ' + md(rec.at) + ' ' + hm(rec.at) + ' 判断 · 联网查的英国型号 · 货架变了会自动重判');
    let h = head(`<span class="btn-row">${redo}${copy}</span>`, meta);
    if (st) h += `<p class="note shop-st" id="pr-shop-st" role="status">${esc(st)}</p>`;
    h += `<p class="lede pr-shop-sum">${d.verdict === 'none' ? '现在不用买。' : ''}${esc(d.summary || '')}</p>`;
    if (rec.trigger) h += `<p class="note faint">这次判断是因为：${esc(rec.trigger)}</p>`;
    h += '<div id="pr-shop-list">';
    URG.forEach(([u, label]) => {
        const list = d.items.filter(x => x.urgency === u);
        if (!list.length) return;
        h += `<div class="shop-g" data-urg="${u}"><div class="shop-gh"><span class="dot ${u === 'now' ? 'caution' : 'hollow'}"></span><span class="sec-t">${label}</span></div>${list.map(x => `<div class="shop-it">
            <span class="shop-need">${esc(x.need || x.what)}${x.replaces ? `<span class="note">，接班「${esc(x.replaces)}」</span>` : ''}</span>
            ${x.what && x.need ? `<span class="note">${esc(x.what)}</span>` : ''}
            ${x.why ? `<span class="note ink">为什么：${esc(x.why)}</span>` : ''}
            ${x.cover ? `<span class="note">买到之前：${esc(x.cover)}</span>` : ''}
            ${x.picks.length ? `<ul class="picks">${x.picks.map(k => `<li>${k.url ? `<a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${esc(k.name)}</a>` : `<span class="pick-n">${esc(k.name)}</span>`}<span class="note nowrap">${esc([k.price, k.where].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>` : ''}
        </div>`).join('')}</div>`;
    });
    h += '</div>';
    if (d.skip.length) h += `<div class="shop-skip" id="pr-shop-skip"><span class="sec-t">这些不用买</span><ul class="list note">${d.skip.map(x => `<li>${esc(x.name)}${x.why ? '：' + esc(x.why) : ''}</li>`).join('')}</ul></div>`;
    return h;
}
function shopCopyText(app, W) {
    const rec = app.ai.access() === 'on' ? shopRec(app) : null;
    if (rec) {
        const d = rec.data;
        if (d.verdict === 'none') return '现在不用买。' + (d.summary || '');
        const lines = ['护肤要买的（顾问 ' + md(rec.at) + ' ' + hm(rec.at) + ' 判断）', d.summary || ''];
        URG.forEach(([u, label]) => {
            const list = d.items.filter(x => x.urgency === u); if (!list.length) return;
            lines.push('', label);
            list.forEach((x, i) => {
                lines.push((i + 1) + '. ' + (x.need || x.what) + (x.replaces ? '（接班「' + x.replaces + '」）' : ''));
                if (x.why) lines.push('   为什么：' + x.why);
                x.picks.forEach(k => lines.push('   型号：' + k.name + ([k.price, k.where].filter(Boolean).length ? '（' + [k.price, k.where].filter(Boolean).join('，') + '）' : '') + (k.url ? ' ' + k.url : '')));
            });
        });
        if (d.skip.length) lines.push('', '这些不用买：' + d.skip.map(x => x.name).join('、'));
        return lines.join('\n');
    }
    const shop = shopItems(W);
    if (!shop.length) return '家里现有的东西够凑一套完整方案，暂时不用买。';
    return '护肤要买的（按方案缺口）\n\n' + shop.map((g, i) => (i + 1) + '. ' + g.what + '\n   为什么：' + g.why + (g.how ? '\n   挑选标准：' + g.how : '') + (g.pick ? '\n   参考：' + g.pick.name : '')).join('\n\n');
}
function bindShop(box, app) {
    const r = box.querySelector('#pr-shop-redo'); if (r) r.addEventListener('click', () => { shopRedo(); });
    const c = box.querySelector('#pr-shop-copy');
    if (c) c.addEventListener('click', () => {
        const txt = shopCopyText(app, app.world());
        try { navigator.clipboard.writeText(txt).then(() => toast('清单复制好了'), () => sysAlert(txt, '清单')); } catch (e) { sysAlert(txt, '清单'); }
    });
}
function paintShop() {
    const app = R.app, box = document.getElementById('pr-shop');
    if (!app || !box) return;
    box.innerHTML = shopHtml(app, app.world());
    bindShop(box, app);
}

// ══ 读成分表(/api/vision read_label)→ 让她确认 → 入库 → 能撤销 ═════════════════════════════
// label = {state:'busy'|'confirm'|'done'|'undone'|'error', at, data, role, traits[], matchId, newId, snap(改之前的定义), msg}
let label = null;
// 换账号:上一个人刚读的成分表(含撤销用的产品快照)、「要不要买」排着的那次都清掉(app.js clearLocalExtras 调;R.running 自带 uid 守卫)
export function resetForUser() { label = null; clearTimeout(R.timer); R.timer = null; R.whyQ = []; R.again = false; R.err = null; }
const ownerOf = app => (app.store && app.store.state && app.store.state.owner) || '';
// 成分表结果只认读的那个账号:换了账号就当没有(不渲染、不入库、不撤销)
const labelMine = app => !!label && label.owner === ownerOf(app);
const norm = s => String(s || '').toLowerCase().replace(/[\s'’·\-_.,()（）%]/g, '');
export function matchProduct(W, name) {
    const n = norm(name); if (n.length < 3) return null;
    const live = (W.products || []).filter(p => !p.hidden);
    return live.find(p => norm(p.name) === n) || live.find(p => norm(p.name).length >= 4 && (n.indexOf(norm(p.name)) >= 0 || norm(p.name).indexOf(n) >= 0)) || null;
}
// opts.sheet:读完直接打开预填好的编辑 sheet(引导里用:产品页的卡片被全屏引导挡着);opts.onSaved(id, wasNew)
export async function readLabelFromFile(app, file, opts) {
    opts = opts || {};
    if (!file) return;
    if (!app.ai.ready()) {
        await app.ai.probe(true);
        if (!app.ai.ready()) { toast(app.ai.state.down ? '顾问连不上，先手动加' : '顾问还没开通，先手动加'); openAddSheet(app, opts.sheet ? { stay: true, onSaved: opts.onSaved } : {}); return; }
    }
    let img;
    try { img = await imageToDataURL(file, 1280); } catch (e) { toast(e.message); return; }
    const owner = ownerOf(app);
    label = { state: 'busy', at: Date.now(), owner };
    paintLabel(app);
    if (opts.sheet) toast('在读成分表…');
    try {
        const W = app.world();
        const r = await app.ai.api.vision(buildSkincareContext(W, whoOf(app)), img, 'read_label');
        if (ownerOf(app) !== owner) return;   // 等结果的时候换了账号:这是上一个人的成分表,丢掉
        acceptLabel(app, (r && r.data) || {});
        if (opts.sheet) { label.onSaved = opts.onSaved; labelAct(app, 'edit'); }
    } catch (e) {
        if (ownerOf(app) !== owner) return;
        label = { state: 'error', at: Date.now(), msg: (e.code === 0 && !e.aborted ? '顾问暂时连不上，先手动加。' : e.message) || '顾问出错了', owner }; paintLabel(app); if (opts.sheet) toast('没读成：' + label.msg);
    }
}
// 结果先摆出来让她看:家里有这支 → 补特性;没有 → 新加一支。都要她点「对,入库」才写
export function acceptLabel(app, d) {
    const W = app.world();
    const traits = cleanTraits(d.traits);
    let role = ROLE_FROM_CN[String(d.role || '').trim()] || (ROLE_LABEL[d.role] ? d.role : '');
    if (role === 'acid' && (traits.indexOf('clay') >= 0 || traits.indexOf('scrub') >= 0)) role = 'mask';
    const hit = matchProduct(W, d.name);
    label = { state: 'confirm', at: Date.now(), owner: ownerOf(app), data: { name: String(d.name || '').trim(), note: String(d.note || '').trim() }, role: hit ? (hit.role || role) : role, traits, matchId: hit ? hit.id : '' };
    paintLabel(app);
    return label;
}
function labelHtml(app, W) {
    if (!labelMine(app)) return '';
    const L = label;
    if (L.state === 'busy') return `<div class="pr-label" id="pr-label"><p class="note" role="status">在读成分表…</p></div>`;
    if (L.state === 'error') return `<div class="pr-label" id="pr-label"><p class="note">没读成：${esc(L.msg)}</p><div class="btn-row"><button type="button" class="btn-link sm" data-lbl="manual">手动加</button><button type="button" class="btn-link sm quiet" data-lbl="close">关掉</button></div></div>`;
    const hit = L.matchId ? (W.products || []).find(p => p.id === L.matchId) : null;
    const name = (hit && hit.name) || L.data.name || '没认出名字';
    if (L.state === 'done' || L.state === 'undone') {
        return `<div class="pr-label done" id="pr-label"><span class="note">${L.state === 'undone' ? '已撤销，货架回到读之前。' : esc(name) + (L.newId ? ' 加进货架了。' : ' 的特性已补进货架。')}</span>
            ${L.state === 'done' ? `<button type="button" class="btn-link sm" data-lbl="undo" id="pr-label-undo">撤销</button>` : `<button type="button" class="btn-link sm quiet" data-lbl="close">关掉</button>`}</div>`;
    }
    const kv = [['认成', name + (L.role ? ' · ' + (ROLE_LABEL[L.role] || L.role) : ' · 没认出是什么')],
        ['特性', L.traits.length ? L.traits.map(traitLabel).join(' · ') : '没读出特性'],
        ['货架上', hit ? '家里已经有这支，会把特性补进去' : '新的一支，会加进货架，开封日记今天']];
    if (L.data.note) kv.push(['顾问说', L.data.note]);
    return `<div class="pr-label" id="pr-label">
        <div class="sec-h"><span class="sec-t rev">刚读完的成分表</span><span class="meta">${esc(hm(L.at))}</span></div>
        <p class="pr-label-name">${esc(name)}</p>
        <dl class="pr-kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${!hit && !L.role ? '<p class="note">没认出它是什么：点「读错了，改一下」选一下再入库。</p>' : ''}
        <div class="acts"><button type="button" class="btn btn-primary" data-lbl="ok" id="pr-label-ok"${!hit && !L.role ? ' disabled' : ''}>对，入库</button>
            <button type="button" class="btn" data-lbl="edit" id="pr-label-edit">读错了，改一下</button></div>
    </div>`;
}
function rawDef(store, id) { const p = rawDefs(store).find(x => x.id === id); return p ? JSON.parse(JSON.stringify(p)) : null; }
function labelAct(app, act) {
    const store = app.store, t = app.today(), L = label;
    if (!L) return;
    if (!labelMine(app)) { label = null; paintLabel(app); return; }
    if (act === 'close') { label = null; paintLabel(app); return; }
    if (act === 'manual') { label = null; paintLabel(app); openAddSheet(app); return; }
    if (act === 'ok' && L.state === 'confirm') {
        if (L.matchId) {
            L.snap = rawDef(store, L.matchId);
            localSetTraits(store, L.matchId, L.traits.length ? L.traits : null, t);
        } else {
            const np = localAddProduct(store, { name: L.data.name, role: L.role, traits: L.traits, notes: L.data.note ? ['顾问读成分表：' + L.data.note.slice(0, 80)] : [] }, t);
            if (!np) { toast('先写个名字、选一下它是什么'); return; }
            L.newId = np.id;
        }
        L.state = 'done';
        app.renderAll();
        return;
    }
    if (act === 'edit' && L.state === 'confirm') {
        const before = L.matchId ? rawDef(store, L.matchId) : null;
        openEditSheet(app, L.matchId || null, { name: L.data.name, role: L.role, traits: L.traits, note: L.data.note ? '顾问读成分表：' + L.data.note : '顾问按成分表预填的，看一眼再存。' }, {
            onSaved: (pid, wasNew) => { L.state = 'done'; if (wasNew) L.newId = pid; else { L.matchId = pid; L.snap = before; } if (L.onSaved) L.onSaved(pid, wasNew); }
        });
        return;
    }
    if (act === 'undo' && L.state === 'done') {
        if (L.newId) localRemoveNewProduct(store, L.newId, t);
        else if (L.snap) localReplaceDef(store, L.snap, t);
        L.state = 'undone';
        app.renderAll();
        toast('已撤销');
    }
}
function paintLabel(app) {
    const box = document.getElementById('pr-label-box');
    if (!box) return;
    box.innerHTML = labelHtml(app, app.world());
    box.querySelectorAll('[data-lbl]').forEach(b => b.addEventListener('click', () => labelAct(app, b.dataset.lbl)));
}

// ══ 添加 / 编辑 ═════════════════════════════════════════════════════════════════════════
// 添加:拍成分表优先(顾问开通了才有),否则先选「这是什么」(推断不出来就问,绝不默认成保湿)
// opts = {onSaved(id, wasNew), stay(不跳到产品页,引导里用)}
export function openAddSheet(app, opts) {
    opts = opts || {};
    const canPhoto = app.ai.access() === 'on';
    openSheet({ id: 'add-sheet', title: '添加产品', html:
        (canPhoto ? `<label class="btn btn-primary btn-block file-btn">${ico('camera')}拍成分表，自动认是什么<input type="file" accept="image/*" id="add-photo"></label>` : '') +
        `<div class="sec-t add-q">${canPhoto ? '或者手动加。' : ''}这是什么？</div>
        <div class="add-roles">${ADD_ROLES.map(([r, l]) => `<button type="button" class="btn" data-role="${r}">${esc(l)}</button>`).join('')}</div>`,
        onMount: ov => {
            const f = ov.querySelector('#add-photo');
            if (f) f.addEventListener('change', () => { const file = f.files && f.files[0]; f.value = ''; closeSheet('add-sheet'); if (!opts.stay && app.show) app.show('products'); readLabelFromFile(app, file); });
            ov.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => { closeSheet('add-sheet'); openEditSheet(app, null, { role: b.dataset.role }, opts); }));
        } });
}
// pid = null → 新加;prefill = {name, role, traits[], note};opts.onSaved(id, wasNew)
export function openEditSheet(app, pid, prefill, opts) {
    prefill = prefill || {}; opts = opts || {};
    const W = app.world();
    const prod = pid ? (W.products || []).find(p => p.id === pid) || rawDef(app.store, pid) : null;
    const role0 = prefill.role || (prod && prod.role) || '';
    const tr0 = prefill.traits ? cleanTraits(prefill.traits) : (prod ? traitsOf(prod) : []);
    const name0 = prefill.name || (prod ? prod.name : '');
    const open0 = pid ? ((W.popen || {})[pid] || '') : W.today;
    const notes0 = prod ? visNotes(prod, W.profile).join('\n') : '';
    const html = `${prefill.note ? `<p class="note pr-pre">${esc(prefill.note)}</p>` : ''}
        <label class="field"><span>名字</span><input type="text" id="m-name" maxlength="80" value="${esc(name0)}" placeholder="比如：理肤泉 B5 修复霜" autocomplete="off"></label>
        <div class="field"><span>这是什么</span><div class="chips" id="m-role" role="radiogroup" aria-label="这是什么">${ADD_ROLES.map(([r, l]) => `<button type="button" class="chip" role="radio" data-v="${r}" aria-checked="${role0 === r}">${esc(l)}</button>`).join('')}</div></div>
        <label class="field"><span>开封日期（没开封就清空）</span><input type="date" id="m-open" value="${esc(open0)}" max="${esc(W.today)}"></label>
        <details class="fold pr-adv"><summary><span class="fold-sum"><span class="lede">成分特性、保质期、备注</span></span></summary><div class="fold-body">
            <div class="sec-t">成分特性（判断温不温和、闷不闷、能不能镇静）</div>
            <div class="chips" id="m-traits">${TRAIT_DEFS.map(t => `<button type="button" class="chip" data-v="${t.k}" aria-pressed="${tr0.indexOf(t.k) >= 0}">${esc(t.l)}</button>`).join('')}</div>
            <label class="field field-row"><span>保质期（开封后几个月，0 = 不提醒）</span><input type="text" inputmode="numeric" id="m-pao" value="${esc(prod ? prod.paoMonths || 0 : 0)}"></label>
            <label class="field"><span>备注（每行一条）</span><textarea id="m-notes" rows="2">${esc(notes0)}</textarea></label>
        </div></details>`;
    openSheet({ id: 'edit-sheet', title: pid ? '编辑产品' : (prefill.name ? '添加产品（按成分表预填）' : '添加产品'), html, focus: '#m-name',
        actions: [{ label: '取消' }, { label: '保存', primary: true, keep: true, fn: ov => {
            const name = ov.querySelector('#m-name').value.trim();
            const rb = ov.querySelector('#m-role [aria-checked="true"]'), role = rb ? rb.dataset.v : '';
            if (!name) { toast('先写个名字'); ov.querySelector('#m-name').focus(); return; }
            if (!role) { toast('选一下它是什么'); return; }
            const traits = [...ov.querySelectorAll('#m-traits [aria-pressed="true"]')].map(b => b.dataset.v);
            const notes = ov.querySelector('#m-notes').value.split('\n').map(x => x.trim()).filter(Boolean);
            const pao = parseInt(ov.querySelector('#m-pao').value, 10) || 0;
            const opened = ov.querySelector('#m-open').value || '';
            const t = app.today();
            const saved = pid ? localEditProduct(app.store, pid, { name, role, traits, notes, paoMonths: pao, opened }, t)
                : localAddProduct(app.store, { name, role, traits, notes, paoMonths: pao, opened }, t);
            if (!saved) { toast('没存上'); return; }
            closeSheet('edit-sheet');
            if (opts.onSaved) opts.onSaved(saved.id, !pid);
            app.renderAll();
        } }],
        onMount: ov => {
            ov.querySelectorAll('#m-role .chip').forEach(b => b.addEventListener('click', () => ov.querySelectorAll('#m-role .chip').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'))));
            ov.querySelectorAll('#m-traits .chip').forEach(b => b.addEventListener('click', () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')));
        } });
}

// ══ 一件产品的 sheet:状态、为什么、动作 ════════════════════════════════════════════════════
function openProdSheet(app, pid) {
    const W = app.world(), p = (W.products || []).find(x => x.id === pid);
    if (!p) return;
    const pao = paoState(W, p), low = (W.low || []).indexOf(pid) >= 0, crit = criticalGaps(W, p);
    let lowTxt = '';
    if (low) {
        const ng = gapsIfGone(W, pid), rep = pickReplacement(W, p);
        lowTxt = ng.length ? '它一没，' + ng.map(g => g.label).join('、') + '就断了。看「要不要买新的」，现在买来得及。'
            : (rep && !rep.blocked ? '不用急着买：家里还有「' + rep.p.name + '」能接上' + (rep.needEnable ? '（它现在收在「不要了的」里，点「恢复」就接上）' : '') + '。' : '不用急着买：这一档没了也不影响整套方案。');
    }
    const notes = visNotes(p, W.profile).slice(0, 4);
    const tr = traitsOf(p);
    const html = `<p class="note">${esc(ROLE_LABEL[p.role] || '还没选它是什么')}${W.popen[pid] ? ' · ' + esc(mdOf(W.popen[pid])) + ' 开封' : ' · 还没开封'}${tr.length ? ' · ' + esc(tr.map(traitLabel).join('、')) : ''}</p>
        ${pao ? `<div class="pr-warn"><span class="sec-t">保质期</span><p class="note ink">${esc(pao.msg)}</p></div>` : ''}
        ${crit.length && !low ? `<div class="pr-warn"><span class="sec-t">注意</span><p class="note ink">用完它就没有能顶替的了，「${esc(crit.map(g => g.label).join('、'))}」会断档，记得提前补。</p></div>` : ''}
        ${lowTxt ? `<p class="lede pr-low">${esc(lowTxt)}</p>` : ''}
        ${notes.length ? `<ul class="list note pr-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
    const t = app.today();
    const acts = [
        { label: low ? '还够用' : '快用完了', fn: () => { localToggleLow(app.store, pid, t); app.renderAll(); } },
        { label: '用完了', fn: () => runOut(app, pid) },
        { label: p.role ? '编辑' : '选一下它是什么', fn: () => openEditSheet(app, pid) },
        { label: '不要了', fn: () => dropSheet(app, pid) }];
    if (app.ai.access() === 'on') acts.push({ label: '问顾问', fn: () => askAdvisor(app, '关于「' + p.name + '」：') });
    openSheet({ id: 'prod-sheet', title: p.name, html, actions: acts });
}
function runOut(app, pid) {
    const r = localMarkRunOut(app.store, pid, app.today());
    if (!r) return;
    app.renderAll();
    const name = r.rec.name, gaps = (r.reg && r.reg.gaps) || [];
    const txt = '记了一笔空瓶' + (r.rec.weeks !== null && r.rec.weeks !== undefined ? '（开封 ' + r.rec.weeks + ' 周' + (r.rec.uses ? '，用过 ' + r.rec.uses + ' 次' : '') + '）' : '') + '。'
        + (gaps.length ? '方案缺了一环：' + gaps.map(g => g.label).join('、') + '，看「要不要买新的」。' : '方案照家里剩下的东西重排了' + (r.reg ? '，现在是 v' + r.reg.v : '') + '。');
    openSheet({ id: 'runout-sheet', title: '「' + name + '」用完了', text: txt, actions: [
        { label: '其实没用完', fn: () => { localUndoRunOut(app.store, r, app.today()); app.renderAll(); toast('「' + name + '」放回货架了，和用完之前一样'); } },
        { label: '知道了', primary: true }] });
}
function dropSheet(app, pid) {
    const W = app.world(), p = (W.products || []).find(x => x.id === pid); if (!p) return;
    const why = ['不适合我', '太刺激', '送人了', '只是暂时不想用'];
    const go = w => {
        closeSheet('drop-sheet');
        const r = localDropProduct(app.store, pid, w, app.today());
        app.renderAll();
        toast(r ? '「' + p.name + '」收进了「不要了的」' : '「' + p.name + '」没拿掉：货架记录里找不到它，刷新一下再试');
    };
    openSheet({ id: 'drop-sheet', title: '「' + p.name + '」不要了？', html: `<p class="note">它不会再排进流程，收在产品页最下面「不要了的」，随时能恢复。为什么？（选填）</p>
        <div class="chips pr-why">${why.map(w => `<button type="button" class="chip" data-why="${esc(w)}">${esc(w)}</button>`).join('')}</div>`,
        actions: [{ label: '取消' }, { label: '直接拿掉', primary: true, keep: true, fn: () => go('') }],
        onMount: ov => ov.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', () => go(b.dataset.why))) });
}

// ══ 渲染 ═══════════════════════════════════════════════════════════════════════════════
export function render(app) {
    const W = app.world();
    const live = liveShelf(W);
    const dropped = (W.products || []).filter(p => isDropped(W, p));
    const empties = emptyLogRows(W.empties, (W.products || []).concat(rawDefs(app.store).filter(x => !(W.products || []).some(p => p.id === x.id))));
    const canPhoto = app.ai.access() === 'on';
    const row = p => {
        const [tone, state] = rowState(W, p);
        return `<button type="button" class="prod" data-id="${esc(p.id)}"><span class="prod-role">${esc(p.role ? (hasTrait(p, 'scrub') ? '磨砂' : (ROLE_SHORT[p.role] || '')) : '未定')}</span>
            <span class="prod-main"><span class="prod-name">${esc(p.name)}</span>
                <span class="prod-sub"><span class="prod-state"><i class="dot ${tone}"></i>${esc(state)}</span><span class="meta nowrap">${esc(rowMeta(W, p))}</span></span></span></button>`;
    };
    return `<div class="title-row"><h1 class="page-title" id="products-h">${esc(title)}</h1><span class="meta" id="pr-count">${live.length ? live.length + ' 支' : ''}</span></div>
        <div class="pr-top btn-row">${canPhoto ? `<label class="btn file-btn" id="pr-scan">${ico('camera')}拍成分表<input type="file" accept="image/*" id="pr-scan-in"></label>` : ''}
            <button type="button" class="${canPhoto ? 'btn-link quiet' : 'btn'}" id="pr-add">${canPhoto ? '手动添加' : ico('plus') + '添加产品'}</button></div>
        <div id="pr-label-box">${labelHtml(app, W)}</div>
        <section class="sec" id="pr-shop" aria-live="polite">${shopHtml(app, W)}</section>
        <section class="sec" id="pr-shelf">
            <div class="sec-h"><h2 class="pr-h">货架</h2><span class="meta">${live.length ? '按在流程里的位置排' : ''}</span></div>
            ${live.length ? `<div class="prods">${live.map(row).join('')}</div>` : `<div class="empty" id="pr-empty-shelf"><p class="lede">货架还是空的。</p><p class="note">先放一支洁面和一支保湿，今晚就能排。</p><div class="btn-row"><button type="button" class="btn" data-go="add">添加</button></div></div>`}
        </section>
        ${dropped.length ? `<details class="fold sec" id="pr-dropped"><summary><span class="fold-sum"><span class="lede">不要了的（${dropped.length}）</span></span></summary><div class="fold-body rows">${dropped.map(p =>
            `<div class="row"><span class="row-main"><span class="lede">${esc(p.name)}</span>${p.dropped && p.dropped.why ? `<span class="note">${esc(p.dropped.why)}</span>` : (!p.hidden ? '<span class="note">备用</span>' : '')}</span><button type="button" class="btn-link" data-restore="${esc(p.id)}">恢复</button></div>`).join('')}</div></details>` : ''}
        <details class="fold sec" id="pr-empties"><summary><span class="fold-sum"><span class="lede">空瓶记录</span>${empties.length ? `<span class="note">${empties.length} 支</span>` : ''}</span></summary><div class="fold-body">${empties.length ? `<div class="rows">${empties.map(r =>
            `<div class="row"><span class="row-main"><span class="lede">${esc(r.name)}</span><span class="meta">${esc(mdOf(r.date))} 用完${r.weeks !== null && r.weeks !== undefined ? ' · 开封 ' + r.weeks + ' 周' : ''}${r.uses ? ' · 用过 ' + r.uses + ' 次' : ''}</span></span>${(W.gone || []).indexOf(r.id) >= 0 ? `<button type="button" class="btn-link" data-ungone="${esc(r.id)}">买回来了</button>` : ''}</div>`).join('')}</div>` : '<p class="note">还没有用完的产品。用完一支点「用完了」，这里会记下开封了多久、用了几次。</p>'}</div></details>`;
}
export function mount(root, app) {
    ensureShopRunner(app);
    const t = () => app.today();
    const add = () => openAddSheet(app);
    const a = root.querySelector('#pr-add'); if (a) a.addEventListener('click', add);
    root.querySelectorAll('[data-go="add"]').forEach(b => b.addEventListener('click', add));
    const sc = root.querySelector('#pr-scan-in');
    if (sc) sc.addEventListener('change', () => { const f = sc.files && sc.files[0]; sc.value = ''; readLabelFromFile(app, f); });
    root.querySelectorAll('.prod[data-id]').forEach(b => b.addEventListener('click', () => openProdSheet(app, b.dataset.id)));
    root.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => { localRestoreProduct(app.store, b.dataset.restore, t()); app.renderAll(); }));
    root.querySelectorAll('[data-ungone]').forEach(b => b.addEventListener('click', () => {
        const r = localUnGone(app.store, b.dataset.ungone, t());
        app.renderAll();
        toast('「' + ((r && r.def && r.def.name) || '它') + '」放回货架了，开封日记今天');
    }));
    const lb = root.querySelector('#pr-label-box');
    if (lb) lb.querySelectorAll('[data-lbl]').forEach(b => b.addEventListener('click', () => labelAct(app, b.dataset.lbl)));
    const shop = root.querySelector('#pr-shop'); if (shop) bindShop(shop, app);
    // 顾问开通状态还没核过:核完了再画一遍「要不要买」这一块(不打断她)
    probeOnce(app, () => paintShop());
}
