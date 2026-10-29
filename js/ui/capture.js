// ══ 拍照全套分析:轮廓框引导、正 / 左 / 右三张、顾问逐区看、和上次比、预填当天记录 ═══════════════════════
// 流程(一个全屏 sheet):拍前提醒 → 拍三张(相机实时画面 + 脸部轮廓框;打不开相机就用系统相机 / 相册)
//   → POST /api/assess {context, images[正,左,右], previous?, previous_date?, previous_image?}
//   → 不能用:说为什么,重拍 / 能用:逐区分档 + 把握度、和上次比、建议的状态和位置 →「确认记上」才写进今天的状态和脸部地图。
// 【要紧】
//   · 结构化结果存进当天日志的 photoAssess(随 sk_jrnl1 同步);照片只存本机 IndexedDB(model/photos.js,按账号前缀)。
//   · 照片分析**不单独触发就医红线**:建议的标签只有她点「确认记上」(或在记皮肤 sheet 里自己点)才写;redline 只数状态标签。
//   · 按账号开关:profile.photoAnalysis(true 开 / false 关;没设过 = 只有主账号默认开)。Cici 默认关,要她本人在设置里打开。
//   · 只在她点了之后才调顾问(一次约 $0.10–0.15),不自动拍、不催。
import { isOwnerEmail } from '../sync.js';
import { loadProfile } from '../model/profile.js';
import { setPhotoAssess, cleanPhotoAssess, tagLabel, TREND_TAGS, TAG_LABEL, SYMPTOM_TAGS, trendOf, cleanSpots, setTrend, toggleSym, setSpots } from '../model/journal.js';
import { PHOTO_VIEWS } from '../model/photos.js';
import { mdOf, daysBetween } from '../clock.js';
import { buildSkincareContext } from '../ai/context.js';
import { openSheet, closeSheet, toast, esc, ico } from './sheets.js';

// 档案里的开关字段(设置页写它;这里只读)。语义和 ui/settings.js 的 photoAnalysisOn(profile, owner) 一样(整合时两处并进 model/profile.js)
export const PHOTO_FIELD = 'photoAnalysis';
// profile 可以直接传(一次渲染里已经有 W 了就别再读一遍)
export function photoAnalysisOn(app, profile) {
    const P = profile || loadProfile(app.store) || {};
    if (P[PHOTO_FIELD] === true) return true;
    if (P[PHOTO_FIELD] === false) return false;
    const u = app.sync && app.sync.state && app.sync.state.user;
    return !!(u && isOwnerEmail(u.email));
}
// 能走「拍照分析」:开了照片分析、顾问开通了、而且现在连得上、今天还有次数(连不上 / 额度用完时别让她拍完三张才报错)
export function canAnalyze(app, profile) { return photoAnalysisOn(app, profile) && !!app.ai && app.ai.access() === 'on' && !analyzeBlocked(app); }
// 开通了但这会儿用不了:返回一句为什么(按钮换成「加一张照片」时配这句);能用 → ''
export function analyzeBlocked(app) {
    const ai = app && app.ai;
    if (!ai || ai.access() !== 'on') return '';
    const q = ai.quotaText ? ai.quotaText() : '';
    if (q) return q.replace(/[。]$/, '') + '，照片先存着，明天再分析。';
    if (ai.state && ai.state.down) return '顾问现在连不上，照片先存着，连上再分析。';
    return '';
}

const VIEW_NAME = { front: '正脸', left: '左脸', right: '右脸' };
const VIEW_GUIDE = {
    front: '正脸：脸放进框里，平视镜头，头发别挡住额头。',
    left: '左脸：头往右转一点，让左脸对着镜头，耳朵前面也拍进来。',
    right: '右脸：头往左转一点，让右脸对着镜头，耳朵前面也拍进来。'
};
const TIPS = ['洗完脸擦干，先别涂任何东西', '每次同一个位置、同样的光（白天靠窗，或者同一盏灯）', '关掉闪光灯', '别开人像模式、美颜或滤镜'];
const MAX_SIDE = 1280;

