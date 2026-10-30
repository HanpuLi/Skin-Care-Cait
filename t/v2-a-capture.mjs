// A 路 · 拍照全套分析(无头 Chrome,假相机 + 假顾问后端 /api/assess,不花钱):
//   按账号开关(没设过 = 只有主账号开;Cici 默认关)· 拍前提醒 · 轮廓框 + 正 / 左 / 右三张 · 打不开相机走系统相机 / 相册
//   /api/assess 带上次的结构化结果 + 同设备上次的正脸照片 · 不能用 → 说为什么、重拍 · 能用 → 逐区分档带把握度、和上次比
//   结构化结果进当天日志 photoAssess(同步),照片只进本机 IndexedDB · 建议的状态 / 位置点「确认记上」才写(照片分析不单独触发就医红线)
//   「改一下」交给记皮肤的 sheet(建议做标记)· 出错能重试或只存照片
//   跑:node t/v2-a-capture.mjs
import path from 'node:path';
import { run, tab, click, log, sleep, setFile, ENV, TODAY_EN, PROBE, ROOT } from './v2-a-lib.mjs';

const ASSESS = {
    usable: true, retake: '', overall: '整体比上次稳，下巴还有两三颗红痘。',
    zones: [
        { zone: '下巴', findings: [{ type: '红痘', level: '少', confidence: '高' }] },
        { zone: '额头', findings: [{ type: '闭口', level: '中', confidence: '中' }, { type: '出油', level: '少', confidence: '低' }] },
        { zone: '左脸颊', findings: [{ type: '泛红', level: '少', confidence: '低' }] },
        { zone: '不存在的区', findings: [{ type: '红痘', level: '多', confidence: '高' }] }
    ],
    vs_last: '额头闭口比上次少了一些。', suggest_tags: ['泛红', '闭口', '好转'],
    suggest_spots: [{ zone: '下巴', type: '红痘' }, { zone: '左脸颊', type: '泛红' }, { zone: '额头', type: '出油' }], note: '光线稍暗，左脸把握低。'
};
const PREV = { at: '', usable: true, overall: '上次：额头闭口偏多', vs_last: '', zones: [{ zone: '额头', findings: [{ type: '闭口', level: '多', confidence: '中' }] }], suggest_tags: [], suggest_spots: [], note: '' };
// 前 4 天记了泛红(差 1 天就到就医红线的 5 天):照片分析看出泛红,也只在她点「确认记上」后才算
const SEED = `{profile:{photoAnalysis:true},status:i=>i>=-4?['泛红']:['出油']}`;
const AFTER = `const j=JSON.parse(localStorage.getItem('sk_jrnl1'));j.find(e=>e.date===__d(-3)).photoAssess=${JSON.stringify(PREV)};localStorage.setItem('sk_jrnl1',JSON.stringify(j))`;
const IDB_KEYS = `await new Promise(r=>{const q=indexedDB.open('SkincarePhotos',1);q.onupgradeneeded=e=>e.target.result.createObjectStore('photos',{keyPath:'date'});q.onsuccess=e=>{const t=e.target.result.transaction('photos','readonly').objectStore('photos').getAllKeys();t.onsuccess=()=>r(t.result)};q.onerror=()=>r([])})`;
const PUT_PREV = `await new Promise(r=>{const q=indexedDB.open('SkincarePhotos',1);q.onupgradeneeded=e=>e.target.result.createObjectStore('photos',{keyPath:'date'});q.onsuccess=e=>{const tx=e.target.result.transaction('photos','readwrite');tx.objectStore('photos').put({date:'u-test__'+__d(-3)+'__front',dataUrl:'data:image/jpeg;base64,UFJFVg=='});tx.oncomplete=()=>r(1)}})`;
const CAP = `const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];`;

