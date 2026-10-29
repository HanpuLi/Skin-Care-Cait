// 今晚页:首屏位置、三态步骤、状态芯片不出方案版本、极简的「今晚没做」不被补记、警告任何模式都显示、计时
const TOP = `document.documentElement.style.setProperty('--safe-top','59px');renderTn();await new Promise(r=>setTimeout(r,100));const f=document.querySelector('#tn-plan .step');return f?Math.round(f.getBoundingClientRect().top+scrollY):null`;
export default async function ({ origin, S, open }) {
    // ── 首屏:390×844、模拟主屏 App(顶部安全区 59px),两种模式、浅 / 深,第一步的 top ≤260 ──
    for (const scheme of ['light', 'dark']) for (const who of ['full', 'minimal']) {
        const p = await open({ scheme });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}()`);
        await p.reload(800);
        const y = await p.eval(TOP);
        S.ok(y !== null && y <= 260, `${who}/${scheme}:第一步的 top ≤260(standalone)`, y);
        const tx = await p.eval(`return document.getElementById('tonight').innerText`);
        S.ok(!/\d+\s*分/.test(tx) && !/屏障/.test(tx), `${who}/${scheme}:今晚页没有分数、没有「屏障」`, tx.slice(0, 200));
        S.ok(/^(修护夜|刷酸夜|面膜夜|维 A 夜|刮胡夜)$/.test(await p.eval(`return document.getElementById('tn-title').textContent`)), `${who}/${scheme}:标题是夜型`);
        S.ok(/^今晚 · (修护夜|刷酸夜|面膜夜|维 A 夜|刮胡夜)$/.test(await p.eval(`return document.getElementById('tn-h').textContent`)), `${who}/${scheme}:整行标题是「今晚 · 夜型」`);
    }

    // ── 完整模式:三态步骤写进记录;点 4 下状态,方案版本不变 ──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(800);
        const v0 = await p.eval(`return {v: currentRegimen().v, n: regimenHistory().length}`);
        // IA 重排 10/29:皮肤记录挪进「只记皮肤」/「完成今晚」之后的 sheet(#tn-skin 在 sheet 里)
        await p.eval(`openSkinSheet();await new Promise(r=>setTimeout(r,80));const seg=document.querySelectorAll('#tn-skin .seg button');seg[0].click();await new Promise(r=>setTimeout(r,80));
            document.querySelector('#tn-skin .skin-h .btn-link').click();
            const chips=()=>document.querySelectorAll('#tn-skin .syms .chip');chips()[0].click();await new Promise(r=>setTimeout(r,80));chips()[3].click();await new Promise(r=>setTimeout(r,80));
            document.querySelectorAll('#tn-skin .seg button')[2].click();return 1`);
        const v1 = await p.eval(`return {v: currentRegimen().v, n: regimenHistory().length, st: (lg(K.jrnl).find(e=>e.date===today())||{}).status}`);
        S.ok(v1.v === v0.v && v1.n === v0.n, '点 4 下皮肤状态,方案版本号和历史条数都不变', { v0, v1 });
        S.ok((v1.st || []).indexOf('变差') >= 0 && (v1.st || []).indexOf('好转') < 0, '三选一是单选,旧标签照样存(好转 / 稳定 / 变差)', v1.st);
        const r = await p.eval(`const li=document.querySelectorAll('#tn-plan .step');const n0=li[0].dataset.prod,n1=li[1].dataset.prod;
            li[0].querySelector('.step-main').click();await new Promise(r=>setTimeout(r,80));
            document.querySelectorAll('#tn-plan .step')[1].querySelector('.skip-btn').click();await new Promise(r=>setTimeout(r,80));
            const e=lg(K.jrnl).find(e=>e.date===today());const L=document.querySelectorAll('#tn-plan .step');
            return {n0,n1,done:e.stepsDone,skipped:e.skipped,aria:L[0].querySelector('.step-main').getAttribute('aria-checked'),cls0:L[0].className,cls1:L[1].className,deco:getComputedStyle(L[1].querySelector('.step-name')).textDecorationLine}`);
        S.ok((r.done || []).indexOf(r.n0) >= 0 && r.aria === 'true' && /done/.test(r.cls0), '点一步 = 做了(aria-checked、记进 stepsDone)', r);
        S.ok((r.skipped || []).indexOf(r.n1) >= 0 && /skipped/.test(r.cls1) && r.deco === 'none', '「没做」= 跳过,记进 skipped,名字不划线', r);
        // 计时:开始就显示倒数和结束钟点;到点有横幅(role=alert)
        const t = await p.eval(`const b=document.querySelector('#tn-plan .tmr');if(!b)return null;b.click();await new Promise(r=>setTimeout(r,1200));
            const on=document.querySelector('#tn-plan .tmr.on');const how=on&&on.closest('.step').querySelector('.step-how').textContent;const txt=on&&on.textContent;
            timerDone(Object.keys(_timers)[0]);const ban=document.getElementById('timer-banner');return {txt,how,ban:ban&&ban.getAttribute('role'),banTxt:ban&&ban.textContent}`);
        S.ok(t && /\d:\d\d/.test(t.txt) && /洗掉/.test(t.how) && t.ban === 'alert', '计时器:倒数 + 「几点洗掉」;到点有大横幅', t);
        // 没防晒:这条警告是注意卡(不进「今晚不用」、不划线、不降透明度)
        const spf = await p.eval(`PD.filter(p=>p.role==='spf').forEach(p=>{p.hidden=true});ls(K.prodDefs,PD);invalidatePlanCache();renderTn();
            const n=[...document.querySelectorAll('#tn-notes .note-caution')].find(x=>/防晒/.test(x.textContent));
            const sk=[...document.querySelectorAll('.skips li')].some(x=>/防晒/.test(x.textContent));
            return {n:!!n,sk,deco:n&&getComputedStyle(n.querySelector('p')).textDecorationLine,op:n&&getComputedStyle(n).opacity}`);
        S.ok(spf.n && !spf.sk && spf.deco === 'none' && +spf.op === 1, '没防晒的提醒是注意卡,不在「今晚不用」里,不划线', spf);
        S.ok(!p.errors.length, '完整模式:0 报错', p.errors);
    }

    // ── 极简模式:默认全做;只有活性步骤有「今晚没做」;点了的第二天不被补记;警告照样显示 ──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.minimal()`);
        await p.reload(800);
        const r = await p.eval(`const plan=computePlanRolling().find(d=>d.isToday);const ns=buildNightSteps(TN.shower,TN.shave,plan);
            const act=ns.steps.filter(s=>['acid','mask','retinol'].includes(s.kind)).map(s=>s.p);
            const withSkip=[...document.querySelectorAll('#tn-plan .step')].filter(li=>li.querySelector('.skip-btn')).map(li=>li.dataset.prod);
            return {act,withSkip,checkable:document.querySelectorAll('#tn-plan [role=checkbox]').length,done:document.querySelectorAll('#tn-plan .step.done').length,nag:/未记录|还没记/.test(document.getElementById('tonight').innerText)}`);
        S.ok(JSON.stringify(r.act) === JSON.stringify(r.withSkip), '极简:只有活性步骤有「今晚没做」', r);
        S.ok(r.checkable === 0 && r.done === 0, '极简:步骤不用点,也不画成已完成', r);
        S.ok(!r.nag, '极简:不催记录(没有「未记录」)', r);
        // 今晚把酸点成「没做」→ 写进今天的 skipped
        const sk = await p.eval(`const li=[...document.querySelectorAll('#tn-plan .step')].find(x=>x.querySelector('.skip-btn'));if(!li)return 'no-active';li.querySelector('.skip-btn').click();await new Promise(r=>setTimeout(r,80));
            return {name:li.dataset.prod,skipped:(lg(K.jrnl).find(e=>e.date===today())||{}).skipped,pressed:document.querySelector('#tn-plan [data-prod="'+CSS.escape(li.dataset.prod)+'"] .skip-btn').getAttribute('aria-pressed')}`);
        S.ok(sk === 'no-active' || ((sk.skipped || []).indexOf(sk.name) >= 0 && sk.pressed === 'true'), '极简:点「今晚没做」记进今天的 skipped', sk);
        const ab = await p.eval(`const pc=PD.find(p=>p.role==='acid'&&!hasTrait(p,'strong-exfo'));const y=__d(-1);
            const setup=skip=>{const j=(lg(K.jrnl)||[]).filter(e=>e.date!==y);j.push({date:y,status:[],products:[],note:'',phase:'',skipped:skip?[pc.name]:[]});ls(K.jrnl,j);ls(K.planday,{date:y,items:[{type:'acid',name:pc.name,tag:pc.journalTag||pc.name}]});};
            setup(true);absorbPrescribedHistory();const a=(lg(K.jrnl).find(e=>e.date===y).products||[]).slice();
            setup(false);absorbPrescribedHistory();const b=(lg(K.jrnl).find(e=>e.date===y).products||[]).slice();
            return {tag:pc.journalTag||pc.name,skipped:a,normal:b}`);
        S.ok(ab.skipped.indexOf(ab.tag) < 0 && ab.normal.indexOf(ab.tag) >= 0, '极简:标了「今晚没做」的酸第二天不补记;没标的照常推定', ab);
        S.ok(!p.errors.length, '极简:0 报错', p.errors);
    }
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.minimal({nomoist:true,profile:{repairUse:'spot'}})`);
        await p.reload(800);
        const w = await p.eval(`const t=document.getElementById('tonight').innerText;return {hit:/洗完全脸没有能涂的东西/.test(t),minimal:document.body.classList.contains('minimal')}`);
        S.ok(w.hit && w.minimal, '极简 + 没有保湿、修护霜只点涂:看得到「洗完全脸没有能涂的东西」', w);
    }
}