// ── 图片:读文件 / 截视频帧 → 压到长边 1280 的 JPEG dataURL ──
function toJpeg(src, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
}
export function readImage(file) {
    return new Promise(res => {
        if (!file) return res(null);
        const rd = new FileReader();
        rd.onload = () => { const img = new Image(); img.onload = () => res(toJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height)); img.onerror = () => res(null); img.src = rd.result; };
        rd.onerror = () => res(null);
        rd.readAsDataURL(file);
    });
}
// 不分析、只存一张(照片分析没开 / 顾问用不了时的「拍一张」):旧版同一种 key(uid__日期)
export async function addSimplePhoto(app, date, file) {
    const url = await readImage(file);
    if (!url) { toast('这张照片读不出来，换一张试试'); return false; }
    let ok = false;
    try { ok = !!(await app.photos.save(date, url)); } catch (e) { ok = false; }
    if (!ok) toast(PHOTO_FAIL + '。', 4500);
    return ok;
}
export async function loadDayPhoto(app, date) {
    try { return (await app.photos.get(date, 'front')) || (await app.photos.get(date)); } catch (e) { return null; }
}

// ── 建议 → 当天记录(只在她点了之后)。状态是开关式的:已经有的不再点(再点会取消)──
const LABEL_TO_TAG = Object.keys(TAG_LABEL).reduce((m, k) => { m[TAG_LABEL[k]] = k; m[k] = k; return m; }, {});
export function suggestOf(pa) {
    const out = { tags: [], trend: '', spots: [] };
    if (!pa) return out;
    (pa.suggest_tags || []).forEach(x => {
        const t = LABEL_TO_TAG[String(x).trim()];
        if (t === '好转') out.trend = 'better'; else if (t === '变差') out.trend = 'worse'; else if (t === '稳定') out.trend = out.trend || 'same';
        else if (SYMPTOM_TAGS.indexOf(t) >= 0 && out.tags.indexOf(t) < 0) out.tags.push(t);
    });
    out.spots = cleanSpots(pa.suggest_spots || []);
    return out;
}
export function suggestText(sug) {
    const parts = [];
    if (sug.trend) parts.push(tagLabel(TREND_TAGS[sug.trend]));
    (sug.tags || []).forEach(t => parts.push(tagLabel(t)));
    const by = {}; (sug.spots || []).forEach(s => { (by[s.zone] = by[s.zone] || []).push(s.type); });
    const sp = Object.keys(by).map(z => z + '：' + by[z].join('、')).join('；');
    return parts.join('、') + (sp ? (parts.length ? ' · ' : '') + sp : '');
}
export function applySuggest(app, date, sug) {
    const store = app.store, t = app.today();
    const en = () => (app.world().journal || []).find(e => e && e.date === date) || null;
    if (sug.trend && trendOf(en()) !== sug.trend) setTrend(store, date, sug.trend, t);
    (sug.tags || []).forEach(tag => { if (SYMPTOM_TAGS.indexOf(tag) >= 0 && !(((en() || {}).status) || []).includes(tag)) toggleSym(store, date, tag, t); });
    if ((sug.spots || []).length) setSpots(store, date, cleanSpots((en() || {}).spots).concat(sug.spots), t);
}

// 上一次能用的分析(同设备有那天的正脸照片就一起送;没有就只送结构化结果)
//   noImage = 她选了「这次不带上次的照片」:只送结构化结果
async function previousFor(app, W, date, noImage) {
    const prev = (W.journal || []).filter(e => e && e.date < date && e.photoAssess && e.photoAssess.usable !== false).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return {};
    const pa = Object.assign({}, prev.photoAssess); delete pa.at;
    const out = { previous: pa, previous_date: prev.date };
    if (!noImage) try { const img = await app.photos.get(prev.date, 'front'); if (img) out.previous_image = img; } catch (e) { }
    return out;
}
const PHOTO_FAIL = '照片没存上：这台设备的本机照片存储用不了（无痕模式或空间满了）';

