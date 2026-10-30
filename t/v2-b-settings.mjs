// B 路 · 设置(印章打开的 sheet;无头 Chrome,假顾问后端,不花钱):
//   怎么用(完整 / 极简)+ 记录页显示开关、刮胡、HRT(按人)、印章字、深浅色(默认跟随系统,只存本机)、
//   洗澡习惯(和顾问页「存成每周习惯」同一份 sk_preset1 + showerDays 镜像)、刷酸时机、照片分析(按账号,非主账号默认关、本人同意才开)、
//   顾问(邀请码、记得的事、模型与用量只给主账号)、同步状态行 / 恢复副本 / 导出导入、数据说明(数据流写清楚)。
//   跑:node t/v2-b-settings.mjs [块名关键词]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run, tab, click, sleep, DATA, text, has, design, setFile, OWNER_EMAIL } from './v2-b-lib.mjs';

const openSet = async p => { await p.eval(`document.getElementById('btn-settings').click();return 1`); await sleep(300); };
const seg = (p, name, v) => p.eval(`document.querySelector('#settings-sheet [data-seg=${name}] [data-v="${v}"]').click();return 1`).then(() => sleep(200));
const sw = (p, id) => p.eval(`const el=document.getElementById('${id}');el.checked=!el.checked;el.dispatchEvent(new Event('change'));return el.checked`).then(async r => { await sleep(200); return r; });
const prof = p => p.eval(`return ${DATA}.sk_profile1`);

