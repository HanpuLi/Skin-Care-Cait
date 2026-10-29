// 安全闸:近 3 天爆痘 → 猛酸不上(并说为什么);就医红线 → 所有酸都停(含温和酸),今晚只留清洁 / 保湿 / 修护,
// 顾问方案和离线兜底都过这道闸,点「看过了」才解除;极简模式的阶梯从不自己升档;屏障分不被「出油 + 闭口」拖垮;inferRole。
const STEPS = `const plan=computePlanRolling().find(d=>d.isToday);const ns=buildNightSteps(TN.shower,TN.shave,plan);
    return {steps:ns.steps.map(s=>({p:s.p,kind:s.kind,role:(PD.find(x=>x.name===s.p)||{}).role||''})),skips:ns.skips,
        future:computePlanRolling().filter(d=>!d.isPast).flatMap(d=>(d.items||[]).map(it=>it.type))}`;
export default async function ({ origin, S, open }) {
    // ── 近 3 天爆痘:猛酸被拦,理由写出来 ──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full({status:i=>i===-1?['爆痘']:['稳定']})`);
        await p.reload(800);
        const r = await p.eval(`const g=safetyGate();const gg=PD.find(p=>p.id==='goodGenes');
            const ai=aiApplyTonight({id:'t-gg',changes:[{op:'add',product:gg.name,why:'测试'}]});
            return {irritated:g.irritated,block:gateBlocks(gg,g),label:tagLabel('爆痘'),notes:document.getElementById('tn-notes').innerText+'\\n'+(document.getElementById('tn-say')||{innerText:''}).innerText,
                aiWhy:ai&&ai.result[0],steps:${'(()=>{' + STEPS + '})()'}.steps.map(s=>s.p)}`);
        S.ok(r.irritated && /猛酸不上/.test(r.block || '') && r.block.indexOf(r.label) >= 0, '近 3 天爆痘:猛酸被拦,理由里写着是哪种刺激', r);
        S.ok(/近 3 天有/.test(r.notes), '今晚页上看得到为什么(近 3 天有…)', r.notes.slice(0, 160));
        S.ok(r.steps.indexOf('Sunday Riley Good Genes') < 0, '今晚的步骤里没有猛酸', r.steps);
        S.ok(/猛酸不上/.test(r.aiWhy || ''), '顾问想今晚加猛酸:同一道闸拦下,原因原样带回', r.aiWhy);
        S.ok(!p.errors.length, '爆痘场景 0 报错', p.errors);
    }

    // ── 就医红线:两种模式都显示;所有酸停(含温和酸);今晚只留清洁 / 保湿 / 修护 ──
    for (const who of ['minimal', 'full']) {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}({status:i=>i>=-6?['泛红']:[]})`);
        await p.reload(800);
        const r = await p.eval(`const g=safetyGate();const pc=PD.find(x=>x.id==='pc'),vo=PD.find(x=>x.id==='votary');
            const box=document.querySelector('#safety-alert .note-medical');
            const st=(()=>{${STEPS}})();
            return {on:medicalRedLine().on,cap:g.acidCapMax,pc:gateBlocks(pc,g),vo:gateBlocks(vo,g),card:!!box,role:box&&box.getAttribute('role'),
                btns:box?[...box.querySelectorAll('button')].map(b=>b.textContent.trim()):[],steps:st.steps,skips:st.skips,future:st.future,
                visible:box?box.getBoundingClientRect().height>0:false}`);
        S.ok(r.on && r.cap === 0, `${who}:就医红线亮了,酸的上限是 0`, r);
        S.ok(/所有酸先停/.test(r.pc || '') && /所有酸先停/.test(r.vo || ''), `${who}:温和酸(杏仁酸 / 乳酸)也停`, { pc: r.pc, vo: r.vo });
        S.ok(r.card && r.visible && r.role === 'alert', `${who}:红线卡显示在今晚页(role=alert)`, r);
        S.ok(JSON.stringify(r.btns) === JSON.stringify(['已约了', '看过了', '先不']), `${who}:三个按钮:已约了 / 看过了 / 先不`, r.btns);
        const bad = r.steps.filter(s => s.role && ['precleanse', 'cleanse', 'moist', 'repair', 'eye'].indexOf(s.role) < 0);
        S.ok(!bad.length && r.steps.every(s => s.kind === 'base'), `${who}:今晚只排清洁 + 保湿 + 修护 + 眼霜`, r.steps);
        S.ok(r.skips.some(x => /今晚只做清洁、保湿、修护/.test(x)), `${who}:精华进了「今晚不用」并写明原因`, r.skips);
        S.ok(!r.skips.some(x => /眼/.test(x) && /今晚只做清洁/.test(x)), `${who}:眼霜照用,不进「今晚不用」(Cait 10/29)`, r.skips);
        S.ok(r.future.every(t => ['acid', 'mask', 'retinol'].indexOf(t) < 0), `${who}:未来几晚的离线排班也没有酸 / 面膜 / 维 A`, r.future);
        // 顾问的方案和今晚的小改都过这道闸
        const ai = await p.eval(`const g=safetyGate();const pc=PD.find(x=>x.id==='pc');
            const v=_validatePlan({rules:{acidCap:3,acidName:pc.name}},g);
            const reg=commitAiRegimen(v.rules,{kind:'plan',reason:'测试',blocked:v.blocked});invalidatePlanCache();renderTn();
            const t=aiApplyTonight({id:'t-med',changes:[{op:'add',product:pc.name,why:'测试'}]});
            const st=(()=>{${STEPS}})();
            return {blocked:v.blocked,acidName:v.rules.acidName,source:regimenRules().source,tResult:t&&t.result,steps:st.steps,future:st.future}`);
        S.ok(ai.source === 'ai' && !ai.acidName && ai.blocked.some(b => /所有酸先停/.test(b.why)), `${who}:顾问方案里点名的温和酸被闸拦下`, ai);
        S.ok(ai.steps.every(s => s.kind === 'base') && ai.future.every(t => t !== 'acid'), `${who}:顾问方案在位时,今晚和未来几晚照样没有酸`, ai);
        S.ok(/所有酸先停/.test((ai.tResult || [])[0] || ''), `${who}:顾问想今晚加温和酸,被拦`, ai.tResult);
        // 「先不」:卡还在(变安静),酸照样停;「看过了」才解除
        const later = await p.eval(`medicalLater();await new Promise(r=>setTimeout(r,80));const box=document.querySelector('#safety-alert .note-medical');
            return {cap:safetyGate().acidCapMax,quiet:box&&box.classList.contains('quiet'),btns:box?[...box.querySelectorAll('button')].map(b=>b.textContent.trim()):[]}`);
        S.ok(later.cap === 0 && later.quiet && later.btns.indexOf('看过了') >= 0, `${who}:点「先不」:酸照样停,卡变安静,还能点「看过了」`, later);
        const seen = await p.eval(`document.querySelector('#safety-alert .note-medical button').click();await new Promise(r=>setTimeout(r,120));
            const ov=[...document.querySelectorAll('#sheet-root .sheet-ov')].pop();const ta=ov&&ov.querySelector('#med-note');if(ta)ta.value='测试备注：医生让先停酸';
            const ok=ov&&[...ov.querySelectorAll('button')].find(b=>/解除提醒/.test(b.textContent));ok&&ok.click();await new Promise(r=>setTimeout(r,150));
            return {on:medicalRedLine().on,m:PROFILE.medical,card:!!document.querySelector('#safety-alert .note-medical'),cap:safetyGate().acidCapMax}`);
        S.ok(!seen.on && seen.m.state === 'seen' && /测试备注/.test(seen.m.note) && !seen.card && seen.cap > 0, `${who}:点「看过了」并记下医生的话 → 红线解除`, seen);
        S.ok(!p.errors.length, `${who}:就医场景 0 报错`, p.errors);
    }

    // ── 极简模式的离线阶梯:没记录就不升档(对照:完整模式记了「稳定」会升)──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        const uses = '[-30,-26,-22,-18,-14,-10,-6]';
        await p.eval(`const j=[];for(let i=-1;i>=-40;i--)j.push({date:__d(i),status:[],products:${uses}.includes(i)?['PC酸']:[],note:'',phase:'',auto:true});return __seed.minimal({jrnl:j})`);
        await p.reload(800);
        const m = await p.eval(`const L=acidLadder();return {level:L.level,uses:L.uses,kinds:[...new Set(L.events.map(e=>e.kind))],why:L.why,rules:regimenRules().acidCap}`);
        S.ok(m.uses >= 6 && m.level === 1 && m.kinds.every(k => k === 'nolog'), '极简:刷了 6 次以上、从没记到刺激,也停在 1 次/周', m);
        S.ok(/不会自己/.test(m.why), '极简:阶梯说明里写着不会自己加', m.why);
        await p.eval(`__seed.full();const j=[];for(let i=-1;i>=-40;i--){const d=__d(i);const st=[-30,-29,-26,-25,-22,-21,-18,-17,-14,-13,-10,-9,-6,-5].includes(i)?['稳定']:[];const pr=${uses}.includes(i)?['PC酸']:[];if(st.length||pr.length)j.push({date:d,status:st,products:pr,note:'',phase:''});}
            localStorage.setItem('sk_jrnl1',JSON.stringify(j));return 1`);
        await p.reload(800);
        const fu = await p.eval(`const L=acidLadder();return {level:L.level,kinds:L.events.map(e=>e.kind)}`);
        S.ok(fu.level >= 2 && fu.kinds.indexOf('up') >= 0, '对照:完整模式刷完两天内记了「稳定」,连续 3 次干净会升档', fu);
        S.ok(!p.errors.length, '阶梯场景 0 报错', p.errors);
    }

    // ── 屏障分:两周天天「出油 + 闭口」、从没勾「稳定」→ ≥65(它们不是屏障受损)──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full({today:true})`);
        await p.reload(800);
        const b = await p.eval(`return {score:barrierScore(),n:barrierSampleN(),days:lg(K.jrnl).length,stable:lg(K.jrnl).some(e=>(e.status||[]).includes('稳定'))}`);
        S.ok(b.days >= 14 && !b.stable && b.score >= 65, '14 天「出油 + 闭口」、从没「稳定」:屏障 ≥65', b);
        // 角色推断
        const ir = await p.eval(`return {gly:inferRole({name:'The Ordinary Glycolic Acid 7% Toning Solution'}),bha:inferRole({name:'2% BHA Liquid Exfoliant'}),
            mask:inferRole({name:'Clarifying Clay Mask'}),ret:inferRole({name:'Differin Adapalene Gel'}),unk:inferRole({name:'Mystery Bottle'}),spf:inferRole({name:'Anthelios UVMune 400'})}`);
        S.ok(ir.gly === 'acid' && ir.bha === 'acid' && ir.mask === 'mask' && ir.ret === 'retinol' && ir.spf === 'spf', 'inferRole:甘醇酸 / BHA → 酸,泥膜 → 面膜,阿达帕林 → 维 A,Anthelios → 防晒', ir);
        S.ok(ir.unk === '', 'inferRole:认不出的留空(不瞎猜成保湿)', ir.unk);
        S.ok(!p.errors.length, '屏障 / 角色 0 报错', p.errors);
    }
}
