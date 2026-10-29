// 信息架构重排(Cait 10/29「就这么做」):
//   页头印章不再压住标题行(390 / 375 / 320 宽 + 刘海安全区,getBoundingClientRect 不相交);
//   今晚页四层:「今晚 · 夜型」+ 一句为什么 → 今晚的情况(问句开关 + 点了即时说影响)→ 最多一张提醒卡(其余「还有 N 条」)→ 步骤 → 完成今晚;
//   皮肤记录在完成之后的 sheet(和「只记皮肤」)里,接着顾问反馈;极简模式默认全做、记皮肤可选不催;
//   四个 tab:今晚 / 顾问(现在的方案 + 未来 7 晚 + 刷酸节奏 + 版本与撤销,离线照样有)/ 记录(只回看,极简模式默认也显示)/ 产品。
export default async function ({ origin, S, open }) {
    const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
    const boot = async (seed, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${seed}`);
        await p.reload(800);
        if (o.ai) await p.eval(`__login();window.__AIF=Object.assign({mode:'${o.ai}'},${o.aif || '{}'});localStorage.setItem('sk_aiprivacy1',JSON.stringify({uid:'u-test'}));await aiProbe(true);return 1`);
        return p;
    };

    // ── 1. 印章不压标题行:三种 iPhone 宽 × 有刘海安全区,印章整个落在页头里,和今晚页所有控件都不相交 ──
    for (const width of [390, 375, 320]) {
        const p = await boot(`full({profile:{seal:'膚'}})`, { page: { width } });
        const r = await p.eval(`document.documentElement.style.setProperty('--safe-top','59px');renderTn();${wait(100)}
            const R=el=>el.getBoundingClientRect();const seal=R(document.getElementById('btn-settings')),hdr=R(document.querySelector('.hdr'));
            const vis=el=>{const b=el.getBoundingClientRect();if(!b.width||!b.height)return false;for(let e=el;e;e=e.parentElement){if(getComputedStyle(e).display==='none')return false}return true};
            const hit=b=>b.left<seal.right-0.5&&seal.left<b.right-0.5&&b.top<seal.bottom-0.5&&seal.top<b.bottom-0.5;
            const ctl=[document.getElementById('tn-h'),...document.querySelectorAll('#tonight button,#tonight input,#tonight label,#tonight summary,#tonight .sw')].filter(vis);
            const bad=ctl.filter(el=>hit(R(el))).map(el=>(el.id||el.className||el.tagName)+' '+el.textContent.trim().slice(0,10));
            return {bad,n:ctl.length,inHdr:seal.top>=hdr.top-0.5&&seal.bottom<=hdr.bottom+0.5,sealTop:Math.round(seal.top),sealBottom:Math.round(seal.bottom),hdrBottom:Math.round(hdr.bottom),
                titleTop:Math.round(R(document.getElementById('tn-h')).top),overflow:document.documentElement.scrollWidth-innerWidth,
                q:[...document.querySelectorAll('#tn-sit .sit-q')].filter(vis).map(x=>Math.round(R(x).top))}`);
        S.ok(r.n > 5 && !r.bad.length, `${width} 宽 + 安全区 59px:印章和标题、开关、步骤等 ${r.n} 个控件都不相交`, r);
        S.ok(r.inHdr && r.titleTop >= r.hdrBottom, `${width} 宽:印章整个落在页头高度内,标题在页头下面`, r);
        S.ok(r.overflow <= 0, `${width} 宽:没有横向滚动`, r.overflow);
        if (width === 320) S.ok(r.q.length === 2, '320 宽:两个问句都在(放不下就折成两行)', r.q);
        S.ok(!p.errors.length, `${width} 宽:0 报错`, p.errors);
    }

    // ── 2. 今晚的情况:问句开关;点了之后一句话说影响(从点之前 / 之后的真实排班比出来);刮胡只给开了刮胡的人 ──
    {
        const p = await boot(`full()`);
        const q = await p.eval(`return [...document.querySelectorAll('#tn-sit .sit-q')].map(x=>x.querySelector('span').textContent)`);
        S.ok(JSON.stringify(q) === JSON.stringify(['今晚洗澡吗？', '今晚刮胡吗？']), '开关改成问句「今晚洗澡吗?」「今晚刮胡吗?」', q);
        const r = await p.eval(`const b=_tnSnap();const hadAcid=b.steps.some(x=>x.kind==='acid');const fx0=document.getElementById('tn-sit-fx').hidden;
            const sv=document.getElementById('tn-sv');sv.click();${wait(100)}
            const a=_tnSnap();const fx=document.getElementById('tn-sit-fx');
            return {hadAcid,fx0,txt:fx.textContent,shown:!fx.hidden,exp:sitEffectText('shave',true,b,a),title:document.getElementById('tn-title').textContent,checked:sv.checked,
                aria:sv.getAttribute('role'),tn:TN.shave,day:getDayState(today()).shave}`);
        S.ok(r.fx0 && r.shown && r.txt === r.exp && /^刮胡夜：/.test(r.txt), '点「今晚刮胡吗」:下面即时一句,和真实排班差异算出来的一致', r);
        S.ok(!r.hadAcid || /酸今晚不上/.test(r.txt), '刷酸夜点刮胡:说「酸今晚不上」', r);
        S.ok(/刮完先用凉水冲/.test(r.txt) && r.title === '刮胡夜' && r.checked && r.tn && r.day && r.aria === 'switch', '刮胡夜:标题变刮胡夜,开关是 switch,写进 TN 和当天排班', r);
        const r2 = await p.eval(`const b=_tnSnap();document.getElementById('tn-sv').click();${wait(100)}return {txt:document.getElementById('tn-sit-fx').textContent,exp:sitEffectText('shave',false,b,_tnSnap())}`);
        S.ok(r2.txt === r2.exp && /^今晚不刮：/.test(r2.txt), '再点一下(不刮了):照样说影响', r2);
        const same = await p.eval(`const s=_tnSnap();return sitEffectText('shower',true,s,s)`);
        S.ok(same === '洗澡夜：今晚步骤不变。', '没影响就说「今晚步骤不变」', same);
        const r3 = await p.eval(`const b=_tnSnap();document.getElementById('tn-sh').click();${wait(100)}const a=_tnSnap();const t=document.getElementById('tn-sit-fx').textContent;
            const cb=b.steps[0].p,ca=a.steps[0].p;return {t,exp:sitEffectText('shower',true,b,a),cb,ca}`);
        S.ok(r3.t === r3.exp && /^洗澡夜：/.test(r3.t) && (r3.cb === r3.ca || /洁面换成/.test(r3.t)), '点「今晚洗澡吗」:洁面换了就说换成哪支', r3);
        S.ok(!/适合刷酸|渗透/.test(r.txt + r2.txt + r3.t), '不写「洗澡后适合刷酸」这种被证据推翻的说法(CLAUDE.md 循证结论)', r3.t);
        S.ok(!p.errors.length, '今晚的情况 0 报错', p.errors);
    }
    {
        const p = await boot(`minimal()`);
        const r = await p.eval(`const v=el=>!!el&&getComputedStyle(el).display!=='none'&&!!el.getBoundingClientRect().height;return {sh:v(document.getElementById('tn-sh').closest('.sit-q')),sv:v(document.getElementById('tn-sv').closest('.sit-q'))}`);
        S.ok(r.sh && !r.sv, '极简 + 没开刮胡:只问洗澡,不问刮胡', r);
    }

    // ── 3. 提醒卡最多一张:就医 > 注意 > 方案变了 > 顾问的话;其余「还有 N 条」;就医三个按钮照旧 ──
    {
        const p = await boot(`minimal({status:i=>i>=-6?['泛红']:[]})`, { ai: 'on' });
        const r = await p.eval(`PD.filter(p=>p.role==='spf').forEach(p=>{p.hidden=true});ls(K.prodDefs,PD);
            aiApplyTonight({id:'t1',changes:[{op:'skip',product:PD.find(p=>p.role==='eye'&&!p.hidden).name,why:'测'}]});
            localStorage.setItem('sk_ainote1',JSON.stringify({uid:'u-test',date:today(),note:'今晚别折腾，修护为主。'}));invalidatePlanCache();renderTn();${wait(100)}
            const top=document.getElementById('tn-cards'),more=document.getElementById('tn-more');
            const cards=[...top.children].filter(x=>x.innerHTML.trim()).map(x=>x.id);
            const inMore=[...document.getElementById('tn-more-b').children].filter(x=>x.innerHTML.trim()).map(x=>x.id);
            const med=top.querySelector('.note-medical');
            return {cards,inMore,moreHidden:more.hidden,open:more.open,n:document.getElementById('tn-more-n').textContent,sum:more.querySelector('summary').textContent.trim(),
                btns:med?[...med.querySelectorAll('button')].map(b=>b.textContent):[],vis:[...top.querySelectorAll('.note-medical,.note-caution,.revbar,.say-card')].length}`);
        S.ok(JSON.stringify(r.cards) === '["safety-alert"]' && r.vis === 1, '就医红线亮着:外面只有就医卡一张', r);
        S.ok(JSON.stringify(r.inMore) === '["tn-notes","tn-aisay"]' && !r.moreHidden && !r.open && r.n === '2' && /还有 2 条/.test(r.sum), '其余按优先级(注意 > 顾问的话)收进「还有 2 条」,默认折着', r);
        // 「顾问改了今晚」不算提醒卡、不收进折叠(Cait 10/29):红线亮着时也单独一行露在外面,撤销看得见、点得到
        const rv = await p.eval(`const ch=document.getElementById('tn-change');const b=[...ch.querySelectorAll('button')].find(x=>/撤销/.test(x.textContent));
            const vis=el=>{if(!el)return false;const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;for(let e=el;e;e=e.parentElement){if(getComputedStyle(e).display==='none'||(e.tagName==='DETAILS'&&!e.open&&e!==el))return false}return true};
            const after=[...document.getElementById('tonight').children].map(x=>x.id);
            return {inMore:!!ch.closest('#tn-more'),vis:vis(b),who:(ch.querySelector('.who')||{}).textContent,order:after.indexOf('tn-change')>after.indexOf('tn-more')&&after.indexOf('tn-change')<after.indexOf('tn-plan'),
                w:b?Math.round(b.getBoundingClientRect().width):0,h:b?Math.round(b.getBoundingClientRect().height):0}`);
        S.ok(!rv.inMore && rv.vis && rv.order && /^顾问改了今晚/.test(rv.who || '') && rv.w >= 44 && rv.h >= 44, '红线亮 + 有修订:「顾问改了今晚 · 撤销」单独一行在提醒卡下面,撤销按钮可见、≥44', rv);
        S.ok(JSON.stringify(r.btns) === '["已约了","看过了","先不"]', '就医卡三个按钮不变', r.btns);
        const r2 = await p.eval(`medicalSeen();${wait(60)}const ok=[...document.querySelectorAll('#sheet-root button')].find(b=>/解除/.test(b.textContent));ok.click();${wait(150)}
            const top=document.getElementById('tn-cards');return {cards:[...top.children].filter(x=>x.innerHTML.trim()).map(x=>x.id),n:document.getElementById('tn-more-n').textContent}`);
        S.ok(r2.cards[0] === 'tn-notes' && r2.n === '1', '点「看过了」解除后:注意卡升到外面,「还有 1 条」', r2);
        const r3 = await p.eval(`const b=[...document.querySelectorAll('#tn-change button')].find(x=>/撤销/.test(x.textContent));b.click();${wait(120)}
            return {undone:!tonightOverride(),bar:document.getElementById('tn-change').textContent}`);
        S.ok(r3.undone && /已撤销/.test(r3.bar), '点修订行的「撤销」:今晚回到改之前,同一行变「已撤销」可重做', r3);
        S.ok(!p.errors.length, '提醒卡 0 报错', p.errors);
    }
    {
        const p = await boot(`full()`);
        const r = await p.eval(`renderTn();${wait(60)}return {hidden:document.getElementById('tn-more').hidden,top:[...document.getElementById('tn-cards').children].filter(x=>x.innerHTML.trim()).length}`);
        S.ok(r.hidden && r.top <= 1, '没有多余提醒:不出现「还有 N 条」', r);
    }

    // ── 4. 完成今晚 → 记皮肤(选填)→ 顾问反馈;「只记皮肤」不算完成;今晚页上不再有皮肤记录 ──
    {
        const p = await boot(`full()`, { ai: 'on' });
        const r0 = await p.eval(`const t=document.getElementById('tonight');return {skinOnPage:!!t.querySelector('#tn-skin,.seg'),txt:t.innerText,
            btns:[...document.querySelectorAll('#tn-done button')].map(b=>b.textContent)}`);
        S.ok(!r0.skinOnPage && !/今天皮肤|好些|差不多/.test(r0.txt), '今晚页上不再有「今天皮肤」(挪到完成之后)', r0.txt.slice(0, 200));
        S.ok(JSON.stringify(r0.btns) === '["完成今晚","只记皮肤"]', '完成栏:「完成今晚」+ 旁边不显眼的「只记皮肤」', r0.btns);
        const r1 = await p.eval(`openSkinSheet();${wait(80)}const ov=document.getElementById('skin-sheet');const has=!!ov&&!!ov.querySelector('#tn-skin .seg');
            ov.querySelectorAll('#tn-skin .seg button')[1].click();${wait(80)}const e=(lg(K.jrnl)||[]).find(x=>x.date===today())||{};
            const fb=!!document.getElementById('ai-feedback');document.querySelector('#skin-sheet .sheet-actions .btn-primary').click();${wait(100)}
            return {has,st:e.status,done:!!e.done,fb,calls:(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length}`);
        S.ok(r1.has && (r1.st || []).indexOf('稳定') >= 0 && !r1.done && !r1.fb && r1.calls === 0, '「只记皮肤」:能记,不算完成,不要顾问反馈', r1);
        const r2 = await p.eval(`document.querySelector('#tn-done .btn-primary').click();${wait(120)}const ov=document.getElementById('done-sheet');
            const order=[...ov.querySelectorAll('#tn-skin,#done-note,#ai-feedback')].map(x=>x.id);const btn=ov.querySelector('#ai-feedback button');
            const e=(lg(K.jrnl)||[]).find(x=>x.date===today());return {open:!!ov,order,btn:btn&&btn.textContent,done:e.done,calls:(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length}`);
        S.ok(r2.open && r2.done && JSON.stringify(r2.order) === '["tn-skin","done-note","ai-feedback"]', '点「完成今晚」:sheet 里先皮肤、再备注、再顾问反馈', r2);
        S.ok(r2.btn === '记好了，看顾问怎么说' && r2.calls === 0, '反馈等她记完再要:先是一个按钮,还没调后端', r2);
        const r3 = await p.eval(`const ov=document.getElementById('done-sheet');ov.querySelectorAll('#tn-skin .seg button')[2].click();${wait(80)}
            ov.querySelector('#ai-feedback button').click();${wait(300)}const call=(__AIF.log||[]).filter(x=>x.p==='/api/feedback');
            const fb=document.getElementById('ai-feedback').innerText;document.querySelector('#done-sheet .sheet-actions .btn-primary').click();${wait(150)}
            return {n:call.length,st:call[0]&&call[0].body.session.status,fb,after:(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length,
                bar:document.getElementById('tn-done').innerText}`);
        S.ok(r3.n === 1 && (r3.st || []).indexOf('变差') >= 0 && /做得不错/.test(r3.fb), '点「记好了」:反馈请求带上刚记的皮肤,结果显示在 sheet 里', r3);
        S.ok(r3.after === 1 && /皮肤和反馈/.test(r3.bar), '关掉 sheet 不重复要;完成栏变成「今晚做完了 · 皮肤和反馈」', r3);
        S.ok(!p.errors.length, '完成流程 0 报错', p.errors);
    }
    {
        // 不点「记好了」直接关掉:后台照样要一次(以前是一点完成就要)
        const p = await boot(`full()`, { ai: 'on' });
        const r = await p.eval(`checkinTonight();${wait(100)}document.querySelector('#done-sheet .sheet-x').click();${wait(300)}
            return {n:(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length,saved:!!(_aiState().feedback||{})[today()]}`);
        S.ok(r.n === 1 && r.saved, '没点「记好了」直接关掉:后台照样要一次反馈,存下来', r);
    }
    // 极简模式(Cait 10/29 原话「护肤品不打卡，排了就当全用了。皮肤状况记录等等要保留」):
    //   步骤不能勾、没有「完成今晚 / 做完了」;活性步骤的「今晚没做」还在;一个看得见的「记一下皮肤」→ 同一个记皮肤 sheet,记完要顾问反馈;不催、不因记不记升降档
    {
        const p = await boot(`minimal()`, { ai: 'on' });
        const r = await p.eval(`const bar=document.getElementById('tn-done');const btns=[...bar.querySelectorAll('button')].map(b=>b.textContent.trim());
            const b=document.getElementById('tn-logskin');const br=b.getBoundingClientRect();const cs=getComputedStyle(b);
            const L0={lv:acidLadder().level,cap:maxAcidPerWeek()};
            return {btns,bw:Math.round(br.width),bh:Math.round(br.height),fs:parseFloat(cs.fontSize),boxed:cs.boxShadow!=='none',
                checkable:document.querySelectorAll('#tn-plan [role=checkbox]').length,skip:document.querySelectorAll('#tn-plan .skip-btn').length,
                txt:document.getElementById('tonight').innerText,L0}`);
        S.ok(JSON.stringify(r.btns) === '["记一下皮肤"]' && r.bw >= 300 && r.bh >= 44 && r.fs >= 16 && r.boxed, '极简:完成栏只有一个整宽、带框的「记一下皮肤」(看得见,不是小字)', r);
        S.ok(r.checkable === 0 && !/完成今晚|做完了/.test(r.txt) && /护肤品不用打卡，排上的默认都算用了/.test(r.txt), '极简:护肤品不打卡(步骤不能勾、没有「完成今晚 / 做完了」),说明排上的默认都算用了', r);
        const sk = await p.eval(`const li=[...document.querySelectorAll('#tn-plan .step')].find(x=>x.querySelector('.skip-btn'));if(!li)return 'no-active';li.querySelector('.skip-btn').click();${wait(80)}
            return {name:li.dataset.prod,skipped:(lg(K.jrnl).find(e=>e.date===today())||{}).skipped}`);
        S.ok(sk === 'no-active' || (sk.skipped || []).indexOf(sk.name) >= 0, '极简:活性步骤的「今晚没做」照旧能点、记进 skipped', sk);
        const r2 = await p.eval(`document.getElementById('tn-logskin').click();${wait(120)}const ov=document.getElementById('skin-sheet');
            const has={title:ov.querySelector('.sheet-t').textContent,seg:!!ov.querySelector('#tn-skin .seg'),note:!!ov.querySelector('#done-note'),photo:!!ov.querySelector('input[type=file]'),fbBtn:(ov.querySelector('#ai-feedback button')||{}).textContent,txt:ov.innerText};
            ov.querySelectorAll('#tn-skin .seg button')[2].click();${wait(80)}document.querySelector('#tn-skin .skin-h .btn-link').click();${wait(40)}
            [...document.querySelectorAll('#tn-skin .syms .chip')].find(c=>c.textContent.trim()==='泛红').click();${wait(80)}
            const fm=!!document.querySelector('#tn-skin .fm-entry');const e=(lg(K.jrnl)||[]).find(x=>x.date===today())||{};
            document.querySelector('#skin-sheet .sheet-actions .btn-primary').click();${wait(300)}
            const call=(__AIF.log||[]).filter(x=>x.p==='/api/feedback');
            return Object.assign(has,{fm,st:e.status,done:!!e.done,n:call.length,sent:call[0]&&call[0].body.session.status,bar:document.getElementById('tn-logskin').textContent,
                L1:{lv:acidLadder().level,cap:maxAcidPerWeek(),gate:safetyGate().irritated},nag:/未记录|还没记|记了 \d/.test(document.body.innerText)})`);
        S.ok(r2.title === '记一下皮肤' && r2.seg && r2.note && r2.photo && r2.fm && /不记也没关系/.test(r2.txt), '「记一下皮肤」打开同一个记皮肤 sheet:状态、具体情况、标在脸上、备注、照片;不催', r2);
        S.ok((r2.st || []).indexOf('变差') >= 0 && (r2.st || []).indexOf('泛红') >= 0 && !r2.done, '记的写进当天条目,不算对产品打卡(没有 done)', r2);
        S.ok(r2.fbBtn === '记好了，看顾问怎么说' && r2.n === 1 && (r2.sent || []).indexOf('泛红') >= 0, '记完要顾问反馈(带上刚记的);关掉时后台要一次', r2);
        // 阶梯档位不因记不记而动;记了「泛红」压低的是安全闸(当晚刺激先停酸),不是阶梯
        S.ok(r.L0.lv === r2.L1.lv && r.L0.lv === 1 && r2.L1.gate && !r2.nag && /再看看/.test(r2.bar), '刷酸阶梯不因记不记升降档(记了泛红只走安全闸)、不催;记过以后按钮写「今天的皮肤 · 再看看」', { L0: r.L0, L1: r2.L1, bar: r2.bar });
        S.ok(!p.errors.length, '极简记皮肤 0 报错', p.errors);
    }
    {
        // 极简模式什么都没记就关掉:不花钱要反馈
        const p = await boot(`minimal()`, { ai: 'on' });
        const r = await p.eval(`openSkinSheet();${wait(80)}document.querySelector('#skin-sheet .sheet-x').click();${wait(200)}return (__AIF.log||[]).filter(x=>x.p==='/api/feedback').length`);
        S.ok(r === 0, '极简:打开「记一下皮肤」什么都没记就关掉,不要反馈', r);
    }

    // ── 5. 四个 tab;极简模式默认也显示「记录」(Cait 10/29「皮肤状况记录要保留」),设置里能关(按账号存 PROFILE.hideRecords);记录页只回看 ──
    {
        const p = await boot(`minimal()`);
        const r = await p.eval(`const vis=el=>getComputedStyle(el).display!=='none';const tabs=()=>[...document.querySelectorAll('.tabbar .tab')].filter(vis).map(t=>t.textContent.trim());
            const a=tabs();openSettings();const sw=document.getElementById('set-showrec');const on=sw.checked;sw.click();${wait(80)}const b=tabs();const hid=PROFILE.hideRecords;
            const saved=(lg(K.profile)||{}).hideRecords;sw.click();${wait(80)}closeSettings();return {a,on,b,hid,saved,c:tabs(),still:PROFILE.hideRecords}`);
        S.ok(JSON.stringify(r.a) === '["今晚","顾问","记录","产品"]' && r.on, '极简模式默认也有「记录」tab', r);
        S.ok(JSON.stringify(r.b) === '["今晚","顾问","产品"]' && r.hid === true && r.saved === true && r.c.length === 4 && r.still === undefined, '设置「显示「记录」页」能关能开,按账号存进档案(走 saveProfile)', r);
    }
    {
        const p = await boot(`full()`);
        const r = await p.eval(`const vis=el=>getComputedStyle(el).display!=='none';return [...document.querySelectorAll('.tabbar .tab')].filter(vis).map(t=>t.textContent.trim())`);
        S.ok(JSON.stringify(r) === '["今晚","顾问","记录","产品"]', '完整模式四个 tab:今晚 / 顾问 / 记录 / 产品', r);
    }
    {
        const p = await boot(`full()`);
        const r = await p.eval(`show('skin');${wait(150)}const t=document.getElementById('skin').innerText;return {t,title:document.getElementById('skin-title').textContent,tab:document.getElementById('tab-skin').textContent}`);
        S.ok(r.title === '记录' && r.tab === '记录', '「皮肤」改名「记录」(标题和 tab)', r.title);
        S.ok(!/补记今天|刷酸节奏|今晚刷酸|今晚修护/.test(r.t) && /最近 14 天/.test(r.t) && /走势/.test(r.t) && /脸上哪里/.test(r.t), '记录页只回看:14 天、脸上哪里、走势;没有「补记今天」、刷酸节奏、今晚的状态句', r.t.slice(0, 300));
    }

    // ── 6. 顾问页 = 现在的方案(离线照样有)+ 问顾问;今晚页上不再有方案卡和未来 7 晚 ──
    {
        const p = await open({ blockPaths: ['/ai.js'] });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(900);
        const r = await p.eval(`const tn=document.getElementById('tonight');const onTn=!!tn.querySelector('#regimen-card,#next7,#ladder-card');show('coach');${wait(150)}
            const c=document.getElementById('coach');const vis=el=>!!el&&!el.closest('[hidden]')&&getComputedStyle(el).display!=='none';
            return {onTn,ai:typeof aiSend,kv:c.querySelectorAll('#regimen-card .kv dt').length,n7:c.querySelectorAll('#next7 .n7').length,ladder:vis(document.getElementById('ladder-card')),
                hist:c.querySelectorAll('#regimen-hist .row').length,ver:document.getElementById('plan-v').textContent,content:document.getElementById('coach-content').innerText,
                order:[...c.querySelectorAll('#coach-plan,#coach-content,#guide')].map(x=>x.id)}`);
        S.ok(!r.onTn, '今晚页上不再有方案卡、刷酸节奏、未来 7 晚', r);
        S.ok(r.ai === 'undefined' && r.kv >= 2 && r.n7 === 7 && r.ladder && r.hist >= 1 && /^v\d+/.test(r.ver), 'ai.js 没加载:顾问页的方案(为什么、7 晚、刷酸节奏、版本)照样都在', r);
        S.ok(/顾问没加载出来/.test(r.content) && JSON.stringify(r.order) === '["coach-plan","coach-content","guide"]', '顺序:现在的方案 → 问顾问 → 常识', r);
        S.ok(!p.errors.filter(e => !/ai\.js|Failed to load/.test(e)).length, '顾问页离线 0 报错', p.errors);
    }
    {
        const p = await boot(`full()`, { ai: 'none' });
        const r = await p.eval(`show('coach');${wait(200)}return {code:!!document.getElementById('co-code'),kv:document.querySelectorAll('#regimen-card .kv dt').length,
            n7:document.querySelectorAll('#next7 .n7').length,head:document.querySelector('#coach-content .sec-t').textContent,
            acts:document.getElementById('regimen-card').innerText}`);
        S.ok(r.code && r.kv >= 2 && r.n7 === 7 && r.head === '问顾问', '顾问没开通:方案照样看,下面「问顾问」是邀请码框', r);
        S.ok(!/让顾问出方案|让顾问重排/.test(r.acts), '没开通时方案段不出「让顾问出方案」', r.acts);
    }
    {
        const p = await boot(`full()`, { ai: 'on' });
        const r = await p.eval(`show('coach');${wait(200)}return {acts:[...document.querySelectorAll('#regimen-card .btn-row button')].map(b=>b.textContent),composer:!!document.getElementById('co-chat-text'),
            dupHist:/方案历史/.test(document.getElementById('coach-content').innerText)}`);
        S.ok(r.acts[0] === '问顾问' && /让顾问(出方案|重排)/.test(r.acts[1] || '') && r.composer && !r.dupHist, '顾问可用:方案段多「问顾问」「让顾问出方案 / 重排」,下面不再重复一份方案历史', r);
    }
    {
        const p = await boot(`fresh()`);
        const r = await p.eval(`closeSheet('oobe');_oobe=null;renderAll();${wait(80)}const sit=document.getElementById('tn-sit').hidden;show('coach');${wait(150)}
            return {sit,empty:document.getElementById('regimen-card').innerText,n7:document.getElementById('next7-sec').hidden,ladder:document.getElementById('ladder-card').hidden,
                tn:(show('tonight'),document.getElementById('tn-plan').innerText)}`);
        S.ok(r.sit && /货架还是空的/.test(r.tn), '空货架:今晚页不问洗澡 / 刮胡,只说货架空', r);
        S.ok(/还没有方案/.test(r.empty) && /去「产品」添加/.test(r.empty) && r.n7 && r.ladder, '空货架:顾问页方案段说怎么开始,7 晚和刷酸节奏先藏起来', r);
    }
}
