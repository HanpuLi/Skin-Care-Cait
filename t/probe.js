// 页面里跑的版式探针(AUDIT-aesthetic §3.12 的验收项都在这里量):用 p.eval(fs.readFileSync('t/probe.js')) 注入,
// 然后 __probe(rootSelector) 返回这一屏的测量。只看**可见**元素。
window.__probe = function (sel) {
    // 全屏 sheet(引导)盖住了底下的页面:那一屏用户只看得到 sheet 本身
    const full = [...document.querySelectorAll('#sheet-root .sheet-ov')].reverse().find(o => o.querySelector(':scope > .sheet.full'));
    const root = sel ? document.querySelector(sel) : (full || document.body);
    const vis = el => { if (!el) return false; const b = el.getBoundingClientRect(); if (!b.width || !b.height) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
    const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat([a]); };
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const cr = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); };
    const bgOf = el => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor)); let bg = over(parse(getComputedStyle(document.documentElement).backgroundColor), [255, 255, 255, 1]); for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg); return bg; };
    const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
    const EMO = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    const rootCs = getComputedStyle(document.documentElement);
    const tok = n => parse(getComputedStyle(document.body).getPropertyValue('color') && (() => { const d = document.createElement('i'); d.style.color = 'var(' + n + ')'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })());
    const inkStrong = tok('--ink-strong'), medical = tok('--medical');
    const same = (a, b) => a[3] > 0 && Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2 && Math.abs(a[2] - b[2]) < 2;
    // 文字
    const texts = [], sizes = {}, emoji = [], lowCr = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
        const t = n.textContent.trim(); if (!t) continue;
        const el = n.parentElement; if (!vis(el) || el.closest('svg')) continue;
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        const bg = bgOf(el); let fg = over(parse(cs.color), bg); fg = over([fg[0], fg[1], fg[2], opac(el)], bg);
        const c = +cr(fg, bg).toFixed(2);
        texts.push({ t: t.slice(0, 30), fs, c, fam: cs.fontFamily.split(',')[0].replace(/["']/g, '') });
        sizes[fs] = (sizes[fs] || 0) + t.length;
        if (EMO.test(t)) emoji.push(t.slice(0, 40));
        if (c < 4.5) lowCr.push(c + ' | ' + fs + 'px | ' + (el.className || el.tagName) + ' | ' + t.slice(0, 20));
    }
    // 关键属性里的 emoji
    root.querySelectorAll('[aria-label],[title],[placeholder],[alt],input[value]').forEach(el => {
        ['aria-label', 'title', 'placeholder', 'alt', 'value'].forEach(a => { const v = el.getAttribute(a); if (v && EMO.test(v)) emoji.push(a + ':' + v.slice(0, 40)); });
    });
    const chars = texts.reduce((s, x) => s + x.t.length, 0);
    const lt14 = texts.filter(x => x.fs < 14).reduce((s, x) => s + x.t.length, 0);
    // 触控目标(::after 绝对定位扩出去的命中区也算)
    const small = [];
    root.querySelectorAll('button, a[href], [onclick], input:not([type=hidden]):not([type=file]), select, textarea, label.file-btn, summary, [role=button], [role=checkbox], [role=radio]').forEach(el => {
        if (!vis(el)) return;
        if (el.matches('input[type=checkbox]') && el.closest('.sw-row')) return;   // 开关:整行可点
        if (el.closest('label.file-btn') && el.matches('input')) return;
        let b = el.getBoundingClientRect(); let top = b.top, bot = b.bottom, l = b.left, r = b.right;
        const af = getComputedStyle(el, '::after');
        if (af.content !== 'none' && af.position === 'absolute') { top -= Math.max(0, -parseFloat(af.top) || 0); bot += Math.max(0, -parseFloat(af.bottom) || 0); l -= Math.max(0, -parseFloat(af.left) || 0); r += Math.max(0, -parseFloat(af.right) || 0); }
        const row = el.closest('.sw-row');
        if (row) { const rb = row.getBoundingClientRect(); top = Math.min(top, rb.top); bot = Math.max(bot, rb.bottom); }
        if (bot - top < 44 - 0.5 || r - l < 44 - 0.5) small.push(Math.round(r - l) + 'x' + Math.round(bot - top) + ' ' + (el.id || el.className || el.tagName).toString().slice(0, 24) + ' ' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12));
    });
    const inputs = [...root.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, textarea')].filter(vis).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 16);
    // 红色配额 + 夜间最亮像素
    let red = 0; const bright = [], redEls = [];   // 红色按「处」数:就医卡的框和它里面的眉题算一处
    const Lmax = lum(inkStrong) + 0.002;
    root.querySelectorAll('*').forEach(el => {
        if (!vis(el) && !el.matches('.tab')) return;
        const cs = getComputedStyle(el), as = getComputedStyle(el, '::after'), bs = getComputedStyle(el, '::before');
        const cols = [];
        if (el.childNodes.length && [...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) cols.push(parse(cs.color));
        cols.push(parse(cs.backgroundColor));
        ['Top', 'Right', 'Bottom', 'Left'].forEach(s => { if (parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none') cols.push(parse(cs['border' + s + 'Color'])); });
        [as, bs].forEach(ps => { if (ps.content !== 'none' && ps.display !== 'none') { cols.push(parse(ps.backgroundColor)); } });
        if (cols.some(c => same(c, medical)) && !redEls.some(r => r.contains(el))) { red++; redEls.push(el); }
        cols.forEach(c => { if (c[3] > 0.5 && lum(c) > Lmax) bright.push((el.className || el.tagName).toString().slice(0, 20) + ' ' + c.slice(0, 3).join(',')); });
    });
    return {
        sizes: Object.keys(sizes).map(Number).sort((a, b) => a - b), pctLt14: chars ? +(lt14 / chars * 100).toFixed(1) : 0, minFs: Math.min(...texts.map(x => x.fs)),
        lowCr: lowCr.slice(0, 15), emoji, small: small.slice(0, 20), smallN: small.length, inputsLt16: inputs.length, red, bright: bright.slice(0, 10), brightN: bright.length,
        styleAttrs: [...root.querySelectorAll('[style]')].map(e => e.getAttribute('style')).filter(s => !/^width:\s*[\d.]+%;?$/.test(s.trim()))
    };
};
