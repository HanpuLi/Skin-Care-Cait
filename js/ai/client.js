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
//   除了 Extended_Pictographic,还要去:肤色修饰符(流式推送时它可能和前面的手势分在两段,单独来也要删)、国旗的区域指示符、
//   tag 字符、AUDIT-aesthetic §3.12 的符号区段(U+2600–27BF、U+2B00–2BFF,含 ✓ ★)、变体选择符 / 零宽连接 / 键帽
export const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0020}-\u{E007F}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;
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
    const st = { me: null, meUid: null, down: false, quota: null, chain: Promise.resolve(), cur: null };
    // 每个请求的总时限(毫秒):卡住的请求会把串行队列整条堵死(今晚 / 出方案 / 复盘 / 反馈全等着),到点就放弃,按连不上处理
    const LIMIT = Object.assign({ point: 90000, assess: 120000, shop: 150000, streamHead: 90000, streamIdle: 45000 }, env.limits || {});
    const TIMEOUT_MSG = '顾问这次太久没回应，先按离线规则来。';
    const DOWN_MSG = '顾问暂时连不上，今晚照离线规则做，不影响记录。';
    const err0 = (msg, extra) => { const e = new Error(msg); e.code = 0; return Object.assign(e, extra || {}); };
    const uid = () => { const u = env.getUser(); return u ? u.uid : null; };
    const get = k => { try { return JSON.parse(LS.getItem(k)); } catch (e) { return null; } };
    const set = (k, v) => { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    function rememberAccess(status) { const u = uid(); if (u) set(LOCAL_KEYS.aiAcc, { uid: u, status }); }

    // opt: {stream?, timeout?(毫秒), ctl?(外面给的 AbortController,流式用来接着管读的那段)}
    // 抛出的错误一律带数字 code:0 = 连不上 / 超时(界面按离线处理),其余是 HTTP 状态
    async function aiFetch(path, body, opt) {
        opt = opt || {};
        const u = env.getUser();
        if (!u) { const e = new Error('请先登录'); e.status = 'signed_out'; e.code = 401; throw e; }
        // 后台放久了、回来时离线:取 token 要刷新,Firebase 会抛 auth/network-request-failed —— 这也是「连不上」,别把英文原文透出去
        const token = async force => { try { return await u.getIdToken(force); } catch (e) { st.down = true; throw err0(DOWN_MSG); } };
        const once = async tok => {
            const ac = opt.ctl || (typeof AbortController !== 'undefined' ? new AbortController() : null);
            let timedOut = false;
            const tm = ac ? setTimeout(() => { timedOut = true; try { ac.abort(); } catch (e) { } }, opt.timeout || LIMIT.point) : null;
            try {
                let r;
                try {
                    r = await env.fetch(env.base + path, { method: body ? 'POST' : 'GET',
                        headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
                        body: body ? JSON.stringify(body) : undefined, signal: ac ? ac.signal : undefined });
                } catch (e) {
                    if (ac && ac.signal.aborted && !timedOut) throw err0('停下了。', { aborted: true });
                    if (timedOut) throw err0(TIMEOUT_MSG, { timeout: true });
                    st.down = true;
                    throw err0(DOWN_MSG);
                }
                if (opt.stream && r.ok) return { r };
                let j = null;
                try { j = await r.json(); } catch (e) { if (timedOut) throw err0(TIMEOUT_MSG, { timeout: true }); }
                return { r, j };
            } finally { if (tm) clearTimeout(tm); }
        };
        let res = await once(await token(false));
        // 401 而本机明明登着:先强制刷新 token 再试一次(服务器校验 token 时家里网络抖一下也会回 401)
        if (res.r.status === 401) res = await once(await token(true));
        const r = res.r, j = res.j;
        st.down = false;
        if (opt.stream && r.ok) return r;
        if (!r.ok) {
            let msg = (j && j.error) || ('顾问出错了（' + r.status + '）');
            if (r.status === 401) msg = '顾问这边暂时没认出你的登录，等一下再试；一直这样就到设置里退出再登录。';
            const e = new Error(msg);
            e.status = j && j.status; e.info = j || {}; e.code = +r.status || 0;
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
    function point(path, body, timeout) {
        return serial(async () => {
            for (let i = 0; ; i++) {
                try { return aiClean(await aiFetch(path, body, { timeout: timeout || LIMIT.point })); }
                catch (e) { if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await wait(3000); continue; } throw e; }
            }
        });
    }
    // SSE:delta 边到边回调;action / proposal / memory / done / error 收起来交给调用方
    //   拿到响应头之前按总时限;之后换成空闲计时(每收到一块就重置),太久没动静就断开。
    //   没收到 done 就断了(iOS 切后台常见):out.partial = true、code 0,文字不当完整回答用(调用方决定怎么处理)。
    //   abort():她点「停一下」,取消当前这条流(out.aborted = true)。
    async function stream(path, body, onDelta) {
        const out = { text: '', meta: null, err: null, prop: null, act: null, mem: null };
        let gotDone = false, reading = false;
        try {
            await serial(async () => {
                const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const mine = { ac, stop: false };
                st.cur = mine;
                try {
                    const r = await aiFetch(path, body, { stream: true, timeout: LIMIT.streamHead, ctl: ac });
                    if (mine.stop) throw err0('停下了。', { aborted: true });
                    reading = true;
                    const rd = r.body.getReader(), dec = new TextDecoder();
                    mine.rd = rd;
                    let buf = '', idle = null, idleOut = false;
                    const kick = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => { idleOut = true; try { rd.cancel(); } catch (e) { } try { ac && ac.abort(); } catch (e) { } }, LIMIT.streamIdle); };
                    const eat = block => {
                        const b = parseSseBlock(block); if (!b) return;
                        const j = aiClean(b.data);
                        if (b.event === 'delta') { out.text += j.t || ''; if (onDelta) onDelta(out.text); }
                        else if (b.event === 'proposal') out.prop = j;
                        else if (b.event === 'action') out.act = j;
                        else if (b.event === 'memory') out.mem = j;
                        else if (b.event === 'done') { gotDone = true; out.text = j.text || out.text; out.meta = { model: j.model, effort: j.effort, cost: j.cost }; }
                        else if (b.event === 'error') out.err = j.error || '顾问出错了';
                    };
                    try {
                        kick();
                        for (; ;) {
                            const { value, done } = await rd.read();
                            if (done) break;
                            kick();
                            buf += dec.decode(value, { stream: true });
                            let k;
                            while ((k = buf.indexOf('\n\n')) >= 0) { eat(buf.slice(0, k)); buf = buf.slice(k + 2); }
                        }
                        if (buf.trim()) eat(buf);
                    } finally { if (idle) clearTimeout(idle); }
                    if (mine.stop) throw err0('停下了。', { aborted: true });
                    if (idleOut && !gotDone) throw err0(TIMEOUT_MSG, { timeout: true });
                } finally { if (st.cur === mine) st.cur = null; }
            });
        } catch (e) {
            if (e && e.aborted) { out.err = e.message; out.code = 0; out.aborted = true; }
            else if (reading) { out.err = (e && e.timeout) ? e.message : '连接断了，这条回答没收完。'; out.code = 0; }
            else { out.err = e.message; out.code = typeof e.code === 'number' ? e.code : 0; }
        }
        // 读完了却没有 done(又不是后端明说的 error):半截回答
        if (reading && !gotDone) {
            out.partial = true;
            if (!out.err) { out.err = '连接断了，这条回答没收完。'; out.code = 0; }
        }
        return out;
    }
    function abort() { const c = st.cur; if (!c) return false; c.stop = true; try { c.rd && c.rd.cancel(); } catch (e) { } try { c.ac && c.ac.abort(); } catch (e) { } return true; }
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
    // 换账号:本机缓存属于别的账号的清掉(按 uid 存;sync 换账号时也会调 clearLocal)。
    //   sk_aiprivacy1(看没看过「顾问会看到什么」)不清:它自带 uid,别的账号读到对不上就当没看过;清了反而让刚登录的人在弹出之前就被自动外发卡住
    function clearLocal() { [LOCAL_KEYS.aiChat, LOCAL_KEYS.aiNote, LOCAL_KEYS.aiAcc, LOCAL_KEYS.aiOpts, LOCAL_KEYS.aiShop, LOCAL_KEYS.aiTonight].forEach(k => { try { LS.removeItem(k); } catch (e) { } }); st.me = null; st.meUid = null; st.quota = null; }
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
        assess: (context, images, prev) => point('/api/assess', Object.assign({ context, images }, prev || {}, opts()), LIMIT.assess),
        // 要不要买:单独占忙碌位(不进排队),约 70 秒;429「还没跑完」等 8 秒重试两次
        shop: async (context, trigger) => {
            for (let i = 0; ; i++) {
                try { return aiClean(await aiFetch('/api/shop', Object.assign({ context, trigger }, opts()), { timeout: LIMIT.shop })); }
                catch (e) { if (e.code === 429 && /还没跑完/.test(e.message) && i < 2) { await wait(8000); continue; } throw e; }
            }
        },
        memory: body => point('/api/memory', body || null)
    };
    return { state: st, aiFetch, point, stream, abort, access, ready, probe, redeem, quotaText, clearLocal, opts, api };
}
