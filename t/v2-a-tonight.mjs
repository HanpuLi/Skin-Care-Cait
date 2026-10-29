// A 路 · 今晚页(无头 Chrome,假顾问后端,不花钱):
//   四层(夜型标题 + 一句为什么、问句开关 + 用真实排班差异说影响、最多一张提醒卡 +「还有 N 条」、步骤每步一句为什么)
//   完整模式:点步骤打卡、「完成今晚」→ 记皮肤 sheet(状态 / 脸部地图)→ 写进当天记录、撤回只退这次加的
//   极简模式:不打卡,只有活性步骤的「今晚没做」(写 skipped)、不问洗澡刮胡、「记一下皮肤」
//   就医红线卡(任何模式)、亮时不排酸、眼霜照用、「已约了 / 看过了」;安全提示任何模式都在
//   顾问写今晚:新的一天自动调一次、按天 + 签名缓存、重画不重调、本机开关才重调(防抖)、过安全闸(刮胡夜拦酸、不在库的丢掉)、
//   同步来的改动不调(只标「情况变了」+「让顾问重排」)、没开通 / 连不上 / 没登录 → 「离线排法」;顾问的今晚小改 + 撤销 / 重做
//   跑:node t/v2-a-tonight.mjs
import { run, tab, click, log, sleep, W8, ENV, TODAY_EN, TONIGHT_FULL, PROBE } from './v2-a-lib.mjs';

const ACID = "Paula's Choice 6%杏仁酸+2%乳酸", EYE = 'MZ Skin Soothe & Smooth 眼部精华';
const VIEW = `const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
    const v={h1:(q('#tonight-h')||{}).textContent||'',lead:(q('#tn-lead')||{}).textContent||'',src:(q('#tn-src')||{}).textContent||'',
      head:(q('#tn-steps-h')||{}).textContent||'',prog:(q('#tn-progress')||{}).textContent||'',
      steps:qa('#tn-plan .step-name').map(x=>x.textContent),whys:qa('#tn-plan .step').map(x=>{const w=x.querySelector('.step-why');return w?w.textContent:''}),
      boxes:qa('#tn-plan [role=checkbox]').length,miss:qa('#tn-plan [data-miss]').map(x=>x.dataset.miss),
      sit:!!q('#tn-sit'),fxShave:(q('#tn-fx-shave')||{}).textContent||'',fxShower:(q('#tn-fx-shower')||{}).textContent||'',
      cards:qa('#tn-cards > .note-medical, #tn-cards > .note-caution, #tn-cards > .note-info').map(x=>x.className),
      more:(q('#tn-more-b')||{}).textContent||'',moreItems:qa('#tn-more li').map(x=>x.textContent),
      allText:(q('#tonight')||{}).innerText||'',safety:qa('#tonight [data-safety]').map(x=>x.textContent),
      med:!!q('#tn-med'),medBtns:qa('#tn-med button').map(x=>x.textContent+':'+x.getAttribute('aria-pressed')),
      rev:(q('#tn-rev')||{}).textContent||'',skips:qa('#tn-skips li').map(x=>x.textContent)};`;
const view = p => p.eval(VIEW + 'return v');

