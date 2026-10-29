// ══ 顾问后端客户端:鉴权 + 网络 + SSE + 错误 / 额度 + 开通状态 ═════════════════════════════════════
// 契约见 ~/skincare-coach/BRIEF.md「前后端契约」(私密目录,不在仓库里)与 ARCHITECTURE.md §6 的摘要。
//   鉴权:Authorization: Bearer <firebase ID token>;401 signed_out、403 not_allowed / mismatch(白名单外 → 邀请码 POST /api/redeem {code})
//   非对话接口回 {data, model, effort, cost};/api/chat、/api/quick 是 SSE(delta / action / proposal / memory / done / error)
//   后端每人同时只跑 1 个请求(第二个回 429「还没跑完」):本机排成一队;/api/shop 单独占忙碌位,不进这条队
// 【要紧】这里挂了 / 连不上:今晚照离线规则(engine/schedule.js)+ 安全闸排,不白屏。
// 这个模块 import 时不碰任何全局;createAiClient(env) 才开始用 env 里给的东西。
import { LOCAL_KEYS } from '../store.js';

export const AI_LOCKED = ['not_allowed', 'mismatch'];
export function aiBase(hostname) { return (['127.0.0.1', 'localhost'].indexOf(hostname) >= 0) ? 'http://127.0.0.1:8808' : 'https://node.tail95239f.ts.net/skin'; }
// 顾问回来的字一律先去 emoji(界面全程不用 emoji;提示词里也要求了,这里兜底)
export const EMOJI_RE = /[\p{Extended_Pictographic}️‍⃣]/gu;
export function stripEmoji(s) { return String(s == null ? '' : s).replace(EMOJI_RE, '').replace(/^\s+/, ''); }
export function aiClean(x) {
    if (typeof x === 'string') return stripEmoji(x);
    if (Array.isArray(x)) return x.map(aiClean);
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { o[k] = aiClean(x[k]); }); return o; }
    return x;
}
// 解析一段 SSE 文本块:{event, data}(data 解析失败返回 null)
export function parseSseBlock(block) {
    const ev = (block.match(/^event: (.*)$/m) || [])[1], data = (block.match(/^data: (.*)$/m) || [])[1];
    if (!data) return null;
    try { return { event: ev, data: JSON.parse(data) }; } catch (e) { return null; }
}

