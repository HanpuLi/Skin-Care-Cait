// B 路 · 产品页(无头 Chrome,假顾问后端,不花钱):
//   货架按角色排、状态点(只用 ok / caution / 空心)、开封几周、保质期;猛酸「先不排」、被安全闸拦着的写明为什么;
//   用完了 / 买回来了 / 快用完了走 ai/apply.js 的 local* 入口(空瓶记录、方案重出一版、触发「要不要买」);不要了 / 恢复;
//   添加:先选「这是什么」(不默认成保湿)/ 拍成分表 → /api/vision read_label → 摆出来让她确认 → 入库 → 能撤销;
//   要不要买新的:第一次打开不调、点了才判断、按紧急程度分组、链接只认 https、这些不用买;本机操作后防抖判断一次、签名没变不重调、
//   同步来的只标「可能过时」;出错 / 没开通退回离线清单;结果按账号存本机(sk_ai_shop1,不进云)。
//   跑:node t/v2-b-products.mjs [块名关键词]
import { run, tab, click, log, sleep, DATA, ENV, text, has, design, setFile, tinyPng } from './v2-b-lib.mjs';

const rows = p => p.eval(`return [...document.querySelectorAll('#pr-shelf .prod')].map(b=>({id:b.dataset.id,role:b.querySelector('.prod-role').textContent,name:b.querySelector('.prod-name').textContent,
    dot:(b.querySelector('.dot').className.split(' ')[1]||''),state:b.querySelector('.prod-state').textContent,meta:b.querySelector('.meta').textContent}))`);
const row = async (p, id) => (await rows(p)).find(r => r.id === id) || null;
const sheetBtn = (p, id, label) => p.eval(`const b=[...document.querySelectorAll('#${id} button')].find(x=>x.textContent===${JSON.stringify(label)});if(!b)return false;b.click();return true`);
const shopView = p => p.eval(`const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];return {st:(q('#pr-shop-st')||{}).textContent||'',redo:(q('#pr-shop-redo')||{}).textContent||'',
    off:!!q('#pr-shop-off'),groups:qa('#pr-shop-list .shop-g').map(g=>g.dataset.urg+':'+g.querySelectorAll('.shop-it').length),links:qa('#pr-shop-list .picks a').map(a=>a.getAttribute('href')),
    skip:(q('#pr-shop-skip')||{}).innerText||'',sum:(q('.pr-shop-sum')||{}).textContent||'',meta:(q('#pr-shop-meta')||{}).textContent||''}`);

