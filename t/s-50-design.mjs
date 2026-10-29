// 纸墨护理手册的验收(AUDIT-aesthetic §3.12)+ 全程 0 emoji(Cait 10/29),跨整个 App 量。
// 每个模式 × 浅 / 深 × 四个 tab + 常开的几个 sheet,逐屏量:
//   0 个 emoji(渲染后的文字和 aria-label / title / placeholder / alt / value,按 Unicode Extended_Pictographic + 审计给的区段)
//   字号 ≤6 种、没有 <12px、<14px 的字符 ≤15%;文字对比度 ≥4.5;命中区 ≥44×44;输入框 ≥16px;
//   一屏用到 --medical 的元素 ≤2;深色下没有比 --ink-strong 更亮的像素;模板里没有 style=(动态百分比宽度除外)
// v2 迁移(P3):调全局函数(show / openSettings / openAddProduct / checkinTonight / startOOBE …)的地方一律改成点真 DOM;
//   token 现在在 css/tokens.css(浅一份、深一份),index.html 没有 <style>。各屏自己的探针在 t/v2-a-* / t/v2-b-* 里也有,
//   这里多做的是:跨屏同一口径、全 App 字号 ≤6 种(只有把所有屏的字号并起来才量得出)、特殊状态逐个过一遍。
import fs from 'node:fs';
import path from 'node:path';
import { fresh } from './v2-a-lib.mjs';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '..');
const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const CLEAR = `document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());`;
const TAB = id => `document.getElementById('tab-${id}').click();${W8(250)}`;
const SCREENS = [
    ['tonight', ''], ['advisor', ''], ['record', ''], ['products', ''],
    ['tonight', `document.getElementById('btn-settings').click()`, '设置'],
    ['products', `document.getElementById('pr-add').click()`, '添加产品'],
    ['products', `document.querySelector('#products .prod[data-id]').click()`, '产品菜单'],
    ['products', `document.getElementById('pr-add').click();${W8(200)}document.querySelector('#add-sheet [data-role="acid"]').click()`, '编辑产品 · 刷酸'],
    // 某天的记录:历史里有那一天就点那一行;没有(极简模式的推定记录)就走「补记某一天」挑前天
    ['record', `const d=document.querySelector('#record [data-act="day"]');if(d)d.click();else{document.querySelector('#record [data-act="day-pick"]').click();${W8(200)}document.querySelector('#day-pick [data-d="'+__d(-2)+'"]').click()}`, '某天的记录'],
    ['tonight', `document.querySelector('#tonight [data-act="skin"]').click()`, '记皮肤']
];
const pass = (r, scheme) => !r.emoji.length && r.minFs >= 12 && r.pctLt14 <= 15 && !r.lowCr.length && !r.smallN && !r.inputsLt16 && r.red <= 2 && (scheme === 'light' || !r.brightN) && !r.styleAttrs.length;
export default async function ({ origin, S, open }) {
    const allSizes = new Set();
    const PART = process.env.DESIGN_PART || '';   // 只跑一段:DESIGN_PART=screens / states
    for (const scheme of PART === 'states' ? [] : ['light', 'dark']) {
        for (const who of ['full', 'minimal']) {
            const p = await open({ scheme });
            await p.nav(origin + '/index.html', 200);
            await p.eval(`return __seed.${who}({profile:{showJournal:true}})`);
            await p.reload(900);
            await p.eval(PROBE + ';return 1');
            for (const [tab, act, name] of SCREENS) {
                const tag = `${who}/${scheme}/${tab}${name ? ' + ' + name : ''}`;
                const r = await p.eval(`${CLEAR}${TAB(tab)}try{${act ? act + ';' + W8(250) : ''}}catch(e){return {miss:String(e.message)}}return __probe()`);
                if (r.miss) { S.ok(false, `${tag}:打不开这一屏`, r.miss); continue; }
                r.sizes.forEach(x => allSizes.add(x));
                S.ok(!r.emoji.length, `${tag}:0 个 emoji`, r.emoji);
                S.ok(r.minFs >= 12, `${tag}:没有 <12px 的字`, r.minFs);
                S.ok(r.pctLt14 <= 15, `${tag}:<14px 的字符 ≤15%`, r.pctLt14);
                S.ok(!r.lowCr.length, `${tag}:文字对比度都 ≥4.5`, r.lowCr);
                S.ok(!r.smallN, `${tag}:可点的都 ≥44×44`, r.small);
                S.ok(!r.inputsLt16, `${tag}:输入框都 ≥16px`, r.inputsLt16);
                S.ok(r.red <= 2, `${tag}:红色 ≤2 处`, r.red);
                if (scheme === 'dark') S.ok(!r.brightN, `${tag}:没有比 --ink-strong 更亮的像素`, r.bright);
                S.ok(!r.styleAttrs.length, `${tag}:模板里没有 style=`, r.styleAttrs);
            }
            if (p.errors.length) S.ok(false, `${who}/${scheme}:页面报错`, p.errors);
        }
    }
    // ── 窄屏:375 / 320 宽(上面整轮只量 390):未来 7 晚、设置里的星期芯片命中区 ≥44,没有横向滚动;走势行不被挤成一字一行 ──
    if (PART !== 'states') for (const width of [375, 320]) {
        const p = await open({ width });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full({profile:{showJournal:true},status:i=>i>=-9?['闭口']:['出油']})`);
        await p.reload(900);
        await p.eval(PROBE + ';return 1');
        for (const [tab, act, name] of [['advisor', ''], ['tonight', `document.getElementById('btn-settings').click()`, '设置'], ['record', '']]) {
            const tag = `full/light/${width}/${tab}${name ? ' + ' + name : ''}`;
            const r = await p.eval(`${CLEAR}${TAB(tab)}try{${act ? act + ';' + W8(250) : ''}}catch(e){return {miss:String(e.message)}}const o=__probe();o.hscroll=document.documentElement.scrollWidth>innerWidth+1;
                o.trendH=Math.max(0,...[...document.querySelectorAll('#rec-trend .trend-rows li')].map(li=>li.getBoundingClientRect().height));return o`);
            if (r.miss) { S.ok(false, `${tag}:打不开这一屏`, r.miss); continue; }
            S.ok(!r.smallN, `${tag}:可点的都 ≥44×44`, r.small);
            S.ok(!r.hscroll, `${tag}:没有横向滚动`);
            if (tab === 'record') S.ok(r.trendH <= 40, `${tag}:走势一行不折成一字一行`, r.trendH);
        }
        if (p.errors.length) S.ok(false, `窄屏 ${width}:页面报错`, p.errors);
    }
    // ── 特殊状态:没登录就能到的 ──
    const STATES = [
        ['minimal', '就医红线', `minimal({status:i=>i>=-6?['泛红']:[]})`, TAB('tonight')],
        ['full', '提醒卡 · 「还有 N 条」展开', `full({status:i=>i>=-6?['泛红']:['出油'],extra:{sk_gone1:['avene','toleriane','sunscreen']}})`, `${TAB('tonight')}const m=document.getElementById('tn-more');if(m)m.open=true`],
        ['full', '今晚的情况 · 点了刮胡', `full()`, `document.getElementById('tn-shave-y').click()`],
        ['minimal', '极简 · 记一下皮肤', `minimal()`, `document.getElementById('tn-logskin').click()`],
        ['full', '改版说明', `full({profile:{tourV2:false}})`, `for(let i=0;i<40&&!document.getElementById('whatsnew');i++)${W8(100)}`],
        ['full', '只记皮肤 + 脸部地图', `full({today:true,status:i=>i===0?['爆痘']:['出油']})`, `document.querySelector('#tonight [data-act="skin"]').click();${W8(200)}const z=document.querySelector('#skin-sheet .fm-b');if(z)z.click()`],
        ['full', '完成今晚之后', `full()`, `document.querySelector('#tn-plan [data-step]').click();${W8(100)}document.getElementById('tn-finish-b').click();${W8(200)}${CLEAR}`],
        ['full', '顾问页 · 7 晚点过 + 常识展开', `full()`, `${TAB('advisor')}const b=[...document.querySelectorAll('#adv-n7 .n7-b')].slice(-2)[0];if(b)b.click();${W8(200)}document.querySelectorAll('#advisor details').forEach(d=>d.open=true)`],
        ['minimal', '极简 · 顾问页(方案折叠展开)', `minimal()`, `${TAB('advisor')}const f=document.getElementById('adv-minfold');if(f)f.open=true`]
    ];
    for (const scheme of PART === 'screens' ? [] : ['light', 'dark']) {
        for (const [who, name, seed, act] of STATES) {
            const p = await open({ scheme });
            await p.nav(origin + '/index.html', 200);
            await p.eval(`return __seed.${seed}`);
            await p.reload(600);
            await p.eval(PROBE + ';return 1');
            const r = await p.eval(`${act}; ${W8(300)} return __probe()`);
            const tag = `${name}/${scheme}`;
            r.sizes.forEach(x => allSizes.add(x));
            S.ok(pass(r, scheme), `${tag}:0 emoji · 字号 · 对比度 · 触控 · 红 ≤2${scheme === 'dark' ? ' · 不刺眼' : ''}`, r);
            if (p.errors.length) S.ok(false, `${tag}:页面报错`, p.errors);
        }
        // 新用户引导:同一个全屏 sheet 逐屏换内容,每一屏都量
        {
            const p = await open({ scheme });
            await p.nav(origin + '/index.html', 200);
            await p.eval(`return __seed.fresh()`);
            await p.reload(300);
            await p.waitFor(`!!document.getElementById('oobe')`, 5000);
            await p.eval(PROBE + ';return 1');
            for (const [step, next] of [['欢迎', `[data-ob="local"]`], ['怎么用', `[data-ob="mode-min"]`], ['家里有什么', `[data-ob="next"]`], ['你的皮肤', `[data-ob="next"]`], ['第一版', '']]) {
                const r = await p.eval(`${W8(200)}return __probe()`);
                r.sizes.forEach(x => allSizes.add(x));
                S.ok(pass(r, scheme), `引导 · ${step}/${scheme}:0 emoji · 字号 · 对比度 · 触控 · 红 ≤2${scheme === 'dark' ? ' · 不刺眼' : ''}`, r);
                if (next) await p.eval(`document.querySelector('#oobe ${next}').click();return 1`);
            }
            if (p.errors.length) S.ok(false, `引导/${scheme}:页面报错`, p.errors);
        }
        // 登录后才有的:顾问对话 + 修订线(今晚页和对话两处)、没开通、连不上
        for (const [name, mode, act] of [
            ['顾问页 · 对话 + 修订线', 'on', `localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test',at:1}));${TAB('tonight')}
                const eye=[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent).find(s=>/眼部|眼霜/.test(s));
                __AIF.chat=[['delta',{t:'可以。'}],['action',{id:'act-d',message:'跳过一步',changes:[{op:'skip',product:eye,why:'今晚想简单点'}],dropped:[]}],['done',{text:'可以，今晚跳过眼霜。',model:'claude-test',effort:'medium',cost:0.01}]];
                ${TAB('advisor')}const t=document.getElementById('adv-text');t.value='今晚能少一步吗';t.dispatchEvent(new Event('input'));document.getElementById('adv-send').click();
                for(let i=0;i<40&&(document.getElementById('adv-stream')||!document.querySelector('#adv-log .msg.ai'));i++)${W8(100)}`],
            ['顾问页 · 没开通', 'none', `${TAB('advisor')}`],
            ['顾问页 · 连不上', 'down', `${TAB('advisor')}`]
        ]) {
            const p = await fresh(origin, { seed: 'full', mode, login: true, scheme });
            try {
                await p.eval(PROBE + ';return 1');
                const r = await p.eval(`${act}; ${W8(300)} return __probe()`);
                r.sizes.forEach(x => allSizes.add(x));
                S.ok(pass(r, scheme), `${name}/${scheme}:0 emoji · 字号 · 对比度 · 触控 · 红 ≤2${scheme === 'dark' ? ' · 不刺眼' : ''}`, r);
                if (mode === 'on') {
                    const rv = await p.eval(`${CLEAR}${TAB('tonight')}return {rev:!!document.getElementById('tn-rev'),p:__probe()}`);
                    rv.p.sizes.forEach(x => allSizes.add(x));
                    S.ok(rv.rev && pass(rv.p, scheme), `今晚页 · 修订线/${scheme}:有「顾问改了今晚」那一行,版式照样过`, { rev: rv.rev, p: rv.p });
                }
                if (p.errors.length) S.ok(false, `${name}/${scheme}:页面报错`, p.errors);
            } finally { p.done(); }
        }
    }
    S.ok(allSizes.size <= 6, '全 App 字号 ≤6 种', [...allSizes].sort((a, b) => a - b));
    // 源码里:token 只定义一份(浅一份、深一份),旧样式和饱和色不再出现,index.html 不内联样式
    const css = ['css/tokens.css', 'css/base.css', 'css/components.css', ...fs.readdirSync(path.join(ROOT, 'css/screens')).map(f => 'css/screens/' + f)]
        .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const paperDefs = css.map(([f, s]) => [f, (s.match(/--paper:/g) || []).length]).filter(([, n]) => n);
    S.ok(paperDefs.length === 1 && paperDefs[0][0] === 'css/tokens.css' && paperDefs[0][1] === 2, 'token 只定义一份(css/tokens.css,浅 / 深各一)', paperDefs);
    const all = html + css.map(([, s]) => s).join('\n');
    S.ok(!/rgba\(128|rgba\(255,176|#22a06b|#e2483d|DM\+Sans|DM Sans|DM Mono/.test(all), '旧配色和 DM 字体都清掉了');
    S.ok(!/<style[\s>]/.test(html) && (html.match(/rel="stylesheet" href="css\//g) || []).length === css.length, 'index.html 不内联样式,css/ 下每个文件都挂上了', (html.match(/rel="stylesheet" href="css\//g) || []).length);
    S.ok(/prefers-reduced-motion:\s*reduce/.test(all) && !/infinite/.test(all), '有 reduced-motion,没有循环动画');
}
