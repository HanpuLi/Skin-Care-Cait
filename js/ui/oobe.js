// ══ 新用户引导 + 改版说明 ═══════════════════════════════════════════════════════════════
// 引导(AUDIT-ux §4.4):一屏一个问题,每步都能跳过,进度存在档案里(profile.oobe.step,换设备 / 刷新接着走);
//   新账号从**空货架**起步(不灌内置的那批);做完记 oobeAt = 今天 → 安全闸「第一晚不上任何活性」(engine/gate.js firstNight)。
//   老账号(有日志 / 存过货架 / 引导过)不进引导。
// 改版说明:v2 第一次打开弹一次,已读按账号记在档案 tourV2(sk_profile1 里,不新增云键;另一台设备看过就不再弹);走过引导的新用户直接记已读。
// 什么时候弹(整合时 app.js 接):没登录 → 启动 1.8 秒后(onBoot);登录了 → 第一份服务器快照落地之后(onFirstSnapshot,用云端的档案判断)。
import { K } from '../store.js';
import { openSheet, closeSheet, hasSheet, esc, ico, toast } from './sheets.js';
import { loadProfile, updateProfile } from '../model/profile.js';
import { SHELF_MIGRATIONS, ROLE_LABEL } from '../model/products.js';
import { jrnlEntry, saveJrnl } from '../model/journal.js';
import { syncRegimen } from '../model/regimen.js';
import { applyPlan } from '../ai/apply.js';
import { buildSkincareContext } from '../ai/context.js';
import { dataNoticeSeen, openDataNotice } from './advisor.js';
import { openAddSheet, readLabelFromFile, holdShop } from './products.js';
import { MINIMAL_DESC, FULL_DESC, skinChipsHtml, bindSkinChips } from './settings.js';

export const OOBE_STEPS = ['welcome', 'invite', 'mode', 'shelf', 'skin', 'first'];
let O = null;   // 正在走的引导 {redo, step}

function curUser(app) { return (app.sync && app.sync.state && app.sync.state.user) || null; }
// 老账号 = 有真实痕迹(日志 / 自己存过的货架 / 引导过),不看迁移标记
export function hasLegacyData(store) {
    const P = loadProfile(store);
    return !!(((store.lg(K.jrnl) || []).length) || store.lg(K.prodDefs) || store.lg(K.prods) || P.onboarded);
}
// 要不要进引导:引导走到一半(档案里有进度)→ 接着走;否则只有全新账号才进(v1 在加了第一件产品后刷新就接不上了,这里补上)
export function oobePending(store) {
    const P = loadProfile(store);
    if (P.onboarded) return false;
    if (P.oobe && P.oobe.step) return true;
    return P.seedShelf !== true && !hasLegacyData(store);
}
export function oobeActive() { return !!O; }

export function startOobe(app, opts) {
    opts = opts || {};
    if (!opts.redo) {
        // 新档案:空货架 + 老货架迁移一律视为已跑(迁移只服务老账号)
        updateProfile(app.store, p => { p.seedShelf = false; if (!p.oobe) p.oobe = { step: 'welcome' }; });
        const mig = app.store.lg(K.mig) || [], all = SHELF_MIGRATIONS.map(m => m.id);
        if (all.some(id => mig.indexOf(id) < 0)) app.store.ls(K.mig, Array.from(new Set(mig.concat(all))));
    }
    const P = loadProfile(app.store);
    O = { redo: !!opts.redo, step: opts.redo ? 'mode' : ((P.oobe && P.oobe.step) || 'welcome') };
    holdShop(true);
    if (O.step === 'welcome' && curUser(app)) { advance(app); return; }
    if (!applies(app, O.step)) { advance(app); return; }
    paint(app);
}
function applies(app, s) {
    if (s === 'welcome') return !O.redo && !curUser(app);
    if (s === 'invite') return !O.redo && !!curUser(app) && app.ai.access() === 'none';
    if (s === 'shelf') return !(O.redo && (app.world().products || []).some(p => !p.hidden));
    return true;
}
function go(app, step) {
    O.step = step;
    if (!O.redo) updateProfile(app.store, p => { p.oobe = { step }; });
    paint(app);
}
function advance(app) {
    if (!O) return;
    let i = OOBE_STEPS.indexOf(O.step) + 1;
    while (i < OOBE_STEPS.length && !applies(app, OOBE_STEPS[i])) i++;
    if (i >= OOBE_STEPS.length) return finishOobe(app);
    go(app, OOBE_STEPS[i]);
}
export function refreshOobe(app) { if (O && hasSheet('oobe')) paint(app); }

