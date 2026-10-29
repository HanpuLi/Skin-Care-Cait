// ══ 记录 ══════════════════════════════════════════════════════════════════════════════
// 顶部随时记一笔(一句话或一张照片),下面回看:今天记下的、近 14 天(含刷酸 / 洗澡 / 刮胡标记)、脸部热度、走势、
// HRT(只在本人开了 HRT 时)、历史。「完成今晚」「只记皮肤」「记一下皮肤」也进这里的同一个 sheet(openSkinSheet)。
// 记皮肤的 sheet:状态标签 + 脸部地图(11 区,只点区域)+ 照片 + 备注;关掉之后要顾问反馈(requestFeedback)。
// 【要紧】
//   · 状态标签只有她自己点了才写(就医红线只数状态标签);照片分析的建议只在她点「确认记上」后才写进标签 —— 照片分析不单独触发红线。
//   · 顾问反馈只在本机操作后调(sheet 关掉 / 记下一句 / 确认建议),按「这天记了什么」的签名去重,没变就不再花钱;同步来的改动不触发。
//   · 极简模式从不催:不出提醒、不标「没记」,只给一个明确的入口。
// 约定:render(app) 返回 HTML 字符串;mount(root, app) 挂事件。写入走 model/journal.js 的函数;顾问反馈存进 sk_ai1.feedback[日期](和 v1 同一个形状)。
import { K } from '../store.js';
import { addDays, mdOf, dowOf } from '../clock.js';
import { tagLabel, TREND_TAGS, SYMPTOM_TAGS, trendOf, FACE_ZONES, FACE_ZONE_NAMES, SPOT_TYPES, FM_TRIGGER, cleanSpots,
         jrnlEntry, saveJrnl, setTrend, toggleSym, setSpots, setNote, deleteEntry } from '../model/journal.js';
import { dayState } from '../model/week.js';
import { acidTags } from '../engine/util.js';
import { safetyGate } from '../engine/gate.js';
import { buildSkincareContext } from '../ai/context.js';
import { openSheet, closeSheet, toast, esc, ico, sysConfirm } from './sheets.js';
import { dataNoticeSeen, openDataNotice, invalidateChatCtx } from './advisor.js';
import { faceHtml, bindFace, spotsByZone, heatData, heatTone } from './facemap.js';
import { openCapture, canAnalyze, analyzeBlocked, photoAnalysisOn, addSimplePhoto, loadDayPhoto, applySuggest, suggestText } from './capture.js';

export const id = 'record';
export const title = '记录';
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const TRENDS = [['better', '好些'], ['same', '差不多'], ['worse', '差些']];
const TREND_TONE = { better: 'ok', same: 'hollow', worse: 'caution' };
const AUTO_NOTE = '（按当天计划推定）';

// 模块里的界面状态(只是展开 / 选中这类,不是记录)
const ui = { draft: '', parsed: null, heatSel: '', histN: 10, fmOpen: {}, fmSel: {} };
const fb = { busy: {}, err: {} };   // 顾问反馈:跑着 / 出错(出错只留在本机内存,不进云)
// 换账号:上一个人的草稿、一句话解析(按日期存的,不按账号)、地图展开、反馈状态都清掉(app.js clearLocalExtras 调)
export function resetForUser() {
    Object.assign(ui, { draft: '', parsed: null, heatSel: '', histN: 10, fmOpen: {}, fmSel: {} });
    fb.busy = {}; fb.err = {}; fb.again = '';
}
const ownerOf = app => (app.store && app.store.state && app.store.state.owner) || '';
const aiOn = app => !!(app.ai && app.ai.access() === 'on' && !(app.ai.state && app.ai.state.down));
// 记完 / 做完之后顾问会不会自动回一句:开通了、连得上,而且这台设备上看过「顾问会看到什么」(没看过不自动外发)
export function feedbackOn(app) { try { return aiOn(app) && dataNoticeSeen(app); } catch (e) { return false; } }