await run('v2-a-tonight', [
    ['完整模式 · 离线(没登录)', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{products:i=>[]}` });
        const v = await view(p);
        S.ok(/^今晚 · (刷酸夜|修护夜|面膜夜|维 A 夜)$/.test(v.h1) && v.lead.length > 4, '① 标题「今晚 · 夜型」+ 一句为什么', { h1: v.h1, lead: v.lead });
        S.ok(v.sit && /洗澡|洗手池/.test(v.fxShower) && v.fxShave, '② 今晚的情况:问句开关,下面一行说影响', v);
        S.ok(/没登录，用的是离线排法/.test(v.src) && /离线排法/.test(v.head), '没登录:步骤标明「离线排法」', { src: v.src, head: v.head });
        S.ok(v.steps.length >= 3 && v.whys.every(w => w.length > 3), '④ 每一步都有一句为什么', v.whys);
        S.ok(v.boxes === v.steps.length && !v.miss.length, '完整模式:整行是 checkbox,没有「今晚没做」', v);
        S.ok(v.cards.length <= 1, '③ 提醒卡最多一张', v.cards);
        // 刮胡:用真实排班差异说影响
        const acid0 = v.steps.includes(ACID);
        await click(p, '#tn-shave-y', 300);
        const v2 = await view(p);
        S.ok(v2.h1 === '今晚 · 刮胡夜' && !v2.steps.includes(ACID) && v2.steps.some(x => /凉水冲洗/.test(x)), '点「刮」:今晚变刮胡夜,酸不上,先凉水冲', v2.steps);
        S.ok(/^刮胡夜：/.test(v2.fxShave) && (!acid0 || /酸今晚不上/.test(v2.fxShave)), '点了以后说出真实影响(酸今晚不上 / 下次刷酸在哪天)', v2.fxShave);
        const tn = await p.eval(`return ${ENV}.sk_tn1`);
        S.ok(tn && tn.shave === true, '开关写进今晚(sk_tn1),排班跟着改', tn);
        await click(p, '#tn-shave-n', 300);
        // 打卡
        await click(p, '#tn-step-0', 200);
        const t1 = await p.eval(`return {aria:document.getElementById('tn-step-0').getAttribute('aria-checked'),prog:document.getElementById('tn-progress').textContent,en:${TODAY_EN},tn:${ENV}.sk_tnsteps1}`);
        S.ok(t1.aria === 'true' && /^1 \//.test(t1.prog) && (t1.en.stepsDone || []).length === 1 && t1.tn.done.length === 1, '点一步 = 做了(sk_tnsteps1 + 当天 stepsDone)', t1);
        // 完成今晚 → 记皮肤 sheet
        await click(p, '#tn-finish-b', 300);
        const sh = await p.eval(`const ov=document.getElementById('skin-sheet');return {open:!!ov,t:ov&&ov.querySelector('.sheet-t').textContent,lead:(ov&&ov.querySelector('.sk-lead')||{}).textContent||'',en:${TODAY_EN}}`);
        S.ok(sh.open && sh.t === '今晚做完了' && /没做/.test(sh.lead), '「完成今晚」→ 记皮肤的 sheet(做了几步、没做哪些)', sh);
        S.ok(sh.en.done === true && !!sh.en.doneAt && (sh.en.skipped || []).length >= 1 && (sh.en.doneSkipped || []).length === sh.en.skipped.length, '当天记录:done + 没点的记成没做(skipped)', sh.en);
        await click(p, '#sk-tr-same'); await click(p, '#sk-sym-闭口');
        const fmOpen = await p.eval(`return document.getElementById('sk-fm-t').getAttribute('aria-expanded')`);
        if (fmOpen !== 'true') await click(p, '#sk-fm-t');
        await click(p, '#sk-fz-chin'); await click(p, '#sk-sp-1');
        await p.eval(`document.getElementById('sk-note').value='测试备注';return 1`);
        await click(p, '#skin-sheet .sheet-actions .btn-primary', 300);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok(en.status.includes('稳定') && en.status.includes('闭口') && JSON.stringify(en.spots) === JSON.stringify([{ zone: '下巴', type: '红痘' }]) && en.note === '测试备注', '记皮肤:状态标签 + 脸部地图(只到区域)+ 备注写进当天', en);
        const done = await p.eval(`return {t:(document.getElementById('tn-finish')||{}).innerText||''}`);
        S.ok(/做完了/.test(done.t), '完成后今晚页显示「做完了」', done);
        await click(p, '#tn-finish [data-act=unfinish]', 200);
        const en2 = await p.eval(`return ${TODAY_EN}`);
        S.ok(!en2.done && !en2.doneSkipped && !(en2.skipped || []).length, '撤回:只退这次「完成」加的(done / 没做)', en2);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['极简模式 · 不打卡、只有活性「今晚没做」、记一下皮肤', async ({ S, open }) => {
        const p = await open({ seed: 'minimal' });
        const v = await view(p);
        S.ok(!v.boxes && !v.sit, '极简:步骤不可勾、不问洗澡刮胡', v);
        S.ok(/默认都算做了/.test(v.allText) && /默认全做/.test(v.prog), '写明「排上的默认都算做了」', v.prog);
        const kinds = await p.eval(`return [...document.querySelectorAll('#tn-plan .step')].map(x=>x.dataset.kind+':'+(!!x.querySelector('[data-miss]')))`);
        S.ok(kinds.every(k => /^(acid|mask|retinol):true$/.test(k) || /^base:false$/.test(k)), '「今晚没做」只在活性步骤上', kinds);
        if (v.miss.length) {
            const nm = v.miss[0];
            await click(p, '#tn-plan [data-miss]', 200);
            const r = await p.eval(`return {en:${TODAY_EN},b:document.querySelector('#tn-plan [data-miss]').textContent}`);
            S.ok((r.en.skipped || []).includes(nm) && r.b === '撤回', '点「今晚没做」:写进当天 skipped(第二天不会被推定成用了)', r);
            await click(p, '#tn-plan [data-miss]', 200);
            S.ok(!((await p.eval(`return ${TODAY_EN}`)).skipped || []).length, '再点「撤回」:skipped 清掉');
        } else S.ok(true, '(这颗种子今晚没排活性:没有「今晚没做」按钮)');
        await click(p, '#tn-logskin', 300);
        const sh = await p.eval(`const ov=document.getElementById('skin-sheet');return {t:ov&&ov.querySelector('.sheet-t').textContent,lead:(ov.querySelector('.sk-lead')||{}).textContent,fm:document.getElementById('sk-fm-t').getAttribute('aria-expanded'),fb:!!ov.querySelector('[data-fb-date]')}`);
        S.ok(sh.t === '记一下皮肤' && /不记也没关系/.test(sh.lead) && sh.fm === 'false', '「记一下皮肤」:不催,脸部地图默认收起', sh);
        S.ok(!sh.fb, '没登录:不出顾问反馈区', sh);
        await p.eval(`document.querySelector('#skin-sheet .sheet-x').click();return 1`);
        S.ok(await p.eval(`return !document.getElementById('tab-record').hidden && getComputedStyle(document.getElementById('tab-record')).display!=='none'`), '极简:记录 tab 默认显示');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['就医红线:任何模式都有卡,亮时不排酸,眼霜照用', async ({ S, open }) => {
        for (const who of ['full', 'minimal']) {
            const p = await open({ seed: who, seedArg: `{status:i=>i>=-6?['泛红']:[]}` });
            const v = await view(p);
            S.ok(v.med && v.cards[0] === 'note-medical' && v.medBtns.length === 3, `${who}:就医卡在最上面,三个按钮(已约了 / 看过了 / 先不)`, v);
            S.ok(!v.steps.includes(ACID) && v.steps.includes(EYE) && /就医/.test(v.lead), `${who}:不排酸、眼霜照用、为什么写明`, v);
            const red = await p.eval(PROBE + `;return __probe('#tonight').red + (document.querySelector('#tab-tonight')?1:0)`);
            S.ok(red <= 3, `${who}:红色只在就医卡(+ tab 点)`, red);
            if (who === 'full') {
                await click(p, '#tn-med [data-med=booked]', 250);
                const b = await view(p);
                S.ok(b.medBtns.includes('已约了:true') && /已约了/.test(b.allText), '点「已约了」:按钮按下、文字换成「看过之后点看过了」', b.medBtns);
                await click(p, '#tn-med [data-med=seen]', 300);
                const c = await view(p);
                S.ok(!c.med, '点「看过了」:红线解除(从今天起重新计数)', c.cards);
            }
            S.ok(!p.errors.length, `${who}:0 console error`, p.errors);
            p.done(); await sleep(200);
        }
    }],
    ['安全提示(没有保湿)任何模式都在', async ({ S, open }) => {
        for (const who of ['minimal', 'full']) {
            const p = await open({ seed: who, seedArg: `{nomoist:true}`, after: who === 'full' ? `localStorage.setItem('sk_gone1',JSON.stringify(['avene','toleriane','tolerianeSens']))` : '' });
            const v = await view(p);
            S.ok(v.safety.some(t => /保湿这一档是空的/.test(t)), `${who}:「洗完全脸没有能涂的」安全提示在页面上(卡或「还有 N 条」里)`, v.safety);
            p.done(); await sleep(200);
        }
    }],
    ['顾问写今晚:新的一天调一次、过闸、缓存、本机开关才重调', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{products:i=>[]}`, mode: 'on', aif: `{tonight:${JSON.stringify(TONIGHT_FULL)}}`, login: true });
        await tab(p, 'record', 100); await tab(p, 'tonight', 100);
        await p.waitFor(`/顾问/.test((document.getElementById('tn-steps-h')||{}).textContent||'')`, 6000);
        const v = await view(p);
        const n1 = await log(p, '/api/tonight');
        S.ok(n1 === 1, '新的一天:顾问写今晚调了一次', n1);
        S.ok(v.steps[0] === '温水把脸打湿' && v.steps.includes('Lacura 温和洗面奶') && v.steps.includes(EYE) && !v.steps.includes('不在货架上的神仙水'), '步骤是顾问写的(纯动作也在),不在货架上的丢掉', v.steps);
        S.ok(v.whys.includes('眼周不碰酸，眼霜照常。') && v.lead === TONIGHT_FULL.why, '每步的为什么、标题下那句是顾问写的', { whys: v.whys, lead: v.lead });
        S.ok(!v.src && /顾问 \d\d:\d\d 排的/.test(v.head), '顾问版:不标离线', { src: v.src, head: v.head });
        S.ok(v.allText.includes('不在货架上') , '顾问提到的产品不在货架上:说一声(提醒或「还有 N 条」)', v.moreItems.concat(v.cards));
        const body = await p.eval(`const b=(__AIF.log||[]).find(x=>x.p==='/api/tonight').body;return {acid:!!(b.context&&b.context.acid),week:(b.context.week||[]).length,steps:(b.context.tonight||{}).steps.length}`);
        S.ok(body.acid && body.week === 7 && body.steps >= 3, 'context 带了本周刷酸、未来 7 晚、离线今晚', body);
        const c = await p.eval(`return JSON.parse(localStorage.getItem('sk_ai_tonight1'))`);
        S.ok(c && c.uid === 'u-test' && c.date === (await p.eval('return __d(0)')) && c.sig && c.data, '缓存在本机 sk_ai_tonight1(按账号 + 天 + 签名)', c && { uid: c.uid, date: c.date, sig: c.sig });
        await tab(p, 'record', 100); await tab(p, 'tonight', 300);
        S.ok(await log(p, '/api/tonight') === 1, '重画 / 切 tab:不重调');
        // 本机开关:刮胡 → 先离线、防抖后重调;顾问还是排了酸 → 闸拦下
        await click(p, '#tn-shave-y', 200);
        const v2 = await view(p);
        S.ok(/离线排法/.test(v2.head) && /情况变了|顾问在排/.test(v2.src), '点了刮胡:先用离线排法,标明情况变了', v2.src);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/tonight').length===2`, 5000);
        await p.waitFor(`/顾问/.test((document.getElementById('tn-steps-h')||{}).textContent||'')`, 4000);
        const v3 = await view(p);
        S.ok(!v3.steps.includes(ACID) && v3.skips.some(x => x.includes(ACID) && /刮胡夜不上酸/.test(x)), '顾问版过闸:刮胡夜的酸挪进「今晚不用」并写明原因', v3.skips);
        S.ok(v3.allText.includes('顾问排了「' + ACID + '」，没上：刮胡夜不上酸'), '被闸拦下的写在提醒里', v3.cards.concat(v3.moreItems));
        S.ok(v3.h1 === '今晚 · 刮胡夜', '夜型按过闸后的步骤算', v3.h1);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['同步来的改动不调顾问,只标过时 +「让顾问重排」;今晚小改 + 撤销 / 重做', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: `{products:i=>[]}`, mode: 'on', aif: `{tonight:${JSON.stringify(TONIGHT_FULL)}}`, login: true });
        await tab(p, 'record', 100); await tab(p, 'tonight', 100);
        await p.waitFor(`/顾问/.test((document.getElementById('tn-steps-h')||{}).textContent||'')`, 6000);
        // 云端第一次快照 = 本机这一份(落地、不冲突)
        await p.eval(`fakeCloud.emit(${ENV});${W8(200)}return 1`);
        const base = await log(p, '/api/tonight');
        // 另一台设备把一支产品标成用完了(货架签名变了)→ 同步落地
        await p.eval(`const d=${ENV};d.sk_gone1=(d.sk_gone1||[]).concat(['cicaplast']);d._updatedAt=Date.now()+5000;fakeCloud.emit(d);${W8(2500)}return 1`);
        const v = await view(p);
        S.ok(await log(p, '/api/tonight') === base, '同步来的货架变化:不调顾问', { base });
        S.ok(/情况变了/.test(v.src) && /让顾问重排/.test(v.src), '只标「情况变了,先用离线排法」+「让顾问重排」', v.src);
        await click(p, '#tn-src [data-act=ask]', 200);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/tonight').length===${base + 1}`, 4000);
        S.ok(true, '点「让顾问重排」:调一次');
        await p.waitFor(`/顾问/.test((document.getElementById('tn-steps-h')||{}).textContent||'')`, 4000);
        // 另一台设备上顾问改了今晚(跳过眼霜)→ 同步过来:修订线 + 步骤里没了
        await p.eval(`const d=${ENV};d.sk_tnai1={date:__d(0),id:'t-sync',at:new Date().toISOString(),ops:[{op:'skip',product:${JSON.stringify(EYE)},to:'',level:'',why:'测试'}],undo:{prev:null}};d._updatedAt=Date.now()+9000;fakeCloud.emit(d);${W8(300)}return 1`);
        const r1 = await view(p);
        S.ok(/顾问.*改了今晚/.test(r1.rev) && /今晚跳过「MZ Skin/.test(r1.rev) && /撤销/.test(r1.rev), '「顾问改了今晚 · 撤销」单独一行', r1.rev);
        S.ok(!r1.steps.includes(EYE) && r1.skips.some(x => /顾问：今晚先跳过/.test(x)), '小改叠在顾问版上(眼霜挪进今晚不用)', r1.skips);
        const calls = await log(p, '/api/tonight');
        await click(p, '#tn-rev [data-act=undo]', 300);
        const r2 = await view(p);
        S.ok(/已撤销/.test(r2.rev) && r2.steps.includes(EYE) && (await p.eval(`return ${ENV}.sk_tnai1`)) === null, '撤销:眼霜回来,sk_tnai1 清掉(顾问页读同一份,联动)', r2.rev);
        await click(p, '#tn-rev [data-act=redo]', 300);
        const r3 = await view(p);
        S.ok(/今晚跳过/.test(r3.rev) && !r3.steps.includes(EYE), '重做:再改回去', r3.rev);
        S.ok(await log(p, '/api/tonight') === calls, '撤销 / 重做不重调顾问');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['顾问用不了:没开通 / 连不上 / 额度用完 → 离线排法', async ({ S, open }) => {
        for (const [mode, re] of [['none', /顾问没开通/], ['down', /顾问连不上/], ['quota', /用完了/]]) {
            const p = await open({ seed: 'full', mode, login: true });
            await tab(p, 'record', 100); await tab(p, 'tonight', 900);
            const v = await view(p);
            S.ok(re.test(v.src) && /离线排法/.test(v.src) && v.steps.length >= 3, `${mode}:今晚照常(离线排法),说清楚为什么`, v.src);
            S.ok(!p.errors.length, `${mode}:0 console error`, p.errors);
            p.done(); await sleep(200);
        }
    }],
    ['极简模式 + 顾问:排班外的活性不上(第二天的推定按排班记)', async ({ S, open }) => {
        const extra = Object.assign({}, TONIGHT_FULL, { steps: TONIGHT_FULL.steps.concat([{ product: 'Votary 10%乳酸', how: '薄涂', why: '测试:排班外' }]) });
        const p = await open({ seed: 'minimal', mode: 'on', aif: `{tonight:${JSON.stringify(extra)}}`, login: true });
        await tab(p, 'record', 100); await tab(p, 'tonight', 100);
        await p.waitFor(`(__AIF.log||[]).some(x=>x.p==='/api/tonight')`, 6000); await sleep(400);
        const r = await p.eval(VIEW + `const pd=${ENV}.sk_planday1;return {v,pd:(pd&&pd.items||[]).map(i=>i.name)}`);
        const acts = r.v.steps.filter(n => /酸/.test(n));
        S.ok(acts.every(n => r.pd.includes(n)), '顾问版里只留排班(sk_planday1)里有的活性', { acts, planday: r.pd });
        S.ok(r.v.boxes === 0, '极简 + 顾问版:照样不打卡', r.v.boxes);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['美学探针:浅 / 深,完整 / 极简', async ({ S, open }) => {
        for (const scheme of ['light', 'dark']) for (const who of ['full', 'minimal']) {
            const p = await open({ seed: who, scheme });
            const r = await p.eval(PROBE + `;return __probe('#tonight')`);
            const tag = `${who}/${scheme}`;
            S.ok(!r.emoji.length && r.minFs >= 12 && r.pctLt14 <= 15, `${tag}:0 emoji、字号(<14px ≤15%)`, { e: r.emoji, min: r.minFs, pct: r.pctLt14 });
            S.ok(!r.lowCr.length, `${tag}:对比度 ≥4.5`, r.lowCr);
            S.ok(!r.smallN, `${tag}:可点的都 ≥44×44`, r.small);
            S.ok(r.red <= 1 && !r.styleAttrs.length, `${tag}:没有红(就医卡之外)、模板里没有 style=`, { red: r.red, st: r.styleAttrs });
            S.ok(r.sizes.every(x => [12, 14, 16, 18, 22, 28].includes(x)), `${tag}:字号只用 6 档`, r.sizes);
            if (scheme === 'dark') S.ok(!r.brightN, `${tag}:没有比 --ink-strong 更亮的像素`, r.bright);
            S.ok(!p.errors.length, `${tag}:0 console error`, p.errors);
            p.done(); await sleep(150);
        }
    }]
]);
