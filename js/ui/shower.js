// ══ 洗澡:今晚页的洗澡模块 + 洗澡页(#/tonight/shower)══════════════════════════════════════════
// 【11/10 一件事只有一个家】Cait:「洗澡单独在第一页开一个模块或页面记录即可,不需要像现在这样在超过三个地方都有」。
//   以前页头胶囊、今晚页问句、「还没排洗澡」卡、7 晚格子里的「澡」、每周习惯、记录页 14 天格子、洗澡日历 sheet 七处都能看能改;
//   现在只剩这里:今晚页一个矮模块(今晚洗不洗 + 一个按钮 + 进洗澡页),洗澡页管间隔和前后两周的日历。
// 数据和规则在 model/week.js(隔 x 天:showerEvery / showerSince / showerMarks,全在 sk_profile1):这个文件只管画和点。
// 接口(今晚页按这个用,别改名):showerCardHtml(app) / bindShowerCard(root, app) / showerPage = {title, render, mount}。
import { showerInfo, showerDay, showerEvery, setShowerMark, setShowerEvery, SHOWER_MAX } from '../model/week.js';
import { addDays, dowOf, mdOf, daysBetween } from '../clock.js';
import { esc, ico } from './sheets.js';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], WD = ['一', '二', '三', '四', '五', '六', '日'];
// 界面说法:每天 / 隔 1 天 / 隔 2 天…;小字「每 N 天一次」
export function everyText(n) { return n === 1 ? '每天' : '隔 ' + (n - 1) + ' 天'; }
function everyNote(n) { return n === 1 ? '每天洗一次' : '每 ' + n + ' 天洗一次'; }
function pastName(d, t) { const k = daysBetween(d, t); return k === 1 ? '昨晚' : k < 7 ? WEEK[dowOf(d)] : mdOf(d); }
function nextName(d, t) { const k = daysBetween(t, d); return k === 1 ? '明晚' : k < 7 ? WEEK[dowOf(d)] : mdOf(d); }
// 今晚处在哪种状态:none 还没排 / due 该洗 / rest 不用洗 / skip 该洗但点了不洗 / extra 没排但点了要洗
export function showerState(W) {
    const x = showerInfo(W, W.today);
    if (!x.every) return { st: 'none', x };
    if (x.mark !== undefined && x.mark !== x.due) return { st: x.on ? 'extra' : 'skip', x };
    return { st: x.on ? 'due' : 'rest', x };
}
// 主文案 + 小字(模块和洗澡页顶上共用一套说法)
// 小字用逗号分句(「隔 1 天，上次周日洗的」),不用「A · B」点号串联:Cait 不要那种「今晚·护肤页」式的排版
function lines(st, x, t) {
    const ev = x.every ? everyText(x.every) : '', last = x.last ? '上次' + pastName(x.last, t) + '洗的' : '', next = x.next ? '下次' + nextName(x.next, t) + '洗' : '';
    const join = a => a.filter(Boolean).join('，');
    if (st === 'due') return { main: '今晚洗澡', sub: join([ev, last]) };
    if (st === 'rest') return { main: '今晚不用洗', sub: join([next, ev]) };
    if (st === 'skip') return { main: x.next ? '今晚不洗，改到' + nextName(x.next, t) : '今晚不洗', sub: join([ev, last]) };
    if (st === 'extra') return { main: '今晚洗澡（临时加的）', sub: join(['之后从今晚重新算', next]) };
    return { main: '隔几天洗一次？', sub: '' };
}

