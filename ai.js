// ══ 护肤顾问(AI)══════════════════════════════════════════════════════════════
// index.html 只留挂载点和钩子(#coach-content / #ai-note / #ai-feedback / #ai-prod-entry,以及
// aiOnAuth / aiClearLocal / aiRenderTonight / aiAfterCheckin / aiRegimenActionsHtml / renderCoach)。这里管:
//   · 鉴权 + 网络:取 Firebase ID token、fetch / SSE、每人同时 1 个请求的排队、开通状态(未登录 / 邀请制 / 可用 / 连不上)
//   · 上下文拼装 buildSkincareContext()(照 ~/skincare-coach/BRIEF.md 的契约)
//   · 对话(SSE)、认图(读成分标 / 看皮肤)、出方案、方案复盘(每周一次自动)、今日顾问的话、打卡反馈、长期记忆
//   · 【要紧】AI 的改动**一律直接生效 + 一键撤销**(Cait 2026-10-29「放开了动」,不做「采纳」门槛);
//     应用前每一条都过 _validate*(安全闸,唯一红线),被拦的写明为什么没生效。
// 这个文件挂了 / 没缓存上 / 后端连不上:index.html 的离线规则(阶梯 + 安全闸)照常排今晚,不会白屏。

const AI_BASE = (['127.0.0.1', 'localhost'].indexOf(location.hostname) >= 0) ? 'http://127.0.0.1:8808' : 'https://node.tail95239f.ts.net/skin';
const AI_CHAT_MAX = 40, AI_CHAT_SEND = 24;
// 本机缓存(不进云;换账号时 aiClearLocal 清掉):对话、今日顾问的话、开通状态、模型选择、「要不要买新的」的顾问判断
const AIK = { chat: 'sk_aichat1', note: 'sk_ainote1', acc: 'sk_aiacc1', opts: 'sk_aiopts1', privacy: 'sk_aiprivacy1', shop: 'sk_ai_shop1' };
const AI_LOCKED = ['not_allowed', 'mismatch'];
const AI_ROLE_FROM_CN = { '洁面': 'cleanse', '卸妆': 'precleanse', '去角质': 'acid', '精华': 'serum', '眼部': 'eye', '修护': 'repair', '防晒': 'spf', '面膜': 'mask', '保湿': 'moist', '舒缓': 'soothe' };

let AI_ME = null, _aiMeUid = null, _aiDown = false, _aiProbeUid = null;
let _aiPendingImg = null, _aiBusy = false;
const _aiInflight = {};

