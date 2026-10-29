// ══ 设置(页头右上角印章打开)═══════════════════════════════════════════════════════════
// 一个 sheet,从上到下:账号与同步 → 怎么用(完整 / 极简、记录页开关)→ 你的情况(刮胡、HRT、卸妆、肤质、想解决的、避开的区域)
//   → 洗澡习惯(和顾问页「存成每周习惯」同一份 sk_preset1)→ 刷酸时机 + 高级手动覆盖 → 照片分析(按账号,非主账号默认关、本人同意才开)
//   → 外观(深浅色默认跟随系统、印章字)→ 顾问(开通、记得的事、模型)→ 数据(导出 / 恢复备份 / 恢复副本)→ 数据说明 → 重新做引导 / 改版说明。
// 写档案一律走 model/profile.js 的 updateProfile(读 → 改 → 写回,别拿内存旧档案盖掉刚同步来的);洗澡习惯走 model/week.js。
// 【要紧】#sync-line / #sync-choose / #auth-btn 这几个 id 不能改:sync.js 的状态回调和整页同步测试(s-85)直接找它们。
import { LOCAL_KEYS, CLOUD_KEYS } from '../store.js';
import { openSheet, closeSheet, esc, toast, sysConfirm, download } from './sheets.js';
import { updateProfile, ZONE_PRESETS, userZones, CONCERN_ADVICE, CONCERN_AXIS } from '../model/profile.js';
import { habitPreset, saveHabit, getDayState, setDayState } from '../model/week.js';
import { acidTiming } from '../engine/rules.js';
import { axisScore, SCORE_PRIOR } from '../engine/score.js';
import { lastNDays } from '../engine/util.js';
import { addDays, dowOf } from '../clock.js';
import { startOobe, showWhatsNew } from './oobe.js';
import { photoAnalysisOn, PHOTO_FIELD } from './capture.js';
import { invalidateChatCtx } from './advisor.js';

// 极简模式是什么,全 App 只有这一种说法(引导、设置都照它)
export const MINIMAL_DESC = '护肤品不用打卡，排上的默认都算用了；哪一步没做点一下「今晚没做」。皮肤想记就记，不会催。';
export const FULL_DESC = '每晚点一下做了哪几步，做完记一下皮肤，「记录」页能看到走势。';
export const SKIN_BASE = [['oily', '油'], ['combo', '混'], ['normal', '中'], ['dry', '干']];
const SKIN_BASE_LABEL = { oily: '油皮', combo: '混合皮', normal: '中性皮', dry: '干皮' };
export const BASE_TRAITS = ['易闭口', '易出油', '易泛红', '易干'];
export const CONCERNS = Object.keys(CONCERN_ADVICE);
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0], WD = ['日', '一', '二', '三', '四', '五', '六'];

// ── 外观:跟随系统(默认)/ 纸 / 夜 / 晚上自动。sk_theme 只在本机(LOCAL_KEYS.theme)。首帧那段在 index.html <head> 里,和这里同一套判断 ──
export function themeIsDark(v) {
    const h = new Date().getHours();
    let sys = false; try { sys = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { }
    return v === 'dark' || (v === 'auto' && (h >= 21 || h < 7)) || ((v || 'system') === 'system' && sys);
}
export function currentTheme() { try { return localStorage.getItem(LOCAL_KEYS.theme) || 'system'; } catch (e) { return 'system'; } }
export function applyTheme(v) {
    const d = themeIsDark(v || currentTheme());
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', d ? '#161412' : '#f4f1ea');
}
// 系统切深浅色 / 跨过 21 点:跟着变(整合时 app.js 启动调一次)
let _watching = false;
export function watchTheme() {
    if (_watching) return; _watching = true;
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme()); } catch (e) { }
    setInterval(() => { if (currentTheme() === 'auto') applyTheme(); }, 300000);
}

// ── 照片分析:按账号开关(profile.photoAnalysis)。没设过 = 主账号开、其他账号关(Cici 要她本人同意才开)。
//    判断只有一份:capture.js 的 photoAnalysisOn(app)(拍照那边也用它);这里只负责写开关。

