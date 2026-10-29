// ══ 每人档案 sk_profile1 ═══════════════════════════════════════════════════════════════════
// 双人差异全靠它(不写死任何人的情况):
//   shaving / hrt / minimalMode / hideRecords / skinType / baseTraits / concerns / goal / zones / excluded /
//   acidTiming / repairUse / acidLevel / acidLevelAt / useMakeupRemoval / showerDays(镜像,见 model/week.js) /
//   medical {state:'booked'|'seen'|'later', at, date?, seenAt?, note?, until?} / oobe / oobeAt / tourIA / stamp / firstSeen / autoMatched /
//   startState('ok'|'irritated'|'care',引导里的起点)/ careAt(v2 引导或设置里打开「在看医生 / 用药」那天;有它安全闸才只排基础几样)
// 纯函数直接用;要读写存储的函数第一个参数传 store(这个模块不 import store,也没有全局状态)。
import { K } from '../store.js';
import { isOwnerEmail } from '../sync.js';

export const DEFAULT_PROFILE = { shaving: false, hrt: false, skinType: '', name: '', onboarded: false, phase: 'repair', phaseStart: '' };

// 关注区域(分区护理)的预设。区名和脸部地图 / 顾问的 zonesAdd 对得上
export const ZONE_PRESETS = [
    { name: '人中/鼻下', avoid: ['acid', 'mask', 'retinol'], care: '只温和清洁 + 修护霜点涂' },
    { name: '眼周', avoid: ['acid', 'mask', 'retinol'], care: '只用眼部产品' },
    { name: '两颊', avoid: ['acid', 'mask'], care: '干、易泛红时避开刷酸' },
    { name: '下巴', avoid: ['mask'], care: '易闭口，避免厚重封闭' },
    { name: '发际线', avoid: ['mask'], care: '易长闭口，冲洗要彻底' },
    { name: '口周', avoid: ['acid', 'mask', 'retinol'], care: '反复泛红、小红疹时只温和清洁 + 保湿，酸、面膜、维 A 都避开' },
    { name: '下颌线', avoid: ['mask'], care: '易冒痘，避开面膜和厚重封闭的产品' }
];
// 阶段只是**标签**(给人看 / 给顾问看),不再卡任何东西(B1.5:旧 PHASES 和被污染的屏障分一起把人锁在「修护期」半年)
export const PHASES = {
    repair: { name: '先修护', desc: '在发炎：先做减法，猛料全停' },
    tolerance: { name: '慢慢加酸', desc: '温和酸一档档往上加，盯反应' },
    maintenance: { name: '保持节奏', desc: '节奏稳了，保持' }
};
export const CONCERN_ADVICE = {
    '闭口/粉刺': '闭口靠「温和疏通 + 别搓脸」：温和酸按节奏一档档往上加，磨砂和厚重面霜先放一边。',
    '毛孔粗大': '毛孔改善慢，重点是清洁到位 + 控油 + 长期防晒，别指望短期见效。',
    '出油/T区': 'T区出油：清洁别过度（越剥越油），保湿选无油质地，防晒也挑清爽的。',
    '泛红/敏感': '泛红期做减法：停掉多余活性物，只留清洁 + 保湿 + 修护，等稳定再加回来。',
    '干燥/紧绷': '干燥优先补水锁水，刷酸别加频，洗脸水温别高。',
    '痘痘/炎症': '有炎症时别叠猛料；成片或久不消要考虑就医，不是靠加产品解决。',
    '暗沉/痘印': '痘印主要靠防晒 + 时间，防晒不到位再多美白也白搭。'
};
export const CONCERN_AXIS = { '闭口/粉刺': 'congestion', '毛孔粗大': 'congestion', '出油/T区': 'oil', '泛红/敏感': 'barrier', '干燥/紧绷': 'barrier', '痘痘/炎症': 'calm', '暗沉/痘印': 'calm' };

export function loadProfile(store) { return store.lg(K.profile) || Object.assign({}, DEFAULT_PROFILE); }
export function saveProfile(store, profile, origin) { return store.ls(K.profile, profile, origin || 'user'); }
// 改档案的唯一写法:读 → 改 → 写回(别拿内存里的旧档案盖掉刚同步来的)
export function updateProfile(store, fn, origin) {
    const p = loadProfile(store);
    fn(p);
    return saveProfile(store, p, origin) ? p : null;
}

// 只有「本机原主的历史数据」才继承旧设定,且一台设备只认一次(旧版靠 hasData 猜身份,Cici 在这台机器上打开会被误判成原主)
export function seedProfile(store) {
    if (store.lg(K.profile)) return false;
    const OWNER = '__profile_owner_seeded__';
    const first = !store.getLocal(OWNER);
    const hasData = !!(((store.lg(K.jrnl) || []).length) || store.lg(K.prods) || store.lg(K.wk));
    const inherit = first && hasData;
    store.setLocal(OWNER, '1');
    return store.ls(K.profile, inherit
        ? { shaving: true, hrt: false, skinType: '混油皮 · 屏障修护', name: '', onboarded: true, phase: 'maintenance', phaseStart: '2026-01-01' }
        : Object.assign({}, DEFAULT_PROFILE), 'system');
}

// 按账号自动定默认配置,只对主账号生效(完整模式 + 刮胡)。其他新账号在引导里自己选「怎么用」(AUDIT-ux P0-1)。
// 只在该账号**第一次**登录时套用一次,之后手动改的设置永不覆盖。在云端快照回来之后才跑(sync.js),写盘算 'system'。
export function autoMatchProfile(store, uid, user) {
    const p = loadProfile(store);   // 云端档案可能刚落到本机,先读它
    if (!uid || p.autoMatched === uid) return false;
    if (!isOwnerEmail(user && user.email)) return false;
    Object.assign(p, { minimalMode: false, showJournal: true, shaving: true, hrt: false, seedShelf: true, autoMatched: uid });
    return !!saveProfile(store, p, 'system');
}

// 就医提醒的随访状态:已约了 / 看过了(只数这天以后的,见 engine/redline.js)/ 先不(一周后再问)
export function setMedical(store, state, extra, today) {
    return updateProfile(store, p => { p.medical = Object.assign({ state, at: today }, state === 'seen' ? { seenAt: today } : {}, extra || {}); });
}
// 撤销「看过了」:放回改之前那一份(没有就删掉 medical 字段)
export function restoreMedical(store, prev) {
    return updateProfile(store, p => { if (prev && typeof prev === 'object') p.medical = JSON.parse(JSON.stringify(prev)); else delete p.medical; });
}
export function userZones(profile) { return ((profile && profile.zones) || []).filter(z => z && z.name); }
