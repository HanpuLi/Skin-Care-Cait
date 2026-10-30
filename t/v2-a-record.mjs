// A 路 · 记录页 + 记皮肤的 sheet + 脸部地图(无头 Chrome,假顾问后端,不花钱):
//   顶部随时记一笔(一句话 → 本机看出状态 / 位置,只是建议,点了才写;按分句配位置)、拍一张(不分析时只存本机)
//   首页 #/record:记一笔 · 拍照分析 · 今天记下的(+ 顾问反馈)· 两条「→」行(变化 / 历史,各带一句现状)
//   二级页 #/record/changes:本月、近 14 天(酸 / 澡 / 刮标记)、脸部热度(点区看哪几天)、走势、HRT(最近 12 条,只在本人开了时);#/record/history:历史(点一天补记 / 改)
//   补齐(v1 → v2):❌1 某一天「那晚用了哪些活性」chip(写 products、清 auto)· ❓2 那晚做了 / 没做 · ❌3 缩略图点开看大图 · ❌4 顾问反馈「照这个调」→ 顾问页预填 · ❓1 HRT 最近 12 条
//   记皮肤的 sheet:状态标签、脸部地图(11 区,只点区域;完整模式勾了闭口这类顺手展开、极简默认收起但入口一直在)、备注;关掉后要顾问反馈
//   顾问反馈:本机操作后才调、按「这天记了什么」去重(重画 / 没改不重调)、出错可重试、note_add 一点加进记录
//   跑:node t/v2-a-record.mjs
import path from 'node:path';
import { run, tab, click, log, sleep, setFile, ENV, TODAY_EN, PROBE, ROOT } from './v2-a-lib.mjs';

const R = `const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];`;
// 进记录的二级页(直达地址,和用户点「→」行到的是同一个路由)
const goPage = async (p, page, ms = 300) => { await p.eval(`location.hash='#/record${page ? '/' + page : ''}';return 1`); await sleep(ms); };
const typeNote = (p, text) => p.eval(`const b=document.getElementById('rec-q');b.value=${JSON.stringify(text)};b.dispatchEvent(new Event('input',{bubbles:true}));return 1`);
// 13 天的种子日志:前 3 天下巴红痘、第 4 天额头闭口;第 3 天刷过酸
const JR = `{jrnl:Array.from({length:13},(_,k)=>({date:__d(-1-k),status:k<5?['闭口','爆痘']:['出油'],products:k===2?['PC酸']:[],note:'',phase:'',spots:k<3?[{zone:'下巴',type:'红痘'}]:k===3?[{zone:'额头',type:'闭口'}]:[]})),extra:{sk_preset1:[1,2,3,4,5,6,0].map(d=>({dow:d,shower:true,shave:d===3}))}}`;

