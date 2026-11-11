// ══ 今晚页:单步操作(健身 App「换 / 划掉」面板的对应物)══════════════════════════════════════════
// 【单步】点步骤右边的「调整」→ 一个 sheet:怎么用 / 为什么 · 今晚不用这步 · 换成货架上的… · 让顾问挑(/api/swap)· 问顾问(预填进对话,不自动发)。
//   所有改动都写进今晚修订线(sk_tnai1,ai/apply.js applyTonight)—— 和顾问 change_tonight 同一套撤销 / 重做;她自己点的带 by:'user',
//   修订条标「你改了今晚」;「让顾问挑」选出来的是顾问的改动,标顾问。
//   【闸】不另写一套:候选和落地都走 ai/apply.js 的 validateTonight(顾问写今晚用的同一道),再把「假如这么改,今晚会是什么样」交给
//   shownTonight 跑一遍(叠改 → gateTonightPlan 过闸 → 保湿补位…),候选必须真的排得进去;落地后再核一遍,对不上就当场撤回。
//   打了勾 / 已经做完的步骤是事实,不给改(keepDone 也会把它放回来)。极简模式:一样能调整,不加打卡、不催。
//   没登录 / 没开通顾问(app.ai.access() !== 'on')时「让顾问挑」「问顾问」都不出现。
// 【问一句】(今晚页步骤下面的 /api/quick 小面板)11/10 拿掉了:顾问 tab 就是对话,今晚页再放一个输入框是重复(Cait「狠狠做」那一轮)。
//   单步 sheet 里的「问顾问」把这一步预填进顾问对话,问的口子还在。
import { prodByName, derive } from '../engine/util.js';
import { tonightOverride } from '../engine/rules.js';
import { safetyGate } from '../engine/gate.js';
import { applyTonight, undoTonightChange, validateTonight, shownTonight, tonightTicks } from '../ai/apply.js';
import { buildSkincareContext } from '../ai/context.js';
import { esc, toast, openSheet, closeSheet, hasSheet } from './sheets.js';
import { askAdvisor, dataNoticeSeen, openDataNotice } from './advisor.js';

const SHEET = 'step-ops';
const REASONS = [['used_up', '用完了'], ['uncomfortable', '刺痛 / 不舒服'], ['dont_want', '不想用']];
let pickBusy = false;

const ownerOf = app => (app.store && app.store.state && app.store.state.owner) || '';
const aiOn = app => { try { return !!app.ai && app.ai.access() === 'on'; } catch (e) { return false; } };
const doneToday = W => { const en = (W.journal || []).find(e => e && e.date === W.today); return !!(en && en.done); };
const userName = app => { const u = app.sync && app.sync.state && app.sync.state.user; return u && u.displayName ? String(u.displayName).split(' ')[0] : ''; };
// 换账号:关掉上一个人的单步面板(tonight.js resetForUser 调)
export function resetStep() { pickBusy = false; closeSheet(SHEET); }

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
    // 「第 2 步，修护」一句话,不用「修护 · 第 2 步」点号串联(Cait 不要那种排版)
    let h = `<p class="meta sa-role">第 ${idx + 1} 步${st.role ? '，' + esc(st.role) : ''}</p>${info ? `<div class="sa-info">${info}</div>` : ''}`;
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
