// 顾问(全部用假后端 __AIF,不碰真服务器、不登录):
//   没开通 → 邀请码框 + 兑换;连不上 / ai.js 没加载 → 今晚照离线规则排、不白屏;额度用完;
//   对话里的 action(今晚小改)和 proposal(新方案)直接生效、能撤销,修订条撤销 / 重做;
//   读成分标把特性写进产品、traitsOf 立刻用上;出方案 → 新一版 → 今晚的步骤跟着变;数据说明每个账号只弹一次。
const STEPS = `(()=>{const plan=computePlanRolling().find(d=>d.isToday);return buildNightSteps(TN.shower,TN.shave,plan).steps.map(s=>s.p+' | '+s.h)})()`;
export default async function ({ origin, S, open }) {
    const boot = async (mode, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${o.seed || 'full'}(${o.seedArg || ''})`);
        await p.reload(800);
        await p.eval(`__login();window.__AIF=Object.assign({mode:'${mode}'},${o.aif || '{}'});${o.noPrivacy ? '' : "localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test'}));"}await aiProbe(true);return 1`);
        return p;
    };
    const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;

    // ── 没开通:看到邀请码框;错码留在原地,对的码开通 ──
    {
        const p = await boot('none');
        const a = await p.eval(`show('coach');${wait(200)}return {acc:aiAccess(),box:!!document.getElementById('co-code'),composer:!!document.getElementById('co-chat-text'),probes:(__AIF.log||[]).filter(x=>x.p==='/api/me').length}`);
        S.ok(a.acc === 'none' && a.box && !a.composer, '不在白名单:顾问页是邀请码框,没有对话框', a);
        const a2 = await p.eval(`renderCoach();renderCoach();renderCoach();${wait(200)}return (__AIF.log||[]).filter(x=>x.p==='/api/me').length`);
        S.ok(a2 - a.probes <= 1, '没开通时重画顾问页不会一直去问后端(节流)', { before: a.probes, after: a2 });
        const bad = await p.eval(`document.getElementById('co-code').value='WRONG-CODE1';await aiRedeem();${wait(100)}return {acc:aiAccess(),box:!!document.getElementById('co-code'),btn:document.getElementById('co-code-go').textContent}`);
        S.ok(bad.acc === 'none' && bad.box && bad.btn === '开通', '错的邀请码:还在邀请码框,按钮恢复', bad);
        const good = await p.eval(`document.getElementById('co-code').value='GOOD1-CODE2';await aiRedeem();${wait(200)}return {acc:aiAccess(),ready:aiReady(),composer:!!document.getElementById('co-chat-text')}`);
        S.ok(good.acc === 'on' && good.ready && good.composer, '对的邀请码:开通,出现对话框', good);
        S.ok(!p.errors.length, '邀请制 0 报错', p.errors);
    }

    // ── 连不上:顾问页说清楚;今晚照常排 ──
    {
        const p = await boot('down');
        const r = await p.eval(`show('coach');${wait(150)}const t=document.getElementById('coach-content').innerText;show('tonight');${wait(100)}
            return {down:_aiDown,txt:t,retry:/重试/.test(t),composer:!!document.getElementById('co-chat-text'),steps:document.querySelectorAll('#tn-plan .step').length,title:document.getElementById('tn-title').textContent}`);
        S.ok(r.down && /连不上/.test(r.txt) && r.retry && !r.composer, '后端连不上:顾问页说「连不上,照上一版做」,有重试', r);
        S.ok(r.steps >= 3 && r.title, '后端连不上:今晚页照常有步骤', r);
        const s = await p.eval(`const r=await aiStream('/api/chat',{messages:[]});return r.err`);
        S.ok(/连不上/.test(s || ''), '连不上时发消息:给一句人话,不抛异常', s);
        S.ok(!p.errors.length, '连不上 0 报错', p.errors);
    }
    // ── ai.js 根本没加载到:今晚页照样渲染 ──
    {
        const p = await open({ blockPaths: ['/ai.js'] });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(900);
        const r = await p.eval(`return {ai:typeof aiSend,steps:document.querySelectorAll('#tn-plan .step').length,title:document.getElementById('tn-title').textContent,
            coach:(show('coach'),document.getElementById('coach-content').innerText.slice(0,60))}`);
        S.ok(r.ai === 'undefined' && r.steps >= 3 && r.title, 'ai.js 没加载:今晚页照样有标题和步骤', r);
        S.ok(!p.errors.filter(e => !/ai\.js|Failed to load/.test(e)).length, 'ai.js 没加载:没有别的报错', p.errors);
    }
    // ── 额度用完 ──
    {
        const p = await boot('quota');
        const r = await p.eval(`show('coach');${wait(150)}return {q:_aiQuotaText(),txt:document.getElementById('coach-content').innerText,composer:!!document.getElementById('co-chat-text'),steps:document.querySelectorAll('#tn-plan .step').length}`);
        S.ok(/今天的顾问次数用完了/.test(r.q) && /今天的顾问次数用完了/.test(r.txt) && !r.composer, '额度用完:顾问页说明白,不给发送框', r);
        S.ok(r.steps >= 3, '额度用完:今晚照常', r.steps);
    }

    // ── 对话:action 直接改今晚 + 撤销;proposal 直接出新一版 + 撤销;修订条撤销 / 重做 ──
    {
        const eye = 'MZ Skin Soothe & Smooth 眼部精华';
        const chat = JSON.stringify([['delta', { t: '今晚眼霜先跳过。' }], ['action', { id: 'a1', changes: [{ op: 'skip', product: eye, why: '眼周有点干' }] }],
            ['proposal', { id: 'p1', message: '酸改成每周 2 次', changes: [{ op: 'acid_freq', value: 2 }] }], ['done', { text: '今晚眼霜先跳过。', model: 'claude-test', cost: 0.01 }]]);
        const p = await boot('on', { aif: `{chat:${chat}}` });
        const r0 = await p.eval(`return {steps:${STEPS},v:(currentRegimen()||{}).v||0,n:regimenHistory().length}`);
        S.ok(r0.steps.some(s => s.startsWith(eye)), '对话之前:今晚有眼霜', r0.steps);
        const r1 = await p.eval(`show('coach');${wait(100)}await aiSend('眼周有点干');${wait(200)}const st=_aiMine(AIK.chat);const m=st.chat[st.chat.length-1];
            show('tonight');${wait(100)}
            return {steps:${STEPS},recs:m.recs.map(r=>({kind:r.kind,state:r.state})),src:regimenRules().source,acidCap:regimenRules().acidCap,v:currentRegimen().v,n:regimenHistory().length,
                bar:document.getElementById('tn-change').innerText,skips:[...document.querySelectorAll('.skips li')].map(x=>x.textContent)}`);
        S.ok(!r1.steps.some(s => s.startsWith(eye)) && r1.recs.some(x => x.kind === 'tonight' && x.state === 'applied'), 'action:今晚的眼霜直接跳过了,不用再点确认', r1);
        S.ok(r1.src === 'ai' && r1.acidCap === 2 && r1.n === r0.n + 1, 'proposal:直接落成新的一版方案(source=ai,每周 2 次)', r1);
        S.ok(/改了 2 处|眼|方案/.test(r1.bar), '今晚页顶上有修订条', r1.bar);
        // 在对话里撤销 action
        const r2 = await p.eval(`const st=_aiMine(AIK.chat);const mi=st.chat.length-1;const ri=st.chat[mi].recs.findIndex(r=>r.kind==='tonight');aiUndoRec(mi,ri);${wait(80)}
            return {steps:${STEPS},state:_aiMine(AIK.chat).chat[mi].recs[ri].state}`);
        S.ok(r2.state === 'undone' && r2.steps.some(s => s.startsWith(eye)), '对话里点撤销:眼霜回来了', r2);
        // 撤销 proposal
        const r3 = await p.eval(`const st=_aiMine(AIK.chat);const mi=st.chat.length-1;const ri=st.chat[mi].recs.findIndex(r=>r.kind==='regimen');aiUndoRec(mi,ri);${wait(80)}
            return {src:regimenRules().source,n:regimenHistory().length,cur:(currentRegimen()||{}).source||''}`);
        S.ok(r3.src !== 'ai' || r3.cur !== 'ai', '对话里撤销新方案:回到上一版', r3);
        // 修订条:撤销 → 重做
        const r4 = await p.eval(`aiApplyTonight({id:'a2',changes:[{op:'skip',product:${JSON.stringify(eye)},why:'测'}]});show('tonight');${wait(80)}
            const b=[...document.querySelectorAll('#tn-change button')].find(x=>/撤销/.test(x.textContent));const had=!!b;b&&b.click();${wait(80)}
            const afterUndo=${STEPS};const redo=[...document.querySelectorAll('#tn-change button')].find(x=>/重做/.test(x.textContent));const hadRedo=!!redo;redo&&redo.click();${wait(80)}
            return {had,hadRedo,afterUndo,afterRedo:${STEPS}}`);
        S.ok(r4.had && r4.afterUndo.some(s => s.startsWith(eye)), '修订条「撤销」:眼霜回来', r4);
        S.ok(r4.hadRedo && !r4.afterRedo.some(s => s.startsWith(eye)), '撤销后 8 秒内能「重做」:又跳过了', r4);
        S.ok(!p.errors.length, '对话场景 0 报错', p.errors);
    }

    // ── 读成分标:家里有的产品 → 特性写进它,traitsOf 立刻用;能撤销。新产品 → 预填添加表单 ──
    {
        const p = await boot('on', { seedArg: `{status:i=>i===-1?['爆痘']:['稳定']}` });
        const r = await p.eval(`const vo=PD.find(x=>x.id==='votary');const before={tr:traitsOf(vo).slice(),gb:gateBlocks(vo)};
            const res=aiVisionResult({name:'Votary 10% 乳酸',role:'去角质',traits:['strong-exfo','fragranced','not-a-trait']},'read_label',{});
            const state=res.state;invalidatePlanCache();const after={tr:traitsOf(PD.find(x=>x.id==='votary')).slice(),gb:gateBlocks(PD.find(x=>x.id==='votary')),stored:(JSON.parse(localStorage.getItem('sk_proddefs1'))||[]).find(x=>x.id==='votary')};
            aiUndoLabel();const undone={tr:traitsOf(PD.find(x=>x.id==='votary')).slice()};
            return {before,after:{tr:after.tr,gb:after.gb,stored:after.stored&&after.stored.traits},undone,state,matched:res.matched}`);
        S.ok(r.matched === 'Votary 10%乳酸' && r.state === 'applied', '读成分标:认出家里那支(名字空格不同也认)', r);
        S.ok(JSON.stringify(r.after.tr) === '["strong-exfo","fragranced"]' && JSON.stringify(r.after.stored) === JSON.stringify(r.after.tr), '特性写进产品本身(随 sk_proddefs1 同步),不认识的特性丢掉', r.after);
        S.ok(!r.before.gb && /猛酸不上/.test(r.after.gb || ''), 'traitsOf 立刻用上:标成猛酸后,近 3 天爆痘就拦它', r);
        S.ok(JSON.stringify(r.undone.tr) === JSON.stringify(r.before.tr), '撤销:特性回到原来', r.undone);
        const n = await p.eval(`aiVisionResult({name:'Brand New Glycolic Toner',role:'去角质',traits:['strong-exfo'],note:'7% 甘醇酸'},'read_label',{});${wait(80)}
            const m=document.getElementById('prod-modal');return {open:!m.hidden,name:(document.getElementById('m-name')||{}).value,
            role:(document.querySelector('#m-role-grid [aria-checked="true"]')||{dataset:{}}).dataset.v||'',traits:[...document.querySelectorAll('#m-traits [aria-pressed="true"]')].map(x=>x.dataset.v)}`);
        S.ok(n.open && n.name === 'Brand New Glycolic Toner' && n.traits.join() === 'strong-exfo', '新产品:添加表单按成分标预填(名字、特性)', n);
        S.ok(!p.errors.length, '读成分标 0 报错', p.errors);
    }

    // ── 出方案:新的一版;今晚的步骤跟着变;可撤销 ──
    {
        const eye = 'MZ Skin Soothe & Smooth 眼部精华';
        const plan = JSON.stringify({ rationale: '眼周先停一支,修护霜全脸', rules: { acidCap: 1, acidName: '', acidZones: [], cleanse: '', repair: 'full', repairWhy: '最近偏干' }, resting: [{ name: eye, why: '先停' }], gaps: [] });
        const p = await boot('on', { aif: `{plan:${plan}}` });
        const r = await p.eval(`const before=${STEPS};const n0=regimenHistory().length;await aiPlan();${wait(100)}
            return {before,after:${STEPS},src:(currentRegimen()||{}).source,n0,n1:regimenHistory().length,res:_aiResult&&_aiResult.state}`);
        S.ok(r.src === 'ai' && r.n1 === r.n0 + 1 && r.res === 'applied', '出方案:直接落成新的一版(source=ai)', r);
        S.ok(r.before.some(s => s.startsWith(eye)) && !r.after.some(s => s.startsWith(eye)), '今晚的步骤跟着变:被这一版停掉的眼霜不在了', r);
        S.ok(r.after.some(s => /Cicaplast/.test(s) && /全脸薄涂/.test(s)), '今晚的修护霜改成全脸薄涂', r.after);
        const u = await p.eval(`aiUndoPlan();${wait(80)}return {steps:${STEPS},src:(currentRegimen()||{}).source||''}`);
        S.ok(u.steps.some(s => s.startsWith(eye)), '撤销方案:今晚回到之前', u);
        S.ok(!p.errors.length, '出方案 0 报错', p.errors);
    }

    // ── 数据说明:每个账号第一次进顾问页弹一次 ──
    {
        const p = await boot('on', { noPrivacy: true });
        const r = await p.eval(`show('coach');${wait(200)}const a=!!document.getElementById('ai-privacy');
            const ok=[...document.querySelectorAll('#ai-privacy button')].find(b=>/知道了/.test(b.textContent));ok&&ok.click();${wait(200)}
            show('tonight');show('coach');${wait(200)}return {first:a,second:!!document.getElementById('ai-privacy'),stored:!!_aiMine(AIK.privacy)}`);
        S.ok(r.first && !r.second && r.stored, '数据说明:第一次进顾问页弹一次,点过就不再弹', r);
        S.ok(!p.errors.length, '数据说明 0 报错', p.errors);
    }
}
