// 开发用:看一眼某个场景。  node t/peek.mjs <full|minimal|fresh> [tab] [out.png] [js 表达式]
// 打印页面文字 + 第一步的位置 + 报错;给了 out.png 就截一张 390×844 的图
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, sleep } from './harness.mjs';
const [who = 'full', tab = 'tonight', out, expr] = process.argv.slice(2);
const DIR = path.dirname(new URL(import.meta.url).pathname);
const srv = await serve(); const origin = 'http://127.0.0.1:' + srv.address().port;
const br = await browser();
try {
    const p = await page(br, origin, { scheme: process.env.DARK ? 'dark' : 'light', pre: fs.readFileSync(path.join(DIR, 'page-helpers.js'), 'utf8') });
    await p.nav(origin + '/index.html', 300);
    await p.eval(`return __seed.${who}()`);
    await p.reload(1200);
    if (tab !== 'tonight') { await p.eval(`show('${tab}')`); await sleep(400); }
    if (expr) { console.log('expr →', JSON.stringify(await p.eval(expr))); await sleep(400); }
    const r = await p.eval(`const f=document.querySelector('#tn-plan .step'); return { firstStepY: f ? Math.round(f.getBoundingClientRect().top + scrollY) : null, text: (document.querySelector('.panel.active')||document.body).innerText.slice(0, 2500), sheets: [...document.querySelectorAll('#sheet-root .sheet-ov')].map(x=>x.innerText.slice(0,400)) }`);
    console.log('firstStepY', r.firstStepY);
    console.log(r.text);
    if (r.sheets.length) console.log('--- sheets ---\n' + r.sheets.join('\n---\n'));
    if (out) await p.shot(out);
    if (p.errors.length) console.log('ERRORS', p.errors);
    p.close();
} finally { br.close(); srv.close(); }
