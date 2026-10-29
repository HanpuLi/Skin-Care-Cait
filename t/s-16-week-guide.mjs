// 洗澡 / 刮胡的两份习惯合成一份(sk_preset1 为准,档案 showerDays 是镜像)+「常识」写死的内容口径。不开浏览器。
// v2 迁移(P3):v1 这个文件的界面断言都已有新家(见 t/run.mjs 的退役说明):
//   顾问页未来 7 晚(点澡 / 刮、改刮胡后酸挪晚、存成每周习惯 / 按习惯重填、App 自己的确认 sheet、极简没开刮胡不出刮胡)→ t/v2-b-advisor.mjs;
//   今晚开关和 7 晚是同一份(sk_wk1)、同步键不变 → engine-unit;记录页每天写「澡 / 刮」→ t/v2-a-record.mjs;
//   常识离线可看、门控刮胡 / HRT 两节、「问顾问这一条」只预填 → t/v2-b-advisor.mjs;改版说明弹一次 → t/v2-b-oobe.mjs。
// 这里留两组 v2 测试里没有的:旧数据迁移(各种情况一次、不丢、不重跑)和常识的内容口径(就医、起步、引用的研究原话)。
import { createStore, K } from '../js/store.js';
import { addDays, dowOf, isoWeek } from '../js/clock.js';
import { syncHabitSources, saveHabit, habitPreset, getDayState, setDayState } from '../js/model/week.js';
import { GUIDE } from '../js/ui/guide.js';

const T = '2026-10-29';
function mkStore(seed) {
    const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    const LS = { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    const s = createStore({ localStorage: LS }).open();
    s._ls = LS;
    return s;
}
const reopen = s => { const s2 = createStore({ localStorage: s._ls }).open(); s2._ls = s._ls; return s2; };
const PROFILE = o => Object.assign({ shaving: true, minimalMode: false, onboarded: true }, o || {});
const PRESET = sh => [1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, shower: sh.indexOf(d) >= 0, shave: d === 5 }));
const showers = p => (p || []).filter(x => x.shower).map(x => x.dow).sort((a, b) => a - b);
// 设置里「通常哪几天洗澡」的格子按这个画(js/ui/settings.js:habitPreset(W.preset, W.profile))
const chips = s => showers(habitPreset(s.lg(K.preset), s.lg(K.profile)));

