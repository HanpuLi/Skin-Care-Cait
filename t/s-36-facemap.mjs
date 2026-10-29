// 脸部地图:记皮肤的 sheet 里可选标在脸上(完整模式勾了闭口 / 新痘 / 泛红这类才顺手展开,极简默认收起、标过也不自动展开);
//   记录页没标过时说一句怎么标;线稿 / 区块 / 选中 / 左右小字 / 标记圈在浅 / 深色下都看得清;口周 / 下颌线的「避开」照样写进步骤提示。
// v2 迁移(P3):
//   · v1「只勾了出油 / 差不多:不出现『标在脸上』」→ v2 按 BRIEF「入口:打卡里可选」入口一直在(只做标记,不点也照常记),
//     断言改成「入口在、收着、不自动展开」。
//   · 点选存取、近 14 天热度、点区看哪几天、顾问快照带 spots → t/v2-a-record.mjs;位置不参与红线、照片分析不参与、ZONE_PRESETS → engine-unit。
//   · 这里留:展开规则、空状态那句话、SVG 线稿对比度(v2-a 的探针只量文字,不量 SVG 描边)、步骤提示「避开口周 / 下颌线」。
import { createStore, K } from '../js/store.js';
import { buildWorld } from '../js/model/world.js';
import { ZONE_PRESETS } from '../js/model/profile.js';
import { FACE_ZONE_NAMES } from '../js/model/journal.js';
import { zoneHintFor } from '../js/engine/rules.js';
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const J = days => `(()=>{const j=[];for(let i=0;i>=-13;i--){const x=(${JSON.stringify(days)})[i]||{};j.push({date:__d(i),status:x.status||['出油'],spots:(x.spots||[]).map(([zone,type])=>({zone,type})),products:[],note:'',phase:''})}return j})()`;
const FM = `const t=document.getElementById('sk-fm-t');return {entry:!!t,exp:t&&t.getAttribute('aria-expanded'),box:!!document.getElementById('sk-fm-box'),txt:t&&t.textContent}`;
export default async function ({ origin, S, open }) {
    const boot = async (seed, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${seed}`);
        await p.reload(800);
        return p;
    };
    // ── 完整模式:只记了「出油」:入口在、收着;勾了「闭口」才顺手展开 ──
    {
        const p = await boot(`full({today:true,status:i=>i===0?['出油']:['出油']})`);
        const a = await p.eval(`document.querySelector('#tonight [data-act="skin"]').click();${W8(200)}${FM}`);
        S.ok(a.entry && a.exp === 'false' && !a.box, '只勾了「比平时油」:标在脸上的入口在,收着(不自动展开)', a);
        const b = await p.eval(`document.getElementById('sk-sym-闭口').click();${W8(150)}${FM}`);
        S.ok(b.exp === 'true' && b.box, '勾了「闭口」:脸部地图顺手展开', b);
        S.ok(!p.errors.length, '完整模式 0 报错', p.errors);
    }
    // ── 极简:入口在,默认收起;今天标过位置也不自动展开 ──
    {
        const p = await boot(`minimal({extra:{sk_jrnl1:${J({ 0: { status: ['泛红'], spots: [['口周', '泛红']] } })}}})`);
        const r = await p.eval(`document.getElementById('tn-logskin').click();${W8(200)}${FM}`);
        S.ok(r.entry && r.exp === 'false' && !r.box && /已标/.test(r.txt || ''), '极简模式:入口在(写着已标几处),默认收起,标过也不自动展开', r);
        S.ok(!p.errors.length, '极简 0 报错', p.errors);
    }
    // ── 记录页:没标过时说一句怎么标 ──
    {
        const p = await boot(`full()`);
        const r = await p.eval(`document.getElementById('tab-record').click();${W8(200)}return (document.getElementById('rec-heat')||{}).innerText||''`);
        S.ok(/还没在脸上标过位置/.test(r), '没标过:记录页说一句怎么标', r.slice(0, 80));
    }
    // ── 线稿、区块虚线、选中描边、左右小字、标记圈:浅 / 深色对底色都 ≥3:1 ──
    for (const scheme of ['light', 'dark']) {
        const p = await boot(`full({today:true,extra:{sk_jrnl1:${J({ 0: { status: ['爆痘', '泛红'], spots: [['口周', '泛红'], ['下巴', '红痘']] }, '-2': { status: ['爆痘'], spots: [['下巴', '红痘']] } })}}})`, { page: { scheme } });
        const r = await p.eval(`document.querySelector('#tonight [data-act="skin"]').click();${W8(200)}
            if(!document.getElementById('sk-fm-box'))document.getElementById('sk-fm-t').click();${W8(100)}
            document.getElementById('sk-fz-fore').click();${W8(100)}
            const parse=c=>{const m=String(c).match(/rgba?\\(([^)]+)\\)/);return m?m[1].split(/[ ,/]+/).filter(Boolean).map(Number):[0,0,0]};
            const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
            const cr=(x,y)=>{const A=lum(parse(x)),B=lum(parse(y));return +((Math.max(A,B)+.05)/(Math.min(A,B)+.05)).toFixed(2)};
            const q=s=>document.querySelector('#skin-sheet '+s),cs=s=>getComputedStyle(q(s));
            const bg=getComputedStyle(document.querySelector('#skin-sheet .sheet')).backgroundColor;
            return {bg,cr:{line:cr(cs('.fm-line').stroke,bg),zone:cr(cs('.fz:not(.on)').stroke,bg),on:cr(cs('.fz.on').stroke,bg),lr:cr(cs('.fm-lr').fill,bg),
                mk:cr(cs('.fm-mk.on').backgroundColor,bg),ring:cr(cs('.fm-mk:not(.on)').boxShadow,bg)}}`);
        S.ok(Object.values(r.cr).every(c => c >= 3), `${scheme}:线稿、区块虚线、选中描边、左右小字、标记圈对底色都 ≥3:1(看得清)`, r);
        S.ok(!p.errors.length, `${scheme}:0 报错`, p.errors);
    }
    // ── 选了「口周」「下颌线」之后,步骤提示照样写「避开…」(不开浏览器)──
    {
        const z = n => ZONE_PRESETS.find(x => x.name === n);
        const m = new Map([[K.profile, JSON.stringify({ minimalMode: false, onboarded: true, zones: [z('口周'), z('下颌线')].filter(Boolean) })]]);
        const LS = { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
        const W = buildWorld(createStore({ localStorage: LS }).open(), { today: '2026-10-29' });
        const r = { peri: z('口周') && z('口周').avoid, jaw: z('下颌线') && z('下颌线').avoid, inMap: ['口周', '人中/鼻下', '下巴', '发际线'].every(n => FACE_ZONE_NAMES.indexOf(n) >= 0), acid: zoneHintFor(W, 'acid'), mask: zoneHintFor(W, 'mask') };
        S.ok(JSON.stringify(r.peri) === '["acid","mask","retinol"]' && JSON.stringify(r.jaw) === '["mask"]' && r.inMap, 'ZONE_PRESETS 有「口周」(避开酸 / 面膜 / 维 A)和「下颌线」(避开面膜),区名和脸部地图一致', r);
        S.ok(/口周/.test(r.acid) && /口周/.test(r.mask) && /下颌线/.test(r.mask) && !/下颌线/.test(r.acid), '选了之后步骤提示照样「避开口周 / 下颌线」', r);
    }
}