function stepHtml(app) {
    const s = O.step, P = loadProfile(app.store), W = app.world();
    const skip = `<button type="button" class="btn-link quiet ob-skip" data-ob="skip">跳过</button>`;
    if (s === 'welcome') return { title: '护肤计划', html: `<p class="ob-lede">每晚告诉你该涂什么。<br>有个顾问可以问。</p>
        <div class="acts stack-acts"><button type="button" class="btn btn-primary" data-ob="login">用 Google 登录</button><button type="button" class="btn" data-ob="local">先在这台手机上试试</button></div>
        <p class="note">登录了换手机数据还在。不登录也能用，数据只存在这台设备上。</p>` };
    if (s === 'invite') return { title: '顾问是邀请制', html: `<p class="note">有邀请码填在这里。没有也没关系，先用基础版：没有顾问，今晚的步骤照常排。</p>
        <label class="field"><span>邀请码</span><input type="text" id="ob-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="ABCDE-FGHJK"></label>
        <div class="acts"><button type="button" class="btn" data-ob="skip">先用基础版</button><button type="button" class="btn btn-primary" data-ob="redeem">开通</button></div>` };
    if (s === 'mode') return { title: '你想怎么用？', html: `<div class="ob-choices" role="radiogroup" aria-label="你想怎么用">
        <button type="button" class="ob-choice" role="radio" data-ob="mode-min" aria-checked="${P.minimalMode === true}"><span class="lede">只要告诉我今晚做什么</span><span class="note">${esc(MINIMAL_DESC)}</span></button>
        <button type="button" class="ob-choice" role="radio" data-ob="mode-full" aria-checked="${P.minimalMode === false}"><span class="lede">我想记录、看变化</span><span class="note">${esc(FULL_DESC)}</span></button></div>
        <p class="note">以后在设置里随时能换。</p><div class="ob-foot">${skip}</div>` };
    if (s === 'shelf') {
        const live = (W.products || []).filter(p => !p.hidden);
        const canPhoto = app.ai.access() === 'on' && !!curUser(app);
        return { title: '家里有什么？', html: `<p class="note">一支一支加。有一支洁面、一支保湿，今晚就能排出来。</p>
            <div class="acts">${canPhoto ? `<label class="btn btn-primary file-btn">${ico('camera')}拍成分表<input type="file" accept="image/*" id="ob-photo"></label>` : ''}<button type="button" class="btn" data-ob="add">手动加</button></div>
            ${live.length ? `<div class="ob-list"><div class="sec-t">加好了 ${live.length} 件</div><div class="rows">${live.map(p => `<div class="row"><span class="row-main"><span class="lede">${esc(p.name)}</span></span><span class="note">${esc(ROLE_LABEL[p.role] || '还没选是什么')}</span></div>`).join('')}</div></div>` : ''}
            <div class="acts ob-next"><button type="button" class="btn${live.length ? ' btn-primary' : ''}" data-ob="next">${live.length ? '好了' : '稍后再说'}</button></div>` };
    }
    if (s === 'skin') return { title: '你的皮肤', html: `${skinChipsHtml(P)}
        <div class="set-sub"><div class="sec-t">现在有没有发红刺痛，或者在看医生、用药？</div><div class="chips" role="radiogroup" aria-label="现在的状况">
            <button type="button" class="chip" role="radio" data-ob="state-ok" aria-checked="${P.startState === 'ok'}">没有</button>
            <button type="button" class="chip" role="radio" data-ob="state-irritated" aria-checked="${P.startState === 'irritated'}">有发红刺痛</button>
            <button type="button" class="chip" role="radio" data-ob="state-care" aria-checked="${P.startState === 'care'}">在看医生 / 用药</button></div>
            ${P.startState === 'irritated' ? '<p class="note">记进今天了：这几晚只做清洁、保湿、修护，酸先不上。</p>' : P.startState === 'care' ? '<p class="note">记下了。医生开的药优先，护肤这边只做基础的几样；顾问也会看到这一条。</p>' : ''}</div>
        <div class="acts ob-next"><button type="button" class="btn btn-primary" data-ob="next">下一步</button></div><div class="ob-foot">${skip}</div>` };
    const ai = app.ai.ready();
    return { title: '生成第一版', html: `<p class="ob-lede">${ai ? '顾问会按你家里的东西和皮肤情况出第一版方案。' : '按你家里的东西和皮肤情况排第一版。'}</p>
        <p class="note">第一晚不上任何活性（酸、面膜、维 A），先看皮肤对基础的几样有没有反应。之后从每周 1 次温和酸起步，看反应一档档加。</p>
        <div class="acts stack-acts ob-next"><button type="button" class="btn btn-primary" data-ob="finish">好，看今晚</button></div>` };
}
// 同一个全屏 sheet 原地换内容(不关了重开:每点一下都重放一次滑入动画,还会丢滚动位置)
function paint(app) {
    if (!O) return;
    const idx = OOBE_STEPS.indexOf(O.step), st = stepHtml(app);
    const dots = `<div class="ob-dots" aria-hidden="true">${OOBE_STEPS.map((x, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div><p class="sr">第 ${idx + 1} 步，共 ${OOBE_STEPS.length} 步</p>`;
    const close = O.redo ? `<div class="ob-foot"><button type="button" class="btn-link quiet" data-ob="close">关掉</button></div>` : '';
    const html = `<div class="ob" data-step="${O.step}">${dots}${st.html}${close}</div>`;
    const ov = document.getElementById('oobe');
    if (ov && ov.querySelector('.sheet-b')) {
        const moved = ov.dataset.step !== O.step;
        ov.querySelector('.sheet-t').textContent = st.title;
        ov.querySelector('.sheet-b').innerHTML = html;
        ov.dataset.step = O.step;
        bind(ov, app);
        if (moved) { const sh = ov.querySelector('.sheet'); if (sh) sh.scrollTop = 0; const f = ov.querySelector('.ob .btn-primary, .ob [data-ob]'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { } }
        return;
    }
    openSheet({ id: 'oobe', title: st.title, full: true, noClose: true, under: true, html, onMount: o => { o.dataset.step = O.step; bind(o, app); } });
}
function bind(ov, app) {
    const t = app.today();
    ov.querySelectorAll('[data-ob]').forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.ob;
        if (a === 'skip' || a === 'next' || a === 'local') advance(app);
        else if (a === 'login') app.signIn();
        else if (a === 'close') { closeSheet('oobe'); O = null; holdShop(false); }
        else if (a === 'finish') finishOobe(app);
        else if (a === 'redeem') {
            const inp = ov.querySelector('#ob-code'), code = (inp && inp.value || '').trim();
            if (!code) { if (inp) inp.focus(); return; }
            try { await app.ai.redeem(code); toast('顾问开通了'); advance(app); } catch (e) { toast(e.message || '邀请码不对'); }
        } else if (a === 'mode-min' || a === 'mode-full') {
            const min = a === 'mode-min';
            updateProfile(app.store, p => { p.minimalMode = min; p.showJournal = !min; });
            app.renderAll(); advance(app);
        } else if (a === 'add') openAddSheet(app, { stay: true, onSaved: () => refreshOobe(app) });
        else if (a.indexOf('state-') === 0) {
            const v = a.slice(6);
            updateProfile(app.store, p => { p.startState = v; });
            // 「现在发红刺痛」是安全输入:第一次引导直接记进今天(安全闸当晚就生效);看医生的写进档案给顾问看。
            //   只撤引导自己加的那几个标签(今天她自己记的泛红是就医红线数的硬事实,不能被一个「没有」抹掉);
            //   「重新做引导」只改档案里的起点,不碰当天日志(她今天的记录在记录页改)。
            if (!O.redo) {
                const { list, en } = jrnlEntry(app.store, t, true);
                const mine = O.startTags || [];
                en.status = en.status.filter(x => mine.indexOf(x) < 0);
                O.startTags = [];
                if (v === 'irritated') ['泛红', '敏感'].forEach(x => { if (en.status.indexOf(x) < 0) { en.status.push(x); O.startTags.push(x); } });
                saveJrnl(app.store, list);
            }
            app.renderAll(); paint(app);
        }
    }));
    const ph = ov.querySelector('#ob-photo');
    if (ph) ph.addEventListener('change', () => { const f = ph.files && ph.files[0]; ph.value = ''; if (f) readLabelFromFile(app, f, { sheet: true, onSaved: () => refreshOobe(app) }); });
    const sk = ov.querySelector('.ob[data-step="skin"]');
    if (sk) bindSkinChips(sk, app, () => paint(app));
}
export async function finishOobe(app) {
    const redo = !!(O && O.redo);
    closeSheet('oobe'); O = null;
    const t = app.today();
    updateProfile(app.store, p => { p.onboarded = true; delete p.oobe; if (!redo) p.oobeAt = t; p.tour3 = true; p.tourIA = true; p.tourV2 = true; });
    // 重新做引导:不出「第一版」(货架、皮肤都没变就不该凭空多一版,也别把顾问方案那条「撤销」挤成 superseded);
    //   真有变化(模式改了这类)由启动维护按签名自己重出
    if (!redo) syncRegimen(app.store, '第一版：按家里现有的东西和你说的皮肤情况', true, t);
    app.renderAll();
    app.show('tonight');
    if (redo || !app.ai.ready() || !(app.world().products || []).some(p => !p.hidden)) { holdShop(false); return; }
    const owner = (app.store.state && app.store.state.owner) || '';
    const ask = async () => {
        try {
            const r = await app.ai.api.plan(buildSkincareContext(app.world(), {}), '新用户第一版：用「建立耐受」的思路，前两周只做清洁、保湿、防晒，之后温和酸每周 1 次起步，看反应再加。');
            if (((app.store.state && app.store.state.owner) || '') !== owner) return;   // 换了账号:丢掉
            const reg = applyPlan(app.store, (r && r.data) || {}, { model: r && r.model, cost: r && r.cost }, app.today());
            toast('顾问出了第一版方案 v' + reg.v + '，在「顾问」页能看、能撤销');
            app.renderAll();
        } catch (e) { /* 顾问没排成:离线第一版照用,不打扰 */ }
        holdShop(false);   // 引导里加的货架、第一版方案都不自动判断「要不要买」;她到产品页点「让顾问判断」
    };
    // 第一次请顾问之前先让她看到「顾问会看到什么」(点「知道了」再发)
    if (dataNoticeSeen(app)) await ask();
    else { holdShop(false); openDataNotice(app, () => { ask(); }); }
}

