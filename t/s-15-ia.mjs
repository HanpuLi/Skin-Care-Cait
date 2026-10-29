// 信息架构(Cait 10/29「就这么做」,v2 按样稿继承):
//   页头印章不压标题行(390 / 375 / 320 宽 + 刘海安全区,getBoundingClientRect 不相交),页头贴顶、正文在下面滚;
//   今晚的情况:问句开关 + 点了即时说影响(从点之前 / 之后的真实排班比出来),不写被证据推翻的「洗完澡适合刷酸」;
//   四个 tab(极简模式默认也有「记录」);空货架时今晚页和顾问页说怎么开始。
// v2 迁移(P3):等待条件 <html data-boot="ok">;印章字在档案 seal(和 v1 同一个字段);问句是 #tn-q-shower / #tn-q-shave 的按钮组(aria-pressed),
//   不是 v1 的 switch;影响那一句在 #tn-fx-*。退役 / 挪走的断言见 t/run.mjs:
//   提醒卡 / 完成流程 / 极简记一下皮肤 → t/v2-a-tonight.mjs;记录页 → t/v2-a-record.mjs;顾问页离线方案与顺序 → t/v2-b-advisor.mjs;
//   「极简 + 没开刮胡:只问洗澡」→ 样稿 Cici 版今晚页不问(按每周习惯,在顾问页「未来 7 晚」改),退役。
const W8 = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const BAD_CLAIM = /适合刷酸|适合刷|渗透|正好刷酸|皮肤软|角质软/;
export default async function ({ origin, S, open }) {
    const boot = async (seed, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${seed}`);
        await p.reload(800);
        return p;
    };

    // ── 1. 印章不压标题行:三种 iPhone 宽 × 刘海安全区,印章整个落在页头里,和今晚页所有控件都不相交 ──
    for (const width of [390, 375, 320]) {
        const p = await boot(`full({profile:{seal:'膚'}})`, { page: { width } });
        const r = await p.eval(`document.documentElement.style.setProperty('--safe-top','59px');document.getElementById('tab-tonight').click();${W8(150)}
            const R=el=>el.getBoundingClientRect();const seal=R(document.getElementById('btn-settings')),hdr=R(document.querySelector('.hdr'));
            const vis=el=>{const b=el.getBoundingClientRect();if(!b.width||!b.height)return false;for(let e=el;e;e=e.parentElement){if(getComputedStyle(e).display==='none')return false}return true};
            const hit=b=>b.left<seal.right-0.5&&seal.left<b.right-0.5&&b.top<seal.bottom-0.5&&seal.top<b.bottom-0.5;
            const ctl=[document.getElementById('tonight-h'),...document.querySelectorAll('#tonight button,#tonight input,#tonight label,#tonight summary')].filter(vis);
            const bad=ctl.filter(el=>hit(R(el))).map(el=>(el.id||el.className||el.tagName)+' '+el.textContent.trim().slice(0,10));
            return {bad,n:ctl.length,seal:document.getElementById('seal-ch').textContent,inHdr:seal.top>=hdr.top-0.5&&seal.bottom<=hdr.bottom+0.5,hdrBottom:Math.round(hdr.bottom),
                titleTop:Math.round(R(document.getElementById('tonight-h')).top),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
                q:[...document.querySelectorAll('#tn-sit .sit-q')].filter(vis).map(x=>Math.round(R(x).top))}`);
        S.ok(r.n > 5 && !r.bad.length && r.seal === '膚', `${width} 宽 + 安全区 59px:印章和标题、问句、步骤等 ${r.n} 个控件都不相交`, r);
        S.ok(r.inHdr && r.titleTop >= r.hdrBottom, `${width} 宽:印章整个落在页头高度内,标题在页头下面`, r);
        S.ok(r.overflow <= 0, `${width} 宽:没有横向滚动`, r.overflow);
        if (width === 320) S.ok(r.q.length === 2, '320 宽:两个问句都在(放不下就折成两行)', r.q);
        // 往下滚:页头贴顶(样稿「真机一屏,正文在页头下面滚」)
        const st = await p.eval(`scrollTo(0,600);${W8(80)}const h=document.querySelector('.hdr').getBoundingClientRect();const r={top:Math.round(h.top),pos:getComputedStyle(document.querySelector('.hdr')).position,y:Math.round(scrollY)};scrollTo(0,0);return r`);
        S.ok(st.y > 0 && st.top === 0 && st.pos === 'sticky', `${width} 宽:往下滚时页头(日期 + 印章)贴在顶上`, st);
        S.ok(!p.errors.length, `${width} 宽:0 报错`, p.errors);
    }

    // ── 2. 今晚的情况:问句;点了之后一句话说影响;不写被推翻的说法;记住了(刷新还在)──
    {
        const p = await boot(`full()`);
        const q = await p.eval(`return [document.getElementById('tn-ql-shower'),document.getElementById('tn-ql-shave')].map(x=>x&&x.textContent)`);
        S.ok(JSON.stringify(q) === JSON.stringify(['今晚洗澡吗？', '今晚刮胡吗？']), '开关是问句「今晚洗澡吗?」「今晚刮胡吗?」', q);
        const r0 = await p.eval(`return {acid:/刷酸夜/.test(document.getElementById('tonight-h').textContent),pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed')}`);
        const r = await p.eval(`document.getElementById('tn-shave-y').click();${W8(150)}
            return {txt:document.getElementById('tn-fx-shave').textContent,changed:document.getElementById('tn-fx-shave').classList.contains('changed'),title:document.getElementById('tonight-h').textContent,
                pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed'),steps:[...document.querySelectorAll('#tn-plan [data-kind]')].map(x=>x.dataset.kind)}`);
        S.ok(r0.pressed === 'false' && r.changed && /^刮胡夜：/.test(r.txt) && r.pressed === 'true', '点「刮」:下面即时一句影响,按钮 aria-pressed', r);
        S.ok(!r0.acid || (/酸今晚不上/.test(r.txt) && r.steps.indexOf('acid') < 0), '刷酸夜点刮胡:说「酸今晚不上」,步骤里真没有酸', r);
        S.ok(/刮完先用凉水冲/.test(r.txt) && r.title === '今晚 · 刮胡夜', '刮胡夜:标题变刮胡夜,说刮完先用凉水冲', r);
        const r2 = await p.eval(`document.getElementById('tn-shave-n').click();${W8(150)}return {txt:document.getElementById('tn-fx-shave').textContent,title:document.getElementById('tonight-h').textContent}`);
        S.ok(/^今晚不刮：/.test(r2.txt) && r2.title !== '今晚 · 刮胡夜', '再点「不刮」:照样说影响,标题回到原来的夜型', r2);
        const sh0 = await p.eval(`return document.getElementById('tn-shower-y').getAttribute('aria-pressed')==='true'`);
        const r3 = await p.eval(`document.getElementById(${sh0 ? "'tn-shower-n'" : "'tn-shower-y'"}).click();${W8(150)}return {t:document.getElementById('tn-fx-shower').textContent,lead:document.getElementById('tn-lead').textContent}`);
        S.ok(/^(洗澡夜|今晚不洗澡)：/.test(r3.t) && /。$/.test(r3.t), '点「今晚洗澡吗」:说影响(洁面换了就说换成哪支;没影响说「今晚步骤不变」)', r3);
        const r4 = await p.eval(`document.getElementById(${sh0 ? "'tn-shower-y'" : "'tn-shower-n'"}).click();${W8(150)}return {t:document.getElementById('tn-fx-shower').textContent,lead:document.getElementById('tn-lead').textContent,page:document.getElementById('tonight').innerText}`);
        S.ok(!BAD_CLAIM.test(r.txt + r2.txt + r3.t + r3.lead + r4.t + r4.lead + r4.page), '不写「洗澡后适合刷酸 / 皮肤软正好刷酸」这种被证据推翻的说法(常识页「洗澡夜与刷酸时机」)', [r3.t, r3.lead, r4.t, r4.lead]);
        // 洗澡夜重开:这一屏还没点过,问句下面是默认那一句(刷酸夜 + 洗澡时最容易写出「适合刷酸」)
        await p.eval(`document.getElementById('tn-shower-y').click();${W8(150)}return 1`);
        await p.reload(600);
        const dflt = await p.eval(`return {on:document.getElementById('tn-shower-y').getAttribute('aria-pressed'),acid:/刷酸夜/.test(document.getElementById('tonight-h').textContent),fx:document.getElementById('tn-fx-shower').textContent,page:document.getElementById('tonight').innerText}`);
        S.ok(dflt.on === 'true' && !BAD_CLAIM.test(dflt.page), '洗澡夜重开(显示默认那一句):也不写「洗完澡适合刷酸」' + (dflt.acid ? '(今晚是刷酸夜)' : ''), { fx: dflt.fx, acid: dflt.acid });
        // 刮胡写进今天的排班:刷新还在
        await p.eval(`document.getElementById('tn-shave-y').click();${W8(150)}return 1`);
        await p.reload(600);
        const kept = await p.eval(`return {title:document.getElementById('tonight-h').textContent,pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed')}`);
        S.ok(kept.title === '今晚 · 刮胡夜' && kept.pressed === 'true', '点过的今晚情况写进当天排班:刷新还在', kept);
        S.ok(!p.errors.length, '今晚的情况 0 报错', p.errors);
    }
    // ── 3. 「洗澡夜优先」这条也不说「适合刷」(只说是设置里选的)──
    {
        const p = await boot(`full({profile:{acidTiming:'prefer'}})`);
        const txt = await p.eval(`const a=[];for(const id of ['tn-shower-y','tn-shower-n','tn-shower-y']){const b=document.getElementById(id);if(b){b.click();${W8(120)}a.push(document.getElementById('tn-fx-shower').textContent,document.getElementById('tn-lead').textContent)}}return a.join(' | ')`);
        S.ok(!BAD_CLAIM.test(txt), '设置选了「洗澡夜优先」:影响那一句也不写「适合刷」', txt);
    }

    // ── 4. 四个 tab;极简模式默认也有「记录」──
    for (const who of ['full', 'minimal']) {
        const p = await boot(`${who}()`);
        const r = await p.eval(`return [...document.querySelectorAll('.tab')].filter(t=>getComputedStyle(t).display!=='none').map(t=>t.textContent.trim())`);
        S.ok(JSON.stringify(r) === JSON.stringify(['今晚', '顾问', '记录', '产品']), `${who}:四个 tab 今晚 / 顾问 / 记录 / 产品(极简默认也显示记录)`, r);
    }

    // ── 5. 空货架:今晚页只说货架空、不问洗澡;顾问页方案段说怎么开始 ──
    {
        const p = await boot(`fresh()`);
        const r = await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());
            const tn={sit:!!document.getElementById('tn-sit'),empty:(document.getElementById('tn-empty')||{}).textContent||''};
            document.getElementById('tab-advisor').click();${W8(200)}
            return Object.assign(tn,{adv:document.getElementById('advisor').innerText})`);
        S.ok(!r.sit && /货架还是空的/.test(r.empty) && /去「产品」添加/.test(r.empty), '空货架:今晚页不问洗澡 / 刮胡,只说货架空、去「产品」添加', r);
        S.ok(/还没有方案/.test(r.adv) && /「产品」/.test(r.adv), '空货架:顾问页方案段说怎么开始', r.adv.slice(0, 160));
        S.ok(!p.errors.length, '空货架 0 报错', p.errors);
    }
}
