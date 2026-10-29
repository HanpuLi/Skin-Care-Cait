// 补回「排洗澡 / 刮胡」(Cait 10/29):顾问页「接下来 7 晚」每晚直接点洗澡 / 刮胡,酸和面膜按现有排班逻辑立刻重排;
//   存成每周习惯(sk_preset1)/ 按习惯填(App 的 sheet 确认);今晚页开关和 7 晚的今晚那行同一份;记录页看得出哪天洗了 / 刮了;
//   写入只走 ls()(同步信封),CLOUD_KEYS 不变,不新增 sk_ 键。
// 补回「指南」:顾问页底部折叠的「常识」,写死的固定内容;离线可见、0 emoji;顾问可用时每节末尾「问顾问」预填「这条『节名』对我现在意味着什么?」。
const KEYS19 = ['sk_wk1', 'sk_jrnl1', 'sk_cd1', 'sk_prods1', 'sk_popen1', 'sk_tn1', 'sk_tnsteps1', 'sk_amsteps1', 'sk_proddefs1', 'sk_profile1', 'sk_preset1', 'sk_planday1', 'sk_mig1', 'sk_empty1', 'sk_gone1', 'sk_low1', 'sk_regimen1', 'sk_tnai1', 'sk_ai1'];
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
    const ROW = `const row=d=>document.querySelector('#next7 .n7[data-date="'+d+'"]');const tg=(d,k)=>row(d).querySelector('.tgl'+(k==='shave'?'.feat-shave':':not(.feat-shave)'));`;

    // ── A1. 点未来某晚「刮胡」:那晚的酸挪走,那一行即时写「原来:…」;写进 sk_wk1(走信封),CLOUD_KEYS 不变 ──
    {
        const p = await boot(`full({profile:{acidLevel:3,acidLevelAt:__d(-1)}})`);   // 每周 3 次:未来 7 晚里一定有刷酸夜
        const r = await p.eval(`show('coach');${wait(150)}${ROW}
            const day=computePlanRolling().find(d=>d.isFuture&&(d.items||[]).some(it=>it.type==='acid'));if(!day)return {none:true};
            const keys0=Object.keys(localStorage).filter(k=>/^sk_/.test(k)).sort();const gen0=syncKeyGen('sk_wk1');const lbl0=row(day.date).querySelector('.lede').textContent;
            tg(day.date,'shave').click();${wait(120)}
            const after=computePlanRolling().find(d=>d.date===day.date);const r1=row(day.date);
            return {date:day.date,lbl0,lbl1:r1.querySelector('.lede').textContent,chg:(r1.querySelector('.n7-chg')||{}).textContent||'',pressed:tg(day.date,'shave').getAttribute('aria-pressed'),
                acid:(after.items||[]).some(it=>it.type==='acid'),st:getDayState(day.date),gen:syncKeyGen('sk_wk1')-gen0,
                newKeys:Object.keys(localStorage).filter(k=>/^sk_/.test(k)&&keys0.indexOf(k)<0),cloud:CLOUD_KEYS.slice(),dialogs:0}`);
        S.ok(!r.none, '种子里未来 7 晚有一晚刷酸', r);
        S.ok(r.st && r.st.shave && !r.acid && /^刮胡/.test(r.lbl1) && r.pressed === 'true', '点那晚「刮胡」:排班立刻重排,那晚不再刷酸', r);
        S.ok(r.chg === '原来：' + r.lbl0 && /^刷酸/.test(r.lbl0), '那一行即时写「原来:刷酸 · …」', r);
        S.ok(r.gen >= 1, '写 sk_wk1 走 ls()(信封里这个键的改动计数 +1)', r.gen);
        S.ok(JSON.stringify(r.cloud) === JSON.stringify(KEYS19) && !r.newKeys.filter(k => KEYS19.indexOf(k) < 0 && !/^sk_sync|^sk_lastpush|^sk_uid/.test(k)).length, 'CLOUD_KEYS 还是那 19 个;只写已有的 sk_wk1,没新增别的 sk_ 键', r);
        S.ok(!p.errors.length && !p.dialogs.length, '排洗澡 / 刮胡 0 报错、没有原生弹窗', { e: p.errors, d: p.dialogs });
    }
    // ── A2. 今晚页开关 ⇄ 7 晚的今晚那行:同一份数据 ──
    {
        const p = await boot(`full()`);
        const r = await p.eval(`show('coach');${wait(120)}${ROW}const t=today();
            const a0={tn:TN.shower,row:tg(t,'shower').getAttribute('aria-pressed')};
            show('tonight');document.getElementById('tn-sh').click();${wait(100)}show('coach');${wait(120)}
            const a1={tn:TN.shower,row:tg(t,'shower').getAttribute('aria-pressed'),day:getDayState(t).shower};
            tg(t,'shave').click();${wait(120)}show('tonight');${wait(80)}
            const a2={tn:TN.shave,sw:document.getElementById('tn-sv').checked,fx:document.getElementById('tn-sit-fx').textContent,title:document.getElementById('tn-title').textContent};
            return {a0,a1,a2}`);
        S.ok(String(r.a0.tn) === r.a0.row && r.a1.tn === !r.a0.tn && r.a1.row === String(r.a1.tn) && r.a1.day === r.a1.tn, '今晚页点「洗澡」:7 晚里今晚那行跟着变', r);
        S.ok(r.a2.tn && r.a2.sw && r.a2.title === '刮胡夜' && /^刮胡夜：/.test(r.a2.fx), '7 晚里点今晚「刮胡」:今晚页开关、标题、影响说明跟着变', r.a2);
    }
    // ── A3. 存成每周习惯 / 按习惯填(App 的 sheet,不用原生 confirm) ──
    {
        const p = await boot(`full()`);
        const r = await p.eval(`show('coach');${wait(120)}${ROW}
            fillWeekHabit();${wait(60)}const none=[...document.querySelectorAll('#sheet-root .sheet-t')].map(x=>x.textContent).join();document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());
            const ds=[0,1,2,3,4,5,6].map(i=>offsetDate(i));
            ds.forEach((d,i)=>setDayState(d,i%2===0,i===3));invalidatePlanCache();renderTn();renderRegimenCard();
            const want=ds.map(d=>getDayState(d));
            [...document.querySelectorAll('#next7-sec .n7-acts button')].find(b=>b.textContent==='存成每周习惯').click();${wait(60)}
            const preset=lg(K.preset);const st=document.getElementById('n7-st').textContent;
            ds.forEach(d=>setDayState(d,false,false));invalidatePlanCache();renderTn();renderRegimenCard();
            [...document.querySelectorAll('#next7-sec .n7-acts button')].find(b=>b.textContent==='按习惯填').click();${wait(60)}
            const sh=document.querySelector('#sheet-root .sheet-ov');const title=sh&&sh.querySelector('.sheet-t').textContent;const body=sh&&sh.innerText;
            [...sh.querySelectorAll('button')].find(b=>b.textContent==='按习惯填').click();${wait(120)}
            return {none,preset,st,title,body,got:ds.map(d=>getDayState(d)),want,tn:{s:TN.shower,v:TN.shave},row0:tg(ds[0],'shower').getAttribute('aria-pressed')}`);
        S.ok(/还没存过习惯/.test(r.none), '没存过习惯就点「按习惯填」:sheet 说先存', r.none);
        S.ok(Array.isArray(r.preset) && r.preset.length === 7 && r.preset.every(x => typeof x.dow === 'number') && /存好了/.test(r.st), '「存成每周习惯」:按星期几存进 sk_preset1(7 天)', r);
        S.ok(/按习惯填/.test(r.title) && /盖掉/.test(r.body), '「按习惯填」先用 App 的 sheet 确认', r.title);
        S.ok(JSON.stringify(r.got) === JSON.stringify(r.want) && r.tn.s === r.want[0].shower && r.row0 === String(r.want[0].shower), '填回来的 7 天和存的一样,今晚开关也跟着', r);
        S.ok(!p.dialogs.length && !p.errors.length, '没有原生 confirm / alert,0 报错', { d: p.dialogs, e: p.errors });
    }
    // ── A4. 极简模式也能排(只有洗澡,没有刮胡);记录页看得出哪天洗了 / 刮了 ──
    {
        const p = await boot(`minimal()`);
        const r = await p.eval(`show('coach');${wait(120)}const vis=el=>getComputedStyle(el).display!=='none';
            const r0=document.querySelector('#next7 .n7');return {sh:vis(r0.querySelector('.tgl:not(.feat-shave)')),sv:vis(r0.querySelector('.tgl.feat-shave'))}`);
        S.ok(r.sh && !r.sv, '极简:7 晚里能点洗澡,没开刮胡就不出刮胡', r);
    }
    {
        const p = await boot(`full({today:true})`);
        const r = await p.eval(`const y=__d(-1),y2=__d(-2);const all=lg(K.wk)||{};
            [y,y2].forEach(d=>{const wk=isoWeek(new Date(d+'T12:00:00'));all[wk]=all[wk]||_habitWeek(wk);all[wk].shower=all[wk].shower.slice();all[wk].shave=all[wk].shave.slice();});
            const set=(d,s,v)=>{const wk=isoWeek(new Date(d+'T12:00:00'));const i=wkIdxForDate(d);all[wk].shower[i]=s;all[wk].shave[i]=v;};set(y,true,false);set(y2,false,true);ls(K.wk,all);
            show('skin');${wait(200)}const btn=d=>[...document.querySelectorAll('#heat-grid button')].find(b=>b.getAttribute('onclick').indexOf(d)>=0);
            const rows=[...document.querySelectorAll('#jh-list .row .note')].map(x=>x.textContent);
            return {y:btn(y).getAttribute('aria-label'),ym:btn(y).querySelector('.mks').textContent,y2:btn(y2).getAttribute('aria-label'),y2m:btn(y2).querySelector('.mks').textContent,
                legend:document.getElementById('heat-legend').innerText,row:rows.find(t=>t.indexOf(mdOf(y)+' ')===0)||'',row2:rows.find(t=>t.indexOf(mdOf(y2)+' ')===0)||''}`);
        S.ok(/洗澡/.test(r.y) && r.ym === '洗' && /刮胡/.test(r.y2) && r.y2m === '刮', '记录页 14 天:那天洗了标「洗」、刮了标「刮」(读屏念「洗澡」「刮胡」)', r);
        S.ok(/洗澡/.test(r.legend) && /刮胡/.test(r.legend) && /洗澡/.test(r.row) && /刮胡/.test(r.row2), '图例有说明;每天的记录那一行也写「洗澡」「刮胡」', r);
    }

    // ── B. 常识:离线可见、0 emoji、各节都在;顾问可用时「问顾问」预填 ──
    {
        const p = await open({ blockPaths: ['/ai.js'] });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(900);
        const r = await p.eval(`show('coach');${wait(150)}const g=document.getElementById('guide');g.open=true;${wait(50)}
            const t=g.innerText;const asks=[...g.querySelectorAll('.g-ask')].filter(b=>!b.hidden).length;
            return {t,asks,titles:[...g.querySelectorAll('.g-t')].map(x=>x.textContent),emoji:/[\\p{Extended_Pictographic}]/u.test(g.textContent)}`);
        S.ok(['怎么用', '这几件事别做', '什么时候该看医生', '刷酸从哪起步', '洗澡夜与刷酸时机', '非洗澡夜', '刮胡 = 机械性去角质'].every(x => r.titles.indexOf(x) >= 0), 'ai.js 没加载(离线 / 顾问不可用):「常识」各节照样能看', r.titles);
        S.ok(!r.emoji && r.asks === 0, '0 emoji;顾问用不了时不出「问顾问」', r);
        S.ok(/泛红 5 天以上/.test(r.t) && /冒痘 10 天以上/.test(r.t) && /最近 3 天还在/.test(r.t) && /所有酸都停/.test(r.t) && /眼霜照用/.test(r.t), '就医口径按现在的规则写(泛红 ≥5 天 / 冒痘 ≥10 天、最近 3 天还在;所有酸停、眼霜照用)', r.t.slice(0, 600));
        S.ok(/每周 1 次温和酸/.test(r.t) && /「今晚」/.test(r.t) && /「顾问」/.test(r.t) && /「记录」/.test(r.t) && /「产品」/.test(r.t), '「刷酸从哪起步」写了没有耐受史从每周 1 次温和酸起步;「怎么用」按四个 tab 写', r.t.slice(0, 400));
        S.ok(/41°C/.test(r.t) && /10 分钟/.test(r.t), '老版引用的研究说法原样保留(41°C、10 分钟)', '');
        S.ok(!p.errors.filter(e => !/ai\.js|Failed to load/.test(e)).length, '常识离线 0 报错', p.errors);
    }
    {
        const p = await boot(`minimal()`, { ai: 'on' });
        const r = await p.eval(`show('coach');${wait(200)}const g=document.getElementById('guide');g.open=true;${wait(50)}
            const vis=el=>getComputedStyle(el).display!=='none'&&!el.hidden&&!el.closest('[hidden]');
            const asks=[...g.querySelectorAll('.g-ask')].filter(vis);const shave=vis(document.getElementById('g-shave').closest('.g-sec'));
            asks.find(b=>b.closest('.g-sec').querySelector('#g-shower')).click();${wait(150)}
            return {n:asks.length,shave,val:document.getElementById('co-chat-text').value,active:document.getElementById('coach').classList.contains('active'),focus:document.activeElement&&document.activeElement.id}`);
        S.ok(r.n >= 6 && !r.shave, '顾问可用:每节末尾有「问顾问」;没开刮胡的看不到刮胡那节', r);
        S.ok(r.val === '这条『洗澡夜与刷酸时机』对我现在意味着什么？' && r.active && r.focus === 'co-chat-text', '点「问顾问」:打开顾问对话,预填「这条『洗澡夜与刷酸时机』对我现在意味着什么?」', r);
        S.ok(!p.errors.length, '常识问顾问 0 报错', p.errors);
    }

    // ── A5. 两套洗澡习惯合成一套(Cait 10/29):sk_preset1 为准,PROFILE.showerDays 是镜像;旧数据各种情况迁移一次、不丢 ──
    const PRESET = sh => JSON.stringify([1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, shower: sh.indexOf(d) >= 0, shave: d === 5 })));
    const chips = `(()=>{openSettings();const r=[...document.querySelectorAll('#set-shower .chip')].filter(c=>c.getAttribute('aria-pressed')==='true').map(c=>c.textContent.trim());closeSettings();return r})()`;
    {   // 只有设置里的洗澡日(B3)→ 补出 sk_preset1
        const p = await boot(`full({profile:{showerDays:[1,4]}})`);
        const r = await p.eval(`const pr=lg(K.preset);return {pr:pr&&pr.filter(x=>x.shower).map(x=>x.dow).sort(),n:pr&&pr.length,chips:${chips}}`);
        S.ok(r.n === 7 && JSON.stringify(r.pr) === '[1,4]' && JSON.stringify(r.chips) === '["周一","周四"]', '只有「通常哪几天洗澡」:迁移成 sk_preset1(周一、周四),设置里照旧', r);
    }
    {   // 只有老版排班页存的模版 → 补出 showerDays 镜像
        const p = await boot(`full({extra:{sk_preset1:${PRESET([6])}}})`);
        const r = await p.eval(`return {sd:PROFILE.showerDays,chips:${chips},pr:lg(K.preset).find(x=>x.dow===5).shave}`);
        S.ok(JSON.stringify(r.sd) === '[6]' && JSON.stringify(r.chips) === '["周六"]' && r.pr === true, '只有老版模版:设置里显示模版的洗澡日(周六),刮胡习惯留着', r);
    }
    {   // 两份都有、对不上:洗澡日以设置为准(App 一直按它排),刮胡留模版的;原模版存进 PROFILE.habitPrev
        const p = await boot(`full({profile:{showerDays:[1,4]},extra:{sk_preset1:${PRESET([2])}}})`);
        const r = await p.eval(`const pr=lg(K.preset);return {sh:pr.filter(x=>x.shower).map(x=>x.dow).sort(),sv:pr.filter(x=>x.shave).map(x=>x.dow),prev:PROFILE.habitPrev&&PROFILE.habitPrev.preset.filter(x=>x.shower).map(x=>x.dow),chips:${chips}}`);
        S.ok(JSON.stringify(r.sh) === '[1,4]' && JSON.stringify(r.sv) === '[5]' && JSON.stringify(r.prev) === '[2]' && JSON.stringify(r.chips) === '["周一","周四"]', '两份对不上:洗澡日按设置,刮胡按模版,原模版另存一份不丢', r);
        await p.reload(800);
        const r2 = await p.eval(`return {prev:PROFILE.habitPrev.preset.filter(x=>x.shower).map(x=>x.dow),sh:lg(K.preset).filter(x=>x.shower).map(x=>x.dow).sort()}`);
        S.ok(JSON.stringify(r2.prev) === '[2]' && JSON.stringify(r2.sh) === '[1,4]', '再打开一次:迁移不重跑、备份不被覆盖', r2);
    }
    {   // 同步:设置里点一下 ⇄ 顾问页「存成每周习惯」,改一处另一处跟着
        const p = await boot(`full({profile:{showerDays:[1]}})`);
        const r = await p.eval(`openSettings();[...document.querySelectorAll('#set-shower .chip')].find(c=>c.textContent.trim()==='周三').click();${wait(80)}closeSettings();
            const a={pr:lg(K.preset).filter(x=>x.shower).map(x=>x.dow).sort(),sd:PROFILE.showerDays.slice().sort()};
            const d=[0,1,2,3,4,5,6].map(i=>offsetDate(i));d.forEach(x=>setDayState(x,new Date(x+'T12:00:00').getDay()===5,false));invalidatePlanCache();
            show('coach');${wait(100)}[...document.querySelectorAll('#next7-sec .n7-acts button')].find(b=>b.textContent==='存成每周习惯').click();${wait(80)}
            const b={pr:lg(K.preset).filter(x=>x.shower).map(x=>x.dow),sd:PROFILE.showerDays,chips:${chips}};
            const far=offsetDate(35);const wk=isoWeek(new Date(far+'T12:00:00'));const untouched=!(lg(K.wk)||{})[wk];
            return {a,b,untouched,far:getDayState(far).shower,farDow:new Date(far+'T12:00:00').getDay()}`);
        S.ok(JSON.stringify(r.a.pr) === '[1,3]' && JSON.stringify(r.a.sd) === '[1,3]', '设置里点「周三」:sk_preset1 和 showerDays 一起改', r.a);
        S.ok(JSON.stringify(r.b.pr) === '[5]' && JSON.stringify(r.b.sd) === '[5]' && JSON.stringify(r.b.chips) === '["周五"]', '顾问页「存成每周习惯」:设置里的洗澡日跟着变', r.b);
        S.ok(r.untouched && r.far === (r.farDow === 5), '没单独改过的周按这份习惯默认排', r);
        S.ok(!p.errors.length, '习惯合并 0 报错', p.errors);
    }
    // ── 改版说明:老账号第一次打开弹一次(App 的 sheet,4 条,0 emoji);点「知道了」按账号记已读;新用户走引导的不弹 ──
    for (const who of ['full', 'minimal']) {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}({profile:{tourIA:false}})`);
        await p.reload(2200);
        const r = await p.eval(`const t=document.getElementById('tour');return {t:!!t,title:t&&t.querySelector('.sheet-t').textContent,rows:t?[...t.querySelectorAll('.row')].map(x=>x.innerText.replace(/\s+/g,' ')):[],
            emoji:t?/[\p{Extended_Pictographic}]/u.test(t.textContent):true}`);
        const all = r.rows.join(' | ');
        const n = who === 'full' ? 4 : 3;
        S.ok(r.t && r.title === '这一版改了什么' && r.rows.length === n && !r.emoji, `${who}:老账号弹一次「这一版改了什么」,${n} 条,0 emoji`, r);
        S.ok(/「顾问」/.test(all) && /「记录」/.test(all) && /每周习惯/.test(all) && (who === 'full' ? /只记皮肤/.test(all) && /刮胡/.test(all)
            : /护肤品不用打卡，排上的默认都算用了；皮肤状况点「记一下皮肤」，在「记录」里回看。/.test(all) && !/刮胡/.test(all)),
            `${who}:写了方案搬到顾问、${who === 'full' ? '皮肤改叫记录、只记皮肤、7 晚排洗澡刮胡' : '护肤品不用打卡 / 记一下皮肤 / 在记录里回看、7 晚排洗澡'}`, all);
        await p.eval(`[...document.querySelectorAll('#tour button')].find(b=>b.textContent==='知道了').click();return 1`);
        const saved = await p.eval(`return (lg(K.profile)||{}).tourIA`);
        await p.reload(2200);
        const again = await p.eval(`return !!document.getElementById('tour')`);
        S.ok(saved === true && !again, `${who}:点「知道了」记进档案,再打开不弹`, { saved, again });
        S.ok(!p.errors.length && !p.dialogs.length, `${who}:改版说明 0 报错、没有原生弹窗`, p.errors.concat(p.dialogs));
    }
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.fresh()`);
        await p.reload(2200);
        const r = await p.eval(`const oobe=!!document.getElementById('oobe');await oobeFinish();${wait(2000)}maybeShowTour();${wait(100)}return {oobe,tour:!!document.getElementById('tour'),ia:PROFILE.tourIA}`);
        S.ok(r.oobe && !r.tour && r.ia === true, '新用户:走引导,走完不弹改版说明(直接记成已读)', r);
    }
}
