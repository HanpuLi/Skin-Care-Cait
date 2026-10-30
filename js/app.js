// ══ 启动 + 路由(4 个 tab)+ 登录态 ══════════════════════════════════════════════════════════════
// 顺序(和 v1 一样,别乱):拿到窗口锁 → 打开信封 → 'system' 维护(旧键 / 档案 / 货架迁移 / 状态清洗 / 洗澡习惯对齐 / 新的一天 / 方案 / planday)
//   → 画外壳 → 连 Firebase(登录态到了才同步)→ 注册 SW。
// 【要紧】所有模块 import 时都不碰存储;拿不到锁时 boot() 不跑,一个字不动(sync.js 的 startWithLock)。
// 这里不往 window 上挂任何东西(没有测试钩子;无头测试直接 import 模块看)。
import { createStore, K } from './store.js';
import { createSync, startWithLock } from './sync.js';
import { today, localD, mdOf, dowOf } from './clock.js';
import { seedProfile, loadProfile, autoMatchProfile } from './model/profile.js';
import { applyShelfMigrations, sanitizePS } from './model/products.js';
import { syncHabitSources, initTN } from './model/week.js';
import { absorbPrescribedHistory } from './model/journal.js';
import { syncRegimen } from './model/regimen.js';
import { buildWorld, planNow } from './model/world.js';
import { createPhotoStore } from './model/photos.js';
import { createAiClient, aiBase } from './ai/client.js';
import { createPush } from './ai/push.js';
import { openSheet, closeSheet, hasSheet, toast, sysAlert, sysConfirm, download, bindEscape, esc, ico } from './ui/sheets.js';
import { watchTheme, refreshSettings } from './ui/settings.js';
import { photoAnalysisOn } from './ui/capture.js';
import { onBoot as oobeOnBoot, onFirstSnapshot as oobeOnFirstSnapshot } from './ui/oobe.js';
import { ensureShopRunner } from './ui/products.js';
import { onShopLocalChange, shownTonight } from './ai/apply.js';
import * as tonightScreen from './ui/tonight.js';
import * as advisorScreen from './ui/advisor.js';
import * as recordScreen from './ui/record.js';
import * as productsScreen from './ui/products.js';
import * as settingsScreen from './ui/settings.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

export const SCREENS = [tonightScreen, advisorScreen, recordScreen, productsScreen];
const ALL_SCREENS = SCREENS.concat([settingsScreen]);   // 设置也是一屏(有自己的二级页),只是不在标签栏
const INSTALL_OFF = 'sk_install_off';   // 本机:关过「装到主屏」那行就不再出

