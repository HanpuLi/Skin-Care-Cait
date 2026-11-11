// 信息架构(Cait 10/29「就这么做」,v2 按样稿继承):
//   页头印章不压标题行(390 / 375 / 320 宽 + 刘海安全区,getBoundingClientRect 不相交),页头贴顶、正文在下面滚;
//   今晚的情况:问句开关 + 点了即时说影响(从点之前 / 之后的真实排班比出来),不写被证据推翻的「洗完澡适合刷酸」;
//   四个 tab(极简模式默认也有「记录」);空货架时今晚页和顾问页说怎么开始。
// v2 迁移(P3):等待条件 <html data-boot="ok">;印章字在档案 seal(和 v1 同一个字段);问句是 #tn-q-shower / #tn-q-shave 的按钮组(aria-pressed),
//   不是 v1 的 switch;影响那一句在 #tn-fx-*。退役 / 挪走的断言见 t/run.mjs:
//   提醒卡 / 完成流程 / 极简记一下皮肤 → t/v2-a-tonight.mjs;记录页 → t/v2-a-record.mjs;顾问页离线方案与顺序 → t/v2-b-advisor.mjs;
//   「极简 + 没开刮胡:只问洗澡」→ 样稿 Cici 版今晚页不问(按每周习惯,在顾问页「未来 7 晚」改),退役。
// 2.3.0(11/10):洗澡问句 #tn-q-shower 换成洗澡模块 #tn-shower(ui/shower.js,隔几天洗);页头的洗澡胶囊删了,页头只有日期和印章;
//   无衬线的页头 / 标签栏是实心的(没有 backdrop-filter、不透底,第 6 段量)。刮胡问句照旧。
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
                q:[...document.querySelectorAll('#tn-sit .sit-q,#tn-shower')].filter(vis).map(x=>Math.round(R(x).top)),
                hdrKids:[...document.querySelector('.hdr').children].filter(vis).map(x=>x.id),shBtn:!!document.getElementById('btn-shower')}`);
        S.ok(r.n > 5 && !r.bad.length && r.seal === '膚', `${width} 宽 + 安全区 59px:印章和标题、问句、步骤等 ${r.n} 个控件都不相交`, r);
        S.ok(r.inHdr && r.titleTop >= r.hdrBottom, `${width} 宽:印章整个落在页头高度内,标题在页头下面`, r);
        S.ok(r.overflow <= 0, `${width} 宽:没有横向滚动`, r.overflow);
        if (width === 320) S.ok(r.q.length === 2, '320 宽:洗澡模块和刮胡问句都在(放不下就折成两行)', r.q);
        S.ok(!r.shBtn && JSON.stringify(r.hdrKids) === JSON.stringify(['hdr-date', 'btn-settings']), `${width} 宽:页头只有日期和印章(洗澡胶囊删了,洗澡只在今晚页的模块)`, r.hdrKids);
        // 往下滚:页头贴顶(样稿「真机一屏,正文在页头下面滚」)
        const st = await p.eval(`scrollTo(0,600);${W8(80)}const h=document.querySelector('.hdr').getBoundingClientRect();const r={top:Math.round(h.top),pos:getComputedStyle(document.querySelector('.hdr')).position,y:Math.round(scrollY)};scrollTo(0,0);return r`);
        S.ok(st.y > 0 && st.top === 0 && st.pos === 'sticky', `${width} 宽:往下滚时页头(日期 + 印章)贴在顶上`, st);
        S.ok(!p.errors.length, `${width} 宽:0 报错`, p.errors);
    }

    // ── 2. 今晚的情况:问句;点了之后一句话说影响;不写被推翻的说法;记住了(刷新还在)──
    {
        const p = await boot(`full()`);
        const q = await p.eval(`return {shave:(document.getElementById('tn-ql-shave')||{}).textContent,shQ:!!document.getElementById('tn-q-shower'),sh:(document.getElementById('tn-shower')||{dataset:{}}).dataset.st}`);
        S.ok(q.shave === '今晚刮胡吗？' && !q.shQ && q.sh === 'none', '刮胡还是问句「今晚刮胡吗?」;洗澡不再问,是洗澡模块(这颗种子还没排)', q);
        const r0 = await p.eval(`return {acid:/刷酸夜/.test(document.getElementById('tonight-h').textContent),pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed')}`);
        const r = await p.eval(`document.getElementById('tn-shave-y').click();${W8(150)}
            return {txt:document.getElementById('tn-fx-shave').textContent,changed:document.getElementById('tn-fx-shave').classList.contains('changed'),title:document.getElementById('tonight-h').textContent,
                pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed'),steps:[...document.querySelectorAll('#tn-plan [data-kind]')].map(x=>x.dataset.kind)}`);
        S.ok(r0.pressed === 'false' && r.changed && /^刮胡夜：/.test(r.txt) && r.pressed === 'true', '点「刮」:下面即时一句影响,按钮 aria-pressed', r);
        S.ok(!r0.acid || (/酸今晚不上/.test(r.txt) && r.steps.indexOf('acid') < 0), '刷酸夜点刮胡:说「酸今晚不上」,步骤里真没有酸', r);
        S.ok(/刮完先用凉水冲/.test(r.txt) && r.title === '今晚刮胡夜', '刮胡夜:标题变刮胡夜,说刮完先用凉水冲', r);
        const r2 = await p.eval(`document.getElementById('tn-shave-n').click();${W8(150)}return {txt:document.getElementById('tn-fx-shave').textContent,title:document.getElementById('tonight-h').textContent}`);
        S.ok(/^今晚不刮：/.test(r2.txt) && r2.title !== '今晚刮胡夜', '再点「不刮」:照样说影响,标题回到原来的夜型', r2);
        // 洗澡:模块里先排「每天」(今晚该洗),再点「今晚不洗」(改到明晚);两种情况下标题那句和整页都不写被推翻的说法
        const SH = `const c=document.getElementById('tn-shower');return {st:c.dataset.st,t:c.textContent,lead:document.getElementById('tn-lead').textContent,page:document.getElementById('tonight').innerText}`;
        const r3 = await p.eval(`document.querySelector('#tn-shower [data-sh=every][data-n="1"]').click();${W8(200)}${SH}`);
        S.ok(r3.st === 'due' && /今晚洗澡/.test(r3.t) && /每天/.test(r3.t), '洗澡模块:选「每天」→ 今晚洗澡', r3);
        const r4 = await p.eval(`document.getElementById('sh-act').click();${W8(200)}${SH}`);
        S.ok(r4.st === 'skip' && /今晚不洗，改到明晚/.test(r4.t), '点「今晚不洗」:写明改到明晚', r4);
        S.ok(!BAD_CLAIM.test(r.txt + r2.txt + r3.lead + r3.page + r4.lead + r4.page), '不写「洗澡后适合刷酸 / 皮肤软正好刷酸」这种被证据推翻的说法(常识页「洗澡夜与刷酸时机」)', [r3.lead, r4.lead]);
        // 洗澡夜重开(刷酸夜 + 洗澡时最容易写出「适合刷酸」)
        await p.eval(`document.getElementById('sh-act').click();${W8(200)}return 1`);
        await p.reload(600);
        const dflt = await p.eval(`return {st:document.getElementById('tn-shower').dataset.st,acid:/刷酸夜/.test(document.getElementById('tonight-h').textContent),page:document.getElementById('tonight').innerText}`);
        S.ok(dflt.st === 'due' && !BAD_CLAIM.test(dflt.page), '洗澡夜重开:也不写「洗完澡适合刷酸」' + (dflt.acid ? '(今晚是刷酸夜)' : ''), dflt);
        // 刮胡写进今天的排班:刷新还在
        await p.eval(`document.getElementById('tn-shave-y').click();${W8(150)}return 1`);
        await p.reload(600);
        const kept = await p.eval(`return {title:document.getElementById('tonight-h').textContent,pressed:document.getElementById('tn-shave-y').getAttribute('aria-pressed')}`);
        S.ok(kept.title === '今晚刮胡夜' && kept.pressed === 'true', '点过的今晚情况写进当天排班:刷新还在', kept);
        S.ok(!p.errors.length, '今晚的情况 0 报错', p.errors);
    }
    // ── 3. 「洗澡夜优先」这条也不说「适合刷」(只说是设置里选的)──
    {
        const p = await boot(`full({profile:{acidTiming:'prefer'}})`);
        const txt = await p.eval(`const a=[],t=()=>a.push(document.getElementById('tn-shower').textContent,document.getElementById('tn-lead').textContent,document.getElementById('tn-plan').innerText);
            document.querySelector('#tn-shower [data-sh=every][data-n="1"]').click();${W8(150)}t();
            for(let i=0;i<2;i++){document.getElementById('sh-act').click();${W8(150)}t();}return a.join(' | ')`);
        S.ok(txt.length > 20 && !BAD_CLAIM.test(txt), '设置选了「洗澡夜优先」:洗澡模块、标题那句、步骤里都不写「适合刷」', txt.slice(0, 200));
    }

    // ── 4. 四个 tab;极简模式默认也有「记录」──
    for (const who of ['full', 'minimal']) {
        const p = await boot(`${who}()`);
        const r = await p.eval(`return [...document.querySelectorAll('.tab')].filter(t=>getComputedStyle(t).display!=='none').map(t=>t.textContent.trim())`);
        S.ok(JSON.stringify(r) === JSON.stringify(['今晚', '顾问', '记录', '产品']), `${who}:四个 tab 今晚 / 顾问 / 记录 / 产品(极简默认也显示记录)`, r);
    }

    // ── 6. 无衬线:页头和标签栏是实心的(11/10 Cait「所有页面cici外观模式不要模糊淡出」):每一屏、浅深色都没有 backdrop-filter,底色不透明 ──
    for (const scheme of ['light', 'dark']) {
        const p = await boot(`minimal()`, { page: { scheme } });
        await p.eval(`localStorage.setItem('sk_type','sans');return 1`);
        await p.reload(800);
        const r = await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());const out=[];
            const a=c=>{c=String(c);if(c==='transparent')return 0;const i=c.indexOf('(');if(i<0)return 1;const v=c.slice(i+1,c.lastIndexOf(')')).split(/[ ,/]+/).filter(Boolean);return v.length>3?+v[3]:1};
            for(const h of ['#/tonight','#/tonight/shower','#/advisor','#/advisor/week','#/record','#/products','#/settings']){location.hash=h;${W8(250)}
                for(const sel of ['.hdr','.tabbar']){const el=document.querySelector(sel),cs=getComputedStyle(el);const bf=cs.backdropFilter||cs.webkitBackdropFilter||'none';
                    out.push({h,sel,bf,alpha:a(cs.backgroundColor),bg:cs.backgroundColor})}}
            return {type:document.documentElement.dataset.type,out}`);
        const bad = r.out.filter(x => (x.bf && x.bf !== 'none') || x.alpha < 1);
        S.ok(r.type === 'sans' && r.out.length === 14 && !bad.length, `无衬线/${scheme}:7 个页面的页头和标签栏都是实心底、没有 backdrop-filter(内容滑到下面不透出来)`, bad.length ? bad : r.type);
        S.ok(!p.errors.length, `无衬线/${scheme}:0 报错`, p.errors);
    }

    // ── 5. 空货架:今晚页只说货架空、不问洗澡;顾问 › 现在的方案 说怎么开始 ──
    {
        const p = await boot(`fresh()`);
        const r = await p.eval(`document.querySelectorAll('#sheet-root .sheet-ov').forEach(x=>x.remove());
            const tn={sit:!!document.getElementById('tn-sit'),empty:(document.getElementById('tn-empty')||{}).textContent||''};
            document.getElementById('tab-advisor').click();${W8(200)}location.hash='#/advisor/plan';${W8(300)}
            return Object.assign(tn,{adv:document.getElementById('advisor').innerText})`);
        S.ok(!r.sit && /货架还是空的/.test(r.empty) && /去「产品」添加/.test(r.empty), '空货架:今晚页不问刮胡,只说货架空、去「产品」添加(洗澡模块不依赖货架,照样在)', r);
        S.ok(/还没有方案/.test(r.adv) && /「产品」/.test(r.adv), '空货架:顾问 › 现在的方案 说怎么开始', r.adv.slice(0, 160));
        S.ok(!p.errors.length, '空货架 0 报错', p.errors);
    }
}
