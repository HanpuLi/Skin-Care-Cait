// ══ 今晚页:单步操作(健身 App「换 / 划掉」面板的对应物)+「问一句」(对应健身陪练 /api/quick)══════════════════════
// 【单步】点步骤右边的「调整」→ 一个 sheet:怎么用 / 为什么 · 今晚不用这步 · 换成货架上的… · 让顾问挑(/api/swap)· 问顾问(预填进对话,不自动发)。
//   所有改动都写进今晚修订线(sk_tnai1,ai/apply.js applyTonight)—— 和顾问 change_tonight 同一套撤销 / 重做;她自己点的带 by:'user',
//   修订条标「你改了今晚」;「让顾问挑」选出来的是顾问的改动,标顾问。
//   【闸】不另写一套:候选和落地都走 ai/apply.js 的 validateTonight(顾问写今晚用的同一道),再把「假如这么改,今晚会是什么样」交给
//   shownTonight 跑一遍(叠改 → gateTonightPlan 过闸 → 保湿补位…),候选必须真的排得进去;落地后再核一遍,对不上就当场撤回。
//   打了勾 / 已经做完的步骤是事实,不给改(keepDone 也会把它放回来)。极简模式:一样能调整,不加打卡、不催。
//   没登录 / 没开通顾问(app.ai.access() !== 'on')时「让顾问挑」「问顾问」「问一句」都不出现。
// 【问一句】今晚页上的小面板:带今晚实时状态(哪些做了 / 没做、现在几点、她眼前那份步骤)发 /api/quick,边到边显示;
//   ≤60 字是后端提示词管的,这里不截断。quick 回了 change_today 类的 action,照对话那条路 applyTonight 生效并挂修订线。
//   状态只放内存(换账号 / 过零点清掉),不写任何存储。
import { prodByName, derive } from '../engine/util.js';
import { tonightOverride } from '../engine/rules.js';
import { safetyGate } from '../engine/gate.js';
import { applyTonight, undoTonightChange, validateTonight, shownTonight, tonightTicks } from '../ai/apply.js';
import { buildSkincareContext, liveContext } from '../ai/context.js';
import { esc, toast, openSheet, closeSheet, hasSheet } from './sheets.js';
import { askAdvisor, dataNoticeSeen, openDataNotice } from './advisor.js';

const SHEET = 'step-ops';
const REASONS = [['used_up', '用完了'], ['uncomfortable', '刺痛 / 不舒服'], ['dont_want', '不想用']];
const Q = { q: '', ans: '', err: '', busy: false, date: '', owner: '' };
let pickBusy = false;

const ownerOf = app => (app.store && app.store.state && app.store.state.owner) || '';
const aiOn = app => { try { return !!app.ai && app.ai.access() === 'on'; } catch (e) { return false; } };
const hm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const doneToday = W => { const en = (W.journal || []).find(e => e && e.date === W.today); return !!(en && en.done); };
const userName = app => { const u = app.sync && app.sync.state && app.sync.state.user; return u && u.displayName ? String(u.displayName).split(' ')[0] : ''; };
export function setQuickDraft(v) { Q.q = String(v || '').slice(0, 120); }
export function resetStep() { Object.assign(Q, { q: '', ans: '', err: '', busy: false, date: '', owner: '' }); pickBusy = false; closeSheet(SHEET); }

