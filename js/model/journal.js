// ══ 每天的记录 sk_jrnl1 ═══════════════════════════════════════════════════════════════════
// 条目形状(和 v1 一样,新字段都是可选的,v1 读到不认识的字段会原样留着):
//   { date:'YYYY-MM-DD', status:[], products:[journalTag…], note:'', phase:''(HRT 阶段),
//     trend?:'better'|'same'|'worse', skipped?:[产品名或 tag](她点了「今晚没做」), done?:true(完成今晚),
//     auto?:true(极简模式按计划推定的,不是她记的), spots?:[{zone,type}](脸部地图),
//     photoAssess?:{…}(v2 新:定期拍照全套分析的结构化结果,见 cleanPhotoAssess;照片本身只存本机 IndexedDB) }
// 降序,最多留 365 条。
// 【要紧 · 8/20 状态 ≠ 事件】每天点「有痘」是说「痘还在」,不是「今天又新爆了」。状态标签只描述现状;变化只认「比昨天好 / 差」。
import { K } from '../store.js';

// 标签沿用老名字(旧日志、计分、同步、顾问快照全都认它们),界面上换成人话
export const TAG_LABEL = { '好转': '好些', '稳定': '差不多', '变差': '差些', '泛红': '泛红', '爆痘': '新痘', '闭口': '闭口', '干燥': '干', '敏感': '刺痛', '出油': '比平时油', '粗糙': '粗糙' };
export function tagLabel(t) { return TAG_LABEL[t] || t; }
export const TREND_TAGS = { better: '好转', same: '稳定', worse: '变差' };
export const SYMPTOM_TAGS = ['泛红', '爆痘', '闭口', '干燥', '敏感', '出油'];
export const IRRITATION_TAGS = ['泛红', '敏感', '爆痘', '变差'];
export function trendOf(en) {
    const st = (en && en.status) || [];
    return st.indexOf('变差') >= 0 ? 'worse' : st.indexOf('好转') >= 0 ? 'better' : st.indexOf('稳定') >= 0 ? 'same' : '';
}

// 脸部地图:只到区域,不做精确点。左右一律按**她自己的**左右。区名和 ZONE_PRESETS / 顾问的 zonesAdd 对得上。
// (线稿的 SVG 路径在 js/ui/facemap.js)
export const FACE_ZONES = [
    { k: 'hair', name: '发际线' }, { k: 'fore', name: '额头' }, { k: 'cheekR', name: '右脸颊' }, { k: 'cheekL', name: '左脸颊' },
    { k: 'jawR', name: '右下颌线' }, { k: 'jawL', name: '左下颌线' }, { k: 'peri', name: '口周' }, { k: 'chin', name: '下巴' },
    { k: 'nose', name: '鼻子' }, { k: 'phil', name: '人中/鼻下' }, { k: 'glab', name: '眉间' }
];
export const FACE_ZONE_NAMES = FACE_ZONES.map(z => z.name);
export const SPOT_TYPES = ['闭口', '红痘', '脓头', '泛红', '干皮', '痘印'];
export const FM_TRIGGER = ['泛红', '爆痘', '闭口', '干燥', '敏感'];   // 勾了这些才出现「标在脸上」(出油不是位置问题)
export function cleanSpots(a) {
    const out = [];
    (Array.isArray(a) ? a : []).forEach(s => {
        if (!s || FACE_ZONE_NAMES.indexOf(s.zone) < 0 || SPOT_TYPES.indexOf(s.type) < 0) return;
        if (!out.some(x => x.zone === s.zone && x.type === s.type)) out.push({ zone: s.zone, type: s.type });
    });
    return out;
}

// ── 照片全套分析(v2,后端 POST /api/assess)的结构化结果 → photoAssess 字段 ──
// 只存结构化结果(随 sk_jrnl1 同步);照片只在本机 IndexedDB。
// 【要紧】照片分析**不单独触发就医红线**(engine/redline.js 只读 status),交给顾问建议。
export const ASSESS_TYPES = ['闭口', '红痘', '脓头', '泛红', '干皮', '出油', '痘印'];
export const ASSESS_LEVELS = ['少', '中', '多'];
export const ASSESS_CONF = ['低', '中', '高'];
export function cleanPhotoAssess(d, at) {
    if (!d || typeof d !== 'object') return null;
    const str = (x, n) => String(x == null ? '' : x).trim().slice(0, n || 200);
    const zones = (Array.isArray(d.zones) ? d.zones : []).filter(z => z && FACE_ZONE_NAMES.indexOf(z.zone) >= 0).map(z => ({
        zone: z.zone,
        findings: (Array.isArray(z.findings) ? z.findings : []).filter(f => f && ASSESS_TYPES.indexOf(f.type) >= 0).map(f => ({
            type: f.type, level: ASSESS_LEVELS.indexOf(f.level) >= 0 ? f.level : '少', confidence: ASSESS_CONF.indexOf(f.confidence) >= 0 ? f.confidence : '低'
        }))
    })).filter(z => z.findings.length);
    return { at: at || '', usable: d.usable !== false, overall: str(d.overall), vs_last: str(d.vs_last, 300), zones,
             suggest_tags: (Array.isArray(d.suggest_tags) ? d.suggest_tags : []).filter(t => typeof t === 'string').slice(0, 8),
             suggest_spots: cleanSpots((d.suggest_spots || []).map(s => s && { zone: s.zone, type: s.type === '出油' ? null : s.type })), note: str(d.note, 300) };
}