// ── 今晚页的洗澡模块:要矮(390×844 第一屏还要看得到第一步)。整块左边是进洗澡页的入口,按钮单独放右边(不嵌在 <a> 里)──
export function showerCardHtml(app) {
    const W = app.world(), t = W.today, { st, x } = showerState(W), L = lines(st, x, t);
    // 还没排时「洗澡」两个字和问句同一行(小字淡墨在前):少占一行,三个快选下面那一行才放得下,第一步还在第一屏
    const go = `<a class="sh-go" href="#/tonight/shower" id="sh-go"><span class="sh-main">${st === 'none' ? '<span class="sh-k">洗澡</span>' : ''}${esc(L.main)}${ico('chev', 'sm sh-chev')}</span>${L.sub ? `<span class="sh-sub">${esc(L.sub)}</span>` : ''}</a>`;
    let act = '';
    if (st === 'none') act = `<div class="sh-picks" role="group" aria-label="隔几天洗一次">${[1, 2, 3].map(n => `<button type="button" class="btn" data-sh="every" data-n="${n}">${everyText(n)}</button>`).join('')}</div>`;
    else if (st === 'due') act = '<button type="button" class="btn sh-btn" data-sh="skip" id="sh-act">今晚不洗</button>';
    else if (st === 'rest') act = '<button type="button" class="btn sh-btn" data-sh="add" id="sh-act">今晚要洗</button>';
    // 撤回和「今晚不洗 / 今晚要洗」同一个位置、同一种按钮(无衬线下是浅灰胶囊,点完不换控件形态;纸墨在 css 里放淡)
    else act = '<button type="button" class="btn sh-btn sh-undo" data-sh="undo" id="sh-act">撤回</button>';
    return `<section class="sh-card" id="tn-shower" data-st="${st}" aria-label="洗澡">${go}${act}</section>`;
}

// ── 洗澡页:今晚一句 → 多久洗一次(步进,每天 ~ 隔 6 天)→ 前后两周的日历 ──
// 日历 4 行、周一起排:前两周 + 这周 + 下周(今天在第 3 行)。过去的点了改「那天洗没洗」(记录),今天和以后点了改计划
export function calendarDays(today) {
    const start = addDays(today, -((dowOf(today) + 6) % 7) - 14);
    return Array.from({ length: 28 }, (_, i) => addDays(start, i));
}
function cellHtml(W, d, i) {
    const t = W.today, c = showerDay(W, d), past = d < t, chg = c.mark !== undefined && c.mark !== c.due;
    const num = i === 0 || d === t || d.slice(8) === '01' ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8)) : String(Number(d.slice(8)));
    const what = past ? (c.on ? '洗了' : '没洗') : (c.on ? '洗澡' : '不洗');
    const label = (d === t ? '今天 ' : '') + mdOf(d) + ' ' + WEEK[dowOf(d)] + '：' + what + (chg ? '（改过的）' : '');
    return `<button type="button" class="shp-d${past ? ' past' : ''}${d === t ? ' today' : ''}${chg ? ' chg' : ''}" data-sh="day" data-d="${esc(d)}" aria-pressed="${c.on}" aria-label="${esc(label)}"><span class="shp-n">${esc(num)}</span><span class="shp-m">${c.on ? '澡' : ''}</span></button>`;
}
function everyHtml(n) {
    if (!n) return `<div class="shp-picks" role="group" aria-label="隔几天洗一次">${[1, 2, 3, 4].map(k => `<button type="button" class="btn" data-sh="every" data-n="${k}">${everyText(k)}</button>`).join('')}</div>
        <p class="note">从今晚开始算。排好以后在这里改，最多隔 6 天。</p>`;
    return `<div class="shp-step" role="group" aria-label="多久洗一次">
        <button type="button" class="shp-sb" data-sh="step" data-n="-1" aria-label="少隔一天" aria-disabled="${n <= 1}">−</button>
        <p class="shp-val" aria-live="polite"><span class="shp-v">${esc(everyText(n))}</span><span class="shp-vn">${esc(everyNote(n))}</span></p>
        <button type="button" class="shp-sb" data-sh="step" data-n="1" aria-label="多隔一天" aria-disabled="${n >= SHOWER_MAX}">+</button></div>
        <p class="note">改了从今晚起按新的算，之前的日子不变。</p>`;
}
function pageHtml(app) {
    const W = app.world(), t = W.today, { st, x } = showerState(W);
    const now = st === 'none' ? '还没排洗澡。' : st === 'skip' ? '今晚不洗。' : lines(st, x, t).main + '。';
    const around = [x.last ? '上次' + pastName(x.last, t) + '洗的' : '', x.next ? '下次' + nextName(x.next, t) + '洗' : ''].filter(Boolean).join('，');
    // 老的「每周几天」迁过来的间隔:说一句是怎么来的(她自己改过间隔就不说了,setShowerEvery 会删 showerFrom)
    const from = (W.profile || {}).showerFrom, fromNote = x.every && from > 0 ? `这是按你以前每周洗 ${from} 次折算的，不对就在下面改。` : '';
    return `<section class="sec shp-top" id="shp-top"><p class="shp-now" id="shp-now">${esc(now)}</p>${around ? `<p class="note">${esc(around)}。</p>` : ''}${fromNote ? `<p class="note" id="shp-from">${esc(fromNote)}</p>` : ''}</section>
        <section class="sec" id="shp-every" aria-labelledby="shp-every-h"><div class="sec-h"><h2 class="sec-t" id="shp-every-h">多久洗一次</h2></div>${everyHtml(x.every)}</section>
        <section class="sec" id="shp-cal" aria-labelledby="shp-cal-h"><div class="sec-h"><h2 class="sec-t" id="shp-cal-h">前后两周</h2></div>
            <div class="shp-wk" aria-hidden="true">${WD.map(w => `<span>${w}</span>`).join('')}</div>
            <div class="shp-cal" role="group" aria-label="前后两周哪天洗澡">${calendarDays(t).map((d, i) => cellHtml(W, d, i)).join('')}</div>
            <p class="note shp-legend">有「澡」的是洗澡的晚上，排上的默认算洗了；右上角有点的是改过的。点过去的日子改那天洗没洗，点今天和以后改计划。</p></section>`;
}
export const showerPage = { title: '洗澡', render: app => pageHtml(app), mount: (body, app) => bindShowerCard(body, app) };

