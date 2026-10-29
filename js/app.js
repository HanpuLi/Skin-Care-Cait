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
import { openSheet, closeSheet, hasSheet, toast, sysAlert, sysConfirm, download, bindEscape } from './ui/sheets.js';
import { openSettings, watchTheme } from './ui/settings.js';
import { onBoot as oobeOnBoot, onFirstSnapshot as oobeOnFirstSnapshot } from './ui/oobe.js';
import { ensureShopRunner } from './ui/products.js';
import { onShopLocalChange } from './ai/apply.js';
import * as tonightScreen from './ui/tonight.js';
import * as advisorScreen from './ui/advisor.js';
import * as recordScreen from './ui/record.js';
import * as productsScreen from './ui/products.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

export const SCREENS = [tonightScreen, advisorScreen, recordScreen, productsScreen];
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function boot() {
    const app = {};
    const store = createStore({ localStorage: window.localStorage,
        onStorageError: msg => { const el = document.getElementById('sync-toast-el'); if (el) { el.textContent = msg; el.classList.add('show'); } } }).open();
    const photos = createPhotoStore({ indexedDB: window.indexedDB, uid: () => (app.sync && app.sync.state.user && app.sync.state.user.uid) || 'local' });
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
        const seal = document.getElementById('seal-ch'); if (seal) seal.textContent = (p.stamp && String(p.stamp).slice(0, 1)) || '我';
        if (b.contains('hide-rec') && current === 'record') show('tonight');
    }
    function renderHeader() {
        const t = today(), el = document.getElementById('hdr-date');
        if (el) el.textContent = mdOf(t) + ' ' + WEEK[dowOf(t)];
    }
    // ── 路由:#/tonight /advisor /record /products ──
    let current = 'tonight';
    function show(id) {
        if (!SCREENS.some(s => s.id === id)) id = 'tonight';
        if (id === 'record' && document.body.classList.contains('hide-rec')) id = 'tonight';
        current = id;
        SCREENS.forEach(s => {
            const sec = document.getElementById(s.id), tab = document.getElementById('tab-' + s.id);
            const on = s.id === id;
            if (sec) sec.classList.toggle('active', on);
            if (tab) { tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.tabIndex = on ? 0 : -1; }
        });
        renderScreen(id);
        if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
    }
    function renderScreen(id) {
        const s = SCREENS.find(x => x.id === (id || current)); if (!s) return;
        const root = document.getElementById(s.id); if (!root) return;
        root.innerHTML = s.render(app);
        s.mount(root, app);
    }
    function renderAll() { maintain(); applyVisibility(); renderHeader(); renderScreen(current); }
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
            clearLocalExtras: () => { ai.clearLocal(); photos.clearLegacyUnprefixed(); },
            // 登录后核一次顾问开通;核成了就补「新的一天」那次今晚(核不成不再追着核;页面在后台时 tonight.js 自己会跳过,等切回来)
            onAuthUser: user => { fbUser = user || null; if (user) Promise.resolve(ai.probe()).then(() => { if (ai.ready()) tonightScreen.onAiReady(app); }, () => { }); },
            onFirstSnapshot: () => oobeOnFirstSnapshot(app)   // 新用户引导 / 改版说明(oobe.js 另有兜底:第一份快照走待推分支时这里不来)
        }
    });
    Object.assign(app, { store, sync, ai, photos, today, show, renderAll, renderScreen,
        tonightChanged: why => tonightScreen.localChange(app, why),   // 别的屏改了今晚的前提(今天洗澡 / 刮胡、模式)后调:签名变了才让顾问重排
        world: opts => buildWorld(store, Object.assign({ today: today() }, opts || {})),
        signIn() {
            if (typeof firebase === 'undefined') { sysAlert('登录服务没加载出来，检查一下网络再试。'); return; }
            firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => sysAlert('登录没成功。Safari 可能拦了弹窗：允许弹窗后再试，或者换电脑登录。\n\n' + e.message));
        },
        signOut() { sysConfirm('退出登录？退出后用这台设备上的数据。', () => firebase.auth().signOut(), { ok: '退出' }); }
    });

    // 启动维护(都是 'system')
    store.migrateOlderKeys();
    seedProfile(store);
    maintain();
    applyVisibility();
    renderHeader();
    bindEscape();
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    const sealBtn = document.getElementById('btn-settings'); if (sealBtn) sealBtn.addEventListener('click', () => openSettings(app));
    window.addEventListener('hashchange', () => { const id = location.hash.replace(/^#\/?/, ''); if (id && id !== current) show(id); });
    show(location.hash.replace(/^#\/?/, '') || 'tonight');
    ensureShopRunner(app);   // 「要不要买」的后台判断:只听本机操作入口(ai/apply.js 的 local* / apply* / undo*)
    // 同一批本机入口(用完 / 买回 / 快用完、顾问方案落成 / 撤销 / 恢复)也让今晚重排:防抖 + 签名没变不调;同步来的不走这里
    onShopLocalChange(why => tonightScreen.localChange(app, why));
    watchTheme();            // 深浅色跟随系统 / 晚上自动
    oobeOnBoot(app);         // 新用户引导 / 改版说明(没登录时 1.8 秒后按本机数据判断)

    // 跨零点 / 凌晨 3 点翻页(PWA 常挂在后台过夜)
    let lastDay = today();
    function checkDayRollover() { const t = today(); if (t === lastDay) return; lastDay = t; renderAll(); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) sync.flushPendingPush(); else checkDayRollover(); });
    window.addEventListener('focus', checkDayRollover);
    setInterval(checkDayRollover, 60000);

    // Firebase:CDN 没加载到(离线 / 被墙)就只用本机数据,不报错
    try {
        if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey) {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            sync.setDb(firebase.firestore());
            firebase.auth().onAuthStateChanged(u => sync.handleAuthChange(u));
        }
    } catch (e) { sync.showSyncStatus('', 'ok'); }
    sync.showSyncStatus('', 'ok');

    const afterLoad = fn => { if (document.readyState === 'complete') fn(); else window.addEventListener('load', fn, { once: true }); };
    if ('serviceWorker' in navigator) afterLoad(() => { navigator.serviceWorker.register('./sw.js').catch(() => { }); });
    // 子集外的生僻字:页面加载完、在线时才挂 Google 的 Noto Serif SC(按 unicode-range 只拉用到的那一片;SW 缓存住)
    afterLoad(() => {
        if (!navigator.onLine) return;
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC&display=swap';
        document.head.appendChild(l);
    });
    document.documentElement.dataset.boot = 'ok';   // 外壳已就绪(CSS 用它收起启动前的占位)
}

startWithLock({ navigator, document, window }, boot);
