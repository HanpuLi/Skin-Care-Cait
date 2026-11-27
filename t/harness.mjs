// 无头 Chrome 测试骨架(只用 node 自带的 http + 全局 WebSocket,不装依赖)。
// - 自己起静态服务(127.0.0.1 随机端口),只服务本仓库;
// - 页面发往别处的请求一律掐断(Firebase CDN、字体、顾问后端都连不上 —— 顾问用页面里的假 fetch 顶替);
// - 不登录、不读任何 token。需要「登录态」的场景用假的 _aiUser 顶替。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css', '.woff2': 'font/woff2' };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const BOOTED = 'document.readyState==="complete" && document.documentElement.dataset.boot==="ok"';

export function serve() {
    return new Promise(res => {
        const srv = http.createServer((req, rsp) => {
            let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            if (p.endsWith('/')) p += 'index.html';
            const f = path.join(ROOT, p);
            if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
            rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(f).pipe(rsp);
        });
        srv.listen(0, '127.0.0.1', () => res(srv));
    });
}

// 🔴 收拾干净(2026-11-11 加):以前 close() 直接 proc.kill(),再 500ms 后删 profile,结果两样都会留下:
//   · Chrome 每次启动会把整个 app 克隆一份到 $TMPDIR/../X/com.google.Chrome.code_sign_clone/,
//     正常退出会删,被 kill 就留下。11 月攒了 2235 份(约 300 万个文件)。
//   · 进程先退出(或 process.exit)时 500ms 定时器来不及跑,$TMPDIR 里剩 125 个 skin-t-*(约 6.7G)。
// 现在:① 启动带 --disable-features=MacAppCodeSignClone,根本不建克隆(实测有效);
//       ② 关的时候先发 CDP Browser.close 让它正常退出(实测正常退出也会删克隆,万一以后 Chrome 去掉这个开关还有这层),
//          3 秒不退再 SIGTERM,6 秒再 SIGKILL;等进程真的退出了再删 profile;
//       ③ 测试进程退出(含 process.exit / Ctrl-C)时同步杀掉还开着的 Chrome、删掉 profile;
//       ④ 每次加载顺手清掉 6 小时前崩溃残留的 skin-t-*(别同时跑两轮,见 run.mjs)。
const live = new Set();   // 还没收拾完的 { proc, prof }
process.on('exit', () => {
    for (const b of live) { try { b.proc.kill('SIGKILL'); } catch { } try { fs.rmSync(b.prof, { recursive: true, force: true }); } catch { } }
});
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    if (!process.listenerCount(sig)) process.once(sig, () => process.exit(code));
}
try {
    const old = Date.now() - 6 * 3600e3;
    for (const n of fs.readdirSync(os.tmpdir())) {
        if (!n.startsWith('skin-t-')) continue;
        const p = path.join(os.tmpdir(), n);
        try { if (fs.statSync(p).mtimeMs < old) fs.rmSync(p, { recursive: true, force: true }); } catch { }
    }
} catch { }

export async function browser() {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-t-'));
    const port = 9300 + Math.floor(Math.random() * 500);
    // CHROME_LOG=文件 时把 Chrome 的 stderr 写下来(排查无头 Chrome 中途退出用)
    const logTo = process.env.CHROME_LOG ? fs.openSync(process.env.CHROME_LOG, 'a') : 'ignore';
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-features=MacAppCodeSignClone', 'about:blank'], { stdio: ['ignore', 'ignore', logTo] });
    const me = { proc, prof };
    live.add(me);
    const exited = new Promise(r => proc.once('exit', r));
    proc.on('exit', (code, sig) => { if (!proc._closing) console.log(`  [chrome 退出了 code=${code} signal=${sig}]`); });
    let ver;
    for (let i = 0; i < 100; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { } await sleep(100); }
    if (!ver) {
        proc._closing = true;
        if (proc.exitCode === null && proc.signalCode === null) { try { proc.kill('SIGKILL'); } catch { } await exited; }
        fs.rmSync(prof, { recursive: true, force: true }); live.delete(me);
        throw new Error('chrome 没起来');
    }
    let closing = null;
    // close() 返回 Promise:要等它真的关完就 await;不 await 也行,测试进程退出时 ③ 兜底
    const close = () => closing || (closing = (async () => {
        proc._closing = true;
        if (proc.exitCode === null && proc.signalCode === null) {
            try {
                const ws = new WebSocket(ver.webSocketDebuggerUrl);
                ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
                ws.onerror = () => { };
            } catch { }
            const t1 = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { } }, 3000);
            const t2 = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { } }, 6000);
            await exited;
            clearTimeout(t1); clearTimeout(t2);
        }
        fs.rmSync(prof, { recursive: true, force: true });
        live.delete(me);
    })());
    return { port, proc, close };
}

