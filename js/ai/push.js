// ══ 「主动找你」(Web Push)═══════════════════════════════════════════════════════════════════
// 后端 ~/skincare-coach/push.py(架构照健身 push.py):每人一份判断用的事实,launchd 每 30 分钟 tick 一次,命中就推一句。
// 判断只有四样,不催:tonight 到她平时护肤的点报今晚排什么(完整模式今晚已完成不推;极简模式只报排什么)、
//   photo 开了拍照分析且隔了 ≥3 天(并进 tonight)、redline 就医红线刚亮(锁屏文字固定中性)、shop「要不要买」新出现「现在就缺」。
// 设置存在档案 profile.push = {on, qs, qe, max, at}(随账号同步;档案是现有云键,不加新的 CLOUD_KEYS;skinSignature 不看它)。
// 每台设备的订阅登记在后端(按 uid)。iPhone 只有装到主屏的 PWA 才收得到(iOS 16.4+)。
// 【要紧 · 锁屏隐私】上传的只有 pushFacts() 那几个字段,不带数据快照、HRT、用药、在看医生、肤况标签、产品清单;
//   关键一步只传一个产品名(后端再过一道锁屏闸)。红线只传亮没亮和起始日,不传为什么亮。
// 这个模块 import 时不碰任何全局;createPush(app, env) 才开始用。
import { safetyGate } from '../engine/gate.js';
import { medicalRedLine } from '../engine/redline.js';
import { tonight as offlineTonight } from '../engine/schedule.js';
import { syncHash, LOCAL_KEYS } from '../store.js';
import { updateProfile, loadProfile } from '../model/profile.js';

export const PUSH_DEF = { on: false, qs: 23, qe: 8, max: 1, at: 0 };
const ACTIVE = ['acid', 'retinol', 'mask'];
const LS_KEY = 'sk_wpkey';      // VAPID 公钥缓存(点开关时不用先联网,iOS 要求订阅紧跟着点击)
const LS_OWNER = 'sk_wpowner';  // 这台设备的订阅登记在哪个 uid 名下(换账号就退掉旧订阅)
export const PUSH_TABS = ['tonight', 'advisor', 'record', 'products'];
export const IOS_STEPS = ['用 Safari 打开这个页面，点「分享」（iOS 26 在右下角「•••」里）', '选「添加到主屏幕」', '从主屏幕的图标打开，回到设置里打开「提醒」，再点「允许」'];
export const DENIED_STEPS = ['iPhone：设置 › 通知 › 找到「护肤计划」› 允许通知', '电脑 / 安卓：点地址栏左边的网站设置，把通知改成「允许」', '改完回到这里，再开一次开关'];

export function pushPrefs(P) { const p = (P && P.push) || {}; return Object.assign({}, PUSH_DEF, typeof p === 'object' ? p : {}); }

