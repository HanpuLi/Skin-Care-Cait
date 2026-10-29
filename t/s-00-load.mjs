// 两种模式都能加载、0 报错;后端连不上不白屏
export default async function ({ origin, S, open }) {
    for (const who of ['full', 'minimal', 'fresh']) {
        const p = await open();
        await p.nav(origin + '/index.html', 300);
        await p.eval(`return __seed.${who}()`);
        await p.reload(1500);
        const r = await p.eval(`return {
            steps: document.querySelectorAll('#tn-steps .tn-step, #tn-steps [data-step]').length,
            tnText: (document.getElementById('tonight')||{}).innerText ? document.getElementById('tonight').innerText.length : 0,
            coach: typeof renderCoach === 'function',
            minimal: document.body.classList.contains('minimal')
        }`);
        S.ok(p.errors.length === 0, `${who}:加载 0 报错`, p.errors);
        S.ok(r.tnText > 50, `${who}:今晚页有内容(不白屏)`, r);
        S.ok(r.coach, `${who}:ai.js 加载了`, r);
    }
}
