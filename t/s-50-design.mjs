// 纸墨护理手册的验收(AUDIT-aesthetic §3.12)+ 全程 0 emoji(Cait 10/29)。
// 每个模式 × 浅 / 深 × 每个 tab + 常开的几个 sheet,逐屏量:
//   0 个 emoji(渲染后的文字和 aria-label / title / placeholder / alt / value,按 Unicode Extended_Pictographic + 审计给的区段)
//   字号 ≤6 种、没有 <12px、<14px 的字符 ≤15%;文字对比度 ≥4.5;命中区 ≥44×44;输入框 ≥16px;
//   一屏用到 --medical 的元素 ≤2;深色下没有比 --ink-strong 更亮的像素;模板里没有 style=(动态百分比宽度除外)
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
const SCREENS = [
    ['tonight', ''], ['coach', ''], ['skin', ''], ['prods', ''],
    ['tonight', 'openSettings()'], ['prods', 'openAddProduct()'], ['prods', "openProdMenu(PD.find(p=>!p.hidden).id)"],
    ['skin', 'openDaySheet(__d(-2))'], ['tonight', 'checkinTonight()'], ['tonight', "showProdModal(null,{role:'acid'})"]
];
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
            for (const [tab, act] of SCREENS) {
                const tag = `${who}/${scheme}/${tab}${act ? ' + ' + act.replace(/\(.*$/, '') : ''}`;
                const r = await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());['settings-sheet','prod-modal'].forEach(i=>document.getElementById(i).hidden=true);
                    show('${tab}'); await new Promise(r=>setTimeout(r,250)); ${act ? act + ';' : ''} await new Promise(r=>setTimeout(r,250)); return __probe()`);
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
    // 特殊状态:就医红线、顾问页(对话 + 复盘 + 记忆)、修订条、计时横幅、展开的「今晚不用」、新用户引导每一步
    const STATES = [
        ['minimal', '就医红线', `__seed.minimal({status:i=>i>=-6?['泛红']:[]})`, `show('tonight')`],
        ['full', '顾问页', `__seed.full()`, `__login();window.__AIF={mode:'on'};localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test'}));await aiProbe(true);show('coach');await new Promise(r=>setTimeout(r,300));await aiSend('今晚能刷酸吗？');await new Promise(r=>setTimeout(r,300))`],
        ['full', '顾问页 · 没开通', `__seed.full()`, `__login();window.__AIF={mode:'none'};await aiProbe(true);show('coach')`],
        ['full', '顾问页 · 连不上', `__seed.full()`, `__login();window.__AIF={mode:'down'};await aiProbe(true);show('coach')`],
        ['full', '修订条 + 计时', `__seed.full()`, `aiApplyTonight({id:'t1',changes:[{op:'skip',product:PD.find(p=>p.role==='eye'&&!p.hidden).name,why:'今晚想简单点'}]});show('tonight');const b=document.querySelector('.tmr');if(b)b.click();await new Promise(r=>setTimeout(r,200));timerDone(Object.keys(_timers)[0]);document.querySelector('.skips')&&(document.querySelector('.skips').open=true)`],
        // IA 重排(10/29)新增的几屏
        ['minimal', '提醒卡 · 「还有 N 条」展开', `__seed.minimal({status:i=>i>=-6?['泛红']:[]})`, `aiApplyTonight({id:'t1',changes:[{op:'skip',product:PD.find(p=>p.role==='eye'&&!p.hidden).name,why:'测'}]});PD.filter(p=>p.role==='spf').forEach(p=>{p.hidden=true});invalidatePlanCache();renderTn();document.getElementById('tn-more').open=true`],
        ['full', '今晚的情况 · 点了刮胡', `__seed.full()`, `document.getElementById('tn-sv').click()`],
        ['minimal', '极简 · 记一下皮肤', `__seed.minimal()`, `openSkinSheet()`],
        ['full', '改版说明', `__seed.full({profile:{tourIA:false}})`, `closeSheet('tour');maybeShowTour()`],
        ['full', '只记皮肤', `__seed.full({today:true,status:i=>i===0?['爆痘']:['出油']})`, `openSkinSheet();document.querySelector('#tn-skin .skin-h .btn-link').click()`],
        ['full', '顾问页 · 7 晚点过 + 常识展开', `__seed.full()`, `show('coach');await new Promise(r=>setTimeout(r,200));setNightState(offsetDate(2),'shower');document.getElementById('guide').open=true;document.getElementById('fold-hist').open=true`],
        ['fresh', '引导 · 欢迎', `__seed.fresh()`, `startOOBE({})`],
        ['fresh', '引导 · 怎么用', `__seed.fresh()`, `startOOBE({});oobeGo('mode')`],
        ['fresh', '引导 · 家里有什么', `__seed.fresh()`, `startOOBE({});oobeGo('shelf')`],
        ['fresh', '引导 · 你的皮肤', `__seed.fresh()`, `startOOBE({});oobeGo('skin')`],
        ['fresh', '引导 · 第一版', `__seed.fresh()`, `startOOBE({});oobeGo('first')`]
    ];
    for (const scheme of PART === 'screens' ? [] : ['light', 'dark']) {
        for (const [who, name, seed, act] of STATES) {
            const p = await open({ scheme });
            await p.nav(origin + '/index.html', 200);
            await p.eval(`return ${seed}`);
            await p.reload(600);
            await p.eval(PROBE + ';return 1');
            const r = await p.eval(`${act}; await new Promise(r=>setTimeout(r,300)); return __probe()`);
            const tag = `${name}/${scheme}`;
            r.sizes.forEach(x => allSizes.add(x));
            S.ok(!r.emoji.length && r.minFs >= 12 && r.pctLt14 <= 15 && !r.lowCr.length && !r.smallN && !r.inputsLt16 && r.red <= 2 && (scheme === 'light' || !r.brightN) && !r.styleAttrs.length,
                `${tag}:0 emoji · 字号 · 对比度 · 触控 · 红 ≤2${scheme === 'dark' ? ' · 不刺眼' : ''}`, r);
            if (p.errors.length) S.ok(false, `${tag}:页面报错`, p.errors);
        }
    }
    S.ok(allSizes.size <= 6, '全 App 字号 ≤6 种', [...allSizes].sort((a, b) => a - b));
    // 源码里:token 只定义一份(浅一份、深一份),旧样式和饱和色不再出现
    const html = fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8');
    S.ok((html.match(/--paper:/g) || []).length === 2, 'token 只定义一份(浅 / 深各一)', (html.match(/--paper:/g) || []).length);
    S.ok(!/rgba\(128|rgba\(255,176|#22a06b|#e2483d|DM\+Sans|DM Mono/.test(html), '旧配色和 DM 字体都清掉了');
    S.ok((html.match(/<style>/g) || []).length === 1, '只有一个 <style> 块');
    S.ok(/prefers-reduced-motion:reduce/.test(html) && !/infinite/.test(html), '有 reduced-motion,没有循环动画');
}