async function openCap(p) {
    await tab(p, 'record', 300);
    await click(p, '.rec-q-acts [data-act=capture]', 300);
}
async function shootThree(p) {
    await p.eval(`window.__CAM=true;return 1`);
    await click(p, '#capture-sheet [data-cap=start]', 300);
    await p.waitFor(`(document.getElementById('cap-video')||{}).videoWidth>0`, 6000);
    for (let i = 0; i < 3; i++) {
        await p.waitFor(`(document.getElementById('cap-video')||{}).videoWidth>0`, 4000).catch(() => { });
        await click(p, '#cap-snap', 250);
    }
}

await run('v2-a-capture', [
    ['按账号开关:没设过只有主账号开(Cici 默认关);关着只给「拍一张」(只存本机)', async ({ S, open }) => {
        const cases = [
            ['full', `{}`, true, '非主账号、没设过'],
            ['minimal', `{}`, true, '极简(Cici)、没设过'],
            ['full', `{profile:{photoAnalysis:false}}`, true, '本人关了'],
            ['full', `{profile:{photoAnalysis:true}}`, false, '开了但没登录']
        ];
        for (const [who, arg, login, label] of cases) {
            const p = await open({ seed: who, seedArg: arg, mode: 'on', login, hash: '#/record' });
            await tab(p, 'record', 300);
            const v = await p.eval(CAP + `return {cap:qa('#record [data-act=capture]').length,file:!!q('#rec-file'),note:(q('#rec-photos')||{}).innerText||''}`);
            S.ok(!v.cap && v.file, `${label}:没有「拍照分析」,只有「拍一张」`, v);
            S.ok(login ? /没打开.*本人在设置里打开/.test(v.note) : /要登录并开通顾问/.test(v.note), `${label}:说清楚为什么`, v.note);
            await click(p, '#rec-more', 300);
            const sh = await p.eval(CAP + `return {cap:!!q('#skin-sheet [data-sk=capture]'),file:!!q('#sk-file')}`);
            S.ok(!sh.cap && sh.file, `${label}:记皮肤的 sheet 里也只有「加一张照片」`, sh);
            S.ok(!p.errors.length, `${label}:0 console error`, p.errors);
            p.done(); await sleep(200);
        }
        const p = await open({ seed: 'full', seedArg: `{profile:{photoAnalysis:true}}`, mode: 'on', login: true, hash: '#/record' });
        await tab(p, 'record', 300);
        const v = await p.eval(CAP + `return {cap:qa('#record [data-act=capture]').length,file:!!q('#rec-file')}`);
        S.ok(v.cap === 2 && !v.file, '本人开了 + 顾问开通:顶上「拍一张」和照片那段「拍三张」都进拍照分析', v);
    }],
    ['拍三张 → 顾问逐区看(带上次)→ 存结果和照片;「先不记」时状态不动、不亮红线', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: SEED, after: AFTER, mode: 'on', aif: `{assess:${JSON.stringify(ASSESS)}}`, login: true, hash: '#/record' });
        await p.eval(PUT_PREV + ';return 1');
        await openCap(p);
        await p.waitFor(`/那张正脸一起发过去/.test((document.getElementById('cap-body')||{}).innerText||'')`, 3000).catch(() => { });
        const intro = await p.eval(CAP + `return {t:(q('#capture-sheet .sheet-t')||{}).textContent,full:!!q('#capture-sheet .sheet.full'),tips:qa('#capture-sheet .cap-tips li').map(x=>x.textContent),txt:(q('#cap-body')||{}).innerText||'',noprev:!!q('#cap-noprev')}`);
        S.ok(intro.full && intro.t === '拍照分析', '全屏 sheet', intro.t);
        S.ok(intro.tips.length === 4 && /洗完脸.*先别涂/.test(intro.tips[0]) && /同一个位置.*同样的光/.test(intro.tips[1]) && /闪光灯/.test(intro.tips[2]) && /人像模式.*美颜/.test(intro.tips[3]), '拍前提醒:洗完未涂、同位置同光、关闪光、别开人像 / 美颜', intro.tips);
        S.ok(/上次拍是.*3 天前.*一起比/.test(intro.txt) && /照片存在这台设备上/.test(intro.txt), '说明会和上次比、照片存在本机', intro.txt);
        S.ok(/会把 .* 那张正脸一起发过去/.test(intro.txt) && intro.noprev, '本机有上次的正脸照片:写明会一起发过去,并给「这次不带上次的照片」', intro.txt);
        await shootThree(p);
        const sh = await p.eval(CAP + `return {oval:!!q('#capture-sheet .cap-oval ellipse'),count:(q('.cap-count')||{}).textContent,go:(q('#cap-go')||{}).textContent,views:qa('.cap-view .meta').map(x=>x.textContent)}`);
        S.ok(sh.oval, '画面上有脸部轮廓框', sh);
        S.ok(/已拍 3 \/ 3/.test(sh.count) && sh.go === '开始分析' && sh.views.every(x => x === '拍好了'), '正 / 左 / 右三张拍好了', sh);
        await click(p, '#cap-go', 300);
        await p.waitFor(`!!document.querySelector('#capture-sheet .cap-overall')`, 8000);
        const body = await p.eval(`const b=(__AIF.log||[]).find(x=>x.p==='/api/assess').body;return {n:b.images.length,jpeg:b.images.every(x=>/^data:image\\/jpeg;base64,/.test(x)),prev:b.previous&&b.previous.overall,pd:b.previous_date,pimg:(b.previous_image||'').slice(0,23),note:b.note||'',ctx:!!(b.context&&b.context.recentLogs),d3:__d(-3)}`);
        S.ok(body.n === 3 && body.jpeg && body.ctx, '/api/assess:三张 JPEG + 上下文', body);
        S.ok(body.prev === PREV.overall && body.pd === body.d3 && body.pimg === 'data:image/jpeg;base64,' && !body.note, '带上次的结构化结果、日期、同设备上次的正脸照片', body);
        const r = await p.eval(CAP + `return {ov:q('.cap-overall').textContent,txt:q('#cap-body').innerText,zones:qa('.cap-zones li').map(x=>x.innerText.replace(/\\s+/g,' ')),sug:(q('#cap-sug')||{}).textContent||''}`);
        S.ok(r.ov === ASSESS.overall && /和上次比：额头闭口比上次少了一些/.test(r.txt), '整体一句 + 和上次比', r);
        S.ok(r.zones.length === 3 && /下巴 红痘 少（把握高）/.test(r.zones[0]) && /额头 闭口 中（把握中）、出油 少（把握低）/.test(r.zones[1]) && !r.zones.some(z => /不存在/.test(z)), '逐区分档 + 把握度;不认识的区丢掉', r.zones);
        S.ok(/不数颗数、不下诊断/.test(r.txt), '写明不数颗数、不诊断', '');
        S.ok(/好些/.test(r.sug) && /泛红/.test(r.sug) && /闭口/.test(r.sug) && /下巴：红痘/.test(r.sug) && /左脸颊：泛红/.test(r.sug) && !/出油/.test(r.sug.split('·')[1] || ''), '预填建议:状态 + 位置(出油不算位置)', r.sug);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok(en.photoAssess && en.photoAssess.zones.length === 3 && en.photoAssess.overall === ASSESS.overall && !!en.photoAssess.at, '结构化结果进了今天的记录 photoAssess(随同步)', en.photoAssess);
        S.ok(!(en.status || []).length && !(en.spots || []).length, '还没确认:状态和位置都没写', en);
        const keys = await p.eval(`return ${IDB_KEYS}`), d0 = await p.eval(`return __d(0)`);
        S.ok(['front', 'left', 'right'].every(v => keys.includes('u-test__' + d0 + '__' + v)), '三张照片存进本机 IndexedDB(按账号 + 日期 + 角度)', keys);
        S.ok(!/data:image/.test(await p.eval(`return JSON.stringify(${ENV})`)), '照片本身不进同步的记录');
        await click(p, '#capture-sheet [data-cap=close]', 300);
        S.ok(await p.eval(`return !document.getElementById('capture-sheet')`), '「先不记」:关掉');
        const today = await p.eval(CAP + `return (q('#rec-today')||{}).innerText||''`);
        S.ok(/照片分析：整体比上次稳/.test(today), '「今天记下的」里有照片分析一句', today);
        await tab(p, 'tonight', 300);
        S.ok(await p.eval(`return !document.getElementById('tn-med')`), '照片看出泛红但她没确认:就医红线不亮(只数她点的状态)');
        S.ok(await log(p, '/api/assess') === 1, '只调了一次');
        // 删掉上一次那天的照片(只删照片):本机拿不到了,下一次分析也不再带 previous_image
        await tab(p, 'record', 300);
        await p.eval(`location.hash='#/record/history';await new Promise(r=>setTimeout(r,300));const d=__d(-3);const b=document.querySelector('#record [data-act="day"][data-date="'+d+'"]');if(b)b.click();return 1`); await sleep(400);
        await p.waitFor(`!!document.getElementById('sk-delphoto') && !document.getElementById('sk-delphoto').hidden`, 3000).catch(() => { });
        const hadBtn = await p.eval(`return !!document.getElementById('sk-delphoto') && !document.getElementById('sk-delphoto').hidden`);
        await p.eval(`document.getElementById('sk-delphoto').click();await new Promise(r=>setTimeout(r,150));[...document.querySelectorAll('#sheet-root .sheet-ov:last-child .sheet-actions .btn')].find(b=>b.textContent==='删掉').click();await new Promise(r=>setTimeout(r,400));return 1`);
        const k2 = await p.eval(`return ${IDB_KEYS}`), d3 = await p.eval(`return __d(-3)`);
        S.ok(hadBtn && !k2.some(k => k.indexOf('u-test__' + d3) === 0), '某一天「删掉照片」:本机那天的照片(含正 / 左 / 右)都删了', { hadBtn, k2 });
        await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(o=>o.remove());return 1`);
        // 今天那份已经是「上一次」了:删今天的照片后再分析(用今天的日期重拍)不应再带图;改用 d-3 的结构化结果测「不带 previous_image」
        await p.eval(`const j=${ENV}.sk_jrnl1;return 1`);
        await p.eval(`location.hash='#/record';await new Promise(r=>setTimeout(r,300));const d=__d(0);const b=document.querySelector('#rec-today [data-act=sheet]')||document.getElementById('rec-more');b.click();return 1`); await sleep(400);
        await p.eval(`const b=document.getElementById('sk-del');b.click();await new Promise(r=>setTimeout(r,150));[...document.querySelectorAll('#sheet-root .sheet-ov:last-child .sheet-actions .btn')].find(b=>b.textContent==='删掉').click();await new Promise(r=>setTimeout(r,500));return 1`);
        const k3 = await p.eval(`return ${IDB_KEYS}`), d0b = await p.eval(`return __d(0)`), en0 = await p.eval(`return ${TODAY_EN}`);
        S.ok(!k3.some(k => k.indexOf('u-test__' + d0b) === 0) && !en0.date, '「删掉这一天的记录」:当天记录和本机照片一起删', { k3, en0 });
        await openCap(p);
        await shootThree(p);
        await click(p, '#cap-go', 300);
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/assess').length===2`, 8000);
        const b2 = await p.eval(`const b=(__AIF.log||[]).filter(x=>x.p==='/api/assess')[1].body;return {pimg:'previous_image' in b,pd:b.previous_date||''}`);
        S.ok(!b2.pimg && b2.pd === d3, '删了照片之后:下一次分析只带上次的结构化结果,不带 previous_image', b2);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['「确认记上」:建议写进今天的状态 + 脸部地图,要顾问反馈;她确认的泛红才算进红线', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: SEED, after: AFTER, mode: 'on', aif: `{assess:${JSON.stringify(ASSESS)}}`, login: true, hash: '#/record' });
        await openCap(p);
        await shootThree(p);
        await click(p, '#cap-go', 300);
        await p.waitFor(`!!document.getElementById('cap-fill-ok')`, 8000);
        const fb0 = await log(p, '/api/feedback');
        await click(p, '#cap-fill-ok', 400);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok(['泛红', '闭口', '好转'].every(t => en.status.includes(t)), '状态写进今天(好些 / 泛红 / 闭口)', en.status);
        S.ok(JSON.stringify(en.spots) === JSON.stringify([{ zone: '下巴', type: '红痘' }, { zone: '左脸颊', type: '泛红' }]), '位置写进脸部地图', en.spots);
        S.ok(/记上了/.test(await p.eval(`return document.getElementById('cap-body').innerText`)), '写着「记上了」');
        await p.waitFor(`(__AIF.log||[]).filter(x=>x.p==='/api/feedback').length>${fb0}`, 4000);
        S.ok(true, '确认之后要了一次顾问反馈');
        await click(p, '#capture-sheet [data-cap=close]', 300);
        await tab(p, 'tonight', 300);
        S.ok(await p.eval(`return !!document.getElementById('tn-med')`), '她确认了泛红(第 5 天):就医红线亮(红线只数她确认过的状态)');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['分析中可以关:结果照样记进今天,记录页一键填建议', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: SEED, after: AFTER, mode: 'on', aif: `{assess:${JSON.stringify(ASSESS)},assessMs:1500}`, login: true, hash: '#/record' });
        await openCap(p);
        await shootThree(p);
        await click(p, '#cap-go', 200);
        const b = await p.eval(CAP + `const x=q('#capture-sheet .sheet-x');return {x:!!x&&!x.hidden,txt:q('#cap-body').innerText}`);
        S.ok(b.x && /可以先关掉/.test(b.txt) && !/先别关/.test(b.txt), '分析中:关闭按钮在,写明可以先关、结果到「记录」里定', b);
        await click(p, '#capture-sheet .sheet-x', 200);
        S.ok(!(await p.eval(`return !!document.getElementById('capture-sheet')`)), '点关闭:真关了');
        await p.waitFor(`!!(${TODAY_EN}.photoAssess)`, 8000);
        S.ok(true, '关了之后结果照样记进今天(photoAssess)');
        await tab(p, 'tonight', 200); await tab(p, 'record', 400);
        const f = await p.eval(`const el=document.getElementById('rec-pa-fill');return {on:!!el,txt:el?el.innerText:''}`);
        S.ok(f.on, '记录页出「今天的照片分析建议记上」', f);
        await click(p, '#rec-pa-fill [data-act=pa-fill]', 400);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok((en.status || []).length > 0 && !(await p.eval(`return !!document.getElementById('rec-pa-fill')`)), '点「填上」:状态写进今天,提示消失', en.status);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['不能用 → 说为什么、重拍;不存结果、不存照片', async ({ S, open }) => {
        const bad = { usable: false, retake: ['光线太暗', '脸没在框里'], overall: '', zones: [], vs_last: '', suggest_tags: [], suggest_spots: [], note: '' };
        const p = await open({ seed: 'full', seedArg: SEED, mode: 'on', aif: `{assess:${JSON.stringify(bad)}}`, login: true, hash: '#/record' });
        await openCap(p);
        await shootThree(p);
        await click(p, '#cap-go', 300);
        await p.waitFor(`!!document.querySelector('#capture-sheet [data-cap=retake]')`, 8000);
        const r = await p.eval(CAP + `return {txt:q('#cap-body').innerText,why:(q('.cap-why')||{}).textContent||'',tips:qa('#capture-sheet .cap-tips li').length}`);
        S.ok(/不太能用/.test(r.txt) && r.why === '光线太暗；脸没在框里' && r.tips === 4, '说为什么 + 再对一遍拍前提醒', r);
        const en = await p.eval(`return ${TODAY_EN}`), keys = await p.eval(`return ${IDB_KEYS}`), d0 = await p.eval(`return __d(0)`);
        S.ok(!en.photoAssess && !keys.some(k => k.indexOf(d0) >= 0), '不能用:不记结果、不存照片', { pa: en.photoAssess, keys });
        await click(p, '#capture-sheet [data-cap=retake]', 400);
        const s2 = await p.eval(CAP + `return {count:(q('.cap-count')||{}).textContent||'',cur:(q('#cap-v-front')||{getAttribute:()=>''}).getAttribute('aria-pressed')}`);
        S.ok(/已拍 0 \/ 3/.test(s2.count) && s2.cur === 'true', '「重拍」:清空,从正脸开始', s2);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['打不开相机 → 系统相机 / 相册;只拍了正脸也能分析;出错 → 再试一次 / 只存照片', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: SEED, mode: 'on', aif: `{assessErr:'顾问这会儿忙'}`, login: true, hash: '#/record' });
        await openCap(p);
        await click(p, '#capture-sheet [data-cap=start]', 600);
        await p.waitFor(`/相机没打开/.test((document.getElementById('cap-body')||{}).innerText||'')`, 4000);
        const a = await p.eval(CAP + `return {file:!!q('#cap-file'),cap:q('#cap-file').getAttribute('capture'),lbl:q('#cap-file').closest('label').textContent.trim(),go:q('#cap-go').disabled}`);
        S.ok(a.file && a.cap === 'user' && /拍照或从相册选/.test(a.lbl) && a.go, '相机没给权限:换成系统相机 / 相册;没正脸不能分析', a);
        await setFile(p, '#cap-file', path.join(ROOT, 'icon-192.png'));
        await p.waitFor(`/已拍 1 \\/ 3/.test((document.querySelector('.cap-count')||{}).textContent||'')`, 4000);
        const b = await p.eval(CAP + `return {go:q('#cap-go').textContent,dis:q('#cap-go').disabled,cur:q('#cap-v-left').getAttribute('aria-pressed')}`);
        S.ok(b.go === '先分析这几张' && !b.dis && b.cur === 'true', '正脸有了:能先分析;自动跳到左脸', b);
        await click(p, '#cap-go', 300);
        await p.waitFor(`/这次没分析成/.test((document.getElementById('cap-body')||{}).innerText||'')`, 6000);
        const body = await p.eval(`const b=(__AIF.log||[]).find(x=>x.p==='/api/assess').body;return {n:b.images.length,note:b.note||''}`);
        S.ok(body.n === 1 && /正脸/.test(body.note), '只拍了正脸:送 1 张,并说明是哪几张', body);
        const c = await p.eval(CAP + `return {txt:q('#cap-body').innerText,retry:!!q('#capture-sheet [data-cap=go]'),keep:!!q('#capture-sheet [data-cap=keep]')}`);
        S.ok(/顾问这会儿忙/.test(c.txt) && c.retry && c.keep, '出错:说原因,能「再试一次」或「只存照片」', c);
        S.ok(!(await p.eval(`return ${TODAY_EN}`)).photoAssess, '出错:不写结果');
        await click(p, '#capture-sheet [data-cap=keep]', 500);
        const keys = await p.eval(`return ${IDB_KEYS}`), d0 = await p.eval(`return __d(0)`);
        S.ok(keys.includes('u-test__' + d0 + '__front') && await p.eval(`return !document.getElementById('capture-sheet')`), '「先不分析，只存照片」:正脸进本机,关掉', keys);
        S.ok(!p.errors.length, '0 console error', p.errors.filter(x => !/502/.test(x)));
    }],
    ['「改一下」:交给记皮肤的 sheet,建议做标记(点了才写)', async ({ S, open }) => {
        const p = await open({ seed: 'full', seedArg: SEED, mode: 'on', aif: `{assess:${JSON.stringify(ASSESS)}}`, login: true, hash: '#/record' });
        await openCap(p);
        await shootThree(p);
        await click(p, '#cap-go', 300);
        await p.waitFor(`!!document.querySelector('#capture-sheet [data-cap=fill-edit]')`, 8000);
        await click(p, '#capture-sheet [data-cap=fill-edit]', 400);
        const v = await p.eval(CAP + `return {cap:!!q('#capture-sheet'),sheet:!!q('#skin-sheet'),hint:qa('#skin-sheet .chip.hint').map(x=>x.textContent),trend:(q('#sk-tr-better')||{}).textContent||'',
            fm:q('#sk-fm-t').getAttribute('aria-expanded'),chin:!!q('#sk-fz-chin .fm-mk.hint'),cheek:!!q('#sk-fz-cheekL .fm-mk.hint'),pa:(q('#skin-sheet .sk-photo')||{}).innerText||''}`);
        S.ok(!v.cap && v.sheet, '拍照 sheet 关掉,换成记皮肤的 sheet', v);
        S.ok(v.hint.some(x => /泛红/.test(x) && /建议/.test(x)) && v.hint.some(x => /闭口/.test(x)) && /建议/.test(v.trend), '建议的状态标成「建议」', v);
        S.ok(v.fm === 'true' && v.chin && v.cheek, '脸部地图展开,建议的位置做了标记', v);
        S.ok(/照片分析：整体比上次稳/.test(v.pa), 'sheet 里也看得到照片分析那一句', v.pa);
        const en = await p.eval(`return ${TODAY_EN}`);
        S.ok(!(en.status || []).length && !(en.spots || []).length, '还没写(她点了才算)', en);
        await click(p, '#sk-sym-闭口', 200);
        const en2 = await p.eval(`return ${TODAY_EN}`);
        S.ok(en2.status.includes('闭口') && !en2.status.includes('泛红'), '她点哪个写哪个', en2.status);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['美学探针:拍照 sheet(提醒 / 拍 / 结果)浅 / 深', async ({ S, open }) => {
        for (const scheme of ['light', 'dark']) {
            const p = await open({ seed: 'full', seedArg: SEED, after: AFTER, scheme, mode: 'on', aif: `{assess:${JSON.stringify(ASSESS)}}`, login: true, hash: '#/record' });
            await openCap(p);
            const steps = [['提醒', async () => { }], ['拍', async () => { await shootThree(p); }], ['结果', async () => { await click(p, '#cap-go', 300); await p.waitFor(`!!document.getElementById('cap-fill-ok')`, 8000); }]];
            for (const [name, go] of steps) {
                await go();
                const r = await p.eval(PROBE + `;return __probe('#capture-sheet .sheet')`);
                const tag = `${scheme}/${name}`;
                S.ok(!r.emoji.length && !r.lowCr.length, `${tag}:0 emoji、对比度 ≥4.5`, { e: r.emoji, cr: r.lowCr });
                S.ok(!r.smallN, `${tag}:可点的都 ≥44×44`, r.small);
                S.ok(r.red === 0 && !r.styleAttrs.length, `${tag}:没有红、模板里没有 style=`, { red: r.red, st: r.styleAttrs });
                S.ok(r.sizes.every(x => [12, 14, 16, 18, 22, 28].includes(x)), `${tag}:字号只用 6 档`, r.sizes);
                if (scheme === 'dark') S.ok(!r.brightN, `${tag}:没有比 --ink-strong 更亮的像素`, r.bright);
            }
            S.ok(!p.errors.length, `${scheme}:0 console error`, p.errors);
            p.done(); await sleep(150);
        }
    }]
]);