// ── 假如再加这几条小改,今晚会是什么样(同一条流水线,不动存档)──
function sim(app, W, ops) {
    const cur = tonightOverride(W);
    const ov = { date: W.today, id: 'sim', ops: (cur ? cur.ops : []).concat(ops) };
    return shownTonight(derive(W, { tnai: ov }), app.aiTonightData(W));
}
const namesOf = sh => sh.steps.map(s => s.product).filter(Boolean);
// 同角色、货架上有、今晚能用的其他产品;每一个都过 validateTonight + 真的排得进去
function candidates(app, W, shown, name) {
    const cur = prodByName(W, name); if (!cur) return [];
    const g = safetyGate(W), names = namesOf(shown), out = [];
    (W.products || []).forEach(p => {
        if (p.role !== cur.role || p.name === name || p.hidden || names.indexOf(p.name) >= 0) return;
        if (((p.schedule && p.schedule.time) || ['pm']).indexOf('pm') < 0) return;   // 只在早上用的不往晚上排
        const op = { op: 'swap', product: name, to: p.name };
        if (validateTonight(op, g, names, W)) return;
        let s2; try { s2 = sim(app, W, [Object.assign({ by: 'user' }, op)]); } catch (e) { return; }
        const n2 = namesOf(s2);
        if (n2.indexOf(p.name) < 0 || n2.indexOf(name) >= 0) return;
        out.push(p);
    });
    return out;
}
// 写进修订线并核对落地;返回 '' = 生效了,否则是原因(已撤回)
function change(app, c) {
    const t = app.today();
    const r = applyTonight(app.store, { id: 'u' + app.store.now(), changes: [c] }, t, { aiData: app.aiTonightData(app.world()) });
    if (!r || r.state !== 'applied') return ((r && r.result) || []).filter(Boolean)[0] || '没改成';
    const sh = app.shownTonight(app.world()), names = namesOf(sh);
    const ok = c.op === 'skip' ? names.indexOf(c.product) < 0 : (names.indexOf(c.to) >= 0 && names.indexOf(c.product) < 0);
    if (ok) return '';
    undoTonightChange(app.store, r.id, t);
    const b = (sh.blocked || []).concat(sh.skips || []).find(x => x.product === (c.to || c.product));
    return (b && b.why) || '今晚的规则排不进去';
}

