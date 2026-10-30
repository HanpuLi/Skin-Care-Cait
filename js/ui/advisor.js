// ══ 顾问 ══════════════════════════════════════════════════════════════════════════════
// 一屏四块(样稿 Main.dc.html「顾问」):
//   ① 现在的方案:一句话 + 为什么这么排 + 按周怎么往前走(刷酸阶梯)+ 版本与撤销 —— 全部离线算,顾问没开通 / 连不上照样有
//   ② 未来 7 晚:每晚点「澡」「刮」(刮只给开了刮胡的人),酸和面膜即时重排;「存成每周习惯 / 按习惯填」(单一来源 sk_preset1)
//   ③ 问顾问:对话(SSE)。顾问改了今晚 / 方案 → 直接生效,挂一条修订线(撤销 / 重做);今晚页那条和这里是同一件事:
//      修订线的状态不存在对话里,每次都从 sk_tnai1 / sk_regimen1 现算,所以哪边撤的,另一边都跟着变。出方案 / 每周复盘也在这里。
//   ④ 常识(guide.js):写死,离线可看,每节「问顾问这一条」预填。
// 输入框贴在这一屏底部(sticky),只在顾问能用时出现;没登录 / 邀请制 / 连不上 / 额度用完各有一句通顺的话,不白屏。
// 对话只存本机(LOCAL_KEYS.aiChat,按账号),不进 CLOUD_KEYS;每周复盘的结果进 sk_ai1(跨设备,别两台各复盘一次)。
import { K, LOCAL_KEYS } from '../store.js';
import { esc, ico, openSheet, closeSheet, toast, sysConfirm } from './sheets.js';
import { renderGuide, bindGuide } from './guide.js';
import { navRow } from './settings.js';
import { ensureShopRunner, readLabelFromFile, imageToDataURL } from './products.js';
import { regimenRules, maxAcidPerWeek, repairUse, repairReason, zonesAvoiding, acidTiming, currentRegimen } from '../engine/rules.js';
import { safetyGate } from '../engine/gate.js';
import { acidLadder, LADDER_STEP_N, LADDER_MAX } from '../engine/ladder.js';
import { next7, buildNightSteps, slotFor } from '../engine/schedule.js';
import { hasTrait } from '../model/products.js';
import { toggleTn, setDayState, saveHabit, presetOk, habitPreset } from '../model/week.js';
import { buildSkincareContext, liveContext } from '../ai/context.js';
import { applyTonight, undoTonightChange, applyRegimen, applyPlan, undoRegimenChange, restoreRegimenLocal, TONIGHT_TXT, REG_TXT, next7Shown } from '../ai/apply.js';
import { addDays, dowOf, isoWeek } from '../clock.js';

export const id = 'advisor';
export const title = '顾问';

const CHAT_MAX = 40, CHAT_SEND = 24;
const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
// 这一屏自己的界面状态(不进存储)
const ST = { draft: '', img: null, busy: false, stream: '', ladderOpen: true, n7Prev: null, planBusy: '', reviewBusy: false, focus: false };
// 换账号:上一个人的草稿、没发的照片、未来 7 晚的对比基准、流式半截都清掉(app.js clearLocalExtras 调;进行中的请求回来时按 owner 丢弃)
export function resetForUser() {
    Object.assign(ST, { draft: '', img: null, busy: false, stream: '', n7Prev: null, planBusy: '', reviewBusy: false, focus: false });
    PROBE.busy = false;
}
const ownerOf = app => (app.store && app.store.state && app.store.state.owner) || '';

// ── 小工具 ──
const hm = t => { const d = new Date(t); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const mdShort = ds => ds ? Number(ds.slice(5, 7)) + '/' + Number(ds.slice(8, 10)) : '';
const mdAt = t => { const d = new Date(t); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); };
function md(s) { return String(s || '').split(/\n{2,}/).map(p => '<p>' + esc(p.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '')).replace(/\n/g, '<br>') + '</p>').join(''); }
function user(app) { return (app.sync && app.sync.state && app.sync.state.user) || null; }
function uidOf(app) { const u = user(app); return u ? u.uid : null; }
function whoOf(app, W) { const u = user(app); return { name: u && u.displayName ? String(u.displayName).split(' ')[0] : '', shown: shownOf(app, W) }; }
// 她眼前的今晚(今晚页显示的那份:顾问版或离线);app.js 接好的钩子,单测里没有就按离线
function shownOf(app, W) { try { return app.shownTonight ? app.shownTonight(W) : null; } catch (e) { return null; } }
function aiTonightOf(app) { try { return app.aiTonightData ? app.aiTonightData() : null; } catch (e) { return null; } }
function isOwner(app) { try { return !!(app.sync.isOwner && app.sync.isOwner(user(app))); } catch (e) { return false; } }
export function canTalk(app) { return app.ai.access() === 'on' && app.ai.ready() && !app.ai.state.down && !app.ai.quotaText(); }

// 开通状态还没核过:每个账号只自动核一次(核不成就停在「没回应 + 重试」,别每次重画都再打一次 /api/me)
const PROBE = { tried: {}, busy: false };
export function probeOnce(app, after) {
    const u = uidOf(app);
    if (!u || app.ai.access() !== 'on' || app.ai.ready() || app.ai.state.down || PROBE.busy || PROBE.tried[u]) return;
    PROBE.busy = true; PROBE.tried[u] = true;
    const done = () => { PROBE.busy = false; if (after) after(); };
    app.ai.probe().then(done, done);
}
// ── 数据说明:这个账号在这台设备上第一次进顾问页时弹一次(同 v1:sk_aiprivacy1 = {uid, at},本机键,v1 弹过的不再弹)──
//   完整版在「设置 → 数据说明」。有别的 sheet 开着(引导、改版说明、同步冲突)时先不弹,下次进这一屏再看。
export function dataNoticeSeen(app) {
    let v = null;
    try { v = JSON.parse(app.store.getLocal(LOCAL_KEYS.aiPrivacy)); } catch (e) { }
    return !!(v && v.uid && v.uid === uidOf(app));
}
// 第一次进顾问页自动弹;今晚页「先看一下」、引导结束、记录后的反馈这些自动外发之前也先过这一道(openDataNotice)
export function maybeDataNotice(app) {
    const u = uidOf(app);
    if (!u || dataNoticeSeen(app) || typeof document === 'undefined' || document.hidden) return false;
    if (document.querySelector('#sheet-root .sheet-ov')) return false;
    const sec = document.getElementById('advisor'); if (!sec || !sec.classList.contains('active')) return false;
    return openDataNotice(app);
}
// 不管在哪一屏都弹;点「知道了」(或关掉)记成看过,再调 after(比如去请顾问排今晚)
export function openDataNotice(app, after) {
    const u = uidOf(app);
    if (!u || typeof document === 'undefined') return false;
    if (dataNoticeSeen(app)) { if (after) after(); return false; }
    const P = app.world().profile || {};
    let fired = false;
    const seen = () => {
        if (fired) return; fired = true;
        if (uidOf(app) !== u) return;   // 弹着的时候换了账号:不替新账号点「看过了」
        app.store.setLocal(LOCAL_KEYS.aiPrivacy, JSON.stringify({ uid: u, at: app.store.now() }));
        if (after) after();
    };
    // 主账号:家里的服务器还会另外附上运营者自己在服务器上记的 HRT 用药和化验,和 App 里的 HRT 开关无关(server 端的事,这里照实说)
    const ownerHrt = isOwner(app) ? '<li>服务器上另外记的 HRT 用药和化验（只有主账号会附上，和 App 里的 HRT 开关无关）</li>' : '';
    openSheet({ id: 'ai-privacy', title: '顾问会看到什么', html: `<ul class="list lede">
            <li>你的产品清单和成分特性</li>
            <li>近 14 天的皮肤记录、标在脸上的位置、备注、做了哪几步</li>
            <li>设置里的肤质、想解决的、要避开的区域${P.hrt ? '、HRT 阶段' : ''}；看过医生的记录（如果有）</li>
            ${ownerHrt}<li>你发的对话和照片</li></ul>
        <p class="note">这些会自动发：今晚页每天请顾问排一次；记完皮肤、完成今晚后顾问回一句；每周第一次打开顾问页复盘一次（近两周记了 3 天以上才跑）；货架上标了用完 / 快用完，顾问判断要不要买。每次都带着上面这些，还有你账号名字的第一个词。会发到 Cait 家里的服务器，再转给 Anthropic 的 Claude 模型生成回答。服务器只记每次花了多少钱，不存对话和照片。对话里顾问会自己记下以后也要用的事（比如对某成分的反应、过敏、偏好），记了会在那条回答下面写「记住了」，在「设置 › 顾问记得的事」里能看、能删。对话本身只存在这台设备上。详细的在「设置 › 数据说明」。</p>`,
        actions: [{ label: '知道了', primary: true, fn: seen }], onClose: seen });
    return true;
}

