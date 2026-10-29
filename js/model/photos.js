// ══ 照片:只存本机 IndexedDB(库 SkincarePhotos / 表 photos),不进云 ═════════════════════════════
// key = 「uid__日期」(keyPath 仍叫 'date',和 v1 同一个库、同一种 key):两个账号的照片天然隔离,换账号不删别人的。
// v2 的拍照全套分析一天三张(正 / 左 / 右):key = 「uid__日期__front|left|right」;只有结构化结果进 sk_jrnl1 的 photoAssess。
// 换账号只清「未加账号前缀的旧照片」(旧版直接清空整库 → 上一个人的照片被永久删)。
export const PHOTO_DB = 'SkincarePhotos';
export const PHOTO_VIEWS = ['front', 'left', 'right'];
export function createPhotoStore(env) {
    const idb = env.indexedDB;
    let db = null;
    const uid = () => (env.uid && env.uid()) || 'local';
    const keyOf = (date, view) => uid() + '__' + date + (view ? '__' + view : '');
    function open() {
        return new Promise(res => {
            if (db) return res(db);
            if (!idb) return res(null);
            let req;
            try { req = idb.open(PHOTO_DB, 1); } catch (e) { return res(null); }
            req.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'date' }); };
            req.onsuccess = e => { db = e.target.result; res(db); };
            req.onerror = () => res(null);
        });
    }
    async function save(date, dataUrl, view) {
        const d = await open(); if (!d) return false;
        return new Promise(res => { const tx = d.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ date: keyOf(date, view), dataUrl }); tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
    }
    async function get(date, view) {
        const d = await open(); if (!d) return null;
        return new Promise(res => {
            const st = d.transaction('photos', 'readonly').objectStore('photos');
            const r = st.get(keyOf(date, view));
            r.onsuccess = () => {
                if (r.result) return res(r.result.dataUrl);
                if (view) return res(null);
                const old = st.get(date);   // 兼容旧数据(未加前缀时存的裸日期 key)
                old.onsuccess = () => res(old.result ? old.result.dataUrl : null); old.onerror = () => res(null);
            };
            r.onerror = () => res(null);
        });
    }
    async function clearLegacyUnprefixed() {
        const d = await open(); if (!d) return;
        return new Promise(res => {
            try {
                const tx = d.transaction('photos', 'readwrite'), st = tx.objectStore('photos'), r = st.getAllKeys();
                r.onsuccess = () => (r.result || []).forEach(k => { if (String(k).indexOf('__') === -1) st.delete(k); });
                tx.oncomplete = () => res(); tx.onerror = () => res();
            } catch (e) { res(); }
        });
    }
    return { open, save, get, clearLegacyUnprefixed, keyOf };
}
