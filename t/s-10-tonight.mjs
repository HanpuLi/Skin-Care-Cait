// 今晚页:首屏、没有分数、标题是夜型、点状态不出方案新版本、完成今晚后没点的记成「没做」(不划线)、没防晒的提醒是注意卡。
// v2 迁移(P3):
//   · 等待条件 <html data-boot="ok">;读记录从这一页的信封(localStorage sk_sync_v1:*)读,不再读全局 lg/K/PD。
//   · 首屏:v1 量的是「第一步 top ≤260」。v2 按样稿(Cait 定「真机 844 高为准」)在步骤前面多了「今晚的情况」问句 + 即时影响 + 最多一张提醒卡,
//     第一步落到约 410(极简)/ 590(完整);改成量「第一步整个落在第一屏、不被底部 tab 挡住」(390×844、顶部安全区 59px)。
//   · 三态步骤:v2 完整模式每步只有「做了」一个勾,没点的在「完成今晚」时记成「没做」(skipped),所以「没做」的断言挪到完成之后。
//   · 计时器:v2 今晚页按样稿不再有步骤计时(时长写在每步的「怎么用」里),那两条断言退役,见 t/run.mjs。
//   · 极简模式的「只有活性有『今晚没做』/ 不打卡 / 第二天不补记 / 没保湿的安全提示」在 t/v2-a-tonight.mjs 和 engine-unit 里,不重复。
const ENV = `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k)).data})()`;
const TODAY = `((${ENV}.sk_jrnl1||[]).find(e=>e.date===__d(0))||{})`;
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
export default async function ({ origin, S, open }) {
    // ── 首屏:390×844、模拟主屏 App(顶部安全区 59px),两种模式、浅 / 深 ──
    for (const scheme of ['light', 'dark']) for (const who of ['full', 'minimal']) {
        const p = await open({ scheme });
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}()`);
        await p.reload(800);
        const r = await p.eval(`document.documentElement.style.setProperty('--safe-top','59px');document.getElementById('tab-tonight').click();${W8(150)}scrollTo(0,0);
            const f=document.querySelector('#tn-plan li'),tb=document.querySelector('.tabbar').getBoundingClientRect(),hd=document.querySelector('.hdr').getBoundingClientRect(),h1=document.getElementById('tonight-h').getBoundingClientRect();
            const b=f&&f.getBoundingClientRect();return {top:b&&Math.round(b.top),bottom:b&&Math.round(b.bottom),tab:Math.round(tb.top),hdr:Math.round(hd.bottom),h1:Math.round(h1.top)}`);
        S.ok(r.bottom !== null && r.bottom <= r.tab && r.top >= r.hdr, `${who}/${scheme}:第一步整个在第一屏里,不被底部 tab 挡(standalone)`, r);
        S.ok(r.h1 >= r.hdr, `${who}/${scheme}:标题在页头下面`, r);
        const tx = await p.eval(`return document.getElementById('tonight').innerText`);
        S.ok(!/\d+\s*分(?!钟)/.test(tx) && !/屏障/.test(tx), `${who}/${scheme}:今晚页没有分数、没有「屏障」`, tx.slice(0, 200));
        S.ok(/^今晚 · (修护夜|刷酸夜|面膜夜|维 A 夜|刮胡夜)$/.test(await p.eval(`return document.getElementById('tonight-h').textContent`)), `${who}/${scheme}:整行标题是「今晚 · 夜型」`);
        S.ok(!p.errors.length, `${who}/${scheme}:0 报错`, p.errors);
    }

    // ── 完整模式:点 4 下皮肤状态,方案版本不变;状态三选一单选,旧标签照样存;完成今晚后没点的记「没做」、名字不划线 ──
    {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.full()`);
        await p.reload(800);
        const v0 = await p.eval(`const r=${ENV}.sk_regimen1||[];return {n:r.length,v:(r[r.length-1]||{}).v}`);
        await p.eval(`document.querySelector('#tonight [data-act="skin"]').click();${W8(150)}
            const c=id=>{document.getElementById(id).click();};c('sk-tr-better');${W8(80)}c('sk-sym-泛红');${W8(80)}c('sk-sym-出油');${W8(80)}c('sk-tr-worse');${W8(80)}return 1`);
        const v1 = await p.eval(`const r=${ENV}.sk_regimen1||[];return {n:r.length,v:(r[r.length-1]||{}).v,st:${TODAY}.status,sheet:!!document.getElementById('skin-sheet')}`);
        S.ok(v1.sheet && v1.v === v0.v && v1.n === v0.n, '点 4 下皮肤状态,方案版本号和历史条数都不变', { v0, v1 });
        S.ok((v1.st || []).indexOf('变差') >= 0 && (v1.st || []).indexOf('好转') < 0 && (v1.st || []).indexOf('稳定') < 0, '三选一是单选,旧标签照样存(好转 / 稳定 / 变差)', v1.st);
        await p.eval(`document.querySelector('#skin-sheet .sheet-actions .btn-primary').click();${W8(150)}return 1`);
        const r = await p.eval(`const li=[...document.querySelectorAll('#tn-plan [data-step]')];const k0=li[0].dataset.step,rest=li.slice(1).map(x=>x.dataset.step);
            li[0].click();${W8(120)}
            const aria=document.querySelector('#tn-plan [data-step]').getAttribute('aria-checked');
            document.getElementById('tn-finish-b').click();${W8(200)}
            document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());
            const e=${TODAY};const sk=new Set(e.skipped||[]);const names=[...document.querySelectorAll('#tn-plan [data-step]')].filter(b=>sk.has(b.dataset.step)).map(b=>getComputedStyle(b.querySelector('.step-name')).textDecorationLine);
            return {k0,rest,aria,done:e.stepsDone,skipped:e.skipped,isDone:!!e.done,deco:[...new Set(names)],bar:(document.getElementById('tn-finish')||{}).textContent||''}`);
        S.ok(r.aria === 'true' && (r.done || []).indexOf(r.k0) >= 0, '点一步 = 做了(aria-checked、记进 stepsDone)', r);
        const restProd = r.rest.filter(k => (r.skipped || []).indexOf(k) >= 0);
        S.ok(r.isDone && restProd.length >= 1 && (r.skipped || []).indexOf(r.k0) < 0 && /做完了/.test(r.bar), '「完成今晚」:没点的产品步骤记成「没做」(skipped),点过的不算', r);
        S.ok(r.deco.length === 1 && r.deco[0] === 'none', '记了「没做」的名字不划线(划线只给做了的)', r.deco);
        S.ok(!p.errors.length, '完整模式:0 报错', p.errors);
    }

    // ── 没防晒:这条警告是注意卡(不进「今晚不用」、不划线、不降透明度)──
    for (const who of ['full', 'minimal']) {
        const p = await open();
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${who}({extra:{sk_gone1:['avene','toleriane','sunscreen']}})`);
        await p.reload(800);
        const spf = await p.eval(`const more=document.getElementById('tn-more');if(more)more.open=true;${W8(50)}
            const n=[...document.querySelectorAll('#tonight .note-caution')].find(x=>/防晒/.test(x.textContent));
            const sk=[...document.querySelectorAll('#tn-skips li')].some(x=>/防晒|Sun Control/.test(x.textContent));
            return {n:!!n,safety:n&&n.dataset.safety,sk,deco:n&&getComputedStyle(n.querySelector('p')).textDecorationLine,op:n&&getComputedStyle(n).opacity}`);
        S.ok(spf.n && spf.safety === '1' && !spf.sk && spf.deco === 'none' && +spf.op === 1, `${who}:没防晒的提醒是注意卡(安全提示),不在「今晚不用」里,不划线`, spf);
        S.ok(!p.errors.length, `${who} 没防晒:0 报错`, p.errors);
    }
}
