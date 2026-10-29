// ══ 常识:写死在 App 里的固定内容(不经过顾问,离线也能看)═══════════════════════════════════
// 来源:老版「指南」页(3d55385)→ v1 顾问页底部「常识」→ 这里按 v2 的现行规则更新:
//   就医红线 = 泛红 14 天里 ≥5 天,或只冒痘 ≥10 天,且那一类最近 3 天还在;亮着时所有酸都停(温和酸也停)、眼霜照用;「看过了」才解除。
//   刷酸从零建立耐受(每周 1 次温和酸起步,按真实反应一档档加);第一晚不上任何活性;刮胡夜不上酸 / 维 A / 泥膜;新加的产品前三晚是试用期。
//   刷酸时机的手动覆盖在「设置 · 刷酸时机」。
// 每节末尾「问顾问这一条」:顾问开通了才露出来,点了跳到对话、预填一句(不自动发送,不花钱)。
// 刮胡 / HRT 两节按档案门控(feat):没开刮胡 / 没开 HRT 的人看不到(Cici 视角永远没有 Cait 的 HRT)。
import { esc, ico } from './sheets.js';

// body: 段落 = 字符串;列表 = { list: [...] }
export const GUIDE = [
    { id: 'use', head: '怎么用', body: [
        { list: [
            '「今晚」：照着做。先答一下今晚洗不洗澡、刮不刮胡，步骤会跟着变。',
            '「顾问」：现在这套方案为什么这么排、刷酸节奏、未来 7 晚（哪晚洗澡、刮胡在这里点），也能直接问顾问。顾问改了什么都直接生效，今晚页和对话里都能撤销。',
            '「记录」：随时记一笔皮肤（一句话或一张照片），往下翻是以前的记录和脸上哪里反复。',
            '「产品」：家里有什么，快用完了、用完了，要不要买新的。'] },
        { minimal: true, text: '只看今晚的用法：护肤品不用打卡，排上的默认都算用了；哪一步没做，点一下「今晚没做」。皮肤想记就点「记一下皮肤」，不记也不会催。' },
        { minimal: false, text: '记录并看变化的用法：每晚点一下做了哪几步，做完顺手记一下皮肤，「记录」页能看到走势。' }] },
    { id: 'dont', head: '这几件事别做', body: [
        { list: [
            '不要用力搓脸，不要用磨砂。',
            '皮肤刺痛、发红的时候，当天跳过酸，只洗脸、保湿、修护。',
            '设置里选了「要避开的区域」（比如人中、鼻下有红疹的那一块），那里不涂酸、不敷面膜。',
            '刷酸期别同时换好几样新东西，出了问题分不清是谁。'] }] },
    { id: 'doctor', head: '什么时候该看医生', body: [
        '近两周记了泛红 5 天以上，或者冒痘 10 天以上，而且那一类最近 3 天还在，今晚页会亮就医提醒。一颗痘从冒出来到消下去拖三四天很正常，所以单看痘要拖得更久才算。',
        '亮着的时候所有酸都停，温和的也停；眼霜照用，眼周不在泛红范围里。看过医生点「看过了」才解除，之后从每周 1 次重新开始。',
        '嘴周、鼻下成片的小红疹反复两三周不好，或者越来越多，去看 GP。这类问题往往越折腾越糟，不是多用产品能解决的。'] },
    { id: 'acid', head: '刷酸从哪起步', body: [
        '以前没怎么用过酸，就是还没有耐受史，不是「耐受好」。从每周 1 次温和酸（杏仁酸、乳酸）起步，每次刷完盯两天：没有泛红、刺痛、新冒痘，才往上加一档，别一步到位。',
        '任何一次刷完泛红过夜，退回上一档。猛一点的酸（比如高浓度甘醇酸）等皮肤连续稳 4 周以后再评估。',
        '新用户的第一晚不上任何活性（酸、面膜、维 A），先看皮肤对基础的几样有没有反应。'] },
    { id: 'spf', head: '防晒', body: [
        '刷酸期第二天早上一定要防晒，阴天也要。刷完酸不防晒，痘印会更深、更容易泛红。'] },
    { id: 'shower', head: '洗澡夜与刷酸时机', body: [
        '热水澡后皮肤确实更「通透」，但那是屏障被短暂削弱（水温 41°C 泡 10 分钟后经皮水分流失翻倍、泛红上升），不等于「增效」。',
        '易泛红、敏感的人避开刚洗完热水澡的时候刷酸；不敏感的人这条影响不大。想手动定，在「设置 · 刷酸时机」里选。'] },
    { id: 'rest', head: '非洗澡夜', body: [
        '屏障修复的主要时段。微温水、温和的洁面简单洗，修护为主。'] },
    { id: 'shave', feat: 'shave', head: '刮胡 = 机械性去角质', body: [
        '刮完皮肤上有看不见的小破口，酸会刺，也更容易泛红。所以刮胡那晚跳过所有酸、维 A 和泥膜，排好的酸会自动挪到别的晚上。',
        '刮完先凉水冲一下，全脸薄涂修护霜，这一步不能省。'] },
    { id: 'order', head: '叠涂顺序', body: [
        { list: [
            '从稀到稠（晚上）：洁面，刷酸，精华，眼霜，面霜或乳液，修护霜或油；早上最后加防晒。',
            '酸之后直接保湿。不必等「pH 恢复」：皮肤自身缓冲很快，皮科指南建议去角质后立即保湿。',
            '修护霜放最后封层：质地厚的会挡住后面的成分。'] }] },
    { id: 'new', head: '新产品怎么加进来', body: [
        '新加的产品前三晚是试用期：先薄涂一层，避开正在发红、破皮的地方；没有刺痛或加重，再全脸用。一次只加一样。'] },
    { id: 'hrt', feat: 'hrt', head: 'HRT 和长痘', body: [
        '进入 E2 周期后，雌激素波动，前 3 到 6 个月可能有一段爆发期。激素变化那几天，下巴和下颌线容易冒痘：这类痘跟着周期走，刷酸压不住，也不该为它加酸。',
        { list: [
            '突然连续长痘：酸降到每周 1 次甚至先停，只在痘上点涂。',
            '面油先停（如果有）。',
            '晚上缩成基础的几样：洁面、保湿、修护霜点涂。'] }] }
];

