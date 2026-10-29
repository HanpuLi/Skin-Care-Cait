// 「要不要买新的」· 复制清单:有顾问结果时复制顾问版(分组、型号、价钱和店、链接、接班、不用买的);verdict=none 复制也说「现在不用买」;
//   顾问用不了 / 没登录时复制离线那份。clipboard 换成假的接住文本。
// v2 迁移(P3):v1 这个文件的其余断言都已有新家,不重复(见 t/run.mjs 的退役说明):
//   后台判断(防抖、签名不变不重调、第一次打开 / 同步来的 / 方案自动重出不调)、顾问版渲染、跑着 / 过时、出错退回离线、换账号不串、深色 → t/v2-b-products.mjs;
//   「加载 / 同步 / 自动重出方案路径碰不到 shopLocalChange」静态检查 + 行为计数 → engine-unit;「ai.js 没加载」→ v2 没有单独的 ai.js,退役。
import { fresh } from './v2-a-lib.mjs';
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const COPY = `window.__copied=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t}}});
    document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());document.getElementById('pr-shop-copy').click();${W8(120)}
    return window.__copied||((document.querySelector('#sheet-root .sheet-ov')||{}).innerText||'')`;
export default async function ({ origin, S }) {
    // ── 没登录 / 顾问连不上:复制离线那份 ──
    for (const [label, o] of [['没登录', { seed: 'full' }], ['顾问连不上', { seed: 'full', mode: 'down', login: true }]]) {
        const p = await fresh(origin, o);
        try {
            const c = await p.eval(`document.getElementById('tab-products').click();${W8(300)}${COPY}`);
            S.ok(/护肤要买的（按方案缺口）|暂时不用买/.test(c || '') && !/顾问/.test(c || ''), `${label}:复制清单 = 离线那份`, c);
            S.ok(!p.errors.length, `${label}:0 报错`, p.errors);
        } finally { p.done(); }
    }
    // ── 顾问判断过:复制顾问版;verdict=none 也照说 ──
    {
        const p = await fresh(origin, { seed: 'full', mode: 'on', login: true });
        try {
            await p.eval(`localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test',at:1}));document.getElementById('tab-products').click();${W8(300)}
                document.getElementById('pr-shop-redo').click();for(let i=0;i<40&&!(__AIF.log||[]).some(x=>x.p==='/api/shop');i++)${W8(100)}${W8(400)}return 1`);
            const t = await p.eval(COPY);
            S.ok(/^护肤要买的（顾问 /.test(t || '') && /现在就缺/.test(t) && /快用完前备上/.test(t)
                && /型号：CeraVe Foaming Cleanser 236ml（£12，Boots） https:\/\/www\.boots\.com/.test(t) && /接班「La Roche-Posay Toleriane Sensitive Fluide」/.test(t) && /这些不用买：B5 修复霜、杏仁酸/.test(t),
                '有顾问结果:复制顾问版(分组、型号、价钱和店、链接、接班、不用买的)', t);
            await p.eval(`__AIF.shop={verdict:'none',summary:'家里的够凑一整套，快用完的那支有接班。',items:[],skip:[{name:'保湿',why:'有接班'}]};
                const n=(__AIF.log||[]).filter(x=>x.p==='/api/shop').length;document.getElementById('pr-shop-redo').click();
                for(let i=0;i<40&&(__AIF.log||[]).filter(x=>x.p==='/api/shop').length===n;i++)${W8(100)}${W8(400)}return 1`);
            const t2 = await p.eval(COPY);
            S.ok(/^现在不用买。家里的够凑一整套/.test(t2 || '') && !/现在就缺/.test(t2), 'verdict=none:复制时也说「现在不用买」+ summary', t2);
            S.ok(!p.errors.length, '复制顾问版 0 报错', p.errors);
        } finally { p.done(); }
    }
}
