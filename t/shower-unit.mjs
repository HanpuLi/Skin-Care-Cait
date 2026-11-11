// 洗澡「隔 x 天」的不开浏览器单测(model/week.js + engine/schedule.js 的 tonight() + ui/shower.js 的纯 HTML 部分)。
// 造一份假 localStorage → createStore,直接调模型函数。数据全是虚构的。
//   跑:  node t/shower-unit.mjs
import path from 'node:path';
import { createStore, K } from '../js/store.js';
import { addDays, isoWeek } from '../js/clock.js';
import { buildWorld } from '../js/model/world.js';
import { tonight } from '../js/engine/schedule.js';
import { dayState, showerDay, showerInfo, showerEvery, setShowerMark, setShowerEvery, migrateShowerInterval, everyFromWeekly,
         toggleTn, initTN, getDayState, setDayState } from '../js/model/week.js';
import { showerState, showerCardHtml, calendarDays, everyText } from '../js/ui/shower.js';

const T = '2026-11-10';   // 周二
const d = i => addDays(T, i);
const MIG = ['avene-remove-2026-08-26', 'all-normal-2026-08-26', 'tolerianeSens-open-2026-08-29'];
// 每周习惯:dows 里的那几天洗澡,shaveDows 里的刮胡
const preset = (dows, shaveDows) => [1, 2, 3, 4, 5, 6, 0].map(x => ({ dow: x, shower: dows.indexOf(x) >= 0, shave: (shaveDows || []).indexOf(x) >= 0 }));

