// 「要不要买新的」交给顾问(Cait 10/29):只在本机操作后自动跑(同步来的 / 方案自动重出 / 第一次打开都不自动调)、防抖、签名没变不重调;顾问版渲染(三档 / 接班 / 型号链接 / 不用买的);
// 跑着时留着上次结果、货架变了标「可能过时」;顾问用不了 / 出错 → 退回离线清单;复制清单用顾问版;换账号不串。全用假后端 __AIF。
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
export default async function ({ origin, S, open }) {
    const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
    const SEED = `{extra:{sk_empty1:{toleriane:[{date:__d(-5),weeks:8,uses:30}],avene:[{date:__d(-90),weeks:20,uses:40}]}}}`;
    const boot = async (mode, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${o.seed || 'full'}(${o.seedArg || SEED})`);
        await p.reload(800);
        await p.eval(`_aiShopDelay=${o.delay || 120};__login();window.__AIF=Object.assign({mode:'${mode}'},${o.aif || '{}'});localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test'}));await aiProbe(true);return 1`);
        return p;
    };
    const CALLS = `(__AIF.log||[]).filter(x=>x.p==='/api/shop')`;
    const VIEW = `({ai:document.getElementById('shop-ai').innerText,offHidden:document.getElementById('shop-off').hidden,off:document.getElementById('shop-pending').innerText,
        redo:(b=>({hidden:b.hidden,disabled:b.disabled,text:b.textContent}))(document.getElementById('shop-redo'))})`;

    // ── 第一次打开:不自动调;离线清单 +「让顾问判断」;点了才跑,带 low / emptied / region ──
    {
        const p = await boot('on');
        const r0 = await p.eval(`show('prods');${wait(600)}return {n:${CALLS}.length,v:${VIEW}}`);
        S.ok(r0.n === 0 && !r0.v.offHidden && r0.v.off.length > 0 && !r0.v.redo.hidden && r0.v.redo.text === '让顾问判断', '第一次打开(本机没结果):不自动调,离线清单 +「让顾问判断」', r0);
        const r1 = await p.eval(`document.getElementById('shop-redo').click();${wait(400)}const c=${CALLS};return {n:c.length,trig:c[0]&&c[0].body.trigger,ctx:c[0]&&{low:c[0].body.context.low,emptied:c[0].body.context.emptied,region:c[0].body.context.region},
            rec:(()=>{const r=JSON.parse(localStorage.getItem('sk_ai_shop1'));return r&&{uid:r.uid,sig:r.sig===aiShopSig(),at:!!r.at}})(),cloud:CLOUD_KEYS.indexOf('sk_ai_shop1'),v:${VIEW}}`);
        S.ok(r1.n === 1 && r1.trig === '她点了「让顾问判断」', '点「让顾问判断」:后台调一次 /api/shop,trigger 写明', r1);
        S.ok(Array.isArray(r1.ctx.low) && r1.ctx.region === 'GB' && r1.ctx.emptied.length === 1 && r1.ctx.emptied[0].weeks === 8 && /Toleriane/.test(r1.ctx.emptied[0].name),
            'context 带 low、近 60 天的空瓶(90 天前的不带)、region=GB', r1.ctx);
        S.ok(r1.rec && r1.rec.uid === 'u-test' && r1.rec.sig && r1.rec.at && r1.cloud < 0, '结果按账号存本机 sk_ai_shop1(带 uid / 签名 / 时间),不进 CLOUD_KEYS', r1);
        const v = await p.eval(`const a=document.getElementById('shop-ai');const det=a.querySelector('details.shop-skip');const before=det&&det.open;if(det)det.querySelector('summary').click();${wait(50)}
            return {txt:a.innerText,groups:[...a.querySelectorAll('.shop-g>.sec-t')].map(x=>x.textContent),
                links:[...a.querySelectorAll('.picks a')].map(x=>({t:x.textContent,href:x.getAttribute('href'),tg:x.target,rel:x.rel})),plain:[...a.querySelectorAll('.pick-n')].map(x=>x.textContent),
                skipSum:det&&det.querySelector('summary').innerText,skipBefore:before,skipOpen:det&&det.open,skipBody:det&&det.querySelector('.fold-body').innerText,offHidden:document.getElementById('shop-off').hidden,redo:${VIEW}.redo}`);
        S.ok(v.offHidden && /缺一支洗澡夜用的强清洁/.test(v.txt) && v.groups.join() === '现在就缺,快用完前备上,可买可不买', '顾问版:summary 一句 + 按「现在就缺 / 快用完前备上 / 可买可不买」分组,离线清单收起', v);
        S.ok(/强清洁洁面/.test(v.txt) && /为什么：近两周常出油/.test(v.txt) && /买到之前：暂时用温和洁面洗两遍/.test(v.txt) && /接班「La Roche-Posay Toleriane Sensitive Fluide」/.test(v.txt),
            '每条写 need / what / why / cover,接班的写「接班 X」', v.txt);
        S.ok(v.links.length === 2 && v.links.every(l => /^https:\/\//.test(l.href) && l.tg === '_blank' && /noopener/.test(l.rel)) && v.plain.join() === 'La Roche-Posay Effaclar Gel' && /£12 · Boots/.test(v.txt),
            '型号:有 url 的可点(新窗口、rel=noopener),没 url 的只写名字;价格 · 在哪买', v);
        S.ok(/这些不用买：B5 修复霜、杏仁酸/.test(v.skipSum) && v.skipBefore === false && v.skipOpen && /只点涂，用得很慢/.test(v.skipBody), 'skip 收成一行「这些不用买:…」,点开看原因', v);
        S.ok(!v.redo.hidden && !v.redo.disabled && v.redo.text === '重新判断', '有结果后按钮是「重新判断」', v.redo);

        // 同步来的签名变化 / 方案自动重出:不调,只标「可能过时」
        const rs = await p.eval(`const id=shelfProducts().find(x=>!isLow(x.id)).id;_applyingCloud=true;ls(K.low,LOW.concat([id]));_applyingCloud=false;renderAll();${wait(600)}
            const a={n:${CALLS}.length,v:${VIEW}};_applyingCloud=true;ls(K.low,LOW.filter(x=>x!==id));_applyingCloud=false;renderAll();
            const v0=(currentRegimen()||{}).v;syncRegimen('测试：自动重出',true);renderAll();${wait(600)}return {a,n:${CALLS}.length,v0,v1:(currentRegimen()||{}).v,v:${VIEW}}`);
        S.ok(rs.a.n === 1 && /货架变了，结果可能过时/.test(rs.a.v.ai), '云端同步来的「快用完」:不调,只标「货架变了,结果可能过时」', rs.a);
        S.ok(rs.n === 1 && rs.v1 > rs.v0 && /可能过时/.test(rs.v.ai), '方案自动重出一版(不是本机操作):不调,标「可能过时」', rs);
        await p.eval(`await aiShopRedo();return 1`);
        // 签名没变:重画多少遍都不重调
        const r2 = await p.eval(`renderProds();renderProds();renderAll();show('tonight');show('prods');${wait(500)}return ${CALLS}.length`);
        S.ok(r2 === 2, '货架签名没变:重画 / renderAll 都不重调', r2);

        // 标快用完 → 先标「可能过时」,防抖后重判一次,trigger 说清楚
        const r3 = await p.eval(`_aiShopDelay=400;const pr=shelfProducts().find(x=>x.role==='moist')||shelfProducts()[0];window.__pn=pr.name;toggleLow(pr.id);${wait(60)}
            const v1=${VIEW};${wait(900)}const c=${CALLS};return {v1,n:c.length,trig:c[c.length-1].body.trigger,low:c[c.length-1].body.context.low,name:pr.name,v2:${VIEW}}`);
        S.ok(/货架变了，结果可能过时/.test(r3.v1.ai) && /缺一支洗澡夜用的强清洁/.test(r3.v1.ai), '标了快用完、还没重判:留着上次结果并标「货架变了,结果可能过时」', r3.v1.ai);
        S.ok(r3.n === 3 && r3.trig.indexOf('标了「' + r3.name + '」快用完了') >= 0 && r3.low.indexOf(r3.name) >= 0, '本机标快用完:防抖后重判一次,trigger 写「标了 X 快用完了」,context.low 带上它', r3);
        S.ok(!/可能过时/.test(r3.v2.ai), '重判完:「可能过时」消失', r3.v2.ai);

        // 防抖:5 秒窗口里连改两下只调一次;改了又改回来(签名回到原样)不调
        const r4 = await p.eval(`const sh=shelfProducts().filter(x=>!isLow(x.id));toggleLow(sh[0].id);${wait(150)}toggleLow(sh[1].id);${wait(1000)}const n1=${CALLS}.length;const t1=${CALLS}[n1-1].body.trigger;
            toggleLow(sh[2].id);${wait(100)}toggleLow(sh[2].id);${wait(900)}return {n1,t1,n2:${CALLS}.length,a:sh[0].name,b:sh[1].name}`);
        S.ok(r4.n1 === 4 && r4.t1.indexOf(r4.a) >= 0 && r4.t1.indexOf(r4.b) >= 0, '防抖:连着两次本机操作只调一次,trigger 两支都写', r4);
        S.ok(r4.n2 === 4, '标了又撤回(签名回到上次判断时):不调', r4);

        // 跑着时:保留上次结果 +「顾问在查…」;按钮变「在查…」不能连点
        const r5 = await p.eval(`__AIF.shopMs=700;aiShopRedo();${wait(120)}const v1=${VIEW};aiShopRedo();${wait(1000)}return {v1,n:${CALLS}.length,trig:${CALLS}[${CALLS}.length-1].body.trigger,v2:${VIEW}}`);
        S.ok(/顾问在查/.test(r5.v1.ai) && /缺一支洗澡夜用的强清洁/.test(r5.v1.ai) && r5.v1.redo.disabled && r5.v1.redo.text === '在查…', '跑着时保留上次结果并标「顾问在查…」,按钮变「在查…」', r5.v1);
        S.ok(r5.n === 5 && /重新判断/.test(r5.trig) && !/顾问在查/.test(r5.v2.ai), '「重新判断」立刻调一次(trigger 写明),跑着时再点不会叠一次', r5);

        // 复制清单 = 顾问版
        const r6 = await p.eval(`window.__copied=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t}}});copyShop();${wait(100)}return {t:window.__copied,b:document.getElementById('cpb').textContent}`);
        S.ok(r6.t && /顾问/.test(r6.t) && /现在就缺/.test(r6.t) && /CeraVe Foaming Cleanser 236ml（£12，Boots） https:\/\/www\.boots\.com/.test(r6.t) && /接班「La Roche-Posay Toleriane Sensitive Fluide」/.test(r6.t) && /这些不用买：B5 修复霜（只点涂/.test(r6.t) && r6.b === '复制好了',
            'copyShop 有顾问结果时复制顾问版(分组、型号、链接、接班、不用买的)', r6.t);

        // 0 emoji、版式
        const pr = await p.eval(`${PROBE};return __probe('#shop-sec')`);
        S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.smallN && !pr.styleAttrs.length && pr.red === 0, '顾问版:0 emoji、字号、对比度、可点的 ≥44、没有 style=、不用红', pr);

        // verdict=none
        const r7 = await p.eval(`__AIF.shopMs=0;__AIF.shop={verdict:'none',summary:'家里的够凑一整套，快用完的那支有接班。',items:[],skip:[{name:'保湿',why:'有接班'}]};await aiShopRedo();
            const t=document.getElementById('shop-ai').innerText;document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());copyShop();${wait(50)}
            return {t,sheet:(document.querySelector('#sheet-root .sheet-ov')||{}).innerText||''}`);
        S.ok(/^现在不用买。家里的够凑一整套/.test(r7.t) && !/现在就缺/.test(r7.t) && /现在不用买/.test(r7.sheet), 'verdict=none:直接说「现在不用买」+ summary;复制时也这么说', r7);
        S.ok(!p.errors.length, '顾问版 0 报错', p.errors);
    }

    // ── 深色:顾问版同样过版式探针 ──
    {
        const p = await boot('on', { page: { scheme: 'dark' } });
        const pr = await p.eval(`show('prods');await aiShopRedo();${wait(100)}${PROBE};return __probe('#shop-sec')`);
        S.ok(!pr.emoji.length && !pr.lowCr.length && !pr.smallN && !pr.brightN && pr.red === 0, '深色顾问版:0 emoji、对比度、触控、不刺眼', pr);
    }

    // ── 退回离线:后端连不上 / 没开通 / 出错;出错同一个签名不自动重试 ──
    {
        const p = await boot('down');
        const r = await p.eval(`show('prods');${wait(500)}return {n:${CALLS}.length,v:${VIEW}}`);
        S.ok(r.n === 0 && !r.v.offHidden && r.v.off.length > 0 && !r.v.ai.trim() && r.v.redo.hidden, '后端连不上:不调 /api/shop,产品页是离线清单,不显示「重新判断」', r);
        const c = await p.eval(`window.__copied=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t}}});copyShop();${wait(80)}return window.__copied||(document.querySelector('#sheet-root .sheet-ov')||{}).innerText`);
        S.ok(/护肤要买的（按方案缺口）|暂时不用买/.test(c || ''), '连不上时复制清单 = 离线那份', c);
    }
    {
        const p = await boot('none');
        const r = await p.eval(`show('prods');${wait(500)}return {n:${CALLS}.length,v:${VIEW}}`);
        S.ok(r.n === 0 && !r.v.offHidden && r.v.redo.hidden, '没开通(邀请制):不调,离线清单', r);
    }
    {
        const p = await boot('on', { aif: `{shopErr:'AI 这次没给出结论，再试一次。'}` });
        const r = await p.eval(`show('prods');${wait(300)}const n0=${CALLS}.length;await aiShopRedo();renderProds();${wait(400)}return {n0,n:${CALLS}.length,v:${VIEW}}`);
        S.ok(r.n0 === 0 && r.n === 1 && !r.v.offHidden && r.v.off.length > 0 && /顾问这次没查成（AI 这次没给出结论，再试一次。），下面先按离线规则看/.test(r.v.ai) && !r.v.redo.hidden,
            '出错:退回离线清单并说一句;不自动重试(按钮还在)', r);
        // 先有结果,货架变了再重判又出错 → 旧结果对不上货架,退回离线
        const r2 = await p.eval(`delete __AIF.shopErr;await aiShopRedo();const ok=${VIEW};__AIF.shopErr='顾问出错了（500）';toggleLow(shelfProducts()[0].id);${wait(600)}return {ok,v:${VIEW},n:${CALLS}.length}`);
        S.ok(r2.ok.offHidden && /缺一支/.test(r2.ok.ai), '重新判断成功:换成顾问版', r2.ok);
        S.ok(r2.n === 3 && !r2.v.offHidden && /没查成/.test(r2.v.ai) && !/缺一支/.test(r2.v.ai), '货架变了、重判又出错:旧结果对不上了,退回离线', r2);
        S.ok(!p.errors.length, '出错路径 0 报错', p.errors);
    }

    // ── 换账号不串 ──
    {
        const p = await boot('on');
        const r = await p.eval(`show('prods');await aiShopRedo();const a=${VIEW};__login('u-other');renderProds();const b=${VIEW};const raw=JSON.parse(localStorage.getItem('sk_ai_shop1'));
            await aiProbe(true);${wait(400)}const n1=${CALLS}.length;await aiShopRedo();const c=${CALLS};const raw2=JSON.parse(localStorage.getItem('sk_ai_shop1'));
            __login('u-test');await aiProbe(true);renderProds();const d=${VIEW};
            aiClearLocal();return {a,b,rawUid:raw.uid,n1,n:c.length,lastAuth:c[c.length-1].auth,raw2Uid:raw2.uid,d,cleared:localStorage.getItem('sk_ai_shop1')}`);
        S.ok(/缺一支/.test(r.a.ai) && r.b.offHidden === false && !/缺一支/.test(r.b.ai) && r.rawUid === 'u-test', '换到 B:看不到 A 的结果(按 uid 核),退回离线', r);
        S.ok(r.n1 === 1 && r.n === 2 && r.raw2Uid === 'u-other', 'B 开通后不自动调;B 点了才判断,存的是 B 的', r);
        S.ok(!/缺一支/.test(r.d.ai) && r.d.offHidden === false, '换回 A:本机那份已经是 B 的,A 不会读到 B 的', r.d);
        S.ok(r.cleared === null, 'aiClearLocal(换账号时 index.html 会调)清掉 sk_ai_shop1', r.cleared);
    }

    // ── ai.js 没加载:产品页照样出离线清单 ──
    {
        const p = await open({ blockPaths: ['/ai.js'] });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(900);
        const r = await p.eval(`show('prods');return {off:document.getElementById('shop-pending').innerText,offHidden:document.getElementById('shop-off').hidden,redo:document.getElementById('shop-redo').hidden}`);
        S.ok(r.off.length > 0 && !r.offHidden && r.redo, 'ai.js 没加载:离线清单照常,没有「重新判断」', r);
        S.ok(!p.errors.filter(e => !/ai\.js|Failed to load/.test(e)).length, 'ai.js 没加载:没有别的报错', p.errors);
    }
}