// ── 小工具 ──
function _aiUser() { try { return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null; } catch (e) { return null; } }
function _aiUid() { const u = _aiUser(); return u ? u.uid : null; }
function _aiGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function _aiSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { _aiToast('本机存储满了，这条没存上'); } }
// 按账号存的本机缓存:不是这个 uid 的一律当没有
function _aiMine(k) { const v = _aiGet(k); return (v && v.uid === _aiUid()) ? v : null; }
function _aiEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _aiMd(s) {
    // 只认最基本的:**粗体**、换行、「- 」开头的列表行。其余一律转义
    return _aiEsc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').split('\n').map(l => /^\s*[-·•]\s+/.test(l) ? '<span class="co-li">· ' + l.replace(/^\s*[-·•]\s+/, '') + '</span>' : l).join('<br>').replace(/<\/span><br>/g, '</span>');
}
function _aiToast(msg) {
    const t = document.getElementById('sync-toast-el');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(_aiToast._t); _aiToast._t = setTimeout(() => t.classList.remove('show'), 3500);
}
// 顾问回来的字一律先去 emoji(界面全程不用 emoji;提示词里也要求了,这里兜底)
function _aiClean(x) {
    if (typeof x === 'string') return typeof stripEmoji === 'function' ? stripEmoji(x) : x;
    if (Array.isArray(x)) return x.map(_aiClean);
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { o[k] = _aiClean(x[k]); }); return o; }
    return x;
}
function _aiHM(t) { if (!t) return ''; const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function _aiWeek() { return isoWeek(new Date(today() + 'T12:00:00')); }

// ── 网络 ──
async function aiFetch(path, body, opt) {
    opt = opt || {};
    const u = _aiUser();
    if (!u) { const e = new Error('请先登录'); e.status = 'signed_out'; e.code = 401; throw e; }
    const tok = await u.getIdToken();
    let r;
    try {
        r = await fetch(AI_BASE + path, {
            method: body ? 'POST' : 'GET',
            headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        _aiDown = true;
        const err = new Error('顾问暂时连不上，今晚照上一版做，不影响打卡。'); err.code = 0; throw err;
    }
    _aiDown = false;
    if (opt.stream && r.ok) return r;
    let j = null;
    try { j = await r.json(); } catch (e) { }
    if (!r.ok) {
        const msg = (j && j.error) || ('顾问出错了（' + r.status + '）');
        const e = new Error(msg);
        e.status = j && j.status; e.info = j || {}; e.code = r.status;
        if (AI_LOCKED.indexOf(e.status) >= 0) _aiRememberAccess(e.status);
        // 额度用完:顾问页换成「今天的顾问次数用完了」,别让她一遍遍点发送
        if (r.status === 429 && /今天的 AI 用量/.test(msg)) { _aiQuota = { kind: 'daily', date: today() }; e.message = '今天的顾问次数用完了，明天再来。'; }
        else if (r.status === 429 && /这个月的 AI 额度/.test(msg)) { _aiQuota = { kind: 'cycle', date: today() }; e.message = '这个月的顾问额度用完了，17 号恢复。'; }
        throw e;
    }
    if (_aiQuota && _aiQuota.kind === 'daily') _aiQuota = null;
    return j;
}
let _aiQuota = null;
function _aiQuotaText() {
    if (!_aiQuota) return '';
    if (_aiQuota.kind === 'daily' && _aiQuota.date !== today()) { _aiQuota = null; return ''; }
    return _aiQuota.kind === 'daily' ? '今天的顾问次数用完了，明天再来。' : '这个月的顾问额度用完了，17 号恢复。';
}
// 后端每人同时只跑 1 个请求(第二个回 429):本机排成一队
let _aiChain = Promise.resolve();
function _aiSerial(fn) { const p = _aiChain.then(fn, fn); _aiChain = p.then(() => { }, () => { }); return p; }
function aiPoint(path, body) {
    return _aiSerial(async () => {
        for (let i = 0; ; i++) {
            try { return _aiClean(await aiFetch(path, body)); }
            catch (e) {
                if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
                throw e;
            }
        }
    });
}
// SSE:delta 边到边回调;action / proposal / memory / done / error 收起来交给调用方
async function aiStream(path, body, onDelta) {
    const out = { text: '', meta: null, err: null, prop: null, act: null, mem: null };
    try {
        await _aiSerial(async () => {
            const r = await aiFetch(path, body, { stream: true });
            const rd = r.body.getReader(), dec = new TextDecoder();
            let buf = '';
            const eat = block => {
                const ev = (block.match(/^event: (.*)$/m) || [])[1], data = (block.match(/^data: (.*)$/m) || [])[1];
                if (!data) return;
                let j; try { j = JSON.parse(data); } catch (e) { return; }
                j = _aiClean(j);
                if (ev === 'delta') { out.text += j.t || ''; if (onDelta) onDelta(out.text); }
                else if (ev === 'proposal') out.prop = j;
                else if (ev === 'action') out.act = j;
                else if (ev === 'memory') out.mem = j;
                else if (ev === 'done') { out.text = j.text || out.text; out.meta = { model: j.model, effort: j.effort, cost: j.cost }; }
                else if (ev === 'error') out.err = j.error || '顾问出错了';
            };
            for (; ;) {
                const { value, done } = await rd.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let k;
                while ((k = buf.indexOf('\n\n')) >= 0) { eat(buf.slice(0, k)); buf = buf.slice(k + 2); }
            }
            if (buf.trim()) eat(buf);
        });
    } catch (e) { out.err = e.message; }
    return out;
}

// ── 开通状态 ──
// 'out' 没登录 · 'none' 邀请制、这个账号没开通 · 'mismatch' 邮箱绑了别的账号 · 'on' 可以用(连没连上另看 _aiDown)
function _aiRememberAccess(status) { const uid = _aiUid(); if (!uid) return; _aiSet(AIK.acc, { uid, status }); }
function aiAccess() {
    if (!_aiUid()) return 'out';
    const a = _aiMine(AIK.acc);
    if (a && a.status === 'not_allowed') return 'none';
    if (a && a.status === 'mismatch') return 'mismatch';
    return 'on';
}
// 自动发的请求(顾问的话 / 每周复盘 / 打卡反馈)只在后端确认这个账号开通了之后才发
function aiReady() { return aiAccess() === 'on' && !!AI_ME && _aiMeUid === _aiUid(); }
async function aiProbe(force) {
    const uid = _aiUid();
    if (!uid) { AI_ME = null; _aiMeUid = null; _aiProbeUid = null; _aiRefresh(); return; }
    if (!force && _aiProbeUid === uid && AI_ME) return;
    _aiProbeUid = uid;
    try {
        const me = await aiFetch('/api/me');
        AI_ME = me; _aiMeUid = uid; _aiRememberAccess('allowed');
    } catch (e) {
        if (AI_LOCKED.indexOf(e.status) < 0) _aiProbeUid = null;   // 连不上:下次再试
        AI_ME = null;
    }
    _aiRefresh();
}
function _aiRefresh() {
    if (typeof renderRegimenCard === 'function') renderRegimenCard();
    if (typeof renderShop === 'function') renderShop();   // 产品页「要不要买新的」:开通状态一变,顾问版 / 离线版跟着换;里面会排一次后台判断
    aiRenderTonight();
    if (typeof renderTnSay === 'function') renderTnSay();
    if (typeof oobeRefresh === 'function') oobeRefresh();
    const p = document.getElementById('coach');
    if (p && p.classList.contains('active')) renderCoach();
}
function _aiOpts() { const o = _aiGet(AIK.opts) || {}; return o.model ? { model: o.model, effort: o.effort || 'medium' } : {}; }

// ══ 上下文拼装(BRIEF 契约)═══════════════════════════════════════════════════
// {user, skinType, concerns[], phase, products[], regimen{}, tonight{}, recentLogs[], assess{}, zones[], hrt?}
// 【要紧】hrt 只在**当前用户本人**开了 HRT 时才带(数据本来就按 uid 隔离,Cici 的快照里永远没有 Cait 的东西);
//    日志里的 phase(HRT 阶段)字段也只在开了 HRT 时才进快照。
function _aiRoleOf(name) { const p = PD.find(x => x.name === name); return p ? (ROLE_LABEL[p.role] || p.role) : ''; }
function buildSkincareContext() {
    const minimal = !!PROFILE.minimalMode;
    const reg = currentRegimen(), rr = regimenRules(), g = safetyGate(), a = assessSkin();
    const statusOf = p => isExcluded(p) ? '停' : restedNow(p) ? '这一版先不排' : (isSchedActive(p, PS[p.id] || p.statuses[0]) || includedNow(p)) ? '在用' : '备用';
    const products = PD.filter(p => !p.hidden).map(p => {
        const o = { name: p.name, role: ROLE_LABEL[p.role] || p.role, traits: traitsOf(p), status: statusOf(p) };
        if (typeof isLow === 'function' && isLow(p.id)) o.low = true;
        if (typeof introNightsLeft === 'function' && introNightsLeft(p)) o.newIntro = true;
        return o;
    });
    let tonight = { steps: [], shower: !!TN.shower, shave: !!(TN.shave && PROFILE.shaving), done: false };
    try {
        const slot = computePlanRolling().find(d => d.isToday) || { items: [] };
        const ns = buildNightSteps(TN.shower, TN.shave, slot);
        const te = (lg(K.jrnl) || []).find(x => x.date === today());
        tonight = { steps: ns.steps.map(s => ({ role: _aiRoleOf(s.p), product: s.p })), skipped: ns.skips.slice(0, 8),
            shower: !!TN.shower, shave: !!(TN.shave && PROFILE.shaving), done: !!(te && te.done), ticked: [...loadDoneSteps('tn')],
            notDone: ((te && te.skipped) || []).slice(0, 8) };   // 她点了「今晚没做」的
    } catch (e) { }
    const tags = getAcidTags();
    const recentLogs = jrnlLastNDays(14).map(e => {
        const o = { date: e.date, status: e.status || [], note: e.note || '' };
        if ((e.products || []).length) o.used = e.products;
        if ((e.products || []).some(x => tags.indexOf(x) >= 0)) o.acid = true;
        if (e.auto) o.auto = true;   // 极简模式按计划推定的,不是她记的
        if ((e.skipped || []).length) o.notDone = e.skipped.slice(0, 8);   // 那晚她点了「没做」的
        if (e.done) o.done = true;
        if (PROFILE.hrt && e.phase) o.hrtPhase = e.phase;
        // 脸部地图:她标在脸上的位置(区域名照 FACE_ZONES,左右是她自己的左右);没标就是空数组,顾问别猜位置
        o.spots = (typeof cleanSpots === 'function' ? cleanSpots(e.spots) : []).map(s => ({ zone: s.zone, type: s.type }));
        return o;
    });
    const axes = {}; a.axes.forEach(x => { axes[x.key] = x.score; });
    const rules0 = (reg && reg.rules) || {};
    const ctx = {
        user: { name: (() => { const u = _aiUser(); return u && u.displayName ? String(u.displayName).split(' ')[0] : ''; })(), mode: minimal ? '极简' : '完整',
                ...(minimal ? { modeNote: '极简模式：她基本不记录；排上的酸默认按计划用了(日志里 auto=true 是推定的，不是她记的)。没记到刺激不代表耐受，不能据此加量；只有她在对话/照片里明确说了反应才算。' } : {}) },
        skinType: PROFILE.skinType || '',
        concerns: (PROFILE.concerns && PROFILE.concerns.length) ? PROFILE.concerns : (PROFILE.goal && PROFILE.goal.concern ? [PROFILE.goal.concern] : []),
        phase: (PHASES[currentPhase()] || {}).name || '',
        products,
        regimen: {
            v: reg ? reg.v : 0, source: rr.source === 'ai' ? '顾问' : '离线规则',
            rules: {
                acidCap: Math.round(+rr.acidCap || 0), acidCapNow: maxAcidPerWeek(),
                acidName: rr.source === 'ai' ? (rr.acidName || '') : (rules0.acidName || ''),
                acidZones: zonesAvoiding('acid'), cleanse: (rr.source === 'ai' ? rr.cleanse : rules0.cleanse) || '',
                repair: repairUse(), repairWhy: repairReason(),
                resting: ((rr.source === 'ai' ? rr.resting : rules0.resting) || []).map(x => ({ name: x.name, why: x.why || '' })),
                include: rr.include || [], phase: currentPhase()
            },
            gaps: regimenGaps().map(x => ({ label: x.label, why: x.why }))
        },
        tonight,
        recentLogs,
        assess: { barrier: barrierScore(), overall: a.overall, axes,
                  gate: { irritated: g.irritated, tags: g.tags, worsening: g.worsening, acidReaction: g.react, hrtFlare: g.hrtFlare, medical: g.medical, firstNight: g.firstNight, acidCapMax: g.acidCapMax, notes: g.notes } },
        zones: userZones().map(z => ({ name: z.name, avoid: z.avoid || [], care: z.care || '' }))
    };
    if (rr.source !== 'ai') ctx.regimen.ladder = { level: rr.ladder.level, why: rr.ladder.why, uses: rr.ladder.uses };
    // 就医提醒的状态(数据说明里写了「看过医生的记录(如果有)」会给顾问看)
    if (PROFILE.medical && PROFILE.medical.state) ctx.medical = { state: PROFILE.medical.state, date: PROFILE.medical.date || '', seenAt: PROFILE.medical.seenAt || '', note: PROFILE.medical.note || '' };
    if (PROFILE.hrt) ctx.hrt = { on: true, flare: g.hrtFlare, recent: jrnlLastNDays(14).filter(e => e.phase).map(e => ({ date: e.date, phase: e.phase })) };
    // 「要不要买新的」要看的:标了快用完的、近 60 天的空瓶、在哪个国家买(顾问按这个查能买到的型号)
    ctx.low = PD.filter(p => !p.hidden && typeof isLow === 'function' && isLow(p.id)).map(p => p.name);
    const from60 = offsetDate(-59);
    ctx.emptied = (typeof emptyLogRows === 'function' ? emptyLogRows() : []).filter(r => r.date && r.date >= from60)
        .map(r => ({ name: r.name, date: r.date, weeks: (r.weeks === undefined || r.weeks === null) ? null : r.weeks }));
    ctx.region = 'GB';
    return ctx;
}
// 每条对话另带的「此刻」:对话开头拍的快照整段不变(缓存命中省钱),会变的放这里
function _aiLive() {
    const g = safetyGate(), rr = regimenRules();
    let steps = [];
    try { steps = buildNightSteps(TN.shower, TN.shave, computePlanRolling().find(d => d.isToday) || { items: [] }).steps.map(s => s.p); } catch (e) { }
    const reg = currentRegimen();
    return { tonight: { steps }, regimen: { v: reg ? reg.v : 0, source: rr.source === 'ai' ? '顾问' : '离线规则', acidCapNow: maxAcidPerWeek(), acidName: rr.acidName || '' }, gate: g.notes };
}

// ══ 安全闸:AI 的改动上脸前逐条核 ═══════════════════════════════════════════
// 返回 '' = 放行;否则返回原因(界面上原样写「没生效：…」)。底层判断全部复用 index.html 的 safetyGate()/gateBlocks(),
// 这里只是按每种改动去问它 —— 离线规则和顾问用的是同一道闸。
function _aiProd(name) { const n = String(name || '').trim(); return n ? (PD.find(p => p.name === n) || null) : null; }
function _validateTonight(c, g, stepNames) {
    if (c.op === 'acid') return (c.level === 'stop' || c.level === 'down') ? '' : '不认识的降档方式';
    if (c.op === 'note') return String(c.text || '').trim() ? '' : '没写内容';
    if (c.op === 'skip') return stepNames.indexOf(c.product) >= 0 ? '' : '今晚的步骤里没有这支';
    const p = _aiProd(c.op === 'swap' ? c.to : c.product);
    if (!p) return '产品库里没有「' + (c.op === 'swap' ? c.to : c.product) + '」';
    if (c.op === 'swap' && stepNames.indexOf(c.product) < 0) return '今晚的步骤里没有「' + c.product + '」';
    const gb = gateBlocks(p, g);
    if (gb) return gb;
    const t = p.schedule && p.schedule.type;
    if (t === 'acid' && c.op === 'add') {
        if (exfoliantCountInLastNDays(7) >= Math.min(g.acidCapMax, 7)) return '这周的刷酸已经到安全闸的上限了';
        if (TN.shave && PROFILE.shaving) return '刮胡夜不上酸';
    }
    return '';
}
// 整套方案的改动(对话里的 propose_regimen / 复盘的 adjustments 都走这里)。base = 正在拼的新规矩(会被改)
// 返回 {why:'' 放行 | 原因, partial: 部分生效时的说明}
function _validateRegimenChange(c, g, base) {
    const op = c.op;
    if (op === 'acid_freq') {
        const n = Math.round(+c.value);
        if (!(n >= 0 && n <= 7)) return { why: '次数不对' };
        let partial = '';
        if (c.product) {
            const p = _aiProd(c.product);
            if (!p || p.role !== 'acid') return { why: '产品库里没有「' + c.product + '」这支酸' };
            const gb = gateBlocks(p, g);
            if (gb) return { why: '「' + p.name + '」' + gb };
        }
        if (n > g.acidCapMax) partial = '现在先按 ' + g.acidCapMax + ' 次/周（' + (g.notes[0] || '安全闸') + '），好了自动按 ' + n + ' 次';
        base.acidCap = n;
        if (c.product) base.acidName = _aiProd(c.product).name;
        return { why: '', partial };
    }
    if (op === 'add_product') {
        const p = _aiProd(c.product);
        if (!p) return { why: '产品库里没有「' + c.product + '」' };
        const gb = gateBlocks(p, g);
        if (gb) return { why: '「' + p.name + '」' + gb };
        if (base.include.indexOf(p.name) < 0) base.include.push(p.name);
        base.resting = base.resting.filter(x => x.name !== p.name);
        if (p.role === 'acid' && !base.acidName) base.acidName = p.name;
        return { why: '' };
    }
    if (op === 'remove_product') {
        const p = _aiProd(c.product);
        if (!p) return { why: '产品库里没有「' + c.product + '」' };
        if (!base.resting.some(x => x.name === p.name)) base.resting.push({ name: p.name, why: c.why || '顾问这一版先不排' });
        base.include = base.include.filter(n => n !== p.name);
        if (String(base.acidName || '').split(' / ').indexOf(p.name) >= 0) base.acidName = '';
        return { why: '' };
    }
    if (op === 'phase') {
        if (!PHASES[c.value]) return { why: '不认识的阶段' };
        base.phase = c.value;
        return { why: '', partial: g.irritated && c.value !== 'repair' ? '阶段记下了；但近 3 天在发炎，今晚照安全闸来' : '' };
    }
    if (op === 'zone') {
        const zn = String(c.product || '').trim().slice(0, 20), av = c.value;
        if (!zn || ['acid', 'retinol', 'mask', 'scrub'].indexOf(av) < 0) return { why: '部位或避开类型不对' };
        const z = base.zonesAdd.find(x => x.name === zn) || (base.zonesAdd.push({ name: zn, avoid: [] }), base.zonesAdd[base.zonesAdd.length - 1]);
        if (z.avoid.indexOf(av) < 0) z.avoid.push(av);
        if (av === 'acid' && base.acidZones.indexOf(zn) < 0) base.acidZones.push(zn);
        return { why: '' };
    }
    if (op === 'cleanse') { const v = String(c.value || '').trim(); if (!v) return { why: '没写内容' }; base.cleanse = v.slice(0, 60); return { why: '' }; }
    if (op === 'repair') {
        if (c.value !== 'spot' && c.value !== 'full') return { why: '修护霜用法只能是点涂 / 全脸薄涂' };
        base.repair = c.value; base.repairWhy = c.why || '';
        return { why: '', partial: PROFILE.repairUse ? '你在「设置」里手动定了修护霜用法，那个优先' : '' };
    }
    return { why: '不认识的改法' };
}
// 新规矩的起点:当前顾问方案的规矩;没有顾问方案就从离线阶梯现在的状态出发(别从零开始)
function _aiBaseRules() {
    const rr = regimenRules();
    const r = JSON.parse(JSON.stringify({
        acidCap: Math.round(+rr.acidCap || 0), acidName: rr.source === 'ai' ? (rr.acidName || '') : '',
        acidZones: rr.acidZones || [], cleanse: rr.cleanse || '', repair: rr.source === 'ai' ? (rr.repair || '') : '',
        repairWhy: rr.source === 'ai' ? (rr.repairWhy || '') : '', resting: rr.resting || [], include: rr.include || [],
        zonesAdd: rr.zonesAdd || [], phase: rr.source === 'ai' ? (rr.phase || '') : ''
    }));
    ['acidZones', 'resting', 'include', 'zonesAdd'].forEach(k => { if (!Array.isArray(r[k])) r[k] = []; });
    return r;
}
// /api/plan 的结果 → 一套规矩(过闸)。返回 {rules, blocked[]}
function _validatePlan(data, g) {
    const R = (data && data.rules) || {}, blocked = [];
    const rules = { acidCap: 1, acidName: '', acidZones: [], cleanse: '', repair: '', repairWhy: '', resting: [], include: [], zonesAdd: [], phase: '' };
    const n = Math.round(+R.acidCap);
    rules.acidCap = (n >= 0 && n <= 7) ? n : 1;
    if (rules.acidCap > g.acidCapMax) blocked.push({ text: '每周 ' + rules.acidCap + ' 次', why: '现在先按 ' + g.acidCapMax + ' 次（' + (g.notes[0] || '安全闸') + '），好了自动恢复', partial: true });
    if (R.acidName) {
        const p = _aiProd(R.acidName);
        const gb = !p ? '产品库里没有这支' : (p.role !== 'acid' ? '它不是酸' : gateBlocks(p, g));
        if (gb) blocked.push({ text: '用「' + R.acidName + '」', why: gb });
        else rules.acidName = p.name;
    }
    rules.acidZones = (Array.isArray(R.acidZones) ? R.acidZones : []).map(x => String(x || '').trim().slice(0, 20)).filter(Boolean);
    rules.cleanse = String(R.cleanse || '').slice(0, 80);
    if (R.repair === 'spot' || R.repair === 'full') { rules.repair = R.repair; rules.repairWhy = String(R.repairWhy || '').slice(0, 80); }
    (Array.isArray(data.resting) ? data.resting : []).forEach(x => {
        const p = x && _aiProd(x.name);
        if (p && !rules.resting.some(y => y.name === p.name)) rules.resting.push({ name: p.name, why: String(x.why || '').slice(0, 60) });
    });
    return { rules, blocked };
}

// ══ 直接应用 + 撤销 ══════════════════════════════════════════════════════════
const _AI_TONIGHT_TXT = {
    skip: c => '今晚跳过「' + c.product + '」', swap: c => '今晚「' + c.product + '」换成「' + c.to + '」',
    add: c => '今晚加「' + c.product + '」', acid: c => c.level === 'stop' ? '今晚的酸停掉' : '今晚的酸降一档',
    note: c => '记一笔：' + c.text
};
const _AI_REG_TXT = {
    acid_freq: c => '刷酸改成每周 ' + c.value + ' 次' + (c.product ? '，用「' + c.product + '」' : ''),
    add_product: c => '把「' + c.product + '」正式排进来', remove_product: c => '「' + c.product + '」这一版先不排',
    phase: c => '阶段：' + ((PHASES[c.value] || {}).name || c.value), zone: c => c.product + '避开' + ({ acid: '酸', retinol: '维 A', mask: '面膜', scrub: '磨砂' }[c.value] || c.value),
    cleanse: c => '洗脸：' + c.value, repair: c => '修护霜' + (c.value === 'spot' ? '只点涂' : '全脸薄涂')
};
// 今晚的小改(change_tonight)→ 写 sk_tnai1 + 今天日志的备注;快照留给撤销。返回一条记录挂在那条助手消息上。
function aiApplyTonight(j) {
    if (!j || !Array.isArray(j.changes) || !j.changes.length) return null;
    const changes = j.changes.slice(0, 6).filter(c => c && typeof c === 'object');
    const g = safetyGate();
    let stepNames = [];
    try { stepNames = buildNightSteps(TN.shower, TN.shave, computePlanRolling().find(d => d.isToday) || { items: [] }).steps.map(s => s.p); } catch (e) { }
    const prev = lg(K.tnai);
    const cur = (prev && prev.date === today()) ? JSON.parse(JSON.stringify(prev)) : { date: today(), ops: [] };
    const jr0 = (lg(K.jrnl) || []).find(x => x.date === today());
    const snap = { date: today(), tnai: prev || null, note: jr0 ? (jr0.note || '') : null };
    const result = changes.map(c => _validateTonight(c, g, stepNames));
    let n = 0;
    changes.forEach((c, k) => {
        if (result[k]) return;
        n++;
        if (c.op === 'note') {
            const e = lg(K.jrnl) || [];
            let en = e.find(x => x.date === today());
            if (!en) { en = { date: today(), status: [], products: [], note: '', phase: '' }; e.unshift(en); }
            en.note = (en.note ? en.note + '；' : '') + String(c.text).trim();
            ls(K.jrnl, e.slice(0, 365));
            return;
        }
        if (c.op === 'acid') cur.ops = cur.ops.filter(o => o.op !== 'acid');
        cur.ops.push({ op: c.op, product: c.product || '', to: c.to || '', level: c.level || '', why: c.why || '' });
    });
    if (n) {
        cur.id = String(j.id || ('t' + Date.now())).slice(0, 80);
        cur.at = new Date().toISOString();
        // 撤销用的「改之前」存在 sk_tnai1 自己身上:今晚页的变化条和这里的撤销走同一个 undoTonightChange()
        const prevPlain = prev && prev.date === today() ? Object.assign({}, prev) : null;
        if (prevPlain) delete prevPlain.undo;
        cur.undo = { prev: prevPlain, note: snap.note };
        ls(K.tnai, cur);
        _aiDropOldSnaps('tonight');
        invalidatePlanCache();
        if (typeof renderTn === 'function') renderTn();
        if (typeof renderWk === 'function') renderWk();
        _aiToast('今晚已改 ' + n + ' 处' + (n < changes.length ? '，' + (changes.length - n) + ' 条没改' : '') + ' · 可以撤销');
    }
    return { kind: 'tonight', id: String(j.id || ('t' + Date.now())).slice(0, 80), changes, result, dropped: (j.dropped || []).slice(0, 6),
             state: n ? 'applied' : 'failed', snap: n ? snap : null };
}
function _aiUndoTonight(rec) {
    const s = rec.snap;
    if (!s) return '这条已经撤不了了';
    if (s.date !== today()) return '已经不是那天了，没撤';
    const why = undoTonightChange(rec.id);
    if (why) return why;
    if (typeof renderTn === 'function') renderTn();
    return '';
}
// 整套方案的改动(对话 propose_regimen / 复盘 adjustments)→ 新的一版方案(source:'ai'),撤销 = 回到上一版
function aiApplyRegimen(changes, meta) {
    const g = safetyGate();
    const base = _aiBaseRules();
    const result = [], blocked = [];
    let n = 0;
    changes.forEach(c => {
        const v = _validateRegimenChange(c, g, base);
        const txt = (_AI_REG_TXT[c.op] || (() => c.op))(c);
        if (v.why) { result.push(v.why); blocked.push({ text: txt, why: v.why }); return; }
        n++;
        result.push('');
        if (v.partial) blocked.push({ text: txt, why: v.partial, partial: true });
    });
    let reg = null;
    if (n) {
        reg = commitAiRegimen(base, { kind: meta.kind || 'chat', reason: meta.reason || '顾问改了方案', rationale: meta.rationale || '', blocked, model: meta.model, cost: meta.cost });
        _aiAfterRegimenChange();
    }
    return { kind: 'regimen', id: String(meta.id || ('p' + Date.now())).slice(0, 80), changes, result, blocked,
             versionId: reg ? reg.id : null, v: reg ? reg.v : null, state: n ? 'applied' : 'failed' };
}
function _aiAfterRegimenChange() {
    invalidatePlanCache();
    ['renderTn', 'renderWk', 'renderProds', 'updateCd'].forEach(f => { if (typeof window[f] === 'function') { try { window[f](); } catch (e) { } } });
}
function _aiUndoRegimen(rec) {
    if (!rec.versionId) return '这条没改成什么，不用撤';
    const why = undoRegimen(rec.versionId);
    if (!why) _aiAfterRegimenChange();
    return why;
}
// 只有最近一次「今晚的小改」能撤(撤旧的会把后面那次一起撤掉);方案改动按版本号判断,不用清
function _aiDropOldSnaps(kind) {
    const st = _aiMine(AIK.chat);
    if (!st || !st.chat) return;
    st.chat.forEach(m => { (m.recs || []).forEach(r => { if (r.kind === kind && r.state === 'applied') r.snap = null; }); });
    _aiSet(AIK.chat, st);
}
function _aiRecAfter(rec) {
    const ok = rec.changes.map((c, k) => rec.result[k] ? '' : ((rec.kind === 'tonight' ? _AI_TONIGHT_TXT : _AI_REG_TXT)[c.op] || (() => c.op))(c)).filter(Boolean);
    const bad = rec.changes.map((c, k) => rec.result[k] ? ((rec.kind === 'tonight' ? _AI_TONIGHT_TXT : _AI_REG_TXT)[c.op] || (() => c.op))(c) + '（' + rec.result[k] + '）' : '').filter(Boolean);
    if (rec.state === 'undone') return rec.kind === 'tonight' ? '(她点了撤销，今晚回到改之前)' : '(她点了撤销，方案回到上一版)';
    return (ok.length ? (rec.kind === 'tonight' ? '(已直接改了今晚：' : '(已直接改成新方案 v' + rec.v + '：') + ok.join('；') + ')' : '') +
        (bad.length ? '(被安全闸拦下 / 没改成：' + bad.join('；') + ')' : '');
}
function _aiRecHtml(rec, mi, ri) {
    const T = rec.kind === 'tonight' ? _AI_TONIGHT_TXT : _AI_REG_TXT;
    const rows = rec.changes.map((c, k) => {
        const bad = rec.result[k], txt = (T[c.op] || (() => c.op))(c);
        const part = !bad && (rec.blocked || []).find(b => b.partial && b.text === txt);
        return `<li class="${bad ? 'bad' : ''}">${_aiEsc(cjkSpace(txt))}${bad ? `<span class="why">，没生效：${_aiEsc(bad)}</span>` : (part ? `<span class="why">，${_aiEsc(part.why)}</span>` : (c.why ? `<span class="why">：${_aiEsc(c.why)}</span>` : ''))}</li>`;
    }).join('');
    const okN = rec.result.filter(x => !x).length;
    const head = rec.state === 'applied' ? (rec.kind === 'tonight' ? `改了今晚 · ${okN} 处` : `换成方案 v${rec.v} · ${okN} 处`)
        : rec.state === 'undone' ? '已撤销' : '没改成';
    const canUndo = rec.state === 'applied' && (rec.kind === 'tonight' ? !!rec.snap : !!rec.versionId);
    return `<div class="co-act" data-mi="${mi}" data-ri="${ri}"><div class="co-act-h">${_aiEsc(head)}</div><ul class="co-act-list">${rows}</ul>`
        + ((rec.dropped || []).length ? `<p class="note">还提到 ${rec.dropped.length} 个不在你产品库里的：${_aiEsc(rec.dropped.join('、'))}</p>` : '')
        + (rec.undoErr ? `<p class="note co-err">${_aiEsc(rec.undoErr)}</p>` : '')
        + (canUndo ? `<button type="button" class="btn-link" onclick="aiUndoRec(${mi},${ri})">撤销</button>` : '')
        + `</div>`;
}
function aiUndoRec(mi, ri) {
    const st = _aiMine(AIK.chat); if (!st) return;
    const m = st.chat[mi], rec = m && (m.recs || [])[ri];
    if (!rec || rec.state !== 'applied') return;
    const why = rec.kind === 'tonight' ? _aiUndoTonight(rec) : _aiUndoRegimen(rec);
    if (why) { rec.undoErr = why; _aiSet(AIK.chat, st); _aiShowChat(); _aiToast(why); return; }
    rec.state = 'undone'; rec.snap = null; delete rec.undoErr;
    m.after = (m.recs || []).map(_aiRecAfter).join('');
    _aiSet(AIK.chat, st);
    _aiShowChat();
    _aiToast(rec.kind === 'tonight' ? '已撤销 · 今晚回到改之前' : '已撤销 · 方案回到上一版');
}

// ══ 页面:顾问 ═════════════════════════════════════════════════════════════════
// 版式照 AUDIT-aesthetic §3(纸墨护理手册)与 AUDIT-ux §4.3:输入框 + 拍照在最上,快捷问题,对话,本周复盘,方案历史,记得的事。
function _aiStyle() { }   // 样式都在 index.html 的「纸墨护理手册」里,这里不再注入
function renderCoach() {
    const el = document.getElementById('coach-content');
    if (!el) return;
    const a = aiAccess();
    const privacy = `<div class="sec"><button class="btn-link quiet sm" onclick="aiPrivacySheet()">顾问会看到什么、存在哪</button></div>`;
    if (a === 'out') {
        el.innerHTML = `<div class="empty"><p class="lede">登录后可用。</p><p class="note">能问护肤问题、拍成分表认产品、让顾问出方案和每周复盘。没登录也没关系，今晚的步骤照离线规则排。</p>
            <div class="btn-row"><button class="btn btn-primary" onclick="signInGoogle()">用 Google 登录</button></div></div>${privacy}`;
        return;
    }
    if (a === 'none' || a === 'mismatch') {
        el.innerHTML = a === 'mismatch'
            ? `<div class="empty" id="co-access"><p class="lede">这个账号用不了顾问。</p><p class="note">这个邮箱已经绑定了另一个账号，换回第一次用的登录方式试试。</p></div>${privacy}`
            : `<div class="empty" id="co-access"><p class="lede">顾问是邀请制。</p><p class="note">每次调用都要花钱，现在只对受邀的人开放。没有邀请码也不影响今晚的步骤。</p>
                <label class="field"><span>邀请码</span><input id="co-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="ABCDE-FGHJK" onkeydown="if(event.key==='Enter')aiRedeem()"></label>
                <div class="btn-row syms"><button class="btn btn-primary" id="co-code-go" onclick="aiRedeem()">开通</button></div>
                <p class="note syms">邀请码用一次就作废，两周内有效。</p></div>${privacy}`;
        // 后台再核一次:可能已经被加进白名单了。一分钟最多一次 —— aiProbe 结束会重画这一页,不节流就成了死循环
        if (a === 'none' && Date.now() - (renderCoach._probeAt || 0) > 60000) { renderCoach._probeAt = Date.now(); aiProbe(true); }
        return;
    }
    const me = AI_ME && _aiMeUid === _aiUid() ? AI_ME : null;
    const owner = typeof isOwnerAccount === 'function' && isOwnerAccount();
    const quota = _aiQuotaText();
    const blocked = _aiDown || !!quota;
    const status = _aiDown ? '' : quota ? '' : me ? (owner ? `今天 $${Number(me.today || 0).toFixed(2)}${me.daily_cap ? ' / $' + Number(me.daily_cap).toFixed(0) : ''} · 本期 $${Number(me.cycle || 0).toFixed(2)}` : '在线') : '连接中…';
    const busy = _aiBusy;
    const QUICK = ['今晚能刷酸吗？', '这颗痘怎么办？', '这周怎么样？'];
    el.innerHTML = `
      <p class="meta" id="co-status">${status}</p>
      ${_aiDown ? `<div class="empty"><p class="lede">顾问暂时连不上，今晚照上一版做。</p><p class="note">顾问的服务在 Cait 家里的电脑上，可能没开或者网络断了。打卡和今晚的步骤都不受影响。</p><div class="btn-row"><button class="btn" onclick="aiProbe(true)">重试</button></div></div>` : ''}
      ${quota ? `<div class="empty"><p class="lede">${quota}</p><p class="note">今晚的步骤照离线规则排，打卡不受影响。</p></div>` : ''}
      ${blocked ? '' : `<div class="co-composer">
          <textarea id="co-chat-text" rows="1" placeholder="问点什么" aria-label="问顾问" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();aiSend()}"></textarea>
          <button class="btn" aria-label="拍照" onclick="aiPhotoMenu()">${ico('camera')}</button>
          <button class="btn btn-primary" id="co-chat-go" onclick="aiSend()" ${busy ? 'disabled' : ''} aria-label="发送">${ico('send')}</button>
        </div>
        <div id="co-chat-img"></div>
        <div class="chips co-quick">${QUICK.map(q => `<button class="chip" onclick="aiSend(${_aiEsc(JSON.stringify(q))})" ${busy ? 'disabled' : ''}>${q}</button>`).join('')}</div>`}
      <div id="co-result"></div>
      <div id="co-chat-log" class="co-log" aria-live="polite"></div>
      <div id="co-review"></div>
      <div class="sec"><div class="sec-h"><span class="sec-t">方案历史</span>${blocked ? '' : `<button class="btn-link sm quiet" id="co-plan-go" onclick="aiPlan()" ${busy ? 'disabled' : ''}>让顾问重排</button>`}</div>${typeof regimenHistoryHtml === 'function' ? regimenHistoryHtml(8) : ''}</div>
      <div class="sec" id="co-mem"></div>
      ${owner ? `<div class="sec" id="co-opts"></div>` : ''}
      ${privacy}`;
    _aiShowChat();
    _aiShowReview();
    _aiShowResult();
    if (!_aiDown) aiMemLoad();
    if (owner) _aiRenderOpts();
    if (!me && !_aiDown) aiProbe(true).then(() => { if (AI_ME && document.getElementById('co-status')) renderCoach(); });
    _aiMaybePrivacy();
}
// 第一次进顾问页弹一次数据说明(每个账号一次);之后在页底能再打开
function aiPrivacySheet(first) {
    const hrt = typeof PROFILE !== 'undefined' && PROFILE.hrt;
    openSheet({ id: 'ai-privacy', title: '顾问会看到什么', html: `<ul class="list lede">
            <li>你的产品清单和成分特性</li>
            <li>近 14 天的皮肤记录、备注、做了哪几步</li>
            <li>设置里的肤质、想解决的、要避开的区域${hrt ? '、HRT 阶段' : ''}；看过医生的记录（如果有）</li>
            <li>你发的对话和照片</li></ul>
        <p class="note syms">这些会发到 Cait 家里的服务器，再转给 Anthropic 的 Claude 模型生成回答。服务器只记每次花了多少钱，不存对话和照片；只存你让顾问「记住」的那几句，可以随时删。对话本身只存在这台设备上。</p>`,
        actions: [{ label: '知道了', primary: true, fn: () => _aiSet(AIK.privacy, { uid: _aiUid(), at: Date.now() }) }],
        onClose: () => { if (first) _aiSet(AIK.privacy, { uid: _aiUid(), at: Date.now() }); } });
}
function _aiMaybePrivacy() {
    if (!_aiUid() || _aiMine(AIK.privacy) || document.getElementById('ai-privacy')) return;
    const p = document.getElementById('coach');
    if (p && p.classList.contains('active')) aiPrivacySheet(true);
}
// 拍照先选做什么:拍皮肤(顾问看状态)/ 拍成分表(认产品)/ 随对话发一张
function aiPhotoMenu() {
    const lbl = (txt, cap, fn) => `<label class="btn btn-block file-btn">${ico('camera')}${txt}<input type="file" accept="image/*"${cap ? ` capture="${cap}"` : ''} onchange="closeSheet('ai-photo');${fn}"></label>`;
    openSheet({ id: 'ai-photo', title: '拍什么？', html: `<div class="acts stack-acts">
        ${lbl('拍皮肤，让顾问看看状态', 'user', "aiVision(this,'assess_skin')")}
        ${lbl('拍成分表，认是什么产品', 'environment', "aiVision(this,'read_label')")}
        ${lbl('随这条消息发一张图', '', 'aiAttach(this)')}</div>` });
}
function _aiRenderOpts() {
    const box = document.getElementById('co-opts'); if (!box) return;
    const me = AI_ME;
    if (!me) { box.innerHTML = '<div class="sec-h"><span class="sec-t">模型</span></div><p class="note">连上之后能选模型和思考深度。</p>'; return; }
    const o = _aiGet(AIK.opts) || {};
    const models = [['', '自动（按任务挑）']].concat((me.models || []).map(m => [m[0], m[1] + (m[2] ? ' · ' + m[2] : '')]));
    box.innerHTML = `<div class="sec-h"><span class="sec-t">模型与用量（只有你看得到）</span></div>
        <label class="field"><span>模型</span><select id="co-model" onchange="aiSetOpts()">${models.map(([k, n]) => `<option value="${_aiEsc(k)}" ${(o.model || '') === k ? 'selected' : ''}>${_aiEsc(n)}</option>`).join('')}</select></label>
        <label class="field"><span>思考深度${o.model ? '' : '（选了模型才生效）'}</span><select id="co-effort" onchange="aiSetOpts()" ${o.model ? '' : 'disabled'}>${(me.efforts || []).map(([k, n]) => `<option value="${_aiEsc(k)}" ${(o.effort || 'medium') === k ? 'selected' : ''}>${_aiEsc(n)}</option>`).join('')}</select></label>
        <p class="note syms">每天有上限；每月 17 号重置。</p>`;
}
function aiSetOpts() {
    const m = (document.getElementById('co-model') || {}).value || '', e = (document.getElementById('co-effort') || {}).value || 'medium';
    _aiSet(AIK.opts, m ? { model: m, effort: e } : {});
    _aiRenderOpts();
}
async function aiRedeem() {
    const inp = document.getElementById('co-code'), btn = document.getElementById('co-code-go');
    const code = (inp && inp.value || '').trim();
    if (!code) { if (inp) inp.focus(); return; }
    if (btn) { btn.disabled = true; btn.textContent = '核对中…'; }
    try {
        const r = await aiFetch('/api/redeem', { code });
        _aiRememberAccess('allowed');
        _aiToast(r.name ? '开通了，' + r.name : '开通了');
        await aiProbe(true);
        renderCoach();
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '开通'; }
        _aiToast(e.message);
    }
}

// ── 长期记忆 ──
let _aiMem = null;
async function aiMemLoad(force) {
    const box = document.getElementById('co-mem'); if (!box) return;
    if (_aiMem && _aiMem.uid === _aiUid() && !force) return _aiMemPaint();
    box.innerHTML = '<div class="sec-h"><span class="sec-t">顾问记得的事</span></div><p class="note">读取中…</p>';
    try { const r = await aiFetch('/api/memory'); _aiMem = { uid: _aiUid(), items: r.items || [] }; }
    catch (e) { _aiMem = { uid: _aiUid(), items: [], err: e.message }; }
    _aiMemPaint();
}
function _aiMemPaint() {
    const box = document.getElementById('co-mem'); if (!box || !_aiMem) return;
    const m = _aiMem;
    box.innerHTML = `<div class="sec-h"><span class="sec-t">顾问记得的事</span>${!m.err && m.items.length ? '<button class="btn-link sm quiet" onclick="aiMemClear()">全部清空</button>' : ''}</div>`
        + (m.err ? `<p class="note co-err">${_aiEsc(m.err)}</p><button class="btn-link" onclick="aiMemLoad(true)">再试一次</button>`
            : !m.items.length ? `<p class="note">还没有。对话里说「记住……」，比如对某个成分过敏、哪支用了会刺痛，开新对话也不会忘。</p>`
                : `<div class="rows">${m.items.map(x => `<div class="row"><span class="row-main"><span class="lede">${_aiEsc(cjkSpace(x.text))}</span><span class="note">${_aiEsc(String(x.at || '').slice(5, 10).replace('-', '/').replace(/^0/, '').replace('/0', '/'))}</span></span><button class="btn-link sm quiet" data-id="${_aiEsc(x.id)}" onclick="aiMemDelete(this.dataset.id)">删掉</button></div>`).join('')}</div>`)
        + `<p class="note syms">记在 Cait 家里的服务器上，只给你自己的顾问看。</p>`;
}
async function _aiMemPost(body, ok) {
    try { const r = await aiFetch('/api/memory', body); _aiMem = { uid: _aiUid(), items: r.items || [] }; _aiToast(ok); }
    catch (e) { if (e.info && Array.isArray(e.info.items)) _aiMem = { uid: _aiUid(), items: e.info.items }; _aiToast(e.message); }
    _aiMemPaint();
}
function aiMemDelete(id) { if (id) return _aiMemPost({ op: 'delete', id }, '删掉了'); }
function aiMemClear() {
    const n = (_aiMem && _aiMem.items || []).length;
    if (!n) return;
    sysConfirm('清空顾问记住的 ' + n + ' 件事？清了就找不回来。', () => _aiMemPost({ op: 'clear' }, '清空了'), { ok: '全部清空' });
}

// ── 对话 ──
function _aiChatState() { const st = _aiMine(AIK.chat); return st || { uid: _aiUid(), chat: [], ctx: null }; }
function aiNewChat() {
    const st = _aiChatState();
    const go = () => { _aiSet(AIK.chat, { uid: _aiUid(), chat: [], ctx: null }); _aiShowChat(); };
    if (!st.chat.length) return go();
    sysConfirm('开始新对话？之前的对话会清掉（已经改过的方案不受影响）。', go, { ok: '开始新对话' });
}
function _aiShowChat(streaming) {
    const el = document.getElementById('co-chat-log'); if (!el) return;
    const chat = _aiChatState().chat;
    const owner = typeof isOwnerAccount === 'function' && isOwnerAccount();
    el.innerHTML = chat.map((m, mi) => m.role === 'assistant'
        ? `<div class="msg ai"><span class="who">顾问 · ${_aiHM(m.at)}</span><div class="body">${_aiMd(m.text)}</div>${(m.recs || []).map((r, ri) => _aiRecHtml(r, mi, ri)).join('')}${m.mem ? `<p class="note">${_aiEsc(m.mem)}</p>` : ''}${owner && m.meta && m.meta.cost != null ? `<p class="meta">${_aiEsc(m.meta.model || '')} · $${Number(m.meta.cost).toFixed(3)}</p>` : ''}</div>`
        : `<div class="msg user"><span class="who">你 · ${_aiHM(m.at)}${m.img ? ' · 带了一张图' : ''}</span><div class="body">${_aiEsc(cjkSpace(m.text)).replace(/\n/g, '<br>')}</div></div>`).join('')
        + (streaming ? `<div class="msg ai"><span class="who">顾问</span><div class="body" id="co-stream"><span class="note">在想…</span></div></div>` : '')
        + (chat.length && !streaming ? `<div class="sec-h syms"><span></span><button class="btn-link sm quiet" onclick="aiNewChat()">新对话</button></div>` : '');
}
async function aiAttach(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    try { _aiPendingImg = await aiImage(f, 1024); } catch (e) { return _aiToast(e.message); }
    const b = document.getElementById('co-chat-img');
    if (b) b.innerHTML = `<div class="co-pending"><img src="${_aiPendingImg}" alt="待发送的图片"><button class="btn-link quiet" onclick="_aiPendingImg=null;this.parentNode.remove()">移除</button></div>`;
}
// 照片压到长边 1280、JPEG,别上传原图
function aiImage(file, max) {
    max = max || 1280;
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            const k = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            res(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('读不了这张图')); };
        img.src = url;
    });
}
// 发出去的历史:改动的结果(「已直接改了…」「她点了撤销」)跟着那条助手消息一起发,顾问才知道改没改成
function _aiHist(list, n) {
    const send = list.slice(-n).map(m => ({ role: m.role, text: m.text + (m.role === 'assistant' && m.after ? '\n\n' + m.after : '') }));
    while (send.length && send[0].role !== 'user') send.shift();
    return send;
}
function _aiReplyMsg(res) {
    const m = { role: 'assistant', text: res.text, meta: res.meta, at: Date.now(), recs: [] };
    if (res.act) { const r = aiApplyTonight(res.act); if (r) m.recs.push(r); }
    if (res.prop && Array.isArray(res.prop.changes) && res.prop.changes.length) {
        const r = aiApplyRegimen(res.prop.changes.slice(0, 8), { kind: 'chat', id: res.prop.id, reason: '对话里改的：' + String(res.prop.message || '').slice(0, 60), model: res.meta && res.meta.model, cost: res.meta && res.meta.cost });
        if ((res.prop.dropped || []).length) r.dropped = res.prop.dropped.slice(0, 6);
        m.recs.push(r);
    }
    if (res.mem) {
        const parts = [];
        if ((res.mem.added || []).length) parts.push('记住了：' + res.mem.added.map(x => '「' + x.text + '」').join(''));
        if ((res.mem.removed || []).length) parts.push('忘掉了：' + res.mem.removed.map(x => '「' + x.text + '」').join(''));
        if (res.mem.blocked) parts.push(res.mem.blocked + ' 条不适合记，没存');
        if (parts.length) m.mem = parts.join(' · ');
        _aiMem = null;
    }
    m.after = m.recs.map(_aiRecAfter).join('');
    return m;
}
async function aiSend(preset) {
    const ta = document.getElementById('co-chat-text');
    const text = String(preset != null ? preset : (ta && ta.value) || '').trim();
    if ((!text && !_aiPendingImg) || _aiBusy) return;
    if (aiAccess() !== 'on') return renderCoach();
    const st = _aiChatState();
    // 快照在对话开头拍一次、整段对话沿用(后端放进第一条消息,缓存命中);会变的放 live
    if (!st.chat.length || !st.ctx) st.ctx = buildSkincareContext();
    const img = _aiPendingImg;
    st.chat.push({ role: 'user', text: text || '(看图)', img: !!img, at: Date.now() });
    st.chat = st.chat.slice(-AI_CHAT_MAX);
    _aiSet(AIK.chat, st);
    if (ta) ta.value = '';
    _aiPendingImg = null;
    const ib = document.getElementById('co-chat-img'); if (ib) ib.innerHTML = '';
    _aiBusy = true;
    _aiShowChat(true);
    const go = document.getElementById('co-chat-go'); if (go) go.disabled = true;
    const res = await aiStream('/api/chat', Object.assign({ messages: _aiHist(st.chat, AI_CHAT_SEND), context: st.ctx, live: _aiLive(), image: img || undefined }, _aiOpts()),
        t => { const s = document.getElementById('co-stream'); if (s) s.innerHTML = _aiMd(t); });
    _aiBusy = false;
    const reply = res.text ? _aiReplyMsg(res) : null;   // 先执行改动(它会改存档),再读存档追加
    const st2 = _aiChatState();
    if (reply) st2.chat.push(reply); else st2.chat.pop();   // 失败就撤回刚才那条,免得两条用户消息连在一起
    _aiSet(AIK.chat, st2);
    if (!reply && ta) ta.value = text;
    if (document.getElementById('co-chat-log')) renderCoach();
    if (res.err) _aiToast(res.err);
}
// 从别的页跳过来问(方案卡「问顾问」、反馈卡「让顾问照这个调」)
function aiAsk(text) {
    const tab = document.getElementById('tab-coach');
    if (tab && typeof show === 'function') show('coach', tab);
    setTimeout(() => {
        const ta = document.getElementById('co-chat-text');
        if (!ta) return;
        if (text) ta.value = text;
        try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { }
    }, 60);
}