// ── 肤质 / 想解决的 / 避开的区域:设置和引导共用 ──
const chip = (on, label, attrs) => `<button type="button" class="chip" aria-pressed="${!!on}" ${attrs}>${label}</button>`;
export function skinChipsHtml(P) {
    const cc = P.concerns || [], zs = userZones(P).map(z => z.name);
    return `<div class="set-sub"><div class="sec-t">肤质底色</div><div class="chips" id="set-base">${SKIN_BASE.map(([k, l]) => chip(P.skinBase === k, esc(l), `data-base="${k}"`)).join('')}</div>
            <div class="chips set-traits" id="set-basetraits">${BASE_TRAITS.map(t => chip((P.baseTraits || []).indexOf(t) >= 0, esc(t), `data-btrait="${esc(t)}"`)).join('')}</div></div>
        <div class="set-sub"><div class="sec-t">想解决的（最多 2 个，按点的先后）</div><div class="chips" id="set-concerns">${CONCERNS.map(c => { const i = cc.indexOf(c); return chip(i >= 0, (i >= 0 ? '<span class="mono">' + (i + 1) + '</span> ' : '') + esc(c), `data-concern="${esc(c)}"`); }).join('')}</div></div>
        <div class="set-sub"><div class="sec-t">要避开的区域</div><div class="chips" id="set-zones">${ZONE_PRESETS.map(z => chip(zs.indexOf(z.name) >= 0, esc(z.name), `data-zone="${esc(z.name)}"`)).join('')}</div>
            <p class="note">${zs.length ? '已避开：' + esc(userZones(P).map(z => z.name + '（' + (z.care || '') + '）').join('；')) : '某块皮肤反复出问题（比如人中长疹子）就选上，那里不上酸、面膜、维 A。'}</p></div>`;
}
export function bindSkinChips(root, app, after) {
    const done = () => { app.renderAll(); if (after) after(); };
    root.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => {
        updateProfile(app.store, p => { p.skinBase = p.skinBase === b.dataset.base ? '' : b.dataset.base; if (SKIN_BASE_LABEL[p.skinBase]) p.skinType = SKIN_BASE_LABEL[p.skinBase]; });
        done();
    }));
    root.querySelectorAll('[data-btrait]').forEach(b => b.addEventListener('click', () => {
        updateProfile(app.store, p => { const l = (p.baseTraits || []).slice(), i = l.indexOf(b.dataset.btrait); if (i >= 0) l.splice(i, 1); else l.push(b.dataset.btrait); p.baseTraits = l; });
        done();
    }));
    root.querySelectorAll('[data-concern]').forEach(b => b.addEventListener('click', () => {
        const W = app.world();
        updateProfile(app.store, p => {
            let l = (p.concerns || []).slice(); const c = b.dataset.concern, i = l.indexOf(c);
            if (i >= 0) l.splice(i, 1); else { l.push(c); if (l.length > 2) l = l.slice(-2); }
            p.concerns = l;
            if (l.length) { const axis = CONCERN_AXIS[l[0]] || 'congestion', cur = axisScore(axis, lastNDays(W, 7)), s = cur === null ? SCORE_PRIOR : cur;
                p.goal = { concern: l[0], axis, start: W.today, startScore: s, target: Math.max(85, Math.min(100, s + 10)) }; }
            else delete p.goal;
        });
        done();
    }));
    root.querySelectorAll('[data-zone]').forEach(b => b.addEventListener('click', () => {
        const preset = ZONE_PRESETS.find(z => z.name === b.dataset.zone); if (!preset) return;
        updateProfile(app.store, p => { const l = (p.zones || []).slice(), i = l.findIndex(z => z && z.name === preset.name); if (i >= 0) l.splice(i, 1); else l.push(JSON.parse(JSON.stringify(preset))); p.zones = l; });
        done();
    }));
}