// 一个页面 = 一个 target。opts.pre:每次文档加载前注入的脚本(假 fetch / 种子数据)
export async function page(br, origin, opts = {}) {
    // Chrome 刚起来、机器忙时 /json/new 偶尔回一行纯文本「Could not create ...」而不是 JSON(11/27 全量跑踩到):重试几次再报错
    let t = null, last = '';
    for (let i = 0; i < 20 && !t; i++) {
        const body = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: 'PUT' })).text();
        try { t = JSON.parse(body); } catch { last = body.slice(0, 80); await sleep(200); }
    }
    if (!t) throw new Error('开不了新页:' + last);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = {};
    const errors = [], dialogs = [], blocked = [];
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    ws.onmessage = m => {
        const j = JSON.parse(m.data);
        if (j.id && pend[j.id]) { pend[j.id](j); delete pend[j.id]; return; }
        if (j.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text).slice(0, 400));
        if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errors.push('console.error ' + j.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
        if (j.method === 'Page.javascriptDialogOpening') { dialogs.push(j.params.type + ': ' + j.params.message.slice(0, 200)); send('Page.handleJavaScriptDialog', { accept: opts.dialogAccept !== false }); }
        if (j.method === 'Fetch.requestPaused') {
            const u = j.params.request.url;
            const drop = (opts.blockPaths || []).some(x => u.split('?')[0].endsWith(x));   // 模拟某个文件没加载到(比如 ai.js)
            if (u.startsWith(origin) && !drop) send('Fetch.continueRequest', { requestId: j.params.requestId });
            else { blocked.push(u); send('Fetch.failRequest', { requestId: j.params.requestId, errorReason: 'BlockedByClient' }); }
        }
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    // 要拦掉某个文件时也得绕过 Service Worker(不然它从缓存里照样给)
    if (opts.blockPaths || opts.noSW) { await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); }
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width || 390, height: opts.height || 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // 配色:默认按浅色跑(结果不随这台 Mac 的外观变);opts.scheme='dark' 测夜间
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.scheme || 'light' }] });
    if (opts.pre) await send('Page.addScriptToEvaluateOnNewDocument', { source: opts.pre });
    const P = {
        errors, dialogs, blocked, send,
        // v2:外壳就绪 = js/app.js 拿到锁、画完第一屏后写的 <html data-boot="ok">(v1 时代等的是全局 renderTn,v2 没有全局)
        async nav(url, wait = 1500) { await send('Page.navigate', { url }); await P.waitFor(BOOTED, 8000); await sleep(wait); },
        async reload(wait = 1500) { await send('Page.reload', {}); await sleep(300); await P.waitFor(BOOTED, 8000); await sleep(wait); },
        async eval(expr, ms = 60000) {
            // 卡住的页面(等一个永远不回来的 Promise)别把整轮测试挂死:超时就当失败报出来
            let tm;
            const r = await Promise.race([send('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true }),
                new Promise((_, rej) => { tm = setTimeout(() => rej(new Error('eval 超时 ' + ms + 'ms: ' + expr.slice(0, 120))), ms); })]).finally(() => clearTimeout(tm));
            if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
            return r.result?.result?.value;
        },
        async waitFor(cond, ms = 5000) {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) { try { if (await P.eval('return !!(' + cond + ')')) return true; } catch { } await sleep(100); }
            throw new Error('等不到: ' + cond);
        },
        async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
        close() { try { ws.close(); } catch { } }
    };
    return P;
}

// 断言收集
export function suite(name) {
    const res = [];
    const S = {
        ok(cond, label, detail) { res.push({ ok: !!cond, label, detail }); console.log((cond ? '  ✓ ' : '  ✗ ') + label + (!cond && detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 600) : '')); return !!cond; },
        get failed() { return res.filter(r => !r.ok); },
        res, name
    };
    console.log('\n■ ' + name);
    return S;
}