await run('v2-a-record', [
    ['完整模式 · 结构:随时记一笔在顶上,下面回看', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: JR, hash: '#/record' });
        await tab(p, 'record', 300);
        const home = await p.eval(R + `return {h1:(q('#record-h')||{}).textContent,label:(q('#rec-q-l')||{}).textContent,ta:!!q('#rec-q'),go:(q('#rec-q-go')||{}).textContent,
            photo:!!q('#rec-file'),secs:qa('#record section').map(x=>x.id||x.className),navs:qa('#record .nav-row').map(x=>({href:x.getAttribute('href'),t:x.innerText.replace(/\\s+/g,' ').trim(),h:x.getBoundingClientRect().height})),
            photosNote:(q('#rec-photos')||{}).innerText||''}`);
        await goPage(p, 'changes');
        const ch = await p.eval(R + `return {h1:(q('#record .pg-t')||{}).textContent,back:(q('#record .pg-back')||{}).textContent,secs:qa('#record section').map(x=>x.id||x.className),
            d14:qa('#rec-14 .d14-c').length,today:qa('#rec-14 .d14-c.today').length,marks:qa('#rec-14 .d14-m').map(x=>x.textContent.trim()).filter(Boolean),
            heatTop:qa('#rec-heat .heat-top li').map(x=>x.innerText.replace(/\\s+/g,' ')),fm:!!q('#rec-heat .fm'),zoneBtns:qa('#rec-heat .fm-b').length,
            trend:qa('#rec-trend .trend-rows li').map(x=>x.innerText.replace(/\\s+/g,' ')),hrt:!!q('#rec-hrt'),month:(q('#rec-month')||{}).innerText||''}`);
        await goPage(p, 'history');
        const hs = await p.eval(R + `return {h1:(q('#record .pg-t')||{}).textContent,hist:qa('#rec-hist [data-act=day]').length,pick:!!q('#rec-hist [data-act=day-pick]'),secs:qa('#record section').map(x=>x.id||x.className)}`);
        const v = Object.assign({}, home, ch, hs, { secs: ch.secs });
        S.ok(home.h1 === '记录' && /今天皮肤怎么样/.test(home.label) && home.ta && home.go === '记下' && home.photo, '首页顶部:一句话 + 拍一张 + 记下', home);
        S.ok(home.secs.join() === 'rec-quick,rec-photos,rec-today', '首页只有:记一笔 → 拍照分析 → 今天记下的(其余都搬进二级页)', home.secs);
        S.ok(home.navs.length === 2 && home.navs[0].href === '#/record/changes' && home.navs[1].href === '#/record/history' && home.navs.every(x => x.h >= 52), '首页两条「→」行:变化 / 历史,整行 ≥52px', home.navs);
        S.ok(/变化/.test(home.navs[0].t) && /本月完成 \d+ 晚/.test(home.navs[0].t) && /历史/.test(home.navs[1].t) && /最近 \d+月\d+日/.test(home.navs[1].t), '「→」行写着现状(本月完成几晚 / 最近哪天),不点进去也知道', home.navs.map(x => x.t));
        S.ok(ch.h1 === '变化' && /记录/.test(ch.back) && hs.h1 === '历史', '二级页:页头 h1 + 「‹ 记录」返回', { ch: ch.h1, back: ch.back, hs: hs.h1 });
        S.ok(v.secs.join() === 'rec-month,rec-14,rec-heat,rec-trend', '变化页顺序:本月 → 近 14 天 → 位置 → 走势(没开 HRT 没有 HRT)', v.secs);
        S.ok(/完成今晚/.test(v.month) && /刷了酸/.test(v.month), '变化页:本月小结', v.month);
        S.ok(v.d14 === 14 && v.today === 1, '近 14 天:14 格,今天那格标出来', v);
        S.ok(v.marks.includes('酸') && v.marks.includes('澡') && v.marks.includes('刮'), '近 14 天里标了刷酸 / 洗澡 / 刮胡', v.marks);
        S.ok(v.fm && v.zoneBtns === 11, '脸部热度:同一张脸,11 个区', v);
        S.ok(/^下巴 .*3 天/.test(v.heatTop[0] || '') && v.heatTop.some(x => /^额头 .*1 天/.test(x)), '常出现的位置:下巴 3 天在最前,额头 1 天', v.heatTop);
        S.ok(v.trend.some(x => /闭口/.test(x)), '走势:这 7 天和前 7 天各几天', v.trend);
        S.ok(!v.hrt, '没开 HRT:不显示 HRT 那一段', v.hrt);
                S.ok(/没打开|登录/.test(home.photosNote), '照片分析没开 / 没登录:说清楚,只给「拍一张」(只存本机)', home.photosNote);
        S.ok(v.hist >= 10 && v.pick, '历史页:一天一行可点 + 「补记某一天」', v);
        // 点下巴:看是哪几天
        await goPage(p, 'changes');
        await click(p, '#heat-fz-chin', 200);
        const sel = await p.eval(R + `return {t:(q('#rec-heat .fm-pick')||{}).innerText||'',pressed:q('#heat-fz-chin').getAttribute('aria-pressed')}`);
        S.ok(/下巴 · 近 14 天 3 天/.test(sel.t) && /昨天：红痘/.test(sel.t) && sel.pressed === 'true', '点下巴:列出哪几天、什么', sel);
        // 点历史里的一天 → 那天的 sheet,能改
        await goPage(p, 'history');
        const d3 = await p.eval(`return __d(-3)`);
        await click(p, `#rec-hist [data-date="${d3}"]`, 300);
        const sh = await p.eval(R + `const ov=q('#skin-sheet');return {t:ov&&ov.querySelector('.sheet-t').textContent,photo:!!(ov&&ov.querySelector('.sk-photo:not([hidden]), [data-sk=capture], #sk-file'))}`);
        S.ok(sh.t && /的皮肤$/.test(sh.t) && !sh.photo, '点历史里的一天:那天的 sheet(过去的日子不拍照;那天这台设备上没照片就不显示照片栏)', sh);
        await click(p, '#sk-sym-泛红', 150);
        await click(p, '#skin-sheet .sheet-actions .btn-primary', 300);
        const e3 = await p.eval(`return (${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(-3))`);
        S.ok(e3.status.includes('泛红') && e3.status.includes('闭口'), '补记某一天:写进那天,原来的不动', e3.status);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['随时记一笔:一句话 → 看出状态和位置(只是建议)→ 就这样记上 / 改一下 / 不用', async ({ S, open }) => {
        const p = await open({ seed: 'full', hash: '#/record' });
        await tab(p, 'record', 300);
        await goPage(p, 'changes');
        const mk = await p.eval(`return {n:document.querySelectorAll('#rec-14 .d14-m').length,note:document.querySelector('#rec-14 > .note').textContent}`);
        S.ok(mk.n === 0 && !/「酸」/.test(mk.note), '近 14 天没刷酸 / 没洗澡刮胡记录:不留空的标记行', mk);
        await goPage(p, '');
        await typeNote(p, '下巴两颗红痘，额头有点干');
        await click(p, '#rec-q-go', 300);
        const a = await p.eval(R + `return {en:${TODAY_EN},parse:(q('#rec-parse')||{}).innerText||'',draft:q('#rec-q').value}`);
        S.ok(a.en.note === '下巴两颗红痘，额头有点干' && a.draft === '', '记下:这句话先存进今天的备注,输入框清空', a);
        S.ok(!(a.en.status || []).length && !(a.en.spots || []).length, '看出来的只是建议:还没写状态和位置', a.en);
        S.ok(/新痘/.test(a.parse) && /干/.test(a.parse) && /下巴：红痘/.test(a.parse) && !/额头：红痘/.test(a.parse), '看出:新痘、干;位置按分句配(下巴:红痘,不会配出额头:红痘)', a.parse);
        await click(p, '#rec-parse [data-act=parse-ok]', 300);
        const b = await p.eval(R + `return {en:${TODAY_EN},parse:!!q('#rec-parse'),today:(q('#rec-today')||{}).innerText||''}`);
        S.ok(b.en.status.includes('爆痘') && b.en.status.includes('干燥') && JSON.stringify(b.en.spots) === JSON.stringify([{ zone: '下巴', type: '红痘' }]) && !b.parse, '「就这样记上」:写进今天的状态 + 脸部地图', b.en);
        S.ok(/新痘/.test(b.today) && /下巴：红痘/.test(b.today) && /额头有点干/.test(b.today), '「今天记下的」里看得到', b.today);
        // 第二句:否定 / 好了的不算
        await typeNote(p, '没有泛红，鼻翼起皮');
        await click(p, '#rec-q-go', 300);
        const c = await p.eval(R + `return {en:${TODAY_EN},parse:(q('#rec-parse')||{}).innerText||''}`);
        S.ok(/鼻翼起皮/.test(c.en.note) && /；/.test(c.en.note), '再记一句:接在备注后面', c.en.note);
        S.ok(!/泛红/.test(c.parse) && /鼻子：干皮/.test(c.parse), '「没有泛红」不算;鼻翼 → 鼻子:干皮', c.parse);
        await click(p, '#rec-parse [data-act=parse-edit]', 300);
        const d = await p.eval(R + `const ov=q('#skin-sheet');return {open:!!ov,hint:qa('#skin-sheet .chip.hint').map(x=>x.textContent),fm:(q('#sk-fm-t')||{}).getAttribute&&q('#sk-fm-t').getAttribute('aria-expanded'),noseHint:!!q('#sk-fz-nose .fm-mk.hint')}`);
        S.ok(d.open && d.fm === 'true' && d.noseHint, '「改一下」:打开记皮肤的 sheet,有建议的位置时脸部地图展开,鼻子标成「建议」(还没写)', d);
        await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`); await sleep(200);
        const e = await p.eval(`return ${TODAY_EN}`);
        S.ok(!(e.spots || []).some(s => s.zone === '鼻子'), '没点就关掉:建议不会自己写进去', e.spots);
        // 「不用」
        await typeNote(p, '两颊有点红');
        await click(p, '#rec-q-go', 300);
        await click(p, '#rec-parse [data-act=parse-no]', 300);
        const f = await p.eval(`return ${TODAY_EN}`);
        S.ok(!f.status.includes('泛红') && /两颊有点红/.test(f.note), '「不用」:只留这句话,状态不动(就医红线只数她自己点的)', f);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['记皮肤的 sheet:标签 / 脸部地图(只点区域)/ 备注;完整模式顺手展开,极简默认收起', async ({ S, open }) => {
        for (const who of ['full', 'minimal']) {
            const p = await open({ seed: who, hash: '#/record' });
            await tab(p, 'record', 300);
            await click(p, '#rec-more', 300);
            const a = await p.eval(R + `return {t:(q('#skin-sheet .sheet-t')||{}).textContent,tr:qa('#skin-sheet [data-sk=trend]').length,sym:qa('#skin-sheet [data-sk=sym]').map(x=>x.textContent),
                fm:(q('#sk-fm-t')||{getAttribute:()=>null}).getAttribute('aria-expanded'),note:!!q('#sk-note'),photo:!!q('#skin-sheet .sk-photo')}`);
            S.ok(a.tr === 3 && a.sym.length === 6 && a.note && a.photo, `${who}:好些 / 差不多 / 差些 + 6 个具体情况 + 照片 + 备注`, a);
            S.ok(a.fm === 'false', `${who}:脸部地图入口在,默认收起`, a.fm);
            await click(p, '#sk-sym-闭口', 200);
            const fm2 = await p.eval(`return document.getElementById('sk-fm-t').getAttribute('aria-expanded')`);
            S.ok(who === 'full' ? fm2 === 'true' : fm2 === 'false', who === 'full' ? 'full:勾了闭口 → 脸顺手展开' : 'minimal:勾了也不自动展开(不催)', fm2);
            if (fm2 !== 'true') await click(p, '#sk-fm-t', 200);
            const z = await p.eval(R + `return {n:qa('#skin-sheet .fm-b').length,svg:qa('#skin-sheet .fz').length}`);
            S.ok(z.n === 11 && z.svg === 11, `${who}:11 个区(按钮 + 线描形状)`, z);
            await click(p, '#sk-fz-peri', 200);
            await click(p, '#sk-sp-0', 150); await click(p, '#sk-sp-3', 150);
            await click(p, '#sk-fz-cheekL', 200); await click(p, '#sk-sp-3', 150);
            const en = await p.eval(`return ${TODAY_EN}`);
            S.ok(JSON.stringify(en.spots) === JSON.stringify([{ zone: '口周', type: '闭口' }, { zone: '口周', type: '泛红' }, { zone: '左脸颊', type: '泛红' }]), `${who}:点区 → 选类型(可多选),只存区域`, en.spots);
            const lbl = await p.eval(`return document.getElementById('sk-fz-peri').getAttribute('aria-label')`);
            S.ok(/口周，已标：闭口、泛红/.test(lbl), `${who}:读屏念区名和标了什么`, lbl);
            await click(p, '#skin-sheet [data-sk=clearzone]', 150);
            const en1 = await p.eval(`return ${TODAY_EN}`);
            S.ok(!(en1.spots || []).some(s => s.zone === '左脸颊') && (en1.spots || []).length === 2, `${who}:「清掉这一处」只清选中的那个区`, en1.spots);
            const red = await p.eval(PROBE + `;return __probe('#skin-sheet .sheet')`);
            S.ok(!red.emoji.length && !red.lowCr.length && !red.smallN && red.red === 0, `${who}:sheet 0 emoji、对比度、触控 ≥44、没有红`, { e: red.emoji, cr: red.lowCr, small: red.small, red: red.red });
            await p.eval(`document.getElementById('sk-note').value='测一下';return 1`);
            await click(p, '#skin-sheet .sheet-actions .btn-primary', 300);
            const en2 = await p.eval(`return ${TODAY_EN}`);
            S.ok(en2.note === '测一下' && en2.status.includes('闭口'), `${who}:备注 + 标签存下`, en2);
            const tabRec = await p.eval(`return getComputedStyle(document.getElementById('tab-record')).display!=='none'`);
            S.ok(tabRec, `${who}:记录 tab 显示(极简默认也显示)`);
            S.ok(!p.errors.length, `${who}:0 console error`, p.errors);
            p.done(); await sleep(200);
        }
    }],
    ['顾问反馈:本机记了才调、没改不重调、出错能重试、建议一点加进记录', async ({ S, open }) => {
        const FB = { text: '鼻翼那块今晚先只保湿。', note_add: '鼻翼起皮', next_adjust: [{ item: '修护霜', change: '鼻翼多涂一层', why: '干皮' }], dropped: [] };
        const p = await open({ seed: 'full', mode: 'on', aif: `{feedback:${JSON.stringify(FB)}}`, login: true, hash: '#/record' });
        await tab(p, 'record', 300);
        S.ok(await log(p, '/api/feedback') === 0, '打开记录页:不调反馈');
        await typeNote(p, '今天还行');
        await click(p, '#rec-q-go', 200);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length===1`, 4000);
        await p.waitFor(`/鼻翼那块/.test((document.getElementById('rec-today')||{}).innerText||'')`, 3000);
        const body = await p.eval(`const b=(__AIF.log||[]).find(x=>x.p==='/api/feedback').body;return {note:b.session.note,date:b.session.date,ctx:!!b.context}`);
        S.ok(body.note === '今天还行' && body.ctx, '记下一句(没看出状态):要了一次反馈,session 带着这句话', body);
        const t = await p.eval(R + `return (q('#rec-today .fb')||{}).innerText||''`);
        S.ok(/顾问/.test(t) && /鼻翼多涂一层/.test(t), '反馈显示在「今天记下的」下面(含下一步调整)', t);
        // ❌4 「照这个调」:调整建议下面一键把「按打卡反馈调一下：…」预填进顾问对话(不自动发)
        S.ok(/照这个调/.test(await p.eval(R + `return (q('#rec-today [data-fb-act=adjust]')||{}).innerText||''`)), '❌4 next_adjust 列表下有「照这个调」按钮');
        await click(p, '#rec-today [data-fb-act=adjust]', 500);
        const adv = await p.eval(`return {hash:location.hash,draft:(document.getElementById('adv-text')||{}).value||'',sent:(__AIF.log||[]).filter(x=>x.p==='/api/chat').length}`);
        S.ok(adv.hash === '#/advisor' && /^按打卡反馈调一下：/.test(adv.draft) && /修护霜：鼻翼多涂一层/.test(adv.draft) && adv.sent === 0, '❌4 点了:切到顾问页,输入框预填「按打卡反馈调一下：修护霜：鼻翼多涂一层…」,没有自动发', adv);
        await tab(p, 'record', 300);
        await tab(p, 'tonight', 200); await tab(p, 'record', 300);
        S.ok(await log(p, '/api/feedback') === 1, '重画 / 切 tab:不重调');
        await click(p, '#rec-more', 300);
        await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`); await sleep(400);
        S.ok(await log(p, '/api/feedback') === 1, '打开 sheet 什么都没改就关:不重调(按记了什么去重)');
        await click(p, '#rec-today [data-fb-act=note]', 300);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok(/今天还行；鼻翼起皮/.test(en.note), '「把…加进今天的记录」:接在备注后面', en.note);
        await click(p, '#rec-more', 300);
        await click(p, '#sk-sym-干燥', 150);
        await p.eval(`window.__AIF.feedback=null;return 1`);   // 之后用假后端的默认回复「做得不错。」
        // 让下一次反馈回 502
        await p.eval(`const f=window.fetch;window.fetch=async(u,i)=>{if(String(u).endsWith('/api/feedback')&&window.__FBERR){(__AIF.log=__AIF.log||[]).push({p:'/api/feedback'});return new Response(JSON.stringify({error:'顾问这会儿忙'}),{status:502,headers:{'Content-Type':'application/json'}})}return f(u,i)};window.__FBERR=1;return 1`);
        await click(p, '#skin-sheet .sheet-actions .btn-primary', 300);
        await p.waitFor(`/再试一次/.test((document.getElementById('rec-today')||{}).innerText||'')`, 4000);
        S.ok(await log(p, '/api/feedback') === 2, '改了状态再关:调了(出错了)');
        await p.eval(`window.__FBERR=0;return 1`);
        await click(p, '#rec-today [data-fb-act=retry]', 300);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length===3`, 4000);
        await p.waitFor(`/做得不错/.test((document.getElementById('rec-today')||{}).innerText||'')`, 3000);
        S.ok(true, '「再试一次」:重调,结果换上');
        S.ok(!p.errors.length, '0 console error', p.errors.filter(x => !/502/.test(x)));
    }],
    ['记皮肤的 sheet 开着时点「把…加进今天的记录」:关 sheet 不把备注改回旧文;v1 的 noteSaved 也写上', async ({ S, open }) => {
        const FB = { text: '鼻翼那块今晚先只保湿。', note_add: '鼻翼起皮', next_adjust: [], dropped: [] };
        const p = await open({ seed: 'full', mode: 'on', aif: `{feedback:${JSON.stringify(FB)}}`, login: true, hash: '#/record' });
        await tab(p, 'record', 300);
        await typeNote(p, '今天还行');
        await click(p, '#rec-q-go', 200);
        await p.waitFor(`/鼻翼那块/.test((document.getElementById('rec-today')||{}).innerText||'')`, 4000);
        await click(p, '#rec-more', 400);
        await p.waitFor(`!!document.querySelector('#skin-sheet [data-fb-act=note]')`, 3000);
        await click(p, '#skin-sheet [data-fb-act=note]', 300);
        const mid = await p.eval(`return (document.getElementById('sk-note')||{}).value||''`);
        await click(p, '#skin-sheet .sheet-actions .btn-primary', 400);
        const r = await p.eval(`const d=${ENV};return {note:((d.sk_jrnl1||[]).find(e=>e.date===__d(0))||{}).note||'',saved:!!(((d.sk_ai1||{}).feedback||{})[__d(0)]||{}).noteSaved}`);
        S.ok(/今天还行；鼻翼起皮/.test(r.note) && /鼻翼起皮/.test(mid), '关 sheet 后备注里还有顾问那句(输入框也跟着换了)', { r, mid });
        S.ok(r.saved, 'sk_ai1.feedback[今天].noteSaved = true(v1 设备不再出按钮)', r);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['极简模式记录页从不催:不标「今天还没记」「没记」', async ({ S, open }) => {
        const p = await open({ seed: 'minimal', seedArg: `{profile:{showJournal:true}}` });
        await tab(p, 'record', 300);
        const t0 = await p.eval(`return (document.getElementById('rec-today')||{}).innerText||''`);
        await goPage(p, 'changes');
        const r = await p.eval(`return {aria:[...document.querySelectorAll('#rec-14 [aria-label]')].map(x=>x.getAttribute('aria-label'))}`);
        r.t = t0;
        S.ok(!/今天还没记/.test(r.t) && !r.aria.some(a => /没记/.test(a)), '极简:「今天记下的」写中性的一句,14 天格子不说「没记」', r);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['HRT 只在本人开了时显示;照片不分析时只存本机', async ({ S, open }) => {
        // 14 条有阶段的记录:最近 2 天、第 20 天起每隔一天各一条(共 14 条);❓1:列最近 12 条,不限 14 天
        const p = await open({ seed: 'full', seedArg: `{profile:{hrt:true},jrnl:[{date:__d(-2),status:['闭口'],products:[],note:'',phase:'剂量调整'}].concat(Array.from({length:13},(_,k)=>({date:__d(-20-k),status:[],products:[],note:'',phase:'第'+(k+1)+'次'})))}`, hash: '#/record/changes' });
        await sleep(400);
        const h = await p.eval(R + `return {on:!!q('#rec-hrt'),vis:q('#rec-hrt')&&getComputedStyle(q('#rec-hrt')).display!=='none',t:(q('#rec-hrt')||{}).innerText||'',n:qa('#rec-hrt li').length}`);
        S.ok(h.on && h.vis && /剂量调整/.test(h.t), '本人开了 HRT:变化页显示 HRT 阶段', h);
        S.ok(h.n === 12 && /第1次/.test(h.t) && /第11次/.test(h.t) && !/第12次|第13次/.test(h.t), '❓1 HRT:最近 12 条有阶段的记录,超过 14 天的也在,更早的第 13 条不出', h);
        await goPage(p, '');
        await click(p, '#rec-more', 300);
        S.ok(await p.eval(`return !!document.getElementById('sk-phase')`), '开了 HRT:记皮肤里能顺手写 HRT 阶段');
        await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`); await sleep(200);
        // 拍一张(不分析):存进本机 IndexedDB(未登录 = local__日期),「今天记下的」出缩略图
        await setFile(p, '#rec-file', path.join(ROOT, 'icon-192.png'));
        await p.waitFor(`!(document.getElementById('rec-thumb')||{hidden:true}).hidden`, 4000);
        const keys = await p.eval(`return await new Promise(r=>{const q=indexedDB.open('SkincarePhotos',1);q.onupgradeneeded=e=>e.target.result.createObjectStore('photos',{keyPath:'date'});q.onsuccess=e=>{const t=e.target.result.transaction('photos','readonly').objectStore('photos').getAllKeys();t.onsuccess=()=>r(t.result)};q.onerror=()=>r([])})`);
        const d0 = await p.eval(`return __d(0)`);
        S.ok(keys.includes('local__' + d0), '照片只存本机 IndexedDB(按账号前缀)', keys);
        const env = await p.eval(`return JSON.stringify(${ENV})`);
        S.ok(!/data:image/.test(env), '照片不进同步的记录', env.length);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['❌1 / ❓2 某一天的 sheet:那晚用了哪些活性(写 products、清 auto)+ 那晚做了 / 没做;今天那晚不出', async ({ S, open }) => {
        for (const who of ['full', 'minimal']) {
            // -3 天:按计划推定的(auto),带 Votary 以外的 PC酸;今晚页打过卡:做了两步、没做 Votary 那支
            const seedArg = `{jrnl:[{date:__d(-3),status:[],products:['PC酸'],auto:true,note:'（按当天计划推定）',phase:'',stepsDone:['温和洗面奶','去角质酸'],skipped:['Votary 10%乳酸']}]${who === 'minimal' ? ',profile:{showJournal:true}' : ''}}`;
            const p = await open({ seed: who, seedArg, hash: '#/record/history' });
            await sleep(400);
            const d3 = await p.eval(`return __d(-3)`);
            await click(p, `#rec-hist [data-date="${d3}"]`, 400);
            const a = await p.eval(R + `return {night:(q('#sk-night')||{}).innerText||'',chips:qa('#skin-sheet [data-sk=prod]').map(x=>x.dataset.t),on:qa('#skin-sheet [data-sk=prod][aria-pressed=true]').map(x=>x.dataset.t),
                grp:!!q('#skin-sheet .sk-used [role=group]'),minH:Math.min(...qa('#skin-sheet [data-sk=prod]').map(x=>x.getBoundingClientRect().height))}`);
            S.ok(/^那晚：做了 温和洗面奶、去角质酸；没做 Votary 10%乳酸$/.test(a.night), `${who} ❓2 顶上一行只读「那晚：做了 …；没做 …」`, a.night);
            S.ok(a.chips.includes('PC酸') && a.chips.includes('Votary酸') && a.chips.includes('泥面膜') && a.grp, `${who} ❌1 一排活性 chip(货架上 acid / retinol / mask 的 journalTag)`, a.chips);
            S.ok(a.on.join() === 'PC酸' && a.minH >= 44, `${who} 已记的那支是「按下」状态,chip ≥44px`, a);
            // 点 Votary酸:加上;清 auto;从 skipped 里拿掉(她说用了)
            await click(p, '#skin-sheet [data-sk=prod][data-t="Votary酸"]', 250);
            const e1 = await p.eval(`return (${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(-3))`);
            S.ok(e1.products.includes('Votary酸') && e1.products.includes('PC酸') && !e1.auto && !(e1.skipped || []).includes('Votary酸'), `${who} ❌1 点一下:写进 products,auto 清掉`, e1);
            S.ok(!e1.note, `${who} ❌1 auto 的占位备注一并清掉(不然被数成「记了皮肤」)`, e1.note);
            S.ok(await p.eval(`return document.querySelector('#skin-sheet [data-sk=prod][data-t="Votary酸"]').getAttribute('aria-pressed')==='true'`), `${who} chip 立刻显示按下`);
            // 再点一下:删掉;极简模式记进 skipped(不然下次又被按计划推定回来)
            await click(p, '#skin-sheet [data-sk=prod][data-t="Votary酸"]', 250);
            const e2 = await p.eval(`return (${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(-3))`);
            S.ok(!e2.products.includes('Votary酸') && e2.products.includes('PC酸'), `${who} ❌1 再点一下:从 products 拿掉,别的不动`, e2);
            S.ok(who === 'minimal' ? (e2.skipped || []).includes('Votary酸') : true, `${who} 极简:拿掉的记进 skipped`, e2.skipped);
            await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`); await sleep(200);
            // 没有打过卡的一天:没有「那晚」一行;今天:chip 和那一行都不出
            await goPage(p, 'history');
            await click(p, '#rec-hist [data-act=day-pick]', 300);
            const d5 = await p.eval(`return __d(-5)`);
            await click(p, `#day-pick [data-d="${d5}"]`, 400);
            const b = await p.eval(R + `return {night:!!q('#sk-night'),chips:qa('#skin-sheet [data-sk=prod]').length}`);
            S.ok(!b.night && b.chips >= 3, `${who} 没打过卡的一天:不出「那晚」一行,chip 照给(补记用)`, b);
            await click(p, '#skin-sheet [data-sk=prod][data-t="泥面膜"]', 250);
            const e5 = await p.eval(`return (${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(-5))`);
            S.ok(e5 && e5.products.includes('泥面膜'), `${who} ❌1 没有记录的一天也能补记(新建那天)`, e5);
            await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`); await sleep(200);
            await goPage(p, '');
            await click(p, '#rec-more', 300);
            const c = await p.eval(R + `return {night:!!q('#sk-night'),chips:qa('#skin-sheet [data-sk=prod]').length}`);
            S.ok(!c.night && c.chips === 0, `${who} 今天那晚:不出 chip(今晚页打勾负责)也不出「那晚」一行`, c);
            S.ok(!p.errors.length, `${who} 0 console error`, p.errors);
            p.done(); await sleep(200);
        }
    }],
    ['❌3 照片看大图:今天 / 拍照分析 / 某一天的缩略图都是按钮,点开全宽大图,正 / 左 / 右能切', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{jrnl:[{date:__d(-3),status:['闭口'],products:[],note:'',phase:''}]}`, hash: '#/record' });
        await tab(p, 'record', 300);
        // 写进本机照片库:今天只存一张(旧版 key,无视角),-3 天正 / 左 / 右三张(三种颜色,看得出切了)
        await p.eval(`const mk=c=>{const k=document.createElement('canvas');k.width=40;k.height=50;const g=k.getContext('2d');g.fillStyle=c;g.fillRect(0,0,40,50);return k.toDataURL('image/png')};
            await new Promise(r=>{const q=indexedDB.open('SkincarePhotos',1);q.onupgradeneeded=e=>e.target.result.createObjectStore('photos',{keyPath:'date'});q.onsuccess=e=>{const tx=e.target.result.transaction('photos','readwrite'),st=tx.objectStore('photos');
                st.put({date:'local__'+__d(0),dataUrl:mk('#444')});st.put({date:'local__'+__d(-3)+'__front',dataUrl:mk('#c33')});st.put({date:'local__'+__d(-3)+'__left',dataUrl:mk('#3c3')});st.put({date:'local__'+__d(-3)+'__right',dataUrl:mk('#33c')});tx.oncomplete=()=>r(1)}});return 1`);
        await tab(p, 'tonight', 200); await tab(p, 'record', 400);
        const a = await p.eval(R + `const b=q('#rec-today button.thumb-b');return {has:!!b,vis:!!b&&!b.hidden&&b.getBoundingClientRect().height>=44&&b.getBoundingClientRect().width>=44,label:b&&b.getAttribute('aria-label'),tag:b&&b.tagName}`);
        S.ok(a.has && a.vis && a.tag === 'BUTTON' && /看大图/.test(a.label || ''), '❌3 今天的缩略图是 button,有 aria-label,≥44px', a);
        await click(p, '#rec-today button.thumb-b', 400);
        const v = await p.eval(R + `const ov=q('#photo-view'),im=ov&&ov.querySelector('img.photo-full'),sb=ov&&ov.querySelector('.sheet-b');return {open:!!ov,src:im&&im.src.slice(0,14),w:im&&Math.round(im.getBoundingClientRect().width),bw:sb&&Math.round(sb.getBoundingClientRect().width),seg:ov&&ov.querySelectorAll('.ph-seg button').length}`);
        S.ok(v.open && v.src === 'data:image/png' && v.w >= v.bw * 0.8 && v.seg === 0, '❌3 点开:sheet 里一张全宽 img;只有一张就没有切换', v);
        await p.eval(`document.querySelector('#photo-view .sheet-x').click();return 1`); await sleep(150);
        // 某一天(三个视角):历史页点开 → sheet 里的缩略图 → 大图 → 切左脸 / 右脸
        await goPage(p, 'history');
        const d3 = await p.eval(`return __d(-3)`);
        await click(p, `#rec-hist [data-date="${d3}"]`, 500);
        const t = await p.eval(R + `const b=q('#skin-sheet button.thumb-b');return {vis:!!b&&!b.hidden&&b.getBoundingClientRect().height>=44,label:b&&b.getAttribute('aria-label')}`);
        S.ok(t.vis && /看大图/.test(t.label || ''), '❌3 某一天的 sheet:缩略图是按钮(≥44px)', t);
        await click(p, '#skin-sheet button.thumb-b', 500);
        const colorOf = () => p.eval(`const im=document.querySelector('#photo-view img.photo-full');const k=document.createElement('canvas');k.width=1;k.height=1;const g=k.getContext('2d');g.drawImage(im,0,0,1,1);return [...g.getImageData(0,0,1,1).data].slice(0,3).join()`);
        const segs = await p.eval(R + `return qa('#photo-view .ph-seg button').map(x=>({t:x.textContent,h:Math.round(x.getBoundingClientRect().height),on:x.getAttribute('aria-pressed')}))`);
        S.ok(segs.length === 3 && segs.map(x => x.t).join() === '正脸,左脸,右脸' && segs.every(x => x.h >= 44) && segs[0].on === 'true', '❌3 三张:正 / 左 / 右切换按钮,≥44px,默认正脸', segs);
        const c0 = await colorOf();
        await click(p, '#ph-v-left', 250); const c1 = await colorOf();
        await click(p, '#ph-v-right', 250); const c2 = await colorOf();
        S.ok(c0 === '204,51,51' && c1 === '51,204,51' && c2 === '51,51,204', '❌3 切到左脸 / 右脸:图跟着换', [c0, c1, c2]);
        S.ok(/右脸/.test(await p.eval(`return document.querySelector('#photo-view img.photo-full').alt`)), '大图的 alt 跟着视角');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['美学探针:记录页(首页 / 变化 / 历史)浅 / 深,完整 / 极简', async ({ S, open }) => {
        for (const scheme of ['light', 'dark']) for (const who of ['full', 'minimal']) {
          for (const page of ['', 'changes', 'history']) {
            const p = await open({ seed: who, seedArg: who === 'full' ? JR : '', scheme, hash: '#/record' + (page ? '/' + page : '') });
            await tab(p, 'record', 300); await goPage(p, page);
            const r = await p.eval(PROBE + `;return __probe('#record')`);
            const tag = `${who}/${scheme}/${page || '首页'}`;
            S.ok(!r.emoji.length && r.minFs >= 12 && r.pctLt14 <= 20, `${tag}:0 emoji、字号(<14px ≤20%)`, { e: r.emoji, min: r.minFs, pct: r.pctLt14 });
            S.ok(!r.lowCr.length, `${tag}:对比度 ≥4.5`, r.lowCr);
            S.ok(!r.smallN, `${tag}:可点的都 ≥44×44`, r.small);
            S.ok(r.red === 0 && !r.styleAttrs.length, `${tag}:没有红、模板里没有 style=(热度条除外)`, { red: r.red, st: r.styleAttrs });
            S.ok(r.sizes.every(x => [12, 14, 16, 18, 22, 28].includes(x)), `${tag}:字号只用 6 档`, r.sizes);
            if (scheme === 'dark') S.ok(!r.brightN, `${tag}:没有比 --ink-strong 更亮的像素`, r.bright);
            const w = await p.eval(`return document.documentElement.scrollWidth<=document.documentElement.clientWidth`);
            S.ok(w, `${tag}:390 宽不横向滚动`);
            S.ok(!p.errors.length, `${tag}:0 console error`, p.errors);
            p.done(); await sleep(150);
          }
        }
    }]
]);