// ── 出方案 / 复盘 / 认图 ──
let _aiResult = null;   // 本次打开里最近一个「出方案 / 认图」结果(不存盘;方案本身已经落成一版存在 sk_regimen1)
function _aiShowResult() {
    const box = document.getElementById('co-result'); if (!box) return;
    const r = _aiResult;
    if (!r) { box.innerHTML = ''; return; }
    if (r.busy) { box.innerHTML = `<p class="note syms">${_aiEsc(r.busy)}</p>`; return; }
    if (r.err) { box.innerHTML = `<p class="note co-err syms">${_aiEsc(r.err)}</p>`; return; }
    if (r.kind === 'plan') {
        const reg = regimenHistory().find(x => x.id === r.versionId);
        box.innerHTML = `<div class="co-act"><div class="co-act-h">${r.state === 'undone' ? '已撤销 · 方案回到上一版' : '换成新方案 v' + (reg ? reg.v : '?')}</div>`
            + `<p class="lede">${_aiEsc(cjkSpace(r.rationale || ''))}</p>`
            + (r.blocked.length ? `<ul class="co-act-list">${r.blocked.map(b => `<li class="bad">${_aiEsc(cjkSpace(b.text))}<span class="why">，${b.partial ? '暂缓' : '没生效'}：${_aiEsc(b.why)}</span></li>`).join('')}</ul>` : '')
            + (r.gaps && r.gaps.length ? `<p class="note">缺一环：${r.gaps.map(g => _aiEsc(g.label)).join('、')}</p>` : '')
            + (r.state === 'applied' ? `<button class="btn-link" onclick="aiUndoPlan()">撤销</button>` : '') + `</div>`;
        return;
    }
    if (r.kind === 'read_label') {
        const d = r.data || {};
        box.innerHTML = `<div class="co-act"><div class="co-act-h">读成分表</div><p class="lede">${_aiEsc(cjkSpace(d.name || '没认出名字'))}</p>`
            + `<p class="note">${_aiEsc(ROLE_LABEL[r.role] || d.role || '')}${r.traits.length ? ' · ' + r.traits.map(t => (TRAIT_DEFS.find(x => x.k === t) || {}).l || t).join('、') : ''}</p>`
            + (d.note ? `<p class="note">${_aiEsc(cjkSpace(d.note))}</p>` : '')
            + (r.matched ? `<p class="note">${r.state === 'undone' ? '已撤销' : '已把成分特性写进「' + _aiEsc(r.matched) + '」'}</p>${r.state === 'applied' ? '<button class="btn-link" onclick="aiUndoLabel()">撤销</button>' : ''}`
                : `<button class="btn-link" onclick="aiLabelToProduct()">加进产品库</button>`)
            + `</div>`;
        return;
    }
    if (r.kind === 'assess_skin') {
        const d = r.data || {}, ax = d.axes || {};
        const L = { good: '好', ok: '一般', bad: '差' };
        box.innerHTML = `<div class="co-act"><div class="co-act-h">看皮肤</div>`
            + `<dl class="kv"><dt>屏障</dt><dd>${L[ax.barrier] || '—'}</dd><dt>出油</dt><dd>${L[ax.oil] || '—'}</dd><dt>闭口</dt><dd>${L[ax.congestion] || '—'}</dd><dt>炎症</dt><dd>${L[ax.calm] || '—'}</dd></dl>`
            + `<p class="lede syms">${_aiEsc(cjkSpace(d.note || ''))}</p>`
            + (r.saved ? '<p class="note">已记进今天的备注。</p>' : `<button class="btn-link" onclick="aiSkinToNote()">记进今天的备注</button>`) + `</div>`;
    }
}
async function aiPlan(request) {
    if (!aiReady()) { await aiProbe(true); if (!aiReady()) { _aiToast(_aiDown ? '顾问连不上，先按离线规则来' : '顾问还没开通'); return; } }
    if (_aiInflight.plan) return;
    _aiInflight.plan = true;
    _aiResult = { busy: '顾问在按你现在的皮肤和家里的东西排方案…' };
    _aiShowResult();
    try {
        const r = await aiPoint('/api/plan', Object.assign({ context: buildSkincareContext(), request: request || undefined }, _aiOpts()));
        const v = _validatePlan(r.data || {}, safetyGate());
        const reg = commitAiRegimen(v.rules, { kind: 'plan', reason: '顾问出的方案', rationale: (r.data && r.data.rationale) || '', blocked: v.blocked, model: r.model, cost: r.cost });
        _aiAfterRegimenChange();
        _aiResult = { kind: 'plan', versionId: reg.id, rationale: (r.data && r.data.rationale) || '', blocked: v.blocked, gaps: (r.data && r.data.gaps) || [], meta: { model: r.model, cost: r.cost }, state: 'applied' };
        _aiToast('已换成顾问的方案 v' + reg.v + ' · 可以撤销');
    } catch (e) { _aiResult = { err: e.message }; }
    _aiInflight.plan = false;
    _aiShowResult();
    if (typeof renderRegimenCard === 'function') renderRegimenCard();
}
function aiUndoPlan() {
    const r = _aiResult; if (!r || r.kind !== 'plan' || r.state !== 'applied') return;
    const why = undoRegimen(r.versionId);
    if (why) { _aiToast(why); return; }
    r.state = 'undone'; _aiAfterRegimenChange(); _aiShowResult(); _aiToast('已撤销 · 方案回到上一版');
}
// 方案卡上的按钮(index.html 的 renderRegimenCard 来要)
// 方案段底下的按钮(index.html 的 renderRegimenCard 来要)
function aiRegimenActionsHtml(reg) {
    const a = aiAccess(), btn = [];
    if (a === 'on' && !_aiDown && !_aiQuotaText()) {
        btn.push(`<button class="btn-link" onclick="aiAsk('关于现在这版方案：')">问顾问</button>`);
        if (!reg || reg.source !== 'ai' || reg.stale) btn.push(`<button class="btn-link quiet" onclick="aiPlan()">${reg && reg.stale ? '让顾问按新货架重排' : '让顾问出方案'}</button>`);
    } else if (a === 'none') btn.push(`<span class="note">顾问是邀请制，在「顾问」页填邀请码。</span>`);
    return btn.length ? `<div class="btn-row syms">${btn.join('')}</div>` : '';
}
function aiUndoCurrent() {
    const last = currentRegimen(); if (!last || last.source !== 'ai') return;
    sysConfirm('撤销这一版顾问方案，回到上一版？', () => {
        const why = undoRegimen(last.id);
        if (why) { _aiToast(why); return; }
        _aiAfterRegimenChange();
        _aiToast('已撤销，方案回到上一版');
    }, { ok: '撤销' });
}

