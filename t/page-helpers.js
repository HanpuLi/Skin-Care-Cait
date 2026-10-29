// 注入到每个测试页面(Page.addScriptToEvaluateOnNewDocument)。只在 t/ 的无头测试里用,线上页面不加载这个文件。
(function () {
    // ── 日期工具(和 App 的 today() 一样:凌晨 3 点前算前一天)──
    function d(n) { const x = new Date(); if (x.getHours() < 3) x.setDate(x.getDate() - 1); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    window.__d = d;

    // ── 种子:完整模式老用户 / 极简模式老用户 / 全新用户(数据是虚构的测试场景)──
    window.__seed = {
        // 完整模式:混油,近两周天天「出油 + 闭口」,从不勾「稳定」(验收:屏障 ≥65)
        full(o) {
            o = o || {};
            localStorage.clear();
            S('sk_profile1', Object.assign({ shaving: true, hrt: false, minimalMode: false, showJournal: true, skinType: '混油皮 · 屏障修护', onboarded: true, autoMatched: 'cait', tour3: true }, o.profile || {}));
            const j = [];
            for (let i = o.today ? 0 : -1; i >= -13; i--) j.push({ date: d(i), status: (o.status && o.status(i)) || ['出油', '闭口'], products: (o.products && o.products(i)) || [], note: '', phase: '' });
            S('sk_jrnl1', o.jrnl || j);
            S('sk_gone1', ['avene', 'toleriane']);
            S('sk_mig1', ['avene-remove-2026-08-26', 'all-normal-2026-08-26', 'tolerianeSens-open-2026-08-29']);
            S('sk_prods1', { goodGenes: 'active', drorganic: 'owned' });
            if (o.extra) Object.keys(o.extra).forEach(k => S(k, o.extra[k]));
            return 'full';
        },
        // 极简模式:人中/鼻下避开酸/面膜/维 A;日志全是「排上的默认用了」推定出来的
        minimal(o) {
            o = o || {};
            localStorage.clear();
            S('sk_profile1', Object.assign({ shaving: false, hrt: false, minimalMode: true, showJournal: false, useMakeupRemoval: false, skinType: '油偏混 · 抗闭口', onboarded: true, autoMatched: 'cici', tour3: true,
                zones: [{ name: '人中/鼻下', avoid: ['acid', 'mask', 'retinol'], care: '只温和清洁 + 修护霜点涂' }] }, o.profile || {}));
            const j = [];
            for (let i = -1; i >= -13; i--) j.push({ date: d(i), status: (o.status && o.status(i)) || [], products: (o.products && o.products(i)) || [], note: '', phase: '', auto: true });
            S('sk_jrnl1', o.jrnl || j);
            S('sk_gone1', ['avene', 'toleriane'].concat(o.nomoist ? ['tolerianeSens'] : []));
            S('sk_mig1', ['avene-remove-2026-08-26', 'all-normal-2026-08-26', 'tolerianeSens-open-2026-08-29']);
            S('sk_prods1', { goodGenes: 'active', drorganic: 'owned' });
            if (o.extra) Object.keys(o.extra).forEach(k => S(k, o.extra[k]));
            return 'minimal';
        },
        fresh() { localStorage.clear(); return 'fresh'; }
    };

    // ── 假顾问后端:拦 http://127.0.0.1:8808/* ──
    // window.__AIF = { mode:'on'|'down'|'none'|'mismatch', chat:[[event,data],...], plan:{...}, review:{...}, vision:{...}, note:{...}, feedback:{...} }
    // 每次调用记进 __AIF.log
    const realFetch = window.fetch.bind(window);
    const enc = new TextEncoder();
    function json(status, obj) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
    function sse(events) {
        const body = new ReadableStream({
            async start(c) {
                for (const [ev, data] of events) { c.enqueue(enc.encode('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n')); await new Promise(r => setTimeout(r, 5)); }
                c.close();
            }
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    window.fetch = async function (url, init) {
        const u = String(url && url.url || url);
        if (!u.startsWith('http://127.0.0.1:8808')) return realFetch(url, init);
        const F = window.__AIF || { mode: 'down' };
        const p = new URL(u).pathname;
        let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { }
        (F.log = F.log || []).push({ p, body, auth: init && init.headers && init.headers.Authorization });
        if (F.mode === 'down') throw new TypeError('Failed to fetch');
        if (p === '/api/redeem') {
            if (body && body.code === 'GOOD1-CODE2') { F.mode = 'on'; return json(200, { ok: true, name: 'Tester' }); }
            return json(400, { error: '邀请码不对或已经用过了' });
        }
        if (F.mode === 'quota') return json(429, { error: '今天的 AI 用量到上限了($5/天)，明天再来。' });
        if (F.mode === 'none') return json(403, { error: '顾问现在是邀请制', status: 'not_allowed' });
        if (F.mode === 'mismatch') return json(403, { error: '这个邮箱绑了别的账号', status: 'mismatch' });
        const wrap = (data) => json(200, { data, model: 'claude-test', effort: 'medium', cost: 0.012 });
        if (p === '/api/me') return json(200, { status: 'allowed', name: 'Tester', today: 0.12, cycle: 3.4, daily_cap: 5, models: [['claude-test', 'Test', '']], efforts: [['low', '低'], ['medium', '中'], ['high', '高']], defaults: { model: 'claude-test', effort: 'medium' } });
        if (p === '/api/memory') {
            F.mem = F.mem || [{ id: 'm1', text: '对酒精敏感', at: '2026-10-20T10:00:00Z' }, { id: 'm2', text: 'B5 只点涂', at: '2026-10-21T10:00:00Z' }];
            if (body && body.op === 'delete') F.mem = F.mem.filter(x => x.id !== body.id);
            if (body && body.op === 'clear') F.mem = [];
            return json(200, { items: F.mem });
        }
        if (p === '/api/chat') return sse(F.chat || [['delta', { t: '好的。' }], ['done', { text: '好的。', model: 'claude-test', effort: 'medium', cost: 0.01 }]]);
        if (p === '/api/plan') return wrap(F.plan || { rationale: '先稳住', rules: { acidCap: 1, acidName: '', acidZones: [], cleanse: '', repair: '', repairWhy: '' }, resting: [], gaps: [] });
        if (p === '/api/review') return wrap(F.review || { headline: '这周稳', summary: '没什么要改', wins: [], issues: [], adjustments: [] });
        if (p === '/api/vision') return wrap(F.vision || { mode: 'read_label', name: '', role: '', traits: [], axes: {}, note: '' });
        if (p === '/api/note') return wrap(F.note || { note: '今晚照常，记得等脸干了再涂酸。' });
        if (p === '/api/feedback') return wrap(F.feedback || { text: '做得不错。', note_add: '', next_adjust: [], dropped: [] });
        if (p === '/api/swap') return wrap(F.swap || { to: '', why: '' });
        // 要不要买新的:F.shop 顶替固定返回;F.shopErr 回 502;F.shopMs 让它慢一点(测「顾问在查…」)
        if (p === '/api/shop') {
            if (F.shopMs) await new Promise(r => setTimeout(r, F.shopMs));
            if (F.shopErr) return json(502, { error: F.shopErr });
            return wrap(F.shop || window.__SHOP);
        }
        return json(404, { error: 'nf' });
    };
    // 假顾问的「要不要买新的」固定返回(三档都有、有接班、有不带链接的型号、有 skip)
    window.__SHOP = {
        verdict: 'buy', summary: '缺一支洗澡夜用的强清洁，保湿快用完前备上。',
        items: [
            { need: '强清洁洁面', urgency: 'now', what: '洗澡夜用的清洁力强一点的洁面，无香精', why: '近两周常出油，洗澡夜要洗干净', cover: '暂时用温和洁面洗两遍',
              replaces: '', picks: [{ name: 'CeraVe Foaming Cleanser 236ml', where: 'Boots', price: '£12', why: '无香精、清洁力够', url: 'https://www.boots.com/cerave-foaming-cleanser' },
                                    { name: 'La Roche-Posay Effaclar Gel', where: 'Superdrug', price: '£15', why: '控油', url: '' }] },
            { need: '轻薄保湿', urgency: 'before_out', what: '无香精的 fluid', why: '你标了它快用完了', cover: '用完前照常用', replaces: 'La Roche-Posay Toleriane Sensitive Fluide',
              picks: [{ name: 'Avène Tolérance Hydra-10 Fluid', where: 'LookFantastic', price: '£18', why: '9 个成分', url: 'https://www.lookfantastic.com/avene-hydra-10' }] },
            { need: '防晒备用', urgency: 'optional', what: 'SPF50 清爽型', why: '现在这支还够用两个月', cover: '现在这支', replaces: '', picks: [] }
        ],
        skip: [{ name: 'B5 修复霜', why: '只点涂，用得很慢' }, { name: '杏仁酸', why: '家里这支还有大半瓶' }]
    };
    // 「登录」:只顶替 ai.js 用来取当前用户的那个函数。index.html 的 Firebase 本身被掐断,不登录
    window.__login = function (uid) {
        const u = { uid: uid || 'u-test', displayName: 'Tester Name', email: 't@example.com', getIdToken: async () => 'fake-id-token' };
        window._aiUser = () => u;
        return u;
    };
})();