// env = { base, getUser() → {uid, getIdToken()} | null, fetch, localStorage, today(), wait(ms)? }
export function createAiClient(env) {
    const LS = env.localStorage;
    const wait = env.wait || (ms => new Promise(r => setTimeout(r, ms)));
    const st = { me: null, meUid: null, down: false, quota: null, chain: Promise.resolve() };
    const uid = () => { const u = env.getUser(); return u ? u.uid : null; };
    const get = k => { try { return JSON.parse(LS.getItem(k)); } catch (e) { return null; } };
    const set = (k, v) => { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    function rememberAccess(status) { const u = uid(); if (u) set(LOCAL_KEYS.aiAcc, { uid: u, status }); }

    async function aiFetch(path, body, opt) {
        opt = opt || {};
        const u = env.getUser();
        if (!u) { const e = new Error('请先登录'); e.status = 'signed_out'; e.code = 401; throw e; }
        const tok = await u.getIdToken();
        let r;
        try {
            r = await env.fetch(env.base + path, { method: body ? 'POST' : 'GET',
                headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
                body: body ? JSON.stringify(body) : undefined });
        } catch (e) {
            st.down = true;
            const err = new Error('顾问暂时连不上，今晚照离线规则做，不影响记录。'); err.code = 0; throw err;
        }
        st.down = false;
        if (opt.stream && r.ok) return r;
        let j = null;
        try { j = await r.json(); } catch (e) { }
        if (!r.ok) {
            const msg = (j && j.error) || ('顾问出错了（' + r.status + '）');
            const e = new Error(msg);
            e.status = j && j.status; e.info = j || {}; e.code = r.status;
            if (r.status === 401) e.status = e.status || 'signed_out';
            if (AI_LOCKED.indexOf(e.status) >= 0) rememberAccess(e.status);
            // 额度用完:界面换成「今天的顾问次数用完了」,别让她一遍遍点发送
            if (r.status === 429 && /今天的 AI 用量/.test(msg)) { st.quota = { kind: 'daily', date: env.today() }; e.message = '今天的顾问次数用完了，明天再来。'; e.quota = 'daily'; }
            else if (r.status === 429 && /这个月的 AI 额度/.test(msg)) { st.quota = { kind: 'cycle', date: env.today() }; e.message = '这个月的顾问额度用完了，17 号恢复。'; e.quota = 'cycle'; }
            throw e;
        }
        if (st.quota && st.quota.kind === 'daily') st.quota = null;
        return j;
    }
    function quotaText() {
        if (!st.quota) return '';
        if (st.quota.kind === 'daily' && st.quota.date !== env.today()) { st.quota = null; return ''; }
        return st.quota.kind === 'daily' ? '今天的顾问次数用完了，明天再来。' : '这个月的顾问额度用完了，17 号恢复。';
    }
    function serial(fn) { const p = st.chain.then(fn, fn); st.chain = p.then(() => { }, () => { }); return p; }
    // 非对话接口:排队;429「还没跑完」等 3 秒重试两次
    function point(path, body) {
        return serial(async () => {
            for (let i = 0; ; i++) {
                try { return aiClean(await aiFetch(path, body)); }
                catch (e) { if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await wait(3000); continue; } throw e; }
            }
        });
    }
    // SSE:delta 边到边回调;action / proposal / memory / done / error 收起来交给调用方
    async function stream(path, body, onDelta) {
        const out = { text: '', meta: null, err: null, prop: null, act: null, mem: null };
        try {
            await serial(async () => {
                const r = await aiFetch(path, body, { stream: true });
                const rd = r.body.getReader(), dec = new TextDecoder();
                let buf = '';
                const eat = block => {
                    const b = parseSseBlock(block); if (!b) return;
                    const j = aiClean(b.data);
                    if (b.event === 'delta') { out.text += j.t || ''; if (onDelta) onDelta(out.text); }
                    else if (b.event === 'proposal') out.prop = j;
                    else if (b.event === 'action') out.act = j;
                    else if (b.event === 'memory') out.mem = j;
                    else if (b.event === 'done') { out.text = j.text || out.text; out.meta = { model: j.model, effort: j.effort, cost: j.cost }; }
                    else if (b.event === 'error') out.err = j.error || '顾问出错了';
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
        } catch (e) { out.err = e.message; out.code = e.code; }
        return out;
    }
    // 开通状态:'out' 没登录 · 'none' 邀请制、没开通 · 'mismatch' 邮箱绑了别的账号 · 'on' 可以用(连没连上另看 down)
    function access() {
        const u = uid(); if (!u) return 'out';
        const a = get(LOCAL_KEYS.aiAcc);
        if (a && a.uid === u && a.status === 'not_allowed') return 'none';
        if (a && a.uid === u && a.status === 'mismatch') return 'mismatch';
        return 'on';
    }
    // 自动发的请求(今晚 / 复盘 / 打卡反馈)只在后端确认这个账号开通了之后才发
    function ready() { return access() === 'on' && !!st.me && st.meUid === uid(); }
    async function probe(force) {
        const u = uid();
        if (!u) { st.me = null; st.meUid = null; return null; }
        if (!force && st.meUid === u && st.me) return st.me;
        try { st.me = await aiFetch('/api/me'); st.meUid = u; rememberAccess('allowed'); }
        catch (e) { st.me = null; }
        return st.me;
    }
    async function redeem(code) {
        const j = await aiFetch('/api/redeem', { code: String(code || '').trim() });
        rememberAccess('allowed'); await probe(true);
        return j;
    }
    // 换账号:本机缓存属于别的账号的清掉(按 uid 存;sync 换账号时也会调 clearLocal)
    function clearLocal() { [LOCAL_KEYS.aiChat, LOCAL_KEYS.aiNote, LOCAL_KEYS.aiAcc, LOCAL_KEYS.aiOpts, LOCAL_KEYS.aiPrivacy, LOCAL_KEYS.aiShop, LOCAL_KEYS.aiTonight].forEach(k => { try { LS.removeItem(k); } catch (e) { } }); st.me = null; st.meUid = null; st.quota = null; }
    function opts() { const o = get(LOCAL_KEYS.aiOpts) || {}; return o.model ? { model: o.model, effort: o.effort || 'medium' } : {}; }

    // ── 接口 ──
    const api = {
        chat: (body, onDelta) => stream('/api/chat', Object.assign({}, opts(), body), onDelta),
        quick: (body, onDelta) => stream('/api/quick', Object.assign({}, opts(), body), onDelta),
        plan: (context, request) => point('/api/plan', Object.assign({ context }, request ? { request } : {}, opts())),
        review: context => point('/api/review', Object.assign({ context }, opts())),
        note: context => point('/api/note', Object.assign({ context }, opts())),
        feedback: (context, session) => point('/api/feedback', Object.assign({ context, session }, opts())),
        swap: (context, product, reason, note) => point('/api/swap', Object.assign({ context, product, reason }, note ? { note } : {}, opts())),
        vision: (context, image, mode, note) => point('/api/vision', Object.assign({ context, image, mode }, note ? { note } : {}, opts())),
        // v2 新:顾问写今晚 → {title, why, steps[{product('' = 纯动作), how, why}], skips[{product, why}], dropped[]};前端再过闸(ai/apply.js gateTonightPlan)
        tonight: context => point('/api/tonight', Object.assign({ context }, opts())),
        // v2 新:定期拍照全套分析(P2 才用)→ {usable, retake, overall, zones[{zone, findings[]}], vs_last, suggest_tags[], suggest_spots[], note}
        assess: (context, images, prev) => point('/api/assess', Object.assign({ context, images }, prev || {}, opts())),
        // 要不要买:单独占忙碌位(不进排队),约 70 秒;429「还没跑完」等 8 秒重试两次
        shop: async (context, trigger) => {
            for (let i = 0; ; i++) {
                try { return aiClean(await aiFetch('/api/shop', Object.assign({ context, trigger }, opts()))); }
                catch (e) { if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await wait(8000); continue; } throw e; }
            }
        },
        memory: body => point('/api/memory', body || null)
    };
    return { state: st, aiFetch, point, stream, access, ready, probe, redeem, quotaText, clearLocal, opts, api };
}