// ── 改版说明(v2)──
export function whatsNewCards(P) {
    const shave = !!(P && P.shaving);
    if (P && P.minimalMode) return [
        ['护肤品不用打卡', '排上的默认都算用了；哪一步没做，点一下「今晚没做」。'],
        ['想记皮肤就点「记一下皮肤」', '「记录」页顶上也能随时记一笔，一句话或一张照片。不记也不会催。'],
        ['顾问改了什么，直接生效', '今晚页和对话里各有一条修订线，哪边点「撤销」都是同一件事。'],
        ['洗澡在「顾问」页排', '「未来 7 晚」里每晚点一下，可以存成每周习惯。']];
    return [
        ['今晚由顾问写', '每一步带一句为什么；顾问连不上的时候照离线规则排，一样能用。'],
        ['顾问改了什么，直接生效', '今晚页和对话里各有一条修订线，哪边点「撤销」都是同一件事。'],
        ['「记录」顶上随时记一笔', '一句话或一张照片；「完成今晚」之后也进同一个记录。'],
        ['方案和未来 7 晚在「顾问」页', '为什么这么排、刷酸怎么一档档往前走、哪晚洗澡' + (shave ? '、刮胡' : '') + '，都在那里点。'],
        ['设置在右上角的印章里', '深浅色、洗澡习惯、刷酸时机、照片分析、数据说明都在那。']];
}
export function showWhatsNew(app, opts) {
    opts = opts || {};
    const P = loadProfile(app.store);
    if (!opts.force && (P.tourV2 || !hasLegacyData(app.store) || O || hasSheet('oobe') || hasSheet('whatsnew'))) return false;
    const done = () => { if (!loadProfile(app.store).tourV2) updateProfile(app.store, p => { p.tourV2 = true; }); };
    openSheet({ id: 'whatsnew', title: '这一版改了什么', html: `<div class="rows wn">${whatsNewCards(P).map((c, i) => `<div class="row"><span class="row-main"><span class="meta">${String(i + 1).padStart(2, '0')}</span><span class="lede">${esc(c[0])}</span><span class="note">${esc(c[1])}</span></span></div>`).join('')}</div>`,
        actions: [{ label: '知道了', primary: true, fn: done }], onClose: done });
    return true;
}

