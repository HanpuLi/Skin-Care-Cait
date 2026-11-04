// ══ 洗澡安排(页头那颗按钮,任何一页都能点开)════════════════════════════════════════════
// 页头随时写今晚洗不洗;点开是日历:上周到后两周,按周一到周日排。过去的只看,今天和以后点一下就改(Cait 11/04:要旧版「排班」那样)。
// 数据就是 sk_wk1 / sk_preset1(model/week.js),和今晚页、「接下来 7 晚」是同一份,不依赖货架。
import { dayState, setDayState, toggleTn, showersAhead } from '../model/week.js';
import { addDays, dowOf, mdOf } from '../clock.js';
import { openSheet, esc } from './sheets.js';

const WD = ['一', '二', '三', '四', '五', '六', '日'], WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 页头那颗按钮写什么。接下来 7 晚一次都没排、也没点过「先不排」= 还没有安排
export function showerLabel(W) {
    if (dayState(W, W.today).shower) return { on: true, text: '今晚洗澡' };
    const none = !showersAhead(W, W.today).length && !(W.profile || {}).noShowerPlan;
    return { on: false, text: none ? '排洗澡' : '今晚不洗' };
}
// 日历的 28 天:上周一到后两周的周日
export function calendarDays(today) {
    const start = addDays(today, -((dowOf(today) + 6) % 7) - 7);
    return Array.from({ length: 28 }, (_, i) => addDays(start, i));
}
function nextName(d, t) { return d === addDays(t, 1) ? '明晚' : WEEK[dowOf(d)] + '（' + mdOf(d) + '）'; }
function headHtml(W) {
    const t = W.today, ahead = showersAhead(W, t, 14).filter(d => d !== t);
    if (dayState(W, t).shower) return `<p class="lede" id="sh-today">今晚该洗澡。</p>${ahead.length ? `<p class="note" id="sh-next">再下次：${esc(nextName(ahead[0], t))}。</p>` : ''}`;
    return `<p class="lede" id="sh-today">今晚不用洗。</p><p class="note" id="sh-next">${ahead.length ? '下次洗澡：' + esc(nextName(ahead[0], t)) + '。' : '后面两周还没排，点下面的日子排上。'}</p>`;
}
function cellHtml(W, date, mode) {
    const t = W.today, s = dayState(W, date), shaving = !!(W.profile || {}).shaving;
    const num = date.slice(8) === '01' || date === t ? Number(date.slice(5, 7)) + '/' + Number(date.slice(8)) : String(Number(date.slice(8)));
    const marks = (s.shower ? '澡' : '') + (shaving && s.shave ? '刮' : '');
    const inner = `<span class="sh-n">${num}</span><span class="sh-m">${marks}</span>`;
    const name = mdOf(date) + ' ' + WEEK[dowOf(date)];
    if (date < t) return `<div class="sh-d past" aria-label="${esc(name + (marks ? '：' + (s.shower ? '洗澡' : '') + (shaving && s.shave ? '刮胡' : '') : '：没排'))}">${inner}</div>`;
    return `<button type="button" class="sh-d${date === t ? ' today' : ''}" data-d="${esc(date)}" aria-pressed="${!!s[mode]}" aria-label="${esc((date === t ? '今天 ' : '') + name + (mode === 'shave' ? '刮胡' : '洗澡'))}">${inner}</button>`;
}
function bodyHtml(W, mode) {
    const shaving = !!(W.profile || {}).shaving;
    return `${headHtml(W)}
        ${shaving ? `<div class="chips sh-mode" role="group" aria-label="改哪一样">${[['shower', '排洗澡'], ['shave', '排刮胡']].map(([k, l]) => `<button type="button" class="chip" data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>` : ''}
        <div class="sh-wk" aria-hidden="true">${WD.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="sh-cal" id="sh-cal" role="group" aria-label="${mode === 'shave' ? '哪天刮胡' : '哪天洗澡'}">${calendarDays(W.today).map(d => cellHtml(W, d, mode)).join('')}</div>
        <p class="note">今天和以后点一下就改；过去的日子只能看。每周固定哪几天，到<a class="btn-link sm" href="#/tonight/week" id="sh-go-week">接下来 7 晚</a>里存成习惯。</p>`;
}
export function openShowerSheet(app) {
    let mode = 'shower';
    const paint = ov => { const b = ov.querySelector('#sh-body'); if (b) b.innerHTML = bodyHtml(app.world(), mode); };
    const ov = openSheet({ id: 'shower-sheet', title: '洗澡安排', html: `<div id="sh-body" class="sh">${bodyHtml(app.world(), mode)}</div>` });
    if (!ov) return;
    ov.addEventListener('click', e => {
        const el = e.target && e.target.closest && e.target.closest('[data-d],[data-mode],#sh-go-week');
        if (!el) return;
        if (el.id === 'sh-go-week') { ov.remove(); return; }
        if (el.dataset.mode) { mode = el.dataset.mode; paint(ov); return; }
        const W = app.world(), t = W.today, date = el.dataset.d;
        if (date < t) return;
        const s = dayState(W, date);
        if (date === t) toggleTn(app.store, mode, !s[mode], t);
        else setDayState(app.store, date, mode === 'shower' ? !s.shower : s.shower, mode === 'shave' ? !s.shave : s.shave, t);
        app.renderAll();
        if (date === t && app.tonightChanged) app.tonightChanged('今晚' + (mode === 'shower' ? '洗澡' : '刮胡') + '在洗澡安排里改了');   // 今晚的前提变了:顾问重排(签名变了才调)
        paint(ov);
        const again = ov.querySelector(`[data-d="${date}"]`); if (again) try { again.focus({ preventScroll: true }); } catch (x) { }
    });
}
