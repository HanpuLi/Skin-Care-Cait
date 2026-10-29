// B 路 · 新用户引导 + 改版说明(无头 Chrome,假顾问后端,不花钱):
//   新用户:空货架起步(不灌内置那批)、一屏一个问题、每屏能跳过、进度存档(刷新接着走)、同一个全屏 sheet 原地换内容、
//   第一晚不上任何活性;登录了的新账号跳过欢迎页、邀请制先给邀请码;引导期间不自动判断「要不要买」;
//   老账号不进引导;改版说明 v2 第一次打开弹一次、按账号记已读、新用户不弹;引导中途登录发现是老账号 → 引导收起。
//   跑:node t/v2-b-oobe.mjs [块名关键词]
import { run, tab, click, log, sleep, DATA, text, has, design } from './v2-b-lib.mjs';

const step = p => p.eval(`const o=document.querySelector('#oobe .ob');return o?o.dataset.step:''`);
const ob = (p, a) => p.eval(`const b=document.querySelector('#oobe [data-ob="${a}"]');if(!b)return false;b.click();return true`).then(async r => { await sleep(250); return r; });
const prof = p => p.eval(`return ${DATA}.sk_profile1`);
async function addProduct(p, role, name) {
    await ob(p, 'add');
    await click(p, `#add-sheet [data-role=${role}]`, 200);
    await p.eval(`document.getElementById('m-name').value=${JSON.stringify(name)};[...document.querySelectorAll('#edit-sheet .sheet-actions .btn-primary')][0].click();return 1`);
    await sleep(300);
}

