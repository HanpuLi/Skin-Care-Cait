// B 路 · 顾问页(无头 Chrome,假顾问后端,不花钱):
//   「现在的方案」页(#/advisor/plan)离线可看(一句话、刷酸阶梯、细则、版本与撤销);未来 7 晚点「澡」「刮」即时重排(刮只给开了刮胡的人)、
//   (7 晚在 #/tonight/week,今晚那一格和今晚页开关是同一份;「存成每周习惯 / 按习惯重填」= sk_preset1,页内的「通常哪几天洗澡」是同一份);
//   对话 SSE:顾问改今晚 / 改方案直接生效 + 修订线,今晚页那条和对话里这条撤销 / 重做联动;出方案、复盘;
//   没登录 / 邀请制(邀请码开通)/ 连不上 / 额度用完 / 没回应(只核一次,不循环打 /api/me)都不白屏;
//   顾问首页只有对话 + 两条「→」行(方案 / 常识各一页),极简模式也一样;常识(#/advisor/guide)写死离线可看、刮胡 / HRT 两节按档案门控、「问顾问这一条」只预填不发送。
//   跑:node t/v2-b-advisor.mjs [块名关键词]
import { run, tab, click, log, sleep, DATA, text, has, design } from './v2-b-lib.mjs';

const ADV = `const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];`;
const advView = p => p.eval(ADV + `return {line:(q('#adv-line')||{}).textContent||'',ver:(q('#adv-ver')||{}).textContent||'',lad:qa('#adv-ladder .lad-row').map(x=>x.className.replace('lad-row ','')+':'+x.innerText.replace(/\\s+/g,' ')),
    acc:(q('#adv-access')||{dataset:{}}).dataset.acc||'',dock:!!q('#adv-dock'),n7:qa('#adv-n7 .n7-d').length,shave:qa('#adv-n7 .n7-b[data-k=shave]').length,
    note:(q('#adv-n7-note')||{}).textContent||'',revs:qa('#adv-log .rev').map(x=>x.dataset.state+':'+((x.querySelector('.rev-act')||{}).textContent||'')),
    guide:qa('#adv-guide .g-head').map(x=>x.textContent.trim()),asks:qa('#adv-guide [data-gask]').length,minfold:!!q('#adv-minfold'),minOpen:!!(q('#adv-minfold')||{}).open,
    quick:qa('#adv-quick .chip').map(x=>x.textContent),hist:(q('#adv-hist summary')||{}).textContent||''}`);
// 二级页直达(DESIGN §3):#/advisor/plan · #/advisor/guide · #/tonight/week;tab 点一下回首页
async function go(p, hash, ms = 400) { await p.eval(`location.hash=${JSON.stringify(hash)};return 1`); await sleep(ms); }
async function say(p, msg, waitMs = 4000) {
    await p.eval(`const t=document.getElementById('adv-text');t.value=${JSON.stringify(msg)};t.dispatchEvent(new Event('input'));document.getElementById('adv-send').click();return 1`);
    await p.waitFor(`!document.getElementById('adv-stream') && [...document.querySelectorAll('#adv-log .msg.ai')].length>0`, waitMs);
    await sleep(200);
}

