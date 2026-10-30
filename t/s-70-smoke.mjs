// 老功能冒烟 + 同步的底线(静态):CLOUD_KEYS、回声 / 旧云不盖新本地的守卫都还在;公开仓库边界;旧日志的 status 数组照样读得懂;
//   在某天的记录里改状态 / HRT 阶段写回那一天。
// v2 迁移(P3):静态检查从 index.html / ai.js 换成 js/store.js、js/sync.js、js/app.js、js/ 下全部模块;日历某天 = 记录页历史里点那一天
//   (同一个记皮肤的 sheet,mode='day')。其余断言的新家(见 t/run.mjs 的退役说明):
//   用完了 / 买回来了 / 开封与保质期 → t/v2-b-products.mjs;导出 / 恢复备份 → t/v2-b-settings.mjs;
//   v1 的 CSV 导出和产品 tab 上的保质期小点 v2 没有(备份只导 JSON,保质期改在货架那一行标 caution 点),这两条退役。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLOUD_KEYS, K, LOCAL_KEYS } from '../js/store.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLOUD = ['sk_wk1', 'sk_jrnl1', 'sk_cd1', 'sk_prods1', 'sk_popen1', 'sk_tn1', 'sk_tnsteps1', 'sk_amsteps1', 'sk_proddefs1', 'sk_profile1', 'sk_preset1', 'sk_planday1', 'sk_mig1', 'sk_empty1', 'sk_gone1', 'sk_low1', 'sk_regimen1', 'sk_tnai1', 'sk_ai1'];
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const ENV = `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k)).data})()`;
export default async function ({ origin, S, open }) {
    // ── 静态:同步 ──
    const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const store = rd('js/store.js'), sync = rd('js/sync.js'), app = rd('js/app.js'), html = rd('index.html');
    S.ok(CLOUD.every(k => CLOUD_KEYS.indexOf(k) >= 0) && CLOUD_KEYS.length === CLOUD.length, 'CLOUD_KEYS 一个没少、没多', CLOUD_KEYS);
    S.ok(Object.values(K).every(k => CLOUD_KEYS.indexOf(k) >= 0), '每个 K.* 存档键都进云', Object.values(K).filter(k => CLOUD_KEYS.indexOf(k) < 0));
    const aiLocal = Object.values(LOCAL_KEYS).filter(k => /^sk_ai/.test(k));
    S.ok(aiLocal.length >= 5 && aiLocal.every(k => CLOUD_KEYS.indexOf(k) < 0), '顾问的本机键(对话、开通状态、数据说明、要不要买、今晚缓存…)不进云', aiLocal);
    S.ok(/applyingCloud/.test(store + sync) && /hasPendingWrites/.test(sync) && /cloudAt\s*<=\s*/.test(sync) && /_stableStr/.test(store) && /function flushPendingPush/.test(sync),
        '同步守卫都在(applyingCloud / hasPendingWrites / 升级时 cloudAt<=lastPush / _stableStr / flushPendingPush)');
    S.ok(/function ls\(k, v, origin = 'user'\)[\s\S]{0,1200}if \(durable && store\.onDurable\) store\.onDurable\(\)/.test(store) && /store\.onDurable = \(\) => schedulePush\(\)/.test(sync),
        'ls() 的用户写入都会排一次推送(信封版:durable 才推;store.onDurable = schedulePush)');
    S.ok(/runTransaction/.test(sync) && /includeMetadataChanges: true/.test(sync) && /function pauseSyncConflict/.test(sync) && /function legacySyncDecision/.test(sync) && /rev\s*>\s*.*ack|hasPending/.test(store),
        '信封同步的守卫都在(rev/ack、事务比对、只认服务器快照、冲突暂停、升级判断)');
    S.ok(/startWithLock\(\{ navigator, document, window \}, boot\)/.test(app) && /locks\.request\(LOCK_NAME/.test(sync) && /<script type="module" src="js\/app\.js">/.test(html) && !/<script[^>]+src="(ai\.js|legacy)/.test(html),
        'App 拿到窗口锁才运行(startWithLock → boot);外壳只挂 js/app.js 一个入口,旧单文件不加载');
    // 公开仓库边界:不写死 token / 测试后门;私密文件没进来
    let tracked = [];
    try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n'); } catch (e) { }
    const priv = tracked.filter(f => /^(CLAUDE\.md|AGENTS\.md|README-private\.md|LIVING_TODO\.md|家中护肤品清单\.md)$|^(Cici档案|个人档案)\/|_私人.*\.md$|^node_modules\//.test(f));
    S.ok(tracked.length > 20 && !priv.length, '仓库里没有私密文件、没有 node_modules(git ls-files)', priv);
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const src = walk(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    S.ok(!/__AIF|__seed|__login|page-helpers|fakeCloud/.test(src + html) && !/Bearer [A-Za-z0-9._-]{20,}|sk-ant-|test:[A-Za-z0-9_-]{8,}/.test(src), 'App 代码里没有测试钩子、没有写死的 token');

    // ── 运行时:旧日志 + 改某一天 ──
    const p = await open();
    await p.nav(origin + '/index.html', 200);
    await p.eval(`return __seed.full({profile:{hrt:true},jrnl:[{date:__d(-3),status:['稳定','闭口'],products:['PC酸'],note:'旧版记录',phase:'第 3 个月'},{date:__d(-2),status:['好转'],products:[],note:'',phase:''},{date:__d(-1),status:['变差','泛红'],products:[],note:'',phase:''}]})`);
    await p.reload(900);
    const day = i => `document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());document.querySelector('#record [data-act="day"][data-date="'+__d(${i})+'"]').click();${W8(150)}`;
    const old = await p.eval(`document.getElementById('tab-record').click();${W8(200)}location.hash='#/record/history';${W8(300)}const r={};for(const i of [-3,-2,-1]){${day('i')}const ov=document.getElementById('skin-sheet');
        r[i]={seg:[...ov.querySelectorAll('.sk-trend [aria-checked="true"]')].map(b=>b.textContent.trim()),syms:[...ov.querySelectorAll('.sk-syms .chip[aria-pressed="true"]')].map(b=>b.textContent.trim()),
            phase:(ov.querySelector('#sk-phase')||{}).value,note:(ov.querySelector('#sk-note')||{}).value};}
        document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());return r`);
    S.ok(old[-3].seg.join() === '差不多' && old[-2].seg.join() === '好些' && old[-1].seg.join() === '差些', '旧日志的「稳定 / 好转 / 变差」读成差不多 / 好些 / 差些', old);
    S.ok(old[-3].syms.some(x => /闭口/.test(x)) && old[-1].syms.some(x => /泛红/.test(x)), '旧日志的症状照样亮', old);
    S.ok(old[-3].note === '旧版记录' && old[-3].phase === '第 3 个月', '某天的备注、HRT 阶段照样显示(HRT 开着)', old[-3]);
    const ds = await p.eval(`${day(-2)}document.getElementById('sk-tr-worse').click();${W8(100)}const ph=document.getElementById('sk-phase');ph.value='剂量调整';ph.dispatchEvent(new Event('input'));
        document.querySelector('#skin-sheet .sheet-actions .btn-primary').click();${W8(200)}const e=(${ENV}.sk_jrnl1||[]).find(x=>x.date===__d(-2))||{};return {st:e.status,phase:e.phase}`);
    S.ok((ds.st || []).indexOf('变差') >= 0 && (ds.st || []).indexOf('好转') < 0 && ds.phase === '剂量调整', '在记录里改某天:状态单选写回(旧标签),HRT 阶段存上', ds);
    S.ok(!p.errors.length && !p.dialogs.length, '冒烟 0 报错、0 原生弹窗', p.errors.concat(p.dialogs));
}