// ══ 单步 sheet ════════════════════════════════════════════════════════════════════════════
// st = tonight.js model 里的那一步 {name, role, how, why, kind}
export function openStepSheet(app, st) {
    const W = app.world(), shown = app.shownTonight(W);
    const name = st.name, idx = namesOf(shown).indexOf(name);
    if (idx < 0 || !prodByName(W, name)) return;
    const ticked = tonightTicks(W).done.has(name), fin = doneToday(W);
    const locked = ticked ? '这一步已经打了勾，要改先把勾取消。' : fin ? '今晚已经做完了，不再改。' : '';
    let canSkip = false, cands = [];
    if (!locked) {
        try { canSkip = namesOf(sim(app, W, [{ by: 'user', op: 'skip', product: name }])).indexOf(name) < 0; } catch (e) { canSkip = false; }
        cands = candidates(app, W, shown, name);
    }
    const ai = aiOn(app);
    const info = [['怎么用', st.how], ['为什么', st.why]].filter(x => x[1]).map(([k, v]) => `<div class="sa-i"><span class="sa-k">${k}</span><span class="sa-v">${esc(v)}</span></div>`).join('');
    let h = `<p class="meta sa-role">${esc(st.role || '')}${st.role ? ' · ' : ''}第 ${idx + 1} 步</p>${info ? `<div class="sa-info">${info}</div>` : ''}`;
    if (locked) h += `<p class="note sa-lock">${esc(locked)}</p>`;
    else {
        h += '<div class="sa-acts">';
        if (canSkip) h += '<button type="button" class="btn btn-block" data-sa="skip" id="sa-skip">今晚不用这步</button>';
        else h += '<p class="note">这一步今晚是安全规则排的，划不掉。</p>';
        if (cands.length) h += `<details class="fold sa-fold" id="sa-swap"><summary>换成货架上的…</summary><div class="fold-body sa-list">${cands.map(p => `<button type="button" class="btn btn-block sa-cand" data-sa="swap" data-to="${esc(p.name)}"><span class="sa-cn">${esc(p.name)}</span>${(W.low || []).indexOf(p.id) >= 0 ? '<span class="note">快用完</span>' : ''}</button>`).join('')}</div></details>`;
        if (ai) h += `<div class="sa-pick"><span class="sa-k">让顾问挑一支换</span><div class="chips" role="group" aria-label="为什么要换" id="sa-reasons">${REASONS.map(([k, l]) => `<button type="button" class="chip" data-sa="reason" data-r="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
            <label class="field"><span>想补一句？（选填）</span><input type="text" id="sa-note" maxlength="80" autocomplete="off"></label>
            <button type="button" class="btn btn-block" data-sa="pick" id="sa-pick">让顾问挑</button></div>`;
        h += '</div>';
    }
    if (ai) h += '<button type="button" class="btn-link sm sa-chat" data-sa="chat" id="sa-chat">问顾问</button>';
    h += '<p class="note sa-msg" id="sa-msg" aria-live="polite"></p>';
    const owner = ownerOf(app);
    openSheet({ id: SHEET, title: name, html: h, onMount: ov => {
        let reason = '';
        const msg = t => { const m = ov.querySelector('#sa-msg'); if (m) m.textContent = t || ''; };
        const sync = () => { const b = ov.querySelector('#sa-pick'); if (b) b.disabled = pickBusy; };
        ov.addEventListener('click', e => {
            const b = e.target.closest && e.target.closest('[data-sa]'); if (!b || !ov.contains(b)) return;
            const a = b.dataset.sa;
            if (ownerOf(app) !== owner) { closeSheet(SHEET); return; }
            if (a === 'reason') { reason = b.dataset.r; ov.querySelectorAll('[data-sa=reason]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); sync(); return; }
            if (a === 'skip' || a === 'swap') {
                const c = a === 'skip' ? { op: 'skip', product: name, why: '', by: 'user' } : { op: 'swap', product: name, to: b.dataset.to, why: '', by: 'user' };
                const why = change(app, c);
                if (why) { msg('没改成：' + why + '。'); return; }
                closeSheet(SHEET); app.renderAll(); return;
            }
            if (a === 'chat') { closeSheet(SHEET); askAdvisor(app, '今晚的「' + name + '」（' + (st.role || '第 ' + (idx + 1) + ' 步') + '）：'); return; }
            if (a === 'pick') {
                if (!reason) { msg('先选一个原因。'); return; }
                const note = String((ov.querySelector('#sa-note') || {}).value || '').trim().slice(0, 80);
                const go = () => pickSwap(app, name, reason, note, owner, msg, sync);
                if (dataNoticeSeen(app)) go(); else openDataNotice(app, go);
            }
        });
    } });
}
// 让顾问挑:/api/swap → 顾问给的候选按顺序过闸,第一支排得进去的直接生效(带顾问的理由)
async function pickSwap(app, name, reason, note, owner, msg, sync) {
    if (pickBusy || !reason) return;
    const ai = app.ai;
    pickBusy = true; sync(); msg('顾问在挑…');
    const fail = t => { msg(t); toast(t); };
    try {
        if (!ai.ready()) { try { await ai.probe(); } catch (e) { } }
        if (!ai.ready()) { fail(ai.state && ai.state.down ? '顾问连不上，先自己换吧。' : (ai.quotaText && ai.quotaText()) || '顾问还没开通。'); return; }
        const W = app.world(), shown = app.shownTonight(W);
        const ctx = buildSkincareContext(W, { name: userName(app), shown, ticked: [...tonightTicks(W).done] });
        const t0 = app.today();
        const r = await ai.api.swap(ctx, name, reason, note);
        if (ownerOf(app) !== owner || app.today() !== t0) return;   // 等的时候换了账号 / 过了零点:丢掉
        const opts = (r && r.data && r.data.options) || [];
        const W1 = app.world(), sh1 = app.shownTonight(W1);
        if (namesOf(sh1).indexOf(name) < 0) { fail('这一步今晚已经变了，没换。'); return; }
        const g = safetyGate(W1), names = namesOf(sh1);
        let why0 = '';
        for (const o of opts) {
            if (!o || !o.name) continue;
            const op = { op: 'swap', product: name, to: o.name };
            const v = validateTonight(op, g, names, W1);
            if (v) { why0 = why0 || '「' + o.name + '」' + v; continue; }
            const bad = change(app, Object.assign({ why: String(o.why || '').slice(0, 60) }, op));
            if (bad) { why0 = why0 || '「' + o.name + '」' + bad; continue; }
            if (hasSheet(SHEET)) closeSheet(SHEET); else toast('顾问把「' + name + '」换成了「' + o.name + '」');
            app.renderAll();
            return;
        }
        fail(opts.length ? '顾问挑的没过安全闸：' + why0 + '。' : '顾问没挑出能顶这一步的，货架上可能没有合适的。');
    } catch (e) {
        if (ownerOf(app) === owner) fail(e && e.message ? e.message : '顾问出错了。');
    } finally { pickBusy = false; sync(); }
}

// ══ 问一句 ════════════════════════════════════════════════════════════════════════════════
// 面板的 HTML(没登录 / 没开通 → '');状态从 Q 读,所以整屏重画也不丢字、不丢答案
export function quickHtml(app, t) {
    if (!aiOn(app)) return '';
    if (Q.date && (Q.date !== t || Q.owner !== ownerOf(app))) Object.assign(Q, { q: '', ans: '', err: '', busy: false, date: '' });
    return `<section class="tn-quick" id="tn-quick" aria-label="问顾问一句"><label class="qk-l" for="qk-q">问一句</label>
        <div class="qk-row"><input type="text" id="qk-q" maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="比如：刚涂完有点刺，要停吗？" value="${esc(Q.q)}">
        <button type="button" class="btn" data-act="qk-go" id="qk-go">${Q.busy ? '停一下' : '问'}</button></div>
        <p class="qk-a${Q.err ? ' err' : ''}" id="qk-a" aria-live="polite">${esc(Q.err || Q.ans || (Q.busy ? '顾问在想…' : ''))}</p></section>`;
}
function paintQuick() {
    const a = document.getElementById('qk-a'), b = document.getElementById('qk-go');
    if (a) { a.textContent = Q.err || Q.ans || (Q.busy ? '顾问在想…' : ''); a.classList.toggle('err', !!Q.err); }
    if (b) b.textContent = Q.busy ? '停一下' : '问';
}
// 带上今晚的实时状态:现在几点、她眼前那份步骤、哪些做了 / 没做(极简模式不打卡:只带「她点了今晚没做」的)
function liveOf(app, W, shown) {
    const tk = tonightTicks(W), minimal = !!(W.profile || {}).minimalMode, en = (W.journal || []).find(e => e && e.date === W.today);
    const steps = shown.steps.filter(s => s.product).map(s => s.product);
    const o = Object.assign({}, liveContext(W, shown), { now: hm(app.store.now()), tonightDone: !!(en && en.done), mode: minimal ? '极简（不打卡，排上的默认都用了）' : '完整' });
    if (minimal) o.notDone = [...tk.skipped];
    else Object.assign(o, { ticked: steps.filter(n => tk.done.has(n)), notYet: steps.filter(n => !tk.done.has(n) && !tk.skipped.has(n)), notDone: [...tk.skipped] });
    return o;
}
export async function askQuick(app) {
    const ai = app.ai;
    if (Q.busy) { try { ai.abort(); } catch (e) { } return; }   // 「停一下」
    if (!aiOn(app)) return;
    const el = document.getElementById('qk-q');
    const text = String(el ? el.value : Q.q).trim().slice(0, 120);
    if (!text) return;
    Q.q = text;
    if (!dataNoticeSeen(app)) { openDataNotice(app, () => askQuick(app)); return; }
    if (!ai.ready()) { try { await ai.probe(); } catch (e) { } }
    if (!ai.ready()) { Q.err = ai.state && ai.state.down ? '顾问连不上。' : (ai.quotaText && ai.quotaText()) || '顾问还没开通。'; Q.ans = ''; paintQuick(); return; }
    const owner = ownerOf(app), W = app.world(), t = W.today, shown = app.shownTonight(W);
    Object.assign(Q, { busy: true, ans: '', err: '', date: t, owner });
    paintQuick();
    const ctx = buildSkincareContext(W, { name: userName(app), shown, ticked: [...tonightTicks(W).done] });
    const res = await ai.api.quick({ messages: [{ role: 'user', text }], context: ctx, live: liveOf(app, W, shown) },
        txt => { if (ownerOf(app) !== owner || Q.date !== t) return; Q.ans = txt; paintQuick(); });
    if (ownerOf(app) !== owner || Q.date !== t) return;   // 等的时候换了账号 / 过了零点
    Q.busy = false;
    if (res.aborted) { Q.ans = res.text || ''; Q.err = ''; paintQuick(); return; }
    if (res.err && !res.text) { Q.err = res.err; Q.ans = ''; paintQuick(); return; }
    Q.ans = res.text || ''; Q.err = res.partial ? '没说完就断了，可以再问一次。' : '';
    // quick 回了 change_today:和对话里一样直接生效 + 挂修订线(同一道闸,同一套撤销)
    if (res.act && !(res.partial && !res.act)) {
        const r = applyTonight(app.store, res.act, app.today(), { aiData: app.aiTonightData(app.world()) });
        if (r && r.state === 'failed') Q.err = '顾问想改今晚，没过安全闸：' + (r.result || []).filter(Boolean).join('；') + '。';
        app.renderAll(); return;
    }
    paintQuick();
}
