// ══ 浮层:全 App 只用这一种 sheet(替代原生 confirm / alert)+ 吐司 + 图标 ════════════════════════
// 底部弹出、可滚动;点遮罩 / Esc / × 关闭(noClose 的除外);按钮都 ≥44px。P2 会在这上面做更多组件;语义别改。
// 吐司只说「发生了一件需要知道的事」(撤销、出错);保存成功不弹。
export const ICON = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    chev: '<path d="M10 6l6 6-6 6"/>', back: '<path d="M15 5l-7 7 7 7"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', send: '<path d="M5 12h13M13 6l6 6-6 6"/>', arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>'
};
export function ico(n, cls) { return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`; }
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

let _seq = 0, _toastT = null;
// o = {id, title, text | html, actions[{label, primary, danger, keep, fn(ov)}], noClose, full, stack, under, onClose, onMount(ov), focus}
export function openSheet(o) {
    o = o || {};
    const id = o.id || ('sh' + (++_seq));
    closeSheet(id);
    const root = document.getElementById('sheet-root') || document.body;
    const ov = document.createElement('div');
    ov.className = 'sheet-ov' + (o.under ? ' under' : ''); ov.id = id;
    if (o.noClose) ov.dataset.noesc = '1';
    ov.innerHTML = `<div class="sheet${o.full ? ' full' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
        <div class="sheet-h"><h2 class="sheet-t" id="${id}-t"></h2>${o.noClose ? '' : `<button type="button" class="sheet-x" aria-label="关闭">${ico('x')}</button>`}</div>
        <div class="sheet-b${o.text ? ' text' : ''}"></div><div class="sheet-actions${o.stack ? ' stack' : ''}"></div></div>`;
    ov.querySelector('.sheet-t').textContent = o.title || '';
    const bd = ov.querySelector('.sheet-b');
    if (o.html) bd.innerHTML = o.html; else if (o.text) bd.textContent = o.text;
    // 只认外层那条按钮栏(正文里自带的 .sheet-actions 排在前面,querySelector 会先找到它)
    const act = ov.querySelector(':scope > .sheet > .sheet-actions');
    (o.actions || []).forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : '');
        b.textContent = a.label;
        b.onclick = () => { if (!a.keep) closeSheet(id); if (a.fn) a.fn(ov); };
        act.appendChild(b);
    });
    if (!(o.actions || []).length) act.remove();
    const done = () => { closeSheet(id); if (o.onClose) o.onClose(); };
    const x = ov.querySelector('.sheet-x'); if (x) x.onclick = done;
    if (!o.noClose) ov.addEventListener('click', e => { if (e.target === ov) done(); });
    ov._onClose = o.onClose;
    root.appendChild(ov);
    if (o.onMount) o.onMount(ov);
    setTimeout(() => { const f = ov.querySelector(o.focus || '.sheet-actions .btn-primary, .sheet-x'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { } }, 30);
    return ov;
}
export function closeSheet(id) { const el = document.getElementById(id); if (el) el.remove(); }
export function hasSheet(id) { return !!document.getElementById(id); }
export function sysAlert(msg, title) { openSheet({ title: title || '', text: String(msg), actions: [{ label: '知道了', primary: true }] }); }
export function sysConfirm(msg, onOk, opts) {
    opts = opts || {};
    openSheet({ title: opts.title || '', text: String(msg), actions: [{ label: opts.cancel || '取消', fn: opts.onCancel }, { label: opts.ok || '确定', primary: !opts.danger, danger: !!opts.danger, fn: onOk }] });
}
export function toast(msg, ms) {
    const t = document.getElementById('sync-toast-el'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), ms || 3000);
}
export function bindEscape() {
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const all = document.querySelectorAll('#sheet-root .sheet-ov');
        if (!all.length) return;
        const last = all[all.length - 1];
        if (!last.dataset.noesc) { last.remove(); if (last._onClose) last._onClose(); }
    });
}
export function download(name, body) {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