// 每周复盘:每周一之后第一次打开自动跑一次(sk_ai1.reviewWeek 跟云走,两台设备不会各跑一遍);也能手动点
function _aiState() { return lg(K.ai) || {}; }
function _aiSaveState(st) { ls(K.ai, st); }
function _aiShowReview() {
    const box = document.getElementById('co-review'); if (!box) return;
    const rv = _aiState().review;
    const go = _aiDown || _aiQuotaText() ? '' : `<button class="btn-link sm quiet" id="co-review-go" onclick="aiReview()" ${_aiBusy ? 'disabled' : ''}>${rv && rv.week === _aiWeek() ? '再复盘一次' : '现在复盘'}</button>`;
    if (!rv || !rv.data) { box.innerHTML = `<div class="sec"><div class="sec-h"><span class="sec-t">本周复盘</span>${go}</div><p class="note">每周一之后第一次打开会自动复盘一次（近两周至少记了 3 天皮肤才跑）。</p></div>`; return; }
    const d = rv.data;
    const rows = (rv.rec && rv.rec.changes || []).map((c, k) => {
        const bad = rv.rec.result[k], txt = (_AI_REG_TXT[c.op] || (() => c.op))(c);
        return `<li class="${bad ? 'bad' : ''}">${_aiEsc(cjkSpace(txt))}${bad ? `<span class="why">，没生效：${_aiEsc(bad)}</span>` : (c.why ? `<span class="why">：${_aiEsc(c.why)}</span>` : '')}</li>`;
    }).join('');
    box.innerHTML = `<div class="sec"><div class="sec-h"><span class="sec-t">本周复盘 <span class="mono">${_aiEsc(rv.week || '')}</span></span>${go}</div>`
        + `<p class="lede">${_aiEsc(cjkSpace(d.headline || ''))}</p>`
        + `<p class="note">${_aiMd(d.summary || '')}</p>`
        + ((d.wins || []).length ? `<dl class="kv"><dt>做得好</dt><dd>${d.wins.map(w => `<span class="note">${_aiEsc(cjkSpace(w))}</span>`).join('')}</dd></dl>` : '')
        + ((d.issues || []).length ? `<dl class="kv"><dt>要注意</dt><dd>${d.issues.map(w => `<span class="note">${_aiEsc(cjkSpace(w))}</span>`).join('')}</dd></dl>` : '')
        + (rows ? `<div class="co-act"><div class="co-act-h">${rv.rec.state === 'applied' ? '按复盘换成方案 v' + rv.rec.v : rv.rec.state === 'undone' ? '复盘的调整已撤销' : '复盘的调整都没生效'}</div><ul class="co-act-list">${rows}</ul>`
            + (rv.rec.state === 'applied' && rv.rec.versionId ? `<button class="btn-link" onclick="aiUndoReview()">撤销</button>` : '') + `</div>` : '')
        + (rv.replan ? `<button class="btn-link" onclick="aiPlan('复盘建议整套重排')">复盘建议整套重排，让顾问出方案</button>` : '')
        + `</div>`;
}
async function aiReview(auto) {
    if (!aiReady()) { if (!auto) { await aiProbe(true); if (!aiReady()) { _aiToast(_aiDown ? '顾问连不上，先按离线规则来' : '顾问还没开通'); return; } } else return; }
    if (_aiInflight.review) return;
    _aiInflight.review = true;
    const week = _aiWeek();
    const st0 = _aiState();
    if (auto) { st0.reviewWeek = week; _aiSaveState(st0); }   // 先占位:别在请求还没回来时又触发一次
    const b = document.getElementById('co-review-go'); if (b) { b.disabled = true; b.textContent = '复盘中…'; }
    try {
        const r = await aiPoint('/api/review', Object.assign({ context: buildSkincareContext() }, _aiOpts()));
        const d = r.data || {};
        const TYPE2OP = { acid_freq: 'acid_freq', add_product: 'add_product', remove_product: 'remove_product', phase: 'phase', zone: 'zone' };
        const changes = (d.adjustments || []).filter(x => x && TYPE2OP[x.type]).slice(0, 6).map(x => ({
            op: TYPE2OP[x.type], product: x.type === 'phase' ? '' : (x.item || ''), value: x.value || '', why: x.reason || '' }));
        const rec = changes.length ? aiApplyRegimen(changes, { kind: 'review', id: 'rv' + Date.now(), reason: '每周复盘：' + String(d.headline || '').slice(0, 50), rationale: d.summary || '', model: r.model, cost: r.cost }) : null;
        const st = _aiState();
        st.reviewWeek = week;
        st.review = { week, at: new Date().toISOString(), auto: !!auto, data: d, rec, replan: (d.adjustments || []).some(x => x && x.type === 'replan'), meta: { model: r.model, cost: r.cost } };
        _aiSaveState(st);
        _aiToast(rec && rec.state === 'applied' ? '复盘好了 · 方案已按复盘调整，可以撤销' : '复盘好了');
    } catch (e) {
        if (auto) { const st = _aiState(); if (st.reviewWeek === week && !(st.review && st.review.week === week)) { delete st.reviewWeek; _aiSaveState(st); } }
        if (!auto) _aiToast(e.message);
    }
    _aiInflight.review = false;
    if (document.getElementById('co-review')) renderCoach();
    if (typeof renderRegimenCard === 'function') renderRegimenCard();
}
function aiUndoReview() {
    const st = _aiState(), rv = st.review;
    if (!rv || !rv.rec || rv.rec.state !== 'applied') return;
    const why = undoRegimen(rv.rec.versionId);
    if (why) { _aiToast(why); return; }
    rv.rec.state = 'undone'; _aiSaveState(st); _aiAfterRegimenChange(); _aiShowReview(); _aiToast('已撤销 · 方案回到上一版');
}
function _aiMaybeAutoReview() {
    if (!aiReady() || _aiInflight.review) return;
    if (typeof _applyingCloud !== 'undefined' && _applyingCloud) return;
    const st = _aiState();
    if (st.reviewWeek === _aiWeek()) return;
    // 没什么可复盘的就不花这笔钱:近两周至少记了 3 天状态
    if (jrnlLastNDays(14).filter(e => (e.status || []).length).length < 3) return;
    aiReview(true);
}

