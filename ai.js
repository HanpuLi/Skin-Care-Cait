// ══ 护肤顾问(AI)══════════════════════════════════════════════════════════════
// index.html 只留挂载点和钩子(#coach-content / #ai-note / #ai-feedback / #ai-prod-entry,以及
// aiOnAuth / aiClearLocal / aiRenderTonight / aiAfterCheckin / aiRegimenActionsHtml / renderCoach)。这里管:
//   · 鉴权 + 网络:取 Firebase ID token、fetch / SSE、每人同时 1 个请求的排队、开通状态(未登录 / 邀请制 / 可用 / 连不上)
//   · 上下文拼装 buildSkincareContext()(照 ~/skincare-coach/BRIEF.md 的契约)
//   · 对话(SSE)、认图(读成分标 / 看皮肤)、出方案、方案复盘(每周一次自动)、今日顾问的话、打卡反馈、长期记忆
//   · 🔴 AI 的改动**一律直接生效 + 一键撤销**(Cait 2026-10-29「放开了动」,不做「采纳」门槛);
//     应用前每一条都过 _validate*(安全闸,唯一红线),被拦的写明为什么没生效。
// 这个文件挂了 / 没缓存上 / 后端连不上:index.html 的离线规则(阶梯 + 安全闸)照常排今晚,不会白屏。

