// v2 外壳的最小启动测试(无头 Chrome):index.html 能加载、四个 tab 能切、0 console error;
// 种子数据下引擎在浏览器里也跑得通(直接 import 模块,App 代码里不挂测试钩子);离线(Firebase CDN 被掐断)照样能用;
// 第二个窗口拿不到锁,一个字不动。
//   跑:  node t/v2-boot.mjs        (需要本机有 Google Chrome;不联网、不登录)
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, suite, sleep } from './harness.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
const S = suite('v2-boot');
const srv = await serve();
const origin = 'http://127.0.0.1:' + srv.address().port;
const BOOTED = 'document.documentElement.dataset.boot==="ok"';
async function open(br, url, opts) {
    const p = await page(br, origin, Object.assign({ pre: PRE }, opts || {}));
    await p.send('Page.navigate', { url });
    await p.waitFor('document.readyState==="complete"', 8000);
    return p;
}
// 关掉标签页(放掉它的窗口锁);只断 websocket 的话标签页还开着、锁还占着
async function closeTab(p) { p.send('Page.close'); await sleep(400); p.close(); }
let br;
try {
    br = await browser();
    // ── 新设备:空数据 ──
    {
        const p = await open(br, origin + '/index.html');
        await p.waitFor(BOOTED, 8000);
        const r = await p.eval(`const tabs=[...document.querySelectorAll('.tab')].map(t=>t.textContent.trim());
            const out={tabs,titles:{}};
            for (const id of ['tonight','advisor','record','products']) {
                document.getElementById('tab-'+id).click(); await new Promise(r=>setTimeout(r,60));
                const sec=document.getElementById(id);
                out.titles[id]={active:sec.classList.contains('active'),h:(sec.querySelector('h1')||{}).textContent,todo:!!sec.querySelector('.p2-todo'),
                    others:[...document.querySelectorAll('.panel.active')].length,sel:document.getElementById('tab-'+id).getAttribute('aria-selected'),hash:location.hash};
            }
            out.font=getComputedStyle(document.body).fontFamily; out.bg=getComputedStyle(document.body).backgroundColor;
            out.globals=['store','sync','handleAuthChange','renderTn','ls','lg'].filter(k=>k in window);
            return out;`);
        S.ok(JSON.stringify(r.tabs) === JSON.stringify(['今晚', '顾问', '记录', '产品']), '四个 tab:今晚 / 顾问 / 记录 / 产品', r.tabs);
        const t = r.titles;
        S.ok(['tonight', 'advisor', 'record', 'products'].every(id => t[id].active && t[id].others === 1 && t[id].sel === 'true' && t[id].hash === '#/' + id),
            '每个 tab 点了都能切过去(只有一屏 active、aria-selected、地址栏 #/id)', t);
        // P2 之后:四屏都做出来了,「P2 待做」的占位不许再留着;今晚的标题是「今晚 · 夜型」(新用户空货架是「今晚 · 还没排」)
        S.ok(/^今晚 · \S/.test(t.tonight.h || '') && t.advisor.h === '顾问' && t.record.h === '记录' && t.products.h === '产品' && Object.values(t).every(x => !x.todo), '每屏有标题,「P2 待做」占位都撤了', t);
        S.ok(/Skin Serif SC/.test(r.font) && r.bg === 'rgb(244, 241, 234)', '纸墨 token 生效(宋体栈、纸色底)', { font: r.font, bg: r.bg });
        S.ok(!r.globals.length, 'App 不往 window 上挂东西(模块里没有全局)', r.globals);
        // 设置(印章)能打开,同步一行在
        const st = await p.eval(`document.getElementById('btn-settings').click();await new Promise(r=>setTimeout(r,80));
            const ov=document.getElementById('settings-sheet');return {open:!!ov,line:(document.getElementById('sync-line')||{}).textContent||'',signin:!!(ov&&ov.querySelector('[data-act=signin]'))}`);
        S.ok(st.open && /没登录/.test(st.line) && st.signin, '印章打开设置:没登录时写「数据只在这台设备上」,有登录按钮', st);
        // 地址栏直接进某个 tab
        await p.send('Page.navigate', { url: origin + '/index.html#/products' }); await sleep(300);
        await p.waitFor(BOOTED, 8000);
        const deep = await p.eval(`return document.getElementById('products').classList.contains('active')`);
        S.ok(deep, '地址栏 #/products 直接打开产品页', deep);
        S.ok(!p.errors.length, '新设备:0 console error', p.errors);
        S.ok(p.blocked.some(u => /gstatic/.test(u)), '(Firebase CDN 被掐断 = 离线场景)照样启动', p.blocked.slice(0, 3));
        await closeTab(p);
    }
    // ── 老用户(完整模式种子):引擎在浏览器里也跑得通,启动维护写了 planday / 方案,但都是 system(rev 不涨)──
    {
        const p = await open(br, origin + '/index.html');
        await p.eval(`__seed.full(); return 1`);
        await p.send('Page.reload', {}); await sleep(300);
        await p.waitFor(BOOTED, 8000);
        const r = await p.eval(`const {createStore}=await import('/js/store.js');const {buildWorld}=await import('/js/model/world.js');
            const {tonight}=await import('/js/engine/schedule.js');const {safetyGate}=await import('/js/engine/gate.js');
            const env=JSON.parse(localStorage.getItem('sk_sync_v1:'));
            const W=buildWorld({lg:k=>env.data[k]===undefined?null:JSON.parse(JSON.stringify(env.data[k])),ls:()=>true},{today:__d(0),noAbsorb:true});
            const tn=tonight(W);
            return {steps:tn.steps.map(s=>s.p),cap:safetyGate(W).acidCapMax,rev:env.rev,legacy:env.legacy,planday:!!env.data.sk_planday1,regimen:(env.data.sk_regimen1||[]).length}`);
        S.ok(r.steps.length >= 3 && r.cap >= 1, '完整模式种子:引擎在浏览器里排出今晚(洁面…保湿…修护)', r);
        S.ok(r.planday && r.regimen >= 1 && r.rev === 0, '启动维护写了 planday / 方案,都是 system(rev 不涨,不推送)', r);
        S.ok(!p.errors.length, '老用户:0 console error', p.errors);
        // ── 第二个窗口:拿不到锁,一个字不动 ──
        const p2 = await open(br, origin + '/index.html');
        await sleep(2500);
        const r2 = await p2.eval(`return {boot:document.documentElement.dataset.boot||'',lock:(document.querySelector('#app-lock .sheet-t')||{}).textContent||'',empty:!document.getElementById('tonight').innerHTML.trim()}`);
        S.ok(r2.boot !== 'ok' && /别的窗口/.test(r2.lock) && r2.empty, '第二个窗口:拿不到锁,不启动,提示「已经在别的窗口打开了」', r2);
        S.ok(!p2.errors.length, '第二个窗口 0 console error', p2.errors);
        await closeTab(p2); await closeTab(p);
    }
    // ── 切 tab 回顶:顾问页滚下去后切到今晚,今晚的标题在视口里(四屏共用文档滚动,各记各的位置)──
    {
        const p = await open(br, origin + '/index.html');
        await p.eval(`__seed.full(); return 1`);
        await p.send('Page.reload', {}); await sleep(300);
        await p.waitFor(BOOTED, 8000);
        const r = await p.eval(`document.getElementById('tab-advisor').click();await new Promise(r=>setTimeout(r,100));
            document.body.style.minHeight='4000px';window.scrollTo(0,1138);await new Promise(r=>setTimeout(r,60));const y0=window.scrollY;
            document.getElementById('tab-tonight').click();await new Promise(r=>setTimeout(r,100));
            const h=document.getElementById('tonight-h')||document.querySelector('#tonight h1');const top=h?h.getBoundingClientRect().top:-1;const y1=window.scrollY;
            document.getElementById('tab-advisor').click();await new Promise(r=>setTimeout(r,100));const y2=window.scrollY;document.body.style.minHeight='';
            return {y0,y1,top,y2,ih:innerHeight}`);
        S.ok(r.y0 > 500 && r.top >= 0 && r.top < r.ih, '顾问页滚下去后切到今晚:今晚的标题在视口里', r);
        S.ok(Math.abs(r.y2 - r.y0) < 2, '切回顾问:回到刚才滚到的位置', r);
        S.ok(!p.errors.length, '切 tab:0 console error', p.errors);
        await closeTab(p);
    }
    // ── 模块图里一个文件没加载到:不是没有提示的空壳,8 秒内给「重新加载」──
    {
        const p = await open(br, origin + '/index.html', { blockPaths: ['/js/ui/guide.js'] });
        await sleep(300);
        await p.waitFor('!!document.getElementById("boot-fail")', 9500).catch(() => { });
        const r = await p.eval(`const ov=document.getElementById('boot-fail');return {boot:document.documentElement.dataset.boot||'',ov:!!ov,t:ov?(ov.querySelector('.sheet-t')||{}).textContent:'',btn:ov?[...ov.querySelectorAll('button')].map(b=>b.textContent):[]}`);
        S.ok(r.ov && r.boot !== 'ok' && /没加载完整/.test(r.t) && r.btn.indexOf('重新加载') >= 0, '掐掉一个模块:8 秒内出现「这一版没加载完整」+ 重新加载', r);
        await closeTab(p);
    }
    // ── 深色 ──
    {
        const p = await open(br, origin + '/index.html', { scheme: 'dark' });
        await p.waitFor(BOOTED, 8000);
        const r = await p.eval(`return {theme:document.documentElement.dataset.theme,bg:getComputedStyle(document.body).backgroundColor}`);
        S.ok(r.theme === 'dark' && r.bg === 'rgb(22, 20, 18)', '深色:跟随系统,夜色底', r);
        S.ok(!p.errors.length, '深色 0 console error', p.errors);
        await closeTab(p);
    }
} catch (e) { S.ok(false, '抛异常: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); }
finally { if (br) br.close(); srv.close(); }
console.log(`\n${S.failed.length ? '✗ ' + S.failed.length + ' 条失败' : '✓ 全部通过'}(${S.res.length} 条)`);
process.exit(S.failed.length ? 1 : 0);