// 今晚的类型:和今晚页同一套说法(ui/tonight.js model():刮胡夜 > 刷酸夜 > 面膜夜 > 维 A 夜 > 修护夜)
export function nightOf(W, plan) {
    const hasShelf = (W.products || []).some(p => !p.hidden);
    if (!hasShelf || !plan) return '';
    let shave = false; try { shave = !!offlineTonight(W).shave; } catch (e) { }
    const kinds = (plan.steps || []).map(s => s.kind || 'base');
    return shave ? '刮胡夜' : kinds.indexOf('acid') >= 0 ? '刷酸夜' : kinds.indexOf('mask') >= 0 ? '面膜夜' : kinds.indexOf('retinol') >= 0 ? '维 A 夜' : '修护夜';
}
// 关键一步:今晚的活性(酸 / 维 A / 面膜);没有就修护、精华;都没有不报名字
export function keyStepOf(W, plan) {
    const steps = ((plan && plan.steps) || []).filter(s => s.product);
    const act = steps.find(s => ACTIVE.indexOf(s.kind) >= 0);
    if (act) return act.product;
    const role = n => { const p = (W.products || []).find(x => x.name === n); return p ? p.role : ''; };
    const r = steps.find(s => role(s.product) === 'repair') || steps.find(s => role(s.product) === 'serum');
    return r ? r.product : '';
}
function hmOf(iso) { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
// 「要不要买」本机结果里现在就缺的项 → 短 id(need + what 的指纹;后端只拿它去重,不上锁屏)
export function shopNowIds(rec, uid) {
    if (!rec || !rec.data || (uid && rec.uid !== uid)) return [];
    return (rec.data.items || []).filter(x => x && x.urgency === 'now').map(x => syncHash(String(x.need || '') + '|' + String(x.what || '')).replace(/\./g, '-')).slice(0, 8);
}
// 判断用的事实(纯函数)。opt = {plan: 她眼前的今晚(shownTonight), photoOn, shop: 本机「要不要买」记录, uid}
export function pushFacts(W, opt) {
    opt = opt || {};
    const P = W.profile || {}, minimal = !!P.minimalMode;
    const jr = (W.journal || []).filter(e => e && e.date && e.date <= W.today);
    const en = jr.find(e => e.date === W.today);
    const f = { today: W.today, mode: minimal ? 'minimal' : 'full', done: !!(en && en.done) };
    const night = nightOf(W, opt.plan);
    if (night) f.night = night;
    // 就医红线亮着时今晚只排基础几样,不报产品名(锁屏上不暗示在处理什么)
    let red = { on: false };
    try { red = medicalRedLine(W); } catch (e) { }
    let gMed = false; try { gMed = !!safetyGate(W).medical; } catch (e) { }
    const key = red.on || gMed ? '' : keyStepOf(W, opt.plan);
    if (key) f.key = String(key).slice(0, 30);
    f.times = jr.filter(e => e.done && e.doneAt).sort((a, b) => a.date < b.date ? -1 : 1).slice(-14)
        .map(e => ({ date: e.date, hm: hmOf(e.doneAt) })).filter(t => t.hm);
    f.photo = !!opt.photoOn;
    const lp = jr.filter(e => e.photoAssess && e.photoAssess.usable !== false).map(e => e.date).sort().pop();
    if (lp) f.lastPhoto = lp;
    f.redline = !!red.on;
    if (red.on && red.start) f.redStart = red.start;
    f.shopNow = shopNowIds(opt.shop, opt.uid);
    return f;
}
export function factsSig(f) { return JSON.stringify([f.today, f.mode, f.night, f.key, f.done, (f.times || []).length, f.photo, f.lastPhoto, f.redline, f.redStart, f.shopNow]); }

// 这台设备:'ios' 还没装到主屏 / 'unsupported' / 'denied' / 'on' / 'off' / null 还在查
export function deviceState(nav, win, dev) {
    const ua = String(nav.userAgent || ''), ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    let standalone = nav.standalone === true; try { standalone = standalone || !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches); } catch (e) { }
    if (ios && !standalone) return 'ios';
    if (!('serviceWorker' in nav) || !win.PushManager || !win.Notification) return 'unsupported';
    if (win.Notification.permission === 'denied') return 'denied';
    return dev;
}