await run('v2-b-advisor', [
    ['完整模式 · 离线(没登录):方案 + 阶梯 + 7 晚 + 习惯', async ({ S, open }) => {
        const p = await open({ seed: 'full' });
        await tab(p, 'advisor');
        const home = await advView(p);
        S.ok(home.acc === 'out' && !home.dock && await has(p, '#adv-access [data-act=signin]'), '没登录:问顾问那一块说「要先登录」+ 登录按钮,没有输入框', home.acc);
        S.ok(!(await has(p, '#adv-plan')) && !(await has(p, '#adv-week')) && !(await has(p, '#adv-guide')) && !(await has(p, '#adv-minfold')), '顾问首页只有对话:没有方案、7 晚、常识,也没有极简折叠', home);
        const nav = await p.eval(`return [...document.querySelectorAll('#advisor .nav-row')].map(a=>({id:a.id,href:a.getAttribute('href'),now:(a.querySelector('.nav-now')||{}).textContent||''}))`);
        S.ok(nav.length === 2 && nav[0].href === '#/advisor/plan' && /^v\d+ · \d+\/\d+$/.test(nav[0].now) && nav[1].href === '#/advisor/guide', '首页两条「→」行:现在的方案(右边写 v几 · 日期)、护肤常识', nav);
        // 点进方案页:页头 h1 + 返回键,返回回到首页
        await click(p, '#adv-go-plan', 400);
        const pg = await p.eval(`return {h:location.hash,t:(document.querySelector('#advisor .pg-t')||{}).textContent,back:(document.querySelector('#advisor .pg-back')||{}).textContent,plan:!!document.getElementById('adv-plan')}`);
        S.ok(pg.h === '#/advisor/plan' && pg.t === '现在的方案' && /顾问/.test(pg.back) && pg.plan, '点「现在的方案」→ #/advisor/plan:h1「现在的方案」、返回键「‹ 顾问」', pg);
        await click(p, '#advisor .pg-back', 400);
        S.ok(await p.eval(`return location.hash==='#/advisor' && !!document.getElementById('adv-go-plan') && !document.getElementById('adv-plan')`), '返回键:回到顾问首页');
        await go(p, '#/advisor/plan');
        let v = await advView(p);
        S.ok(/刷酸每周 \d 次/.test(v.line) && /离线规则/.test(v.ver), '① 现在的方案:一句话 + 版本(离线规则),没登录照样有', v);
        S.ok(v.lad.length >= 3 && v.lad.some(x => /^now:/.test(x)) && /每周 1 次/.test(v.lad[0]), '刷酸阶梯:第一档每周 1 次起步、有「现在」那档', v.lad);
        S.ok(/只有这一版/.test(v.hist) && !(await has(p, '#adv-hist [data-hist]')), '只有一版离线方案:不写「能撤销」、也没有撤销按钮', v.hist);
        await click(p, '#adv-ladder-btn');
        S.ok(await p.eval(`return document.getElementById('adv-ladder').hidden && document.getElementById('adv-ladder-btn').getAttribute('aria-expanded')==='false'`), '「按周怎么往前走」能收起(aria-expanded 跟着变)');
        await go(p, '#/advisor/guide');
        v = await advView(p);
        S.ok(v.guide.length >= 8 && v.guide.includes('刮胡 = 机械性去角质') && !v.guide.includes('HRT 和长痘') && v.asks === 0, '④ 常识(#/advisor/guide):写死、离线可看;刮胡那节给开了刮胡的人;没开 HRT 看不到 HRT 那节;没开通不露「问顾问这一条」', v.guide);
        // ② 接下来 7 晚:直达 #/tonight/week 画得出 7 晚和 set-habit / set-timing
        await go(p, '#/tonight/week');
        v = await advView(p);
        S.ok(v.n7 === 7 && v.shave === 7, '② 接下来 7 晚(直达 #/tonight/week):7 格,开了刮胡的人每格有「刮」', v);
        S.ok(await has(p, '#tonight .pg-t') && /接下来 7 晚/.test(await text(p, '#tonight .pg-t')) && await has(p, '#set-habit') && await has(p, '#set-timing') && await has(p, '#set-shower') && await has(p, '#set-shavedays'), '页内:h1「接下来 7 晚」+ 每周洗澡 / 刮胡习惯(set-habit)+ 刷酸时机(set-timing)');
        // 今晚那格「刮」= 今晚页的开关(同一份 sk_tn1 / sk_wk1)
        const today = await p.eval(`return __d(0)`);
        await click(p, `#adv-n7 .n7-b[data-date="${today}"][data-k=shave]`, 300);
        const d1 = await p.eval(`const d=${DATA};return {tn:d.sk_tn1,note:document.getElementById('adv-n7-note').textContent,pressed:document.querySelector('#adv-n7 .n7-b[data-date="${today}"][data-k=shave]').getAttribute('aria-pressed')}`);
        S.ok(d1.tn && d1.tn.shave === true && d1.pressed === 'true', '点今晚的「刮」:写进今晚(sk_tn1),按钮 aria-pressed', d1);
        S.ok(d1.note.length > 4, '点完下面一行说改了什么(酸挪到哪晚 / 排的没变)', d1.note);
        await tab(p, 'tonight', 300);
        S.ok(/刮胡夜/.test(await text(p, '#tonight-h')), '今晚页同一份:标题变「今晚 · 刮胡夜」');
        await go(p, '#/tonight/week', 300);
        await click(p, `#adv-n7 .n7-b[data-date="${today}"][data-k=shave]`, 300);
        // 未来某晚的「澡」→ sk_wk1
        const d3 = await p.eval(`return __d(3)`);
        const before = await p.eval(`return document.querySelector('#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]').getAttribute('aria-pressed')`);
        await click(p, `#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]`, 300);
        const after = await p.eval(`return document.querySelector('#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]').getAttribute('aria-pressed')`);
        S.ok(before !== after, '点未来某晚的「澡」:即时改(排班 sk_wk1),重画后还在', { before, after });
        // 存成每周习惯 → sk_preset1(+ showerDays 镜像);设置里看到的是同一份
        await click(p, '#adv-habit-save', 300);
        const h = await p.eval(`const d=${DATA};return {pre:d.sk_preset1,sd:d.sk_profile1.showerDays,btn:document.getElementById('adv-habit-save').textContent,
            nights:[...document.querySelectorAll('#adv-n7 .n7-d')].map(x=>({date:x.dataset.day,sh:x.querySelector('[data-k=shower]').getAttribute('aria-pressed')==='true'}))}`);
        const dow = ds => new Date(ds + 'T12:00:00').getDay();
        const okPre = h.pre && h.pre.length === 7 && h.nights.every(n => !!(h.pre.find(x => x.dow === dow(n.date)) || {}).shower === n.sh);
        S.ok(okPre && JSON.stringify(h.sd) === JSON.stringify(h.pre.filter(x => x.shower).map(x => x.dow).sort((a, b) => a - b)) && h.btn === '已存成每周习惯', '「存成每周习惯」= sk_preset1(单一来源)+ showerDays 镜像', h);
        const st = await p.eval(`return [...document.querySelectorAll('#set-shower .chip')].map(b=>+b.dataset.hd+':'+b.getAttribute('aria-pressed'))`);
        S.ok(st.length === 7 && st.every(x => { const [d, on] = x.split(':'); return (on === 'true') === !!(h.pre.find(y => y.dow === +d) || {}).shower; }), '同一页里「通常哪几天洗澡」显示同一份习惯', st);
        await go(p, '#/settings/skin', 350);
        S.ok(!(await has(p, '#settings #set-habit')) && !(await has(p, '#settings #set-shower')) && !(await has(p, '#settings #set-timing')) && await has(p, '#settings .set-page'), '设置 → 你的皮肤里不再有洗澡习惯 / 刷酸时机(全 App 只在 7 晚页改)');
        await go(p, '#/tonight/week', 300);
        await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(o=>o.remove());return 1`);
        // 改一晚 → 按习惯重填 → 回到习惯
        await click(p, `#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]`, 300);
        await click(p, '#adv-habit-fill', 200);
        await p.eval(`const b=[...document.querySelectorAll('#sheet-root .sheet-actions .btn-primary')].pop();b.click();return 1`); await sleep(300);
        const back = await p.eval(`return document.querySelector('#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]').getAttribute('aria-pressed')`);
        S.ok(back === after, '「按习惯重填」(确认后):那晚回到习惯', { back, after });
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['极简模式 · 对话为主,方案和 7 晚各一页', async ({ S, open }) => {
        const p = await open({ seed: 'minimal', mode: 'on', login: true });
        await tab(p, 'advisor', 400);
        const v = await advView(p);
        S.ok(!v.minfold && !(await has(p, '#adv-plan')) && !(await has(p, '#adv-week')) && await has(p, '#adv-go-plan') && await has(p, '#adv-go-guide'), '极简:顾问首页只有对话 + 两条「→」行(没有折叠,方案在「现在的方案」页)', v);
        S.ok(v.dock && v.quick.length === 2 && v.quick.every(x => !/刷酸/.test(x)), '对话在前,快捷问题是极简那两句', v.quick);
        S.ok(/^v\d+/.test(await text(p, '#adv-go-plan .nav-now')), '「现在的方案」那条右边是 v几 · 日期');
        await go(p, '#/advisor/plan');
        const v2 = await advView(p);
        S.ok(/刷酸/.test(v2.line) && v2.lad.length >= 3, '方案页:一句话、阶梯都在', v2);
        await go(p, '#/tonight/week');
        const v3 = await advView(p);
        S.ok(v3.n7 === 7 && v3.shave === 0, '7 晚页:7 格;没开刮胡的人没有「刮」', v3);
        const d3 = await p.eval(`return __d(2)`);
        const b0 = await p.eval(`return document.querySelector('#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]').getAttribute('aria-pressed')`);
        await click(p, `#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]`, 300);
        const b1 = await p.eval(`return document.querySelector('#adv-n7 .n7-b[data-date="${d3}"][data-k=shower]').getAttribute('aria-pressed')`);
        S.ok(b0 !== b1 && /\/tonight\/week$/.test(await p.eval(`return location.hash`)), '在 7 晚页点「澡」:即时改,重画后还停在这一页');
        await go(p, '#/advisor/guide');
        const v4 = await advView(p);
        S.ok(!v4.guide.includes('刮胡 = 机械性去角质') && !v4.guide.includes('HRT 和长痘') && v4.guide.includes('怎么用'), '常识:Cici 视角没有刮胡、HRT 两节', v4.guide);
        const how = await p.eval(`document.querySelector('[data-gtoggle=use]').click();return document.getElementById('g-b-use').innerText`);
        S.ok(/今晚没做/.test(how) && !/每晚点一下做了哪几步/.test(how), '「怎么用」按模式只讲极简那段', how);
        S.ok(!/「顾问」页的未来 7 晚|设置里的「通常/.test(how), '指路文案:不再说在顾问页 / 设置里改洗澡习惯', how);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['对话 · 回答没收完(连接断了)不当完整回答;等的时候有「停一下」', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true });
        await tab(p, 'advisor', 300);
        await p.eval(`__AIF.chat=[['delta',{t:'今晚可以刷酸，但先'}]];return 1`);   // 没有 done:半截
        await p.eval(`const t=document.getElementById('adv-text');t.value='今晚能刷酸吗';t.dispatchEvent(new Event('input'));document.getElementById('adv-send').click();return 1`);
        await p.waitFor(`!document.getElementById('adv-stream')`, 5000).catch(() => { });
        await sleep(200);
        const r = await p.eval(ADV + `return {ai:qa('#adv-log .msg.ai').length,me:qa('#adv-log .msg.me').length,draft:(q('#adv-text')||{}).value||'',toast:(q('#sync-toast-el')||{}).textContent||''}`);
        S.ok(r.ai === 0 && r.me === 0 && r.draft === '今晚能刷酸吗' && /没收完/.test(r.toast) && !/Load failed|TypeError/.test(r.toast), '没收完:不存半句话,问题放回输入框,提示「这条回答没收完」', r);
        // 「停一下」:流式进行中出现,点了就停,问题放回输入框
        await p.eval(`__AIF.chat=[['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['delta',{t:'想'}],['done',{text:'想想想',model:'claude-test',effort:'medium',cost:0.01}]];
            const f=window.fetch;window.fetch=async(u,i)=>{const res=await f(u,i);if(!String(u).endsWith('/api/chat'))return res;const rd=res.body.getReader();
              return new Response(new ReadableStream({async pull(c){await new Promise(r=>setTimeout(r,150));const x=await rd.read();if(x.done)c.close();else c.enqueue(x.value);}}),{status:200});};
            const t=document.getElementById('adv-text');t.value='慢慢说';t.dispatchEvent(new Event('input'));document.getElementById('adv-send').click();return 1`);
        await p.waitFor(`!!document.getElementById('adv-stop')`, 3000);
        await p.eval(`document.getElementById('adv-stop').click();return 1`);
        await p.waitFor(`!document.getElementById('adv-stop')`, 4000).catch(() => { });
        const s2 = await p.eval(ADV + `return {ai:qa('#adv-log .msg.ai').length,draft:(q('#adv-text')||{}).value||'',busy:!!q('#adv-stream')}`);
        S.ok(s2.ai === 0 && !s2.busy && s2.draft === '慢慢说', '「停一下」:停下、不存回答、问题放回输入框', s2);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['对话 · 顾问改今晚:修订线两处联动', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true });
        await tab(p, 'tonight', 400);
        const steps = await p.eval(`return [...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)`);
        const prods = await p.eval(`return (${DATA}.sk_proddefs1||[]).map(x=>x.name)`);
        const target = steps.find(s => /眼部精华|眼霜|保湿|Toleriane/.test(s)) || steps.find(s => s.length > 6);
        await p.eval(`__AIF.chat=[['delta',{t:'可以。'}],['action',{id:'act-1',message:'跳过一步',changes:[{op:'skip',product:${JSON.stringify(target)},why:'测试跳过'}],dropped:[]}],['done',{text:'可以，今晚跳过这一步。',model:'claude-test',effort:'medium',cost:0.01}]];return 1`);
        await tab(p, 'advisor', 300);
        await say(p, '今晚能少一步吗');
        let v = await advView(p);
        const tnai = await p.eval(`return ${DATA}.sk_tnai1`);
        S.ok(v.revs.length === 1 && /^applied:撤销/.test(v.revs[0]) && tnai && tnai.id === 'act-1' && tnai.ops[0].op === 'skip', '顾问的今晚小改直接生效(sk_tnai1),对话里挂一条修订线「撤销」', { revs: v.revs, tnai, target, prods: prods.length });
        const chatBody = await p.eval(`return (__AIF.log||[]).filter(x=>x.p==='/api/chat').pop().body`);
        S.ok(chatBody && chatBody.context && chatBody.context.acid && Array.isArray(chatBody.context.week) && chatBody.live, '发出去的请求带 context(含本周刷酸、未来 7 晚)+ live', Object.keys(chatBody || {}));
        await tab(p, 'tonight', 300);
        const t1 = await p.eval(`return {rev:(document.getElementById('tn-rev')||{}).innerText||'',steps:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)}`);
        S.ok(/撤销/.test(t1.rev) && !t1.steps.includes(target), '今晚页同一件事:步骤少了这支,顶上一条修订线「撤销」', t1);
        await click(p, '#tn-rev [data-act=undo]', 300);
        await tab(p, 'advisor', 300);
        v = await advView(p);
        S.ok(/^undone:重做/.test(v.revs[0]), '在今晚页撤销 → 对话里这条跟着变「已撤销 · 重做」', v.revs);
        await click(p, '#adv-log .rev-act', 300);
        v = await advView(p);
        await tab(p, 'tonight', 300);
        const t2 = await p.eval(`return {rev:(document.getElementById('tn-rev')||{}).innerText||'',steps:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)}`);
        S.ok(/^applied:撤销/.test(v.revs[0]) && /撤销/.test(t2.rev) && !t2.steps.includes(target), '在对话里「重做」→ 今晚页又按顾问改的来(修订线回来)', { revs: v.revs, t2 });
        await tab(p, 'advisor', 300);
        await click(p, '#adv-log .rev-act', 300);
        await tab(p, 'tonight', 300);
        const t3 = await p.eval(`return {tnai:${DATA}.sk_tnai1,steps:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)}`);
        S.ok(!t3.tnai && t3.steps.includes(target), '在对话里「撤销」→ 今晚页回到改之前', t3);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['对话 · 顾问改方案 / 出方案 / 复盘:直接生效 + 撤销 + 要不要买跟着判断', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true });
        await p.eval(`(await import('/js/ui/products.js')).SHOP.delay=300;return 1`);
        await go(p, '#/advisor/plan', 300);
        const v0 = (await advView(p)).ver;
        await tab(p, 'advisor', 300);
        await p.eval(`__AIF.chat=[['delta',{t:'好。'}],['proposal',{id:'pp-1',message:'加到每周 2 次',changes:[{op:'acid_freq',product:'',value:'2',why:'前几次没反应'}],dropped:['某支不在库的']}],['done',{text:'这周起每周 2 次。',model:'claude-test',effort:'medium',cost:0.02}]];return 1`);
        await say(p, '能往前走一步吗');
        let v = await advView(p);
        const reg = await p.eval(`const h=${DATA}.sk_regimen1;return h[h.length-1]`);
        const vNav = await text(p, '#adv-go-plan .nav-now');
        await go(p, '#/advisor/plan', 300);
        const vp = await advView(p);
        S.ok(reg.source === 'ai' && reg.rules.acidCap === 2 && /顾问/.test(vp.ver) && vp.ver !== v0 && new RegExp('^v' + reg.v + ' ').test(vNav), '改方案直接生效:新的一版(source ai,每周 2 次),方案页版本行和首页「→」行的 v几 跟着变', { ver: vp.ver, nav: vNav, cap: reg.rules.acidCap });
        await tab(p, 'advisor', 300);
        S.ok(/^applied:撤销/.test(v.revs[0]) && /改了方案 v\d+ 改成 v\d+/.test(await text(p, '#adv-log .rev-h')) && /不在你产品库里/.test(await text(p, '#adv-log .rev')), '修订线:「改了方案 vN 改成 vN+1」+ 撤销;不在库的提一句', v.revs);
        S.ok(vp.lad.some(x => /^now:.*顾问定的/.test(x)), '阶梯「现在」那档换成顾问定的', vp.lad);
        await p.waitFor(`(__AIF.log||[]).some(x=>x.p==='/api/shop')`, 3000).catch(() => { });
        const sh = await p.eval(`return (__AIF.log||[]).filter(x=>x.p==='/api/shop').map(x=>x.body.trigger)`);
        S.ok(sh.length === 1 && /方案换成了 v/.test(sh[0]), '本机换了方案版本 → 防抖后让顾问判断一次「要不要买」(trigger 写明)', sh);
        await click(p, '#adv-log .rev-act', 300);
        v = await advView(p);
        const reg2 = await p.eval(`const h=${DATA}.sk_regimen1;return h[h.length-1]`);
        S.ok(/^undone:重做/.test(v.revs[0]) && reg2.kind === 'undo' && reg2.source !== 'ai', '撤销:方案回到上一版(撤销本身也记成一版),修订线变「重做」', { revs: v.revs, reg2: reg2.reason });
        await click(p, '#adv-log .rev-act', 300);
        v = await advView(p);
        S.ok(/^applied:撤销/.test(v.revs[0]), '重做:回到顾问那一版', v.revs);
        // 出方案(在方案页点「让顾问出方案」)
        await go(p, '#/advisor/plan', 300);
        await p.eval(`__AIF.plan={rationale:'按家里的东西出一版：每周 1 次杏仁酸起步。',rules:{acidCap:1,acidName:"Paula's Choice 6%杏仁酸+2%乳酸",acidZones:[],cleanse:'',repair:'spot',repairWhy:'闭口'},resting:[{name:'Sunday Riley Good Genes',why:'猛酸先放'}],gaps:[]};return 1`);
        await click(p, '#adv-plan [data-act=plan]', 100);
        await p.waitFor(`!document.querySelector('#adv-plan [data-act=plan][disabled]') && /按家里的东西出一版/.test(document.getElementById('adv-plan').innerText)`, 4000);
        const pv = await p.eval(`const h=${DATA}.sk_regimen1;return {last:h[h.length-1],line:document.getElementById('adv-line').textContent,hist:document.querySelector('#adv-hist summary').textContent,undo:!!document.querySelector('#adv-hist [data-latest="1"]')}`);
        S.ok(pv.last.kind === 'plan' && pv.last.rules.resting[0].name === 'Sunday Riley Good Genes' && /Good Genes 先不排/.test(pv.line) && pv.undo, '「让顾问出方案」:落成一版,一句话里写「先不排」,版本与撤销里最新一版能撤', pv);
        // 复盘
        await p.eval(`__AIF.review={headline:'这周稳',summary:'闭口少了。',wins:['没刺激'],issues:[],adjustments:[{type:'acid_freq',item:'',value:'2',reason:'稳了'}]};return 1`);
        // 复盘:按钮在对话区标题旁,结果出在对话里
        await tab(p, 'advisor', 300);
        S.ok(!(await has(p, '#adv-plan [data-act=review]')) && await has(p, '#adv-chat .sec-h [data-act=review]'), '「复盘这周」在对话区标题旁(方案页里没有)');
        await click(p, '#adv-chat .sec-h [data-act=review]', 100);
        await p.waitFor(`!!document.getElementById('adv-review')`, 4000);
        const rv = await p.eval(`return {t:document.getElementById('adv-review').innerText,ai1:${DATA}.sk_ai1}`);
        S.ok(/这周稳/.test(rv.t) && /撤销/.test(rv.t) && rv.ai1 && rv.ai1.review && rv.ai1.reviewWeek, '复盘:结论 + 调整直接生效可撤销;做过没有记在 sk_ai1(跨设备不重复)', rv);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['没开通 / 邀请码 / 连不上 / 额度 / 没回应', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'none', login: true });
        await tab(p, 'advisor', 400);
        let v = await advView(p);
        S.ok(v.acc === 'none' && await has(p, '#adv-code') && await has(p, '#adv-go-plan'), '邀请制:邀请码框;「现在的方案」入口照样在', v);
        await go(p, '#/advisor/plan', 300);
        S.ok(/刷酸每周/.test((await advView(p)).line), '邀请制:方案页照样有方案');
        await tab(p, 'advisor', 300);
        const pa = await design(p, '#adv-access');
        S.ok(!pa.lowCr.length && !pa.inputsLt16 && !pa.smallN, '邀请码那块:输入框 16px、触控 ≥44、对比度', pa);
        await p.eval(`document.getElementById('adv-code').value='WRONG-CODE';document.getElementById('adv-redeem').click();return 1`); await sleep(300);
        S.ok(/邀请码不对/.test(await text(p, '#sync-toast-el')) && (await advView(p)).acc === 'none', '错的邀请码:吐司说不对,还是邀请码框');
        await p.eval(`document.getElementById('adv-code').value='GOOD1-CODE2';document.getElementById('adv-redeem').click();return 1`);
        await p.waitFor(`!!document.getElementById('adv-dock')`, 4000);
        S.ok((await advView(p)).dock, '对的邀请码:开通,出现输入框');
        // 连不上
        await p.eval(`__AIF.mode='down';return 1`);
        await p.eval(`const t=document.getElementById('adv-text');t.value='在吗';document.getElementById('adv-send').click();return 1`); await sleep(600);
        v = await advView(p);
        S.ok(v.acc === 'down' && await has(p, '#adv-access [data-act=retry]') && await has(p, '#adv-go-plan'), '发的时候连不上:变成「暂时连不上 + 重试」,方案入口照样在,不白屏', v.acc);
        const kept = await p.eval(`return ([...document.querySelectorAll('#adv-log .msg.me')].length)`);
        S.ok(kept === 0, '没发出去的那句不留在对话里', kept);
        // 额度
        await p.eval(`__AIF.mode='quota';return 1`);
        await click(p, '#adv-access [data-act=retry]', 500);
        S.ok((await advView(p)).acc === 'quota' && /次数用完/.test(await text(p, '#adv-access')), '额度用完:一句话说明,不再给输入框');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['没回应:只自动核一次,不循环', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', aif: '{meErr:true}', login: true });
        await tab(p, 'advisor', 600);
        await tab(p, 'products', 200); await tab(p, 'advisor', 600);
        const n = await log(p, '/api/me');
        const v = await advView(p);
        S.ok(v.acc === 'noreply' && await has(p, '#adv-access [data-act=retry]'), '/api/me 出错:「顾问这会儿没回应」+ 重试', v.acc);
        S.ok(n <= 2, '来回切页:/api/me 只自动打了一两次(没有渲染 → 核 → 渲染的死循环)', n);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['常识 · 问顾问这一条只预填', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{profile:{hrt:true}}`, mode: 'on', login: true });
        await go(p, '#/advisor/guide', 400);
        const v = await advView(p);
        S.ok(v.guide.includes('HRT 和长痘') && v.asks === v.guide.length, '开了 HRT 的本人能看到 HRT 那节;开通了每节都有「问顾问这一条」', v);
        await click(p, '[data-gtoggle=doctor]', 100);
        const doc = await text(p, '#g-b-doctor');
        S.ok(/5 天/.test(doc) && /10 天/.test(doc) && /3 天/.test(doc) && /所有酸都停/.test(doc) && /眼霜照用/.test(doc), '「什么时候该看医生」= 现行口径(泛红 ≥5 / 冒痘 ≥10、最近 3 天还在、所有酸停、眼霜照用)', doc);
        const chats0 = await log(p, '/api/chat');
        await click(p, '#g-b-doctor [data-gask]', 400);
        const r = await p.eval(`return {v:document.getElementById('adv-text').value,active:document.getElementById('advisor').classList.contains('active'),h:location.hash}`);
        S.ok(/什么时候该看医生/.test(r.v) && r.active && r.h === '#/advisor' && (await log(p, '/api/chat')) === chats0, '「问顾问这一条」:回到顾问首页的对话、预填一句,不自动发(不花钱)', r);
        const pr = await design(p, '#advisor');
        S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.styleAttrs.length && pr.red === 0, '纸墨:0 emoji、字号 ≥12、对比度、没有 style=、这一屏不用红', pr);
        S.ok(!pr.smallN, '可点的都 ≥44', pr.small);
        // 方案页、常识页也过同一套纸墨验收(以前它们都在顾问首页里)
        for (const h of ['#/advisor/plan', '#/advisor/guide']) {
            await go(p, h, 400);
            const q2 = await design(p, '#advisor');
            S.ok(!q2.emoji.length && q2.minFs >= 12 && !q2.lowCr.length && !q2.styleAttrs.length && q2.red === 0 && !q2.smallN, '纸墨 ' + h + ':0 emoji、字号 ≥12、对比度、没有 style=、不用红、可点 ≥44', q2);
        }
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['深色 · 顾问页', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true, scheme: 'dark' });
        await tab(p, 'advisor', 400);
        const th = await p.eval(`return document.documentElement.dataset.theme`);
        const pr = await design(p, '#advisor');
        S.ok(th === 'dark' && !pr.emoji.length && !pr.lowCr.length && !pr.brightN && !pr.smallN, '跟随系统进深色:对比度够、没有刺眼的亮块、触控 ≥44', pr);
        for (const h of ['#/advisor/plan', '#/advisor/guide', '#/tonight/week']) {
            await go(p, h, 400);
            const q2 = await design(p, h.startsWith('#/tonight') ? '#tonight' : '#advisor');
            S.ok(!q2.emoji.length && !q2.lowCr.length && !q2.brightN && !q2.smallN, '深色 ' + h + ':对比度够、没有刺眼的亮块、触控 ≥44', q2);
        }
        S.ok(!p.errors.length, '0 console error', p.errors);
    }]
]);
