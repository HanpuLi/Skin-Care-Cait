// 顾问:数据说明 —— 这个账号在这台设备上第一次进顾问页弹一次「顾问会看到什么」,点过就不再弹(按账号,本机键 sk_aiprivacy1,和 v1 同格式)。
// v2 迁移(P3):v1 这个文件的其余断言都已有新家,不重复(见 t/run.mjs 的退役说明):
//   邀请制 / 连不上 / 额度 / 没回应只核一次 / 修订条撤销重做 / 出方案 / 复盘 → t/v2-b-advisor.mjs;读成分标 → t/v2-b-products.mjs;
//   连不上 / 额度用完时今晚照常 → t/v2-a-tonight.mjs「顾问用不了」;SSE 解析、去 emoji、过闸、撤销 → engine-unit;
//   「ai.js 没加载」→ v2 没有单独的 ai.js(顾问层是 js/ai/*.js 模块,和 App 一起加载),退役。
// 这条在迁移时发现 v2 漏了(P2 只把说明放进了设置),已补回 js/ui/advisor.js maybeDataNotice。
// 另加一条整合时接上的联动:在对话里撤销了「改了今晚」,今晚页也显示「已撤销 · 重做」,点了走顾问页同一个 recAct,两边对得上。
import fs from 'node:fs';
import path from 'node:path';
import { fresh } from './v2-a-lib.mjs';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const tab = id => `document.getElementById('tab-${id}').click();${W8(300)}`;
export default async function ({ origin, S }) {
    // ── 没登录:进顾问页不弹(没有账号,也没有数据发出去)──
    {
        const p = await fresh(origin, { seed: 'full' });
        try {
            const r = await p.eval(`${tab('advisor')}return {n:!!document.getElementById('ai-privacy'),key:localStorage.getItem('sk_aiprivacy1')}`);
            S.ok(!r.n && !r.key, '没登录:进顾问页不弹数据说明', r);
        } finally { p.done(); }
    }
    // ── 登录了:第一次进顾问页弹一次;点「知道了」记下,再进 / 刷新都不弹;换个账号再弹 ──
    {
        const p = await fresh(origin, { seed: 'full', mode: 'on', login: true, notice: false });
        try {
            const tn = await p.eval(`${tab('tonight')}return !!document.getElementById('ai-privacy')`);
            S.ok(!tn, '登录后停在今晚页:不弹(第一次进顾问页才弹)', tn);
            // 没看过说明之前不自动外发:今晚照离线排,给「先看一下」
            const tn0 = await p.eval(`${W8(300)}return {src:(document.getElementById('tn-src')||{}).textContent||'',n:(__AIF.log||[]).filter(x=>x.p==='/api/tonight').length}`);
            S.ok(/先看一下/.test(tn0.src) && tn0.n === 0, '没看过「顾问会看到什么」:今晚页不自动请顾问,写明离线排法 + 「先看一下」', tn0);
            const r = await p.eval(`${tab('advisor')}const ov=document.getElementById('ai-privacy');return ov?{t:ov.querySelector('.sheet-t').textContent,b:ov.querySelector('.sheet-b').innerText,btn:[...ov.querySelectorAll('.sheet-actions .btn')].map(x=>x.textContent)}:null`);
            S.ok(r && r.t === '顾问会看到什么' && /Anthropic/.test(r.b) && /不存对话和照片/.test(r.b) && /只存在这台设备上/.test(r.b) && /设置 › 数据说明/.test(r.b) && r.btn.includes('知道了'),
                '第一次进顾问页:弹「顾问会看到什么」(发到哪、存什么、不存什么,详细的在设置)', r);
            await p.eval(PROBE + ';return 1');
            const pr = await p.eval(`return __probe('#ai-privacy')`);
            S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.smallN && !pr.styleAttrs.length && pr.red === 0, '数据说明 sheet:0 emoji、字号、对比度、触控、没有 style=、不用红', pr);
            const k = await p.eval(`[...document.querySelectorAll('#ai-privacy .sheet-actions .btn')].find(b=>b.textContent==='知道了').click();${W8(150)}
                const v=JSON.parse(localStorage.getItem('sk_aiprivacy1')||'null');${tab('products')}${tab('advisor')}return {v,again:!!document.getElementById('ai-privacy'),cloud:Object.keys((${'(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith("sk_sync_v1:"));const k=ks.find(x=>x!=="sk_sync_v1:")||ks[0];return JSON.parse(localStorage.getItem(k)).data})()'})).includes('sk_aiprivacy1')}`);
            S.ok(k.v && k.v.uid === 'u-test' && k.v.at > 0 && !k.again && !k.cloud, '点「知道了」:按账号记在本机(不进云),再进顾问页不弹', k);
            const tn1 = await p.eval(`${tab('tonight')}for(let i=0;i<30&&!(__AIF.log||[]).some(x=>x.p==='/api/tonight');i++)${W8(100)}return (__AIF.log||[]).filter(x=>x.p==='/api/tonight').length`);
            S.ok(tn1 >= 1, '看过之后回到今晚页:才自动请顾问排今晚', tn1);
            await p.reload(600);
            await p.eval(`fakeCloud.auth({uid:'u-test',email:'t@example.com',displayName:'Tester Name',getIdToken:async()=>'fake-id-token'});${W8(400)}return 1`);
            const again = await p.eval(`${tab('advisor')}return !!document.getElementById('ai-privacy')`);
            S.ok(!again, '刷新后再进:不弹', again);
            // v1 弹过的(同一个键、同一种格式)也算看过;别的账号看过的不算
            const other = await p.eval(`localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-other',at:1}));${tab('products')}${tab('advisor')}return !!document.getElementById('ai-privacy')`);
            S.ok(other, '只记着别的账号看过:这个账号进顾问页照样弹(按账号)', other);
            S.ok(!p.errors.length, '数据说明 0 报错', p.errors);
        } finally { p.done(); }
    }
    // ── 对话里撤销「改了今晚」→ 今晚页也给「重做」,点了两边一起回到生效 ──
    {
        const p = await fresh(origin, { seed: 'full', mode: 'on', login: true });
        try {
            const eye = await p.eval(`localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test',at:1}));${tab('tonight')}
                return [...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent).find(s=>/眼部|眼霜/.test(s))||''`);
            await p.eval(`__AIF.chat=[['delta',{t:'可以。'}],['action',{id:'act-r',message:'跳过一步',changes:[{op:'skip',product:${JSON.stringify(eye)},why:'今晚想简单点'}],dropped:[]}],['done',{text:'可以，今晚跳过眼霜。',model:'claude-test',effort:'medium',cost:0.01}]];
                ${tab('advisor')}const t=document.getElementById('adv-text');t.value='今晚能少一步吗';t.dispatchEvent(new Event('input'));document.getElementById('adv-send').click();
                for(let i=0;i<40&&!document.querySelector('#adv-log .rev');i++)${W8(100)}return 1`);
            const v = () => p.eval(`const rv=document.querySelector('#adv-log .rev');const chat=rv?rv.dataset.state:'';${tab('tonight')}
                const bar=document.getElementById('tn-rev');return {chat,bar:bar?bar.innerText.replace(/\s+/g,' '):'',act:bar?(bar.querySelector('[data-act]')||{dataset:{}}).dataset.act:'',eye:[...document.querySelectorAll('#tn-plan .step-name')].some(x=>x.textContent===${JSON.stringify(eye)})}`);
            const a = await v();
            S.ok(eye && a.chat === 'applied' && a.act === 'undo' && !a.eye, '顾问改了今晚:对话里是生效中,今晚页有「顾问 · 改了今晚 · 撤销」,眼霜那步不在了', a);
            await p.eval(`${tab('advisor')}document.querySelector('#adv-log .rev [data-recact]').click();${W8(250)}return 1`);
            const b = await v();
            S.ok(b.chat === 'undone' && b.act === 'redo-chat' && /已撤销/.test(b.bar) && b.eye, '在对话里撤销:今晚页也显示「已撤销 · 重做」,眼霜回来了', b);
            await p.eval(`${tab('tonight')}document.querySelector('#tn-rev [data-act="redo-chat"]').click();${W8(250)}return 1`);
            const c = await p.eval(`${tab('advisor')}return 1`).then(v);
            S.ok(c.chat === 'applied' && c.act === 'undo' && !c.eye, '在今晚页点「重做」:两边一起回到生效(同一个 recAct)', c);
            S.ok(!p.errors.length, '修订线联动 0 报错', p.errors);
        } finally { p.done(); }
    }
}
