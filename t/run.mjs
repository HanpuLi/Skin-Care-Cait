// 跑全部无头测试:  node t/run.mjs            (全部)
//                   node t/run.mjs core ai    (只跑名字里含这些词的场景文件 t/s-*.mjs)
// 需要本机有 Google Chrome。不联网、不登录;退出码 = 失败条数。
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, suite, sleep } from './harness.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PRE = fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8');
const want = process.argv.slice(2);
const files = fs.readdirSync(DIR).filter(f => /^s-.*\.mjs$/.test(f)).sort().filter(f => !want.length || want.some(w => f.includes(w)));

const srv = await serve();
const origin = 'http://127.0.0.1:' + srv.address().port;
const br = await browser();
let fail = 0;
const t0 = Date.now();
try {
    for (const f of files) {
        const mod = await import(path.join(DIR, f));
        const S = suite(f.replace(/\.mjs$/, ''));
        const ctx = {
            origin, S, sleep,
            async open(opts = {}) { const p = await page(br, origin, Object.assign({ pre: PRE }, opts)); ctx._pages.push(p); return p; },
            _pages: []
        };
        try { await mod.default(ctx); }
        catch (e) { S.ok(false, '场景抛异常: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' | ')); }
        ctx._pages.forEach(p => p.close());
        fail += S.failed.length;
    }
} finally { br.close(); srv.close(); }
console.log(`\n${fail ? '✗ ' + fail + ' 条失败' : '✓ 全部通过'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fail ? 1 : 0);