// 认图:读成分标 → traits 写进产品(已有的直接写、可撤销;新的预填进添加产品弹窗)/ 看皮肤 → 辅助评估
let _aiLabelSnap = null;
function _aiNorm(s) { return String(s || '').toLowerCase().replace(/[\s'’·\-_.,()（）]/g, ''); }
function _aiMatchProduct(name) {
    const n = _aiNorm(name); if (n.length < 3) return null;
    return PD.find(p => !p.hidden && (_aiNorm(p.name) === n)) ||
        PD.find(p => !p.hidden && _aiNorm(p.name).length >= 4 && (n.indexOf(_aiNorm(p.name)) >= 0 || _aiNorm(p.name).indexOf(n) >= 0)) || null;
}
async function aiVision(input, mode) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!aiReady()) { await aiProbe(true); if (!aiReady()) { _aiToast(_aiDown ? '顾问连不上，先手动加' : '顾问还没开通'); if (mode === 'read_label') openAddProduct(); return; } }
    let img;
    try { img = await aiImage(f, 1280); } catch (e) { return _aiToast(e.message); }
    _aiResult = { busy: mode === 'read_label' ? '在读成分标…' : '在看皮肤…' };
    if (document.getElementById('co-result') && document.getElementById('coach').classList.contains('active')) _aiShowResult(); else _aiToast(_aiResult.busy);
    try {
        const r = await aiPoint('/api/vision', Object.assign({ context: buildSkincareContext(), image: img, mode }, _aiOpts()));
        aiVisionResult(r.data || {}, mode, { model: r.model, cost: r.cost });
    } catch (e) { _aiResult = { err: e.message }; _aiShowResult(); _aiToast(e.message); }
}
// 拆出来单独一个函数:结果怎么落地(测试直接喂假数据走这里)
function aiVisionResult(d, mode, meta) {
    if (mode === 'assess_skin') { _aiResult = { kind: 'assess_skin', data: d, meta }; _aiShowResult(); return _aiResult; }
    const traits = cleanTraits(d.traits);
    let role = AI_ROLE_FROM_CN[String(d.role || '').trim()] || '';
    if (role === 'acid' && (traits.indexOf('clay') >= 0 || traits.indexOf('scrub') >= 0)) role = 'mask';
    const hit = _aiMatchProduct(d.name);
    _aiResult = { kind: 'read_label', data: d, role, traits, meta, matched: null, state: '' };
    if (hit && traits.length) {
        // 家里已经有这支:成分特性直接写进它自己(数据随 sk_proddefs1 同步),留快照可撤
        _aiLabelSnap = { id: hit.id, had: Array.isArray(hit.traits), traits: Array.isArray(hit.traits) ? hit.traits.slice() : null };
        hit.traits = traits;
        ls(K.prodDefs, PD);
        _aiResult.matched = hit.name; _aiResult.state = 'applied';
        _aiAfterRegimenChange();
        _aiToast('已把成分特性写进「' + hit.name + '」· 可以撤销');
    } else if (!hit) {
        // 新产品:预填进添加产品弹窗,她看一眼排班方式再存
        aiLabelToProduct();
    }
    _aiShowResult();
    return _aiResult;
}
function aiLabelToProduct() {
    const r = _aiResult; if (!r || r.kind !== 'read_label') return;
    showProdModal(null, { name: (r.data && r.data.name) || '', role: r.role, traits: r.traits, note: (r.data && r.data.note) ? '顾问读成分标：' + r.data.note : '顾问按成分标预填的，看一眼再存。' });
}
function aiUndoLabel() {
    const r = _aiResult, s = _aiLabelSnap;
    if (!r || r.state !== 'applied' || !s) return;
    const p = PD.find(x => x.id === s.id);
    if (p) { if (s.had) p.traits = s.traits; else delete p.traits; ls(K.prodDefs, PD); }
    r.state = 'undone'; _aiLabelSnap = null;
    _aiAfterRegimenChange(); _aiShowResult(); _aiToast('已撤销');
}
function aiSkinToNote() {
    const r = _aiResult; if (!r || r.kind !== 'assess_skin' || r.saved) return;
    const e = lg(K.jrnl) || [];
    let en = e.find(x => x.date === today());
    if (!en) { en = { date: today(), status: [], products: [], note: '', phase: '' }; e.unshift(en); }
    en.note = (en.note ? en.note + '；' : '') + '顾问看照片：' + String((r.data && r.data.note) || '').slice(0, 80);
    ls(K.jrnl, e.slice(0, 365));
    r.saved = true; _aiShowResult();
}
// 产品页顶上的入口:拍成分标
function aiRenderProdEntry() { }   // 「拍成分表」并进了产品页的「添加」,这个挂点已经没了

// ── 今晚页:今日顾问的话(一天一次,本机缓存)+ 打卡反馈 ──
function aiRenderTonight() {
    _aiStyle();
    const fb = document.getElementById('ai-feedback');
    if (fb) {
        const f = (_aiState().feedback || {})[today()];
        fb.innerHTML = f ? _aiFeedbackHtml(f) : '';
    }
    _aiMaybeNote();
    _aiMaybeAutoReview();
}
// 今天顾问的话(一天一次,本机缓存):今晚页标题下面那一行用它;没有就用规则文案
function aiNoteToday() {
    const n = _aiMine(AIK.note);
    return (n && n.date === today() && n.note) ? String(n.note) : '';
}
function _aiMaybeNote() {
    if (!aiReady() || _aiInflight.note) return;
    if (typeof _applyingCloud !== 'undefined' && _applyingCloud) return;
    const n = _aiMine(AIK.note);
    if (n && n.date === today()) return;
    if (_aiMaybeNote.tried === today() + _aiUid()) return;   // 这次打开已经试过一次(失败也别一直重试)
    _aiMaybeNote.tried = today() + _aiUid();
    _aiInflight.note = true;
    aiPoint('/api/note', Object.assign({ context: buildSkincareContext() }, _aiOpts()))
        .then(r => { if (r && r.data && r.data.note) { _aiSet(AIK.note, { uid: _aiUid(), date: today(), note: r.data.note, model: r.model, cost: r.cost }); if (typeof renderTnSay === 'function') renderTnSay(); } })
        .catch(() => { })
        .then(() => { _aiInflight.note = false; });
}
function _aiFeedbackHtml(f) {
    if (f.busy) return `<p class="note">顾问在看你今晚的记录…</p>`;
    if (f.err) return `<p class="note co-err">${_aiEsc(f.err)}</p><button class="btn-link" onclick="aiAfterCheckin(today(), true)">再试一次</button>`;
    const adj = (f.next_adjust || []);
    return `<div class="co-act" id="ai-fb-card"><div class="co-act-h">顾问</div>`
        + `<div class="lede">${_aiMd(f.text || '')}</div>`
        + (adj.length ? `<ul class="co-act-list">${adj.map(x => `<li>${_aiEsc(cjkSpace(x.item))}：${_aiEsc(cjkSpace(x.change))}${x.why ? `<span class="why">。${_aiEsc(x.why)}</span>` : ''}</li>`).join('')}</ul>`
            + `<button class="btn-link" onclick="closeSheet('done-sheet');aiAsk(${_aiEsc(JSON.stringify('按打卡反馈调一下：' + adj.map(x => x.item + x.change).join('；')))})">让顾问照这个调</button>` : '')
        + (f.note_add && !f.noteSaved ? `<button class="btn-link quiet" onclick="aiFeedbackNote()">把「${_aiEsc(f.note_add)}」加进今天的记录</button>` : '')
        + `</div>`;
}
async function aiAfterCheckin(date, force) {
    if (!aiReady() || date !== today()) return;
    const st = _aiState();
    st.feedback = st.feedback || {};
    if (st.feedback[date] && !st.feedback[date].err && !force) { aiRenderTonight(); return; }
    const box = document.getElementById('ai-feedback');
    if (box) box.innerHTML = _aiFeedbackHtml({ busy: true });
    const e = (lg(K.jrnl) || []).find(x => x.date === date) || {};
    const session = { date, status: e.status || [], note: e.note || '', used: e.products || [], ticked: [...loadDoneSteps('tn')] };
    let f;
    try {
        const r = await aiPoint('/api/feedback', Object.assign({ context: buildSkincareContext(), session }, _aiOpts()));
        f = Object.assign({}, r.data || {}, { meta: { model: r.model, cost: r.cost } });
    } catch (err) { f = { err: err.message }; }
    const st2 = _aiState();
    st2.feedback = st2.feedback || {};
    st2.feedback[date] = f;
    Object.keys(st2.feedback).sort().slice(0, -7).forEach(k => delete st2.feedback[k]);   // 只留最近 7 天
    _aiSaveState(st2);
    aiRenderTonight();
}
function aiFeedbackNote() {
    const st = _aiState(), f = (st.feedback || {})[today()];
    if (!f || !f.note_add || f.noteSaved) return;
    const e = lg(K.jrnl) || [];
    let en = e.find(x => x.date === today());
    if (!en) { en = { date: today(), status: [], products: [], note: '', phase: '' }; e.unshift(en); }
    en.note = (en.note ? en.note + '；' : '') + f.note_add;
    ls(K.jrnl, e.slice(0, 365));
    f.noteSaved = true; _aiSaveState(st);
    aiRenderTonight();
}

// ══ 要不要买新的:顾问判断(Cait 10/29 拍板)══════════════════════════════════════════
// 后端 POST /api/shop {context, trigger} → {data:{verdict, summary, items[], skip[]}}。真跑一次约 70 秒、$0.26,
// 所以**只在后台跑**,不进 _aiSerial 那条队(后端给它单独的忙碌位,不挡对话);界面上一直有东西看(上次的结果或离线清单)。
// 【要紧】什么时候自动跑(10/29 定案):**只在本机操作之后** —— index.html 的用户入口(标 / 取消快用完、用完了、补货、添加、
//   不要了、恢复、本机采纳 / 撤销 / 回到某一版方案)显式调 aiShopLocal(原因),防抖 _aiShopDelay 后跑一次。
//   云端同步带来的签名变化、syncRegimen 自动重出、第一次打开(本机没结果)一律**不自动调**:签名对不上只标「货架变了，结果可能过时」,
//   没结果就是离线清单 +「让顾问判断」。别改回「签名变了就调」—— 那样每台设备各花一次钱(结果按设备存)。
// 结果按账号存本机 sk_ai_shop1({uid, sig, at, trigger, data, parts}),不进 CLOUD_KEYS;换账号 aiClearLocal 会清,读的时候也核 uid。
// 顾问用不了 / 出错 → 产品页退回 index.html 的离线 regimenNeeds / SHOP_ADVICE / SHOP_PICKS(那套一行没删)。
let _aiShopDelay = 5000;           // 防抖(毫秒)
let _aiShopT = null;               // 排着的那一次
let _aiShopWhyQ = [];              // 防抖窗口里攒下的本机操作原因
let _aiShopAgain = false;          // 跑着的时候又有本机操作 → 跑完再排一次
let _aiShopRun = null;             // 正在跑的 {uid, sig}
let _aiShopErr = null;             // 最近一次失败 {uid, sig, msg}(只用来显示)
const AI_SHOP_URG = [['now', '现在就缺'], ['before_out', '快用完前备上'], ['optional', '可买可不买']];
function _aiShopReset() { clearTimeout(_aiShopT); _aiShopT = null; _aiShopWhyQ = []; _aiShopAgain = false; _aiShopRun = null; _aiShopErr = null; }
// 货架签名的组成(存进结果,方便回看那次判断时货架是什么样)
function _aiShopParts() {
    const shelf = {};
    shelfProducts().forEach(p => { shelf[p.id] = p.name; });
    const reg = currentRegimen();
    return { shelf, low: LOW.filter(id => PD.some(p => p.id === id)).sort(), v: reg ? (reg.v || 0) : 0 };
}
function aiShopSig() {
    const reg = currentRegimen();
    return shelfSignature() + '|low:' + LOW.filter(id => PD.some(p => p.id === id)).sort().join(',') + '|v' + (reg ? (reg.v || 0) : 0);
}
function _aiShopRec() { const r = _aiMine(AIK.shop); return (r && r.data && typeof r.data === 'object') ? r : null; }
// 本机操作入口(index.html 调):记下原因,防抖后跑一次。没开通 / 连不上就什么都不做(产品页本来就是离线版)
function aiShopLocal(why) {
    if (!aiReady()) return;
    if (why && _aiShopWhyQ.indexOf(why) < 0) _aiShopWhyQ.push(String(why).slice(0, 80));
    if (_aiShopRun) { _aiShopAgain = true; return; }
    const uid = _aiUid();
    clearTimeout(_aiShopT);
    _aiShopT = setTimeout(() => {
        _aiShopT = null;
        const q = _aiShopWhyQ; _aiShopWhyQ = [];
        if (!aiReady() || _aiUid() !== uid) return;
        const rec = _aiShopRec();
        if (rec && rec.sig === aiShopSig()) return;   // 改了又改回来:货架和上次判断时一样,不花这笔钱
        aiShopRun(q.slice(0, 4).join('；') || '货架有变化');
    }, _aiShopDelay);
    _aiShopPaint();
}
function aiShopRedo() { clearTimeout(_aiShopT); _aiShopT = null; _aiShopWhyQ = []; return aiShopRun(_aiShopRec() ? '她点了「重新判断」' : '她点了「让顾问判断」'); }
async function aiShopRun(why) {
    if (!aiReady() || _aiShopRun) return;
    const uid = _aiUid(), sig = aiShopSig(), parts = _aiShopParts();
    const trigger = why || '货架有变化';
    _aiShopRun = { uid, sig }; _aiShopErr = null;
    _aiShopPaint();
    try {
        let r;
        for (let i = 0; ; i++) {
            try { r = _aiClean(await aiFetch('/api/shop', Object.assign({ context: buildSkincareContext(), trigger }, _aiOpts()))); break; }
            catch (e) { if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await new Promise(res => setTimeout(res, 8000)); continue; } throw e; }
        }
        const d = _aiShopNorm(r && r.data);
        if (!d) throw new Error('顾问这次没给出结论');
        if (_aiUid() === uid) _aiSet(AIK.shop, { uid, sig, at: new Date().toISOString(), trigger, data: d, parts, model: r.model || '', cost: r.cost || 0 });
    } catch (e) {
        if (_aiUid() === uid) _aiShopErr = { uid, sig, msg: e.message || '顾问出错了' };
    }
    _aiShopRun = null;
    _aiShopPaint();
    if (_aiShopAgain) { _aiShopAgain = false; if (_aiUid() === uid) aiShopLocal(''); else _aiShopWhyQ = []; }   // 跑的时候她又动了货架 → 再排一次
}
// 后端已经 clean_shop 过;这里只保证形状,url 只认 https
function _aiShopNorm(d) {
    if (!d || typeof d !== 'object') return null;
    const str = x => String(x == null ? '' : x).trim();
    const items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x === 'object' && (str(x.need) || str(x.what))).map(x => ({
        need: str(x.need), urgency: ['now', 'before_out', 'optional'].indexOf(x.urgency) >= 0 ? x.urgency : 'optional',
        what: str(x.what), why: str(x.why), cover: str(x.cover), replaces: str(x.replaces),
        picks: (Array.isArray(x.picks) ? x.picks : []).filter(k => k && str(k.name)).map(k => ({
            name: str(k.name), where: str(k.where), price: str(k.price), why: str(k.why), url: /^https:\/\//.test(str(k.url)) ? str(k.url) : '' }))
    }));
    const skip = (Array.isArray(d.skip) ? d.skip : []).filter(x => x && str(x.name)).map(x => ({ name: str(x.name), why: str(x.why) }));
    return { verdict: items.length ? 'buy' : 'none', summary: str(d.summary), items, skip };
}
function _aiShopPaint() { if (typeof renderShop === 'function') { try { renderShop(); } catch (e) { console.warn('shop', e); } } }
function _aiShopWhen(iso) { const d = new Date(iso); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + _aiHM(iso); }
// 产品页「要不要买新的」的顾问版。返回 null = 用离线那套;否则 {html, busy, redo}
// 显示顾问版:有这个账号的结果,而且(签名没变 / 正在重判 / 没有失败过)。签名变了、重判又失败 → 退回离线(旧结果已经不对得上货架了)
function aiShopView() {
    if (aiAccess() !== 'on') return null;
    const ready = aiReady(), uid = _aiUid(), rec = _aiShopRec();
    const busy = !!(_aiShopRun && _aiShopRun.uid === uid);
    const sig = aiShopSig();
    const err = (_aiShopErr && _aiShopErr.uid === uid) ? _aiShopErr : null;
    const fresh = !!rec && rec.sig === sig;
    if (!rec || (!fresh && err && !busy)) {
        // 没有可用的顾问结果:离线版照常,上面只挂一行状态
        const line = busy ? '顾问在查型号，大约一分钟。下面先按离线规则看。'
            : err ? '顾问这次没查成（' + err.msg + '），下面先按离线规则看。' : '';
        return { html: '', status: line, busy, redo: ready, redoLabel: '让顾问判断', fallback: true };
    }
    const d = rec.data;
    const st = busy ? '顾问在查…（上次的结果先留着）' : !fresh ? '货架变了，结果可能过时' : '';
    let h = `<p class="lede">${d.verdict === 'none' ? '现在不用买。' : ''}${_aiEsc(cjkSpace(d.summary || ''))}</p>`;
    h += `<p class="meta">顾问 · ${_aiEsc(_aiShopWhen(rec.at))} 判断${rec.trigger ? '<span class="shop-trig">，因为' + _aiEsc(cjkSpace(rec.trigger)) + '</span>' : ''}</p>`;
    if (st) h += `<p class="note shop-st" role="status">${_aiEsc(st)}</p>`;
    AI_SHOP_URG.forEach(([u, label]) => {
        const list = d.items.filter(x => x.urgency === u);
        if (!list.length) return;
        h += `<div class="shop-g"><div class="sec-t">${label}</div><ul class="shop">${list.map(x => `<li>
            <p class="lede">${_aiEsc(cjkSpace(x.need || x.what))}${x.replaces ? `<span class="note">，接班「${_aiEsc(cjkSpace(x.replaces))}」</span>` : ''}</p>
            ${x.what && x.need ? `<p class="note">${_aiEsc(cjkSpace(x.what))}</p>` : ''}
            ${x.why ? `<p class="note">为什么：${_aiEsc(cjkSpace(x.why))}</p>` : ''}
            ${x.cover ? `<p class="note">买到之前：${_aiEsc(cjkSpace(x.cover))}</p>` : ''}
            ${x.picks.length ? `<ul class="picks">${x.picks.map(k => `<li>${k.url ? `<a href="${_aiEsc(k.url)}" target="_blank" rel="noopener">${_aiEsc(cjkSpace(k.name))}</a>` : `<span class="pick-n">${_aiEsc(cjkSpace(k.name))}</span>`}
                <span class="note">${_aiEsc(cjkSpace([k.price, k.where].filter(Boolean).join(' · ')))}${k.why ? (k.price || k.where ? '。' : '') + _aiEsc(cjkSpace(k.why)) : ''}</span></li>`).join('')}</ul>` : ''}
        </li>`).join('')}</ul></div>`;
    });
    if (d.skip.length) h += `<details class="fold shop-skip"><summary><span class="fold-sum"><span class="lede">这些不用买：${_aiEsc(cjkSpace(d.skip.map(x => x.name).join('、')))}</span></span></summary>
        <ul class="fold-body list note">${d.skip.map(x => `<li>${_aiEsc(cjkSpace(x.name))}${x.why ? '：' + _aiEsc(cjkSpace(x.why)) : ''}</li>`).join('')}</ul></details>`;
    return { html: h, status: '', busy, redo: ready, redoLabel: '重新判断', fallback: false };
}
// 复制清单:有顾问版就复制顾问版;返回 null = 用离线那份
function aiShopCopyText() {
    const v = aiShopView();
    if (!v || v.fallback) return null;
    const rec = _aiShopRec(), d = rec.data;
    if (d.verdict === 'none') return { none: true, text: '现在不用买。' + (d.summary || '') };
    const lines = ['护肤要买的（顾问 ' + _aiShopWhen(rec.at) + ' 判断）', d.summary || ''];
    AI_SHOP_URG.forEach(([u, label]) => {
        const list = d.items.filter(x => x.urgency === u);
        if (!list.length) return;
        lines.push('', label);
        list.forEach((x, i) => {
            lines.push((i + 1) + '. ' + (x.need || x.what) + (x.replaces ? '（接班「' + x.replaces + '」）' : ''));
            if (x.what && x.need) lines.push('   ' + x.what);
            if (x.why) lines.push('   为什么：' + x.why);
            if (x.cover) lines.push('   买到之前：' + x.cover);
            x.picks.forEach(k => lines.push('   型号：' + k.name + ([k.price, k.where].filter(Boolean).length ? '（' + [k.price, k.where].filter(Boolean).join('，') + '）' : '') + (k.url ? ' ' + k.url : '')));
        });
    });
    if (d.skip.length) lines.push('', '这些不用买：' + d.skip.map(x => x.name + (x.why ? '（' + x.why + '）' : '')).join('；'));
    return { none: false, text: lines.filter((l, i) => !(i === 1 && !l)).join('\n') };
}

// ── 钩子:登录 / 换账号 / 清本机 ──
function aiClearLocal() { Object.values(AIK).forEach(k => localStorage.removeItem(k)); AI_ME = null; _aiMeUid = null; _aiProbeUid = null; _aiMem = null; _aiResult = null; _aiShopReset(); }
function aiOnAuth(user) {
    if (!user) { AI_ME = null; _aiMeUid = null; _aiProbeUid = null; _aiRefresh(); return; }
    // 本机缓存属于别的账号 → 清掉(换账号时 index.html 也会调 aiClearLocal,这里是双保险)
    Object.values(AIK).forEach(k => { const v = _aiGet(k); if (v && v.uid && v.uid !== user.uid) localStorage.removeItem(k); });
    aiProbe();
}
(function aiBoot() {
    _aiStyle();
    if (typeof renderRegimenCard === 'function') renderRegimenCard();
    aiRenderTonight();
    aiRenderProdEntry();
    if (_aiUser()) aiProbe();
})();