// ══ 全屏 sheet ═══════════════════════════════════════════════════════════════════════
// opts = {date, onChange()(写了记录之后), onSaved()(她点了「确认记上」之后:要顾问反馈), onEdit(hint)(「改一下」:交给记皮肤的 sheet,带上建议做标记)}
export function openCapture(app, opts) {
    opts = opts || {};
    const date = opts.date || app.today();
    const s = { step: 'intro', views: {}, cur: 'front', live: false, camErr: '', stream: null, result: null, err: '', saved: false, prevImg: false, noPrevImg: false, prevChecked: false };
    const W0 = app.world(), owner = (app.store.state && app.store.state.owner) || '';
    const last = (W0.journal || []).filter(e => e && e.date < date && e.photoAssess && e.photoAssess.usable !== false).sort((a, b) => b.date.localeCompare(a.date))[0];
    // 本机有上次的正脸照片的话,会一起发过去对比:先查出来,intro 里说清楚(并给「这次不带」)。
    //   查完之前不下「不带照片」的结论、「开始拍」先不给点;发不发以这里查到、告诉过她的为准(analyze 不再自己另查一次)
    if (last) Promise.resolve(app.photos.get(last.date, 'front')).then(img => { s.prevImg = !!img; s.prevChecked = true; if (s.step === 'intro' && ov.isConnected) paint(); },
        () => { s.prevChecked = true; if (s.step === 'intro' && ov.isConnected) paint(); });
    else s.prevChecked = true;
    function stopCam() { if (s.stream) { try { s.stream.getTracks().forEach(tr => tr.stop()); } catch (e) { } } s.stream = null; s.live = false; }
    async function startCam() {
        stopCam(); s.camErr = '';
        const md = navigator.mediaDevices;
        if (!md || !md.getUserMedia) { s.camErr = '这台设备打不开实时相机，用下面的按钮拍。'; paint(); return; }
        s.camErr = '相机在打开…'; paint();
        try {
            const st = await Promise.race([md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
            if (!ov.isConnected || s.step !== 'shoot') { st.getTracks().forEach(tr => tr.stop()); return; }
            s.stream = st; s.live = true; s.camErr = '';
        } catch (e) { s.live = false; s.camErr = '相机没打开（没给权限，或这台设备不支持）。用下面的按钮拍或从相册选。'; }
        paint();
    }
    const close = () => { stopCam(); closeSheet('capture-sheet'); };
    const nextView = () => PHOTO_VIEWS.find(v => !s.views[v]) || s.cur;
    const shotN = () => PHOTO_VIEWS.filter(v => s.views[v]).length;

    function body() {
        if (s.step === 'intro') {
            return `<p class="lede">正脸、左脸、右脸各一张，顾问逐区看、和上次比。</p>
                <div class="sk-sec"><div class="sec-t">拍之前</div><ul class="list cap-tips">${TIPS.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
                <p class="note">${last ? '上次拍是 ' + esc(mdOf(last.date)) + '（' + daysBetween(last.date, date) + ' 天前），这次会一起比' + (!s.prevChecked ? '：在查这台设备上有没有上次的照片…' : s.prevImg && !s.noPrevImg ? '：会把 ' + esc(mdOf(last.date)) + ' 那张正脸一起发过去。' : '：只带上次的分析结果，不带照片。') : '这是第一次，之后每次都会和上一次比。'}</p>
                ${last && s.prevImg ? `<button type="button" class="chip" data-cap="noprev" aria-pressed="${s.noPrevImg}" id="cap-noprev">${s.noPrevImg ? ico('check', 'sm') : ''}这次不带上次的照片</button>` : ''}
                <p class="note">照片存在这台设备上，分析时发给顾问看；只有分析结果记进今天。隔两三天拍一次就够，变差那天可以加拍。</p>
                <div class="cap-acts"><button type="button" class="btn btn-primary btn-block" data-cap="start"${s.prevChecked ? '' : ' disabled'}>开始拍</button></div>`;
        }
        if (s.step === 'shoot') {
            const cur = s.cur, taken = s.views[cur];
            return `<div class="cap-views" role="group" aria-label="三张照片">${PHOTO_VIEWS.map(v => `<button type="button" class="cap-view${v === cur ? ' cur' : ''}" data-cap="view" data-v="${v}" aria-pressed="${v === cur}" id="cap-v-${v}">
                    <span class="lede">${VIEW_NAME[v]}</span><span class="meta">${s.views[v] ? '拍好了' : '没拍'}</span></button>`).join('')}</div>
                <p class="lede cap-guide" id="cap-guide">${esc(VIEW_GUIDE[cur])}</p>
                <div class="cap-frame${s.live && !taken ? ' live' : ''}">
                    ${taken ? `<img class="cap-img" src="${taken}" alt="${VIEW_NAME[cur]}的照片">` : s.live ? '<video class="cap-video" id="cap-video" playsinline muted autoplay></video>' : `<p class="note cap-ph">${esc(s.camErr || '')}</p>`}
                    <svg class="cap-oval" viewBox="0 0 300 400" aria-hidden="true"><ellipse class="under" cx="150" cy="196" rx="102" ry="142"/><ellipse cx="150" cy="196" rx="102" ry="142"/></svg></div>
                <div class="cap-acts">${taken ? `<button type="button" class="btn" data-cap="redo">重拍这张</button>` : s.live ? `<button type="button" class="btn" data-cap="snap" id="cap-snap">${ico('camera')}拍这张</button>` : ''}
                    <label class="btn file-btn">${s.live ? '用系统相机或相册' : '拍照或从相册选'}<input type="file" accept="image/*" capture="user" id="cap-file" aria-label="${VIEW_NAME[cur]}：拍照或从相册选"></label></div>
                <p class="meta cap-count">已拍 ${shotN()} / 3${s.views.front ? '' : ' · 至少要一张正脸'}</p>
                <div class="cap-acts"><button type="button" class="btn btn-primary btn-block" data-cap="go" id="cap-go"${s.views.front ? '' : ' disabled'}>${shotN() < 3 ? '先分析这几张' : '开始分析'}</button></div>`;
        }
        // 看的时候不让关:关了的话结果页(「确认记上 / 改一下」)就再也找不到了
        if (s.step === 'busy') return `<p class="lede" role="status">顾问在看照片，大约半分钟。</p><p class="note">看完之前先别关这一页，看完了在这里确认记不记。</p>`;
        if (s.step === 'error') {
            return `<p class="lede">这次没分析成。</p><p class="note">${esc(s.err)}</p>
                <div class="cap-acts"><button type="button" class="btn btn-primary btn-block" data-cap="go">再试一次</button><button type="button" class="btn btn-block" data-cap="keep">先不分析，只存照片</button></div>`;
        }
        if (s.step === 'retake') {
            const d = s.result || {}, why = Array.isArray(d.retake) ? d.retake.join('；') : String(d.retake || d.note || '');
            return `<p class="lede">这几张不太能用，重拍一下。</p>${why ? `<p class="note cap-why">${esc(why)}</p>` : ''}
                <div class="sk-sec"><div class="sec-t">再对一遍</div><ul class="list cap-tips">${TIPS.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
                <div class="cap-acts"><button type="button" class="btn btn-primary btn-block" data-cap="retake">重拍</button></div>`;
        }
        // result
        const d = cleanPhotoAssess(s.result, '') || { zones: [] };
        const sug = suggestOf(d), st = suggestText(sug);
        const zones = d.zones || [];
        return `<p class="lede cap-overall">${esc(d.overall || '看完了。')}</p>
            ${d.vs_last ? `<p class="note">和上次比：${esc(d.vs_last)}</p>` : `<p class="note">${last ? '这次没法和上次比。' : '第一次拍，下次开始和这次比。'}</p>`}
            <div class="sk-sec"><div class="sec-t">逐区</div>${zones.length ? `<ul class="rows cap-zones">${zones.map(z => `<li class="row"><span class="row-main"><span class="lede">${esc(z.zone)}</span>
                <span class="note">${z.findings.map(f => esc(f.type + ' ' + f.level) + '<span class="faint">（把握' + esc(f.confidence) + '）</span>').join('、')}</span></span></li>`).join('')}</ul>` : '<p class="note">没看出哪个区有明显情况。</p>'}</div>
            ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
            <p class="meta">不数颗数、不下诊断；拿不准的地方写了把握低。</p>
            <div class="sk-sec cap-fill"><div class="sec-t">预填今天的记录</div>
                ${s.saved ? '<p class="lede">记上了。</p>' : st ? `<p class="lede" id="cap-sug">${esc(st)}</p><p class="note">点「确认记上」才会写进今天的状态和脸部地图。</p>
                <div class="cap-acts"><button type="button" class="btn btn-primary btn-block" data-cap="fill-ok" id="cap-fill-ok">确认记上</button><button type="button" class="btn btn-block" data-cap="fill-edit">改一下</button></div>` : '<p class="note">没有要预填的。</p>'}
                <button type="button" class="btn-link sm quiet" data-cap="close">${s.saved || !st ? '好' : '先不记'}</button></div>`;
    }
    function paint() {
        const box = ov.querySelector('#cap-body'); if (!box) return;
        const fid = document.activeElement && document.activeElement.id;
        box.innerHTML = body();
        const v = box.querySelector('#cap-video');
        if (v && s.stream) { v.srcObject = s.stream; const p = v.play && v.play(); if (p && p.catch) p.catch(() => { }); }
        if (fid) { const el = document.getElementById(fid); if (el) try { el.focus({ preventScroll: true }); } catch (e) { } }
    }
    function took(url) {
        if (!url) { toast('这张照片读不出来，换一张试试'); return; }
        s.views[s.cur] = url;
        s.cur = nextView();
        paint();
    }
    function snap() {
        const v = ov.querySelector('#cap-video');
        if (!v || !v.videoWidth) { toast('相机还没准备好，等一下再拍'); return; }
        took(toJpeg(v, v.videoWidth, v.videoHeight));   // 存原图方向(不镜像):左右要按她自己的左右
    }
    // 分析中:藏起关闭按钮、挡住点背景和 Esc
    function lock(on) {
        s.locked = on;
        if (on) ov.dataset.noesc = '1'; else delete ov.dataset.noesc;
        const x = ov.querySelector('.sheet-x'); if (x) x.hidden = on;
    }
    const sameOwner = () => ((app.store.state && app.store.state.owner) || '') === owner;
    async function saveViews(views) {
        let bad = 0;
        for (const v of views) { let ok = false; try { ok = await app.photos.save(date, s.views[v], v); } catch (e) { ok = false; } if (!ok) bad++; }
        return bad;
    }
    async function analyze() {
        if (!s.views.front) return;
        stopCam(); s.step = 'busy'; s.err = ''; lock(true); paint();
        const W = app.world();
        const u = app.sync && app.sync.state && app.sync.state.user;
        const ctx = buildSkincareContext(W, { name: u && u.displayName ? String(u.displayName).split(' ')[0] : '', shown: app.shownTonight ? app.shownTonight(W) : null });
        const views = PHOTO_VIEWS.filter(v => s.views[v]);
        const images = views.map(v => s.views[v]);
        // 只发她被告知会发的:开头说了「不带照片」(或没查到 / 还没查完),这里就不带
        const extra = await previousFor(app, W, date, s.noPrevImg || !s.prevImg);
        if (views.length < 3) extra.note = '这次的照片依次是：' + views.map(v => VIEW_NAME[v]).join('、');
        let d;
        try { const r = await app.ai.api.assess(ctx, images, extra); d = (r && r.data) || {}; }
        catch (e) {
            lock(false);
            if (!sameOwner()) { close(); return; }
            s.err = (e.code === 0 && !e.aborted ? (e.message || '顾问暂时连不上。') + '照片可以先存着，连上再分析。' : e.message) || '顾问出错了'; s.step = 'error';
            if (ov.isConnected) paint(); else toast('这次没分析成：' + s.err);
            return;
        }
        lock(false);
        if (!sameOwner()) { close(); return; }   // 等结果的时候换了账号:这是上一个人的照片和结果,不写进这个人的记录
        s.result = d;
        if (d.usable === false) { s.step = 'retake'; if (ov.isConnected) paint(); else toast('这几张不太能用，下次重拍一下'); return; }
        // 能用:结构化结果进当天日志(同步);照片进本机
        setPhotoAssess(app.store, date, d, new Date(app.store.now()).toISOString());
        const bad = await saveViews(views);
        s.step = 'result';
        app.renderAll();
        if (opts.onChange) opts.onChange();
        if (ov.isConnected) paint(); else toast('照片看完了，分析结果记在今天；建议的状态没写，要记就去「记录」点「加状态和位置」');
        if (bad) toast(PHOTO_FAIL + '，分析结果已经记上。', 4500);
    }
    async function keepOnly() {
        const bad = await saveViews(PHOTO_VIEWS.filter(v => s.views[v]));
        toast(bad ? PHOTO_FAIL + '。' : '照片存好了，只在这台设备上', bad ? 4500 : 3000); close();
        if (opts.onChange) opts.onChange();
    }
    const ov = openSheet({ id: 'capture-sheet', title: '拍照分析', full: true, html: '<div id="cap-body" class="cap"></div>', onClose: stopCam });
    // 分析中点背景不关(openSheet 的背景关闭在冒泡阶段;这里在捕获阶段先拦下)
    ov.addEventListener('click', e => { if (s.locked && e.target === ov) e.stopImmediatePropagation(); }, true);
    ov.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('[data-cap]');
        if (!b || b.disabled) return;
        const a = b.dataset.cap;
        if (a === 'start') { s.step = 'shoot'; paint(); startCam(); }
        else if (a === 'view') { s.cur = b.dataset.v; paint(); }
        else if (a === 'snap') snap();
        else if (a === 'redo') { delete s.views[s.cur]; paint(); }
        else if (a === 'go') analyze();
        else if (a === 'retake') { s.views = {}; s.cur = 'front'; s.result = null; s.step = 'shoot'; paint(); startCam(); }
        else if (a === 'keep') keepOnly();
        else if (a === 'noprev') { s.noPrevImg = !s.noPrevImg; paint(); }
        else if (a === 'fill-ok') {
            const sug = suggestOf(cleanPhotoAssess(s.result, ''));
            applySuggest(app, date, sug); s.saved = true;
            app.renderAll(); if (opts.onChange) opts.onChange();
            paint(); toast('记上了');
            if (opts.onSaved) opts.onSaved();
        } else if (a === 'fill-edit') {
            const sug = suggestOf(cleanPhotoAssess(s.result, ''));
            stopCam();
            if (opts.onEdit) opts.onEdit(sug); else close();
        } else if (a === 'close') close();
    });
    ov.addEventListener('change', e => {
        if (e.target && e.target.id === 'cap-file') {
            const f = e.target.files && e.target.files[0]; e.target.value = '';
            if (f) readImage(f).then(took);
        }
    });
    paint();
    return ov;
}