// env = { navigator, window, localStorage, toast, photoOn(W) → bool, shownTonight(W), user() → firebase user | null, rerender() }
export function createPush(app, env) {
    const nav = env.navigator, win = env.window, LS = env.localStorage;
    const st = { dev: null, sub: null, info: null, reg: null, busy: false, timer: null, prefsTimer: null, lastSig: '', lastUp: 0, openAt: 0 };
    const lsGet = k => { try { return LS.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { if (v == null) LS.removeItem(k); else LS.setItem(k, v); } catch (e) { } };
    const user = () => env.user();
    const ready = () => !!user() && app.ai.ready();
    const prefs = () => { try { return pushPrefs(loadProfile(app.store)); } catch (e) { return Object.assign({}, PUSH_DEF); } };   // 只读档案,不为它建一次 world
    const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
    const uaName = () => { const ua = nav.userAgent || ''; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '其他'; };
    const b64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(win.atob(s), c => c.charCodeAt(0)); };
    const within = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
    const devNow = () => deviceState(nav, win, st.dev);
    const rerender = () => { try { env.rerender(); } catch (e) { } };
    const fetchJ = (path, body) => app.ai.aiFetch(path, body, { timeout: 30000 });

    async function registration() {
        if (st.reg) return st.reg;
        const r = await Promise.race([nav.serviceWorker.ready, new Promise(res => setTimeout(() => res(null), 8000))]);
        if (!r) throw new Error('后台服务还没就绪，刷新一下再试');
        return (st.reg = r);
    }
    async function refreshDev(paint) {
        const was = st.dev;
        try {
            const d = deviceState(nav, win, 'off');
            if (d === 'ios' || d === 'unsupported') { st.dev = 'off'; st.sub = null; }
            else {
                const reg = await registration();
                let sub = await reg.pushManager.getSubscription();
                const owner = lsGet(LS_OWNER), u = user();
                if (sub && owner && u && owner !== u.uid) { try { await sub.unsubscribe(); } catch (e) { } sub = null; lsSet(LS_OWNER, null); }
                st.sub = sub; st.dev = sub ? 'on' : 'off';
            }
        } catch (e) { st.dev = 'off'; st.sub = null; }
        if (paint !== false && was !== st.dev) rerender();
        return st.dev;
    }
    async function fetchInfo() {
        if (!ready()) return null;
        try { st.info = await fetchJ('/api/push'); if (st.info && st.info.key) lsSet(LS_KEY, st.info.key); } catch (e) { return null; }
        return st.info;
    }
    const keyNow = () => lsGet(LS_KEY) || (st.info && st.info.key) || null;
    async function subscribe(p) {
        let key = keyNow();
        const N = win.Notification;
        if (!key) {   // 公钥还没取到:先在这次点击里把授权要了,再去取公钥
            if (N.permission === 'default') await N.requestPermission();
            if (N.permission !== 'granted') throw new Error('没有通知权限，收不到提醒');
            await fetchInfo(); key = keyNow();
        }
        if (!key) throw new Error('提醒服务暂时连不上，过一会儿再试');
        const reg = st.reg || await registration();
        const ask = () => within(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }), 30000, '推送服务没响应，过一会儿再试');
        let sub;
        try { sub = await ask(); } catch (e) {
            if (e && /没响应/.test(e.message)) throw e;
            const old = await reg.pushManager.getSubscription();   // 用别的公钥订过:退掉重订
            if (!old || N.permission !== 'granted') throw e;
            await old.unsubscribe(); sub = await ask();
        }
        st.info = Object.assign({}, st.info, await fetchJ('/api/push/sub', { sub: sub.toJSON(), prefs: p, tz: tz(), ua: uaName() }));
        st.sub = sub; st.dev = 'on';
        lsSet(LS_OWNER, user().uid);
        return sub;
    }
    function savePrefs(next) {
        const p = Object.assign({}, prefs(), next, { at: Date.now() });
        updateProfile(app.store, P => { P.push = p; });
        return p;
    }
    async function sendPrefs() {
        clearTimeout(st.prefsTimer); st.prefsTimer = null;
        if (!ready()) return;
        try { await fetchJ('/api/push/prefs', { prefs: prefs(), tz: tz() }); } catch (e) { }
    }
    async function turnOn() {
        if (st.busy) return;
        if (!user()) { env.toast('先登录，再开这个'); return; }
        if (!ready()) { env.toast('顾问开通了才能用提醒'); return; }
        const d = devNow();
        if (d === 'ios') { env.toast('先把 App 添加到主屏幕，从图标打开再开'); rerender(); return; }
        if (d === 'unsupported') { env.toast('这个浏览器收不到提醒'); return; }
        if (d === 'denied') { env.toast('通知权限被关了，按下面的步骤打开'); rerender(); return; }
        st.busy = true; rerender();
        try {
            await subscribe(Object.assign({}, prefs(), { on: true, at: Date.now() }));
            savePrefs({ on: true });
            env.toast('开了。到你平时护肤的点会告诉你今晚排什么');
            st.busy = false;
            upload(true);
        } catch (e) {
            const denied = win.Notification && win.Notification.permission !== 'granted';
            env.toast(denied ? '没有通知权限，收不到提醒' : (e && /[\u4e00-\u9fa5]/.test(e.message || '') ? e.message : '没开成，过一会儿再试'));
        } finally { st.busy = false; rerender(); }
    }
    async function turnOff() {
        const p = savePrefs({ on: false });
        clearTimeout(st.timer); st.timer = null;
        rerender();
        try { await fetchJ('/api/push/prefs', { prefs: p, tz: tz() }); } catch (e) { }   // 没发出去:下次打开 App 补发
        try { if (st.sub) await st.sub.unsubscribe(); } catch (e) { }
        st.sub = null; st.dev = 'off'; lsSet(LS_OWNER, null);
        env.toast('关了，不会再推提醒');
        rerender();
    }
    async function here() {
        if (st.busy || !ready()) return;
        st.busy = true; rerender();
        try { await subscribe(prefs()); env.toast('这台也会收到了'); upload(true); }
        catch (e) { env.toast(win.Notification && win.Notification.permission !== 'granted' ? '没有通知权限，收不到提醒' : '没开成，过一会儿再试'); }
        finally { st.busy = false; rerender(); }
    }
    async function test() {
        if (st.busy || !st.sub) return;
        st.busy = true;
        try { await fetchJ('/api/push/test', { endpoint: st.sub.endpoint }); env.toast('发了，几秒内会弹出来'); }
        catch (e) { env.toast(e.message || '没发出去'); }
        finally { st.busy = false; }
    }
    // 安静时段 / 每天最多几条:改完 1.2 秒后发给后端
    function setPref(k, v) {
        const lim = { qs: [0, 23], qe: [0, 23], max: [1, 3] }[k]; if (!lim) return;
        const n = Math.max(lim[0], Math.min(lim[1], Math.round(+v)));
        if (!isFinite(n)) return;
        savePrefs({ [k]: n });
        clearTimeout(st.prefsTimer); st.prefsTimer = setTimeout(sendPrefs, 1200);
    }

    // ── 事实上传 ──
    function facts() {
        const W = app.world();
        let plan = null; try { plan = env.shownTonight(W); } catch (e) { }
        let shop = null; try { shop = JSON.parse(LS.getItem(LOCAL_KEYS.aiShop)); } catch (e) { }
        const u = user();
        return pushFacts(W, { plan, photoOn: env.photoOn(W), shop, uid: u ? u.uid : '' });
    }
    // renderAll / 每分钟的翻页检查都调:开着才算;事实变了 3 秒后传(完成今晚、改方案、换了今晚、红线亮了)
    function dirty() {
        if (!prefs().on || !ready()) return;
        let sig = ''; try { sig = factsSig(facts()); } catch (e) { return; }
        if (sig === st.lastSig) return;
        clearTimeout(st.timer);
        st.timer = setTimeout(() => upload(false), 3000);
    }
    async function upload(force) {
        clearTimeout(st.timer); st.timer = null;
        if (!prefs().on || !ready() || nav.onLine === false) return false;
        const f = facts(), sig = factsSig(f);
        if (!force && sig === st.lastSig) return false;
        st.lastSig = sig; st.lastUp = Date.now();
        try { await fetchJ('/api/state', { facts: f, prefs: prefs(), tz: tz() }); return true; }
        catch (e) { st.lastSig = ''; return false; }
    }
    // 打开 App / 切回前台(10 分钟一次):订阅换了或后端删了 → 重新登记;设置补发;账号关了而这台还订着 → 退掉;然后传一次事实
    async function onOpen() {
        if (!ready() || Date.now() - st.openAt < 10 * 60e3) return;
        st.openAt = Date.now();
        const p = prefs();
        await refreshDev();
        if (!p.on) {
            if (st.sub && lsGet(LS_OWNER) === user().uid) {
                try { await st.sub.unsubscribe(); } catch (e) { }
                st.sub = null; st.dev = 'off'; lsSet(LS_OWNER, null);
                try { await fetchJ('/api/push/prefs', { prefs: p, tz: tz() }); } catch (e) { }
                rerender();
            }
            return;
        }
        const info = await fetchInfo();
        if (info && st.sub && win.Notification && win.Notification.permission === 'granted') {
            const mine = await epHash(st.sub.endpoint);
            if (!(info.devices || []).includes(mine)) try { await subscribe(p); } catch (e) { }
            if (info.prefs && (info.prefs.at || 0) < (p.at || 0)) await sendPrefs();
        }
        upload(true);
    }
    async function epHash(s) {
        const b = await win.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    }
    function go(tab) { if (PUSH_TABS.indexOf(tab) >= 0) app.show(tab); }
    function boot() {
        if ('serviceWorker' in nav) {
            nav.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'sk-open') go(e.data.tab); });
            nav.serviceWorker.ready.then(r => { st.reg = r; }).catch(() => { });
        }
        win.document.addEventListener('visibilitychange', () => {
            if (win.document.visibilityState === 'visible') onOpen();
            else if (st.timer) upload(false);   // 切到后台前把排着的那次传掉
        });
    }
    function resetForUser() { clearTimeout(st.timer); st.timer = null; st.info = null; st.lastSig = ''; st.openAt = 0; st.dev = null; st.sub = null; }

    // 设置页那一块要的状态
    function view() {
        if (st.dev === null && 'serviceWorker' in nav) refreshDev();
        if (ready() && !st.info && !lsGet(LS_KEY)) fetchInfo();
        const p = prefs(), d = devNow(), u = user();
        const c = { on: p.on, qs: p.qs, qe: p.qe, max: p.max, dev: d, line: '', act: null, guide: null };
        if (!u) c.line = '登录并开通顾问后可用';
        else if (!ready()) c.line = '顾问开通后可用（邀请制）';
        else if (d === 'ios') { c.line = 'iPhone（iOS 16.4 以上）要先装到主屏幕才收得到'; c.guide = IOS_STEPS; }
        else if (d === 'unsupported') c.line = '这个浏览器收不到提醒';
        else if (d === 'denied') { c.line = '通知权限被关了'; c.guide = DENIED_STEPS; }
        else if (st.busy) c.line = '开启中…';
        else if (p.on && d === 'on') { c.line = '已接收'; c.act = ['wptest', '发一条试试']; }
        else if (p.on && d === 'off') { c.line = '还没在这台设备接收'; c.act = ['wphere', '在这台也接收']; }
        else if (p.on) c.line = '查看中…';
        return c;
    }
    return { state: st, prefs, view, turnOn, turnOff, here, test, setPref, dirty, upload, onOpen, boot, resetForUser, facts, go };
}