// ── 时机(整合时 app.js 接这两个)──
export function maybeOnboard(app) {
    if (O || hasSheet('oobe')) return false;
    if (oobePending(app.store)) { startOobe(app, {}); return true; }
    return showWhatsNew(app);
}
// 启动后:1.8 秒还没登录 → 按本机数据判断(离线 / Firebase 没加载 / 就是不登录)
// 兜底:sync.js 的 onFirstSnapshot 只在「第一份快照落地且本机没有待推的改动」时才调(新账号认领了本机的引导进度、
//   或离线改过东西,第一份快照会走待推分支提前返回,hook 不来)。所以这里另外每半秒看一眼:登录了 + 云端已经落地过一次
//   (sync.state.hydrated)→ 按同一套判断走一次(每个账号一次,和 hook 去重)。
let _watch = null;
const _settled = {};
export function onBoot(app) {
    // 从 Firebase SDK 有了结果(加载到 / 没加载到)之后再等 1.8 秒(SDK 改成第一屏之后才加载)
    Promise.resolve(app.firebaseReady).then(() => setTimeout(() => { if (!curUser(app)) maybeOnboard(app); }, 1800), () => { });
    if (!_watch) _watch = setInterval(() => {
        const u = curUser(app), st = app.sync && app.sync.state;
        if (u && !_settled[u.uid] && st && st.hydrated) settle(app);
    }, 500);
}
// 登录后第一份服务器快照落地:用云端档案判断
export function onFirstSnapshot(app) { setTimeout(() => settle(app), 600); }
function settle(app) {
    const u = curUser(app);
    if (!u || _settled[u.uid]) return;
    _settled[u.uid] = true;
    if (O) {
        if (!O.redo && !oobePending(app.store)) { closeSheet('oobe'); O = null; holdShop(false); return; }   // 云端是老账号:引导不用做了
        if (O.step === 'welcome') { const nx = () => { if (O && O.step === 'welcome') advance(app); }; app.ai.probe(true).then(nx, nx); }
        return;
    }
    maybeOnboard(app);
}
