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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

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

export async function browser() {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-t-'));
    const port = 9300 + Math.floor(Math.random() * 500);
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
    let ver;
    for (let i = 0; i < 100; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { } await sleep(100); }
    if (!ver) throw new Error('chrome 没起来');
    return { port, proc, close: () => { try { proc.kill(); } catch { } setTimeout(() => fs.rmSync(prof, { recursive: true, force: true }), 500); } };
}

// 一个页面 = 一个 target。opts.pre:每次文档加载前注入的脚本(假 fetch / 种子数据)
export async function page(br, origin, opts = {}) {
    const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: 'PUT' })).json();
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
            if (u.startsWith(origin)) send('Fetch.continueRequest', { requestId: j.params.requestId });
            else { blocked.push(u); send('Fetch.failRequest', { requestId: j.params.requestId, errorReason: 'BlockedByClient' }); }
        }
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width || 390, height: opts.height || 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (opts.pre) await send('Page.addScriptToEvaluateOnNewDocument', { source: opts.pre });
    const P = {
        errors, dialogs, blocked, send,
        async nav(url, wait = 1500) { await send('Page.navigate', { url }); await P.waitFor('document.readyState==="complete" && typeof renderTn==="function"', 8000); await sleep(wait); },
        async reload(wait = 1500) { await send('Page.reload', {}); await sleep(300); await P.waitFor('document.readyState==="complete" && typeof renderTn==="function"', 8000); await sleep(wait); },
        async eval(expr) {
            const r = await send('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true });
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