function mkStore(seed) {
    const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    const LS = { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    return createStore({ localStorage: LS }).open();
}
function seed(profile, extra) {
    return mkStore(Object.assign({ sk_profile1: Object.assign({ shaving: false, minimalMode: true, onboarded: true, autoMatched: 'cici' }, profile || {}),
        sk_jrnl1: [], sk_mig1: MIG, sk_prods1: { goodGenes: 'active', drorganic: 'owned' } }, extra || {}));
}
// 记下每次写盘的 origin(迁移必须是 'system')
function spy(s) {
    const calls = [];
    return { calls, store: Object.assign({}, s, { lg: k => s.lg(k), ls: (k, v, o) => { calls.push({ k, o: o || 'user' }); return s.ls(k, v, o); } }) };
}
const W = s => buildWorld(s, { today: T });
const ons = (w, from, n) => Array.from({ length: n }, (_, i) => dayState(w, d(from + i)).shower ? 1 : 0).join('');

export async function runShowerUnit(S) {
    const t = (name, f) => { try { f(); } catch (e) { S.ok(false, name + ':抛异常 ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); } };

    t('间隔模拟', () => {
        // 没有老数据:since 那天就该洗,之后每 2 天一次
        const w = W(seed({ showerEvery: 2, showerSince: T }));
        S.ok(ons(w, 0, 7) === '1010101', '隔 1 天、之前没洗过:今晚洗,之后隔一天一次', ons(w, 0, 7));
        S.ok(showerEvery(w.profile) === 2 && showerEvery({ showerEvery: 9 }) === 0 && showerEvery({ showerEvery: 1.5 }) === 0 && showerEvery({}) === 0, 'showerEvery:1..7 的整数才算,其余 = 还没排');
        // L 从 since 之前的老数据里找:昨天(周一)按习惯洗过 → 今晚不用,明晚洗
        const w2 = W(seed({ showerEvery: 2, showerSince: T }, { sk_preset1: preset([1]) }));
        S.ok(ons(w2, 0, 5) === '01010', '老习惯里昨晚洗过:今晚不用洗,明晚洗', ons(w2, 0, 5));
        // 每天 / 隔 2 天
        S.ok(ons(W(seed({ showerEvery: 1, showerSince: T })), 0, 5) === '11111', '每天');
        S.ok(ons(W(seed({ showerEvery: 3, showerSince: T })), 0, 7) === '1001001', '隔 2 天');
        // since 之前的日子照旧走老数据(历史不变)
        const w3 = W(seed({ showerEvery: 1, showerSince: T }, { sk_preset1: preset([0, 3]) }));
        S.ok(ons(w3, -7, 7) === [-7, -6, -5, -4, -3, -2, -1].map(i => [0, 3].indexOf(new Date(d(i) + 'T12:00:00').getDay()) >= 0 ? 1 : 0).join(''), 'since 之前按老的每周习惯算', ons(w3, -7, 7));
        // 确定性:同一份数据,先问远的再问近的、换一个 w 对象,结果一样
        const s4 = seed({ showerEvery: 3, showerSince: d(-40), showerMarks: { [d(-20)]: true, [d(-5)]: false } });
        const a = W(s4), far = dayState(a, d(10)).shower, b = W(s4);
        const seq = Array.from({ length: 51 }, (_, i) => dayState(b, d(-40 + i)).shower);
        S.ok(far === seq[50] && seq.every((v, i) => v === dayState(W(s4), d(-40 + i)).shower), '纯函数:问的顺序、缓存不影响结果');
        // 不会出现连着两天都按间隔洗(隔 1 天以上时)
        const run = seq.map(v => v ? 1 : 0).join('');
        S.ok(!/11/.test(run.replace(/./g, (c, i) => i === 20 ? 'x' : c)), '按间隔排的不会连着两天洗(记录那天除外)', run);
    });

    t('记录覆盖', () => {
        // 今晚该洗点了不洗 → 明晚变成该洗
        const s = seed({ showerEvery: 2, showerSince: T });
        S.ok(setShowerMark(s, T, false, T), '记今晚不洗:写盘成功');
        let w = W(s);
        S.ok(ons(w, 0, 5) === '01010', '今晚不洗 → 明晚洗,之后照隔 1 天', ons(w, 0, 5));
        const x = showerDay(w, T);
        S.ok(x.on === false && x.due === true && x.mark === false, 'showerDay:on / due / mark 分得开(due 是不算这天记录时排的)', x);
        S.ok(showerState(w).st === 'skip', '今晚页模块:skip 状态', showerState(w).st);
        // 撤回
        setShowerMark(s, T, null, T); w = W(s);
        S.ok(ons(w, 0, 5) === '10101' && !(w.profile.showerMarks && T in w.profile.showerMarks), '撤回 = 删掉那条记录,回到按间隔排的');
        // 没排但临时洗了 → 间隔从今天重新算
        const s2 = seed({ showerEvery: 3, showerSince: d(-1) });   // 昨天洗,今天、明天不用
        S.ok(ons(W(s2), -1, 5) === '10010', '前提:昨晚洗、隔 2 天', ons(W(s2), -1, 5));
        setShowerMark(s2, T, true, T);
        const w2 = W(s2);
        S.ok(ons(w2, -1, 6) === '110010' && showerState(w2).st === 'extra', '今晚临时洗 → 下次从今晚起再隔 2 天;模块是 extra 状态', ons(w2, -1, 6));
        // 过去的记录(洗澡页日历点过去的格子)也会挪动之后的节奏
        const s3 = seed({ showerEvery: 2, showerSince: d(-6) });
        const before = ons(W(s3), -6, 10);
        setShowerMark(s3, d(-2), false, T);
        S.ok(before === '1010101010' && ons(W(s3), -6, 10) === '1010010101', '记「那天没洗」:之后的节奏往后挪一天', [before, ons(W(s3), -6, 10)]);
        // 没排间隔的人也能记(老数据 + 记录)
        const s4 = seed({}, { sk_preset1: preset([2]) });
        S.ok(dayState(W(s4), T).shower === true, '前提:没排间隔,按老习惯周二洗');
        setShowerMark(s4, T, false, T);
        S.ok(dayState(W(s4), T).shower === false && dayState(W(s4), d(7)).shower === true, '没排间隔时记录照样认,别的日子照旧按老数据');
        // 90 天前的记录修剪掉
        const s5 = seed({ showerEvery: 2, showerSince: d(-10), showerMarks: { [d(-120)]: true, [d(-91)]: false, [d(-5)]: true, bad: true } });
        setShowerMark(s5, d(1), false, T);
        const mk = s5.lg(K.profile).showerMarks;
        S.ok(!(d(-120) in mk) && !(d(-91) in mk) && !('bad' in mk) && mk[d(-5)] === true && mk[d(1)] === false, '写的时候只留近 90 天的记录(坏键也清掉)', mk);
    });

    t('改间隔冻结历史', () => {
        const s = seed({ showerEvery: 2, showerSince: d(-20) });
        const w0 = W(s), past = ons(w0, -20, 20);
        S.ok(setShowerEvery(s, 3, T), '改成隔 2 天:写盘成功');
        const P = s.lg(K.profile), w = W(s);
        S.ok(P.showerEvery === 3 && P.showerSince === T, 'since = 今天,every = 新值', P);
        S.ok(ons(w, -20, 20) === past, '过去 20 天的结果一天不变', [past, ons(w, -20, 20)]);
        S.ok(Object.keys(P.showerHist || {}).length === 20 && !(T in P.showerHist) && !P.showerMarks, '冻结的是 [since, 昨天](不含今天),写进 showerHist、不冒充她记的', Object.keys(P.showerHist || {}));
        S.ok(Array.from({ length: 20 }, (_, i) => showerDay(w, d(-20 + i))).every(x => x.mark === undefined && x.on === x.due), '冻结的日子:没有「改过的」(on = due、mark 没有)');
        // 再改一次:冻结范围最多到 30 天前
        const s2 = seed({ showerEvery: 2, showerSince: d(-50) });
        const p2 = ons(W(s2), -30, 30);
        setShowerEvery(s2, 1, T);
        const P2 = s2.lg(K.profile);
        S.ok(ons(W(s2), -30, 30) === p2 && !(d(-31) in (P2.showerHist || {})) && (d(-30) in P2.showerHist), '冻结 [max(since, 今天 - 30), 昨天]', Object.keys(P2.showerHist || {}).length);
        // 她记过的一天:改间隔以后那天照样是「改过的」(mark 留着、due 冻结成当时排的)
        const s5 = seed({ showerEvery: 2, showerSince: d(-10), showerMarks: { [d(-4)]: false } });
        const x0 = showerDay(W(s5), d(-4));
        setShowerEvery(s5, 4, T);
        const x1 = showerDay(W(s5), d(-4));
        S.ok(x0.due === true && x0.on === false && x1.on === false && x1.due === true && x1.mark === false, '记过「没洗」的那天:改间隔后照样是没洗、照样标改过的', { x0, x1 });
        // 同一个值:不动
        const s3 = seed({ showerEvery: 2, showerSince: d(1) });
        setShowerEvery(s3, 2, T);
        S.ok(s3.lg(K.profile).showerSince === d(1), '点同一个值:since 不动');
        // since 很久以前:写入时收拾,since 挪到今天,今天往后结果不变
        const s4 = seed({ showerEvery: 3, showerSince: d(-200) });
        const fut = ons(W(s4), -20, 40);
        setShowerMark(s4, d(5), true, T);   // 随便一个写
        const P4 = s4.lg(K.profile);
        const fut2 = ons(W(s4), -20, 40);
        // 记的那天(d(5) 临时洗)之后节奏本来就会重算,只比它之前的 25 天
        S.ok(P4.showerSince === T && fut2.slice(0, 25) === fut.slice(0, 25) && Object.keys(P4.showerHist).length === 30 && Object.keys(P4.showerMarks).length === 1, 'since 早于 60 天前:近 30 天冻结进 showerHist、since 挪到今天,之前的结果一天不变', [fut, fut2]);
        // 非法值
        S.ok(setShowerEvery(s, 0, T) === false && setShowerEvery(s, 8, T) === false, '0 / 8 不收');
    });

    t('迁移', () => {
        // 每周 3 天 → 每 2 天一次(round(7/3)=2),since = 明天,'system' 写盘、不算改动(不推送)
        const s = seed({ showerDays: [1, 3, 5] }, { sk_preset1: preset([1, 3, 5]) });
        const sp = spy(s);
        const todayBefore = dayState(W(s), T).shower;
        S.ok(migrateShowerInterval(sp.store, T) === true, '老习惯每周 3 天:迁移写了一次');
        const P = s.lg(K.profile);
        S.ok(P.showerEvery === 2 && P.showerSince === d(1), 'every = round(7/3) = 2,since = 明天', P);
        S.ok(sp.calls.length === 1 && sp.calls.every(c => c.o === 'system'), '只写一次,origin = system', sp.calls);
        S.ok(!s.hasPending(), '迁移不算一次改动(不推送,不引出对推)');
        S.ok(dayState(W(s), T).shower === todayBefore, '今天照旧按老数据(保住今天手动改过的)');
        // 幂等:第二次不写
        const sp2 = spy(s);
        S.ok(migrateShowerInterval(sp2.store, T) === false && !sp2.calls.length, '第二次:什么都不写');
        S.ok(migrateShowerInterval(sp2.store, d(3)) === false && s.lg(K.profile).showerSince === d(1), '过几天再跑也不动(showerEvery 有了就不再跑)');
        // 一周 0 天:不设,也不写
        const s0 = seed({}, { sk_preset1: preset([]) }), sp0 = spy(s0);
        S.ok(migrateShowerInterval(sp0.store, T) === false && !sp0.calls.length && s0.lg(K.profile).showerEvery === undefined, '一周 0 天:不设(显示还没排),不写盘');
        S.ok(showerState(W(s0)).st === 'none', '今晚页模块:还没排');
        // 只有 profile.showerDays(没有 sk_preset1)也认
        const s1 = seed({ showerDays: [0, 1, 2, 3, 4, 5, 6] });
        migrateShowerInterval(s1, T);
        S.ok(s1.lg(K.profile).showerEvery === 1, '只有 showerDays:每周 7 天 → 每天', s1.lg(K.profile));
        S.ok(everyFromWeekly(1) === 7 && everyFromWeekly(2) === 4 && everyFromWeekly(4) === 2 && everyFromWeekly(0) === 0, '换算:1 天→7、2 天→4、4 天→2、0 天→不排');
        // 已经设了(哪怕是别的设备推来的)不覆盖
        const s2 = seed({ showerEvery: 5, showerSince: d(-3) }, { sk_preset1: preset([1, 2, 3, 4, 5, 6, 0]) });
        S.ok(migrateShowerInterval(s2, T) === false && s2.lg(K.profile).showerEvery === 5, '已经有 showerEvery:不覆盖');
        // 推上云之前,每份云端快照都把 profile 盖回没迁移的那份、渲染时再迁一次:since 不能跟着 today 天天往后挪
        const sc = seed({ showerDays: [1, 4] }, { sk_preset1: preset([1, 4]) });
        const raw = JSON.parse(JSON.stringify(sc.lg(K.profile)));
        migrateShowerInterval(sc, T);
        const since0 = sc.lg(K.profile).showerSince, seen = [since0];
        for (let i = 1; i <= 3; i++) { sc.ls(K.profile, JSON.parse(JSON.stringify(raw)), 'system'); migrateShowerInterval(sc, d(i)); seen.push(sc.lg(K.profile).showerSince); }
        S.ok(since0 === d(1) && seen.every(x => x === since0), '云端快照盖回后重迁:since 沿用第一次那天(按账号记在本机),不天天往后挪', seen);
        S.ok(sc.lg(K.profile).showerFrom === 2, '记下折算前每周几次(洗澡页说「按以前每周 2 次折算的」)', sc.lg(K.profile));
        setShowerEvery(sc, 3, d(3));
        S.ok(sc.lg(K.profile).showerFrom === undefined, '她自己改了间隔:不再说是折算的');
        // 习惯一天都没有、但 sk_wk1 某周按天点过洗澡:按那几周的密度换算,不然模块说「还没排」、今晚却还照 sk_wk1 排着洗澡
        const wkOnly = { [isoWeek(T)]: { shower: [false, true, false, false, true, false, false], shave: Array(7).fill(false) } };
        const sw = seed({}, { sk_preset1: preset([]), sk_wk1: wkOnly });
        S.ok(migrateShowerInterval(sw, T) === true && sw.lg(K.profile).showerEvery === 4 && sw.lg(K.profile).showerSince === d(1), '习惯 0 天、这周点过 2 天:按每周 2 次换算成每 4 天', sw.lg(K.profile));
        S.ok(showerState(W(sw)).st !== 'none', '模块不再说「还没排」');
    });

    t('刮胡不受影响', () => {
        const pre = preset([1, 3], [1, 4]);
        const s = seed({ shaving: true, minimalMode: false }, { sk_preset1: pre });
        const shaveBefore = Array.from({ length: 14 }, (_, i) => dayState(W(s), d(i - 7)).shave);
        setShowerEvery(s, 2, T);
        setShowerMark(s, d(2), false, T);
        const shaveAfter = Array.from({ length: 14 }, (_, i) => dayState(W(s), d(i - 7)).shave);
        S.ok(JSON.stringify(shaveBefore) === JSON.stringify(shaveAfter), '改洗澡间隔 / 记录:刮胡日一天不变', [shaveBefore, shaveAfter]);
        // 刮胡开关照旧回写排班
        const day = d(2), was = getDayState(s, day).shave;
        setDayState(s, day, getDayState(s, day).shower, !was, T);
        S.ok(getDayState(s, day).shave === !was && dayState(W(s), day).shower === showerDay(W(s), day).on, '改某天刮胡:刮胡变了,洗澡还是按间隔');
        const tn = toggleTn(s, 'shave', true, T);
        S.ok(tn.shave === true && tonight(W(s)).shave === true, '今晚刮胡:tn 和 tonight() 都认');
        S.ok(tonight(W(seed({ shaving: false }, { sk_preset1: pre }))).shave === false, '没开刮胡的人:tonight().shave 永远 false');
    });

    t('今晚 sk_tn1 同步', () => {
        const s = seed({ showerEvery: 2, showerSince: T });
        initTN(s, T);
        S.ok(s.lg(K.tn).shower === true && tonight(W(s)).shower === true, '前提:今晚该洗,tn 和 tonight() 都是洗');
        setShowerMark(s, T, false, T);
        S.ok(s.lg(K.tn).shower === false && tonight(W(s)).shower === false, '点「今晚不洗」:tn 跟着写成不洗,tonight() 也不洗');
        // 改间隔影响今天:tn 跟上
        setShowerMark(s, T, null, T);
        S.ok(s.lg(K.tn).shower === true, '撤回:tn 回到洗');
        const s2 = seed({ showerEvery: 1, showerSince: d(-3) });
        initTN(s2, T);
        setShowerEvery(s2, 3, T);   // 昨晚洗过、隔 2 天 → 今晚不洗
        S.ok(s2.lg(K.tn).shower === false && tonight(W(s2)).shower === false, '改间隔让今晚变成不洗:tn 跟着改', s2.lg(K.tn));
        // 改过去的记录也会挪动今晚
        setShowerMark(s2, d(-1), false, T);
        S.ok(s2.lg(K.tn).shower === tonight(W(s2)).shower, '改昨晚的记录:今晚的 tn 和排班一致', [s2.lg(K.tn), tonight(W(s2)).shower]);
        // 间隔模式下今晚开关走记录(给还在调 toggleTn('shower') 的旧入口)
        const s3 = seed({ showerEvery: 2, showerSince: T });
        toggleTn(s3, 'shower', false, T);
        S.ok(s3.lg(K.profile).showerMarks[T] === false && s3.lg(K.tn).shower === false, '间隔模式下 toggleTn(shower) 写的是记录');
        toggleTn(s3, 'shower', true, T);
        S.ok(!(s3.lg(K.profile).showerMarks || {})[T] && s3.lg(K.tn).shower === true, '改回和排的一样 = 撤回记录');
        // 另一台设备晚到的 tn 不盖过记录:tonight() 在间隔模式下取排班
        const s4 = seed({ showerEvery: 2, showerSince: T, showerMarks: { [T]: false } }, { sk_tn1: { shower: true, shave: false, date: T, manual: true } });
        S.ok(tonight(W(s4)).shower === false, 'tn 说洗、记录说不洗:以记录为准');
    });

    t('洗澡模块 / 洗澡页的说法', () => {
        const app = s => ({ world: () => W(s), today: () => T, store: s });
        const due = seed({ showerEvery: 2, showerSince: d(-2) });   // 前天洗 → 今晚洗
        const h = showerCardHtml(app(due));
        S.ok(/^<section class="sh-card" id="tn-shower"/.test(h) && h.indexOf('今晚洗澡') >= 0 && h.indexOf('今晚不洗') >= 0 && h.indexOf('隔 1 天') >= 0, '该洗:主文案「今晚洗澡」、小字有间隔、按钮「今晚不洗」', h);
        S.ok(!/<a[^>]*>[^]*<button[^]*<\/a>/.test(h) && h.indexOf('href="#/tonight/shower"') >= 0, '按钮不嵌在入口 <a> 里;入口去洗澡页');
        setShowerMark(due, T, false, T);
        const h2 = showerCardHtml(app(due));
        S.ok(h2.indexOf('今晚不洗，改到明晚') >= 0 && h2.indexOf('撤回') >= 0, '点了不洗:「今晚不洗，改到明晚」+ 撤回', h2);
        const rest = seed({ showerEvery: 2, showerSince: d(-1) });
        const h3 = showerCardHtml(app(rest));
        S.ok(h3.indexOf('今晚不用洗') >= 0 && h3.indexOf('下次明晚洗') >= 0 && h3.indexOf('今晚要洗') >= 0, '不用洗:「今晚不用洗」、下次明晚、按钮「今晚要洗」', h3);
        setShowerMark(rest, T, true, T);
        S.ok(showerCardHtml(app(rest)).indexOf('今晚洗澡（临时加的）') >= 0, '临时加:「今晚洗澡（临时加的）」');
        const none = showerCardHtml(app(seed({})));
        S.ok(none.indexOf('隔几天洗一次？') >= 0 && (none.match(/data-sh="every"/g) || []).length === 3 && none.indexOf('每天') >= 0 && none.indexOf('隔 2 天') >= 0, '还没排:问句 + 每天 / 隔 1 天 / 隔 2 天三个快选', none);
        S.ok(!/——/.test(h + h2 + h3 + none), '文案里没有破折号');
        const cal = calendarDays(T);
        S.ok(cal.length === 28 && new Date(cal[0] + 'T12:00:00').getDay() === 1 && cal.indexOf(T) >= 14 && cal.indexOf(T) < 21, '日历 28 天、周一起排、今天在第 3 行', [cal[0], cal.indexOf(T)]);
        S.ok(everyText(1) === '每天' && everyText(2) === '隔 1 天' && everyText(7) === '隔 6 天', '界面说法:每天 / 隔 N 天');
        const info = showerInfo(W(seed({ showerEvery: 3, showerSince: d(-1) })), T);
        S.ok(info.last === d(-1) && info.next === d(2) && info.every === 3, 'showerInfo:上次、下次', info);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    let fail = 0, n = 0; const t0 = Date.now();
    const S = { ok(c, label, detail) { n++; if (!c) fail++; console.log((c ? '  ✓ ' : '  ✗ ') + label + (!c && detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 700) : '')); return !!c; } };
    console.log('■ shower-unit');
    await runShowerUnit(S);
    console.log(`\n${fail ? '✗ ' + fail + ' 条失败' : '✓ 全部通过'}(${n} 条)· ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(fail ? 1 : 0);
}