export default async function ({ S }) {
    // ── 两套洗澡习惯合成一套(Cait 10/29):旧数据各种情况迁移一次、不丢 ──
    {   // 只有设置里的洗澡日 → 补出 sk_preset1(system 写,不推送)
        const s = mkStore({ sk_profile1: PROFILE({ showerDays: [1, 4] }) }), r0 = s.state.doc.rev;
        syncHabitSources(s, T);
        const pr = s.lg(K.preset);
        S.ok(pr && pr.length === 7 && JSON.stringify(showers(pr)) === '[1,4]' && JSON.stringify(chips(s)) === '[1,4]' && s.state.doc.rev === r0, '只有「通常哪几天洗澡」:迁移成 sk_preset1(周一、周四),设置里照旧,不算一次改动', { pr: showers(pr), rev: s.state.doc.rev });
    }
    {   // 只有老版排班页存的模版 → 补出 showerDays 镜像,刮胡习惯留着
        const s = mkStore({ sk_profile1: PROFILE(), sk_preset1: PRESET([6]) });
        syncHabitSources(s, T);
        const prof = s.lg(K.profile);
        S.ok(JSON.stringify(prof.showerDays) === '[6]' && JSON.stringify(chips(s)) === '[6]' && s.lg(K.preset).find(x => x.dow === 5).shave === true, '只有老版模版:设置里显示模版的洗澡日(周六),刮胡习惯留着', prof.showerDays);
    }
    {   // 两份都有、对不上:洗澡日以设置为准(App 一直按它排),刮胡留模版的;原模版存进档案 habitPrev
        let s = mkStore({ sk_profile1: PROFILE({ showerDays: [1, 4] }), sk_preset1: PRESET([2]) });
        syncHabitSources(s, T);
        const pr = s.lg(K.preset), prev = (s.lg(K.profile).habitPrev || {}).preset;
        S.ok(JSON.stringify(showers(pr)) === '[1,4]' && JSON.stringify(pr.filter(x => x.shave).map(x => x.dow)) === '[5]' && JSON.stringify(showers(prev)) === '[2]' && JSON.stringify(chips(s)) === '[1,4]',
            '两份对不上:洗澡日按设置,刮胡按模版,原模版另存一份不丢', { sh: showers(pr), prev: showers(prev) });
        s = reopen(s); syncHabitSources(s, T); syncHabitSources(s, addDays(T, 1));
        S.ok(JSON.stringify(showers(s.lg(K.profile).habitPrev.preset)) === '[2]' && JSON.stringify(showers(s.lg(K.preset))) === '[1,4]' && s.lg(K.profile).habitPrev.at === T, '再打开一次:迁移不重跑、备份不被覆盖');
    }
    {   // 设置里点一下 ⇄ 顾问页「存成每周习惯」都走 saveHabit:sk_preset1 和 showerDays 一起改;没单独改过的周按这份习惯默认排
        const s = mkStore({ sk_profile1: PROFILE({ showerDays: [1] }) });
        syncHabitSources(s, T);
        const hp = habitPreset(s.lg(K.preset), s.lg(K.profile)).map(x => Object.assign({}, x)); hp.find(x => x.dow === 3).shower = true;
        saveHabit(s, hp);
        const a = { pr: showers(s.lg(K.preset)), sd: s.lg(K.profile).showerDays };
        S.ok(JSON.stringify(a.pr) === '[1,3]' && JSON.stringify(a.sd) === '[1,3]', '设置里点「周三」:sk_preset1 和 showerDays 一起改', a);
        for (let i = 0; i < 7; i++) { const ds = addDays(T, i); setDayState(s, ds, dowOf(ds) === 5, false, T); }
        saveHabit(s, [0, 1, 2, 3, 4, 5, 6].map(i => addDays(T, i)).map(ds => ({ dow: dowOf(ds), shower: getDayState(s, ds).shower, shave: getDayState(s, ds).shave })));
        const b = { pr: showers(s.lg(K.preset)), sd: s.lg(K.profile).showerDays, chips: chips(s) };
        S.ok(JSON.stringify(b.pr) === '[5]' && JSON.stringify(b.sd) === '[5]' && JSON.stringify(b.chips) === '[5]', '顾问页「存成每周习惯」:设置里的洗澡日跟着变', b);
        const far = addDays(T, 35), untouched = !(s.lg(K.wk) || {})[isoWeek(far)];
        S.ok(untouched && getDayState(s, far).shower === (dowOf(far) === 5), '没单独改过的周按这份习惯默认排', { far, dow: dowOf(far), sh: getDayState(s, far).shower });
    }

    // ── 常识:写死的内容口径(Cait 10/29「写死」;按现在的规则写)──
    const flat = b => typeof b === 'string' ? b : b.list ? b.list.join('\n') : (b.text || '');
    const t = GUIDE.map(g => g.head + '\n' + g.body.map(flat).join('\n')).join('\n');
    S.ok(!/\p{Extended_Pictographic}/u.test(t), '常识:0 emoji');
    S.ok(/泛红 5 天以上/.test(t) && /冒痘 10 天以上/.test(t) && /最近 3 天还在/.test(t) && /所有酸都停/.test(t) && /眼霜照用/.test(t) && /从那天起重新计数/.test(t),
        '就医口径按现在的规则写(泛红 ≥5 天 / 冒痘 ≥10 天、最近 3 天还在;所有酸停、眼霜照用;看过了从那天起重新计数)');
    S.ok(/每周 1 次温和酸/.test(t) && /「今晚」/.test(t) && /「顾问」/.test(t) && /「记录」/.test(t) && /「产品」/.test(t), '「刷酸从哪起步」写了从每周 1 次温和酸起步;「怎么用」按四个 tab 写');
    S.ok(/41°C/.test(t) && /10 分钟/.test(t) && /不等于「增效」/.test(t), '老版引用的研究说法原样保留(41°C、10 分钟;洗完澡「通透」不等于增效)');
    S.ok(GUIDE.some(g => g.id === 'shave' && g.feat === 'shave') && GUIDE.some(g => g.id === 'hrt' && g.feat === 'hrt'), '刮胡、HRT 两节按档案门控(feat)');
}