// ── 小件 ──
const sw = (id, label, on, extra) => `<label class="sw-row"${extra || ''}><span>${label}</span><span class="sw"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><i></i></span></label>`;
const seg = (name, cur, opts, label) => `<div class="seg set-seg" role="radiogroup" aria-label="${esc(label)}" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" data-v="${esc(v)}" aria-checked="${cur === v}">${esc(l)}</button>`).join('')}</div>`;
function curUser(app) { return (app.sync && app.sync.state && app.sync.state.user) || null; }
function isOwner(app) { try { return !!app.sync.isOwner(curUser(app)); } catch (e) { return false; } }
const TIMING_TXT = { neutral: '无所谓', avoid: '避开刚洗完热水澡', prefer: '洗澡夜优先' };
export const DATA_NOTE = [
    '你的记录（每天的皮肤、货架、方案、设置）存在这台设备上；登录后同步到 Google Firebase 里你自己账号的那一份，只有你自己能读写。顾问对你记录的回应、每周复盘的结果也跟着同步。',
    '这些会自动发给顾问：今晚页每天排一次；你记完皮肤、完成今晚后回一句；每周第一次打开顾问页复盘一次（近两周记了 3 天以上才跑）；货架上标了用完 / 快用完之后判断要不要买。你问顾问、出方案、读成分表时也发。这些请求带着你记录的快照（还有你账号名字的第一个词），先到 Cait 家里的顾问服务器，再用 Cait 的 Anthropic API 组织调用 Claude 生成回答。服务器只记每次花了多少钱，不存对话和照片。',
    '对话里顾问会自己记下以后也要用的事（比如对某成分的反应、过敏、偏好），存在服务器上；记了会在那条回答下面写「记住了」，在这里的「顾问记得的事」能看、能删。',
    '对话、「要不要买新的」的结果只存在这台设备上，换设备不带过去。',
    '照片只存在这台设备上（浏览器的本机数据库），不进云端同步。只有你点了分析、读成分表或随消息发图时，才把照片发给顾问：分析时是这次拍的那几张，这台设备上存着上一次分析时的正脸照片的话，也会一起发过去对比（拍之前能选不带）。分析完服务器不留，存下来的只有分析结果（进当天的记录）。',
    'HRT 只在你自己打开了 HRT 时才进顾问看到的快照；两个账号的数据互相看不到。'
];
// 主账号:家里的服务器会另外附上运营者自己在服务器上记的 HRT 用药和化验(server 端,和 App 里的开关无关;这里照实说,不写具体内容)
export const DATA_NOTE_OWNER = '你是主账号：家里的服务器会另外附上你在服务器上单独记的 HRT 用药和化验，和 App 里的 HRT 开关无关。';

function body(app) {
    const s = app.sync, u = s.state.user, W = app.world(), P = W.profile || {};
    const minimal = !!P.minimalMode, owner = isOwner(app);
    const acc = app.ai.access(), me = app.ai.state.me;
    const hp = habitPreset(W.preset, P);
    const at = acidTiming(W);
    const photoOn = photoAnalysisOn(app);
    let opts = {}; try { opts = JSON.parse(app.store.getLocal(LOCAL_KEYS.aiOpts)) || {}; } catch (e) { }
    const accTxt = acc === 'out' ? '没登录：登录后才能用顾问。' : acc === 'none' ? '顾问是邀请制，这个账号还没开通。' : acc === 'mismatch' ? '这个邮箱绑定了另一个账号，用不了顾问。'
        : app.ai.state.down ? '已开通，这会儿连不上。' : app.ai.quotaText() || (app.ai.ready() ? '已开通。' : '已开通，正在连。');
    return `<div class="sheet-sec"><div class="sec-t">账号与同步</div>
        <div id="auth-btn">${u
            ? `<div class="row"><span class="row-main"><span class="lede">${esc(u.displayName ? String(u.displayName).split(' ')[0] : '已登录')}</span>${u.email ? `<span class="meta">${esc(u.email)}</span>` : ''}</span><button type="button" class="btn-link quiet" data-act="signout">退出登录</button></div>`
            : `<button type="button" class="btn btn-primary btn-block" data-act="signin">用 Google 登录（换手机数据还在）</button>`}</div>
        <p class="note" id="sync-line">${esc(s.syncLineText())}</p>
        <button type="button" class="btn btn-primary" id="sync-choose" data-act="choose"${s.state.conflict ? '' : ' hidden'}>选一份记录</button></div>

    <div class="sheet-sec" id="set-mode-sec"><div class="sec-t">怎么用</div>
        ${seg('mode', minimal ? 'min' : 'full', [['min', '只看今晚'], ['full', '记录并看变化']], '怎么用')}
        <p class="note set-mode-note" id="set-mode-note">${esc(minimal ? MINIMAL_DESC : FULL_DESC)}</p>
        ${minimal ? sw('set-showrec', '显示「记录」页', P.hideRecords !== true) : '<p class="note faint">这个用法下「记录」页一直在。</p>'}</div>

    <div class="sheet-sec" id="set-you"><div class="sec-t">你的情况</div>
        ${sw('set-shave', '刮胡', !!P.shaving)}
        ${sw('set-hrt', 'HRT', !!P.hrt)}
        <p class="note set-hint">${owner ? '只影响你自己这个账号：App 里记的 HRT 阶段只在打开时带给顾问，也只在打开时按周期调酸；家里的服务器另外会附上你在服务器上记的用药和化验，和这个开关无关。' : '只影响你自己这个账号：开了 HRT 才会按周期调酸，顾问也才看得到。'}</p>
        ${sw('set-premakeup', '需要卸妆步骤', !!P.useMakeupRemoval)}
        ${sw('set-care', '在看医生 / 用药', P.startState === 'care' && !!P.careAt)}
        <p class="note set-hint">打开时护肤只排清洁、保湿、修护和眼霜，酸、面膜、维 A、精华、面油都先不上，医生开的药优先；顾问也会看到。</p>
        ${skinChipsHtml(P)}</div>

    <div class="sheet-sec" id="set-habit"><div class="sec-t">通常哪几天洗澡${P.shaving ? '、刮胡' : ''}</div>
        ${P.shaving ? '<div class="set-days-l">洗澡</div>' : ''}
        <div class="chips set-days" id="set-shower" role="group" aria-label="洗澡">${WEEK_ORDER.map(d => chip(!!(hp.find(x => x.dow === d) || {}).shower, WD[d], `data-hd="${d}" data-hk="shower" aria-label="周${WD[d]}洗澡"`)).join('')}</div>
        ${P.shaving ? `<div class="set-days-l">刮胡</div><div class="chips set-days" id="set-shavedays" role="group" aria-label="刮胡">${WEEK_ORDER.map(d => chip(!!(hp.find(x => x.dow === d) || {}).shave, WD[d], `data-hd="${d}" data-hk="shave" aria-label="周${WD[d]}刮胡"`)).join('')}</div>` : ''}
        <p class="note">和顾问页「未来 7 晚」的「存成每周习惯」是同一份。改了以后，明天起两周按新习惯排；${minimal ? (P.shaving ? '今晚洗澡在「顾问」页的未来 7 晚里点，今晚刮胡在今晚页点。' : '今晚的在「顾问」页的未来 7 晚里点。') : '今晚在今晚页改。'}</p></div>

    <div class="sheet-sec" id="set-timing"><div class="sec-t">刷酸时机</div>
        ${seg('timing', P.acidTiming || '', [['', '交给方案'], ['avoid', '避开刚洗完澡'], ['prefer', '洗澡夜优先'], ['neutral', '无所谓']], '刷酸时机')}
        <p class="note">${P.acidTiming ? '你手动定的。' : '交给方案：现在是「' + esc(TIMING_TXT[at] || at) + '」' + (at === 'avoid' ? '（有要避开的区域，或近两周泛红、刺痛过）' : '') + '。'}热水泡过的皮肤屏障会短暂变弱，易泛红的人别在那时刷。</p>
        <details class="fold set-adv"><summary><span class="fold-sum"><span class="lede">高级 · 手动覆盖</span><span class="note">默认交给方案</span></span></summary><div class="fold-body">
            <label class="field"><span>修护霜用法</span><select id="set-repairuse"><option value="">交给方案</option><option value="full"${P.repairUse === 'full' ? ' selected' : ''}>全脸薄涂</option><option value="spot"${P.repairUse === 'spot' ? ' selected' : ''}>只点涂</option></select></label>
            <label class="field"><span>没连上顾问时的刷酸档位</span><select id="set-acidlevel"><option value="">${minimal ? '自动（停在每周 1 次，不会自己加）' : '自动（没刺激就一档档加）'}</option>${[1, 2, 3].map(n => `<option value="${n}"${+P.acidLevel === n ? ' selected' : ''}>每周 ${n} 次</option>`).join('')}</select></label>
        </div></details></div>

    <div class="sheet-sec" id="set-photo"><div class="sec-t">照片分析</div>
        ${sw('set-photoai', '拍的皮肤照片可以发给顾问分析', photoOn)}
        <p class="note">${photoOn ? '开着：你点「分析」时，那几张照片（本机有上一次的正脸照片的话也一起）发给顾问逐区看，结果记进当天。' : '关着：照片只存在这台设备上，不发给顾问。'}每个账号单独开关，只有本人能开。</p></div>

    <div class="sheet-sec" id="set-look"><div class="sec-t">外观</div>
        ${seg('theme', currentTheme(), [['system', '跟随系统'], ['light', '纸'], ['dark', '夜'], ['auto', '晚上自动']], '外观')}
        <p class="note">晚上自动：21:00 到早上 7:00 用夜间配色。</p>
        <label class="field field-row"><span>印章上的字</span><input type="text" id="set-seal" maxlength="1" autocomplete="off" placeholder="一个字" value="${esc(P.seal || P.stamp || '')}"></label></div>

    <div class="sheet-sec" id="set-ai"><div class="sec-t">顾问</div>
        <p class="note" id="set-ai-st">${esc(accTxt)}</p>
        ${acc === 'none' ? `<label class="field"><span>邀请码</span><input type="text" id="set-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="ABCDE-FGHJK"></label><div class="btn-row"><button type="button" class="btn btn-primary" data-act="redeem">开通</button></div>` : ''}
        ${acc === 'on' && !app.ai.state.down ? `<div class="btn-row"><button type="button" class="btn" data-act="memory">顾问记得的事</button></div>` : ''}
        ${owner && me ? `<div class="set-sub"><div class="sec-t">模型与用量（只有你看得到）</div><p class="meta">今天 $${Number(me.today || 0).toFixed(2)}${me.daily_cap ? ' / $' + Number(me.daily_cap).toFixed(0) : ''} · 本期 $${Number(me.cycle || 0).toFixed(2)}</p>
            <label class="field"><span>模型</span><select id="set-model"><option value="">自动（按任务挑）</option>${(me.models || []).map(m => `<option value="${esc(m[0])}"${opts.model === m[0] ? ' selected' : ''}>${esc(m[1] + (m[2] ? ' · ' + m[2] : ''))}</option>`).join('')}</select></label>
            <label class="field"><span>思考深度${opts.model ? '' : '（选了模型才生效）'}</span><select id="set-effort"${opts.model ? '' : ' disabled'}>${(me.efforts || []).map(e => `<option value="${esc(e[0])}"${(opts.effort || 'medium') === e[0] ? ' selected' : ''}>${esc(e[1])}</option>`).join('')}</select></label></div>` : ''}</div>

    <div class="sheet-sec" id="set-data"><div class="sec-t">数据</div>
        <div class="btn-row"><button type="button" class="btn" data-act="export">导出备份</button><label class="btn file-btn">恢复备份<input type="file" accept=".json,application/json" id="set-import"></label><button type="button" class="btn" data-act="recovery">恢复副本</button></div>
        <p class="note">备份里有全部记录和这台设备上的照片。恢复之前，现在的记录会先另存一份恢复副本。</p>
        <details class="fold" id="set-privacy"><summary><span class="fold-sum"><span class="lede">数据说明</span><span class="note">存在哪、发给谁</span></span></summary><div class="fold-body"><ul class="list note">${DATA_NOTE.concat(owner ? [DATA_NOTE_OWNER] : []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></details></div>

    <div class="sheet-sec set-end"><div class="btn-row"><button type="button" class="btn-link quiet" data-act="oobe">重新做引导</button><button type="button" class="btn-link quiet" data-act="whatsnew">这一版改了什么</button></div></div>`;
}

function paint(app) {
    const ov = document.getElementById('settings-sheet'); if (!ov) return;
    const bd = ov.querySelector('.sheet-b'); if (!bd) return;
    bd.innerHTML = body(app);
    bind(ov, app);
}
function changed(app) { app.renderAll(); paint(app); }
// 档案改了:模式 / 刮胡 / 刷酸时机 / 修护用法 / 酸的档位都可能改了今晚的前提 → 让今晚重排(tonight.js 签名没变就不调,改外观这类不花钱)
function setProfile(app, fn) { updateProfile(app.store, fn); changed(app); if (app.tonightChanged) app.tonightChanged('设置改了'); }

function bind(ov, app) {
    const s = app.sync, t = () => app.today();
    ov.querySelectorAll('.sheet-b [data-act]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'signin') app.signIn();
        else if (a === 'signout') app.signOut();
        else if (a === 'choose') s.showSyncConflict();
        else if (a === 'recovery') s.showSyncRecovery();
        else if (a === 'export') exportBackup(app);
        else if (a === 'memory') memorySheet(app);
        else if (a === 'redeem') redeem(app, ov);
        else if (a === 'oobe') { closeSheet('settings-sheet'); startOobe(app, { redo: true }); }
        else if (a === 'whatsnew') { closeSheet('settings-sheet'); showWhatsNew(app, { force: true }); }
    }));
    ov.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v, name = g.dataset.seg;
        if (name === 'mode') setProfile(app, p => { p.minimalMode = v === 'min'; p.showJournal = v !== 'min'; });
        else if (name === 'timing') setProfile(app, p => { if (v) p.acidTiming = v; else delete p.acidTiming; });
        else if (name === 'theme') { app.store.setLocal(LOCAL_KEYS.theme, v); applyTheme(v); paint(app); }
    })));
    const on = (id, fn) => { const el = ov.querySelector('#' + id); if (el) el.addEventListener('change', () => fn(el)); };
    on('set-showrec', el => setProfile(app, p => { if (el.checked) delete p.hideRecords; else p.hideRecords = true; }));
    on('set-shave', el => setProfile(app, p => { p.shaving = el.checked; }));
    // HRT 开关一变:对话里拍着的快照作废(关了之后不能再把 HRT 阶段带给顾问)
    on('set-hrt', el => { setProfile(app, p => { p.hrt = el.checked; }); try { invalidateChatCtx(app); } catch (e) { } });
    // 打开时记下 careAt(安全闸只认带它的,v1 引导留下的老值不算);一变对话快照也作废
    on('set-care', el => { setProfile(app, p => { if (el.checked) { p.startState = 'care'; p.careAt = app.today(); } else { if (p.startState === 'care') p.startState = 'ok'; delete p.careAt; } }); try { invalidateChatCtx(app); } catch (e) { } });
    on('set-premakeup', el => setProfile(app, p => { p.useMakeupRemoval = el.checked; }));
    on('set-repairuse', el => setProfile(app, p => { if (el.value) p.repairUse = el.value; else delete p.repairUse; }));
    on('set-acidlevel', el => setProfile(app, p => { const v = el.value ? +el.value : null; if (v !== (p.acidLevel || null)) { p.acidLevel = v; p.acidLevelAt = v ? t() : ''; } }));
    // 印章字只写 v1 的字段 seal(v2 早期写过 stamp,顺手删掉,免得两边各读各的)
    on('set-seal', el => setProfile(app, p => { const c = Array.from(String(el.value || '').trim())[0] || ''; if (c) p.seal = c; else delete p.seal; delete p.stamp; }));
    on('set-photoai', el => {
        if (!el.checked) { setProfile(app, p => { p[PHOTO_FIELD] = false; }); return; }
        el.checked = false;   // 先不算开:本人点「同意」才开
        openSheet({ id: 'photo-consent', title: '让顾问看照片？', html: `<p class="note ink">打开以后，你在「记录」里点「分析」时，拍的那几张照片会发到 Cait 家里的顾问服务器，再交给 Anthropic 的 Claude 模型逐区看，结果记进当天的记录。这台设备上存着上一次分析时的正脸照片的话，也会一起发过去对比（每次拍之前能选不带）。</p>
            <p class="note">照片本身只存在这台设备上；服务器分析完不留。随时能在这里关掉。这个开关只管你自己的账号，要你本人同意才开。</p>`,
            actions: [{ label: '先不' }, { label: '我同意，打开', primary: true, fn: () => setProfile(app, p => { p[PHOTO_FIELD] = true; p.photoAnalysisAt = t(); }) }] });
    });
    on('set-model', () => saveOpts(app, ov));
    on('set-effort', () => saveOpts(app, ov));
    on('set-import', el => { const f = el.files && el.files[0]; el.value = ''; if (f) importBackup(app, f); });
    // 洗澡 / 刮胡习惯:改 sk_preset1(+ showerDays 镜像),明天起两周按新习惯排(今晚在今晚页改,不动)
    ov.querySelectorAll('[data-hd]').forEach(b => b.addEventListener('click', () => {
        const d = +b.dataset.hd, k = b.dataset.hk, W = app.world();
        const hp = habitPreset(W.preset, W.profile).map(x => Object.assign({}, x));
        const e = hp.find(x => x.dow === d); if (!e) return;
        e[k] = !e[k];
        saveHabit(app.store, hp);
        for (let i = 1; i <= 13; i++) {
            const ds = addDays(W.today, i);
            if (dowOf(ds) !== d) continue;
            const st = getDayState(app.store, ds);
            setDayState(app.store, ds, k === 'shower' ? e.shower : st.shower, k === 'shave' ? e.shave : st.shave, W.today);
        }
        changed(app);
    }));
    bindSkinChips(ov.querySelector('.sheet-b'), app, () => paint(app));
}
function saveOpts(app, ov) {
    const m = (ov.querySelector('#set-model') || {}).value || '', e = (ov.querySelector('#set-effort') || {}).value || 'medium';
    app.store.setLocal(LOCAL_KEYS.aiOpts, JSON.stringify(m ? { model: m, effort: e } : {}));
    paint(app);
}
async function redeem(app, ov) {
    const inp = ov.querySelector('#set-code'), code = (inp && inp.value || '').trim();
    if (!code) { if (inp) inp.focus(); return; }
    try { const r = await app.ai.redeem(code); toast(r && r.name ? '开通了，' + r.name : '开通了'); changed(app); }
    catch (e) { toast(e.message || '邀请码不对'); }
}
async function memorySheet(app) {
    const draw = (items, err) => {
        const box = document.querySelector('#mem-sheet .sheet-b'); if (!box) return;
        box.innerHTML = err ? `<p class="note">${esc(err)}</p>`
            : !items.length ? '<p class="note">还没有。对话里说「记住……」，比如对某个成分过敏、哪支用了会刺痛，开新对话也不会忘。</p>'
                : `<div class="rows">${items.map(x => `<div class="row"><span class="row-main"><span class="lede">${esc(x.text)}</span><span class="meta">${esc(String(x.at || '').slice(0, 10))}</span></span><button type="button" class="btn-link sm quiet" data-mem="${esc(x.id)}">删掉</button></div>`).join('')}</div>
                   <div class="btn-row mem-acts"><button type="button" class="btn-link sm quiet" data-memclear="1">全部清空</button></div>`;
        box.insertAdjacentHTML('beforeend', '<p class="note">记在 Cait 家里的顾问服务器上，只给你自己的顾问看。</p>');
        box.querySelectorAll('[data-mem]').forEach(b => b.addEventListener('click', () => post({ op: 'delete', id: b.dataset.mem }, '删掉了')));
        const c = box.querySelector('[data-memclear]');
        if (c) c.addEventListener('click', () => sysConfirm('清空顾问记住的 ' + items.length + ' 件事？清了就找不回来。', () => post({ op: 'clear' }, '清空了'), { ok: '全部清空' }));
    };
    const post = async (b, ok) => { try { const r = await app.ai.api.memory(b); draw(r.items || []); toast(ok); } catch (e) { toast(e.message); } };
    openSheet({ id: 'mem-sheet', title: '顾问记得的事', html: '<p class="note" role="status">读取中…</p>' });
    try { const r = await app.ai.api.memory(); draw(r.items || []); } catch (e) { draw([], e.message); }
}

// ── 备份:全部云键 + 这个账号在这台设备上的照片(v1 的格式,v1 / v2 互相能读)──
export async function backupData(app) {
    const data = { _meta: { version: 3, exported: new Date().toISOString(), app: '护肤计划' } };
    CLOUD_KEYS.forEach(k => { const v = app.store.lg(k); if (v !== null && v !== undefined) data[k] = v; });
    const photos = await allPhotos(app);
    if (photos && Object.keys(photos).length) data._photos = photos;
    if (photos === null) data._meta.photosMissing = true;   // 照片存储没打开:备份里没带上照片(调用方要说出来)
    return data;
}
// 走照片库自己的事务封装(连接被 iOS 断开会重开一次再试);打不开 → null,不当成「没有照片」
async function allPhotos(app) {
    if (!app.photos || !app.photos.all) return null;
    let out = await app.photos.all();
    if (out === null) out = await app.photos.all();   // 再试一次
    return out;
}
async function exportBackup(app) {
    const data = await backupData(app);
    download('skincare_backup_' + app.today() + '.json', JSON.stringify(data, null, 2));
    if (data._meta.photosMissing) toast('这次备份里没带上照片：这台设备的本机照片存储没打开。记录都在里面。', 5000);
}
function importBackup(app, file) {
    const rd = new FileReader();
    rd.onload = () => {
        let data;
        try { data = JSON.parse(rd.result); } catch (e) { data = null; }
        const keys = data && typeof data === 'object' ? CLOUD_KEYS.filter(k => k in data) : [];
        if (!keys.length) { openSheet({ id: 'import-bad', title: '导入没成功', text: '这个文件读不出来。选的是这里导出的 .json 备份吗？', actions: [{ label: '知道了', primary: true }] }); return; }
        const n = Array.isArray(data.sk_jrnl1) ? data.sk_jrnl1.length : 0;
        sysConfirm('用这份备份（' + n + ' 天的记录）替换这台设备上的记录？现在的记录会先另存一份恢复副本，在「恢复副本」里能换回来。', async () => {
            try {
                // 只认云键(备份文件写不进信封 / 身份这些本机键);和「恢复副本」同一个「换成这一份」:副本存不上就不换、整份一次提交
                const picked = {}; keys.forEach(k => { picked[k] = data[k]; });
                if (!app.sync.replaceWithData(Object.assign({}, app.store.state.doc.data, picked), 'before-restore')) {
                    openSheet({ id: 'import-bad', title: '导入没成功', text: '这台设备存不进去了（先另存一份恢复副本没成功），所以没换，现在的记录一个字没动。先导出备份、腾点空间再试。', actions: [{ label: '知道了', primary: true }] });
                    return;
                }
                let bad = 0;
                const ph = data._photos;
                if (ph && typeof ph === 'object' && app.photos) {
                    for (const key of Object.keys(ph)) {
                        const [d, view] = key.split('__');
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || typeof ph[key] !== 'string') continue;
                        let ok = false; try { ok = await app.photos.save(d, ph[key], view || undefined); } catch (e) { ok = false; }
                        if (!ok) bad++;
                    }
                }
                app.renderAll(); paint(app);
                toast(bad ? '备份恢复好了；有 ' + bad + ' 张照片没导进来（这台设备的本机照片存储用不了）' : '备份恢复好了', bad ? 4500 : 3000);
            } catch (e) {
                openSheet({ id: 'import-bad', title: '导入没成功', text: '导入时出错了：' + ((e && e.message) || e) + '。', actions: [{ label: '知道了', primary: true }] });
            }
        }, { title: '恢复备份？', ok: '恢复' });
    };
    rd.readAsText(file);
}

export function openSettings(app) {
    watchTheme();   // 幂等;整合后 app.js 启动时也会调
    openSheet({ id: 'settings-sheet', title: '设置', html: body(app), onMount: ov => bind(ov, app) });
    // 顾问状态还没核过:核完了把「顾问」那一段画对(模型 / 用量只有核过才有)
    if (app.ai.access() === 'on' && !app.ai.state.me && !app.ai.state.down) app.ai.probe().then(() => paint(app), () => { });
}
// 外面(sync 状态变化等)想刷新已打开的设置
export function refreshSettings(app) { paint(app); }