// ── 小工具 ──
function entryOf(W, date) { return (W.journal || []).find(e => e && e.date === date) || null; }
function noteOf(en) { const n = (en && en.note) || ''; return n === AUTO_NOTE ? '' : n; }
export function hasLog(en) { return !!(en && (((en.status || []).length) || cleanSpots(en.spots).length || noteOf(en) || en.photoAssess)); }
function hm(iso) { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function dayLabel(date, today) { return date === today ? '今天' : date === addDays(today, -1) ? '昨天' : mdOf(date) + ' ' + WEEK[dowOf(date)]; }
function whoOf(app) { const u = app.sync && app.sync.state && app.sync.state.user; return { name: u && u.displayName ? String(u.displayName).split(' ')[0] : '' }; }
function tagsHtml(en) {
    const st = (en && en.status) || [], tr = trendOf(en);
    const out = [];
    if (tr) out.push(`<span class="tag"><i class="dot ${TREND_TONE[tr]}"></i>${esc(tagLabel(TREND_TAGS[tr]))}</span>`);
    SYMPTOM_TAGS.filter(t => st.indexOf(t) >= 0).forEach(t => out.push(`<span class="tag">${esc(tagLabel(t))}</span>`));
    return out.join('');
}
function spotsText(spots) { const by = spotsByZone(spots); return Object.keys(by).map(z => z + '：' + by[z].join('、')).join('；'); }

// ══ 顾问反馈 ═════════════════════════════════════════════════════════════════════════
// 后端 POST /api/feedback {context, session{date,status[],note,used[],spots[],photo?,ticked[]}} → {text, note_add, next_adjust[], dropped}
function sessionOf(W, date) {
    const en = entryOf(W, date) || {};
    const tn = W.tnsteps || {};
    const s = { date, status: en.status || [], note: noteOf(en), used: en.products || [], spots: cleanSpots(en.spots), done: !!en.done,
                ticked: tn.date === date ? (tn.done || []).slice(0, 20) : [], notDone: (en.skipped || []).slice(0, 8) };
    if (en.photoAssess && en.photoAssess.usable !== false) s.photo = { overall: en.photoAssess.overall || '', vs_last: en.photoAssess.vs_last || '' };
    return s;
}
function sessionSig(s) { return JSON.stringify([s.status.slice().sort(), s.note, s.spots.map(x => x.zone + x.type).sort(), s.photo ? s.photo.overall : '', s.done]); }
export function feedbackOf(W, date) { const f = ((W.ai || {}).feedback || {})[date]; return f && !f.err ? f : null; }
// 本机操作之后调:sheet 关掉、记下一句、确认建议、完成今晚。opts.force = 「再试一次」
export async function requestFeedback(app, date, opts) {
    opts = opts || {};
    const ai = app.ai;
    if (!ai || date !== app.today() || ai.access() !== 'on') return false;
    if (!opts.force && !dataNoticeSeen(app)) return false;   // 还没看过「顾问会看到什么」:不自动外发
    if (!ai.ready()) {
        try { await ai.probe(); } catch (e) { }
        if (!ai.ready()) {
            const me = ai.state && ai.state.meErr;   // 她点了「再试一次」:说清楚为什么没成,别静默
            if (opts.force && me) { fb.err[date] = me.code === 401 ? '顾问没认出你的登录，到「设置」里退出再登录' : (ai.state.down ? '顾问暂时连不上，记录照常存着。' : me.message || '顾问出错了'); paintFeedback(app, date); }
            return false;
        }
    }
    let W = app.world();
    const en = entryOf(W, date);
    if (!hasLog(en) && !(en && en.done)) return false;
    const session = sessionOf(W, date), sig = sessionSig(session);
    const prev = feedbackOf(W, date);
    // v1 写的反馈没有 sig:有字、没出错就当有效(不然本机一次操作就重调一次、花钱,还把 v1 的 noteSaved 冲掉)
    if (!opts.force && prev && (prev.sig === sig || (!prev.sig && prev.text))) return false;
    const owner = ownerOf(app);
    if (fb.busy[date]) { fb.again = date; return false; }
    fb.busy[date] = true; delete fb.err[date];
    paintFeedback(app, date);
    let f = null;
    try {
        const r = await ai.api.feedback(buildSkincareContext(W, Object.assign(whoOf(app), { ticked: session.ticked, shown: app.shownTonight ? app.shownTonight(W) : null })), session);
        const d = (r && r.data) || {};
        f = { text: String(d.text || ''), note_add: String(d.note_add || ''), next_adjust: Array.isArray(d.next_adjust) ? d.next_adjust.slice(0, 4) : [],
              sig, at: new Date(app.store.now()).toISOString(), meta: { model: r && r.model, cost: r && r.cost } };
    } catch (e) { fb.err[date] = (e.code === 0 && !e.aborted ? (e.message || '顾问暂时连不上。') + '记录照常存着。' : e.message) || '顾问出错了'; }
    if (ownerOf(app) !== owner) return false;   // 等回答的时候换了账号:丢掉(resetForUser 已经清了 fb)
    fb.busy[date] = false;
    if (f && date === app.today()) {
        const st = app.store.lg(K.ai) || {};
        st.feedback = st.feedback || {};
        const old = st.feedback[date];
        if (old && old.noteSaved && old.note_add && old.note_add === f.note_add) f.noteSaved = true;   // 同一句已经加过了:别再出按钮
        st.feedback[date] = f;
        Object.keys(st.feedback).sort().slice(0, -7).forEach(k => delete st.feedback[k]);   // 只留最近 7 天
        app.store.ls(K.ai, st);
    }
    paintFeedback(app, date);
    app.renderScreen();
    if (fb.again === date) { fb.again = ''; return requestFeedback(app, date); }
    return !!f;
}
export function feedbackHtml(app, date) {
    if (!app.ai || date !== app.today() || app.ai.access() !== 'on') return '';
    const W = app.world(), f = feedbackOf(W, date);
    if (fb.busy[date]) return '<p class="note fb-busy">顾问在看今天的记录…</p>';
    if (fb.err[date]) return `<p class="note">顾问这次没回上：${esc(fb.err[date])}</p><button type="button" class="btn-link sm" data-fb-act="retry">再试一次</button>`;
    if (!f) return '';
    const adj = f.next_adjust || [];
    const en = entryOf(W, date);
    const added = !!(f.note_add && (f.noteSaved || noteOf(en).indexOf(f.note_add) >= 0));
    return `<div class="fb"><span class="fb-who">顾问${f.at ? ' · ' + esc(hm(f.at)) : ''}</span><p class="fb-text">${esc(f.text)}</p>`
        + (adj.length ? `<ul class="list note fb-adj">${adj.map(x => `<li>${esc(x.item || '')}${x.change ? '：' + esc(x.change) : ''}${x.why ? '<span class="faint">。' + esc(x.why) + '</span>' : ''}</li>`).join('')}</ul>` : '')
        + (f.note_add && !added ? `<button type="button" class="btn-link sm quiet" data-fb-act="note">把「${esc(f.note_add)}」加进今天的记录</button>` : '')
        + '</div>';
}
function paintFeedback(app, date) {
    document.querySelectorAll(`[data-fb-date="${date}"]`).forEach(el => { el.innerHTML = feedbackHtml(app, date); });
}
// 反馈块里的按钮(页面和 sheet 共用):委托在 document 上挂一次
let _fbBound = false;
function bindFeedback(app) {
    if (_fbBound) return; _fbBound = true;
    document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('[data-fb-act]');
        if (!b) return;
        const box = b.closest('[data-fb-date]'); if (!box) return;
        const date = box.dataset.fbDate;
        if (b.dataset.fbAct === 'retry') requestFeedback(app, date, { force: true });
        else if (b.dataset.fbAct === 'note') {
            const f = feedbackOf(app.world(), date); if (!f || !f.note_add) return;
            const en = entryOf(app.world(), date), cur = noteOf(en);
            const next = cur ? cur + '；' + f.note_add : f.note_add;
            setNote(app.store, date, next);
            // 和 v1 同一个标记:v1 设备靠它不再出按钮(不然同一句会被再追加一次)
            const st = app.store.lg(K.ai) || {};
            if (st.feedback && st.feedback[date]) { st.feedback[date].noteSaved = true; app.store.ls(K.ai, st); }
            // 记皮肤的 sheet 正开着:输入框和它的基准一起换成新的,关 sheet 时才不会拿旧文盖回去
            const nt = document.getElementById('sk-note');
            if (nt && nt.dataset.date === date) { nt.value = next; nt.dataset.n0 = next; }
            app.renderAll(); paintFeedback(app, date);
        }
    });
}

