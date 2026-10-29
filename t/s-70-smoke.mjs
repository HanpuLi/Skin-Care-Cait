// 老功能冒烟 + 同步的底线(静态):CLOUD_KEYS、回声 / 旧云不盖新本地的守卫都还在;导出 / 导入;用完了 / 买回来了;
// PAO 小红点;日历某天的记录;HRT 字段;旧日志的 status 数组照样读得懂。
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLOUD = ['sk_wk1', 'sk_jrnl1', 'sk_cd1', 'sk_prods1', 'sk_popen1', 'sk_tn1', 'sk_tnsteps1', 'sk_amsteps1', 'sk_proddefs1', 'sk_profile1', 'sk_preset1', 'sk_planday1', 'sk_mig1', 'sk_empty1', 'sk_gone1', 'sk_low1', 'sk_regimen1', 'sk_tnai1', 'sk_ai1'];
export default async function ({ origin, S, open }) {
    // ── 静态:同步 ──
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const ck = (html.match(/const CLOUD_KEYS = \[([^\]]*)\]/) || [])[1] || '';
    const keys = ck.split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
    S.ok(CLOUD.every(k => keys.indexOf(k) >= 0), 'CLOUD_KEYS 一个没少', CLOUD.filter(k => keys.indexOf(k) < 0));
    const kVals = [...html.matchAll(/^\s+\w+:\s*'(sk_\w+)'/gm)].map(m => m[1]);
    S.ok(kVals.length >= 19 && kVals.every(k => keys.indexOf(k) >= 0), '每个 K.* 存档键都进云', kVals.filter(k => keys.indexOf(k) < 0));
    const ai = fs.readFileSync(path.join(ROOT, 'ai.js'), 'utf8');
    const aiLocal = [...ai.matchAll(/'(sk_ai\w+)'/g)].map(m => m[1]).filter(k => k !== 'sk_ai1');
    S.ok(aiLocal.length >= 5 && aiLocal.every(k => keys.indexOf(k) < 0), '顾问的本机键(对话、开通状态、数据说明…)不进云', aiLocal);
    S.ok(/_applyingCloud/.test(html) && /hasPendingWrites/.test(html) && /cloudAt\s*<=\s*lastPush/.test(html) && /_stableStr/.test(html) && /function flushPendingPush/.test(html),
        '同步守卫都在(_applyingCloud / hasPendingWrites / cloudAt<=lastPush / _stableStr / flushPendingPush)');
    S.ok(/function ls\(k, v\)[\s\S]{0,400}schedulePush/.test(html), 'ls() 写入都会排一次推送');
    // 公开仓库边界:不写死 token / 测试后门;私密文件没进来
    const tracked = fs.readdirSync(ROOT);
    S.ok(!['CLAUDE.md', 'README.md', 'LIVING_TODO.md', '家中护肤品清单.md', 'Cici档案'].some(f => tracked.indexOf(f) >= 0), '仓库目录里没有私密文件', tracked);
    S.ok(!/__AIF|__seed|__login|page-helpers/.test(html + ai) && !/Bearer [A-Za-z0-9._-]{20,}|sk-ant-|AIza[0-9A-Za-z_-]{30}(?!.*apiKey)/.test(ai), 'App 代码里没有测试钩子、没有写死的 token');

    // ── 运行时 ──
    const p = await open();
    await p.nav(origin + '/index.html', 200);
    await p.eval(`return __seed.full({profile:{hrt:true},jrnl:[{date:__d(-3),status:['稳定','闭口'],products:['PC酸'],note:'旧版记录',phase:'第 3 个月'},{date:__d(-2),status:['好转'],products:[],note:'',phase:''},{date:__d(-1),status:['变差','泛红'],products:[],note:'',phase:''}]})`);
    await p.reload(900);
    // 旧日志的 status 数组:三选一读成好些 / 差不多 / 差些,症状照样亮
    const old = await p.eval(`const r={};for(const i of [-3,-2,-1]){openDaySheet(__d(i));await new Promise(r=>setTimeout(r,80));const ov=document.getElementById('day-sheet');
        r[i]={seg:[...ov.querySelectorAll('.seg button')].filter(b=>b.getAttribute('aria-pressed')==='true'||b.getAttribute('aria-checked')==='true').map(b=>b.textContent.trim()),
            syms:[...ov.querySelectorAll('.syms .chip[aria-pressed="true"]')].map(b=>b.textContent.trim()),phase:(ov.querySelector('#day-phase')||{}).value,note:(ov.querySelector('#day-note')||{}).value};closeSheet('day-sheet');}
        return r`);
    S.ok(old[-3].seg.join() === '差不多' && old[-2].seg.join() === '好些' && old[-1].seg.join() === '差些', '旧日志的「稳定 / 好转 / 变差」读成差不多 / 好些 / 差些', old);
    S.ok(old[-3].note === '旧版记录' && old[-3].phase === '第 3 个月', '某天的备注、HRT 阶段照样显示(HRT 开着)', old[-3]);
    // 在某天的记录里改状态 → 写进那天
    const ds = await p.eval(`openDaySheet(__d(-2));await new Promise(r=>setTimeout(r,80));const b=[...document.querySelectorAll('#day-sheet .seg button')].find(x=>x.textContent.trim()==='差些');b.click();await new Promise(r=>setTimeout(r,80));
        const ph=document.getElementById('day-phase');ph.value='剂量调整';ph.dispatchEvent(new Event('change'));
        const e=lg(K.jrnl).find(x=>x.date===__d(-2));closeSheet('day-sheet');return {st:e.status,phase:e.phase}`);
    S.ok(ds.st.indexOf('变差') >= 0 && ds.st.indexOf('好转') < 0 && ds.phase === '剂量调整', '日历里改某天:状态单选写回(旧标签),HRT 阶段存上', ds);
    // PAO:过期 → 产品 tab 上一个点
    const pao = await p.eval(`const pr=PD.find(x=>x.id==='cicaplast');pr.paoMonths=6;ls(K.prodDefs,PD);const d=new Date();d.setMonth(d.getMonth()-8);POPEN.cicaplast=localD(d);ls(K.popen,POPEN);renderAll();
        return {dot:!document.getElementById('prods-dot').hidden,state:paoState(pr)&&paoState(pr).cls}`);
    S.ok(pao.dot && pao.state === 'over', '开封超过保质期:产品 tab 有一个点', pao);
    // 用完了 → 从货架拿掉、记空瓶;买回来了 → 放回
    const ro = await p.eval(`markRunOut('votary');await new Promise(r=>setTimeout(r,80));const ok=[...document.querySelectorAll('#sheet-root .sheet-ov button')].find(b=>b.textContent.trim()==='用完了');ok&&ok.click();await new Promise(r=>setTimeout(r,120));
        const a={inPD:PD.some(x=>x.id==='votary'&&!x.hidden),gone:lg(K.gone).includes('votary'),empty:(lg(K.empty)||{}).votary&&lg(K.empty).votary.length};
        document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());unGone('votary');await new Promise(r=>setTimeout(r,80));
        document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());
        return {a,b:{inPD:PD.some(x=>x.id==='votary'&&!x.hidden),gone:lg(K.gone).includes('votary'),open:POPEN.votary===today()}}`);
    S.ok(ro.a && !ro.a.inPD && ro.a.gone && ro.a.empty >= 1, '「用完了」:从货架拿掉、记一笔空瓶', ro.a);
    S.ok(ro.b.inPD && !ro.b.gone && ro.b.open, '「买回来了」:放回货架、开封日记今天', ro.b);
    // 导出 → 导入
    const ex = await p.eval(`let blob=null;const o=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return 'blob:x'};const ck=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};
        exportJSON();await new Promise(r=>setTimeout(r,300));URL.createObjectURL=o;HTMLAnchorElement.prototype.click=ck;const txt=blob?await blob.text():'';window.__bk=txt;const j=txt?JSON.parse(txt):{};
        return {keys:Object.keys(j),n:(j.sk_jrnl1||[]).length}`);
    S.ok(['sk_jrnl1', 'sk_proddefs1', 'sk_profile1', 'sk_regimen1', '_meta'].every(k => ex.keys.indexOf(k) >= 0) && ex.n >= 3, '导出 JSON:日志、产品、档案、方案都在', ex);
    await p.eval(`localStorage.setItem('sk_jrnl1','[]');const f=new File([window.__bk],'b.json',{type:'application/json'});importJSON({files:[f]});return 1`);
    await new Promise(r => setTimeout(r, 1500));
    await p.waitFor('document.readyState==="complete" && typeof renderTn==="function"', 8000);
    const im = await p.eval(`return {n:(lg(K.jrnl)||[]).length,note:((lg(K.jrnl)||[]).find(x=>x.date===__d(-3))||{}).note}`);
    S.ok(im.n >= 3 && im.note === '旧版记录', '导入 JSON:日志回来了', im);
    // CSV:有记录时能导出;没有记录时是 App 自己的提示,不是浏览器原生弹窗
    const csv = await p.eval(`localStorage.setItem('sk_jrnl1','[]');exportCSV();await new Promise(r=>setTimeout(r,80));const s=[...document.querySelectorAll('#sheet-root .sheet-ov')].map(x=>x.innerText).join();document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());return s`);
    S.ok(/还没有记录/.test(csv) && !p.dialogs.length, '没记录时导出 CSV:App 自己的提示,没有原生弹窗', { csv, dialogs: p.dialogs });
    S.ok(!p.errors.length, '冒烟 0 报错', p.errors);
}
