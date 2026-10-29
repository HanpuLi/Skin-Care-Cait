// ══ 脸部地图:一张纸墨线描的正脸,11 区 ══════════════════════════════════════════════════════════
// 只到区域,不做精确点;左右一律按**她自己的**左右(图上右边是她的左脸,图上标了小字「左」「右」)。
// 区名在 model/journal.js 的 FACE_ZONES(这里按 k 对上);存进当天日志的 spots:[{zone, type}](不新增云键)。
// 两种用法,同一张脸:
//   · 点选(记皮肤的 sheet):点一个区 → 下面出「是什么」(可多选)→ 写 spots
//   · 热度(记录页):近 14 天每个区标过几天,颜色越深越多;点一个区看是哪几天
// 每个区一块 SVG 形状(点得到,读屏不念)+ 一个 44×44 的真按钮(读屏念区名和标了什么)。
// 【要紧】位置**不参与**就医红线(engine/redline.js 只看状态标签),只给顾问参考。
// 纯渲染:faceHtml 返回字符串,bindFace 在挂载点上做事件委托;这个模块不碰存储。
import { FACE_ZONES, FACE_ZONE_NAMES, cleanSpots } from '../model/journal.js';
import { esc } from './sheets.js';

export const FACE_VIEWBOX = '0 0 320 400';
export const FACE_PATHS = {
    hair: 'M54 110C56 60 104 28 160 28C216 28 264 60 266 110C246 82 210 66 160 66C110 66 74 82 54 110Z',   // 发际线
    fore: 'M64 112C80 84 116 70 160 70C204 70 240 84 256 112L250 126L70 126Z',   // 额头
    cheekR: 'M54 212a38 34 0 1 0 76 0a38 34 0 1 0 -76 0Z',   // 右脸颊
    cheekL: 'M190 212a38 34 0 1 0 76 0a38 34 0 1 0 -76 0Z',   // 左脸颊
    jawR: 'M56 238C60 274 76 312 116 354L126 340C92 306 78 272 74 238Z',   // 右下颌线
    jawL: 'M264 238C260 274 244 312 204 354L194 340C228 306 242 272 246 238Z',   // 左下颌线
    peri: 'M110 286a50 30 0 1 0 100 0a50 30 0 1 0 -100 0Z',   // 口周
    chin: 'M120 344a40 24 0 1 0 80 0a40 24 0 1 0 -80 0Z',   // 下巴
    nose: 'M150 154L170 154L186 226C178 238 142 238 134 226Z',   // 鼻子
    phil: 'M136 254a24 12 0 1 0 48 0a24 12 0 1 0 -48 0Z',   // 人中/鼻下
    glab: 'M145 140a15 12 0 1 0 30 0a15 12 0 1 0 -30 0Z',   // 眉间
};
// 轮廓、耳、发际线、眉、眼、鼻、嘴:纯装饰
export const FACE_LINES = 'M160 24C226 24 272 72 272 150C272 214 260 262 236 306C212 348 188 376 160 378C132 376 108 348 84 306C60 262 48 214 48 150C48 72 94 24 160 24Z' +
            'M48 156C34 150 30 178 36 196C40 206 47 208 51 202M272 156C286 150 290 178 284 196C280 206 273 208 269 202' +
            'M102 136C114 128 134 128 146 134M174 134C186 128 206 128 218 136' +
            'M106 160C116 152 132 152 142 160C132 166 116 166 106 160ZM178 160C188 152 204 152 214 160C204 166 188 166 178 160Z' +
            'M154 150C152 180 146 204 140 220C146 230 154 228 160 232C166 228 174 230 180 220' +
            'M130 282C144 276 154 278 160 280C166 278 176 276 190 282C176 294 144 294 130 282ZM132 283C150 287 170 287 188 283';

// {区名: [类型…]}
export function spotsByZone(spots) {
    const m = {};
    cleanSpots(spots).forEach(s => { (m[s.zone] = m[s.zone] || []).push(s.type); });
    return m;
}
// from…today 之间每个区标过的日子:{区名: [{date, types[]}]}(日期降序,同一天只算一次)
export function heatData(journal, today, from) {
    const z = {}, seen = new Set();
    (journal || []).filter(e => e && e.date && e.date >= from && e.date <= today).sort((a, b) => b.date.localeCompare(a.date)).forEach(e => {
        if (seen.has(e.date)) return; seen.add(e.date);
        const by = spotsByZone(e.spots);
        Object.keys(by).forEach(n => { (z[n] = z[n] || []).push({ date: e.date, types: by[n] }); });
    });
    return z;
}
export function heatTone(n) { return !n ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4; }

// 一张脸。o = {ns, sel(选中的区名), marks{区名: 数字或''}, tone{区名: 0-4}, label{区名: 读屏文字}, hint{区名: true}(顾问建议), heat, groupLabel}
export function faceHtml(o) {
    o = o || {};
    const ns = esc(o.ns || 'fm');
    const marks = o.marks || {}, tone = o.tone || {}, label = o.label || {}, hint = o.hint || {};
    const shapes = FACE_ZONES.map(z => `<path class="fz${o.sel === z.name ? ' on' : ''}${tone[z.name] ? ' h' + tone[z.name] : ''}" data-fm-zone="${esc(z.name)}" d="${FACE_PATHS[z.k]}"/>`).join('');
    const btns = FACE_ZONES.map(z => {
        const mk = marks[z.name];
        const cls = 'fm-mk' + (mk ? ' on' : '') + (o.heat ? ' heat' : '') + (hint[z.name] && !mk ? ' hint' : '');
        return `<button type="button" class="fm-b fz-${z.k}" id="${ns}-fz-${z.k}" data-fm-zone="${esc(z.name)}" aria-pressed="${o.sel === z.name}" aria-label="${esc(label[z.name] || z.name)}">`
            + `<span class="${cls}">${mk ? esc(String(mk)) : ''}</span></button>`;
    }).join('');
    return `<div class="fm" data-fm-ns="${ns}" role="group" aria-label="${esc(o.groupLabel || '脸部地图')}">`
        + `<svg class="fm-svg" viewBox="${FACE_VIEWBOX}" aria-hidden="true">${shapes}<path class="fm-line" d="${FACE_LINES}"/>`
        + `<text class="fm-lr" x="22" y="40">右</text><text class="fm-lr" x="298" y="40" text-anchor="end">左</text></svg>${btns}</div>`;
}
// 事件委托:点区(按钮或 SVG 形状)→ onTap(区名)。挂在不会被重画的容器上,挂一次就行
export function bindFace(root, ns, onTap) {
    if (!root) return;
    root.addEventListener('click', e => {
        const t = e.target && e.target.closest && e.target.closest('[data-fm-zone]');
        if (!t) return;
        const fm = t.closest('[data-fm-ns]');
        if (!fm || fm.dataset.fmNs !== ns) return;
        const z = t.getAttribute('data-fm-zone');
        if (FACE_ZONE_NAMES.indexOf(z) >= 0) { e.preventDefault(); onTap(z); }
    });
}