await run('v2-b-oobe', [
    ['新用户 · 没登录:一屏一问、可跳过、进度存档、第一晚不上活性', async ({ S, open }) => {
        const p = await open({ keepSheets: true });
        await p.waitFor(`!!document.getElementById('oobe')`, 4000);
        S.ok(await step(p) === 'welcome' && /先在这台手机上试试/.test(await text(p, '#oobe')), '全新设备:启动后进引导,第一屏欢迎(登录 / 先试试)');
        S.ok(await p.eval(`return !(${DATA}.sk_proddefs1) && !document.querySelector('#pr-shelf .prod')`), '空货架起步:不灌内置的那批');
        await ob(p, 'local');
        S.ok(await step(p) === 'mode' && (await prof(p)).oobe.step === 'mode', '没登录:跳过邀请码,到「你想怎么用」;进度写进档案', await prof(p));
        await p.eval(`document.getElementById('oobe').dataset.mark='same';return 1`);
        // 刷新:接着走
        await p.send('Page.reload', {}); await sleep(300);
        await p.waitFor(`!!document.getElementById('oobe')`, 5000);
        S.ok(await step(p) === 'mode', '刷新以后从「你想怎么用」接着走(进度存档)');
        await ob(p, 'mode-min');
        const pf = await prof(p);
        S.ok(pf.minimalMode === true && await step(p) === 'shelf', '选「只要告诉我今晚做什么」= 极简模式,下一屏「家里有什么」', pf.minimalMode);
        await p.eval(`document.getElementById('oobe').dataset.mark='same';return 1`);
        await addProduct(p, 'cleanse', '测试洁面');
        await addProduct(p, 'moist', '测试保湿');
        await addProduct(p, 'acid', '测试杏仁酸 mandelic');
        const sh = await p.eval(`const o=document.getElementById('oobe');return {mark:o.dataset.mark,list:[...o.querySelectorAll('.ob-list .row .lede')].map(x=>x.textContent),next:(o.querySelector('[data-ob=next]')||{}).textContent}`);
        S.ok(sh.mark === 'same' && sh.list.length === 3 && sh.next === '好了', '加一支,引导这一屏原地多一行(同一个 sheet,不关了重开)', sh);
        await ob(p, 'next');
        S.ok(await step(p) === 'skin', '下一屏「你的皮肤」');
        await click(p, '#oobe [data-base=combo]', 250);
        S.ok((await prof(p)).skinBase === 'combo' && await step(p) === 'skin', '点肤质:写档案,还在这一屏');
        await ob(p, 'skip');
        S.ok(await step(p) === 'first', '「跳过」:直接下一屏');
        S.ok(/第一晚不上任何活性/.test(await text(p, '#oobe')), '最后一屏说清楚:第一晚不上任何活性');
        await ob(p, 'finish');
        const done = await p.eval(`const d=${DATA};return {o:!!document.getElementById('oobe'),p:d.sk_profile1,today:__d(0),tab:location.hash,kinds:[...document.querySelectorAll('#tn-plan .step')].map(x=>x.dataset.kind),names:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)}`);
        S.ok(!done.o && done.p.onboarded === true && done.p.oobeAt === done.today && !done.p.oobe && done.p.tourV2 === true, '做完:引导收起、onboarded、oobeAt = 今天、改版说明记已读(新用户不弹)', done.p);
        S.ok(/tonight/.test(done.tab) && !done.names.some(n => /杏仁酸/.test(n)) && done.kinds.every(k => k !== 'acid' && k !== 'mask' && k !== 'retinol'), '回到今晚页:第一晚不上任何活性(货架上有酸也不排)', done);
        await p.send('Page.reload', {}); await sleep(2400);
        S.ok(!(await has(p, '#oobe')) && !(await has(p, '#whatsnew')), '再打开:不进引导,也不弹改版说明');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['新用户 · 登录了、邀请制:跳过欢迎、先给邀请码;引导期间不判断要不要买', async ({ S, open }) => {
        const p = await open({ keepSheets: true, mode: 'none', login: true, snapshot: 'none' });
        await p.eval(`(await import('/js/ui/products.js')).SHOP.delay=200;return 1`);
        await p.waitFor(`!!document.getElementById('oobe')`, 5000);
        S.ok(await step(p) === 'invite' && await has(p, '#ob-code'), '登录了的新账号:跳过欢迎;邀请制先问邀请码', await step(p));
        await p.eval(`document.getElementById('ob-code').value='GOOD1-CODE2';return 1`);
        await ob(p, 'redeem'); await sleep(300);
        S.ok(await step(p) === 'mode', '邀请码对了:开通,下一屏');
        await ob(p, 'mode-full');
        S.ok(await step(p) === 'shelf' && await has(p, '#ob-photo'), '开通了:「家里有什么」那屏能拍成分表');
        await addProduct(p, 'cleanse', '测试洁面');
        await addProduct(p, 'moist', '测试保湿');
        await sleep(600);
        S.ok((await log(p, '/api/shop')) === 0, '引导里一支支往空货架上加:不自动判断「要不要买」', await log(p, '/api/shop'));
        await p.eval(`__AIF.plan={rationale:'新用户第一版',rules:{acidCap:1,acidName:'',acidZones:[],cleanse:'',repair:'',repairWhy:''},resting:[],gaps:[]};return 1`);
        await ob(p, 'next'); await ob(p, 'next');
        S.ok(/顾问会按你家里的东西/.test(await text(p, '#oobe')), '最后一屏:开通了就说顾问出第一版');
        await ob(p, 'finish');
        await p.waitFor(`(__AIF.log||[]).some(x=>x.p==='/api/plan')`, 3000);
        await sleep(800);
        const r = await p.eval(`const h=${DATA}.sk_regimen1;return {last:h[h.length-1],plan:(__AIF.log||[]).filter(x=>x.p==='/api/plan').length,shop:(__AIF.log||[]).filter(x=>x.p==='/api/shop').length}`);
        S.ok(r.plan === 1 && r.last.source === 'ai' && r.shop === 0, '做完:顾问出第一版方案(能撤销);第一版方案也不自动判断要不要买', { plan: r.plan, src: r.last.source, shop: r.shop });
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['新用户 · 登录了、没看过「顾问会看到什么」:点「知道了」出第一版方案,也不自动判断要不要买', async ({ S, open }) => {
        const p = await open({ keepSheets: true, mode: 'on', login: true, snapshot: 'none', notice: false });
        await p.eval(`(await import('/js/ui/products.js')).SHOP.delay=200;return 1`);
        await p.waitFor(`!!document.getElementById('oobe')`, 5000);
        for (let i = 0; i < 4 && ['welcome', 'invite'].indexOf(await step(p)) >= 0; i++) await ob(p, 'skip');
        if (await step(p) === 'mode') await ob(p, 'mode-full');
        S.ok(await step(p) === 'shelf', '(前提)走到「家里有什么」', await step(p));
        await addProduct(p, 'cleanse', '测试洁面');
        await addProduct(p, 'moist', '测试保湿');
        await p.eval(`__AIF.plan={rationale:'新用户第一版',rules:{acidCap:1,acidName:'',acidZones:[],cleanse:'',repair:'',repairWhy:''},resting:[],gaps:[]};return 1`);
        await ob(p, 'next'); if (await step(p) === 'skin') await ob(p, 'next');
        await ob(p, 'finish');
        await p.waitFor(`!!document.getElementById('ai-privacy')`, 3000);
        S.ok((await log(p, '/api/plan')) === 0, '没看过说明:先弹「顾问会看到什么」,第一版方案还没请');
        await p.eval(`document.querySelector('#ai-privacy .btn-primary').click();return 1`);
        await p.waitFor(`(__AIF.log||[]).some(x=>x.p==='/api/plan')`, 4000);
        await sleep(1200);   // 过了 SHOP.delay(200 毫秒)好几倍
        const r = await p.eval(`const h=${DATA}.sk_regimen1;return {src:h[h.length-1].source,plan:(__AIF.log||[]).filter(x=>x.p==='/api/plan').length,shop:(__AIF.log||[]).filter(x=>x.p==='/api/shop').length}`);
        S.ok(r.plan === 1 && r.src === 'ai' && r.shop === 0, '点「知道了」:顾问出第一版;第一版方案落成也不自动判断要不要买(/api/shop 0 次)', r);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['引导中途登录 · 云端是老账号 → 引导收起', async ({ S, open }) => {
        const p = await open({ keepSheets: true });
        await p.waitFor(`!!document.getElementById('oobe')`, 4000);
        await p.eval(`window.__AIF={mode:'down'};fakeCloud.auth({uid:'u-old',email:'old@example.com',displayName:'Old',getIdToken:async()=>'t'});return 1`);
        await p.waitFor(`fakeCloud.listeners.length>0`, 4000);
        const old = { sk_profile1: { onboarded: true, minimalMode: false, shaving: false, hrt: false, tour3: true, tourIA: true, tourV2: true }, sk_jrnl1: [{ date: '2026-10-01', status: ['稳定'], products: [], note: '' }] };
        await p.eval(`fakeCloud.emit(${JSON.stringify(old)});return 1`);
        await sleep(1200);
        const r = await p.eval(`return {oobe:!!document.getElementById('oobe'),p:${DATA}.sk_profile1}`);
        S.ok(!r.oobe && r.p.onboarded === true && !r.p.oobe, '登录后云端是老账号:以云端为准,引导收起', r);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['老账号 · 不进引导;改版说明弹一次、按账号记已读', async ({ S, open }) => {
        const p = await open({ seed: 'full', keepSheets: true });
        await p.waitFor(`!!document.getElementById('whatsnew')`, 4000);
        const w = await text(p, '#whatsnew');
        S.ok(!(await has(p, '#oobe')) && /这一版改了什么/.test(w) && /修订线/.test(w) && /刮胡/.test(w), '老账号:不进引导;v2 第一次打开弹改版说明(开了刮胡的人才提刮胡)', w);
        await p.eval(`document.querySelector('#whatsnew .btn-primary').click();return 1`); await sleep(200);
        S.ok((await prof(p)).tourV2 === true, '点「知道了」:档案记 tourV2(按账号,跟云走,另一台设备不再弹)');
        await p.send('Page.reload', {}); await sleep(2400);
        S.ok(!(await has(p, '#whatsnew')), '再打开:不弹');
        // 设置里能再看
        await p.eval(`document.getElementById('btn-settings').click();return 1`); await sleep(300);
        await p.eval(`document.querySelector('#settings-sheet [data-act=whatsnew]').click();return 1`); await sleep(300);
        S.ok(await has(p, '#whatsnew'), '设置里「这一版改了什么」能再看');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['重新做引导:皮肤步点「没有」不抹掉今天记的泛红,做完不凭空多一版方案', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{today:true,status:i=>i===0?['泛红']:['出油']}` });
        const before = await p.eval(`const d=${DATA};return {st:((d.sk_jrnl1||[]).find(e=>e.date===__d(0))||{}).status||[],n:(d.sk_regimen1||[]).length}`);
        await p.eval(`document.getElementById('btn-settings').click();return 1`); await sleep(300);
        await p.eval(`document.querySelector('#settings-sheet [data-act=oobe]').click();return 1`); await sleep(400);
        await ob(p, 'mode-full');
        if (await step(p) === 'shelf') await ob(p, 'next');
        S.ok(await step(p) === 'skin', '(前提)走到「你的皮肤」');
        await ob(p, 'state-irritated');
        const irr = await text(p, '#oobe');
        S.ok(/档案里记下了/.test(irr) && !/记进今天了/.test(irr), '重做时点「有发红刺痛」:说的是记进档案,不说「记进今天了」(重做不碰当天日志)', irr.slice(0, 200));
        await ob(p, 'state-ok');
        await ob(p, 'next');
        if (await step(p) !== 'first') await ob(p, 'skip');
        const fin = await text(p, '#oobe');
        S.ok(/设置改好了/.test(fin) && !/第一版方案/.test(fin) && !/第一晚不上/.test(fin), '重做的最后一屏:不提第一版方案、第一晚', fin.slice(0, 200));
        await ob(p, 'finish');
        await sleep(400);
        const after = await p.eval(`const d=${DATA};return {st:((d.sk_jrnl1||[]).find(e=>e.date===__d(0))||{}).status||[],n:(d.sk_regimen1||[]).length,last:((d.sk_regimen1||[]).slice(-1)[0]||{}).reason||'',start:d.sk_profile1.startState}`);
        S.ok(before.st.includes('泛红') && after.st.includes('泛红'), '今天自己记的泛红还在(就医红线数的硬事实)', { before, after });
        S.ok(after.n === before.n && !/你说的皮肤情况/.test(after.last), '方案版本数不变,没有凭空出「第一版」', { before: before.n, after });
        S.ok(after.start === 'ok', '只改了档案里的起点(startState)', after.start);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['极简老账号 · 改版说明讲极简那几条;重新做引导', async ({ S, open }) => {
        const p = await open({ seed: 'minimal', keepSheets: true });
        await p.waitFor(`!!document.getElementById('whatsnew')`, 4000);
        const w = await text(p, '#whatsnew');
        S.ok(/护肤品不用打卡/.test(w) && /记一下皮肤/.test(w) && !/刮胡/.test(w), '极简:讲「不用打卡 / 记一下皮肤」,不提刮胡', w);
        await p.eval(`document.querySelector('#whatsnew .btn-primary').click();return 1`); await sleep(200);
        await p.eval(`document.getElementById('btn-settings').click();return 1`); await sleep(300);
        await p.eval(`document.querySelector('#settings-sheet [data-act=oobe]').click();return 1`); await sleep(400);
        S.ok(await step(p) === 'mode' && await has(p, '#oobe [data-ob=close]'), '重新做引导:从「你想怎么用」开始,能关掉');
        await ob(p, 'mode-min');
        S.ok(await step(p) === 'skin', '货架不空:跳过「家里有什么」');
        const pr = await design(p, '#oobe');
        S.ok(!pr.emoji.length && !pr.lowCr.length && !pr.smallN && !pr.styleAttrs.length, '纸墨:0 emoji、对比度、触控 ≥44、没有 style=', pr);
        await ob(p, 'close');
        S.ok(!(await has(p, '#oobe')) && !(await prof(p)).oobeAt, '关掉:收起;重做不会把「第一晚」再记一次');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }]
]);