await run('v2-b-settings', [
    ['怎么用 / 你的情况 / 外观', async ({ S, open }) => {
        const p = await open({ seed: 'full' });
        await openSet(p);
        const secs = await p.eval(`return [...document.querySelectorAll('#settings-sheet .sheet-sec .sec-t')].map(x=>x.textContent)`);
        S.ok(['账号与同步', '怎么用', '你的情况', '刷酸时机', '照片分析', '外观', '顾问', '数据'].every(x => secs.some(y => y.indexOf(x) === 0)), '设置一个 sheet,一段一件事', secs);
        S.ok(await has(p, '#sync-line') && await has(p, '#sync-choose') && await has(p, '#auth-btn'), '同步状态行 / 选一份记录 / 登录按钮的 id 没变(sync.js 直接找它们)');
        // 怎么用:极简 → 记录页开关
        await seg(p, 'mode', 'min');
        let pf = await prof(p);
        S.ok(pf.minimalMode === true && await p.eval(`return document.body.classList.contains('minimal')`) && /今晚没做/.test(await text(p, '#set-mode-note')), '切到「只看今晚」:极简模式(档案 + body.minimal),说明换成极简那句');
        S.ok(await has(p, '#set-showrec') && await p.eval(`return document.getElementById('set-showrec').checked && getComputedStyle(document.getElementById('tab-record')).display!=='none'`), '极简默认显示「记录」页(开关开着)');
        await sw(p, 'set-showrec');
        S.ok((await prof(p)).hideRecords === true && await p.eval(`return getComputedStyle(document.getElementById('tab-record')).display==='none'`), '关掉:记录 tab 藏起来(hideRecords)');
        await sw(p, 'set-showrec');
        S.ok(!('hideRecords' in (await prof(p))), '再打开:记录 tab 回来');
        await seg(p, 'mode', 'full');
        S.ok((await prof(p)).minimalMode === false && !(await has(p, '#set-showrec')), '切回完整:记录页一直在(没有开关)');
        // 刮胡 / HRT
        await sw(p, 'set-shave');
        S.ok((await prof(p)).shaving === false && await p.eval(`return document.body.classList.contains('hide-shave')`) && !(await has(p, '#set-shavedays')), '关刮胡:档案、body.hide-shave、洗澡习惯里不再有刮胡那行');
        await sw(p, 'set-hrt');
        S.ok((await prof(p)).hrt === true && !(await p.eval(`return document.body.classList.contains('hide-hrt')`)), '开 HRT(只影响自己这个账号)');
        // 「在看医生 / 用药」:打开写 careAt(安全闸只认带它的;v1 引导留下的老 startState 不算),关掉删掉
        await sw(p, 'set-care');
        let pc = await prof(p);
        S.ok(pc.startState === 'care' && !!pc.careAt && /只做清洁、保湿、修护/.test(await text(p, '#tonight')), '开「在看医生 / 用药」:档案写 startState=care + careAt,今晚页说只做基础几样', pc);
        await sw(p, 'set-care');
        pc = await prof(p);
        S.ok(pc.startState === 'ok' && !('careAt' in pc), '关掉:回 ok、删 careAt', pc);
        // 印章字
        await p.eval(`const i=document.getElementById('set-seal');i.value='茶';i.dispatchEvent(new Event('change'));return 1`); await sleep(200);
        S.ok((await text(p, '#seal-ch')) === '茶' && (await prof(p)).seal === '茶' && !('stamp' in (await prof(p))), '印章上的字:改了立刻换(只写 v1 的 seal 字段)');
        // 深浅色:默认跟随系统;只存本机
        S.ok(await p.eval(`return document.querySelector('[data-seg=theme] [data-v=system]').getAttribute('aria-checked')==='true'`), '外观默认「跟随系统」');
        await seg(p, 'theme', 'dark');
        const th = await p.eval(`return {t:document.documentElement.dataset.theme,ls:localStorage.getItem('sk_theme'),cloud:'sk_theme' in ${DATA},meta:document.querySelector('meta[name=theme-color]').content}`);
        S.ok(th.t === 'dark' && th.ls === 'dark' && !th.cloud && th.meta === '#161412', '选「夜」:立刻变深色,只存本机(sk_theme 不进云)', th);
        await seg(p, 'theme', 'system');
        S.ok(await p.eval(`return document.documentElement.dataset.theme==='light'`), '回「跟随系统」:系统是浅色就浅色');
        // 字体:纸墨(默认)/ 无衬线(Cici 10/30),只存本机,首帧就生效
        S.ok(await p.eval(`return document.documentElement.dataset.type==='serif' && document.querySelector('[data-seg=type] [data-v=serif]').getAttribute('aria-checked')==='true'`), '字体默认「纸墨」');
        await seg(p, 'type', 'sans');
        const ty = await p.eval(`const r=document.documentElement,cs=getComputedStyle(document.body),t=getComputedStyle(document.querySelector('.page-title')||document.body);return {y:r.dataset.type,ls:localStorage.getItem('sk_type'),cloud:'sk_type' in ${DATA},ff:cs.fontFamily,bg:cs.backgroundColor,meta:document.querySelector('meta[name=theme-color]').content,on:document.querySelector('[data-seg=type] [data-v=sans]').getAttribute('aria-checked')}`);
        S.ok(ty.y === 'sans' && ty.ls === 'sans' && !ty.cloud && /PingFang|apple-system|system-ui/.test(ty.ff) && !/Serif/.test(ty.ff) && ty.bg === 'rgb(247, 247, 245)' && ty.meta === '#f7f7f5' && ty.on === 'true', '选「无衬线」:立刻换系统黑体和中性底色,只存本机', ty);
        await seg(p, 'theme', 'dark');
        S.ok(await p.eval(`return getComputedStyle(document.body).backgroundColor==='rgb(14, 14, 16)' && document.querySelector('meta[name=theme-color]').content==='#0e0e10'`), '无衬线 + 夜:深色那套也换');
        await p.eval(`location.reload();return 1`); await sleep(1500);
        S.ok(await p.eval(`return document.documentElement.dataset.type==='sans' && document.documentElement.dataset.theme==='dark'`), '重开:首帧脚本就是无衬线 + 夜(不闪纸墨)');
        await openSet(p);
        await seg(p, 'theme', 'system');
        await seg(p, 'type', 'serif');
        S.ok(await p.eval(`return document.documentElement.dataset.type==='serif' && /Skin Serif/.test(getComputedStyle(document.body).fontFamily) && localStorage.getItem('sk_type')==='serif'`), '切回「纸墨」:宋体回来');
        const pr = await design(p, '#settings-sheet');
        S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.inputsLt16 && !pr.styleAttrs.length, '纸墨:0 emoji、字号、对比度、输入框 16、没有 style=', pr);
        S.ok(!pr.smallN, '可点的都 ≥44', pr.small);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['洗澡习惯 = sk_preset1 / 刷酸时机', async ({ S, open }) => {
        const p = await open({ seed: 'full' });
        await openSet(p);
        const wed = await p.eval(`return document.querySelector('#set-shower [data-hd="3"]').getAttribute('aria-pressed')`);
        await click(p, '#set-shower [data-hd="3"]', 250);
        const d = await p.eval(`const d=${DATA};return {pre:d.sk_preset1,sd:d.sk_profile1.showerDays,wk:d.sk_wk1}`);
        const w3 = d.pre && d.pre.find(x => x.dow === 3);
        S.ok(w3 && String(w3.shower) !== wed && JSON.stringify(d.sd) === JSON.stringify(d.pre.filter(x => x.shower).map(x => x.dow).sort((a, b) => a - b)), '点「三」:写 sk_preset1 + showerDays 镜像(同一份)', { w3, sd: d.sd });
        await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(o=>o.remove());return 1`);
        await tab(p, 'advisor', 300);
        const n7 = await p.eval(`return [...document.querySelectorAll('#adv-n7 .n7-d')].map(x=>({dow:new Date(x.dataset.day+'T12:00:00').getDay(),today:x.classList.contains('today'),sh:x.querySelector('[data-k=shower]').getAttribute('aria-pressed')==='true'}))`);
        const wd = n7.find(x => x.dow === 3 && !x.today);
        S.ok(!wd || wd.sh === w3.shower, '顾问页未来 7 晚里的周三(不是今晚)跟着习惯变', { wd, w3 });
        // 刷酸时机
        await openSet(p);
        await seg(p, 'timing', 'avoid');
        S.ok((await prof(p)).acidTiming === 'avoid' && /你手动定的/.test(await text(p, '#set-timing')), '刷酸时机:手动定「避开刚洗完澡」');
        await seg(p, 'timing', '');
        S.ok(!('acidTiming' in (await prof(p))) && /交给方案/.test(await text(p, '#set-timing')), '「交给方案」:删掉手动设定,说现在方案是哪种');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['照片分析 · 按账号,本人同意才开', async ({ S, open }) => {
        const p = await open({ seed: 'minimal', mode: 'on', login: true });   // 非主账号(Cici 视角)
        await openSet(p);
        S.ok(!(await p.eval(`return document.getElementById('set-photoai').checked`)) && /关着/.test(await text(p, '#set-photo')), '非主账号:照片分析默认关');
        await sw(p, 'set-photoai');
        S.ok(await has(p, '#photo-consent') && !(await p.eval(`return document.getElementById('set-photoai').checked`)) && /Anthropic/.test(await text(p, '#photo-consent')), '打开要先同意(sheet 写清楚发给谁),没点同意不算开');
        await p.eval(`[...document.querySelectorAll('#photo-consent button')].find(b=>b.textContent==='先不').click();return 1`); await sleep(200);
        S.ok(!('photoAnalysis' in (await prof(p))), '「先不」:什么都不写');
        await sw(p, 'set-photoai');
        await p.eval(`[...document.querySelectorAll('#photo-consent button')].find(b=>b.textContent==='我同意，打开').click();return 1`); await sleep(300);
        const pf = await prof(p);
        S.ok(pf.photoAnalysis === true && !!pf.photoAnalysisAt && await p.eval(`return document.getElementById('set-photoai').checked`), '本人点「我同意，打开」:按账号写进档案(同步),开关亮', pf.photoAnalysis);
        S.ok(!(/模型与用量/.test(await text(p, '#set-ai'))), '模型与用量只给主账号看');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['主账号 · 照片默认开、模型与用量、顾问记得的事', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: { uid: 'u-owner', email: OWNER_EMAIL } });
        await openSet(p);
        await p.waitFor(`/模型与用量/.test(document.getElementById('set-ai').innerText)`, 3000).catch(() => { });
        S.ok(await p.eval(`return document.getElementById('set-photoai').checked`), '主账号:照片分析默认开');
        S.ok(/模型与用量/.test(await text(p, '#set-ai')) && /\$0\.12/.test(await text(p, '#set-ai')), '主账号:模型与用量(今天 / 本期花了多少)');
        await p.eval(`document.querySelector('#set-ai [data-act=memory]').click();return 1`);
        await p.waitFor(`/对酒精敏感/.test((document.getElementById('mem-sheet')||{}).innerText||'')`, 3000);
        await p.eval(`document.querySelector('#mem-sheet [data-mem=m1]').click();return 1`); await sleep(300);
        const m = await text(p, '#mem-sheet');
        S.ok(!/对酒精敏感/.test(m) && /B5 只点涂/.test(m), '顾问记得的事:能看、能删一条', m);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['数据 · 导出 / 恢复备份 / 数据说明', async ({ S, open }) => {
        const p = await open({ seed: 'full' });
        await openSet(p);
        await p.eval(`document.getElementById('set-privacy').open=true;return 1`);
        const note = await text(p, '#set-privacy');
        S.ok(/Anthropic API 组织/.test(note) && /Cait/.test(note) && /照片只存在这台设备上/.test(note) && /点了分析/.test(note) && /HRT/.test(note), '数据说明:顾问请求经 Cait 的服务器、用 Cait 的 Anthropic API 组织;照片只存本机,分析时才发;HRT 按人', note);
        // 导出:截住下载
        await p.eval(`window.__blob=null;URL.createObjectURL=b=>{window.__blob=b;return 'blob:x'};HTMLAnchorElement.prototype.click=function(){window.__dl=this.download};document.querySelector('#set-data [data-act=export]').click();return 1`);
        await p.waitFor('!!window.__blob', 3000);
        const ex = await p.eval(`const j=JSON.parse(await window.__blob.text());return {name:window.__dl,keys:Object.keys(j),meta:j._meta,n:(j.sk_jrnl1||[]).length,theme:'sk_theme' in j,chat:'sk_aichat1' in j}`);
        S.ok(/^skincare_backup_\d{4}-\d{2}-\d{2}\.json$/.test(ex.name) && ex.keys.includes('sk_jrnl1') && ex.keys.includes('sk_profile1') && ex.n === 13 && !ex.theme && !ex.chat, '导出:全部云键(v1 / v2 互相能读的格式),不含本机键', ex);
        // 恢复备份:先另存一份恢复副本,再替换
        const bk = { _meta: { version: 3 }, sk_jrnl1: [{ date: '2026-01-02', status: ['稳定'], products: [], note: '备份里的' }], sk_profile1: { shaving: false, hrt: false, minimalMode: false, onboarded: true, tour3: true, tourIA: true, tourV2: true }, sk_theme: 'dark' };
        const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skin-b-')), 'bk.json');
        fs.writeFileSync(f, JSON.stringify(bk));
        const rc0 = await p.eval(`return Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_recovery:')).length`);
        await setFile(p, '#set-import', f);
        await p.waitFor(`[...document.querySelectorAll('#sheet-root .sheet-t')].some(t=>t.textContent==='恢复备份？')`, 3000);
        S.ok(/1 天的记录/.test(await p.eval(`return [...document.querySelectorAll('#sheet-root .sheet-ov')].pop().innerText`)), '恢复之前先问(几天的记录、现在的会另存恢复副本)');
        await p.eval(`[...document.querySelectorAll('#sheet-root .sheet-ov')].pop().querySelector('.btn-primary').click();return 1`); await sleep(500);
        const r = await p.eval(`const d=${DATA};return {j:d.sk_jrnl1,shave:d.sk_profile1.shaving,theme:localStorage.getItem('sk_theme'),rc:Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_recovery:')).length}`);
        S.ok(r.j.length === 1 && r.j[0].note === '备份里的' && r.shave === false && r.theme !== 'dark' && r.rc === rc0 + 1, '恢复:只认云键(本机键不被备份文件改)、多一份恢复副本', r);
        fs.rmSync(path.dirname(f), { recursive: true, force: true });
        await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(o=>o.remove());return 1`);
        await openSet(p);
        await p.eval(`document.querySelector('#set-data [data-act=recovery]').click();return 1`); await sleep(300);
        S.ok(await p.eval(`return [...document.querySelectorAll('#sheet-root .sheet-ov')].length>=2`), '「恢复副本」打开同步层的恢复副本列表');
        S.ok(!p.errors.length, '0 console error', p.errors);
    }],
    ['深色 · 设置', async ({ S, open }) => {
        const p = await open({ seed: 'full', mode: 'on', login: true, scheme: 'dark' });
        await openSet(p);
        const pr = await design(p, '#settings-sheet');
        S.ok(!pr.emoji.length && !pr.lowCr.length && !pr.brightN && !pr.smallN, '深色:对比度、不刺眼、触控 ≥44', pr);
        S.ok(!p.errors.length, '0 console error', p.errors);
    }]
]);