// ── 点 ──
// 委托在 root 上,只认 [data-sh]。同一个 root 只绑一次(WeakSet);洗澡页画在今晚那一屏里时,
//   今晚页挂在整屏上的这一份和洗澡页自己挂的这一份都会收到同一次点击:事件上打个记号,只处理一次
const BOUND = new WeakSet();
export function bindShowerCard(root, app) {
    if (!root || BOUND.has(root)) return;
    BOUND.add(root);
    root.addEventListener('click', e => {
        const el = e.target && e.target.closest && e.target.closest('[data-sh]');
        if (!el || !root.contains(el) || e.__skShower) return;
        e.__skShower = true;
        act(app, el);
    });
}
function act(app, el) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    const a = el.dataset.sh, t = app.today(), W = app.world(), before = showerDay(W, t).on;
    let why = '', focus = [];
    if (a === 'skip' || a === 'add' || a === 'undo') {
        setShowerMark(app.store, t, a === 'undo' ? null : a === 'add', t);
        why = a === 'skip' ? '今晚不洗澡了' : a === 'add' ? '今晚临时洗澡' : '今晚洗澡改回按间隔排';
        focus = ['#sh-act'];
    } else if (a === 'every' || a === 'step') {
        const cur = showerEvery(W.profile), n = a === 'every' ? +el.dataset.n : (cur || 1) + (+el.dataset.n || 0);
        if (!(n >= 1 && n <= SHOWER_MAX) || n === cur) return;
        setShowerEvery(app.store, n, t);
        why = '洗澡改成' + everyText(n);
        focus = a === 'step' ? [`[data-sh="step"][data-n="${el.dataset.n}"]`] : ['#sh-act', '.shp-sb'];
    } else if (a === 'day') {
        const d = el.dataset.d; if (!d) return;
        const x = showerDay(W, d), v = !x.on;
        setShowerMark(app.store, d, v === x.due ? null : v, t);   // 改回和排的一样 = 撤掉这条记录
        why = d === t ? (v ? '今晚临时洗澡' : '今晚不洗澡了') : '洗澡记录改了';
        focus = [`[data-sh="day"][data-d="${d}"]`];
    } else return;
    app.renderAll();
    // 今晚的前提变了(今晚洗不洗)才让顾问重排;改过去的记录也可能挪动今晚,所以按结果比,不按点的是哪天
    if (showerDay(app.world(), t).on !== before && app.tonightChanged) app.tonightChanged(why);
    for (const q of focus) { const f = document.querySelector(q); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { } break; } }
}