// ── 读写(第一个参数 store)──
export function journal(store) { return store.lg(K.jrnl) || []; }
export function jrnlEntry(store, date, create) {
    const list = journal(store);
    let en = list.find(x => x && x.date === date) || null;
    if (!en && create) { en = { date, status: [], products: [], note: '', phase: '' }; list.push(en); }
    if (en) { en.status = en.status || []; en.products = en.products || []; }
    return { list, en };
}
export function saveJrnl(store, list, origin) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return store.ls(K.jrnl, list.slice(0, 365), origin);
}
// 好些 / 差不多 / 差些:单选,存成旧标签 好转 / 稳定 / 变差;再点一次取消
export function setTrend(store, date, k, today) {
    if (date > today) return false;
    const { list, en } = jrnlEntry(store, date, true);
    const cur = trendOf(en);
    en.status = en.status.filter(t => t !== '好转' && t !== '稳定' && t !== '变差');
    if (cur === k) delete en.trend; else { en.trend = k; en.status.push(TREND_TAGS[k]); }
    return saveJrnl(store, list);
}
export function toggleSym(store, date, t, today) {
    if (date > today || SYMPTOM_TAGS.indexOf(t) < 0) return false;
    const { list, en } = jrnlEntry(store, date, true);
    en.status = en.status.indexOf(t) >= 0 ? en.status.filter(x => x !== t) : en.status.concat([t]);
    return saveJrnl(store, list);
}
export function setSpots(store, date, spots, today) {
    if (date > today) return false;
    const { list, en } = jrnlEntry(store, date, true);
    const s = cleanSpots(spots);
    if (s.length) en.spots = s; else delete en.spots;
    return saveJrnl(store, list);
}
export function setNote(store, date, note) {
    const { list, en } = jrnlEntry(store, date, true);
    en.note = String(note || '').slice(0, 500);
    return saveJrnl(store, list);
}
// 「今晚没做」:记进当天 skipped(极简模式第二天就不会把它推定成用了)
export function toggleSkipped(store, date, name) {
    const { list, en } = jrnlEntry(store, date, true);
    const s = new Set(en.skipped || []);
    if (s.has(name)) s.delete(name); else s.add(name);
    if (s.size) en.skipped = [...s]; else delete en.skipped;
    return saveJrnl(store, list);
}
export function setPhotoAssess(store, date, data, at) {
    const pa = cleanPhotoAssess(data, at);
    if (!pa) return false;
    const { list, en } = jrnlEntry(store, date, true);
    en.photoAssess = pa;
    return saveJrnl(store, list);
}

// 极简模式的核心语义(Cait 2026-08-15 定,10-29 补):「排上的默认用了」——
// 昨天(或最后一次打开那天)计划里的酸 / 泥膜 / 维 A → 按「已执行」推定并入当天日志(auto:true)。
// 【要紧】她点了「今晚没做」的那几样(entry.skipped)**不补**:越听话数据越错的老问题(AUDIT-ux P0-5)。
// 是合并不是跳过:手动记录原样保留,只补处方里缺的活性。完整模式的空白日仍按「没做」处理,不推定。
// 'derived':推定出来的是事实(过了今天 planday 就被覆盖、推不出来了),云端回声期间也算本机改动、推上去。
// 【要紧 · 唯一咽喉点】任何引擎计算之前都要先跑它:model/world.js 的 buildWorld() 第一件事就是调它;
//    sync.js 在云端的键盖进来之前也调它(sk_planday1 会被盖掉)。
export function absorbPrescribedHistory(store, today) {
    try {
        const prof = store.lg(K.profile) || {};
        if (!prof.minimalMode) return false;
        const pd = store.lg(K.planday);
        if (!pd || !pd.date || pd.date >= today || !(pd.items || []).length) return false;
        const e = journal(store);
        let entry = e.find(x => x.date === pd.date);
        const skipped = new Set((entry && entry.skipped) || []);
        const missing = pd.items.filter(it => it.tag && !(entry && (entry.products || []).includes(it.tag)) && !skipped.has(it.tag) && !(it.name && skipped.has(it.name))).map(it => it.tag);
        if (!missing.length) return false;
        if (!entry) { entry = { date: pd.date, status: [], products: [], note: '', phase: '' }; e.push(entry); }
        entry.products = entry.products || [];
        missing.forEach(t => entry.products.push(t));
        entry.auto = true;
        if (!entry.note) entry.note = '（按当天计划推定）';
        e.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        return store.ls(K.jrnl, e.slice(0, 365), 'derived');
    } catch (err) { return false; }
}
