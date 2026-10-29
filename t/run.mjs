// 全量测试(v2,P3 整合后):一条命令跑完本机能跑的全部 —— 单测(不开浏览器)+ 迁移后的 t/s-*.mjs + v2 各屏的无头 Chrome 测试 + 新旧对拍。
//
// 跑全部:          node t/run.mjs                 (约 10 到 15 分钟;s-50 美学和 v2-a / v2-b 那几份最慢)
// 只跑一部分:      node t/run.mjs gate v2-b      (文件名里含这些词的才跑:t/s-*.mjs 和下面「另起进程」那几份都按名字筛)
//                   DESIGN_PART=states node t/run.mjs design   (美学只跑特殊状态那一段;=screens 只跑各屏)
// 需要本机有 Google Chrome(CI 上没有,所以 qa.yml 只跑单测;这份只能本机跑)。不联网、不登录真账号、不碰真后端:
//   顾问全用 page-helpers.js / v2-a-lib.mjs / v2-b-lib.mjs 里的假后端,Firebase 用页面里的假替身。退出码非 0 = 有失败。
// 别同时跑两轮:两个无头 Chrome 抢资源会互相拖死。
//
// 另起进程跑的(各自有自己的骨架和 run(),在这里按顺序一个一个跑):
//   sync-unit · engine-unit          不开浏览器:同步信封 / 引擎 / 顾问层
//   v2-boot                          外壳:四个 tab、深链、锁、离线、深色、0 全局
//   v2-a-tonight · v2-a-record · v2-a-capture   A 路:今晚(顾问写今晚 + 缓存 + 过闸)、记录(随时记一笔、脸部地图、反馈)、拍照分析
//   v2-b-advisor · v2-b-products · v2-b-settings · v2-b-oobe   B 路:顾问(对话、修订线、7 晚、常识)、产品(要不要买)、设置、新用户引导
//   v1-parity                        新旧两版同一份数据算出同样的今晚 / 排班 / 方案 / planday / 推定记录
//
// t/s-*.mjs(v1 时代的整页场景,P3 迁到 v2:等待条件改成 <html data-boot="ok">,读全局的地方改成读信封 / 点真 DOM,断言不删):
//   s-00-load      两种模式 + 新用户能打开、0 报错、四屏都画得出来
//   s-10-tonight   今晚页:首屏(第一步整个在第一屏)、没有分数 / 「屏障」、标题是夜型、点状态不出新版本、完成后没点的记「没做」不划线、没防晒是注意卡
//   s-15-ia        印章不压标题(390 / 375 / 320 + 刘海)、页头贴顶、问句 + 即时影响、不写「洗完澡适合刷酸」、四个 tab、空货架
//   s-16-week-guide 洗澡习惯两份合一的旧数据迁移(不丢、不重跑)+ 常识的内容口径(不开浏览器)
//   s-20-gate      爆痘时今晚页说为什么、猛酸不排;极简阶梯写明「不会自己加」
//   s-30-ai        数据说明第一次进顾问页弹一次(按账号);对话里撤销「改了今晚」→ 今晚页也能「重做」
//   s-33-shop      复制清单:顾问版 / verdict=none / 离线那份
//   s-36-facemap   脸部地图展开规则、空状态、SVG 线稿深浅色对比度、「避开口周 / 下颌线」
//   s-40-oobe      引导里选「有发红刺痛」→ 记进今天、刺激闸当晚就亮
//   s-50-design    纸墨验收跨全 App:四屏 + 常开 sheet × 两种模式 × 浅深、特殊状态、引导每一屏、登录后的顾问页,全 App 字号 ≤6 种
//   s-60-offline   SW 预缓存 App(外壳 + 全部模块 + 样式)和字体,断网重开今晚页 + 宋体;子集覆盖 js/ 全部界面用字
//   s-70-smoke     CLOUD_KEYS / 同步守卫 / 公开仓库边界(静态);旧日志标签读得懂、改某一天写回
//   s-80-sync      同步信封的逻辑(不开浏览器,和 sync-unit 同一组)
//   s-85-sync-page 整页:假 Firebase 登录、离线改动 + 刷新、两个窗口抢锁、旧数据升级弹窗、恢复副本
//
// 迁移时退役的断言(v2 里没有这个东西,或者被样稿 / Cait 的定案改掉了;不是为了过而删):
//   · 今晚页步骤计时器(s-10、s-50「修订条 + 计时」):样稿和 BRIEF 都没有,v2 今晚页不做计时,时长写在每步的「怎么用」里。
//   · 「第一步 top ≤260」(s-10):样稿在步骤前面加了问句 + 即时影响 + 提醒卡,改量「第一步整个在第一屏」。
//   · 完整模式每步「没做」按钮(s-10 三态):v2 只有「做了」一个勾,没点的在「完成今晚」时记成没做;断言挪到完成之后。
//   · 「极简 + 没开刮胡:只问洗澡」(s-15):样稿 Cici 版今晚页不问洗澡 / 刮胡(按每周习惯,在顾问页未来 7 晚改)。
//   · 「只勾了出油:不出现『标在脸上』」(s-36):BRIEF 定「打卡里可选」,v2 入口一直在、默认收着;改成断言收着不展开。
//   · 「ai.js 没加载」(s-30、s-33)和「ai.js 排在 App 后面加载」(s-70):v2 没有单独的 ai.js,顾问层是 js/ai/*.js 模块。
//   · CSV 导出(s-70)、产品 tab 上的保质期小点(s-70):v2 备份只导 JSON;保质期在货架那一行标 caution 点(v2-b-products 测)。
//   · v1 读全局变量的同步 / 规则断言:全部换成 engine-unit / sync-unit 的等价单测(P1 已迁)。
// 其余 v1 断言的新家写在各个 s-*.mjs 的文件头里。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serve, browser, page, suite, sleep } from './harness.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
const want = process.argv.slice(2);
const pick = f => !want.length || want.some(w => f.includes(w));
const files = fs.readdirSync(DIR).filter(f => /^s-.*\.mjs$/.test(f)).sort().filter(pick);
// 另起进程跑的几份(它们自己 process.exit,不能 import 进来)
const SUITES = ['sync-unit', 'engine-unit', 'v2-boot', 'v2-a-tonight', 'v2-a-record', 'v2-a-capture', 'v2-b-advisor', 'v2-b-products', 'v2-b-settings', 'v2-b-oobe', 'v1-parity'].filter(pick);

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
const bad = [];
for (const name of SUITES) {
    console.log('\n■■ ' + name + '(另起进程)');
    const r = spawnSync(process.execPath, [path.join(DIR, name + '.mjs')], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) bad.push(name + (r.signal ? '(' + r.signal + ')' : ''));
}
const parts = [];
if (fail) parts.push('s-*.mjs ' + fail + ' 条失败');
if (bad.length) parts.push('有失败的另起进程:' + bad.join('、'));
console.log(`\n${parts.length ? '✗ ' + parts.join(';') : '✓ 全部通过'}(s-*.mjs ${files.length} 份 + 另起进程 ${SUITES.length} 份)· ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(parts.length ? 1 : 0);
