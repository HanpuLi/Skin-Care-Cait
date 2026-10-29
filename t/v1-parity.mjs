// v1 / v2 对拍:同一份种子数据,v1(legacy/ 里的旧单文件)启动后写下的方案 / planday / 推定记录,
// 和 v2 引擎在同一份数据上算出来的逐项比对:今晚步骤(含提示)、今晚不用、安全提示、未来几晚排班、方案指纹和内容、planday、日志推定。
// 一样 = 上线过渡期新旧两版同开一个账号时,不会你写一版我重写一版(两边的 'system' 写入都只在变了时才写)。
// 引擎有意改口径时这里会挂:先在 ARCHITECTURE.md 写明,再改 REGIMEN_ENGINE 版本号。
//   跑:  node t/v1-parity.mjs        (需要本机有 Google Chrome)
// 测试期间在仓库根临时生成 .v1-parity.html(旧单文件的副本,相对路径要从根解析),结束就删;.gitignore 里挡着。
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, suite, sleep } from './harness.mjs';
const DIR = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(DIR, '..');
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
const TMP = path.join(ROOT, '.v1-parity.html');
fs.copyFileSync(path.join(ROOT, 'legacy/index.v1.html.txt'), TMP);
const S = suite('v1-parity');
const srv = await serve(); const origin = 'http://127.0.0.1:' + srv.address().port;
const SEEDS = {
  full: `__seed.full()`,
  minimal: `__seed.minimal()`,
  fullPimple: `__seed.full({status:i=>i===-1?['爆痘']:['稳定']})`,
  minimalNoMoist: `__seed.minimal({nomoist:true,status:()=>['闭口']})`,
  fullRed: `__seed.full({status:i=>i>=-6?['泛红']:[]})`,
  minimalRed: `__seed.minimal({status:i=>i>=-6?['泛红']:[]})`,
  fullAcidUsed: `__seed.full({status:()=>['稳定'],products:i=>i===-2?['PC酸']:[]})`,
  minimalLadder: `__seed.minimal({products:i=>[-30,-26,-22,-18,-14,-10,-6].includes(i)?['PC酸']:[]})`,
};
for (const [name, seed] of Object.entries(SEEDS)) {
  const br = await browser();
  try {
    const p = await page(br, origin, { pre: PRE });
    await p.send('Page.navigate', { url: origin + '/.v1-parity.html' }); await p.waitFor('document.readyState==="complete"', 8000);
    await p.eval(`${seed}; return 1`);
    await p.send('Page.reload', {}); await sleep(2500);
    const r = await p.eval(`
      const env=JSON.parse(localStorage.getItem('sk_sync_v1:')||'null'); if(!env) return {err:'no env'};
      const data=JSON.parse(JSON.stringify(env.data));
      const {createStore}=await import('/js/store.js');
      const m=new Map([['sk_sync_v1:',JSON.stringify(env)]]);
      const LS={get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
      const st=createStore({localStorage:LS}).open();
      const {buildWorld,planNow}=await import('/js/model/world.js');
      const {regimenSig,buildRegimen}=await import('/js/engine/regimen.js');
      const {syncRegimen}=await import('/js/model/regimen.js');
      const {tonight,plandayOf}=await import('/js/engine/schedule.js');
      const {safetyGate}=await import('/js/engine/gate.js');
      const T=__d(0);
      const W=buildWorld(st,{today:T});
      const regs=data.sk_regimen1||[]; const last=regs[regs.length-1]||{};
      const v2reg=buildRegimen(W);
      const pick=r=>JSON.stringify({rules:r.rules,using:r.using,gaps:r.gaps,resting:r.resting,summary:r.summary,phase:r.phase,acid:r.acid});
      const before=JSON.stringify(st.lg('sk_regimen1'));
      const re=syncRegimen(st,'',false,T);
      planNow(st,{today:T});
      const v2pd=st.lg('sk_planday1');
      const {computePlan}=await import('/js/engine/schedule.js');
      let v1t=null,v1plan=null; try{ const slot=computePlanRolling().find(d=>d.date===today())||{items:[],conflicts:[],date:today()};
        const ns=buildNightSteps(!!TN.shower,!!TN.shave&&!!PROFILE.shaving,slot);
        v1t=JSON.stringify({steps:ns.steps.map(x=>x.p+'|'+x.kind+'|'+(x.h||'')),skips:ns.skips,warn:(ns.warnings||[]).map(w=>w.text||w)});
        v1plan=JSON.stringify(computePlanRolling().map(d=>[d.date,d.shower,d.shave,d.items.map(i=>i.type+':'+i.label)]));
      }catch(e){ v1t='ERR '+e.message; }
      const W2=buildWorld(st,{today:T}); const t2=tonight(W2);
      const v2t=JSON.stringify({steps:t2.steps.map(x=>x.p+'|'+x.kind+'|'+(x.h||'')),skips:t2.skips,warn:(t2.warnings||[]).map(w=>w.text||w)});
      const v2plan=JSON.stringify(computePlan(W2).map(d=>[d.date,d.shower,d.shave,d.items.map(i=>i.type+':'+i.label)]));
      return {v1sig:last.sig, v2sig:regimenSig(W), regenerated:!!re, v1reg:pick(last), v2reg:pick(v2reg), v1pd:JSON.stringify(data.sk_planday1), v2pd:JSON.stringify(v2pd),
        v1jr:JSON.stringify((data.sk_jrnl1||[]).slice(0,3)), v2jr:JSON.stringify(st.lg('sk_jrnl1').slice(0,3)),
        v2steps:tonight(W).steps.map(s=>s.p), cap:safetyGate(W).acidCapMax, v1t, v2t, v1plan, v2plan, reglen:r0len(last)};
      function r0len(x){return JSON.stringify(x).length}
    `);
    if (r.err) { S.ok(false, name + ':' + r.err); continue; }
    const ok = { tonight: r.v1t === r.v2t, plan: r.v1plan === r.v2plan, sig: r.v1sig === r.v2sig, noRegen: !r.regenerated, reg: r.v1reg === r.v2reg, pd: r.v1pd === r.v2pd, jr: r.v1jr === r.v2jr };
    const all = Object.values(ok).every(Boolean);
    S.ok(all && r.v1reg.length > 200, name + ':今晚 / 排班 / 方案 / planday / 推定记录 v1 和 v2 一致(酸上限 ' + r.cap + ';' + r.v2steps.length + ' 步)', ok);
    if (!all) {
      if (!ok.tonight) console.log('   v1t', r.v1t, '\n   v2t', r.v2t);
      if (!ok.plan) console.log('   v1plan', r.v1plan.slice(0,600), '\n   v2plan', r.v2plan.slice(0,600));
      if (!ok.sig) console.log('   v1sig', r.v1sig, '\n   v2sig', r.v2sig);
      if (!ok.reg) console.log('   v1reg', r.v1reg.slice(0, 900), '\n   v2reg', r.v2reg.slice(0, 900));
      if (!ok.pd) console.log('   v1pd', r.v1pd, '\n   v2pd', r.v2pd);
      if (!ok.jr) console.log('   v1jr', r.v1jr.slice(0, 500), '\n   v2jr', r.v2jr.slice(0, 500));
    }
    p.close();
  } catch (e) { S.ok(false, name + ':抛异常 ' + e.message); }
  finally { br.close(); }
}
srv.close(); try { fs.unlinkSync(TMP); } catch { }
console.log(`\n${S.failed.length ? '✗ ' + S.failed.length + ' 条失败' : '✓ 全部通过'}(${S.res.length} 条)`);
process.exit(S.failed.length ? 1 : 0);