// iPhone / iPad 的 Safari 标签页里(没装到主屏):提醒和离线首开都要装到主屏才行。iPadOS 冒充 Mac,按触点认
export function needsInstallHint(nav, mm) {
    const ua = String(nav.userAgent || ''), ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    let standalone = nav.standalone === true; try { standalone = standalone || !!(mm && mm('(display-mode: standalone)').matches); } catch (e) { }
    return ios && !standalone;
}
// 应用角标:完整模式、晚上 6 点以后、今晚还没点「完成今晚」= 1;极简模式不打卡,从来不挂(不催)
export function badgeCount(W, hour) {
    if (!W || (W.profile && W.profile.minimalMode) || hour < 18) return 0;
    const en = (W.journal || []).find(e => e && e.date === W.today);
    return en && en.done ? 0 : 1;
}
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function boot() {
    const app = {};
    const store = createStore({ localStorage: window.localStorage,
        onStorageError: msg => { const el = document.getElementById('sync-toast-el'); if (el) { el.textContent = msg; el.classList.add('show'); } } }).open();
    // 照片跟着记录走同一个主人(信封的 owner):登出后、离线首开(登录服务没加载出来)时,记录还属于刚才那个账号,照片也一样;
    //   以前按「Firebase 当前用户」分,登出时存的照片落在 local__ 下,再登录就找不到了
    const photos = createPhotoStore({ indexedDB: window.indexedDB, uid: () => (store.state && store.state.owner) || 'local' });
    let fbUser = null;
    const ai = createAiClient({ base: aiBase(location.hostname), getUser: () => fbUser, fetch: (u, i) => window.fetch(u, i), localStorage: window.localStorage, today });

    // 'system' 维护:每次加载 / 云端落地后都跑;只落盘,不推送(8/29)
    function maintain() {
        const t = today();
        syncHabitSources(store, t);
        applyShelfMigrations(store, t);
        sanitizePS(store);
        initTN(store, t);
        syncRegimen(store, '', false, t);   // 皮肤状况或货架变了 → 重出一版('system')
        planNow(store, { today: t });       // 先推定昨天的处方(absorb),再写今天的 sk_planday1
    }
    function applyVisibility() {
        const p = loadProfile(store), b = document.body.classList;
        b.toggle('minimal', !!p.minimalMode);
        b.toggle('hide-shave', !p.shaving);
        b.toggle('hide-hrt', !p.hrt);
        b.toggle('hide-rec', !!p.minimalMode && !!p.hideRecords);
        const seal = document.getElementById('seal-ch'); if (seal) seal.textContent = sealChar(p);
        if (b.contains('hide-rec') && current === 'record') go('tonight', { replace: true });
    }
    function renderHeader() {
        const t = today(), el = document.getElementById('hdr-date');
        if (el) el.textContent = mdOf(t) + ' ' + WEEK[dowOf(t)];
    }
    // 印章字:和 v1 同一个字段 profile.seal(v2 早期写过 stamp,读的时候兼容);没设就退到登录名的首个汉字(v1 sealChar)
    function sealChar(p) {
        const c = p.seal || p.stamp;
        if (c) return Array.from(String(c))[0];
        let n = ''; try { n = (sync.state.user && sync.state.user.displayName) || ''; } catch (e) { }   // 首帧时 sync 可能还没建好
        return /^[一-鿿]/.test(n) ? n[0] : '我';
    }
    // ── 路由(DESIGN.md §3):#/tab[/页[/参数]] ──
    // tab 之间 = replaceState(不入栈);进二级页 = pushState(入栈,有返回、浏览器后退、左边缘右滑返回)。
    // 每个 tab 的 <section> 记着自己正停在哪一页(routes[tab]),别的模块 renderScreen('advisor') 重画的是那一页。
    // 设置(#/settings…)也是一个 <section>,从页头印章进,不在标签栏;它的首页返回到来时的 tab。
    // 四个 tab 共用文档滚动(外壳不另起 overflow 容器):每一页各记各的位置;新进的页从顶上开始,返回的页回到原处
    let current = 'tonight', lastTab = 'tonight', navDir = '';
    const routes = {}, scrollAt = {};
    const screenOf = id => ALL_SCREENS.find(s => s.id === id);
    const keyOf = r => r.tab + (r.page ? '/' + r.page + (r.arg ? '/' + r.arg : '') : '');
    function parseRoute(h) {
        const parts = String(h || '').replace(/^#?\/?/, '').split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
        let tab = parts[0] || 'tonight', page = parts[1] || '', arg = parts.slice(2).join('/');
        const sc = screenOf(tab);
        if (!sc) { tab = 'tonight'; page = ''; arg = ''; }
        else if (page && !(sc.pages && sc.pages[page])) { page = ''; arg = ''; }
        if (tab === 'record' && document.body.classList.contains('hide-rec')) { tab = 'tonight'; page = ''; arg = ''; }
        return { tab, page, arg };
    }
    const hrefOf = r => '#/' + [r.tab, r.page, r.arg].filter(Boolean).map(x => x.split('/').map(encodeURIComponent).join('/')).join('/');
    // 父页:二级页 → 本 tab 首页;设置首页 → 来时的 tab
    function parentOf(r) { return r.page ? { tab: r.tab, page: '', arg: '' } : r.tab === 'settings' ? { tab: lastTab, page: '', arg: '' } : null; }
    function route(r, how) {
        const prevKey = routes[current] ? keyOf(routes[current]) : '';
        const key = keyOf(r);
        if (prevKey && prevKey !== key) scrollAt[prevKey] = window.scrollY || 0;
        if (r.tab !== 'settings') lastTab = r.tab;
        const moved = prevKey !== key || current !== r.tab;
        current = r.tab; routes[r.tab] = r;
        navDir = how || '';
        ALL_SCREENS.forEach(s => {
            const sec = document.getElementById(s.id), tab = document.getElementById('tab-' + s.id);
            if (sec) sec.classList.toggle('active', s.id === r.tab);
            // 设置页里标签栏照样在,亮着来时的那个 tab
            const on = s.id === (r.tab === 'settings' ? lastTab : r.tab);
            if (tab) { tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.tabIndex = on ? 0 : -1; }
        });
        renderScreen(r.tab);
        if (moved) try { window.scrollTo(0, how === 'push' ? 0 : (scrollAt[key] || 0)); } catch (e) { }
        if (moved && (r.page || r.tab === 'settings')) { const h = document.querySelector('#' + r.tab + ' .pg-t'); if (h) try { h.focus({ preventScroll: true }); } catch (e) { } }
    }
    // go('tonight/week') 入栈;go('advisor', {replace:true}) 换掉当前这条。tab 本身(没有页)默认 replace
    function go(path, o) {
        o = o || {};
        const r = parseRoute(path);
        const replace = o.replace != null ? o.replace : (!r.page && r.tab !== 'settings');
        const href = hrefOf(r);
        if (location.hash !== href) {
            if (replace) history.replaceState(null, '', href); else history.pushState({ sk: 1 }, '', href);
        }
        route(r, o.how || (replace ? '' : 'push'));
    }
    function show(path) { go(path); }   // 旧接口:别的模块 app.show('products') / show('advisor') 照用
    // 返回:站内来的就退一步(和浏览器后退同一条历史);直达的(书签 / 通知点进来)换成父页
    function back() {
        const r = routes[current], par = r && parentOf(r);
        if (!par) return;
        if (history.state && history.state.sk) history.back();
        else { history.replaceState(null, '', hrefOf(par)); route(par, 'pop'); }
    }
    function onHistory() {
        const r = parseRoute(location.hash);
        const cur = routes[current];
        if (cur && keyOf(cur) === keyOf(r) && current === r.tab) return;   // popstate 和 hashchange 都会来,第二次不重画
        route(r, 'pop');
    }
    // 页头:「‹ 父页名」+ 大标题(每页一个 h1,进页时焦点落在这里)
    function pageHead(r, sc) {
        const par = parentOf(r), pSc = par && screenOf(par.tab);
        const pg = r.page ? sc.pages[r.page] : null;
        const title = pg ? (typeof pg.title === 'function' ? pg.title(app, r.arg) : pg.title) : sc.title;
        const pName = pSc ? (par.page ? pSc.pages[par.page].title : pSc.title) : '';
        return `<header class="pg-h">${par ? `<button type="button" class="pg-back" data-back aria-label="返回 ${esc(pName)}">${ico('back')}<span>${esc(pName)}</span></button>` : ''}
            <h1 class="pg-t" tabindex="-1">${esc(title)}</h1></header>`;
    }
    // 一页的数据出了问题,只拖垮这一页:画一张「这一页出错了」,其余各页和启动照常
    function renderScreen(id) {
        const s = screenOf(id || current); if (!s) return;
        const root = document.getElementById(s.id); if (!root) return;
        const r = routes[s.id] || { tab: s.id, page: '', arg: '' };
        root.dataset.page = r.page || '';
        root.classList.remove('pg-push', 'pg-pop');
        if (s.id === current && navDir) { void root.offsetWidth; root.classList.add(navDir === 'push' ? 'pg-push' : 'pg-pop'); }
        if (s.id === current) navDir = '';
        try {
            if (r.page) {
                const pg = s.pages[r.page];
                root.innerHTML = pageHead(r, s) + `<div class="pg-b">${pg.render(app, r.arg)}</div>`;
                pg.mount(root.querySelector('.pg-b'), app, r.arg);
            } else {
                root.innerHTML = (s.id === 'settings' ? pageHead(r, s) : '') + s.render(app);
                s.mount(root, app);
            }
        } catch (e) {
            root.innerHTML = (r.page ? pageHead(r, s) : '') + `<section class="sec screen-err"><h2 class="sec-t">这一页出错了</h2><p class="lede">记录都在这台设备上，一个字没动。重新加载一次通常就好。</p>
                <p class="note">${esc((e && e.message) || String(e))}</p><div class="btn-row"><button type="button" class="btn" data-reload>重新加载</button></div></section>`;
            const b = root.querySelector('[data-reload]'); if (b) b.addEventListener('click', () => location.reload());
            try { console.error(e); } catch (x) { }
        }
    }
    // 主屏 App 里没有系统的返回手势:二级页从左边缘 24px 内起手右滑,页面跟手;过 1/3 宽或甩得够快就返回(DESIGN.md §2)
    function bindEdgeSwipe() {
        let sx = 0, sy = 0, st = 0, dx = 0, el = null, live = false;
        document.addEventListener('touchstart', e => {
            const t = e.touches[0], r = routes[current];
            el = null; live = false;
            if (!t || t.clientX > 24 || !r || !parentOf(r) || document.querySelector('#sheet-root .sheet-ov')) return;
            el = document.getElementById(current); sx = t.clientX; sy = t.clientY; st = Date.now(); dx = 0;
        }, { passive: true });
        document.addEventListener('touchmove', e => {
            if (!el) return; const t = e.touches[0];
            dx = t.clientX - sx;
            if (!live) { if (Math.abs(t.clientY - sy) > Math.abs(dx)) { el = null; return; } if (dx > 8) { live = true; el.classList.add('pg-drag'); } }
            if (live) el.style.transform = 'translateX(' + Math.max(0, dx) + 'px)';
        }, { passive: true });
        const end = () => {
            if (!el) return; const e2 = el; el = null;
            if (!live) return;
            const v = dx / Math.max(1, Date.now() - st);
            e2.classList.remove('pg-drag'); e2.style.transform = '';
            if (dx > window.innerWidth / 3 || v > 0.5) back();
        };
        document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
    }
    function renderAll() { maintain(); applyVisibility(); renderHeader(); renderScreen(current); updateBadge(); }
    function updateBadge() {
        if (app.push) app.push.dirty();   // 「主动找你」:开着、判断用的事实变了才传(完成今晚 / 改方案 / 换了今晚 / 翻页)
        if (!navigator.setAppBadge) return;
        let n = 0; try { n = badgeCount(app.world(), new Date().getHours()); } catch (e) { return; }
        try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { }); } catch (e) { }
    }
    function installHint() {
        const el = document.getElementById('install-hint'); if (!el) return;
        let off = false; try { off = !!localStorage.getItem(INSTALL_OFF); } catch (e) { }
        if (off || !needsInstallHint(navigator, window.matchMedia && window.matchMedia.bind(window))) { el.hidden = true; return; }
        el.innerHTML = `<p class="note">装到主屏幕再用：Safari 里点「分享」（iOS 26 在右下角「•••」里），选「添加到主屏幕」。提醒和没网时打开都要这样装。</p><button type="button" class="btn-link sm quiet" data-x aria-label="不再提示">不再提示</button>`;
        el.hidden = false;
        el.querySelector('[data-x]').addEventListener('click', () => { try { localStorage.setItem(INSTALL_OFF, '1'); } catch (e) { } el.hidden = true; });
    }
    function reloadFromStore() { initTN(store, today()); applyVisibility(); }

    const sync = createSync({
        store, today, localD, navigator, window,
        ui: { openSheet, closeSheet, hasSheet, toast, sysAlert, sysConfirm, download,
              status: v => {
                  const b = document.getElementById('net-badge'); if (b) { b.hidden = !v.badge; b.textContent = v.badgeText; }
                  const ch = document.getElementById('sync-choose'); if (ch) ch.hidden = !v.paused;
                  const sl = document.getElementById('sync-line'); if (sl) sl.textContent = v.line;
              } },
        hooks: {
            reloadFromStore, renderAll,
            absorbPrescribedHistory: () => absorbPrescribedHistory(store, today()),
            autoMatchProfile: (uid, user) => autoMatchProfile(store, uid, user),
            // 换账号:顾问本机缓存、旧照片,还有各屏模块里的半截状态(草稿、待发照片、一句话解析、今晚的「重做」)一起清
            clearLocalExtras: () => {
                try { ai.abort(); } catch (e) { }
                ai.clearLocal(); photos.clearLegacyUnprefixed();
                if (app.push) app.push.resetForUser();
                SCREENS.forEach(sc => { if (typeof sc.resetForUser === 'function') try { sc.resetForUser(); } catch (e) { } });
            },
            // 登录后核一次顾问开通;核成了就补「新的一天」那次今晚(核不成不再追着核;页面在后台时 tonight.js 自己会跳过,等切回来)
            onAuthUser: user => {
                fbUser = user || null;
                if (user) Promise.resolve(ai.probe()).then(() => {
                    if (!ai.ready()) return;
                    // 开机时还没登录,当前页是按「没登录 / 顾问没开通」画的(今晚页的来源一句、记录页的拍照入口):探到能用就重画一次。
                    //   旧版靠点当前 tab 重画盖住了,多页后点当前 tab 只回顶。顾问 / 设置页挂载时自己核 /api/me,不重画,免得多打一次
                    if (current !== 'advisor' && current !== 'settings') renderScreen(current);
                    tonightScreen.onAiReady(app); app.push.onOpen();
                }, () => { });
            },
            onFirstSnapshot: () => oobeOnFirstSnapshot(app),   // 新用户引导 / 改版说明(oobe.js 另有兜底:第一份快照走待推分支时这里不来)
            adoptLocalPhotos: uid => { try { photos.adoptLocal(uid); } catch (e) { } }   // 认领了本机没登录时的记录:那时的照片一起搬
        }
    });
    // 「主动找你」(Web Push):设置在 profile.push,事实上传 / 订阅 / 点通知跳页都在 ai/push.js
    app.push = createPush(app, { navigator, window, localStorage: window.localStorage, toast,
        photoOn: W => photoAnalysisOn(app, W.profile), shownTonight: W => app.shownTonight(W),
        user: () => fbUser, rerender: () => refreshSettings(app) });
    Object.assign(app, { store, sync, ai, photos, today, show, go, back, renderAll, renderScreen,
        route: () => Object.assign({}, routes[current] || { tab: current, page: '', arg: '' }),
        tonightChanged: why => tonightScreen.localChange(app, why),   // 别的屏改了今晚的前提(今天洗澡 / 刮胡、模式)后调:签名变了才让顾问重排
        // 她眼前的今晚(今晚页显示的那份,顾问版或离线):对话 / 反馈 / 拍照分析的上下文、change_tonight 的校验、未来 7 晚的今晚那格都用它
        aiTonightData: W => tonightScreen.aiTonightData(app, W),
        shownTonight: W => { W = W || app.world(); return shownTonight(W, tonightScreen.aiTonightData(app, W)); },
        world: opts => buildWorld(store, Object.assign({ today: today() }, opts || {})),
        signIn() {
            if (typeof firebase === 'undefined') { sysAlert('登录服务没加载出来，检查一下网络再试。'); return; }
            firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => sysAlert('登录没成功。Safari 可能拦了弹窗：允许弹窗后再试，或者换电脑登录。\n\n' + e.message));
        },
        signOut() { sysConfirm('退出登录？退出后用这台设备上的数据。', () => firebase.auth().signOut(), { ok: '退出' }); }
    });

    // Firebase SDK 有了结果(加载到 / 没加载到)时 resolve(oobe 的「1.8 秒还没登录」从这之后算)
    let sdkDone;
    app.firebaseReady = new Promise(r => { sdkDone = r; });
    // 启动维护(都是 'system')
    store.migrateOlderKeys();
    seedProfile(store);
    maintain();
    applyVisibility();
    renderHeader();
    bindEscape();
    // 点 tab:切过去(不入栈);已经在这个 tab 的二级页 → 回这个 tab 首页;已在首页 → 回到顶上(HIG · Tab bars)
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.addEventListener('click', () => {
        const id = t.dataset.tab, r = routes[id];
        if (current === id && r && r.page) go(id, { replace: true, how: 'pop' });
        else if (current === id) try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
        else go(id);
    }));
    const sealBtn = document.getElementById('btn-settings'); if (sealBtn) sealBtn.addEventListener('click', () => { if (current !== 'settings') go('settings'); });
    // 站内链接 <a href="#/…">:走 go() 入栈(带 sk 标记,返回键才知道能 history.back());返回键委托
    document.addEventListener('click', e => {
        const bk = e.target.closest && e.target.closest('[data-back]');
        if (bk) { e.preventDefault(); back(); return; }
        const a = e.target.closest && e.target.closest('a[href^="#/"]');
        if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault(); go(a.getAttribute('href'));
    });
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    bindEdgeSwipe();
    go(location.hash || '#/tonight', { replace: true });
    ensureShopRunner(app);   // 「要不要买」的后台判断:只听本机操作入口(ai/apply.js 的 local* / apply* / undo*)
    // 同一批本机入口(用完 / 买回 / 快用完、顾问方案落成 / 撤销 / 恢复)也让今晚重排:防抖 + 签名没变不调;同步来的不走这里
    onShopLocalChange(why => tonightScreen.localChange(app, why));
    watchTheme();            // 深浅色跟随系统 / 晚上自动
    oobeOnBoot(app);         // 新用户引导 / 改版说明(没登录时 1.8 秒后按本机数据判断)
    installHint();           // iPhone Safari 标签页里:提示装到主屏(可关,关了不再出)
    app.push.boot();         // 点通知跳页(SW 发来的消息)+ 切回前台时补登记 / 传事实
    updateBadge();

    // 跨零点 / 凌晨 3 点翻页(PWA 常挂在后台过夜)
    let lastDay = today();
    function checkDayRollover() { const t = today(); if (t === lastDay) { updateBadge(); return; } lastDay = t; renderAll(); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) sync.flushPendingPush(); else checkDayRollover(); });
    window.addEventListener('focus', checkDayRollover);
    setInterval(checkDayRollover, 60000);

    // Firebase:第一屏画完再按顺序加载 SDK(async=false 保证顺序;SW 缓存优先),三个都有了结果(加载到 / 没加载到)再初始化。
    //   CDN 没加载到(离线 / 被墙 / HTTP 缓存被系统清了)就只用本机数据,不报错;文案说「登录服务没加载出来」,别说「没登录」。
    const SDK = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'].map(f => 'https://www.gstatic.com/firebasejs/9.23.0/' + f);
    let sdkLeft = SDK.length;
    function initFirebase() {
        let ok = false;
        try {
            if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey) {
                if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
                sync.setDb(firebase.firestore());
                firebase.auth().onAuthStateChanged(u => sync.handleAuthChange(u));
                ok = true;
            }
        } catch (e) { ok = false; }
        if (sync.setSdkMissing) sync.setSdkMissing(!ok);
        sync.showSyncStatus('', 'ok');
        if (!ok) renderAll();   // 「没登录」→「登录服务没加载出来」
        sdkDone(ok);
    }
    const sdkSettled = () => { if (--sdkLeft === 0) initFirebase(); };
    if (typeof firebase !== 'undefined' && firebase.apps) { sdkLeft = 0; initFirebase(); }   // 已经有了(测试替身 / 别处加载过)
    else SDK.forEach(src => {
        const sc = document.createElement('script');
        sc.src = src; sc.async = false;
        sc.onload = sdkSettled; sc.onerror = sdkSettled;
        document.head.appendChild(sc);
    });
    sync.showSyncStatus('', 'ok');

    const afterLoad = fn => { if (document.readyState === 'complete') fn(); else window.addEventListener('load', fn, { once: true }); };
    if ('serviceWorker' in navigator) {
        afterLoad(() => { navigator.serviceWorker.register('./sw.js').catch(() => { }); });
        // 新版本的 SW 接管了:这一页已经整套加载完(全是旧版),不硬刷新(可能有没发出去的草稿),提示下次打开生效
        const hadCtl = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtl) toast('新版本好了，下次打开生效。', 4000); });
    }
    // 子集外的生僻字:页面加载完、在线时才挂 Google 的 Noto Serif SC(按 unicode-range 只拉用到的那一片;SW 缓存住)
    afterLoad(() => {
        if (!navigator.onLine) return;
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC&display=swap';
        document.head.appendChild(l);
    });
    document.documentElement.dataset.boot = 'ok';   // 外壳已就绪(CSS 用它收起启动前的占位)
}

startWithLock({ navigator, document, window }, boot);
