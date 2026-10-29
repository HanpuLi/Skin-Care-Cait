// 两种模式 + 新用户都能加载、0 报错、不白屏;四屏都画得出来。
// v2 迁移(P3):等待条件改成 <html data-boot="ok">;「ai.js 加载了」改成「四屏都画出来了」(v2 没有单独的 ai.js,
//   顾问层是 js/ai/*.js,跟 App 一起 import;模块加载失败整页起不来,s-00 的「0 报错 + 不白屏」就是那条的新形状)。
export default async function ({ origin, S, open }) {
    for (const who of ['full', 'minimal', 'fresh']) {
        const p = await open();
        await p.nav(origin + '/index.html', 300);
        await p.eval(`return __seed.${who}()`);
        await p.reload(1200);
        const r = await p.eval(`const out={tn:(document.getElementById('tonight').innerText||'').length,h:(document.getElementById('tonight-h')||{}).textContent||'',
                minimal:document.body.classList.contains('minimal'),screens:{}};
            document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());   // 新用户的引导 sheet 先拿掉,只看底下四屏
            for (const id of ['advisor','record','products','tonight']) {
                const t=document.getElementById('tab-'+id); if(!t||t.offsetParent===null){out.screens[id]='hidden';continue;}
                t.click(); await new Promise(r=>setTimeout(r,150));
                const sec=document.getElementById(id); out.screens[id]=sec.classList.contains('active')&&(sec.innerText||'').trim().length>10&&!!sec.querySelector('h1');
            }
            return out`);
        S.ok(p.errors.length === 0, `${who}:加载 0 报错`, p.errors);
        S.ok(r.tn > 20 && /^今晚 · \S/.test(r.h), `${who}:今晚页有内容(不白屏),标题「今晚 · …」`, r);
        S.ok(Object.values(r.screens).every(v => v === true), `${who}:四屏都画得出来(顾问层模块跟着 App 一起加载)`, r.screens);
        S.ok(r.minimal === (who === 'minimal'), `${who}:模式 class 对`, r.minimal);
        S.ok(!p.errors.length, `${who}:切完四屏 0 报错`, p.errors);
    }
}