// ══ 一句话 → 看出了什么(本机,不花钱;只是建议,她点「就这样记上」才写)══════════════════════════════
const NEG = /(不|没有|没|无|别|未)$/;
const SENT_TAGS = [
    ['泛红', /泛红|发红|红了|红血丝|有点红|很红/g],
    ['爆痘', /痘(?!印)|爆了|冒了|红肿/g],
    ['闭口', /闭口|粉刺|小疙瘩|白头/g],
    ['干燥', /干(?!净)|起皮|脱皮|紧绷/g],
    ['敏感', /刺痛|刺刺|发痒|痒|灼热|疼/g],
    ['出油', /出油|油光|很油|泛油|油了|好油/g]
];
const SENT_TREND = [['better', /好些|好多了|好一点|好了点|改善|干净了|消了|退了/g], ['worse', /变差|更差|差些|严重了|更糟|加重/g]];
const SENT_ZONES = [
    [['额头'], /额头|脑门/], [['发际线'], /发际/], [['眉间'], /眉间|眉心/], [['鼻子'], /鼻子|鼻翼|鼻头|鼻梁/], [['人中/鼻下'], /人中|鼻下/],
    [['口周'], /口周|嘴角|嘴边|嘴周|嘴巴周/], [['下巴'], /下巴/], [['左脸颊'], /左脸|左边脸|左颊/], [['右脸颊'], /右脸|右边脸|右颊/],
    [['左脸颊', '右脸颊'], /两颊|脸颊|两边脸/], [['左下颌线'], /左下颌|左边下颌/], [['右下颌线'], /右下颌|右边下颌/], [['左下颌线', '右下颌线'], /下颌/, /[左右]边?下颌/g]
];
const SENT_SPOT = [['红痘', /痘(?!印)|红肿/], ['闭口', /闭口|粉刺|白头/], ['脓头', /脓/], ['泛红', /泛红|发红|红了|红血丝|有点红|很红/], ['干皮', /起皮|脱皮|干皮/], ['痘印', /痘印/]];
// 【不用后行断言】Safari 16.4 之前不认 (?<…),模块顶层的正则一写错整个 App 都打不开(README 支持到 iOS 15.4)。
//   「闭口痘」不算新痘、「痘痘」不重复:判断前先把这两种说法换掉,再用前向断言排除「痘印」
const pre = x => String(x || '').replace(/闭口痘/g, '闭口').replace(/痘痘/g, '痘');
const GONE = /^.{0,2}?(消了|退了|没了|好了|好多了|好些了|好点了|下去了|不见了)/;   // 「下巴的痘消了」:说的是好了,不是又冒了
function hit(text, re) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
        const end = m.index + m[0].length;
        if (!NEG.test(text.slice(Math.max(0, m.index - 2), m.index)) && !GONE.test(text.slice(end, end + 5))) return true;
        if (!re.global) break;
    }
    return false;
}
// 位置按「分句」配:同一个分句里提到的区和情况才配成一对(「下巴两颗红痘，额头有点干」→ 只有下巴:红痘,不会配出额头:红痘)
const CLAUSE = /[，。；！？,.;!?\n]|还有|而且|但是|不过/;
export function parseSentence(text) {
    const s = pre(text);
    const tags = SENT_TAGS.filter(([, re]) => hit(s, re)).map(([t]) => t);
    const tr = SENT_TREND.find(([, re]) => hit(s, re));
    const spots = [];
    s.split(CLAUSE).forEach(cl => {
        if (!cl || !cl.trim()) return;
        const zones = [];
        // 第三项 = 先抹掉的说法(「左下颌 / 右边下颌」已经由前面单边那两条配上了,不再配成两边)
        SENT_ZONES.forEach(([names, re, minus]) => { if (re.test(minus ? cl.replace(minus, '') : cl)) names.forEach(n => { if (zones.indexOf(n) < 0) zones.push(n); }); });
        if (!zones.length) return;
        const types = SENT_SPOT.filter(([, re]) => hit(cl, re)).map(([t]) => t);
        zones.forEach(z => types.forEach(t => spots.push({ zone: z, type: t })));
    });
    return { tags, trend: tr ? tr[0] : '', spots: cleanSpots(spots).slice(0, 6) };
}
// ══ 记皮肤的 sheet(「完成今晚」之后 / 只记皮肤 / 极简「记一下皮肤」/ 记录页某一天)══════════════════════
// opts = {date, mode:'done'|'skin'|'day', hint:{tags[], trend, spots[]}(照片分析或一句话看出来的,只做标记不写), summary}
export function openSkinSheet(app, opts) {
    opts = opts || {};
    bindFeedback(app);
    const t = app.today(), date = opts.date || t;
    if (date > t) return null;
    const P = app.world().profile || {}, minimal = !!P.minimalMode;
    const mode = opts.mode || (date === t ? 'skin' : 'day');
    const hint = opts.hint || {};
    const key = 'sk|' + date;
    const title = mode === 'done' ? '今晚做完了' : date !== t ? dayLabel(date, t) + '的皮肤' : minimal ? '记一下皮肤' : '今天皮肤';
    const lead = mode === 'done' ? (opts.summary || '') : (minimal && date === t ? '想记就记，不记也没关系。' + (feedbackOn(app) ? '记完顾问会看一眼。' : '') : '');
    const en0 = entryOf(app.world(), date) || {};
    const showFb = date === t && aiOn(app);
    // 还没看过「顾问会看到什么」:反馈不会自动发 —— 在顾问那一格里给「先看一下」,看完再要这一次反馈(和今晚页同一套)
    const fbNotice = showFb && !dataNoticeSeen(app);
    const html = `${lead ? `<p class="note sk-lead">${esc(lead)}</p>` : ''}<div id="sk-top"></div>
        ${P.hrt ? `<label class="field feat-hrt"><span>HRT 阶段</span><input type="text" id="sk-phase" value="${esc(en0.phase || '')}" placeholder="比如：第 3 个月、剂量调整" autocomplete="off"></label>` : ''}
        <label class="field"><span>备注（选填）</span><textarea id="sk-note" rows="2" placeholder="今天有什么特别的？" data-date="${esc(date)}" data-n0="${esc(noteOf(en0))}">${esc(noteOf(en0))}</textarea></label>
        ${showFb ? `<div class="sk-sec"><div class="sec-t">顾问</div>${fbNotice ? `<p class="note" id="sk-fb-notice">顾问看了会回一句；先看一下它会看到什么。 <button type="button" class="btn-link sm" id="sk-fb-notice-b">先看一下</button></p>` : ''}<div class="fb-box" data-fb-date="${esc(date)}"></div></div>` : ''}
        ${hasLog(en0) || en0.done || (en0.products || []).length ? `<div class="sk-sec sk-del"><button type="button" class="btn-link sm quiet" id="sk-del">删掉这一天的记录（连同这台设备上的照片）</button></div>` : ''}`;
    const p0 = en0.phase || '';
    let closed = false;
    const finish = ov => {
        if (closed) return; closed = true;
        const store = app.store;
        const nt = ov.querySelector('#sk-note'), ph = ov.querySelector('#sk-phase');
        const en = entryOf(app.world(), date);
        // 只认她本人在这个 sheet 里改过的:和打开时的初值比,不和「现在的存档」比
        //   (sheet 开着时顾问的 note_add、另一台设备同步来的备注 / HRT 阶段,不能在关 sheet 时被旧文盖回去)
        if (nt) {
            const n0 = nt.dataset.n0 || '', v = nt.value.trim(), cur = noteOf(en);
            if (v !== n0) {
                // 她改了,存档也被别处改了:她在原文后面追加的那段接到存档后面;不是追加的,以她看着改的为准
                const merged = cur !== n0 && v.indexOf(n0) === 0 ? (cur + (cur && v.slice(n0.length).replace(/^[；;，,\s]+/, '') ? '；' : '') + v.slice(n0.length).replace(/^[；;，,\s]+/, '')) : v;
                if (merged !== cur) setNote(store, date, merged);
            }
        }
        if (ph && ph.value.trim() !== p0) { const r = jrnlEntry(store, date, true); r.en.phase = ph.value.trim().slice(0, 60); saveJrnl(store, r.list); }
        app.renderAll();
        if (date === t) {
            const en2 = entryOf(app.world(), date);
            if (hasLog(en2) || (mode === 'done' && en2 && en2.done)) {
                requestFeedback(app, date);
            }
        }
    };
    const ov = openSheet({ id: 'skin-sheet', title, html, actions: [{ label: '好', primary: true, fn: o => finish(o) }], onClose: () => finish(ov) });
    const top = ov.querySelector('#sk-top');
    const paint = () => {
        const W = app.world(), en = entryOf(W, date) || { status: [] };
        const st = en.status || [], tr = trendOf(en), spots = cleanSpots(en.spots), by = spotsByZone(spots);
        const hintTags = hint.tags || [], hintBy = spotsByZone(hint.spots || []);
        // 脸部地图:她自己点过展开 / 收起就听她的;没点过时 —— 有建议的位置就展开;完整模式标过位置、或勾了闭口 / 新痘 / 泛红这类就顺手展开;
        // 极简模式默认收起(入口一直在,不点也照常记)
        const open = ui.fmOpen[key] !== undefined ? !!ui.fmOpen[key]
            : (Object.keys(hintBy).length > 0 || (!minimal && (spots.length > 0 || st.some(x => FM_TRIGGER.indexOf(x) >= 0))));
        const sel = FACE_ZONE_NAMES.indexOf(ui.fmSel[key]) >= 0 ? ui.fmSel[key] : '';
        let h = `<div class="sk-sec"><div class="sec-t" id="sk-tl">${date === t ? '今天皮肤' : '这天皮肤'}</div>
            <div class="seg sk-trend" role="radiogroup" aria-labelledby="sk-tl">${TRENDS.map(([k, l]) =>
                `<button type="button" role="radio" aria-checked="${tr === k}" data-sk="trend" data-k="${k}" id="sk-tr-${k}"><i class="dot ${tr === k ? TREND_TONE[k] : 'hollow'}"></i>${l}${hint.trend === k && tr !== k ? '<span class="hint-t">建议</span>' : ''}</button>`).join('')}</div>
            <div class="chips sk-syms" role="group" aria-label="具体情况（可多选）">${SYMPTOM_TAGS.map(tg => {
                const on = st.indexOf(tg) >= 0, hn = !on && hintTags.indexOf(tg) >= 0;
                return `<button type="button" class="chip${hn ? ' hint' : ''}" aria-pressed="${on}" data-sk="sym" data-t="${tg}" id="sk-sym-${tg}"${hn ? ` aria-label="${esc(tagLabel(tg))}，顾问建议"` : ''}>${on ? ico('check', 'sm') : ''}${esc(tagLabel(tg))}${hn ? '<span class="hint-t">建议</span>' : ''}</button>`;
            }).join('')}</div></div>`;
        {
            h += `<div class="sk-sec sk-map"><button type="button" class="btn-link sm quiet" data-sk="fm" aria-expanded="${open}" aria-controls="sk-fm-box" id="sk-fm-t">标位置（可选，不点也照常记）${spots.length ? ' · 已标 ' + Object.keys(by).length + ' 处' : ''}${ico('chev', 'sm')}</button>`;
            if (open) {
                const marks = {}, label = {}, hn = {};
                FACE_ZONES.forEach(z => { marks[z.name] = by[z.name] ? by[z.name].length : ''; hn[z.name] = !!hintBy[z.name]; label[z.name] = z.name + (by[z.name] ? '，已标：' + by[z.name].join('、') : '，没标') + (hintBy[z.name] ? '，顾问建议：' + hintBy[z.name].join('、') : ''); });
                h += `<div id="sk-fm-box"><p class="note">点脸上的位置，再选是什么。左右按你自己的：图上右边是你的左脸。</p>` + faceHtml({ ns: 'sk', sel, marks, label, hint: hn, groupLabel: '脸部地图：点一个位置标出来' });
                if (sel) {
                    h += `<div class="fm-pick" role="group" aria-label="${esc(sel)}：是什么（可多选）"><div class="sec-t">${esc(sel)} · 是什么（可多选）</div><div class="chips">${SPOT_TYPES.map((ty, i) => {
                        const on = (by[sel] || []).indexOf(ty) >= 0, hs = !on && (hintBy[sel] || []).indexOf(ty) >= 0;
                        return `<button type="button" class="chip${hs ? ' hint' : ''}" aria-pressed="${on}" data-sk="spot" data-t="${ty}" id="sk-sp-${i}">${on ? ico('check', 'sm') : ''}${ty}${hs ? '<span class="hint-t">建议</span>' : ''}</button>`;
                    }).join('')}</div><div class="btn-row fm-pick-acts">${(by[sel] || []).length ? '<button type="button" class="btn-link sm quiet" data-sk="clearzone">清掉这一处</button>' : ''}<button type="button" class="btn-link sm" data-sk="zonedone">好</button></div></div>`;
                }
                if (spots.length) h += `<ul class="list note fm-sum">${Object.keys(by).map(z => `<li>${esc(z)}：${esc(by[z].join('、'))}</li>`).join('')}</ul>`;
                h += '</div>';
            }
            h += '</div>';
        }
        if (date === t) {
            const analyze = canAnalyze(app, W.profile);
            h += `<div class="sk-sec sk-photo"><div class="sk-photo-row"><img class="sk-thumb" id="sk-thumb" alt="今天的照片" hidden>
                ${analyze ? `<button type="button" class="btn" data-sk="capture">${ico('camera')}拍照分析</button>`
                    : `<label class="btn file-btn">${ico('camera')}加一张照片<input type="file" accept="image/*" id="sk-file" aria-label="加一张照片"></label>`}</div>
                ${en.photoAssess && en.photoAssess.usable !== false ? `<p class="note">照片分析：${esc(en.photoAssess.overall || '')}</p>` : ''}
                <p class="meta">照片只存在这台设备上 <button type="button" class="btn-link sm quiet" data-sk="delphoto" id="sk-delphoto" hidden>删掉照片</button></p></div>`;
        } else {
            // 以前的某一天:这台设备上有那天的照片才显示(能单独删掉照片,下次分析也就不会再拿它当「上一次」发出去)
            h += `<div class="sk-sec sk-photo" id="sk-photo-past" hidden><div class="sk-photo-row"><img class="sk-thumb" id="sk-thumb" alt="这天的照片" hidden></div>
                <p class="meta">照片只存在这台设备上 <button type="button" class="btn-link sm quiet" data-sk="delphoto" id="sk-delphoto" hidden>删掉照片</button></p></div>`;
        }
        const fid = document.activeElement && document.activeElement.id;
        top.innerHTML = h;
        if (fid) { const el = document.getElementById(fid); if (el) try { el.focus({ preventScroll: true }); } catch (e) { } }
        const img = top.querySelector('#sk-thumb');
        if (img) loadDayPhoto(app, date).then(u => { if (u && img.isConnected) { img.src = u; img.hidden = false; ['#sk-delphoto', '#sk-photo-past'].forEach(q => { const el = top.querySelector(q); if (el) el.hidden = false; }); } });
        const box = ov.querySelector(`[data-fb-date="${date}"]`); if (box) box.innerHTML = feedbackHtml(app, date);
    };
    const after = () => { app.renderAll(); paint(); };
    top.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('[data-sk]');
        if (!b) return;
        const a = b.dataset.sk, store = app.store;
        if (a === 'trend') { setTrend(store, date, b.dataset.k, t); after(); }
        else if (a === 'sym') { toggleSym(store, date, b.dataset.t, t); after(); }
        else if (a === 'fm') { ui.fmOpen[key] = b.getAttribute('aria-expanded') !== 'true'; if (!ui.fmOpen[key]) ui.fmSel[key] = ''; paint(); }
        else if (a === 'spot' || a === 'clearzone') {
            const zone = ui.fmSel[key]; if (!zone) return;
            const en = entryOf(app.world(), date);
            let sp = cleanSpots(en && en.spots);
            if (a === 'clearzone') { sp = sp.filter(s => s.zone !== zone); ui.fmSel[key] = ''; }
            else { const i = sp.findIndex(s => s.zone === zone && s.type === b.dataset.t); if (i >= 0) sp.splice(i, 1); else sp.push({ zone, type: b.dataset.t }); }
            setSpots(store, date, sp, t); after();
        }
        else if (a === 'zonedone') { ui.fmSel[key] = ''; paint(); }
        else if (a === 'delphoto') sysConfirm('删掉这一天存在这台设备上的照片？分析结果和记录留着。', async () => {
            const ok = await app.photos.remove(date);
            toast(ok ? '照片删掉了' : '照片没删掉：这台设备的本机照片存储用不了');
            app.renderAll(); paint();
        }, { ok: '删掉', danger: true });
        else if (a === 'capture') openCapture(app, { date, onChange: paint, onEdit: h2 => { closeSheet('capture-sheet'); Object.assign(hint, h2 || {}); ui.fmOpen[key] = true; paint(); } });
    });
    bindFace(top, 'sk', zone => { ui.fmSel[key] = ui.fmSel[key] === zone ? '' : zone; paint(); });
    top.addEventListener('change', e => {
        if (e.target && e.target.id === 'sk-file') {
            const f = e.target.files && e.target.files[0]; e.target.value = '';
            if (f) addSimplePhoto(app, date, f).then(ok => { if (ok) { toast('照片存好了，只在这台设备上'); paint(); } });
        }
    });
    const nb = ov.querySelector('#sk-fb-notice-b');
    if (nb) nb.addEventListener('click', () => openDataNotice(app, () => { const x = ov.querySelector('#sk-fb-notice'); if (x) x.remove(); if (hasLog(entryOf(app.world(), date)) || (entryOf(app.world(), date) || {}).done) requestFeedback(app, date); }));
    const del = ov.querySelector('#sk-del');
    if (del) del.addEventListener('click', () => sysConfirm('删掉 ' + mdOf(date) + ' 这一天的记录？这台设备上那天的照片、顾问对这一天的回应也一起删，删了就找不回来。', async () => {
        closed = true;   // 不再走「关 sheet 时保存备注 / 要反馈」
        deleteEntry(app.store, date);
        // 派生的也一起删:顾问对这一天的回应(sk_ai1.feedback)、今晚小改撤销用的备注原文(sk_tnai1.undo)、对话里拍着的快照
        forgetDay(app, date);
        let ok = true; try { ok = await app.photos.remove(date); } catch (e) { ok = false; }
        closeSheet('skin-sheet');
        toast(ok ? '这一天的记录删掉了' : '记录删掉了；照片没删掉（这台设备的本机照片存储用不了）');
        app.renderAll();
    }, { ok: '删掉', danger: true }));
    paint();
    return ov;
}