// ── 对话存档(本机,按账号)──
function chatState(app) {
    let st = null;
    try { st = JSON.parse(app.store.getLocal(LOCAL_KEYS.aiChat)); } catch (e) { }
    return (st && st.uid === uidOf(app) && Array.isArray(st.chat)) ? st : { uid: uidOf(app), chat: [], ctx: null };
}
function saveChat(app, st) { if (!app.store.setLocal(LOCAL_KEYS.aiChat, JSON.stringify(st))) toast('这台设备存不进去了，这条对话没存上'); }
// 对话开头拍的快照(缓存命中省钱)会过期:换了一天、HRT 开关变了、近 14 天的记录 / 备注改了或删了、就医状态变了 → 重拍。隐私优先于缓存命中。
function ctxKey(W) {
    const P = W.profile || {};
    const days = (W.journal || []).filter(e => e && e.date && e.date <= W.today && e.date >= addDays(W.today, -13))
        .map(e => [e.date, e.note || '', (e.status || []).join(','), e.phase || '', e.photoAssess ? 1 : 0].join('~')).sort().join('|');
    return [W.today, P.hrt ? 1 : 0, JSON.stringify(P.medical || null), P.startState || '', days].join('#');
}
function freshCtx(app, W, st) {
    const k = ctxKey(W);
    if (!st.ctx || st.ctxKey !== k) { st.ctx = buildSkincareContext(W, whoOf(app, W)); st.ctxKey = k; }
    return st.ctx;
}
// 删掉某一天、关掉 HRT 之后调:本机存着的对话快照作废,下一条消息重拍
export function invalidateChatCtx(app) {
    let st = null;
    try { st = JSON.parse(app.store.getLocal(LOCAL_KEYS.aiChat)); } catch (e) { }
    if (st && st.ctx) { st.ctx = null; delete st.ctxKey; saveChat(app, st); }
}
// sk_ai1:每周复盘做过没有(跨设备)。【整合时搬家】没有 model 函数,先放这里(写法同 v1:读 → 改 → 写回,'user')
function aiState(store) { return store.lg(K.ai) || {}; }
function updateAiState(store, fn) { const s = aiState(store); fn(s); return store.ls(K.ai, s); }

// ── 修订线:状态现算(今晚页撤了,这里也跟着变)──
// 'applied' 生效中(能撤)· 'undone' 撤销了(能重做)· 'merged' 后面又改过今晚 · 'expired' 过了那天 · 'superseded' 后面又有新版本 · 'failed' 没改成
const opKey = o => [o.op, o.product || '', o.to || '', o.level || ''].join('|');
export function recLive(W, rec) {
    if (!rec || rec.state === 'failed') return 'failed';
    if (rec.kind === 'tonight') {
        if (rec.date && rec.date !== W.today) return 'expired';
        const o = W.tnai, live = o && o.date === W.today ? o : null;
        if (live && live.id === rec.id) return 'applied';
        if (!live) return 'undone';
        // 后面又改过一次今晚:这一条的改动还在今晚里 = 并进去了(要撤先撤最近那条);已经不在了 = 之前撤过
        const mine = (rec.changes || []).filter((c, k) => !(rec.result || [])[k] && c.op !== 'note').map(opKey);
        const now = (live.ops || []).map(opKey);
        if ((live.undo && live.undo.prev && live.undo.prev.id === rec.id) || (mine.length && mine.every(k => now.indexOf(k) >= 0))) return 'merged';
        return 'undone';
    }
    const hist = W.regimen || [], last = hist[hist.length - 1];
    if (!rec.versionId) return 'failed';
    if (last && last.id === rec.versionId) return 'applied';
    const ui = hist.findIndex(h => String(h.reason || '').indexOf('撤销了 v' + rec.v + '，') === 0);
    if (ui >= 0) {
        if (ui < hist.length - 1) return 'superseded';   // 撤了之后又有新的一版:不再给「重做」,免得盖掉后来的
        return hist.some(h => h.id === rec.versionId) ? 'undone' : 'undone-final';
    }
    return 'superseded';
}
function recRows(rec) {
    const T = rec.kind === 'tonight' ? TONIGHT_TXT : REG_TXT;
    return (rec.changes || []).map((c, k) => {
        const txt = (T[c.op] || (() => c.op))(c), bad = (rec.result || [])[k] || '';
        const part = !bad && (rec.blocked || []).find(b => b.partial && b.text === txt);
        return { txt, bad, part: part ? part.why : '', why: c.why || '' };
    });
}
function recAfter(W, rec) {
    const s = recLive(W, rec), tn = rec.kind === 'tonight';
    if (s === 'undone' || s === 'undone-final') return tn ? '(她点了撤销，今晚回到改之前)' : '(她点了撤销，方案回到上一版)';
    const rows = recRows(rec), ok = rows.filter(r => !r.bad).map(r => r.txt), bad = rows.filter(r => r.bad).map(r => r.txt + '（' + r.bad + '）');
    if (rec.kind === 'plan') return s === 'applied' ? '(已直接换成新方案 v' + rec.v + ')' : '';
    return (ok.length ? (tn ? '(已直接改了今晚：' : '(已直接改成新方案 v' + rec.v + '：') + ok.join('；') + ')' : '') + (bad.length ? '(被安全闸拦下 / 没改成：' + bad.join('；') + ')' : '');
}
function revHtml(W, rec, key) {
    const s = recLive(W, rec), tn = rec.kind === 'tonight';
    const who = rec.kind === 'review' ? '复盘' : '顾问';
    // 对话里这条修订线就挂在「顾问 · 时:分」那条消息下面,不再重复时间(复盘单独一块,留着)
    const head = who + ' · ' + (rec.kind === 'review' ? hm(rec.at) + ' · ' : '') + (tn ? '改了今晚' : rec.kind === 'plan' ? '出了方案 v' + rec.v : (rec.fromV ? '改了方案 v' + rec.fromV + ' 改成 v' + rec.v : '改了方案 v' + rec.v));
    const rows = recRows(rec);
    const ok = rows.filter(r => !r.bad), bad = rows.filter(r => r.bad);
    let text = '', act = '';
    if (s === 'applied') {
        text = rec.kind === 'plan' ? (rec.summary || '整套方案换成了顾问这一版。') : ok.map(r => r.txt + (r.part ? '（' + r.part + '）' : '')).join('；') + (ok.length ? '。' : '');
        if (!tn) text += rec.kind === 'plan' ? '上面的方案和未来 7 晚已经按它排好。' : '上面的未来 7 晚已经按新方案排好。';
        act = '撤销';
    } else if (s === 'undone') { text = tn ? '已撤销，今晚回到改之前。' : '已撤销，方案回到上一版。'; act = '重做'; }
    else if (s === 'undone-final') text = '已撤销，方案回到离线规则。';
    else if (s === 'merged') text = '后面又改了一次今晚，这一条并在里面；要撤先撤最近那条。';
    else if (s === 'expired') text = '那天的小改，过了那天就不算了。';
    else if (s === 'superseded') text = '后面又有新的一版方案了。要改回去直接跟顾问说，或在上面「版本与撤销」里回到那一版。';
    else text = '没改成。';
    const badTxt = bad.length ? `<span class="note rev-bad">没生效：${esc(bad.map(r => r.txt + '（' + r.bad + '）').join('；'))}</span>` : '';
    const blk = rec.kind === 'plan' && (rec.blocked || []).length ? `<span class="note rev-bad">${esc(rec.blocked.map(b => b.text + (b.partial ? '，暂缓：' : '，没生效：') + b.why).join('；'))}</span>` : '';
    const dropped = (rec.dropped || []).length ? `<span class="note">还提到 ${rec.dropped.length} 个不在你产品库里的：${esc(rec.dropped.join('、'))}</span>` : '';
    return `<div class="rev" data-rec="${esc(key)}" data-state="${s}"><div class="rev-main"><span class="rev-h">${esc(head)}</span><span class="rev-t">${esc(text)}</span>${badTxt}${blk}${dropped}</div>
        ${act ? `<button type="button" class="btn-link rev-act" data-recact="${esc(key)}">${act}</button>` : ''}</div>${revAskHtml(rec, s, key)}`;
}
// 方案 / 复盘生效之后:「改一下」「聊聊」(对应健身 AI 结果的「改一下 / 聊聊」)。预填进对话,不自动发;
//   对话里顾问有 propose_regimen / change_tonight,改动照样直接生效 + 挂修订线。今晚的小改不挂(今晚页自己有单步操作)
function recAskLabel(rec) { return rec.kind === 'review' ? '这周的复盘' : rec.kind === 'plan' ? '顾问出的方案 v' + rec.v : '方案 v' + rec.v + ' 这次改动'; }
function revAskHtml(rec, s, key) {
    if (rec.kind === 'tonight' || s !== 'applied') return '';
    return `<div class="btn-row rev-ask"><button type="button" class="btn-link sm" data-recask="${esc(key)}" data-mode="revise">改一下</button><button type="button" class="btn-link sm quiet" data-recask="${esc(key)}" data-mode="talk">聊聊</button></div>`;
}