// 按档案过滤:feat 门控 + 按模式选那一段「怎么用」
export function guideFor(profile) {
    const P = profile || {}, minimal = !!P.minimalMode;
    return GUIDE.filter(g => !(g.feat === 'shave' && !P.shaving) && !(g.feat === 'hrt' && !P.hrt))
        .map(g => Object.assign({}, g, { body: g.body.filter(b => !(b && typeof b === 'object' && 'minimal' in b && b.minimal !== minimal)).map(b => (b && typeof b === 'object' && 'text' in b) ? b.text : b) }));
}
export function guideAskText(g) { return '这条「' + g.head + '」对我现在意味着什么？'; }

// 展开哪一节:模块里记着,重画不丢(一次只开一节)
let _open = '';
export function renderGuide(profile, opts) {
    opts = opts || {};
    const list = guideFor(profile);
    const body = b => typeof b === 'string' ? `<p class="note">${esc(b)}</p>` : `<ul class="list note">${(b.list || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return `<div class="g-wrap" id="adv-guide">
        <div class="sec-h"><h2 class="sec-t">常识</h2><span class="note faint">写死在 App 里，离线也能看</span></div>
        ${list.map(g => {
            const on = _open === g.id;
            return `<div class="g-sec" data-g="${esc(g.id)}">
                <button type="button" class="g-head" aria-expanded="${on}" aria-controls="g-b-${esc(g.id)}" data-gtoggle="${esc(g.id)}"><span>${esc(g.head)}</span>${ico('chev', 'sm g-chev')}</button>
                <div class="g-body" id="g-b-${esc(g.id)}"${on ? '' : ' hidden'}>${g.body.map(body).join('')}
                    ${opts.canAsk ? `<button type="button" class="btn-link sm g-ask" data-gask="${esc(g.id)}">问顾问这一条</button>` : ''}</div>
            </div>`;
        }).join('')}
    </div>`;
}
// onAsk(text):调用方负责跳到对话、预填
export function bindGuide(root, profile, onAsk) {
    const list = guideFor(profile);
    root.querySelectorAll('[data-gtoggle]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.gtoggle;
        _open = _open === id ? '' : id;
        root.querySelectorAll('.g-sec').forEach(sec => {
            const on = sec.dataset.g === _open;
            const h = sec.querySelector('.g-head'), bd = sec.querySelector('.g-body');
            if (h) h.setAttribute('aria-expanded', on ? 'true' : 'false');
            if (bd) bd.hidden = !on;
        });
    }));
    root.querySelectorAll('[data-gask]').forEach(b => b.addEventListener('click', () => {
        const g = list.find(x => x.id === b.dataset.gask);
        if (g && onAsk) onAsk(guideAskText(g));
    }));
}