const AI_BASE = (['127.0.0.1', 'localhost'].indexOf(location.hostname) >= 0) ? 'http://127.0.0.1:8808' : 'https://node.tail95239f.ts.net/skin';
const AI_CHAT_MAX = 40, AI_CHAT_SEND = 24;
// 本机缓存(不进云;换账号时 aiClearLocal 清掉):对话、今日顾问的话、开通状态、模型选择
const AIK = { chat: 'sk_aichat1', note: 'sk_ainote1', acc: 'sk_aiacc1', opts: 'sk_aiopts1' };
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
    return _aiEsc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').split('\n').map(l => /^\s*[-·•]\s+/.test(l) ? '<div class="co-li">· ' + l.replace(/^\s*[-·•]\s+/, '') + '</div>' : l).join('<br>').replace(/<\/div><br>/g, '</div>');
}
function _aiToast(msg) {
    const t = document.getElementById('sync-toast-el');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(_aiToast._t); _aiToast._t = setTimeout(() => t.classList.remove('show'), 3500);
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
        const err = new Error('顾问暂时连不上（后端没开或网络断了）。今晚照离线规则来，不影响打卡。'); err.code = 0; throw err;
    }
    _aiDown = false;
    if (opt.stream && r.ok) return r;
    let j = null;
    try { j = await r.json(); } catch (e) { }
    if (!r.ok) {
        const e = new Error((j && j.error) || ('顾问出错了（' + r.status + '）'));
        e.status = j && j.status; e.info = j || {}; e.code = r.status;
        if (AI_LOCKED.indexOf(e.status) >= 0) _aiRememberAccess(e.status);
        throw e;
    }
    return j;
}
// 后端每人同时只跑 1 个请求(第二个回 429):本机排成一队
let _aiChain = Promise.resolve();
function _aiSerial(fn) { const p = _aiChain.then(fn, fn); _aiChain = p.then(() => { }, () => { }); return p; }
function aiPoint(path, body) {
    return _aiSerial(async () => {
        for (let i = 0; ; i++) {
            try { return await aiFetch(path, body); }
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
    aiRenderTonight();
    if (typeof renderTnSay === 'function') renderTnSay();
    if (typeof oobeRefresh === 'function') oobeRefresh();
    const p = document.getElementById('coach');
    if (p && p.classList.contains('active')) renderCoach();
}
function _aiOpts() { const o = _aiGet(AIK.opts) || {}; return o.model ? { model: o.model, effort: o.effort || 'medium' } : {}; }

// ══ 上下文拼装(BRIEF 契约)═══════════════════════════════════════════════════
// {user, skinType, concerns[], phase, products[], regimen{}, tonight{}, recentLogs[], assess{}, zones[], hrt?}
// 🔴 hrt 只在**当前用户本人**开了 HRT 时才带(数据本来就按 uid 隔离,Cici 的快照里永远没有 Cait 的东西);
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
            shower: !!TN.shower, shave: !!(TN.shave && PROFILE.shaving), done: !!(te && te.done), ticked: [...loadDoneSteps('tn')] };
    } catch (e) { }
    const tags = getAcidTags();
    const recentLogs = jrnlLastNDays(14).map(e => {
        const o = { date: e.date, status: e.status || [], note: e.note || '' };
        if ((e.products || []).length) o.used = e.products;
        if ((e.products || []).some(x => tags.indexOf(x) >= 0)) o.acid = true;
        if (e.auto) o.auto = true;   // 极简模式按计划推定的,不是她记的
        if (e.done) o.done = true;
        if (PROFILE.hrt && e.phase) o.hrtPhase = e.phase;
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
                  gate: { irritated: g.irritated, tags: g.tags, worsening: g.worsening, acidReaction: g.react, hrtFlare: g.hrtFlare, notes: g.notes } },
        zones: userZones().map(z => ({ name: z.name, avoid: z.avoid || [], care: z.care || '' }))
    };
    if (rr.source !== 'ai') ctx.regimen.ladder = { level: rr.ladder.level, why: rr.ladder.why, uses: rr.ladder.uses };
    if (PROFILE.hrt) ctx.hrt = { on: true, flare: g.hrtFlare, recent: jrnlLastNDays(14).filter(e => e.phase).map(e => ({ date: e.date, phase: e.phase })) };
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
        if (exfoliantCountInLastNDays(7) >= Math.min(g.acidCapMax, 7)) return '这周的去角质已经到安全闸的上限了';
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
    phase: c => '阶段：' + ((PHASES[c.value] || {}).name || c.value), zone: c => c.product + '避开' + ({ acid: '酸', retinol: '视黄醇', mask: '面膜', scrub: '磨砂' }[c.value] || c.value),
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
        return `<li class="${bad ? 'bad' : ''}">${bad ? `<s>${_aiEsc(txt)}</s> <small class="co-err">没生效：${_aiEsc(bad)}</small>` : `<span>${_aiEsc(txt)}</span>${part ? ` <small class="co-warn">${_aiEsc(part.why)}</small>` : (c.why ? ` <small>${_aiEsc(c.why)}</small>` : '')}`}</li>`;
    }).join('');
    const okN = rec.result.filter(x => !x).length;
    const head = rec.state === 'applied' ? (rec.kind === 'tonight' ? `已改 · 今晚 · ${okN} 处` : `已改 · 方案 v${rec.v} · ${okN} 处`)
        : rec.state === 'undone' ? '已撤销' : '没改成';
    const canUndo = rec.state === 'applied' && (rec.kind === 'tonight' ? !!rec.snap : !!rec.versionId);
    return `<div class="co-act" data-mi="${mi}" data-ri="${ri}"><div class="co-act-h">${_aiEsc(head)}</div><ul class="co-act-list">${rows}</ul>`
        + ((rec.dropped || []).length ? `<div class="co-meta">还提到 ${rec.dropped.length} 个不在你产品库里的：${_aiEsc(rec.dropped.join('、'))}</div>` : '')
        + (rec.undoErr ? `<div class="co-meta co-err">${_aiEsc(rec.undoErr)}</div>` : '')
        + (canUndo ? `<button type="button" class="rg-more co-undo" onclick="aiUndoRec(${mi},${ri})">撤销</button>` : '')
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
// (功能骨架;整体视觉等统一设计规范 —— 2026-10-29 协调要求)
function _aiStyle() {
    if (document.getElementById('ai-style')) return;
    const st = document.createElement('style');
    st.id = 'ai-style';
    st.textContent = `
      .co-card{background:var(--sur);border:1px solid var(--bd);border-radius:var(--r);padding:14px 16px;margin-bottom:1rem}
      .co-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
      .co-t{font-size:15px;font-weight:600;color:var(--tx)}
      .co-meta{font-size:11px;color:var(--tx3);font-family:var(--mono);margin-top:4px}
      .co-err{color:var(--rd)!important}
      .co-warn{color:var(--am)!important}
      .co-row{display:flex;flex-wrap:wrap;gap:8px}
      .co-btn{padding:9px 12px;border:1px solid var(--bd2);border-radius:var(--rs);background:var(--sur2);color:var(--tx);font-family:inherit;font-size:13px;cursor:pointer;position:relative;overflow:hidden}
      .co-btn input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}
      .co-btn:disabled{opacity:.5}
      .co-log{display:flex;flex-direction:column;gap:10px;max-height:none}
      .co-msg{font-size:14px;line-height:1.6}
      .co-msg .who{display:block;font-size:11px;font-family:var(--mono);color:var(--tx3);margin-bottom:2px}
      .co-msg.user{align-self:flex-end;background:var(--bl-bg);border-radius:12px;padding:8px 12px;max-width:88%}
      .co-msg.assistant{background:var(--sur2);border-radius:12px;padding:8px 12px}
      .co-li{padding-left:2px}
      .co-act{margin-top:8px;border-left:3px solid var(--gr);background:var(--sur);border-radius:8px;padding:8px 10px;font-size:13px}
      .co-act-h{font-weight:600;font-size:12px;margin-bottom:4px}
      .co-act-list{list-style:none;padding:0;margin:0}
      .co-act-list li{margin:2px 0}
      .co-act-list li.bad{color:var(--tx3)}
      .co-act-list small{color:var(--tx3);font-size:11px}
      .co-composer{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
      .co-composer textarea{flex:1;min-height:44px;max-height:140px;border:1px solid var(--bd2);border-radius:var(--rs);padding:10px;font-family:inherit;font-size:16px;background:var(--sur);color:var(--tx);resize:vertical}
      .co-pending img{width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--bd)}
      .co-mem-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:6px 0;border-bottom:1px solid var(--bd)}
      .co-input{width:100%;border:1px solid var(--bd2);border-radius:var(--rs);padding:10px;font-family:var(--mono);font-size:16px;background:var(--sur);color:var(--tx);text-transform:uppercase;margin:8px 0}
      .co-note{background:var(--sur2);border-radius:var(--rs);padding:10px 12px;font-size:13px;line-height:1.6;margin-bottom:1rem}
      .co-note b{font-weight:600}
      .co-sel{border:1px solid var(--bd2);border-radius:var(--rs);padding:6px 8px;background:var(--sur);color:var(--tx);font-family:inherit;font-size:13px}`;
    document.head.appendChild(st);
}
function renderCoach() {
    _aiStyle();
    const el = document.getElementById('coach-content');
    if (!el) return;
    const a = aiAccess();
    const privacy = `<div class="co-meta" style="margin:6px 0 12px">对话、你的产品和皮肤记录会发给 AI（Anthropic）帮你判断；服务端只存你让顾问「记住」的那几句，可以随时删。</div>`;
    if (a === 'out') {
        el.innerHTML = `<div class="co-card"><div class="co-t">顾问</div><p style="font-size:14px;margin-top:6px">登录后能用：问护肤问题、拍成分标自动认产品、让顾问出方案和每周复盘。</p><p class="co-meta">没登录也没关系，今晚的步骤照离线规则排。</p></div>${privacy}`;
        return;
    }
    if (a === 'none' || a === 'mismatch') {
        el.innerHTML = `<div class="co-card" id="co-access"><div class="co-t">顾问 · ${a === 'mismatch' ? '用不了' : '邀请制'}</div>`
            + (a === 'mismatch' ? `<p style="font-size:14px;margin-top:6px">这个邮箱已经绑定了另一个账号，换回第一次用的登录方式试试。</p>`
                : `<p style="font-size:14px;margin-top:6px">顾问每次调用都要花钱，现在只对受邀的人开放。有邀请码填在下面。</p>`
                + `<input id="co-code" class="co-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="邀请码 · ABCDE-FGHJK" aria-label="邀请码" onkeydown="if(event.key==='Enter')aiRedeem()">`
                + `<button class="bsv" id="co-code-go" onclick="aiRedeem()">开通</button><div class="co-meta">邀请码用一次就作废，两周内有效。没有也不影响打卡和离线规则。</div>`)
            + `</div>${privacy}`;
        if (a === 'mismatch') return;
        aiProbe(true);   // 后台再核一次:可能已经被加进白名单了
        return;
    }
    const me = AI_ME && _aiMeUid === _aiUid() ? AI_ME : null;
    const status = _aiDown ? `<span class="co-err">连不上顾问 · 今晚照离线规则来</span> <button class="rg-more" style="margin:0" onclick="aiProbe(true)">重试</button>`
        : me ? `今天 $${Number(me.today || 0).toFixed(2)}${me.daily_cap ? ' / 上限 $' + Number(me.daily_cap).toFixed(0) : ''} · 本期 $${Number(me.cycle || 0).toFixed(2)}` : '连接中…';
    const busy = _aiBusy;
    el.innerHTML = `
      <div class="co-card">
        <div class="co-h"><span class="co-t">顾问</span><span class="co-meta" id="co-status">${status}</span></div>
        <div class="co-row">
          <button class="co-btn" id="co-plan-go" onclick="aiPlan()" ${busy ? 'disabled' : ''}>出方案</button>
          <button class="co-btn" id="co-review-go" onclick="aiReview()" ${busy ? 'disabled' : ''}>方案复盘</button>
          <label class="co-btn">拍成分标<input type="file" accept="image/*" capture="environment" onchange="aiVision(this,'read_label')" aria-label="拍成分标"></label>
          <label class="co-btn">看皮肤<input type="file" accept="image/*" capture="user" onchange="aiVision(this,'assess_skin')" aria-label="拍皮肤照片"></label>
        </div>
        <div id="co-result"></div>
      </div>
      <div id="co-review"></div>
      <div class="co-card">
        <div class="co-h"><span class="co-t">对话</span><button class="rg-more" style="margin:0" onclick="aiNewChat()">新对话</button></div>
        <div id="co-chat-log" class="co-log" aria-live="polite"></div>
        <div id="co-chat-img"></div>
        <div class="co-composer">
          <label class="co-btn" aria-label="发图片">图<input type="file" accept="image/*" onchange="aiAttach(this)"></label>
          <textarea id="co-chat-text" rows="1" placeholder="问点什么，比如「今晚有点刺痛还要刷酸吗」" aria-label="问顾问" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();aiSend()}"></textarea>
          <button class="bsv" id="co-chat-go" onclick="aiSend()" ${busy ? 'disabled' : ''}>发送</button>
        </div>
        <div class="co-meta">对话只存在这台设备上</div>
      </div>
      <details class="co-card" id="co-settings"><summary class="co-t" style="cursor:pointer">顾问设置 · 记住的事</summary>
        <div id="co-opts" style="margin-top:10px"></div>
        <div id="co-mem" style="margin-top:12px"></div>
      </details>
      ${privacy}`;
    _aiShowChat();
    _aiShowReview();
    _aiShowResult();
    _aiRenderOpts();
    if (!me && !_aiDown) aiProbe(true).then(() => { const s = document.getElementById('co-status'); if (s && AI_ME) renderCoach(); });
}
function _aiRenderOpts() {
    const box = document.getElementById('co-opts'); if (!box) return;
    const me = AI_ME;
    if (!me) { box.innerHTML = '<div class="co-meta">连上之后能选模型和思考深度。</div>'; return; }
    const o = _aiGet(AIK.opts) || {};
    const models = [['', '自动（按任务挑）']].concat((me.models || []).map(m => [m[0], m[1] + (m[2] ? ' · ' + m[2] : '')]));
    box.innerHTML = `<label class="set-row"><span>模型</span><select class="co-sel" id="co-model" onchange="aiSetOpts()">${models.map(([k, n]) => `<option value="${_aiEsc(k)}" ${(o.model || '') === k ? 'selected' : ''}>${_aiEsc(n)}</option>`).join('')}</select></label>`
        + `<label class="set-row" style="margin-top:8px"><span>思考深度${o.model ? '' : '（选了模型才生效）'}</span><select class="co-sel" id="co-effort" onchange="aiSetOpts()" ${o.model ? '' : 'disabled'}>${(me.efforts || []).map(([k, n]) => `<option value="${_aiEsc(k)}" ${(o.effort || 'medium') === k ? 'selected' : ''}>${_aiEsc(n)}</option>`).join('')}</select></label>`
        + `<div class="co-meta">每天有上限；每月 17 号重置。</div>`;
    aiMemLoad();
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
    box.innerHTML = '<div class="co-meta">读取记住的事…</div>';
    try { const r = await aiFetch('/api/memory'); _aiMem = { uid: _aiUid(), items: r.items || [] }; }
    catch (e) { _aiMem = { uid: _aiUid(), items: [], err: e.message }; }
    _aiMemPaint();
}
function _aiMemPaint() {
    const box = document.getElementById('co-mem'); if (!box || !_aiMem) return;
    const m = _aiMem;
    box.innerHTML = `<div class="sec-title" style="margin-bottom:4px">顾问记住的事</div>`
        + (m.err ? `<div class="co-meta co-err">${_aiEsc(m.err)}</div><button class="rg-more" onclick="aiMemLoad(true)">再试一次</button>`
            : !m.items.length ? `<div class="co-meta">还没有。对话里说「记住……」，比如对某个成分过敏、哪支用了会刺痛，开新对话也不会忘。</div>`
                : m.items.map(x => `<div class="co-mem-row"><span>${_aiEsc(x.text)} <small class="co-meta">${_aiEsc(String(x.at || '').slice(5, 10))}</small></span><button class="rg-more" style="margin:0" data-id="${_aiEsc(x.id)}" onclick="aiMemDelete(this.dataset.id)">删掉</button></div>`).join('')
                + `<button class="rg-more" onclick="aiMemClear()">全部清空</button>`)
        + `<div class="co-meta">记在 Cait 家里的服务器上，只给你自己的顾问看。</div>`;
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
    el.innerHTML = chat.length ? chat.map((m, mi) => m.role === 'assistant'
        ? `<div class="co-msg assistant"><span class="who">顾问 ${_aiHM(m.at)}</span><div>${_aiMd(m.text)}</div>${(m.recs || []).map((r, ri) => _aiRecHtml(r, mi, ri)).join('')}${m.mem ? `<div class="co-meta">${_aiEsc(m.mem)}</div>` : ''}${m.meta && m.meta.cost != null ? `<div class="co-meta">${_aiEsc(m.meta.model || '')} · $${Number(m.meta.cost).toFixed(3)}</div>` : ''}</div>`
        : `<div class="co-msg user"><span class="who">你 ${_aiHM(m.at)}</span>${m.img ? '<span class="co-meta">[图片] </span>' : ''}${_aiEsc(m.text).replace(/\n/g, '<br>')}</div>`).join('')
        + (streaming ? `<div class="co-msg assistant"><span class="who">顾问</span><div id="co-stream"><span class="co-meta">在想…</span></div></div>` : '')
        : '<div class="co-meta" style="padding:6px 0">比如：「我基本没刷过酸，闭口怎么开始」「今晚下巴有点刺痛还要刷吗」「这支 B5 能全脸涂吗」</div>';
}
async function aiAttach(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    try { _aiPendingImg = await aiImage(f, 1024); } catch (e) { return _aiToast(e.message); }
    const b = document.getElementById('co-chat-img');
    if (b) b.innerHTML = `<div class="co-pending"><img src="${_aiPendingImg}" alt="待发送的图片"> <button class="rg-more" onclick="_aiPendingImg=null;this.parentNode.remove()">移除</button></div>`;
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
    if (r.busy) { box.innerHTML = `<div class="co-meta" style="margin-top:10px">${_aiEsc(r.busy)}</div>`; return; }
    if (r.err) { box.innerHTML = `<div class="co-meta co-err" style="margin-top:10px">${_aiEsc(r.err)}</div>`; return; }
    if (r.kind === 'plan') {
        const reg = regimenHistory().find(x => x.id === r.versionId);
        box.innerHTML = `<div class="co-act"><div class="co-act-h">${r.state === 'undone' ? '已撤销 · 方案回到上一版' : '已换成新方案 v' + (reg ? reg.v : '?')}</div>`
            + `<div style="font-size:13px;line-height:1.6">${_aiEsc(r.rationale || '')}</div>`
            + (r.blocked.length ? `<div class="co-meta">${r.blocked.map(b => (b.partial ? '暂缓：' : '没生效：') + _aiEsc(b.text + ' —— ' + b.why)).join('<br>')}</div>` : '')
            + (r.gaps && r.gaps.length ? `<div class="co-meta">缺一环：${r.gaps.map(g => _aiEsc(g.label)).join('、')}</div>` : '')
            + (r.meta ? `<div class="co-meta">${_aiEsc(r.meta.model || '')} · $${Number(r.meta.cost || 0).toFixed(3)}</div>` : '')
            + (r.state === 'applied' ? `<button class="rg-more co-undo" onclick="aiUndoPlan()">撤销</button>` : '') + `</div>`;
        return;
    }
    if (r.kind === 'read_label') {
        const d = r.data || {};
        box.innerHTML = `<div class="co-act"><div class="co-act-h">读成分标 · ${_aiEsc(d.name || '没认出名字')}</div>`
            + `<div style="font-size:13px">${_aiEsc(ROLE_LABEL[r.role] || d.role || '')}${r.traits.length ? ' · ' + r.traits.map(t => (TRAIT_DEFS.find(x => x.k === t) || {}).l || t).join('、') : ''}</div>`
            + (d.note ? `<div class="co-meta">${_aiEsc(d.note)}</div>` : '')
            + (r.matched ? `<div class="co-meta">${r.state === 'undone' ? '已撤销' : '已把成分特性写进「' + _aiEsc(r.matched) + '」'}</div>${r.state === 'applied' ? '<button class="rg-more co-undo" onclick="aiUndoLabel()">撤销</button>' : ''}`
                : `<button class="bsv" style="margin-top:8px" onclick="aiLabelToProduct()">加进产品库</button>`)
            + `</div>`;
        return;
    }
    if (r.kind === 'assess_skin') {
        const d = r.data || {}, ax = d.axes || {};
        const L = { good: '好', ok: '一般', bad: '差' };
        box.innerHTML = `<div class="co-act"><div class="co-act-h">看皮肤</div>`
            + `<div style="font-size:13px">屏障 ${L[ax.barrier] || '—'} · 控油 ${L[ax.oil] || '—'} · 清透 ${L[ax.congestion] || '—'} · 无炎 ${L[ax.calm] || '—'}</div>`
            + `<div style="font-size:13px;margin-top:4px">${_aiEsc(d.note || '')}</div>`
            + (r.saved ? '<div class="co-meta">已记进今天的备注</div>' : `<button class="rg-more" onclick="aiSkinToNote()">记进今天的备注</button>`) + `</div>`;
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
function aiRegimenActionsHtml(reg) {
    const a = aiAccess(), btn = [];
    const last = currentRegimen();
    if (reg && reg.source === 'ai' && last && last.id === reg.id) btn.push(`<button class="rg-more" onclick="aiUndoCurrent()">撤销这一版</button>`);
    if (a === 'on') {
        btn.push(`<button class="rg-more" onclick="aiAsk('关于现在这版方案：')">问顾问</button>`);
        if (!reg || reg.source !== 'ai' || reg.stale) btn.push(`<button class="rg-more" onclick="aiPlan()">${reg && reg.stale ? '让顾问按新货架重排' : '让顾问出方案'}</button>`);
    } else if (a === 'none') btn.push(`<span class="co-meta">顾问是邀请制 · 在「顾问」页填邀请码</span>`);
    return btn.length ? `<div class="co-row" style="margin-top:10px">${btn.join('')}</div>` : '';
}
function aiUndoCurrent() {
    const last = currentRegimen(); if (!last || last.source !== 'ai') return;
    sysConfirm('撤销这一版顾问方案，回到上一版？', () => {
        const why = undoRegimen(last.id);
        if (why) { _aiToast(why); return; }
        _aiAfterRegimenChange();
        _aiToast('已撤销 · 方案回到上一版');
    }, { ok: '撤销' });
}

// 每周复盘:每周一之后第一次打开自动跑一次(sk_ai1.reviewWeek 跟云走,两台设备不会各跑一遍);也能手动点
function _aiState() { return lg(K.ai) || {}; }
function _aiSaveState(st) { ls(K.ai, st); }
function _aiShowReview() {
    const box = document.getElementById('co-review'); if (!box) return;
    const rv = _aiState().review;
    if (!rv || !rv.data) { box.innerHTML = ''; return; }
    const d = rv.data;
    const rows = (rv.rec && rv.rec.changes || []).map((c, k) => {
        const bad = rv.rec.result[k], txt = (_AI_REG_TXT[c.op] || (() => c.op))(c);
        return `<li class="${bad ? 'bad' : ''}">${bad ? `<s>${_aiEsc(txt)}</s> <small class="co-err">没生效：${_aiEsc(bad)}</small>` : _aiEsc(txt)}${c.why ? ` <small>${_aiEsc(c.why)}</small>` : ''}</li>`;
    }).join('');
    box.innerHTML = `<div class="co-card"><div class="co-h"><span class="co-t">本周复盘 · ${_aiEsc(rv.week || '')}</span><span class="co-meta">${_aiEsc(String(rv.at || '').slice(5, 10))}${rv.auto ? ' · 自动' : ''}</span></div>`
        + `<div style="font-weight:600;font-size:14px">${_aiEsc(d.headline || '')}</div>`
        + `<div style="font-size:13px;line-height:1.6;margin-top:4px">${_aiMd(d.summary || '')}</div>`
        + ((d.wins || []).length ? `<div class="co-meta" style="color:var(--gr)">做得好：${d.wins.map(_aiEsc).join('；')}</div>` : '')
        + ((d.issues || []).length ? `<div class="co-meta" style="color:var(--am)">要注意：${d.issues.map(_aiEsc).join('；')}</div>` : '')
        + (rows ? `<div class="co-act"><div class="co-act-h">${rv.rec.state === 'applied' ? '已按复盘改成方案 v' + rv.rec.v : rv.rec.state === 'undone' ? '复盘的调整已撤销' : '复盘的调整都没生效'}</div><ul class="co-act-list">${rows}</ul>`
            + (rv.rec.state === 'applied' && rv.rec.versionId ? `<button class="rg-more co-undo" onclick="aiUndoReview()">撤销</button>` : '') + `</div>` : '')
        + (rv.replan ? `<button class="rg-more" onclick="aiPlan('复盘建议整套重排')">复盘建议整套重排 · 让顾问出方案</button>` : '')
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
function aiRenderProdEntry() {
    const box = document.getElementById('ai-prod-entry'); if (!box) return;   // 新版产品页把「拍成分表」并进了「添加产品」,这个挂点已经没了
    const a = aiAccess();
    box.innerHTML = a === 'on'
        ? `<label class="co-btn" style="display:block;text-align:center;margin-bottom:1rem">拍成分标 · 自动认产品和成分特性<input type="file" accept="image/*" capture="environment" onchange="aiVision(this,'read_label')" aria-label="拍成分标"></label>`
        : '';
}

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
    if (f.busy) return `<div class="co-note co-meta">顾问在看你今晚的记录…</div>`;
    if (f.err) return `<div class="co-note"><span class="co-meta co-err">${_aiEsc(f.err)}</span> <button class="rg-more" style="margin:0" onclick="aiAfterCheckin(today(), true)">再试一次</button></div>`;
    const adj = (f.next_adjust || []);
    return `<div class="co-card" id="ai-fb-card"><div class="co-h"><span class="co-t">打卡反馈</span><span class="co-meta">${f.meta ? '$' + Number(f.meta.cost || 0).toFixed(3) : ''}</span></div>`
        + `<div style="font-size:13px;line-height:1.6">${_aiMd(f.text || '')}</div>`
        + (adj.length ? `<ul class="co-act-list" style="margin-top:6px;font-size:13px">${adj.map(x => `<li>· ${_aiEsc(x.item)}：${_aiEsc(x.change)} <small class="co-meta">${_aiEsc(x.why || '')}</small></li>`).join('')}</ul>`
            + `<button class="rg-more" onclick="aiAsk(${_aiEsc(JSON.stringify('按打卡反馈调一下：' + adj.map(x => x.item + x.change).join('；')))})">让顾问照这个调</button>` : '')
        + (f.note_add && !f.noteSaved ? `<button class="rg-more" onclick="aiFeedbackNote()">把「${_aiEsc(f.note_add)}」加进今天的记录</button>` : '')
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

// ── 钩子:登录 / 换账号 / 清本机 ──
function aiClearLocal() { Object.values(AIK).forEach(k => localStorage.removeItem(k)); AI_ME = null; _aiMeUid = null; _aiProbeUid = null; _aiMem = null; _aiResult = null; }
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