await run('v2-b-products', [
    ['货架 · 状态点 / 开封 / 保质期 / 猛酸', async ({ S, open }) => {
        const p = await open({ seed: 'full', after: `localStorage.setItem('sk_popen1',JSON.stringify({votary:__d(-7*30),lacura:__d(-7*9)}));localStorage.setItem('sk_low1',JSON.stringify(['sunscreen']))` });
        await tab(p, 'products', 300);
        const r = await rows(p);
        S.ok(r.length >= 10 && r.every(x => x.role && x.name && x.state), '货架一行一件:角色、名字、状态', r.length);
        const order = ['卸妆', '洁面', '刷酸', '面膜', '磨砂', '精华', '眼部', '保湿', '修护', '防晒'];
        const idx = r.map(x => order.indexOf(x.role === '磨砂' ? '面膜' : x.role)).filter(i => i >= 0);
        S.ok(idx.every((v, i, a) => i === 0 || v >= a[i - 1]), '按在流程里的位置排(卸妆 → 洁面 → 酸 … → 防晒)', r.map(x => x.role));
        const gg = await row(p, 'goodGenes');
        S.ok(gg && gg.dot === 'hollow' && /先不排 · 猛酸/.test(gg.state), '猛酸:空心点「先不排 · 猛酸，皮肤连续稳 4 周后再评估」', gg);
        const vt = await row(p, 'votary');
        S.ok(vt && vt.dot === 'caution' && vt.state === '过了保质期' && /开封 30 周/.test(vt.meta), '保质期过了:caution 点 + 开封几周', vt);
        const sun = await row(p, 'sunscreen');
        S.ok(sun && sun.dot === 'caution' && sun.state === '快用完', '标了快用完:caution 点「快用完」', sun);
        const lc = await row(p, 'lacura');
        S.ok(lc && /开封 9 周/.test(lc.meta) && lc.dot === 'ok', '在用的:ok 点 + 开封几周', lc);
        S.ok(r.every(x => ['ok', 'caution', 'hollow'].indexOf(x.dot) >= 0), '状态点只用 ok / caution / 空心(不用红)', r.map(x => x.dot));
        const sv = await shopView(p);
        S.ok(sv.off && !sv.redo && /离线判断/.test(sv.st), '没登录:要不要买 = 离线清单(engine/needs),没有「让顾问判断」', sv);
        const pr = await design(p, '#products');
        S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.smallN && !pr.styleAttrs.length && pr.red === 0, '纸墨:0 emoji、字号、对比度、触控 ≥44、没有 style=、不用红', pr);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['用完了 / 买回来了 / 快用完了 / 不要了 / 恢复', async ({ S, open }) => {
        const p = await open({ seed: 'full', after: `localStorage.setItem('sk_popen1',JSON.stringify({cicaplast:__d(-7*20)}))` });
        await tab(p, 'products', 300);
        const v0 = await p.eval(`return (${DATA}.sk_regimen1||[]).length`);
        await click(p, '#pr-shelf .prod[data-id=cicaplast]', 200);
        S.ok(await has(p, '#prod-sheet') && /开封/.test(await text(p, '#prod-sheet')), '点一件:sheet 里写开封日期、特性');
        await sheetBtn(p, 'prod-sheet', '用完了'); await sleep(300);
        const d = await p.eval(`const d=${DATA};return {em:d.sk_empty1,gone:d.sk_gone1,reg:d.sk_regimen1,rev:${ENV}.rev,sheet:(document.getElementById('runout-sheet')||{}).innerText||''}`);
        S.ok(d.em.cicaplast && d.em.cicaplast[0].weeks === 20 && d.gone.indexOf('cicaplast') >= 0, '用完了:记一笔空瓶(开封 20 周)、从货架拿掉', d.em);
        S.ok(d.reg.length === v0 + 1 && /用完了：Cicaplast/.test(d.reg[d.reg.length - 1].reason), '方案照剩下的东西重出一版(localMarkRunOut)', d.reg.slice(-1)[0].reason);
        S.ok(/记了一笔空瓶/.test(d.sheet) && !(await row(p, 'cicaplast')), 'sheet 说清楚记了什么、方案怎么变;货架上没了它', d.sheet);
        await sheetBtn(p, 'runout-sheet', '知道了'); await sleep(200);
        await p.eval(`document.getElementById('pr-empties').open=true;return 1`);
        S.ok(/Cicaplast/.test(await text(p, '#pr-empties')) && await has(p, '#pr-empties [data-ungone=cicaplast]'), '空瓶记录里有它 +「买回来了」');
        await click(p, '#pr-empties [data-ungone=cicaplast]', 300);
        const d2 = await p.eval(`const d=${DATA};return {gone:d.sk_gone1,open:d.sk_popen1.cicaplast,today:__d(0)}`);
        S.ok(d2.gone.indexOf('cicaplast') < 0 && d2.open === d2.today && !!(await row(p, 'cicaplast')), '买回来了:回到货架,开封日记今天(localUnGone)', d2);
        // 快用完了 / 还够用
        await click(p, '#pr-shelf .prod[data-id=lacura]', 200);
        await sheetBtn(p, 'prod-sheet', '快用完了'); await sleep(200);
        S.ok((await p.eval(`return ${DATA}.sk_low1`)).indexOf('lacura') >= 0 && (await row(p, 'lacura')).state === '快用完', '快用完了:sk_low1 + 行上「快用完」(localToggleLow)');
        await click(p, '#pr-shelf .prod[data-id=lacura]', 200);
        S.ok(/不用急着买|就断了/.test(await text(p, '#prod-sheet')), '快用完的那件:sheet 里说要不要急着补(家里有没有能接班的)');
        await sheetBtn(p, 'prod-sheet', '还够用'); await sleep(200);
        S.ok((await p.eval(`return ${DATA}.sk_low1`)).indexOf('lacura') < 0, '还够用:撤掉快用完');
        // 不要了 → 恢复
        await click(p, '#pr-shelf .prod[data-id=sebagh]', 200);
        await sheetBtn(p, 'prod-sheet', '不要了'); await sleep(200);
        await p.eval(`document.querySelector('#drop-sheet [data-why="太刺激"]').click();return 1`); await sleep(300);
        const dr = await p.eval(`const x=(${DATA}.sk_proddefs1||[]).find(p=>p.id==='sebagh');const f=document.getElementById('pr-dropped');if(f)f.open=true;return {hidden:x&&x.hidden,why:x&&x.dropped&&x.dropped.why,txt:f?f.innerText:''}`);
        S.ok(dr.hidden && dr.why === '太刺激' && /Sebagh/.test(dr.txt) && /太刺激/.test(dr.txt) && !(await row(p, 'sebagh')), '不要了:收进「不要了的」,原因(选填)记下给顾问看', dr);
        await p.eval(`document.getElementById('pr-dropped').open=true;document.querySelector('#pr-dropped [data-restore=sebagh]').click();return 1`); await sleep(300);
        S.ok(!!(await row(p, 'sebagh')), '恢复:回到货架');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['添加 · 手动(先选这是什么)', async ({ S, open }) => {
        const p = await open({ seed: 'full' });
        await tab(p, 'products', 300);
        const n0 = (await rows(p)).length;
        await click(p, '#pr-add', 200);
        const roles = await p.eval(`return [...document.querySelectorAll('#add-sheet [data-role]')].map(b=>b.textContent)`);
        S.ok(roles.length >= 10 && roles.includes('保湿') && roles.includes('刷酸'), '添加:先选「这是什么」', roles);
        await click(p, '#add-sheet [data-role=moist]', 200);
        S.ok(await p.eval(`return document.querySelector('#m-role [data-v=moist]').getAttribute('aria-checked')==='true'`), '编辑 sheet 里角色已经选好');
        await p.eval(`document.querySelector('#edit-sheet .pr-adv').open=true;return 1`);
        const pe = await design(p, '#edit-sheet');
        S.ok(!pe.emoji.length && !pe.lowCr.length && !pe.inputsLt16 && !pe.smallN && !pe.styleAttrs.length, '编辑 sheet:输入框 16px、触控 ≥44、对比度、没有 style=', pe);
        await p.eval(`[...document.querySelectorAll('#edit-sheet .sheet-actions .btn-primary')][0].click();return 1`); await sleep(200);
        S.ok(await has(p, '#edit-sheet') && /先写个名字/.test(await text(p, '#sync-toast-el')), '没写名字:不存,吐司提醒');
        await p.eval(`document.getElementById('m-name').value='测试保湿乳';document.querySelector('#m-traits [data-v=light]').click();[...document.querySelectorAll('#edit-sheet .sheet-actions .btn-primary')][0].click();return 1`); await sleep(300);
        const d = await p.eval(`const d=${DATA};const x=(d.sk_proddefs1||[]).find(p=>p.name==='测试保湿乳');return {x,open:x&&d.sk_popen1[x.id],today:__d(0),st:x&&d.sk_prods1[x.id]}`);
        S.ok(d.x && /^custom_/.test(d.x.id) && d.x.role === 'moist' && d.x.addedOn === d.today && d.open === d.today && JSON.stringify(d.x.traits) === '["light"]' && d.st === 'active', '存进货架:custom_ id、角色、特性、开封日 = 今天、状态启用(格式和 v1 一样)', d);
        const r = await row(p, d.x.id);
        S.ok((await rows(p)).length === n0 + 1 && r && /试用期还剩 3 晚/.test(r.state), '货架多一件,标「新加的 · 试用期还剩 3 晚」', r);
        // 认不出角色的不兜底成保湿:直接打开编辑、不选角色存不进去
        await click(p, '#pr-add', 200);
        await click(p, '#add-sheet [data-role=acid]', 200);
        await p.eval(`document.querySelectorAll('#m-role .chip').forEach(c=>c.setAttribute('aria-checked','false'));document.getElementById('m-name').value='某个不知道是什么的';[...document.querySelectorAll('#edit-sheet .sheet-actions .btn-primary')][0].click();return 1`); await sleep(200);
        S.ok(/选一下它是什么/.test(await text(p, '#sync-toast-el')) && !(await p.eval(`return (${DATA}.sk_proddefs1||[]).some(p=>p.name==='某个不知道是什么的')`)), '没选「这是什么」:不存(不默认成保湿)');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['添加 · 拍成分表 → 确认入库 → 撤销', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true });
        await tab(p, 'products', 400);
        S.ok(await has(p, '#pr-scan-in') && /手动添加/.test(await text(p, '#pr-add')), '开通了:顶上「拍成分表」+「手动添加」');
        await p.eval(`__AIF.vision={mode:'read_label',name:'CeraVe 保湿乳',role:'保湿',traits:['light','calm','bogus'],note:'含神经酰胺'};return 1`);
        await setFile(p, '#pr-scan-in', tinyPng());
        await p.waitFor(`!!document.getElementById('pr-label-ok')`, 6000);
        const body = await p.eval(`return (__AIF.log||[]).filter(x=>x.p==='/api/vision').pop().body`);
        S.ok(body.mode === 'read_label' && /^data:image\/jpeg;base64,/.test(body.image) && body.context && body.context.products, '/api/vision read_label:压成 JPEG 的图 + context', { mode: body.mode, img: String(body.image).slice(0, 30) });
        const lb = await text(p, '#pr-label');
        S.ok(/CeraVe 保湿乳/.test(lb) && /保湿/.test(lb) && /轻薄 · 镇静/.test(lb) && /新的一支/.test(lb) && /含神经酰胺/.test(lb), '读出来的先摆出来:认成什么、特性(只认词表里的)、会怎么入库、顾问说', lb);
        S.ok(!(await p.eval(`return (${DATA}.sk_proddefs1||[]).some(x=>x.name==='CeraVe 保湿乳')`)), '没点「对，入库」之前货架不动');
        await click(p, '#pr-label-ok', 300);
        const np = await p.eval(`return (${DATA}.sk_proddefs1||[]).find(x=>x.name==='CeraVe 保湿乳')`);
        S.ok(np && np.role === 'moist' && JSON.stringify(np.traits) === '["light","calm"]' && /入库|加进货架/.test(await text(p, '#pr-label')) && await has(p, '#pr-label-undo'), '「对，入库」:加进货架(角色 + 特性),留一个「撤销」', np);
        await click(p, '#pr-label-undo', 300);
        S.ok(!(await p.eval(`return (${DATA}.sk_proddefs1||[]).some(x=>x.name==='CeraVe 保湿乳')`)) && /已撤销/.test(await text(p, '#pr-label')), '撤销:刚加的那支连同开封日一起拿掉');
        // 家里已有的:补特性
        await p.eval(`__AIF.vision={mode:'read_label',name:'Cicaplast B5 修护霜',role:'修护',traits:['calm'],note:''};return 1`);
        await setFile(p, '#pr-scan-in', tinyPng());
        await p.waitFor(`!!document.getElementById('pr-label-ok')`, 6000);
        S.ok(/家里已经有这支/.test(await text(p, '#pr-label')), '认出是货架上那支:说会把特性补进去');
        await click(p, '#pr-label-ok', 300);
        const c1 = await p.eval(`return ((${DATA}.sk_proddefs1||[]).find(x=>x.id==='cicaplast')||{}).traits`);
        await click(p, '#pr-label-undo', 300);
        const c2 = await p.eval(`return ((${DATA}.sk_proddefs1||[]).find(x=>x.id==='cicaplast')||{}).traits`);
        S.ok(JSON.stringify(c1) === '["calm"]' && c2 === undefined, '补特性 → 撤销:定义整份换回改之前', { c1, c2 });
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['要不要买新的 · 顾问在后台判断', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true });
        await p.eval(`(await import('/js/ui/products.js')).SHOP.delay=400;return 1`);
        await tab(p, 'products', 500);
        let v = await shopView(p);
        S.ok((await log(p, '/api/shop')) === 0 && v.off && v.redo === '让顾问判断', '第一次打开:不自动调,先给离线清单 +「让顾问判断」', v);
        await click(p, '#pr-shop-redo', 100);
        await p.waitFor(`!!document.getElementById('pr-shop-list')`, 4000);
        v = await shopView(p);
        const call = await p.eval(`return (__AIF.log||[]).filter(x=>x.p==='/api/shop').map(x=>({t:x.body.trigger,region:x.body.context.region,low:x.body.context.low}))`);
        S.ok(call.length === 1 && /让顾问判断/.test(call[0].t) && call[0].region === 'GB', '点了才判断一次(trigger 写明,context 带 region GB)', call);
        S.ok(JSON.stringify(v.groups) === JSON.stringify(['now:1', 'before_out:1', 'optional:1']) && /缺一支/.test(v.sum) && v.redo === '重新判断', '顾问版:一句话 + 现在就缺 / 快用完前备上 / 可买可不买', v);
        S.ok(v.links.length === 2 && v.links.every(h => /^https:\/\//.test(h)), '型号链接只认 https(没给链接的就是纯文字)', v.links);
        S.ok(/这些不用买/.test(v.skip) && /B5 修复霜/.test(v.skip), '「这些不用买」一段', v.skip);
        const rec = await p.eval(`return {local:JSON.parse(localStorage.getItem('sk_ai_shop1')||'null'),cloud:'sk_ai_shop1' in ${DATA}}`);
        S.ok(rec.local && rec.local.uid === 'u-test' && rec.local.sig && !rec.cloud, '结果按账号存本机 sk_ai_shop1(带 uid / 签名),不进云', { uid: rec.local && rec.local.uid, cloud: rec.cloud });
        await tab(p, 'advisor', 200); await tab(p, 'products', 300);
        S.ok((await log(p, '/api/shop')) === 1, '切页重画:签名没变不重调');
        // 本机标快用完 → 防抖后判断一次
        await click(p, '#pr-shelf .prod[data-id=lacura]', 200);
        await sheetBtn(p, 'prod-sheet', '快用完了'); await sleep(150);
        v = await shopView(p);
        S.ok(/货架变了/.test(v.st), '本机改了:先标「货架变了，结果可能过时，过几秒重判」', v.st);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/shop').length===2 && !document.querySelector('#pr-shop-redo[disabled]')`, 4000);
        const c2 = await p.eval(`const l=(__AIF.log||[]).filter(x=>x.p==='/api/shop').pop();return {t:l.body.trigger,low:l.body.context.low}`);
        S.ok(/Lacura.*快用完了/.test(c2.t) && c2.low.indexOf('Lacura 温和洗面奶') >= 0, '防抖后判断一次:trigger「标了「…」快用完了」,context.low 带上它', c2);
        // 连着两次本机操作只调一次;标了又撤回(签名回到上次判断)不调
        await click(p, '#pr-shelf .prod[data-id=lacura]', 150); await sheetBtn(p, 'prod-sheet', '还够用'); await sleep(80);
        await click(p, '#pr-shelf .prod[data-id=lacura]', 150); await sheetBtn(p, 'prod-sheet', '快用完了'); await sleep(900);
        S.ok((await log(p, '/api/shop')) === 2, '标了又撤回(签名回到上次判断时):不调');
        await click(p, '#pr-shelf .prod[data-id=sunscreen]', 150); await sheetBtn(p, 'prod-sheet', '快用完了'); await sleep(80);
        await click(p, '#pr-shelf .prod[data-id=wildsource]', 150); await sheetBtn(p, 'prod-sheet', '快用完了');
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/shop').length>=3`, 4000); await sleep(700);
        const c3 = await p.eval(`return (__AIF.log||[]).filter(x=>x.p==='/api/shop').map(x=>x.body.trigger)`);
        S.ok(c3.length === 3 && /Lancaster/.test(c3[2]) && /Wild Source/.test(c3[2]), '连着两次本机操作:只调一次,两件都写进 trigger', c3);
        // 同步来的改动:不调,只标可能过时
        await p.eval(`const d=${DATA};d.sk_low1=(d.sk_low1||[]).concat(['votary']);fakeCloud.emit(d);return 1`); await sleep(900);
        v = await shopView(p);
        S.ok((await log(p, '/api/shop')) === 3 && /可能过时/.test(v.st) && v.groups.length === 3, '云端同步来的「快用完」:不调,留着上次结果并标「可能过时」', v.st);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['要不要买新的 · 出错 / 不用买 / 跑着 / 换账号', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true, aif: `{shopErr:'后端超时'}` });
        await tab(p, 'products', 400);
        await click(p, '#pr-shop-redo', 100);
        await p.waitFor(`/没查成/.test((document.getElementById('pr-shop-st')||{}).textContent||'')`, 4000);
        let v = await shopView(p);
        S.ok(v.off && /后端超时/.test(v.st) && v.redo === '让顾问判断', '出错:说一句没查成,下面退回离线清单,能再点', v);
        await p.eval(`__AIF.shopErr='';__AIF.shopMs=600;__AIF.shop={verdict:'none',summary:'家里的够用。',items:[],skip:[]};return 1`);
        await click(p, '#pr-shop-redo', 150);
        v = await shopView(p);
        S.ok(/在查/.test(v.redo) && /一分钟/.test(v.st), '跑着:按钮「在查…」(禁用),状态说大约一分钟', v);
        await p.waitFor(`/现在不用买/.test((document.querySelector('.pr-shop-sum')||{}).textContent||'')`, 4000);
        v = await shopView(p);
        S.ok(/现在不用买。家里的够用/.test(v.sum) && !v.groups.length, 'verdict=none:直接说「现在不用买」+ summary', v.sum);
        // 换账号:看不到上一个人的结果(按 uid 核),不自动调
        const n = await log(p, '/api/shop');
        await p.eval(`fakeCloud.auth({uid:'u-other',email:'o@example.com',displayName:'Other',getIdToken:async()=>'t2'});return 1`); await sleep(900);
        await tab(p, 'advisor', 200); await tab(p, 'products', 400);
        v = await shopView(p);
        S.ok(v.off && !v.groups.length && !/家里的够用/.test(v.sum) && (await log(p, '/api/shop')) === n, '换了账号:看不到上一个人的结果,退回离线,不自动调', v);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['深色 · 产品页(顾问版)', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true, scheme: 'dark' });
        await tab(p, 'products', 400);
        await click(p, '#pr-shop-redo', 100);
        await p.waitFor(`!!document.getElementById('pr-shop-list')`, 4000);
        const pr = await design(p, '#products');
        S.ok(!pr.emoji.length && !pr.lowCr.length && !pr.brightN && !pr.smallN && pr.red === 0 && !pr.styleAttrs.length, '深色:对比度、不刺眼、触控 ≥44、不用红、没有 style=', pr);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }]
]);