// 删掉某一天时一起清的派生数据(都同步上云,不清就还留在云端)
export function forgetDay(app, date) {
    const store = app.store;
    const st = store.lg(K.ai);
    if (st && st.feedback && st.feedback[date]) { const n = JSON.parse(JSON.stringify(st)); delete n.feedback[date]; store.ls(K.ai, n); }
    const tn = store.lg(K.tnai);
    if (tn && tn.date === date && tn.undo && (tn.undo.note !== undefined || tn.undo.noteAdded)) {
        const n = JSON.parse(JSON.stringify(tn)); delete n.undo.note; delete n.undo.noteAdded; store.ls(K.tnai, n);
    }
    delete fb.err[date]; delete fb.busy[date];
    try { invalidateChatCtx(app); } catch (e) { }
}
// ══ 记录页 ═══════════════════════════════════════════════════════════════════════════
export function render(app) {
    const W = app.world(), t = W.today, P = W.profile || {};
    const en = entryOf(W, t);
    const analyze = canAnalyze(app, P);
    let h = `<h1 class="page-title" id="record-h">${esc(title)}</h1>`;
    // ① 随时记一笔
    h += `<section class="rec-quick" aria-labelledby="rec-q-l"><label for="rec-q" id="rec-q-l" class="rec-q-l">今天皮肤怎么样？</label>
        <textarea id="rec-q" rows="2" placeholder="一句话就行，比如：下巴两颗红痘，T 区干净了点">${esc(ui.draft)}</textarea>
        <div class="rec-q-acts">${analyze ? `<button type="button" class="btn" data-act="capture">${ico('camera')}拍一张</button>`
            : `<label class="btn file-btn">${ico('camera')}拍一张<input type="file" accept="image/*" id="rec-file" aria-label="拍一张"></label>`}
            <button type="button" class="btn btn-primary" data-act="note" id="rec-q-go">记下</button></div>`;
    if (ui.parsed && ui.parsed.date === t) {
        h += `<div class="rec-parse" id="rec-parse" role="status"><span class="sec-t">从这句话里看出</span><p class="lede">${esc(suggestText(ui.parsed))}</p>
            <div class="btn-row"><button type="button" class="btn" data-act="parse-ok">就这样记上</button><button type="button" class="btn-link sm" data-act="parse-edit">改一下</button><button type="button" class="btn-link sm quiet" data-act="parse-no">不用</button></div></div>`;
    }
    h += `<button type="button" class="btn-link sm quiet" data-act="sheet" id="rec-more">加状态和位置</button></section>`;
    // ② 今天记下的
    h += `<section class="sec" id="rec-today"><div class="sec-h"><span class="sec-t">今天记下的</span>${hasLog(en) ? '<button type="button" class="btn-link sm quiet" data-act="sheet">改一下</button>' : ''}</div>`;
    // 照片(只存本机)哪怕只拍了一张、没记别的也要看得到:缩略图一直占位,读到了才显示
    if (hasLog(en)) {
        const tg = tagsHtml(en), sp = spotsText(en.spots), nt = noteOf(en);
        h += `<div class="rec-day"><div class="rec-day-main">${tg ? `<div class="tags">${tg}</div>` : ''}${sp ? `<p class="note">${esc(sp)}</p>` : ''}${nt ? `<p class="lede">${esc(nt)}</p>` : ''}
            ${en.photoAssess && en.photoAssess.usable !== false ? `<p class="note">照片分析：${esc(en.photoAssess.overall || '')}</p>` : ''}</div>
            <img class="rec-thumb" id="rec-thumb" alt="今天的照片" hidden></div>`;
    } else h += `<div class="rec-day"><div class="rec-day-main"><p class="note">${P.minimalMode ? '想记的时候，在上面写一句或拍一张就行。' : '今天还没记。'}</p></div><img class="rec-thumb" id="rec-thumb" alt="今天的照片" hidden></div>`;   // 极简从不催:不标「没记」
    h += `<div class="fb-box" data-fb-date="${esc(t)}">${feedbackHtml(app, t)}</div></section>`;
    // ③ 近 14 天(刷酸 / 洗澡 / 刮胡标记)
    const aT = acidTags(W), shaving = !!P.shaving;
    const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)).map(d => {
        const e = entryOf(W, d), ds = dayState(W, d);
        return { d, e, tr: trendOf(e), acid: !!(e && (e.products || []).some(x => aT.indexOf(x) >= 0)), shower: !!ds.shower, shave: shaving && !!ds.shave };
    });
    // 标记只画这 14 天里真出现过的那几行(没刷过酸就不留一行空格)
    const MK = [['acid', '酸', '「酸」是刷酸夜'], ['shower', '澡', '「澡」是洗澡'], ['shave', '刮', '「刮」是刮胡']].filter(([k]) => days.some(x => x[k]));
    // 记了但没选好坏的天(v1 形状的旧记录都是这种)画成灰实心点:出现过就在图例里写明「记了」,别被当成「差不多」
    const anyFaint = days.some(x => !x.tr && hasLog(x.e));
    h += `<section class="sec" id="rec-14"><div class="sec-h"><span class="sec-t">近 14 天</span><span class="legend"><span><i class="dot ok"></i>好些</span><span><i class="dot hollow"></i>差不多</span><span><i class="dot caution"></i>差些</span>${anyFaint ? '<span><i class="dot faint"></i>记了</span>' : ''}</span></div>
        <div class="d14" role="list">${days.map(x => {
            const st = x.tr ? tagLabel(TREND_TAGS[x.tr]) : hasLog(x.e) ? '记了' : (P.minimalMode ? '' : '没记');   // 极简不说「没记」
            const aria = dayLabel(x.d, t) + (st ? '：' + st : '') + [x.acid ? '刷了酸' : '', x.shower ? '洗澡' : '', x.shave ? '刮胡' : ''].filter(Boolean).map((v, i) => (i || st ? '，' : '：') + v).join('');
            return `<div class="d14-c${x.d === t ? ' today' : ''}" role="listitem" aria-label="${esc(aria)}"><i class="dot ${x.tr ? TREND_TONE[x.tr] : hasLog(x.e) ? 'faint' : 'none'}"></i>
                <span class="d14-n">${Number(x.d.slice(8, 10))}</span>${MK.map(([k, m]) => `<span class="d14-m">${x[k] ? m : '&nbsp;'}</span>`).join('')}</div>`;
        }).join('')}</div>
        <p class="note">${MK.length ? MK.map(m => m[2]).join('，') + '。' : ''}点下面的历史能补记或改某一天。</p></section>`;
    // ④ 脸部热度
    const hz = heatData(W.journal, t, addDays(t, -13));
    h += `<section class="sec" id="rec-heat"><div class="sec-h"><span class="sec-t">近 14 天常出现的位置</span></div>`;
    if (!Object.keys(hz).length) { ui.heatSel = ''; h += `<p class="note">还没在脸上标过位置。记皮肤时可以顺手标在脸上。</p>`; }
    else {
        const marks = {}, tone = {}, label = {};
        FACE_ZONES.forEach(f => { const n = (hz[f.name] || []).length; marks[f.name] = n || ''; tone[f.name] = heatTone(n); label[f.name] = f.name + '，近 14 天' + (n ? '有 ' + n + ' 天标过' : '没标过'); });
        const sel = FACE_ZONE_NAMES.indexOf(ui.heatSel) >= 0 ? ui.heatSel : '';
        const top = Object.keys(hz).sort((a, b) => hz[b].length - hz[a].length).slice(0, 4);
        h += faceHtml({ ns: 'heat', sel, marks, tone, label, heat: true, groupLabel: '近 14 天脸上各处标过几天：点一个位置看哪几天' })
            + `<p class="note">数字是近 14 天里标过几天，颜色越深越多。左右按你自己的：图上右边是你的左脸。</p>`
            + `<ul class="heat-top">${top.map(z => `<li><span class="lede">${esc(z)}</span><span class="bar"><i style="width:${Math.round(hz[z].length / 14 * 100)}%"></i></span><span class="meta">${hz[z].length} 天</span></li>`).join('')}</ul>`;
        if (sel) {
            const rows = hz[sel] || [];
            h += `<div class="fm-pick" role="status"><div class="sec-t">${esc(sel)} · ${rows.length ? '近 14 天 ' + rows.length + ' 天' : '近 14 天没标过'}</div>${rows.length ? `<ul class="list note">${rows.map(r => `<li>${esc(dayLabel(r.date, t))}：${esc(r.types.join('、'))}</li>`).join('')}</ul>` : ''}</div>`;
        }
    }
    h += '</section>';
    // ⑤ 走势:这周和上周,每样情况各几天
    const cnt = (from, to, tag) => (W.journal || []).filter(e => e && e.date >= from && e.date <= to && (e.status || []).indexOf(tag) >= 0).length;
    const wk0 = addDays(t, -6), wk1a = addDays(t, -13), wk1b = addDays(t, -7);
    const rows = ['变差', '好转'].concat(SYMPTOM_TAGS).map(tag => ({ tag, a: cnt(wk0, t, tag), b: cnt(wk1a, wk1b, tag) })).filter(r => r.a || r.b);
    h += `<section class="sec" id="rec-trend"><div class="sec-h"><span class="sec-t">走势 · 前 7 天 / 这 7 天</span></div>`;
    h += rows.length ? `<ul class="trend-rows">${rows.map(r => `<li><span class="lede">${esc(tagLabel(r.tag))}</span><span class="meta">${r.b} 天</span><span class="trend-arr" aria-hidden="true">${ico('arrow', 'sm')}</span><span class="meta">${r.a} 天</span><span class="note">${r.a < r.b ? '少了' : r.a > r.b ? '多了' : '一样'}</span></li>`).join('')}</ul>`
        : `<p class="note">记了几天之后，这里会显示每样情况是多了还是少了。</p>`;
    h += '</section>';
    // ⑥ HRT(只在本人开了 HRT 时)
    if (P.hrt) {
        const ph = (W.journal || []).filter(e => e && e.phase && e.date >= wk1a && e.date <= t).sort((a, b) => b.date.localeCompare(a.date));
        const g = safetyGate(W);
        h += `<section class="sec feat-hrt" id="rec-hrt"><div class="sec-h"><span class="sec-t">HRT</span></div>`
            + (g.hrtFlare ? `<p class="note">最近记了 HRT 变化：酸最多每周 1 次，面油先停。</p>` : '')
            + (ph.length ? `<ul class="list note">${ph.map(e => `<li>${esc(dayLabel(e.date, t))}：${esc(e.phase)}</li>`).join('')}</ul>` : `<p class="note">近两周没记 HRT 阶段。记皮肤时可以顺手写一句（比如剂量调整）。</p>`)
            + '</section>';
    }
    // ⑦ 照片分析
    const pa = (W.journal || []).filter(e => e && e.photoAssess && e.photoAssess.usable !== false && e.date <= t).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    h += `<section class="sec" id="rec-photos"><div class="sec-h"><span class="sec-t">拍照分析</span>${analyze ? '<button type="button" class="btn-link sm" data-act="capture">拍三张</button>' : ''}</div>`;
    if (pa.length) h += `<ul class="rows pa-rows">${pa.map(e => `<li class="row"><span class="row-main"><span class="meta">${esc(dayLabel(e.date, t))}</span><span class="lede">${esc(e.photoAssess.overall || '')}</span>${e.photoAssess.vs_last ? `<span class="note">和上次比：${esc(e.photoAssess.vs_last)}</span>` : ''}</span>`
        + `<img class="pa-thumb" data-pa-date="${esc(e.date)}" alt="${esc(dayLabel(e.date, t))}的正脸照片" hidden></li>`).join('')}</ul>`;
    const blocked = !analyze && photoAnalysisOn(app, P) ? analyzeBlocked(app) : '';
    h += `<p class="note">${analyze ? '正脸、左脸、右脸各一张，顾问逐区看、和上次比。隔两三天拍一次就够；变差那天可以加拍。照片只存在这台设备上。'
        : blocked ? blocked + '照片只存在这台设备上。'
        : photoAnalysisOn(app, P) ? '照片分析要登录并开通顾问才能用。现在拍的照片只存在这台设备上。' : '照片分析没打开，要本人在设置里打开才会用。现在拍的照片只存在这台设备上。'}</p></section>`;
    // ⑧ 历史(点一行补记或改那一天)
    const hist = (W.journal || []).filter(e => e && e.date && e.date <= t && (hasLog(e) || e.done || (e.products || []).length)).sort((a, b) => b.date.localeCompare(a.date));
    h += `<section class="sec" id="rec-hist"><div class="sec-h"><span class="sec-t">历史</span><button type="button" class="btn-link sm quiet" data-act="day-pick">补记某一天</button></div>`;
    if (!hist.length) h += `<p class="note">还没有记录。</p>`;
    else {
        h += `<ul class="rows hist">${hist.slice(0, ui.histN).map(e => {
            const tg = [trendOf(e) ? tagLabel(TREND_TAGS[trendOf(e)]) : ''].concat(SYMPTOM_TAGS.filter(x => (e.status || []).indexOf(x) >= 0).map(tagLabel)).filter(Boolean).join('、');
            const bits = [tg, cleanSpots(e.spots).length ? '标了位置' : '', e.photoAssess ? '照片分析' : '', e.done ? '做完了' : '', e.auto ? '按计划推定' : ''].filter(Boolean).join(' · ');
            return `<li><button type="button" class="row" data-act="day" data-date="${esc(e.date)}"><span class="row-main"><span class="lede">${esc(dayLabel(e.date, t))}</span>${bits ? `<span class="note">${esc(bits)}</span>` : ''}${noteOf(e) ? `<span class="note faint">${esc(noteOf(e).slice(0, 40))}</span>` : ''}</span>${ico('chev', 'sm')}</button></li>`;
        }).join('')}</ul>`;
        if (hist.length > ui.histN) h += `<button type="button" class="btn-link sm quiet" data-act="hist-more">再看早一些</button>`;
    }
    h += '</section>';
    return h;
}

