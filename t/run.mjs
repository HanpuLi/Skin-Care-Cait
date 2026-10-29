// 跑全部无头测试:  node t/run.mjs            (全部,约 3 到 5 分钟,美学那组最慢)
//                   node t/run.mjs gate ai    (只跑名字里含这些词的场景文件 t/s-*.mjs)
//                   DESIGN_PART=states node t/run.mjs design   (美学只跑特殊状态那一段;=screens 只跑各 tab)
// 需要本机有 Google Chrome。不联网、不登录、不碰真后端(顾问全用 page-helpers.js 里的假后端);退出码非 0 = 有失败。
// 别同时跑两轮:两个无头 Chrome 抢资源会互相拖死。
//
// 场景文件:
//   s-00-load      两种模式 + 新用户能打开,0 报错
//   s-10-tonight   今晚页:首屏位置、没有分数、三态步骤、点状态不出新版本、计时、极简「今晚没做」不被补记、没保湿的警告
//   s-20-gate      安全闸:爆痘拦猛酸、就医红线停所有酸并只留清洁保湿修护、「看过了」才解除、极简阶梯不自动升档、屏障分、inferRole
//   s-30-ai        顾问:邀请制、连不上 / ai.js 没加载 / 额度用完都不白屏、action 和 proposal 直接生效可撤销、修订条撤销重做、读成分标、出方案、数据说明
//   s-40-oobe      新用户空货架 + 引导逐屏点按钮走完、第一晚不上活性;老账号不进引导、导览只弹一次
//   s-50-design    纸墨护理手册验收:0 emoji、字号、对比度、触控、输入框、红色配额、夜间亮度、无 style=
//   s-60-offline   SW 预缓存字体和 App,断网重开今晚页 + 宋体照常;子集覆盖界面用字;OFL 许可在
//   s-70-smoke     CLOUD_KEYS 与同步守卫(静态)、导出导入、用完了 / 买回来了、PAO、某天记录、HRT、旧日志兼容
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, suite, sleep } from './harness.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
const want = process.argv.slice(2);
const files = fs.readdirSync(DIR).filter(f => /^s-.*\.mjs$/.test(f)).sort().filter(f => !want.length || want.some(w => f.includes(w)));

const srv = await serve();
const origin = 'http://127.0.0.1:' + srv.address().port;
// 每开一页就起一个新的无头 Chrome(上一页连同它的 Chrome 一起关掉)。
// 原因:这台 Mac 上无头 Chrome 起来约 32 秒就会收到 SIGTERM 退出(来源没查到,和测试内容无关,空跑也一样),
// 共用一个 Chrome 的话,跑过 32 秒的那一页就会卡死。每个测试块都在 30 秒内跑完,一页一个 Chrome 就不受影响。
let cur = null;   // { br, p }
const closeCur = () => { if (cur) { try { cur.p.close(); } catch { } cur.br.close(); cur = null; } };
let fail = 0;
const t0 = Date.now();
try {
    for (const f of files) {
        const mod = await import(path.join(DIR, f));
        const S = suite(f.replace(/\.mjs$/, ''));
        const ctx = {
            origin, S, sleep,
            async open(opts = {}) { closeCur(); const br = await browser(); const p = await page(br, origin, Object.assign({ pre: PRE }, opts)); cur = { br, p }; return p; }
        };
        try { await mod.default(ctx); }
        catch (e) { S.ok(false, '场景抛异常: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); }
        closeCur();
        fail += S.failed.length;
    }
} finally { closeCur(); srv.close(); }
console.log(`\n${fail ? '✗ ' + fail + ' 条失败' : '✓ 全部通过'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fail ? 1 : 0);
