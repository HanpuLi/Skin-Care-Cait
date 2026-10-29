// 安全闸在界面上:近 3 天爆痘 → 猛酸不上,今晚页上看得到为什么;极简模式的刷酸阶梯在顾问页写明「不会自己加」。
// v2 迁移(P3):v1 这个文件的规则断言(爆痘拦猛酸并写明是哪种刺激、顾问加猛酸被同一道闸拦、就医红线泛红 ≥5 天 / 新痘 ≥10 天分开算、
//   那一类最近 3 天还在、所有酸停只留清洁保湿修护、眼霜照用、「看过了」从那天起重新计数、极简阶梯不升档、屏障分、inferRole)
//   全部在 engine-unit 和 v1-parity 里;就医卡任何模式都在、三个按钮、亮时不排酸 → t/v2-a-tonight.mjs。这里只留界面上「说出为什么」的两条。
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
export default async function ({ origin, S, open }) {
    // ── 近 3 天爆痘:猛酸被拦,今晚页上说为什么 ──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full({status:i=>i===-1?['爆痘']:['稳定']})`);
        await p.reload(800);
        const r = await p.eval(`const m=document.getElementById('tn-more');if(m)m.open=true;${W8(50)}
            return {notes:[...document.querySelectorAll('#tonight .note-caution, #tonight .note-info')].map(x=>x.innerText).join('\\n'),lead:document.getElementById('tn-lead').textContent,
                steps:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent)}`);
        S.ok(/近 3 天有/.test(r.notes + r.lead), '今晚页上看得到为什么(近 3 天有…)', r);
        S.ok(r.steps.indexOf('Sunday Riley Good Genes') < 0 && r.steps.length >= 3, '今晚的步骤里没有猛酸', r.steps);
        S.ok(!p.errors.length, '爆痘场景 0 报错', p.errors);
    }
    // ── 极简:刷了很多次也停在每周 1 次,顾问页的刷酸节奏写明「不会自己加」──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        const uses = '[-30,-26,-22,-18,-14,-10,-6]';
        await p.eval(`const j=[];for(let i=-1;i>=-40;i--)j.push({date:__d(i),status:[],products:${uses}.includes(i)?['PC酸']:[],note:'',phase:'',auto:true});return __seed.minimal({jrnl:j})`);
        await p.reload(800);
        const r = await p.eval(`document.getElementById('tab-advisor').click();${W8(250)}const f=document.getElementById('adv-minfold');if(f)f.open=true;${W8(50)}
            const b=document.getElementById('adv-ladder-btn');const box=document.getElementById('adv-ladder');if(box&&box.hidden&&b)b.click();${W8(50)}
            return {lad:(document.getElementById('adv-ladder')||{}).innerText||'',line:(document.getElementById('adv-line')||{}).textContent||''}`);
        S.ok(/不会自己加/.test(r.lad) && /每周 1 次/.test(r.lad + r.line), '极简:阶梯说明里写着不会自己加(停在每周 1 次)', r);
        S.ok(!p.errors.length, '阶梯场景 0 报错', p.errors);
    }
}
