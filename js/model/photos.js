// ══ 照片:只存本机 IndexedDB(库 SkincarePhotos / 表 photos),不进云 ═════════════════════════════
// key = 「uid__日期」(keyPath 仍叫 'date',和 v1 同一个库、同一种 key):两个账号的照片天然隔离,换账号不删别人的。
// v2 的拍照全套分析一天三张(正 / 左 / 右):key = 「uid__日期__front|left|right」;只有结构化结果进 sk_jrnl1 的 photoAssess。
// 换账号只清「未加账号前缀的旧照片」(旧版直接清空整库 → 上一个人的照片被永久删)。
export const PHOTO_DB = 'SkincarePhotos';
export const PHOTO_VIEWS = ['front', 'left', 'right'];
// 【要紧】对外一律 resolve(true/false / 值 / null),不 reject:
//   · 连接被系统断开(iOS 后台久了)、版本变了 → db 置空,下次重开;事务开不了(InvalidStateError)→ 重开一次再试;
//   · 配额不够时事务以 abort 结束、onerror 不触发 → 接住 onabort,不然 save 永远不回来(界面会卡在「顾问在看照片」)。
export function createPhotoStore(env) {
    const idb = env.indexedDB;
    let db = null;
    const uid = () => (env.uid && env.uid()) || 'local';
    const keyOf = (date, view) => uid() + '__' + date + (view ? '__' + view : '');
    function drop() { try { if (db) db.close(); } catch (e) { } db = null; }
    function open() {
        return new Promise(res => {
            if (db) return res(db);
            if (!idb) return res(null);
            let req;
            try { req = idb.open(PHOTO_DB, 1); } catch (e) { return res(null); }
            req.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'date' }); };
            req.onsuccess = e => {
                db = e.target.result;
                try { db.onclose = drop; db.onversionchange = drop; } catch (x) { }
                res(db);
            };
            req.onerror = () => res(null);
            req.onblocked = () => res(null);
        });
    }
    // 开一个事务跑 fn(store, done);连接失效就重开一次再试。fail = 出错 / 中止时给的值
    async function withTx(mode, fn, fail) {
        for (let i = 0; i < 2; i++) {
            const d = await open(); if (!d) return fail;
            let tx;
            try { tx = d.transaction('photos', mode); }
            catch (e) { drop(); continue; }   // InvalidStateError:连接被断了
            return new Promise(res => {
                let out = fail, settled = false;
                const end = v => { if (!settled) { settled = true; res(v); } };
                try { fn(tx.objectStore('photos'), v => { out = v; }); } catch (e) { try { tx.abort(); } catch (x) { } return end(fail); }
                tx.oncomplete = () => end(out);
                tx.onerror = () => end(fail);
                tx.onabort = () => end(fail);
            });
        }
        return fail;
    }
    async function available() { return !!(await open()); }
    function save(date, dataUrl, view) {
        return withTx('readwrite', (st, set) => { st.put({ date: keyOf(date, view), dataUrl }); set(true); }, false);
    }
    function get(date, view) {
        return withTx('readonly', (st, set) => {
            const r = st.get(keyOf(date, view));
            r.onsuccess = () => {
                if (r.result) return set(r.result.dataUrl);
                if (view) return set(null);
                const old = st.get(date);   // 兼容旧数据(未加前缀时存的裸日期 key)
                old.onsuccess = () => set(old.result ? old.result.dataUrl : null);
            };
        }, null);
    }
    // 删掉这个账号这一天的照片(单张 + 正 / 左 / 右);裸日期 key(未加前缀的旧数据)只在没登录过的设备上(uid = local)才删
    function remove(date) {
        return withTx('readwrite', (st, set) => {
            [''].concat(PHOTO_VIEWS).forEach(v => st.delete(keyOf(date, v)));
            if (uid() === 'local') st.delete(date);
            set(true);
        }, false);
    }
    function clearLegacyUnprefixed() {
        return withTx('readwrite', st => {
            const r = st.getAllKeys();
            r.onsuccess = () => (r.result || []).forEach(k => { if (String(k).indexOf('__') === -1) st.delete(k); });
        }, undefined);
    }
    return { open, available, save, get, remove, clearLegacyUnprefixed, keyOf };
}
