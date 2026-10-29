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
import { openSheet, closeSheet, hasSheet, toast, sysAlert, sysConfirm, download, bindEscape, esc } from './ui/sheets.js';
import { openSettings, watchTheme } from './ui/settings.js';
import { onBoot as oobeOnBoot, onFirstSnapshot as oobeOnFirstSnapshot } from './ui/oobe.js';
import { ensureShopRunner } from './ui/products.js';
import { onShopLocalChange, shownTonight } from './ai/apply.js';
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
        if (b.contains('hide-rec') && current === 'record') show('tonight');
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
    // ── 路由:#/tonight /advisor /record /products ──
    // 四个 tab 共用文档滚动(外壳不另起 overflow 容器):切 tab 时各记各的位置,没记过的从顶上开始(真机 844 高,每屏都从标题看起)
    let current = 'tonight';
    const scrollAt = {};
    function show(id) {
        if (!SCREENS.some(s => s.id === id)) id = 'tonight';
        if (id === 'record' && document.body.classList.contains('hide-rec')) id = 'tonight';
        const prev = current, moved = prev !== id;
        if (moved) scrollAt[prev] = window.scrollY || 0;
        current = id;
        SCREENS.forEach(s => {
            const sec = document.getElementById(s.id), tab = document.getElementById('tab-' + s.id);
            const on = s.id === id;
            if (sec) sec.classList.toggle('active', on);
            if (tab) { tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.tabIndex = on ? 0 : -1; }
        });
        renderScreen(id);
        if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
        if (moved) try { window.scrollTo(0, scrollAt[id] || 0); } catch (e) { }
    }
    // 一屏的数据出了问题,只拖垮这一屏:画一张「这一屏出错了」,其余三屏和启动照常
    function renderScreen(id) {
        const s = SCREENS.find(x => x.id === (id || current)); if (!s) return;
        const root = document.getElementById(s.id); if (!root) return;
        try {
            root.innerHTML = s.render(app);
            s.mount(root, app);
        } catch (e) {
            root.innerHTML = `<section class="sec screen-err"><h2 class="sec-t">这一屏出错了</h2><p class="lede">记录都在这台设备上，一个字没动。重新加载一次通常就好。</p>
                <p class="note">${esc((e && e.message) || String(e))}</p><div class="btn-row"><button type="button" class="btn" data-reload>重新加载</button></div></section>`;
            const b = root.querySelector('[data-reload]'); if (b) b.addEventListener('click', () => location.reload());
            try { console.error(e); } catch (x) { }
        }
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
            // 换账号:顾问本机缓存、旧照片,还有各屏模块里的半截状态(草稿、待发照片、一句话解析、今晚的「重做」)一起清
            clearLocalExtras: () => {
                try { ai.abort(); } catch (e) { }
                ai.clearLocal(); photos.clearLegacyUnprefixed();
                SCREENS.forEach(sc => { if (typeof sc.resetForUser === 'function') try { sc.resetForUser(); } catch (e) { } });
            },
            // 登录后核一次顾问开通;核成了就补「新的一天」那次今晚(核不成不再追着核;页面在后台时 tonight.js 自己会跳过,等切回来)
            onAuthUser: user => { fbUser = user || null; if (user) Promise.resolve(ai.probe()).then(() => { if (ai.ready()) tonightScreen.onAiReady(app); }, () => { }); },
            onFirstSnapshot: () => oobeOnFirstSnapshot(app),   // 新用户引导 / 改版说明(oobe.js 另有兜底:第一份快照走待推分支时这里不来)
            adoptLocalPhotos: uid => { try { photos.adoptLocal(uid); } catch (e) { } }   // 认领了本机没登录时的记录:那时的照片一起搬
        }
    });
    Object.assign(app, { store, sync, ai, photos, today, show, renderAll, renderScreen,
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
