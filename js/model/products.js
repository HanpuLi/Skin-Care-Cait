// ══ 产品库(货架)═══════════════════════════════════════════════════════════════════════════
// 产品 DEFAULT_PD[i] = {id, role, name, cat, journalTag, statuses[], labels{}, pillCls{}, notes[], pmHint?, amHint?, traits?[], addedOn?,
//   schedule{type∈daily/acid/base/mask/retinol, time[am/pm], maxPerWeek, minDaysBetween, preferShowerNight, avoidShaveDay, avoidAcid, avoidRetinol, enableAutoSchedule},
//   paoMonths, builtin, cleanseStrength?}
// role ∈ cleanse / precleanse / acid / mask / soothe / retinol / serum / oil / eye / moist / repair / spf;认不出就是 ''(她自己选)。
// 纯函数直接用;要读写存储的函数第一个参数传 store。引擎(engine/*)只用这里的纯函数。
// 【注意】DEFAULT_PD 是两个老账号的种子(v1 就公开在仓库里);新账号从空货架起步,不灌这些(AUDIT-ux)。
import { K } from '../store.js';

export const DEFAULT_PD = [
    { id:'sunscreen',role:'spf',icon:'',name:'Lancaster Sun Control SPF50 无油',cat:'防晒 · 每日必备',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['无油款，适合油皮/敏感','用酸次日无防晒 = 加深痘印，必须足量'],schedule:{type:'daily',time:['am'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:12,builtin:true },
    { id:'goodGenes',icon:'',name:'Sunday Riley Good Genes',cat:'去角质 · 乙醇酸',journalTag:'Good Genes',statuses:['paused','active'],labels:{paused:'备用',active:'可以使用'},pillCls:{paused:'paused',active:'active'},notes:['高酒精+乙醇酸，屏障稳定4周后再评估','使用时替换PC或Votary，不得叠用'],schedule:{type:'acid',time:['pm'],maxPerWeek:1,minDaysBetween:2,preferShowerNight:true,avoidShaveDay:true,avoidAcid:true,avoidRetinol:true,enableAutoSchedule:true},paoMonths:12,builtin:true },
    { id:'pc',icon:'',name:"Paula's Choice 6%杏仁酸+2%乳酸",cat:'去角质 · T区',journalTag:'PC酸',statuses:['active','paused'],labels:{active:'正常使用',paused:'备用'},pillCls:{active:'active',paused:'paused'},notes:['T区主选：额头、鼻翼、下颌','停留3–5分钟，无需冲洗'],schedule:{type:'acid',time:['pm'],maxPerWeek:1,minDaysBetween:2,preferShowerNight:true,avoidShaveDay:true,avoidAcid:true,avoidRetinol:true,enableAutoSchedule:true},paoMonths:12,builtin:true },
    { id:'votary',icon:'',name:'Votary 10%乳酸',cat:'去角质 · 全脸',journalTag:'Votary酸',statuses:['active','paused'],labels:{active:'正常使用',paused:'备用'},pillCls:{active:'active',paused:'paused'},notes:['全脸/两颊主选，保湿性更强','与PC交替，乳酸对屏障更温和'],schedule:{type:'acid',time:['pm'],maxPerWeek:1,minDaysBetween:2,preferShowerNight:true,avoidShaveDay:true,avoidAcid:true,avoidRetinol:true,enableAutoSchedule:true},paoMonths:6,builtin:true },
    // ── 每晚固定护理品 ─────────────────────────────────────────
    { id:'sebagh',icon:'',name:'Dr Sebagh Rose de Vie 精华',cat:'精华 · 修护',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['白天可代替面霜，晚上无酸夜使用','全脸3–4滴，轻拍至吸收'],schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:true,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    { id:'mzskin',icon:'',name:'MZ Skin Soothe & Smooth 眼部精华',cat:'眼部 · 护理',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['玻尿酸眼部精华，提亮眼周','无名指轻拍眼眶骨，不要触碰眼球'],schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    { id:'cicaplast',icon:'',name:'Cicaplast B5 修护霜',cat:'修护 · 每晚',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['活跃痘痘处、口罩线点涂','刮胡后全脸薄涂修护微创口'],schedule:{type:'base',time:['pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    { id:'avene',role:'soothe',icon:'',name:'Avène Tolérance Extrême 舒缓面膜',cat:'面膜 · 舒缓（冲洗型）',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['敷约 5 分钟后用温水洗掉','泛红/刺痛/不舒服的时候用，不必天天'],pmHint:'敷约5分钟后洗掉',schedule:{type:'base',time:['pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    { id:'clay',role:'mask',icon:'',name:'IPSA 深层净化泥面膜',cat:'去角质 · 泥膜',journalTag:'泥面膜',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['1次/周，洗澡夜使用','使用当晚视为酸类占用','泛红/敏感期暂停'],schedule:{type:'mask',time:['pm'],maxPerWeek:1,minDaysBetween:0,preferShowerNight:true,avoidShaveDay:true,avoidAcid:true,avoidRetinol:false,enableAutoSchedule:true},paoMonths:6,builtin:true },
    { id:'lancome',role:'cleanse',cleanseStrength:'strong',icon:'',name:'Lancôme Clarifique 洁面泡沫',cat:'洁面 · 洗澡夜',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['洗澡夜使用，60秒按摩，T区多停留','替代温水冲洗，清洁力更强'],schedule:{type:'base',time:['pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:true,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:12,builtin:true },
    // ── 2026-08-06 家中实拍库存新增（真实产品；排在已有产品之后，故各角色首位仍是既有主力，不打乱现有流程） ──
    { id:'lacura',role:'cleanse',cleanseStrength:'gentle',icon:'',name:'Lacura 温和洗面奶',cat:'洁面 · 温和无皂基',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['无皂基氨基酸洁面，敏感肌','出油也别用皂基/强力泡沫，越洗越油'],pmHint:'全脸打圈30秒后温水洗净',amHint:'温和洁面，30秒洗净',schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:12,builtin:true },
    { id:'wildsource',role:'precleanse',icon:'',name:'Wild Source 卸妆膏',cat:'清洁 · 卸妆第一遍',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['晚间卸防晒/妆的第一遍','没妆没厚防晒可跳过'],pmHint:'干手打圈乳化后温水洗净',schedule:{type:'base',time:['pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:12,builtin:true },
    { id:'toleriane',role:'moist',icon:'',name:'La Roche-Posay Toleriane Ultra Light',cat:'保湿 · 无油轻薄',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['无油轻薄乳，敏感/易泛红','油皮/混油首选，防晒前打底'],pmHint:'全脸薄涂封层',amHint:'全脸薄涂，防晒前打底',schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    // 2026-08-29 买的(Boots £19.55),顶掉用完的 Toleriane Ultra Light 空出来的那一档。
    // 【注意】与用完的那支**不是同一个配方**:Ultra = 镇静肽 Neurosensine;Sensitive = 烟酰胺 + 甘油。
    { id:'tolerianeSens',role:'moist',icon:'',name:'La Roche-Posay Toleriane Sensitive Fluide',cat:'保湿 · 无油轻薄',journalTag:'',addedOn:'2026-08-29',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['无油 fluid，混油/油皮不闷；无香精、无精油、无酒精','含烟酰胺：控油、泛红、痘都有对照证据'],pmHint:'全脸薄涂封层',amHint:'全脸薄涂，防晒前打底',schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
    { id:'drorganic',role:'mask',icon:'',name:'dr.organic 葡萄柚水杨酸磨砂',cat:'去角质 · 磨砂（慎用）',journalTag:'磨砂',statuses:['paused','owned'],labels:{paused:'备用',owned:'偶尔用'},pillCls:{paused:'paused',owned:'active'},notes:['物理颗粒+水杨酸，油痘肌','对泛红、红疹区偏刺激，最多两周 1 次，避开发红处'],pmHint:'湿脸轻打圈、避开红疹区，冲净',schedule:{type:'mask',time:['pm'],maxPerWeek:1,minDaysBetween:6,preferShowerNight:true,avoidShaveDay:true,avoidAcid:true,avoidRetinol:false,enableAutoSchedule:false},paoMonths:12,builtin:true },
    { id:'ren',role:'eye',icon:'',name:'REN 亮黑眼圈眼霜',cat:'眼部 · 提亮',journalTag:'',statuses:['owned','paused'],labels:{owned:'正常使用',paused:'备用'},pillCls:{owned:'active',paused:'paused'},notes:['提亮黑眼圈','无名指轻拍眼周，避开眼球'],schedule:{type:'base',time:['am','pm'],maxPerWeek:0,minDaysBetween:0,preferShowerNight:false,avoidShaveDay:false,avoidAcid:false,avoidRetinol:false,enableAutoSchedule:false},paoMonths:6,builtin:true },
];

// ── 角色:产品在流程里站哪一格。逻辑里不写死任何产品 id;ROLE_MAP + inferRole 自动归位 ──
export const ROLE_MAP = { sunscreen: 'spf', goodGenes: 'acid', pc: 'acid', votary: 'acid', sebagh: 'serum', mzskin: 'eye', cicaplast: 'repair', avene: 'repair' };
// 已不在家(2026-08-06 实拍确认没了)的旧内置产品:从任何货架(含云端存档)过滤掉,别再种回来。≠ 用完了(GONE)
export const RETIRED = ['bioderma', 'retinol', 'agentholi', 'skinrocks'];
export const ROLE_LABEL = { cleanse: '洁面', precleanse: '卸妆', acid: '刷酸', mask: '面膜', retinol: '维 A', serum: '精华', oil: '面油', eye: '眼部', moist: '保湿', repair: '修护', spf: '防晒', soothe: '舒缓面膜' };
export const ROLE_ORDER = ['precleanse', 'cleanse', 'acid', 'mask', 'soothe', 'retinol', 'serum', 'oil', 'eye', 'moist', 'repair', 'spf'];
// 角色推断:名字 / 分类里看得出来的才认;**推不出来就返回 ''**,让她自己选
// (AUDIT-ux P0-7:旧版兜底成「保湿」,一支甘醇酸或阿达帕林就会被排进每晚全脸封层那一步)
export function inferRole(p) {
    const t = p.schedule && p.schedule.type;
    if (t === 'acid' || t === 'mask' || t === 'retinol') return t;
    const s = (p.cat || '') + ' ' + (p.name || '');
    if (/阿达帕林|adapalene|differin|视黄醇|视黄醛|retin|维\s*a\b|维A|a醇|tretinoin|granactive/i.test(s)) return 'retinol';
    if (/甘醇酸|乙醇酸|glycolic|水杨酸|salicylic|\bbha\b|\baha\b|\bpha\b|杏仁酸|mandelic|乳酸|lactic|果酸|葡糖酸内酯|gluconolactone|壬二酸|azelaic|去角质(?!面膜)|exfoliat|peel(?!.*mask)|刷酸/i.test(s)) return 'acid';
    if (/防晒|\bspf\b|sunscreen|sun\s?(cream|screen|control|block)|anthelios|uv/i.test(s)) return 'spf';
    if (/卸妆|cleansing\s?(balm|oil|water)|micellar|胶束|first ?cleanse|makeup remov/i.test(s)) return 'precleanse';
    if (/洁面|洗面|洁颜|cleanser|face\s?wash|foaming|泡沫/i.test(s)) return 'cleanse';
    if (/泥膜|面膜|\bmask\b|clay/i.test(s)) return 'mask';
    if (/眼霜|眼部|眼周|\beye\b/i.test(s)) return 'eye';
    if (/修护|修复|b5|cica|积雪草|panthenol|泛醇|baume|balm|屏障/i.test(s)) return 'repair';
    if (/精华油|面油|facial oil|\boil\b/i.test(s)) return 'oil';
    if (/精华|serum|安瓶|ampoule|essence/i.test(s)) return 'serum';
    if (/面霜|乳液|保湿|moistur|lotion|cream|fluide|gel-cream|emulsion/i.test(s)) return 'moist';
    return '';
}
export function assignRoles(list, gone) {
    const g = gone || [];
    list = list.filter(p => !RETIRED.includes(p.id) && g.indexOf(p.id) < 0);
    list.forEach(p => { if (!p.role) p.role = ROLE_MAP[p.id] || inferRole(p); });
    return list;
}
// 产品状态只保留两态:正常使用 / 备用。pending(待购入 / 用完了)整个退役 —— 家里没有的东西应该已经被删掉了
export function normalizeStatuses(list) {
    list.forEach(p => {
        if (!Array.isArray(p.statuses) || !p.statuses.length) p.statuses = ['owned', 'paused'];
        p.statuses = p.statuses.filter(x => x !== 'pending');
        if (!p.statuses.length) p.statuses = ['owned', 'paused'];
        p.labels = Object.assign({}, p.labels || {});
        p.pillCls = Object.assign({}, p.pillCls || {});
        p.statuses.forEach(x => {
            if (!p.labels[x]) p.labels[x] = (x === 'paused' ? '备用' : '正常使用');
            if (!p.pillCls[x]) p.pillCls[x] = (x === 'paused' ? 'paused' : 'active');
        });
        ['owned', 'active'].forEach(x => { if (p.labels[x] && p.labels[x] !== '备用') { p.labels[x] = '正常使用'; p.pillCls[x] = 'active'; } });
        delete p.labels.pending; delete p.pillCls.pending;
    });
    return list;
}
export function isSchedActive(prod, status) { return status !== 'paused' && status !== 'pending'; }
export function statusOf(p, ps) { return (ps && ps[p.id]) || p.statuses[0]; }
export function normalStatusOf(def) { return (def.statuses || []).find(x => x !== 'paused') || (def.statuses || ['owned'])[0]; }

// ── 成分特性:温不温和、闷不闷、能不能镇静。判断一套方案对当前皮肤起不起作用靠这个,不靠 role ──
// 产品自带的 p.traits(存在 sk_proddefs1、随云同步;认图读成分标 / 编辑时写进去)优先;
// TRAIT_MAP 只给 2026-08 那批**查过成分表**的老内置产品兜底(别照名字改);再没有就按名字 / 备注猜(最不可靠)。
export const TRAIT_MAP = {
    pc: ['gentle-exfo'], votary: ['gentle-exfo'], goodGenes: ['strong-exfo'], drorganic: ['scrub', 'strong-exfo'], clay: ['clay'],
    cicaplast: ['calm', 'occlusive'],                 // Baume B5:含乳木果油的封闭性膏体 —— 镇静有,但会闷
    sebagh: ['calm', 'oil-based', 'fragranced'],      // 纯油基 + 欧盟标注级香料过敏原 + 偏致粉刺 → 发炎 / 闷闭口时该停
    toleriane: ['light', 'calm'],                     // Neurosensine 镇静肽 → 它本身就是「轻薄的镇静」(标错会报假缺口)
    tolerianeSens: ['light', 'calm'],                 // 烟酰胺 + 甘油 → 同样是「轻薄的镇静」那一档
    lacura: ['gentle-clean'], lancome: ['strong-clean'], wildsource: ['oil-based'], sunscreen: ['light']
};
export const TRAIT_DEFS = [
    { k: 'gentle-exfo', l: '温和去角质' }, { k: 'strong-exfo', l: '猛酸、强去角质' }, { k: 'scrub', l: '磨砂颗粒' },
    { k: 'clay', l: '泥膜' }, { k: 'calm', l: '镇静' }, { k: 'light', l: '轻薄' }, { k: 'oil-based', l: '油基' },
    { k: 'fragranced', l: '含香精、精油' }, { k: 'occlusive', l: '封闭厚重' }, { k: 'gentle-clean', l: '温和清洁' }, { k: 'strong-clean', l: '强清洁' }
];
export const TRAIT_KEYS = TRAIT_DEFS.map(t => t.k);
export function cleanTraits(list) { return (Array.isArray(list) ? list : []).map(x => String(x || '').trim()).filter((x, i, a) => TRAIT_KEYS.indexOf(x) >= 0 && a.indexOf(x) === i); }
export function traitsOf(p) {
    if (!p) return [];
    if (Array.isArray(p.traits) && p.traits.length) return p.traits;
    if (TRAIT_MAP[p.id]) return TRAIT_MAP[p.id];
    const s = (p.name || '') + (p.cat || '') + ((p.notes || []).join(''));
    const t = [];
    if (/磨砂|scrub|颗粒|polish/i.test(s)) { t.push('scrub', 'strong-exfo'); }
    else if (/甘醇酸|glycolic|视黄醇|retinol|高浓度|果酸换肤/i.test(s)) t.push('strong-exfo');
    else if (/杏仁酸|乳酸|mandelic|lactic|PHA|葡糖酸|水杨酸|salicylic|果酸|AHA|BHA/i.test(s)) t.push('gentle-exfo');
    if (/积雪草|cica|泛醇|panthenol|B5|舒缓|calm|soothe|尿囊素|allantoin|神经酰胺|ceramide|抗敏|烟酰胺|niacinamide/i.test(s)) t.push('calm');
    if (/膏|baume|balm|凡士林|petrolatum|乳木果|shea|厚重|rich|封闭/i.test(s)) t.push('occlusive');
    if (/精油|essential oil|玫瑰|香氛|香精|parfum|fragrance/i.test(s)) t.push('fragranced');
    if (/面油|精华油|\boil\b/i.test(s)) t.push('oil-based');
    if (/无油|oil.?free|轻薄|清爽|light|gel|啫喱|lotion|乳液/i.test(s)) t.push('light');
    return t;
}
export function hasTrait(p, t) { return traitsOf(p).indexOf(t) >= 0; }

// ── 能力模型:一件产品「能顶什么用」,不是「属于哪一类」(Cici:「修护只剩一件,但修护也能被别的顶替」)──
export const ROLE_CAPS = {
    precleanse: ['clean'], cleanse: ['clean'], acid: ['exfoliate'], mask: ['exfoliate'], retinol: ['exfoliate'],
    serum: ['hydrate'], moist: ['hydrate'], oil: ['hydrate'], soothe: ['hydrate', 'calm'], repair: ['hydrate', 'calm'], eye: ['eye'], spf: ['spf']
};
export const ESSENTIAL_CAPS = ['clean', 'hydrate'];
export function capsOf(p) { return (p && ROLE_CAPS[p.role]) || []; }
// ROLE_GROUPS 只用于产品页的显示分组和「同组」加分;替代判断一律走能力模型
export const ROLE_GROUPS = [
    { key: 'precleanse', name: '卸妆', roles: ['precleanse'] }, { key: 'cleanse', name: '洁面', roles: ['cleanse'] },
    { key: 'exfoliate', name: '去角质（酸类 / 面膜）', roles: ['acid', 'mask'] }, { key: 'retinol', name: '视黄醇', roles: ['retinol'] },
    { key: 'hydrate', name: '保湿 / 精华 / 舒缓', roles: ['moist', 'serum', 'soothe'] }, { key: 'oil', name: '面油', roles: ['oil'] },
    { key: 'eye', name: '眼部', roles: ['eye'] }, { key: 'repair', name: '修护', roles: ['repair'] }, { key: 'spf', name: '防晒', roles: ['spf'] }
];
export function groupOfRole(role) { return ROLE_GROUPS.find(g => g.roles.includes(role)) || null; }
// 洁面强度:产品可显式标 cleanseStrength,否则按名称 / 分类推断
export function cleanseStrength(p) {
    if (p && p.cleanseStrength) return p.cleanseStrength;
    const s = ((p && p.cat) || '') + ((p && p.name) || '') + (((p && p.notes) || []).join(''));
    if (/泡沫|洁颜蜜|深层|净化|清爽|控油|foam|purify|deep|clarif/i.test(s)) return 'strong';
    if (/温和|无皂|氨基酸|敏感|gentle|mild|soap.?free|sensitive/i.test(s)) return 'gentle';
    return 'normal';
}
// 数据层的刮胡过滤:产品 notes / 分类里写着「刮胡后…」这类文字,不刮胡的用户看不到(CSS 门控管不到)
export function visNotes(p, profile) { const n = (p && p.notes) || []; return profile && profile.shaving ? n : n.filter(x => !/刮胡/.test(x)); }
export function visCat(p, profile) { const c = (p && p.cat) || ''; return profile && profile.shaving ? c : c.replace(/\s*[·・]\s*刮胡后\s*/, ' · 舒缓').replace(/刮胡/g, '').trim(); }

// ══ 货架(读写,第一个参数 store)══════════════════════════════════════════════════════════
// 新账号从**空货架**起步。DEFAULT_PD 只是两个老账号的种子:按档案 seedShelf 判断,没标过的看「有没有老数据」
export function shelfSeeded(store) {
    const pr = store.lg(K.profile) || {};
    if (pr.seedShelf === true) return true;
    if (pr.seedShelf === false) return false;
    return !!(pr.onboarded || pr.autoMatched || (store.lg(K.jrnl) || []).length || store.lg(K.prodDefs) || store.lg(K.prods));
}
// 【注意】存过 sk_proddefs1 的账号走存档分支,只补**新的内置产品**、从不更新老产品的定义 —— 光改 DEFAULT_PD 对她无效
export function loadPD(store) {
    const saved = store.lg(K.prodDefs), seeded = shelfSeeded(store), gone = store.lg(K.gone) || [];
    if (saved) {
        saved.forEach(p => {
            if (!p.schedule) p.schedule = { type: 'none', maxPerWeek: 0, minDaysBetween: 0, preferShowerNight: false, avoidShaveDay: false, avoidAcid: false, avoidRetinol: false, enableAutoSchedule: false };
            if (!p.schedule.time) p.schedule.time = p.id === 'sunscreen' ? ['am'] : (['sebagh', 'mzskin', 'bioderma'].includes(p.id) ? ['am', 'pm'] : ['pm']);
            if (typeof p.paoMonths === 'undefined') p.paoMonths = 0;
        });
        if (seeded) DEFAULT_PD.filter(d => d.builtin).forEach(def => { if (!saved.find(s => s.id === def.id)) saved.push(JSON.parse(JSON.stringify(def))); });
        return assignRoles(normalizeStatuses(saved), gone);
    }
    return seeded ? assignRoles(normalizeStatuses(JSON.parse(JSON.stringify(DEFAULT_PD))), gone) : [];
}
// 货架迁移:家里实际有什么,要落到**每个账号**的货架上;标记 sk_mig1 进 CLOUD_KEYS(只记本机会被云端旧货架盖回来)
export const SHELF_MIGRATIONS = [
    { id: 'avene-remove-2026-08-26', type: 'remove', prod: 'avene', date: '2026-08-26' },
    { id: 'all-normal-2026-08-26', type: 'all-normal' },
    { id: 'tolerianeSens-open-2026-08-29', type: 'open-date', prod: 'tolerianeSens', date: '2026-08-29' }
];
export function prodUsageCount(journal, def) { const key = def.journalTag || def.name; return (journal || []).filter(e => (e.products || []).includes(key)).length; }
export function weeksOpen(popen, id, nowMs) { if (!popen || !popen[id]) return null; return Math.floor(Math.floor(((nowMs || Date.now()) - new Date(popen[id])) / 86400000) / 7); }
// 都是 'system' 写盘(每次加载都会跑;跑过就不再管,之后手动改回来的不会被推翻)
export function applyShelfMigrations(store, today) {
    if (!shelfSeeded(store)) return false;
    const done = store.lg(K.mig) || [];
    let PD = loadPD(store);
    const PS = store.lg(K.prods) || {}, GONE = store.lg(K.gone) || [];
    let changed = false, marked = false, goneChanged = false;
    SHELF_MIGRATIONS.forEach(m => {
        if (done.includes(m.id)) return;
        if (m.type === 'remove') {
            if (GONE.indexOf(m.prod) < 0) {
                const def = PD.find(p => p.id === m.prod);
                const em = store.lg(K.empty) || {};
                if (def && !((em[m.prod] || []).length)) {
                    (em[m.prod] = em[m.prod] || []).push({ date: m.date || today, weeks: weeksOpen(store.lg(K.popen) || {}, m.prod), uses: prodUsageCount(store.lg(K.jrnl), def), name: def.name });
                    store.ls(K.empty, em, 'system');
                }
                GONE.push(m.prod); goneChanged = true;
                PD = PD.filter(p => p.id !== m.prod);
                if (PS[m.prod]) { delete PS[m.prod]; changed = true; }
            }
        } else if (m.type === 'open-date') {
            const op = store.lg(K.popen) || {};
            if (!op[m.prod] && PD.find(x => x.id === m.prod)) { op[m.prod] = m.date || today; store.ls(K.popen, op, 'system'); }
        } else if (m.type === 'all-normal') {
            PD.forEach(p => { const want = normalStatusOf(p); if ((PS[p.id] || p.statuses[0]) !== want) { PS[p.id] = want; changed = true; } });
        }
        done.push(m.id); marked = true;
    });
    if (goneChanged) store.ls(K.gone, GONE, 'system');
    if (changed) store.ls(K.prods, PS, 'system');
    if (marked) store.ls(K.mig, done, 'system');
    return changed || goneChanged;
}
// 云端同步来的旧货架可能还带着已退役的 pending 状态 —— 迁移只跑一次,所以这一步必须常驻
export function sanitizePS(store) {
    const PD = loadPD(store), PS = store.lg(K.prods) || {}, GONE = store.lg(K.gone) || [];
    let changed = false;
    Object.keys(PS).forEach(id => {
        const def = PD.find(p => p.id === id);
        if (!def) { if (GONE.indexOf(id) >= 0) { delete PS[id]; changed = true; } return; }
        if ((def.statuses || []).indexOf(PS[id]) < 0) { PS[id] = normalStatusOf(def); changed = true; }
    });
    if (changed) store.ls(K.prods, PS, 'system');
    return changed;
}
// 用完了 = ①记一笔空瓶 ②从货架删掉(不再出现在产品 / 待买清单)③调用方接着重出一版方案(Cait 2026-08-26)
export function markRunOut(store, id, today) {
    const PD = loadPD(store), def = PD.find(d => d.id === id); if (!def) return null;
    const popen = store.lg(K.popen) || {}, em = store.lg(K.empty) || {};
    const rec = { date: today, weeks: weeksOpen(popen, id, store.now()), uses: prodUsageCount(store.lg(K.jrnl), def), name: def.name };
    (em[id] = em[id] || []).push(rec);
    store.ls(K.empty, em);
    const low = store.lg(K.low) || []; if (low.indexOf(id) >= 0) store.ls(K.low, low.filter(x => x !== id));
    const gone = store.lg(K.gone) || []; if (gone.indexOf(id) < 0) store.ls(K.gone, gone.concat([id]));
    const PS = store.lg(K.prods) || {}; if (id in PS) { delete PS[id]; store.ls(K.prods, PS); }
    if (id in popen) { delete popen[id]; store.ls(K.popen, popen); }
    return rec;
}
// 买回来了 = 从「已删掉」里恢复:回到货架、正常使用、开封日记今天
export function unGone(store, id, today) {
    const gone = store.lg(K.gone) || []; if (gone.indexOf(id) < 0) return null;
    store.ls(K.gone, gone.filter(x => x !== id));
    const def = loadPD(store).find(p => p.id === id);
    if (def) { const PS = store.lg(K.prods) || {}; PS[id] = normalStatusOf(def); store.ls(K.prods, PS); }
    const popen = store.lg(K.popen) || {}; if (!popen[id]) { popen[id] = today; store.ls(K.popen, popen); }
    return def || null;
}
// 「快用完了」:东西还在、照常排,只是提前告诉 App 它见底了(**不是** 8/26 废除的 pending)
export function toggleLow(store, id) {
    const low = store.lg(K.low) || [];
    const on = low.indexOf(id) < 0;
    store.ls(K.low, on ? low.concat([id]) : low.filter(x => x !== id));
    return on;
}
export function emptyLogRows(empties, products) {
    const rows = [];
    Object.entries(empties || {}).forEach(([id, list]) => {
        const d = (products || []).find(x => x.id === id) || DEFAULT_PD.find(x => x.id === id);
        (list || []).forEach(r => rows.push(Object.assign({ id, name: d ? d.name : id }, r)));
    });
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}