// ── 现在的方案(离线)──
function shortName(n) { return String(n || '').replace(/\s*[（(].*$/, ''); }
function planLine(W) {
    const cap = maxAcidPerWeek(W), rr = regimenRules(W), parts = [];
    const zones = zonesAvoiding(W, 'acid');
    parts.push(cap > 0 ? '刷酸每周 ' + cap + ' 次' + (rr.acidName ? '，用 ' + shortName(rr.acidName) : '') : '这周先不刷酸');
    parts.push(repairUse(W) === 'spot' ? '修护霜点涂' : '修护霜全脸薄涂');
    const resting = (rr.resting || []).map(x => typeof x === 'string' ? x : x && x.name).filter(Boolean);
    if (resting.length) parts.push(shortName(resting[0]) + ' 先不排' + (resting.length > 1 ? ' 等 ' + resting.length + ' 样' : ''));
    if (cap > 0 && zones.length) parts.push('酸避开' + zones.join('、'));
    return parts.join(' · ');
}
function ladderHtml(W) {
    const rr = regimenRules(W), cap = maxAcidPerWeek(W), L = acidLadder(W), g = safetyGate(W), P = W.profile || {};
    const acids = (W.products || []).filter(p => p.role === 'acid' && !p.hidden);
    if (!acids.length) return '<p class="note">货架上没有酸，刷酸节奏先不用管。</p>';
    const ai = rr.source === 'ai';
    const level = ai ? Math.max(0, Math.round(+rr.acidCap || 0)) : L.level;
    const gentle = acids.filter(p => !hasTrait(p, 'strong-exfo')), strong = acids.filter(p => hasTrait(p, 'strong-exfo'));
    const gname = shortName(rr.acidName || (gentle[0] && gentle[0].name) || '温和酸');
    const nextNote = ai ? '看前两周的反应，顾问再定' : L.minimal ? '极简模式不会自己加；想加跟顾问说，或到今晚页「接下来 7 晚」底下的「高级」里改' : '再干净 ' + (LADDER_STEP_N - (L.streak || 0)) + ' 次（刷完两天内记了状态、没泛红没新痘）就加';
    const stages = [
        { when: '第一档', what: '每周 1 次 ' + gname, n: 1 },
        { when: '第二档', what: '每周 2 次', n: 2 },
        { when: '第三档', what: '每周 3 次', n: 3, note0: ai ? '' : '离线阶梯到这里封顶' }];
    if (level > LADDER_MAX) stages.push({ when: '现在', what: '每周 ' + level + ' 次', n: level });
    if (strong.length) stages.push({ when: '再往后', what: shortName(strong[0].name) + ' 评估', n: 99, note0: '皮肤连续稳 4 周以后' });
    const rows = stages.map(s => {
        const st = s.n === 99 ? 'next' : s.n < level ? 'done' : s.n === level ? 'now' : 'next';
        const note = st === 'done' ? '做到了' : st === 'now' ? (ai ? '现在 · 顾问定的' + (cap < level ? '，安全闸先压到 ' + cap + ' 次' : '') : '现在 · ' + L.why) : (s.n === level + 1 ? nextNote : (s.note0 || ''));
        return `<div class="lad-row ${st}"><span class="lad-when"><i class="dot ${st === 'done' ? 'ok' : st === 'now' ? 'ink' : 'hollow'}"></i>${esc(s.when)}</span><span class="lad-what"><span class="lede">${esc(s.what)}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}</span></div>`;
    }).join('');
    const KIND = { clean: '没反应', up: '升一档', react: '有刺激，退一档', unknown: '没记状态，不算数', pending: '还在看', nolog: '按计划推定用了', gap: '隔太久，降一档' };
    const ev = !ai && L.events.length ? `<ul class="list note lad-ev">${L.events.slice(-4).reverse().map(e => `<li><span class="mono">${esc(mdShort(e.date))}</span> 刷酸，${esc(KIND[e.kind] || e.kind)}</li>`).join('')}</ul>` : '';
    const gateLine = g.acidCapMax < Math.max(1, level) && g.notes[0] ? `<p class="note lad-gate">${esc(g.notes[0])}</p>` : '';
    return `${gateLine}<div class="lad">${rows}</div>${ev}<p class="note ink lad-rule">任何一次刷完泛红过夜，退回上一档。就医提醒亮着时全部停。${P.minimalMode ? '极简模式不因为没记录往上加。' : ''}</p>`;
}
function planDetails(W, reg) {
    const r = (reg && reg.rules) || {}, g = safetyGate(W), rr = regimenRules(W), kv = [];
    const cap = maxAcidPerWeek(W), planned = Math.max(0, Math.round(+rr.acidCap || 0));
    if (cap < planned) kv.push(['刷酸', '方案是每周 ' + planned + ' 次，安全闸先压到 ' + cap + ' 次']);
    if (r.cleanse) kv.push(['洗脸', r.cleanse]);
    kv.push(['修护霜', (repairUse(W) === 'spot' ? '只点涂：' : '全脸薄涂：') + repairReason(W)]);
    if ((r.include || []).length) kv.push(['排进来', r.include.join('、')]);
    const resting = (rr.resting || []).filter(x => x && x.name);
    if (resting.length) kv.push(['先不排', resting.map(x => x.name + (x.why ? '（' + x.why + '）' : '')).join('；')]);
    if (g.notes.length) kv.push(['安全闸', g.notes.join('；')]);
    if ((reg && reg.blocked || []).length) kv.push(['没生效', reg.blocked.map(b => b.text + '：' + b.why).join('；')]);
    ((reg && reg.gaps) || []).forEach(x => kv.push(['缺一环', x.label + '：家里没有能顶的了。' + (x.why || '')]));
    return kv.length ? `<dl class="kv adv-kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
}
function histHtml(W) {
    const hist = (W.regimen || []).slice(-8).reverse();
    if (!hist.length) return '';
    const n = (W.regimen || []).length, canUndo = n > 1 || hist[0].source === 'ai';
    return `<details class="fold" id="adv-hist"><summary><span class="fold-sum"><span class="lede">版本与撤销</span><span class="note">${n > 1 ? '一共 ' + n + ' 版' : '只有这一版'}${canUndo ? '，最新一版能撤销' : ''}</span></span></summary><div class="fold-body rows">${hist.map((h, i) => {
        const latest = i === 0, can = latest ? canUndo : true;
        return `<div class="row"><span class="row-main"><span class="meta">v${esc(h.v)} · ${esc(mdAt(h.at) || mdShort(h.date))} · ${h.source === 'ai' ? '顾问' : '离线规则'}${h.kind === 'undo' ? ' · 撤销 / 回退' : ''}</span><span class="note ink">${esc(h.reason || '')}</span></span>
            ${can ? `<button type="button" class="btn-link sm${latest ? '' : ' quiet'}" data-hist="${esc(h.id)}" data-latest="${latest ? 1 : 0}" data-v="${esc(h.v)}">${latest ? '撤销' : '回到这一版'}</button>` : ''}</div>`;
    }).join('')}</div></details>`;
}
function planHtml(app, W) {
    const live = (W.products || []).some(p => !p.hidden);
    if (!live) return `<section class="adv-plan" id="adv-plan"><div class="sec-h"><h2 class="sec-t">现在的方案</h2></div>
        <div class="empty"><p class="lede">还没有方案。</p><p class="note">先在「产品」里加一支洁面和一支保湿，方案就排出来了。</p><div class="btn-row"><button type="button" class="btn" data-go="products">去「产品」添加</button></div></div></section>`;
    const reg = currentRegimen(W), ai = reg && reg.source === 'ai';
    const why = reg ? (ai && reg.rationale ? reg.rationale : reg.reason) : '';
    const talk = canTalk(app);
    const planBtn = !reg || reg.source !== 'ai' ? '让顾问出方案' : reg.stale ? '让顾问按新货架重排' : '让顾问重排';
    const acts = talk ? `<div class="btn-row adv-plan-acts"><button type="button" class="btn-link sm" data-act="ask-plan">问顾问这版方案</button>
        <button type="button" class="btn-link sm quiet" data-act="plan"${ST.planBusy || ST.busy ? ' disabled' : ''}>${ST.planBusy ? '在排…' : planBtn}</button></div>` : '';
    return `<section class="adv-plan" id="adv-plan">
        <div class="sec-h"><h2 class="sec-t">现在的方案</h2><span class="meta" id="adv-ver">${reg ? esc('v' + reg.v + ' · ' + (mdAt(reg.at) || mdShort(reg.date)) + ' · ' + (ai ? '顾问' : '离线规则')) : ''}</span></div>
        <p class="adv-line" id="adv-line">${esc(planLine(W))}</p>
        ${why ? `<p class="note adv-why">${esc(why)}</p>` : ''}
        ${ST.planBusy ? `<p class="note" role="status">${esc(ST.planBusy)}</p>` : ''}
        <button type="button" class="adv-toggle" id="adv-ladder-btn" aria-expanded="${ST.ladderOpen}" aria-controls="adv-ladder"><span>按周怎么往前走</span>${ico('chev', 'sm adv-chev')}</button>
        <div id="adv-ladder"${ST.ladderOpen ? '' : ' hidden'}>${ladderHtml(W)}</div>
        <details class="fold" id="adv-detail"><summary><span class="fold-sum"><span class="lede">这一版的细则</span></span></summary><div class="fold-body">${planDetails(W, reg)}</div></details>
        ${histHtml(W)}
        ${acts}
    </section>`;
}

// ── 接下来 7 晚(今晚 → 接下来 7 晚 那一页用;tonight.js 的 pages.week 调 weekHtml / bindWeek)──
function nightLabel(d) {
    const it = d.items || [];
    if (it.some(i => i.type === 'acid')) return '酸';
    if (it.some(i => i.type === 'mask')) return '膜';
    if (it.some(i => i.type === 'retinol')) return '维 A';
    return '修';
}
function nightKey(d) { return nightLabel(d) + '|' + (d.items || []).map(i => i.name).join(','); }
function n7Note(W, days) {
    const P = W.profile || {}, g = safetyGate(W);
    if (g.medical) return { text: '就医提醒亮着，这 7 晚都不排酸。', moved: false };
    const prev = ST.n7Prev;
    if (prev) {
        const changed = days.filter(d => prev[d.date] !== undefined && prev[d.date] !== nightKey(d));
        const lost = changed.filter(d => prev[d.date].split('|')[0] === '酸' && nightLabel(d) !== '酸');
        const gain = changed.filter(d => nightLabel(d) === '酸' && prev[d.date].split('|')[0] !== '酸');
        const tapped = days.find(d => d.date === prev.__t);
        const name = d => d.date === W.today ? '今晚' : d.dayName;
        if (lost.length === 1 && gain.length === 1) return { text: name(lost[0]) + (lost[0].shave ? '刮胡' : '') + '，那晚的酸挪到' + name(gain[0]) + '。', moved: true };
        if (lost.length && !gain.length) return { text: lost.map(name).join('、') + '那晚的酸这周排不下了，挪到下周。', moved: true };
        if (changed.length) return { text: changed.map(d => name(d) + '：' + prev[d.date].split('|')[0] + ' 改成 ' + nightLabel(d)).join('；') + '。', moved: true };
        if (tapped) return { text: name(tapped) + '改了，排的没变。', moved: false };
    }
    const tm = acidTiming(W);
    const bits = [];
    if (P.shaving) bits.push('刮胡那晚不排酸，改了会自动挪');
    if (tm === 'prefer') bits.push('洗澡夜优先排酸');
    else if (tm === 'avoid') bits.push('酸避开刚洗完热水澡的晚上');
    return { text: bits.length ? bits.join('；') + '。' : '哪晚洗澡在这里点，酸和面膜会跟着重排。', moved: false };
}
// 未来 7 晚:今晚那格按她眼前那份今晚(顾问版有酸就标「酸」),其余按离线排班
const days7 = (app, W) => next7Shown(W, shownOf(app, W));
export function weekHtml(W, app) {
    if (!(W.products || []).some(p => !p.hidden)) return '';
    const P = W.profile || {}, days = days7(app, W);
    const preset = presetOk(W.preset) ? W.preset : null;
    const same = !!preset && days.every(d => { const x = preset.find(p => p.dow === dowOf(d.date)); return x && !!x.shower === !!d.shower && (!P.shaving || !!x.shave === !!d.shave); });
    const note = n7Note(W, days);
    const tg = (d, k, on, label) => `<button type="button" class="n7-b" data-date="${esc(d.date)}" data-k="${k}" aria-pressed="${on}" aria-label="${esc((d.date === W.today ? '今晚' : d.dayName) + label)}">${k === 'shower' ? '澡' : '刮'}</button>`;
    // 日期只在第一格和跨月那格写「月/日」,其余只写几号(像日历;12px 的小字少一半,整页 <14px 的字不超 15%)
    const moved = ST.n7Prev ? days.filter(d => ST.n7Prev[d.date] !== undefined && ST.n7Prev[d.date] !== nightKey(d)).map(d => d.date) : [];
    return `<section class="sec adv-week" id="adv-week">
        <div class="sec-h"><h2 class="sec-t">每晚排什么</h2><span class="note faint">点「澡」${P.shaving ? '「刮」' : ''}直接改</span></div>
        <div class="n7" id="adv-n7" role="group" aria-label="未来 7 晚">${days.map((d, i) => `<div class="n7-d${d.date === W.today ? ' today' : ''}${moved.indexOf(d.date) >= 0 ? ' moved' : ''}" data-day="${esc(d.date)}">
            <button type="button" class="n7-go" data-night="${esc(d.date)}" aria-label="${esc((d.date === W.today ? '今晚' : d.dayName) + '：' + nightLabel(d) + '，看那晚的步骤')}"><span class="n7-date">${esc(i === 0 || d.date.slice(8) === '01' ? mdShort(d.date) : String(Number(d.date.slice(8, 10))))}</span><span class="n7-dow">${esc(d.date === W.today ? '今晚' : d.dayName)}</span><span class="n7-type${nightLabel(d) === '修' ? '' : ' act'}">${esc(nightLabel(d))}</span></button>
            ${tg(d, 'shower', !!d.shower, '洗澡')}${P.shaving ? tg(d, 'shave', !!d.shave, '刮胡') : ''}</div>`).join('')}</div>
        <p class="note${note.moved ? ' rev' : ''}" id="adv-n7-note" role="status">${esc(note.text)}</p>
        <div class="btn-row adv-habit"><button type="button" class="btn-link sm" id="adv-habit-save"${same ? ' aria-disabled="true"' : ''}>${same ? '已存成每周习惯' : '存成每周习惯'}</button>
            <button type="button" class="btn-link sm quiet" id="adv-habit-fill">按习惯重填</button></div>
    </section>`;
}
function nightSheet(app, date) {
    const W = app.world(), d = days7(app, W).find(x => x.date === date); if (!d) return;
    let r = buildNightSteps(W, d.shower, d.shave, slotFor(W, date));
    const sh = date === W.today ? shownOf(app, W) : null;
    if (sh && sh.source === 'ai') r = { steps: sh.steps.map(x => ({ p: x.product || x.how, h: x.product ? x.how : '' })), skips: sh.skips.map(x => x.product), warnings: sh.warnings || [], ai: true };
    const when = date === W.today ? '今晚' : d.dayName + ' ' + mdShort(date);
    openSheet({ id: 'night-sheet', title: when + ' · ' + (nightLabel(d) === '修' ? '修护夜' : nightLabel(d) + '夜'),
        html: `<p class="note">${d.shower ? '洗澡' : '不洗澡'}${(W.profile || {}).shaving ? (d.shave ? ' · 刮胡' : ' · 不刮胡') : ''}。${r.ai ? '今晚页上顾问排的那份。' : '离线规则排的，那天顾问可能会再调。'}</p>
            <ol class="night-steps">${r.steps.map(s => `<li><span class="lede">${esc(s.p)}</span>${s.h ? `<span class="note">${esc(s.h)}</span>` : ''}</li>`).join('')}</ol>
            ${r.skips.length ? `<p class="note">那晚不用：${esc(r.skips.join('、'))}</p>` : ''}
            ${(r.warnings || []).length ? `<div class="adv-warn">${r.warnings.map(w => `<p class="note ink">${esc(w.text)}</p>`).join('')}</div>` : ''}`,
        actions: [{ label: '知道了', primary: true }] });
}
function snapNights(app, W, tapped) { const o = {}; days7(app, W).forEach(d => { o[d.date] = nightKey(d); }); o.__t = tapped || ''; return o; }
function toggleNight(app, date, k) {
    const W = app.world(), t = W.today;
    if (date < t) return;
    ST.n7Prev = snapNights(app, W, date);
    const d = next7(W).find(x => x.date === date); if (!d) return;
    if (date === t) toggleTn(app.store, k, !d[k], t);
    else setDayState(app.store, date, k === 'shower' ? !d.shower : d.shower, k === 'shave' ? !d.shave : d.shave, t);
    app.renderAll();
    if (date === t && app.tonightChanged) app.tonightChanged('今晚' + (k === 'shower' ? '洗澡' : '刮胡') + '在「接下来 7 晚」改了');   // 今晚的前提变了:顾问重排(签名变了才调)
    const b = document.querySelector(`#adv-n7 .n7-b[data-date="${date}"][data-k="${k}"]`);
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { }
}
function saveWeekHabit(app) {
    const W = app.world(), P = W.profile || {};
    const preset = next7(W).map(d => ({ dow: dowOf(d.date), shower: !!d.shower, shave: !!d.shave }));
    saveHabit(app.store, preset);
    ST.n7Prev = null;
    app.renderAll();
    toast('存好了：以后点「按习惯重填」就照这 7 晚的' + (P.shaving ? '洗澡、刮胡' : '洗澡') + '排');
}
function fillWeekHabit(app) {
    const W = app.world(), P = W.profile || {};
    if (!presetOk(W.preset)) {
        openSheet({ id: 'habit-none', title: '还没存过习惯', text: '先把这 7 晚哪晚洗澡' + (P.shaving ? '、刮胡' : '') + '点好，再点「存成每周习惯」；也可以直接在下面的「通常哪几天洗澡」里选。', actions: [{ label: '好', primary: true }] });
        return;
    }
    sysConfirm('接下来 7 晚（含今晚）的' + (P.shaving ? '洗澡和刮胡' : '洗澡') + '按存过的习惯重填，现在点过的会被盖掉。酸和面膜跟着重排。', () => {
        const W2 = app.world(), t = W2.today, pre = habitPreset(W2.preset, W2.profile);
        ST.n7Prev = snapNights(app, W2, '');
        for (let i = 0; i < 7; i++) {
            const ds = addDays(t, i), x = pre.find(p => p.dow === dowOf(ds)) || { shower: false, shave: false };
            if (i === 0) { toggleTn(app.store, 'shower', !!x.shower, t); toggleTn(app.store, 'shave', !!x.shave, t); }
            else setDayState(app.store, ds, !!x.shower, !!x.shave, t);
        }
        app.renderAll();
        if (app.tonightChanged) app.tonightChanged('今晚洗澡 / 刮胡按习惯重填了');
    }, { title: '按习惯重填？', ok: '按习惯填' });
}

// ── 问顾问 ──
function accessHtml(app) {
    const a = app.ai.access();
    if (a === 'out' && app.sync && app.sync.state && app.sync.state.sdkMissing && app.store.state.owner) return `<div class="adv-access" id="adv-access" data-acc="out"><p class="lede">现在连不上登录服务。</p><p class="note">离线或网络不好时登录服务加载不出来；你的记录照常存在这台设备上，连上网重新打开就能问顾问。上面的方案和今晚的步骤不受影响。</p></div>`;
    if (a === 'out') return `<div class="adv-access" id="adv-access" data-acc="out"><p class="lede">问顾问要先登录。</p><p class="note">登录后能问护肤问题、拍成分表认产品、让顾问出方案和每周复盘。没登录也不影响上面的方案和今晚的步骤。</p>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-act="signin">用 Google 登录</button></div></div>`;
    if (a === 'mismatch') return `<div class="adv-access" id="adv-access" data-acc="mismatch"><p class="lede">这个账号用不了顾问。</p><p class="note">这个邮箱已经绑定了另一个账号，换回第一次用的登录方式试试。上面的方案和今晚的步骤照常排。</p></div>`;
    if (a === 'none') return `<div class="adv-access" id="adv-access" data-acc="none"><p class="lede">顾问是邀请制。</p><p class="note">每次调用都要花钱，现在只对受邀的人开放。没有邀请码也不影响上面的方案和今晚的步骤。</p>
        <label class="field"><span>邀请码</span><input type="text" id="adv-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="ABCDE-FGHJK"></label>
        <div class="btn-row adv-code-acts"><button type="button" class="btn btn-primary" id="adv-redeem">开通</button></div><p class="note faint">邀请码用一次就作废，两周内有效。</p></div>`;
    if (app.ai.state.down) return `<div class="adv-access" id="adv-access" data-acc="down"><p class="lede">顾问暂时连不上。</p><p class="note">今晚照上面这版方案排，记录不受影响。顾问的服务在 Cait 家里的电脑上，可能没开或者网络断了。</p>
        <div class="btn-row"><button type="button" class="btn" data-act="retry">重试</button></div></div>`;
    const q = app.ai.quotaText();
    if (q) return `<div class="adv-access" id="adv-access" data-acc="quota"><p class="lede">${esc(q)}</p><p class="note">今晚的步骤照离线规则排，记录不受影响。</p></div>`;
    const me = app.ai.state.meErr;
    if (!app.ai.ready() && PROBE.tried[uidOf(app)] && !PROBE.busy && me && me.code === 401) return `<div class="adv-access" id="adv-access" data-acc="signedout"><p class="lede">顾问没认出你的登录。</p><p class="note">到「设置」里退出再登录一次；今晚照上面这版方案排，记录不受影响。</p>
            <div class="btn-row"><button type="button" class="btn" data-act="retry">重试</button></div></div>`;
    if (!app.ai.ready()) return PROBE.tried[uidOf(app)] && !PROBE.busy
        ? `<div class="adv-access" id="adv-access" data-acc="noreply"><p class="lede">顾问这会儿没回应。</p><p class="note">今晚照上面这版方案排，记录不受影响。</p>
            <div class="btn-row"><button type="button" class="btn" data-act="retry">重试</button></div></div>`
        : `<div class="adv-access" id="adv-access" data-acc="connecting"><p class="note" role="status">在连顾问…</p></div>`;
    return '';
}
function reviewHtml(app, W) {
    const rv = aiState(app.store).review;
    if (!rv || !rv.data) return '';
    const d = rv.data;
    const rec = rv.rec && rv.rec.versionId ? Object.assign({ kind: 'review' }, rv.rec, { kind: 'review' }) : null;
    return `<div class="adv-review" id="adv-review"><div class="sec-h"><span class="sec-t">复盘 · ${esc(rv.week || '')}</span><span class="meta">${esc(mdAt(rv.at))}</span></div>
        <p class="lede">${esc(d.headline || '')}</p>${d.summary ? `<div class="note ink adv-rv-sum">${md(d.summary)}</div>` : ''}
        ${(d.wins || []).length ? `<dl class="kv adv-kv"><dt>做得好</dt><dd>${esc(d.wins.join('；'))}</dd></dl>` : ''}
        ${(d.issues || []).length ? `<dl class="kv adv-kv"><dt>要注意</dt><dd>${esc(d.issues.join('；'))}</dd></dl>` : ''}
        ${rec ? revHtml(W, rec, 'review') : ''}</div>`;
}
function chatHtml(app, W) {
    const acc = accessHtml(app);
    const talk = canTalk(app);
    const st = chatState(app);
    const owner = isOwner(app), me = app.ai.state.me;
    const status = talk && owner && me ? `今天 $${Number(me.today || 0).toFixed(2)}${me.daily_cap ? ' / $' + Number(me.daily_cap).toFixed(0) : ''} · 本期 $${Number(me.cycle || 0).toFixed(2)}` : talk ? '在线' : '';
    const msgs = st.chat.map((m, mi) => m.role === 'assistant'
        ? `<div class="msg ai"><span class="who">顾问 · ${esc(hm(m.at))}</span><div class="body">${md(m.text)}</div>${m.partial ? `<p class="note">没收完 · <button type="button" class="btn-link sm" data-reask="${mi}">重新问</button></p>` : ''}${(m.recs || []).map((r, ri) => revHtml(W, r, mi + '.' + ri)).join('')}${m.mem ? `<p class="note">${esc(m.mem)}</p>` : ''}${owner && m.meta && m.meta.cost != null ? `<p class="meta">${esc(m.meta.model || '')} · $${Number(m.meta.cost).toFixed(3)}</p>` : ''}</div>`
        : `<div class="msg me"><span class="who">你 · ${esc(hm(m.at))}${m.img ? ' · 带了一张图' : ''}</span><div class="body">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`).join('')
        + (ST.busy ? `<div class="msg ai"><span class="who">顾问</span><div class="body" id="adv-stream">${ST.stream ? md(ST.stream) : '<span class="note">在想…</span>'}</div><p class="btn-row"><button type="button" class="btn-link sm quiet" data-act="stop" id="adv-stop">停一下</button></p></div>` : '');
    const minimal = !!(W.profile || {}).minimalMode;
    const quick = (minimal ? ['今晚要换什么吗？', '这块干皮怎么办？'] : ['今晚能刷酸吗？', '这颗痘怎么办？', '这周怎么样？']);
    return `<section class="sec adv-chat" id="adv-chat">
        <div class="sec-h"><h2 class="sec-t">问顾问</h2><span class="btn-row">${status ? `<span class="meta" id="adv-status">${esc(status)}</span>` : ''}${talk ? `<button type="button" class="btn-link sm quiet" data-act="review"${ST.reviewBusy || ST.busy ? ' disabled' : ''}>${ST.reviewBusy ? '复盘中…' : '复盘这周'}</button>` : ''}${st.chat.length && !ST.busy ? '<button type="button" class="btn-link sm quiet" data-act="newchat">新对话</button>' : ''}</span></div>
        ${acc}
        ${reviewHtml(app, W)}
        <div class="adv-log" id="adv-log" aria-live="polite">${msgs || (talk ? '<p class="note adv-hello">问今晚能不能刷酸、某颗痘怎么办、要不要换产品都行。顾问改了今晚或方案会直接生效，每条都能撤销。</p>' : '')}</div>
        ${talk ? `<div class="chips adv-quick" id="adv-quick">${quick.map(q => `<button type="button" class="chip" data-quick="${esc(q)}"${ST.busy ? ' disabled' : ''}>${esc(q)}</button>`).join('')}</div>` : ''}
    </section>`;
}
function dockHtml(app) {
    if (!canTalk(app)) return '';
    return `<div class="adv-dock" id="adv-dock">
        ${ST.img ? `<div class="adv-pending" id="adv-pending"><img src="${esc(ST.img)}" alt="待发送的图片"><button type="button" class="btn-link sm quiet" data-act="unimg">移除</button></div>` : ''}
        <div class="adv-composer">
            <button type="button" class="adv-cam" id="adv-cam" aria-label="拍照：成分表，或随消息发一张">${ico('camera')}</button>
            <textarea id="adv-text" rows="1" aria-label="问顾问" placeholder="问顾问，或拍一张" enterkeyhint="send">${esc(ST.draft)}</textarea>
            <button type="button" class="adv-send" id="adv-send" aria-label="发送"${ST.busy ? ' disabled' : ''}>${ico('send')}</button>
        </div></div>`;
}
// 发出去的历史:改动的结果(「已直接改了…」「她点了撤销」)跟着那条助手消息一起发,顾问才知道改没改成(现算)
function histFor(W, list, n) {
    const send = list.slice(-n).map(m => {
        const after = m.role === 'assistant' ? (m.recs || []).map(r => recAfter(W, r)).join('') : '';
        return { role: m.role, text: m.text + (m.partial ? '\n\n（这条回答中途断了）' : '') + (after ? '\n\n' + after : '') };
    });
    while (send.length && send[0].role !== 'user') send.shift();
    return send;
}
async function ensureReady(app) {
    if (canTalk(app)) return true;
    if (app.ai.access() === 'on' && !app.ai.state.down) await app.ai.probe(true);
    if (canTalk(app)) return true;
    toast(app.ai.state.down ? '顾问连不上，先按离线规则来' : app.ai.quotaText() || '顾问还没开通');
    app.renderScreen('advisor');
    return false;
}
function regV(app) { const r = currentRegimen(app.world()); return r ? r.v : 0; }
export async function send(app, preset) {
    const ta = document.getElementById('adv-text');
    if (ta) ST.draft = ta.value;
    const text = String(preset != null ? preset : ST.draft || '').trim(), img = ST.img;
    if ((!text && !img) || ST.busy) return;
    if (!(await ensureReady(app))) return;
    const owner = ownerOf(app);
    const W = app.world(), st = chatState(app);
    freshCtx(app, W, st);
    st.chat.push({ role: 'user', text: text || '（看图）', img: !!img, at: Date.now() });
    st.chat = st.chat.slice(-CHAT_MAX);
    saveChat(app, st);
    if (preset == null) ST.draft = '';
    ST.img = null; ST.busy = true; ST.stream = '';
    app.renderScreen('advisor');
    scrollLog();
    const W1 = app.world();
    const res = await app.ai.api.chat({ messages: histFor(W, st.chat, CHAT_SEND), context: st.ctx, live: liveContext(W1, shownOf(app, W1)), image: img || undefined },
        t => { if (ownerOf(app) !== owner) return; ST.stream = t; const s = document.getElementById('adv-stream'); if (s) s.innerHTML = md(t); });
    if (ownerOf(app) !== owner) return;   // 等回答的时候换了账号:丢掉,不往另一个人的存档和对话里写(ST 已被 resetForUser 清过)
    ST.busy = false; ST.stream = '';
    const t2 = app.today();
    let reply = null;
    // 没收完(切后台断了)又没带改动 / 她点了「停一下」:按没回来处理;带了改动的(已经执行)留着,标「没收完」
    const usable = res.text && !res.aborted && !(res.partial && !res.act && !res.prop);
    if (usable) {   // 先执行改动(它会改存档),再读存档追加
        reply = { role: 'assistant', text: res.text, meta: res.meta, at: Date.now(), recs: [] };
        if (res.partial) reply.partial = true;
        if (res.act) { const r = applyTonight(app.store, res.act, t2, { aiData: aiTonightOf(app) }); if (r) reply.recs.push(Object.assign(r, { date: t2, at: Date.now() })); }
        if (res.prop && Array.isArray(res.prop.changes) && res.prop.changes.length) {
            const fromV = regV(app);
            const r = applyRegimen(app.store, res.prop.changes.slice(0, 8), { kind: 'chat', id: res.prop.id, reason: '对话里改的：' + String(res.prop.message || text).slice(0, 60), model: res.meta && res.meta.model, cost: res.meta && res.meta.cost }, t2);
            if ((res.prop.dropped || []).length) r.dropped = res.prop.dropped.slice(0, 6);
            reply.recs.push(Object.assign(r, { fromV, at: Date.now() }));
        }
        if (res.mem) {
            const parts = [];
            if ((res.mem.added || []).length) parts.push('记住了：' + res.mem.added.map(x => '「' + x.text + '」').join(''));
            if ((res.mem.removed || []).length) parts.push('忘掉了：' + res.mem.removed.map(x => '「' + x.text + '」').join(''));
            if (res.mem.blocked) parts.push(res.mem.blocked + ' 条不适合记，没存');
            if (parts.length) reply.mem = parts.join(' · ');
        }
    }
    const st2 = chatState(app);
    if (reply) st2.chat.push(reply);
    else { st2.chat.pop(); if (preset == null) ST.draft = text; ST.img = img; }   // 没回来:撤回刚才那条,字放回输入框
    saveChat(app, st2);
    if (res.err && !res.aborted) toast(res.err);
    app.renderAll();
    scrollLog();
}
function scrollLog() { const el = document.getElementById('adv-log'); if (el && el.lastElementChild) try { el.lastElementChild.scrollIntoView({ block: 'nearest' }); } catch (e) { } }
async function askPlan(app, request) {
    if (ST.planBusy || !(await ensureReady(app))) return;
    ST.planBusy = '顾问在按你现在的皮肤和家里的东西排方案…';
    app.renderScreen('advisor');
    try {
        const W = app.world(), fromV = regV(app), owner = ownerOf(app);
        const r = await app.ai.api.plan(buildSkincareContext(W, whoOf(app, W)), request);
        if (ownerOf(app) !== owner) return;   // 换了账号:丢掉
        const d = (r && r.data) || {};
        const reg = applyPlan(app.store, d, { model: r.model, cost: r.cost }, app.today());
        const st = chatState(app);
        freshCtx(app, app.world(), st);
        st.chat.push({ role: 'user', text: request || '让顾问出方案', at: Date.now() });
        st.chat.push({ role: 'assistant', text: d.rationale || '顾问按家里的东西和现在的皮肤出了一版方案。', meta: { model: r.model, cost: r.cost }, at: Date.now(),
            recs: [{ kind: 'plan', id: 'p' + Date.now(), versionId: reg.id, v: reg.v, fromV, changes: [], result: [], blocked: reg.blocked || [], state: 'applied', at: Date.now(),
                summary: '整套方案换成了顾问这一版' + ((d.gaps || []).length ? '，缺一环：' + d.gaps.map(g => g.label).join('、') : '') + '。' }] });
        st.chat = st.chat.slice(-CHAT_MAX);
        saveChat(app, st);
        toast('换成了顾问的方案 v' + reg.v + '，可以撤销');
    } catch (e) { toast(e.message || '顾问出错了'); }
    ST.planBusy = '';
    app.renderAll();
}
const TYPE2OP = { acid_freq: 'acid_freq', add_product: 'add_product', remove_product: 'remove_product', phase: 'phase', zone: 'zone', cleanse: 'cleanse', repair: 'repair' };
export async function runReview(app, auto) {
    if (ST.reviewBusy) return;
    if (auto ? !canTalk(app) : !(await ensureReady(app))) return;
    ST.reviewBusy = true;
    const t = app.today(), week = isoWeek(t), owner = ownerOf(app);
    if (auto) updateAiState(app.store, s => { s.reviewWeek = week; });   // 先占位:请求回来之前别再触发一次
    if (!auto) app.renderScreen('advisor');
    try {
        const W = app.world(), fromV = regV(app);
        const r = await app.ai.api.review(buildSkincareContext(W, whoOf(app, W)));
        if (ownerOf(app) !== owner) return;   // 复盘跑了一分钟,中途换了账号:结果属于上一个人,不写进这个人的方案和 sk_ai1
        const d = (r && r.data) || {};
        const changes = (d.adjustments || []).filter(x => x && TYPE2OP[x.type]).slice(0, 6).map(x => ({ op: TYPE2OP[x.type], product: x.type === 'phase' ? '' : (x.item || ''), value: x.value || '', why: x.reason || '' }));
        const rec = changes.length ? applyRegimen(app.store, changes, { kind: 'review', id: 'rv' + Date.now(), reason: '每周复盘：' + String(d.headline || '').slice(0, 50), rationale: d.summary || '', model: r.model, cost: r.cost }, t) : null;
        if (rec) Object.assign(rec, { fromV, at: Date.now() });
        updateAiState(app.store, s => { s.reviewWeek = week; s.review = { week, at: new Date().toISOString(), auto: !!auto, data: d, rec, replan: (d.adjustments || []).some(x => x && x.type === 'replan'), meta: { model: r.model, cost: r.cost } }; });
        if (!auto || rec) toast(rec && rec.state === 'applied' ? '复盘好了，方案按复盘调了，可以撤销' : '复盘好了');
    } catch (e) {
        if (ownerOf(app) !== owner) return;
        if (auto) updateAiState(app.store, s => { if (s.reviewWeek === week && !(s.review && s.review.week === week)) delete s.reviewWeek; });
        else toast(e.message || '顾问出错了');
    }
    ST.reviewBusy = false;
    app.renderAll();
}
// 每周一之后第一次打开顾问页,自动复盘一次(sk_ai1.reviewWeek 跟云走,两台设备不会各跑一遍);近两周至少自己记了 3 天皮肤才跑
function maybeAutoReview(app) {
    if (!canTalk(app) || ST.reviewBusy || ST.busy || !dataNoticeSeen(app)) return;
    if (app.store.state && app.store.state.applyingCloud) return;
    const W = app.world(), s = aiState(app.store), week = isoWeek(W.today);
    if (s.reviewWeek === week) return;
    const from = addDays(W.today, -13);
    const n = (W.journal || []).filter(e => e && e.date >= from && e.date <= W.today && !e.auto && (e.status || []).length).length;
    if (n < 3) return;
    runReview(app, true);
}
// 修订线上的「撤销 / 重做」
// 修订线的 key → rec(和 recAct 同一套:'review' 或 '对话第几条.第几个')
function findRecByKey(app, key) {
    if (key === 'review') { const s = aiState(app.store); return s.review && s.review.rec ? Object.assign({}, s.review.rec, { kind: 'review' }) : null; }
    const [mi, ri] = key.split('.').map(Number), st = chatState(app);
    return (st.chat[mi] && (st.chat[mi].recs || [])[ri]) || null;
}
function recAct(app, key) {
    const t = app.today(), W = app.world();
    let rec, save;
    if (key === 'review') {
        const s = aiState(app.store); rec = s.review && s.review.rec; if (!rec) return;
        rec = Object.assign({}, rec, { kind: 'review' });
        // v1 靠 review.rec.state 显示和决定能不能撤:撤销 / 重做时一起写(保持 v1 读得懂)
        save = r => updateAiState(app.store, x => { if (x.review && x.review.rec) Object.assign(x.review.rec, { versionId: r.versionId, v: r.v, state: 'applied' }); });
    } else {
        const [mi, ri] = key.split('.').map(Number), st = chatState(app);
        rec = st.chat[mi] && (st.chat[mi].recs || [])[ri]; if (!rec) return;
        save = r => { const st2 = chatState(app); const x = st2.chat[mi] && st2.chat[mi].recs[ri]; if (x) { x.versionId = r.versionId; x.v = r.v; saveChat(app, st2); } };
    }
    const s = recLive(W, rec);
    if (s === 'applied') {
        const why = rec.kind === 'tonight' ? undoTonightChange(app.store, rec.id, t) : undoRegimenChange(app.store, rec.versionId, t);
        if (why) { toast(why); return; }
        if (key === 'review') updateAiState(app.store, x => { if (x.review && x.review.rec) x.review.rec.state = 'undone'; });
        toast(rec.kind === 'tonight' ? '已撤销，今晚回到改之前' : '已撤销，方案回到上一版');
    } else if (s === 'undone') {
        if (rec.kind === 'tonight') {
            const ok = (rec.changes || []).filter((c, k) => !(rec.result || [])[k]);
            const r = applyTonight(app.store, { id: rec.id, changes: ok }, t, { aiData: aiTonightOf(app) });
            if (!r || r.state !== 'applied') { toast('重做没成：' + ((r && r.result.filter(Boolean)[0]) || '今晚已经变了')); return; }
            toast('重做了，今晚又按顾问改的来');
        } else {
            const reg = restoreRegimenLocal(app.store, rec.versionId, '重做 v' + rec.v, t);
            if (!reg) { toast('那一版已经不在历史里了，直接跟顾问说'); return; }
            save({ versionId: reg.id, v: reg.v });
            toast('重做了，方案回到 v' + rec.v + ' 那一版（现在是 v' + reg.v + '）');
        }
    } else return;
    app.renderAll();
}

// ── 给今晚页用(整合时接):对话里今天最近一条「改了今晚」和它现在的状态;撤销 / 重做走同一个 recAct,两边自然一致 ──
//   今晚页自己的「已撤销 · 重做」只记在它模块里;在对话里撤的,今晚页靠这个也能显示「已撤销 · 重做」。
export function lastTonightRec(app) {
    const W = app.world(), chat = chatState(app).chat;
    for (let mi = chat.length - 1; mi >= 0; mi--) {
        const recs = chat[mi].recs || [];
        for (let ri = recs.length - 1; ri >= 0; ri--) {
            const r = recs[ri];
            if (r && r.kind === 'tonight' && r.date === W.today) return { key: mi + '.' + ri, rec: r, state: recLive(W, r) };
        }
    }
    return null;
}
export function revAct(app, key) { recAct(app, key); }
// 今天顾问在对话 / 出方案 / 复盘里落成的最近一版方案(和对话里那条修订线同源);今晚页拿它挂「改了方案 · 撤销」
export function lastRegimenRec(app) {
    const W = app.world(), hist = W.regimen || [], cands = [];
    const today = id => hist.some(h => h.id === id && h.date === W.today);
    chatState(app).chat.forEach((m, mi) => (m.recs || []).forEach((r, ri) => { if (r && (r.kind === 'regimen' || r.kind === 'plan') && r.versionId && today(r.versionId)) cands.push({ key: mi + '.' + ri, rec: r }); }));
    const rv = aiState(app.store).review;
    if (rv && rv.rec && rv.rec.versionId && today(rv.rec.versionId)) cands.push({ key: 'review', rec: Object.assign({}, rv.rec, { kind: 'review', at: rv.rec.at || rv.at }) });
    if (!cands.length) return null;
    const at = r => +new Date(r.at) || +r.at || 0;
    const best = cands.sort((a, b) => at(a.rec) - at(b.rec)).pop();
    const rows = recRows(best.rec).filter(r => !r.bad).map(r => r.txt + (r.part ? '（' + r.part + '）' : ''));
    return Object.assign(best, { state: recLive(W, best.rec), text: best.rec.kind === 'plan' ? (best.rec.summary || '') : rows.join('；') + (rows.length ? '。' : '') });
}

// ── 从别的页跳过来问(产品「问顾问」、常识「问顾问这一条」):预填,不自动发 ──
export function askAdvisor(app, text) {
    ST.draft = String(text || '');
    ST.focus = true;
    // 在方案 / 常识那样的二级页里问:入栈回到对话首页(返回键能回到刚才那页)
    if (app.go && /^#\/advisor\/./.test(location.hash)) app.go('advisor', { replace: false });
    else if (app.show) app.show('advisor'); else app.renderScreen('advisor');
}

// ── 拍照:拍成分表(去产品页认)/ 随这条消息发一张 ──
function photoMenu(app) {
    openSheet({ id: 'adv-photo', title: '拍什么？', html: `<div class="acts stack-acts">
        <label class="btn btn-block file-btn">${ico('camera')}拍成分表，认是什么产品<input type="file" accept="image/*" id="adv-ph-label"></label>
        <label class="btn btn-block file-btn">${ico('camera')}随这条消息发一张图<input type="file" accept="image/*" id="adv-ph-attach"></label></div>
        <p class="note">拍皮肤做全套分析在「记录」里。照片只在发出去的这一次用，不会存到服务器。</p>`,
        onMount: ov => {
            const lb = ov.querySelector('#adv-ph-label'), at = ov.querySelector('#adv-ph-attach');
            lb.addEventListener('change', () => { const f = lb.files && lb.files[0]; lb.value = ''; closeSheet('adv-photo'); if (!f) return; app.show('products'); readLabelFromFile(app, f); });
            at.addEventListener('change', async () => {
                const f = at.files && at.files[0]; at.value = ''; closeSheet('adv-photo'); if (!f) return;
                const ta = document.getElementById('adv-text'); if (ta) ST.draft = ta.value;
                try { ST.img = await imageToDataURL(f, 1024); } catch (e) { toast(e.message); return; }
                app.renderScreen('advisor');
            });
        } });
}

// ══ 渲染 ═══════════════════════════════════════════════════════════════════════════════
// 现在的方案那条 navRow 的右边一句:v几 · 日期(没方案时说还没有)
function planNow(W) {
    if (!(W.products || []).some(p => !p.hidden)) return '还没有方案';
    const reg = currentRegimen(W);
    return reg ? 'v' + reg.v + ' · ' + (mdAt(reg.at) || mdShort(reg.date)) : '';
}
// 顾问首页 = 对话(复盘卡、「复盘这周」在对话区)+ 两条「→」行;方案、常识各自一页(pages)
export function render(app) {
    const W = app.world();
    return `<h1 class="page-title" id="advisor-h">${esc(title)}</h1>
        ${chatHtml(app, W)}
        <nav class="grp nav-list" aria-label="顾问">${navRow('#/advisor/plan', '现在的方案', planNow(W), 'adv-go-plan')}${navRow('#/advisor/guide', '护肤常识', '', 'adv-go-guide')}</nav>
        ${dockHtml(app)}`;
}
// 方案页:阶梯、这一版的细则、版本与撤销、重排(原来在顾问首页顶上,极简模式收在 adv-minfold 里)
function bindPlan(root, app) {
    const t = () => app.today();
    root.querySelectorAll('[data-go="products"]').forEach(b => b.addEventListener('click', () => app.show('products')));
    const lb = root.querySelector('#adv-ladder-btn');
    if (lb) lb.addEventListener('click', () => {
        ST.ladderOpen = !ST.ladderOpen;
        lb.setAttribute('aria-expanded', ST.ladderOpen ? 'true' : 'false');
        const box = root.querySelector('#adv-ladder'); if (box) box.hidden = !ST.ladderOpen;
    });
    root.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', () => {
        const hid = b.dataset.hist, v = b.dataset.v;
        if (b.dataset.latest === '1') sysConfirm('撤销 v' + v + '，回到上一版？', () => {
            const why = undoRegimenChange(app.store, hid, t());
            if (why) toast(why); else toast('已撤销，方案回到上一版');
            app.renderAll();
        }, { ok: '撤销' });
        else sysConfirm('回到 v' + v + '？会把它复制成新的一版，现在这版留在历史里。', () => {
            const reg = restoreRegimenLocal(app.store, hid, '回到 v' + v, t());
            if (reg) toast('方案回到 v' + v + ' 那一版（现在是 v' + reg.v + '）');
            app.renderAll();
        }, { ok: '回到这一版' });
    }));
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.act === 'ask-plan') askAdvisor(app, '关于现在这版方案：');
        else if (b.dataset.act === 'plan') askPlan(app);
    }));
}
// 接下来 7 晚:点「澡」「刮」直接改、点日期看那晚的步骤、存成每周习惯 / 按习惯重填
export function bindWeek(root, app) {
    root.querySelectorAll('.n7-b').forEach(b => b.addEventListener('click', () => toggleNight(app, b.dataset.date, b.dataset.k)));
    root.querySelectorAll('[data-night]').forEach(b => b.addEventListener('click', () => nightSheet(app, b.dataset.night)));
    const hs = root.querySelector('#adv-habit-save'); if (hs) hs.addEventListener('click', () => saveWeekHabit(app));
    const hf = root.querySelector('#adv-habit-fill'); if (hf) hf.addEventListener('click', () => fillWeekHabit(app));
}
export const pages = {
    plan: { title: '现在的方案', render: app => planHtml(app, app.world()), mount: (body, app) => bindPlan(body, app) },
    guide: {
        title: '护肤常识',
        render: app => `<section class="sec adv-guide-sec">${renderGuide(app.world().profile || {}, { canAsk: canTalk(app) })}</section>`,
        mount: (body, app) => bindGuide(body, app.world().profile, txt => askAdvisor(app, txt))
    }
};
export function mount(root, app) {
    ensureShopRunner(app);
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.act;
        if (a === 'signin') app.signIn();
        else if (a === 'retry') { b.disabled = true; await app.ai.probe(true); app.renderScreen('advisor'); }
        else if (a === 'review') runReview(app, false);
        else if (a === 'unimg') { const ta = document.getElementById('adv-text'); if (ta) ST.draft = ta.value; ST.img = null; app.renderScreen('advisor'); }
        else if (a === 'stop') {   // 排着队的也马上停(client.js);什么都没停到 = 状态是旧的,直接收起「在想…」
            const any = app.ai.abort ? app.ai.abort() : false;
            if (!any && ST.busy) { ST.busy = false; ST.stream = ''; app.renderScreen('advisor'); }
        }
        else if (a === 'newchat') sysConfirm('开始新对话？之前的对话会清掉（已经改过的今晚和方案不受影响）。', () => { saveChat(app, { uid: uidOf(app), chat: [], ctx: null }); app.renderScreen('advisor'); }, { ok: '开始新对话' });
    }));
    const red = root.querySelector('#adv-redeem'), code = root.querySelector('#adv-code');
    const redeem = async () => {
        const c = (code && code.value || '').trim();
        if (!c) { if (code) code.focus(); return; }
        red.disabled = true; red.textContent = '核对中…';
        try { const r = await app.ai.redeem(c); toast(r && r.name ? '开通了，' + r.name : '开通了'); app.renderAll(); }
        catch (e) { red.disabled = false; red.textContent = '开通'; toast(e.message || '邀请码不对'); }
    };
    if (red) red.addEventListener('click', redeem);
    if (code) code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); redeem(); } });
    root.querySelectorAll('[data-recact]').forEach(b => b.addEventListener('click', () => recAct(app, b.dataset.recact)));
    root.querySelectorAll('[data-recask]').forEach(b => b.addEventListener('click', () => {
        const rec = findRecByKey(app, b.dataset.recask); if (!rec) return;
        askAdvisor(app, b.dataset.mode === 'revise' ? '关于' + recAskLabel(rec) + '，我想改一下：' : '关于' + recAskLabel(rec) + '，我想聊聊：');
    }));
    // 没收完的那条:把它前面她问的那句再发一次
    root.querySelectorAll('[data-reask]').forEach(b => b.addEventListener('click', () => {
        const chat = chatState(app).chat, mi = +b.dataset.reask;
        for (let i = mi - 1; i >= 0; i--) if (chat[i] && chat[i].role === 'user') { if (!chat[i].img) send(app, chat[i].text); else askAdvisor(app, chat[i].text); return; }
    }));
    root.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => send(app, b.dataset.quick)));
    const ta = root.querySelector('#adv-text');
    if (ta) {
        // 跟着字数长高(最多 4 行);用 rows,不写 style=(纸墨验收:模板里没有内联样式)
        const grow = () => { ta.rows = 1; while (ta.rows < 4 && ta.scrollHeight > ta.clientHeight + 2) ta.rows++; };
        ta.addEventListener('input', () => { ST.draft = ta.value; grow(); });
        ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(app); } });
        if (ta.value) grow();
        if (ST.focus) { ST.focus = false; setTimeout(() => { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: 'nearest' }); } catch (e) { } }, 60); }
    }
    const sb = root.querySelector('#adv-send'); if (sb) sb.addEventListener('click', () => send(app));
    const cam = root.querySelector('#adv-cam'); if (cam) cam.addEventListener('click', () => photoMenu(app));
    // 开通状态还没核过:核完了重画这一屏(只核一次,别和别处的重画互相触发)
    probeOnce(app, () => { const sec = document.getElementById('advisor'); if (sec && sec.classList.contains('active')) app.renderScreen('advisor'); });
    maybeDataNotice(app);
    maybeAutoReview(app);
}