const _bound = new WeakSet();
export function mount(root, app) {
    bindFeedback(app);
    const q = root.querySelector('#rec-q');
    if (q) q.addEventListener('input', () => { ui.draft = q.value; });
    const img = root.querySelector('#rec-thumb');
    if (img) loadDayPhoto(app, app.today()).then(u => { if (u && img.isConnected) { img.src = u; img.hidden = false; } });
    root.querySelectorAll('img[data-pa-date]').forEach(im => loadDayPhoto(app, im.dataset.paDate).then(u => { if (u && im.isConnected) { im.src = u; im.hidden = false; } }));
    // 挂载点每次重画都是同一个 <section>:委托只挂一次,处理时现查元素
    if (_bound.has(root)) return;
    _bound.add(root);
    root.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('[data-act]');
        if (!b || !root.contains(b)) return;
        const a = b.dataset.act, t = app.today();
        if (a === 'note') {
            const box = root.querySelector('#rec-q');
            const text = (box && box.value || '').trim();
            if (!text) { if (box) box.focus(); return; }
            const en = entryOf(app.world(), t), cur = noteOf(en);
            setNote(app.store, t, cur ? cur + '；' + text : text);
            ui.draft = '';
            const sug = parseSentence(text);
            const en2 = entryOf(app.world(), t), st = (en2 && en2.status) || [], have = cleanSpots(en2 && en2.spots);
            sug.tags = sug.tags.filter(x => st.indexOf(x) < 0);
            if (sug.trend && trendOf(en2) === sug.trend) sug.trend = '';
            sug.spots = sug.spots.filter(s => !have.some(h => h.zone === s.zone && h.type === s.type));
            ui.parsed = (sug.tags.length || sug.trend || sug.spots.length) ? Object.assign({ date: t }, sug) : null;
            app.renderAll();
            if (!ui.parsed) requestFeedback(app, t);   // 有建议时等她点完再要反馈(省一次)
        } else if (a === 'parse-ok') {
            if (ui.parsed) applySuggest(app, t, ui.parsed);
            ui.parsed = null; app.renderAll(); requestFeedback(app, t);
        } else if (a === 'parse-edit') {
            const hint = ui.parsed || {}; ui.parsed = null; app.renderAll();
            openSkinSheet(app, { date: t, hint });
        } else if (a === 'parse-no') { ui.parsed = null; app.renderAll(); requestFeedback(app, t); }
        else if (a === 'sheet') openSkinSheet(app, { date: t });
        else if (a === 'capture') openCapture(app, { date: t, onChange: () => app.renderAll(), onSaved: () => requestFeedback(app, t),
            onEdit: hint => { closeSheet('capture-sheet'); openSkinSheet(app, { date: t, hint }); } });
        else if (a === 'day') openSkinSheet(app, { date: b.dataset.date });
        else if (a === 'hist-more') { ui.histN += 20; app.renderScreen('record'); }
        else if (a === 'day-pick') openDayPicker(app);
    });
    bindFace(root, 'heat', zone => { ui.heatSel = ui.heatSel === zone ? '' : zone; app.renderScreen('record'); });
    root.addEventListener('change', e => {
        if (e.target && e.target.id === 'rec-file') {
            const f = e.target.files && e.target.files[0]; e.target.value = '';
            if (f) addSimplePhoto(app, app.today(), f).then(ok => { if (ok) { toast('照片存好了，只在这台设备上'); app.renderScreen('record'); } });
        }
    });
}
// 补记某一天:近 14 天里挑一天(过去的事实可以补;未来不行)
function openDayPicker(app) {
    const t = app.today();
    const days = Array.from({ length: 14 }, (_, i) => addDays(t, -i));
    openSheet({ id: 'day-pick', title: '补记哪一天', html: `<ul class="rows">${days.map(d => `<li><button type="button" class="row" data-d="${d}"><span class="row-main"><span class="lede">${esc(dayLabel(d, t))}</span></span>${ico('chev', 'sm')}</button></li>`).join('')}</ul>`,
        onMount: ov => ov.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; closeSheet('day-pick'); openSkinSheet(app, { date: b.dataset.d }); }) });
}
