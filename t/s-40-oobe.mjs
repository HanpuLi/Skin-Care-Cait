// 新用户引导里选「现在有发红刺痛」:记进今天(泛红 + 敏感),安全闸当晚就生效(今晚不上酸,页面说为什么)。
// v2 迁移(P3):v1 这个文件的其余断言都已有新家(见 t/run.mjs 的退役说明):空货架起步、一屏一问、按顺序走、没登录跳过邀请码、每屏能下一步 / 跳过、
//   进度存档、加了的列出来、做完记 onboarded + 模式、第一晚不上活性(刚加的酸也不排)、再打开不引导不弹导览、老账号不进引导、改版说明弹一次
//   → t/v2-b-oobe.mjs;第一晚的闸 → engine-unit。这里只留 v2-b-oobe 没走到的「有发红刺痛」那条安全输入。
import { createStore } from '../js/store.js';
import { buildWorld } from '../js/model/world.js';
import { safetyGate } from '../js/engine/gate.js';
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const ENV = `(()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('sk_sync_v1:'));const k=ks.find(x=>x!=='sk_sync_v1:')||ks[0];return JSON.parse(localStorage.getItem(k)).data})()`;
export default async function ({ origin, S, open }) {
    const p = await open();
    await p.nav(origin + '/index.html', 200);
    await p.eval(`return __seed.fresh()`);
    await p.reload(300);
    await p.waitFor(`!!document.getElementById('oobe')`, 5000);
    const ob = a => p.eval(`document.querySelector('#oobe [data-ob="${a}"]').click();${W8(250)}const o=document.querySelector('#oobe .ob');return o?o.dataset.step:''`);
    await ob('local'); await ob('mode-full');
    // 加两样基础的 + 一支酸(手动加:先选这是什么,再填名字)
    for (const [role, name] of [['cleanse', '测试洁面'], ['moist', '测试保湿'], ['acid', '测试杏仁酸 mandelic']]) {
        await p.eval(`document.querySelector('#oobe [data-ob="add"]').click();${W8(200)}document.querySelector('#add-sheet [data-role="${role}"]').click();${W8(200)}
            const n=document.querySelector('#edit-sheet input[type=text]');n.value=${JSON.stringify(name)};n.dispatchEvent(new Event('input'));
            document.querySelector('#edit-sheet .sheet-actions .btn-primary').click();${W8(250)}return 1`);
    }
    const st = await ob('next');
    S.ok(st === 'skin', '加好货架 → 「你的皮肤」', st);
    const r = await p.eval(`document.querySelector('#oobe [data-ob="state-irritated"]').click();${W8(250)}
        const e=(${ENV}.sk_jrnl1||[]).find(x=>x.date===__d(0))||{};return {st:e.status||[],note:(document.querySelector('#oobe .ob')||{}).innerText||'',pressed:document.querySelector('#oobe [data-ob="state-irritated"]').getAttribute('aria-checked')}`);
    S.ok(r.st.indexOf('泛红') >= 0 && r.st.indexOf('敏感') >= 0 && r.pressed === 'true' && /酸先不上/.test(r.note), '引导里选「有发红刺痛」:记进今天(泛红 + 敏感),当场说「这几晚酸先不上」', r);
    await ob('next'); await ob('finish');
    const t = await p.eval(`${W8(300)}document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());const m=document.getElementById('tn-more');if(m)m.open=true;
        return {kinds:[...document.querySelectorAll('#tn-plan [data-kind]')].map(x=>x.dataset.kind),names:[...document.querySelectorAll('#tn-plan .step-name')].map(x=>x.textContent),
            say:document.getElementById('tn-lead').textContent+' '+[...document.querySelectorAll('#tonight .note-caution')].map(x=>x.innerText).join(' ')}`);
    S.ok(t.kinds.length >= 2 && t.kinds.every(k => k !== 'acid' && k !== 'mask' && k !== 'retinol') && !t.names.some(n => /杏仁酸/.test(n)), '今晚不上酸(货架上有也不排)', t);
    // 第一晚本来就不上活性;要确认的是「刺激」这道闸真的亮了:把这台设备的存储原样搬进 node 里的假 localStorage,问引擎
    const dump = await p.eval(`const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);o[k]=localStorage.getItem(k)}return {o,today:__d(0)}`);
    const m = new Map(Object.entries(dump.o));
    const LS = { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    const g = safetyGate(buildWorld(createStore({ localStorage: LS }).open(), { today: dump.today }));
    S.ok(g.irritated === true && g.acidCapMax === 0, '安全闸当晚就生效:今天记了泛红 + 敏感 → 刺激闸亮,酸上限 0', { irritated: g.irritated, cap: g.acidCapMax, notes: g.notes });
    S.ok(!p.errors.length, '有发红刺痛 0 报错', p.errors);
}
