// 新用户:空货架起步(不再灌内置的 15 件)、一屏一个问题、每步能跳过、第一晚不上活性;
// 老账号:货架原样、不重做引导,只弹一次新版导览。
const ADD = (name, role) => `showProdModal(null,{role:'${role}'});document.getElementById('m-name').value=${JSON.stringify(name)};saveProdModal();await new Promise(r=>setTimeout(r,60));`;
export default async function ({ origin, S, open }) {
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.fresh()`);
        await p.reload(2100);   // 没登录:等 1.8 秒(Firebase 认人)才决定进不进引导
        const r0 = await p.eval(`const ob=document.getElementById('oobe');return {oobe:!!ob,title:ob&&ob.querySelector('.sheet-title,h2')&&ob.querySelector('.sheet-title,h2').textContent,
            pd:PD.filter(x=>!x.hidden).length,empty:localStorage.getItem('sk_empty1'),popen:JSON.stringify(lg(K.popen)||{}),gone:JSON.stringify(lg(K.gone)||[]),
            steps:document.querySelectorAll('#tn-plan .step').length,tn:document.getElementById('tn-plan').innerText.slice(0,120)}`);
        S.ok(r0.oobe, '全新用户:打开就是引导', r0);
        S.ok(r0.pd === 0 && !r0.empty && r0.popen === '{}', '空货架:没有灌任何内置产品,也没有空瓶 / 开封记录', r0);
        S.ok(!p.errors.length, '空货架打开 0 报错', p.errors);
        // 逐步走:欢迎 → (没登录跳过邀请)→ 怎么用 → 家里有什么 → 皮肤 → 第一版
        const steps = [];
        const st = async () => (await p.eval(`return _oobe&&_oobe.step`));
        steps.push(await st());
        // 用户真正点的是按钮:按文字找按钮点(找不到就是卡死在这一屏)
        const click = async (txt) => p.eval(`const b=[...document.querySelectorAll('#oobe button')].find(x=>x.textContent.trim().indexOf(${JSON.stringify(txt)})===0);if(!b)return false;b.click();await new Promise(r=>setTimeout(r,80));return true`);
        const clicked = [];
        clicked.push(await click('先在这台手机上试试')); steps.push(await st());
        clicked.push(await click('只要告诉我今晚做什么')); steps.push(await st());
        const shelfEmpty = await p.eval(`return document.getElementById('oobe').innerText`);
        await p.eval(ADD('Test Gentle Cleanser', 'cleanse') + ADD('Test Barrier Cream', 'moist') + ADD('Test Mandelic 10%', 'acid') + 'return 1');
        const shelf = await p.eval(`return {txt:document.getElementById('oobe').innerText,pd:PD.filter(x=>!x.hidden).map(x=>x.role)}`);
        clicked.push(await click('好了')); steps.push(await st());
        clicked.push(await click('没有')); clicked.push(await click('下一步')); steps.push(await st());
        S.ok(clicked.every(Boolean), '每一屏都有能点的「下一步」类按钮(没有卡死在哪一屏)', clicked);
        S.ok(JSON.stringify(steps) === JSON.stringify(['welcome', 'mode', 'shelf', 'skin', 'first']), '引导按顺序走,没登录就跳过邀请码那步', steps);
        S.ok(/稍后再说/.test(shelfEmpty) && /加好了 3 件/.test(shelf.txt), '「家里有什么」:空的时候能跳过;加了以后列出来', { shelfEmpty: shelfEmpty.slice(0, 80), shelf });
        const fin = await p.eval(`const fb=[...document.querySelectorAll('#oobe button')].find(x=>/好，看今晚/.test(x.textContent));if(!fb)return {noBtn:true};fb.click();await new Promise(r=>setTimeout(r,200));const g=safetyGate();
            const plan=computePlanRolling().find(d=>d.isToday);const ns=buildNightSteps(TN.shower,TN.shave,plan);
            return {onboarded:PROFILE.onboarded,oobeAt:PROFILE.oobeAt===today(),minimal:PROFILE.minimalMode,first:g.firstNight,cap:g.acidCapMax,
                kinds:ns.steps.map(s=>s.kind),names:ns.steps.map(s=>s.p),sheet:!!document.getElementById('oobe'),tab:document.getElementById('tonight').classList.contains('active'),
                note:document.getElementById('tn-notes').innerText}`);
        S.ok(fin.onboarded && fin.oobeAt && fin.minimal && !fin.sheet && fin.tab, '引导完成:记下已引导、选的极简模式,回到今晚页', fin);
        S.ok(fin.first && fin.cap === 0 && fin.kinds.every(k => k === 'base') && fin.names.indexOf('Test Mandelic 10%') < 0, '第一晚:不上任何活性(刚加的酸也不排)', fin);
        S.ok(fin.names.indexOf('Test Gentle Cleanser') >= 0 && fin.names.indexOf('Test Barrier Cream') >= 0, '第一晚:洁面 + 保湿照排', fin.names);
        // 重载:不再弹引导;货架还是她自己加的 3 件
        await p.reload(2100);
        const again = await p.eval(`return {oobe:!!document.getElementById('oobe'),pd:PD.filter(x=>!x.hidden).length,tour:!!document.getElementById('tour')}`);
        S.ok(!again.oobe && !again.tour && again.pd === 3, '重新打开:不再引导、不弹导览,货架就是她加的 3 件', again);
        S.ok(!p.errors.length, '新用户流程 0 报错', p.errors);
    }
    // 引导里说「有发红刺痛」→ 记进今天,安全闸当晚生效
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.fresh()`);
        await p.reload(800);
        const r = await p.eval(`startOOBE({});oobeGo('skin');const b=[...document.querySelectorAll('#oobe button')].find(x=>x.textContent.trim()==='有发红刺痛');b.click();const e=lg(K.jrnl).find(x=>x.date===today());return {st:e&&e.status,irr:safetyGate().irritated}`);
        S.ok((r.st || []).indexOf('泛红') >= 0 && r.irr, '引导里选「有发红刺痛」:记进今天,安全闸当晚就生效', r);
    }
    // 老账号:货架不动,不重做引导;没看过新版的弹一次导览
    for (const who of ['full', 'minimal']) {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}({profile:{tour3:false}})`);
        await p.reload(2100);
        const r = await p.eval(`const t=document.getElementById('tour');return {oobe:!!document.getElementById('oobe'),tour:!!t,n:t?t.querySelectorAll('.row').length:0,pd:PD.filter(x=>!x.hidden).length,
            txt:t?t.innerText:''}`);
        S.ok(!r.oobe && r.pd >= 12, `${who} 老账号:不进引导,货架原样(${r.pd} 件)`, r);
        S.ok(r.tour && r.n === (who === 'full' ? 3 : 2) && !/分数|记录/.test(who === 'minimal' ? r.txt : ''), `${who} 老账号:弹一次新版导览(${who === 'full' ? 3 : 2} 条${who === 'minimal' ? ',不提记录和分数' : ''})`, r);
        await p.eval(`const b=[...document.querySelectorAll('#tour button')].find(x=>/知道了/.test(x.textContent));b&&b.click();return 1`);
        await p.reload(2100);
        const r2 = await p.eval(`return !!document.getElementById('tour')`);
        S.ok(!r2, `${who} 老账号:导览只弹一次`, r2);
        S.ok(!p.errors.length, `${who} 老账号 0 报错`, p.errors);
    }
}
