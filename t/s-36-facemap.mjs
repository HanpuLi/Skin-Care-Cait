// 脸部地图(Cait 10/29):打卡里勾了问题标签才出现「标在脸上(可选)」,点开才展开(极简模式也默认收起);
// 11 个区可点(≥44)、读屏念区名;点区选类型(可多选)、能改能删,存进 sk_jrnl1 当天的 spots;顾问快照每天带 spots;
// 皮肤页近 14 天热度(深浅 + 数字,点区看哪几天);就医红线不看位置(Cait 10/29 撤掉了口周提前亮);ZONE_PRESETS 补口周 / 下颌线;0 emoji,深浅色都看得清。
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const PROBE = fs.readFileSync(path.join(DIR, 'probe.js'), 'utf8');
const ZONES = ['发际线', '额头', '眉间', '鼻子', '左脸颊', '右脸颊', '人中/鼻下', '口周', '下巴', '左下颌线', '右下颌线'];
export default async function ({ origin, S, open }) {
    const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
    const boot = async (seed, o = {}) => {
        const p = await open(o.page || {});
        await p.nav(origin + '/index.html', 200);
        await p.eval(`return __seed.${seed}`);
        await p.reload(800);
        return p;
    };
    // jrnl 生成器:days = {相对天数: {status:[], spots:[[区,类型],...]}}
    const J = days => '[' + Object.entries(days).map(([i, d]) => `{date:__d(${i}),status:${JSON.stringify(d.status || [])},products:[],note:'',phase:''${d.spots ? ',spots:' + JSON.stringify(d.spots.map(([zone, type]) => ({ zone, type }))) : ''}}`).join(',') + ']';
    const TODAY = `today()`;

    // ── 打卡里的入口 + 点选存取 ──
    {
        const p = await boot(`full({today:true,status:i=>i===0?['爆痘']:['出油']})`);
        const r0 = await p.eval(`const b=[...document.querySelectorAll('#tn-skin .fm-entry button')][0];return {btn:b&&b.textContent,exp:b&&b.getAttribute('aria-expanded'),fm:!!document.querySelector('#tn-skin .fm')}`);
        S.ok(/标在脸上（可选）/.test(r0.btn || '') && r0.exp === 'false' && !r0.fm, '勾了新痘:出现「标在脸上(可选)」,默认收起(不点照常打卡)', r0);
        const r1 = await p.eval(`document.querySelector('#tn-skin .fm-entry button').click();${wait(50)}const bs=[...document.querySelectorAll('#tn-skin .fm-b')];
            return {n:bs.length,labels:bs.map(b=>b.getAttribute('aria-label')),sizes:bs.map(b=>{const r=b.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)}),
                lr:[...document.querySelectorAll('#tn-skin .fm-lr')].map(t=>t.textContent),exp:document.querySelector('#tn-skin .fm-entry button').getAttribute('aria-expanded'),
                shapes:[...document.querySelectorAll('#tn-skin .fz')].map(x=>x.dataset.zone),
                overlap:(()=>{const rs=bs.map(b=>b.getBoundingClientRect());let n=0;for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],c=rs[j];if(a.left<c.right-1&&c.left<a.right-1&&a.top<c.bottom-1&&c.top<a.bottom-1)n++;}return n})()}`);
        S.ok(r1.n === 11 && ZONES.every(z => r1.labels.some(l => l.startsWith(z + '，'))) && r1.shapes.length === 11, '点开:11 个区,每个按钮读屏念区名', r1.labels);
        S.ok(r1.sizes.every(s => s === '44x44') && r1.overlap === 0 && r1.exp === 'true', '每个区的按钮 44×44,互不重叠', r1);
        S.ok(r1.lr.join() === '右,左', '图上标了小字「右」「左」(按她自己的左右)', r1.lr);
        const d = await p.eval(`return today()`);
        const r2 = await p.eval(`document.getElementById('tn-fz-peri-${d}').click();${wait(30)}const chips=[...document.querySelectorAll('#tn-skin .fm-pick .chip')];
            chips.find(c=>c.textContent.trim()==='泛红').click();${wait(30)}(c=>{c.focus();c.click()})([...document.querySelectorAll('#tn-skin .fm-pick .chip')].find(c=>c.textContent.trim()==='红痘'));${wait(30)}
            const en=(lg(K.jrnl)||[]).find(x=>x.date===today());const b=document.getElementById('tn-fz-peri-${d}');
            return {types:chips.map(c=>c.textContent.trim()),spots:en.spots,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),mk:b.textContent.trim(),
                on:document.querySelector('#tn-skin .fz[data-zone="口周"]').getAttribute('class'),sum:document.querySelector('#tn-skin .fm-sum').innerText,focus:document.activeElement&&document.activeElement.textContent.trim()}`);
        S.ok(r2.types.join() === '闭口,红痘,脓头,泛红,干皮,痘印', '点区 → 选类型(闭口 / 红痘 / 脓头 / 泛红 / 干皮 / 痘印)', r2.types);
        S.ok(JSON.stringify(r2.spots) === JSON.stringify([{ zone: '口周', type: '泛红' }, { zone: '口周', type: '红痘' }]), '可多选,存进 sk_jrnl1 当天的 spots', r2.spots);
        S.ok(/口周，已标：泛红、红痘/.test(r2.label) && r2.pressed === 'true' && r2.mk === '2' && /\bon\b/.test(r2.on) && /口周：泛红、红痘/.test(r2.sum), '区上显示标记(数字)、高亮;读屏念「已标:泛红、红痘」;下面一行汇总', r2);
        S.ok(r2.focus === '红痘', '点完类型焦点还在那个按钮上(重画不跳)', r2.focus);
        // 点 SVG 上的形状也能选区
        const r3 = await p.eval(`document.querySelector('#tn-skin .fz[data-zone="下巴"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));${wait(30)}return document.querySelector('#tn-skin .fm-pick .sec-t').textContent`);
        S.ok(/^下巴/.test(r3), '点脸上的形状(不只是按钮)也能选区', r3);
        // 改 / 删
        const r4 = await p.eval(`document.getElementById('tn-fz-peri-${d}').click();${wait(30)}[...document.querySelectorAll('#tn-skin .fm-pick .chip')].find(c=>c.textContent.trim()==='泛红').click();${wait(30)}
            const a=(lg(K.jrnl)||[]).find(x=>x.date===today()).spots;[...document.querySelectorAll('#tn-skin .fm-pick button')].find(b=>b.textContent==='清掉这一处').click();${wait(30)}
            const en=(lg(K.jrnl)||[]).find(x=>x.date===today());return {a,has:'spots' in en,pick:!!document.querySelector('#tn-skin .fm-pick')}`);
        S.ok(JSON.stringify(r4.a) === JSON.stringify([{ zone: '口周', type: '红痘' }]) && !r4.has && !r4.pick, '再点一次取消某个类型;「清掉这一处」整区删掉(最后一处删完 spots 字段也去掉)', r4);
        // 存下来,刷新还在;刷新后默认收起、按钮写已标几处
        await p.eval(`document.getElementById('tn-fz-chin-${d}')||document.querySelector('#tn-skin .fm-entry button').click();${wait(20)}document.getElementById('tn-fz-chin-${d}').click();${wait(20)}
            [...document.querySelectorAll('#tn-skin .fm-pick .chip')].find(c=>c.textContent.trim()==='脓头').click();return 1`);
        await p.reload(900);
        const r5 = await p.eval(`const en=(lg(K.jrnl)||[]).find(x=>x.date===today());const b=document.querySelector('#tn-skin .fm-entry button');
            const ctx=buildSkincareContext();return {spots:en.spots,btn:b.textContent,fm:!!document.querySelector('#tn-skin .fm'),ctx0:ctx.recentLogs[0],ctxOther:ctx.recentLogs.slice(1).every(x=>Array.isArray(x.spots)&&!x.spots.length)}`);
        S.ok(JSON.stringify(r5.spots) === JSON.stringify([{ zone: '下巴', type: '脓头' }]) && /已标 1 处/.test(r5.btn) && !r5.fm, '刷新后还在(走信封);入口默认收起,按钮写「已标 1 处」', r5);
        S.ok(JSON.stringify(r5.ctx0.spots) === JSON.stringify([{ zone: '下巴', type: '脓头' }]) && r5.ctxOther, '顾问快照 recentLogs 每天带 spots(没标就是空数组)', r5);
        // 某一天的 sheet(补记)也能标
        const r6 = await p.eval(`openDaySheet(__d(-2));${wait(80)}const none=!document.getElementById('day-sheet').querySelector('.fm-entry');toggleSym(__d(-2),'闭口');${wait(50)}
            const ov=document.getElementById('day-sheet');const tg=ov.querySelector('.fm-entry button');const has=!!tg&&none;
            tg.click();${wait(30)}document.getElementById('ds-fz-fore-'+__d(-2)).click();${wait(30)}[...document.getElementById('day-sheet').querySelectorAll('.fm-pick .chip')].find(c=>c.textContent.trim()==='闭口').click();${wait(30)}
            return {has,spots:((lg(K.jrnl)||[]).find(x=>x.date===__d(-2))||{}).spots,today:((lg(K.jrnl)||[]).find(x=>x.date===today())||{}).spots}`);
        S.ok(r6.has && JSON.stringify(r6.spots) === JSON.stringify([{ zone: '额头', type: '闭口' }]) && r6.today.length === 1, '补记某一天:那天只有「比平时油」时没入口,勾了闭口才出现;写进那一天', r6);
        S.ok(!p.errors.length, '打卡标脸 0 报错', p.errors);
    }
    // ── 没勾问题标签:没有入口;极简模式:有入口但默认收起(哪怕标过) ──
    {
        const p = await boot(`full({today:true,status:i=>['出油','稳定']})`);
        const r = await p.eval(`return !!document.querySelector('#tn-skin .fm-entry')`);
        S.ok(!r, '只勾了「比平时油 / 差不多」:不出现「标在脸上」', r);
    }
    {
        const p = await boot(`minimal({jrnl:${J({ 0: { status: ['泛红'], spots: [['口周', '泛红']] }, '-1': { status: [] } })}})`);
        const r = await p.eval(`const b=document.querySelector('#tn-skin .fm-entry button');return {btn:b&&b.textContent,exp:b&&b.getAttribute('aria-expanded'),fm:!!document.querySelector('#tn-skin .fm'),minimal:PROFILE.minimalMode}`);
        S.ok(r.minimal && /标在脸上/.test(r.btn || '') && r.exp === 'false' && !r.fm, '极简模式:入口在,默认收起(标过也不自动展开)', r);
    }

    // ── 皮肤页热度 ──
    {
        const p = await boot(`full({jrnl:${J({ '-1': { status: ['爆痘'], spots: [['下巴', '红痘'], ['下巴', '脓头'], ['额头', '闭口']] }, '-3': { status: ['爆痘'], spots: [['下巴', '红痘']] }, '-6': { status: ['爆痘'], spots: [['下巴', '红痘']] }, '-20': { status: ['泛红'], spots: [['口周', '泛红']] } })}})`);
        const r = await p.eval(`show('skin');${wait(100)}const box=document.getElementById('face-heat');const mk=k=>document.getElementById('heat-fz-'+k+'-').textContent.trim();
            const cls=z=>box.querySelector('.fz[data-zone="'+z+'"]').getAttribute('class');
            const a={chin:mk('chin'),fore:mk('fore'),peri:mk('peri'),chinCls:cls('下巴'),foreCls:cls('额头'),periCls:cls('口周'),label:document.getElementById('heat-fz-chin-').getAttribute('aria-label')};
            document.getElementById('heat-fz-chin-').click();${wait(30)}const pick=document.querySelector('#face-heat .fm-pick');
            return Object.assign(a,{pick:pick&&pick.innerText,pressed:document.getElementById('heat-fz-chin-').getAttribute('aria-pressed')})`);
        S.ok(r.chin === '3' && r.fore === '1' && r.peri === '' && /h2/.test(r.chinCls) && /h1/.test(r.foreCls) && !/\bh\d/.test(r.periCls), '皮肤页:近 14 天各区几天(数字 + 深浅);20 天前的不算', r);
        S.ok(/下巴，近 14 天有 3 天标过/.test(r.label), '热度按钮读屏念「下巴,近 14 天有 3 天标过」', r.label);
        S.ok(r.pressed === 'true' && /下巴 · 近 14 天 3 天/.test(r.pick) && (r.pick.match(/红痘/g) || []).length === 3 && /脓头/.test(r.pick), '点区看哪几天、什么类型', r.pick);
        S.ok(!p.errors.length, '热度 0 报错', p.errors);
    }
    {
        const p = await boot(`full()`);
        const r = await p.eval(`show('skin');${wait(80)}return document.getElementById('face-heat').innerText`);
        S.ok(/还没在脸上标过位置/.test(r), '没标过:皮肤页说一句怎么标', r);
    }

    // ── 就医红线:位置不参与(Cait 10/29 撤掉「口周 ≥3 天提前亮」,一颗痘三天成熟很正常,会误报)──
    {
        const p = await boot(`full({jrnl:${J({ '-1': { status: ['爆痘'], spots: [['口周', '泛红'], ['人中/鼻下', '红痘']] }, '-2': { status: ['爆痘'], spots: [['口周', '红痘']] }, '-4': { status: ['闭口'], spots: [['口周', '泛红']] }, '-8': { status: ['闭口'], spots: [['口周', '泛红']] } })}})`);
        const r = await p.eval(`const r=medicalRedLine();return {on:r.on,card:!!document.querySelector('#safety-alert .note-medical'),ctx:buildSkincareContext().recentLogs.filter(x=>x.spots.length).length}`);
        S.ok(!r.on && !r.card, '口周 / 人中标了 4 天泛红 / 红痘:红线不亮(位置不参与红线)', r);
        S.ok(r.ctx === 4, '位置照存、照给顾问(4 天都带 spots)', r);
    }
    {
        // 位置也压不掉按天数的判据:泛红 6 天、位置全在额头,照亮
        const days = {}; [-1, -2, -3, -5, -7, -9].forEach(i => { days[i] = { status: ['泛红'], spots: [['额头', '闭口']] }; });
        const p = await boot(`full({jrnl:${J(days)}})`);
        const r = await p.eval(`return medicalRedLine().on`);
        S.ok(r, '泛红 6 天、标的位置全在额头:红线照亮(位置不影响原判据)', r);
    }

    // ── ZONE_PRESETS 补口周 / 下颌线,和脸部地图同名 ──
    {
        const p = await boot(`full()`);
        const r = await p.eval(`const z=n=>ZONE_PRESETS.find(x=>x.name===n);PROFILE.zones=[];toggleZone('口周');toggleZone('下颌线');
            return {peri:z('口周')&&z('口周').avoid,jaw:z('下颌线')&&z('下颌线').avoid,inMap:['口周','人中/鼻下','下巴','发际线'].every(n=>FACE_ZONE_NAMES.indexOf(n)>=0),
                acid:zoneHintFor('acid'),mask:zoneHintFor('mask')}`);
        S.ok(JSON.stringify(r.peri) === '["acid","mask","retinol"]' && JSON.stringify(r.jaw) === '["mask"]' && r.inMap, 'ZONE_PRESETS 有「口周」(避开酸 / 面膜 / 维 A)和「下颌线」(避开面膜),区名和脸部地图一致', r);
        S.ok(/口周/.test(r.acid) && /口周/.test(r.mask) && /下颌线/.test(r.mask) && !/下颌线/.test(r.acid), '选了之后步骤提示照样「避开口周 / 下颌线」', r);
    }

    // ── 0 emoji + 版式探针 + 深浅色都看得清 ──
    for (const scheme of ['light', 'dark']) {
        const p = await boot(`full({today:true,jrnl:${J({ 0: { status: ['爆痘', '泛红'], spots: [['口周', '泛红'], ['下巴', '红痘']] }, '-2': { status: ['爆痘'], spots: [['下巴', '红痘']] } })}})`, { page: { scheme } });
        const d = await p.eval(`return today()`);
        const r = await p.eval(`${PROBE};document.querySelector('#tn-skin .fm-entry button').click();${wait(30)}document.getElementById('tn-fz-chin-${d}').click();${wait(30)}
            const a=__probe('#tn-skin');show('skin');${wait(100)}document.getElementById('heat-fz-chin-').click();${wait(30)}const b=__probe('#face-heat-sec');show('tonight');${wait(50)}
            const parse=c=>{const m=String(c).match(/rgba?\\(([^)]+)\\)/);return m?m[1].split(/[ ,/]+/).filter(Boolean).map(Number):[0,0,0]};
            const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
            const cr=(x,y)=>{const A=lum(parse(x)),B=lum(parse(y));return +((Math.max(A,B)+.05)/(Math.min(A,B)+.05)).toFixed(2)};
            const bg=getComputedStyle(document.body).backgroundColor;
            const line=getComputedStyle(document.querySelector('#tn-skin .fm-line')).stroke, zone=getComputedStyle(document.querySelector('#tn-skin .fz:not(.on)')).stroke,
                  on=getComputedStyle(document.querySelector('#tn-skin .fz.on')).stroke, lr=getComputedStyle(document.querySelector('#tn-skin .fm-lr')).fill,
                  mk=getComputedStyle(document.querySelector('#tn-skin .fm-mk.on')).backgroundColor, ring=getComputedStyle(document.querySelector('#tn-skin .fm-mk:not(.on)')).boxShadow;
            return {a,b,cr:{line:cr(line,bg),zone:cr(zone,bg),on:cr(on,bg),lr:cr(lr,bg),mk:cr(mk,bg),ring:cr(ring,bg)}}`);
        for (const [k, pr] of [['打卡 · 标脸', r.a], ['皮肤页 · 热度', r.b]]) {
            S.ok(!pr.emoji.length && pr.minFs >= 12 && !pr.lowCr.length && !pr.smallN && !pr.inputsLt16 && !pr.styleAttrs.length && pr.red === 0 && (scheme === 'light' || !pr.brightN),
                `${k}/${scheme}:0 emoji · 字号 · 对比度 · 可点的 ≥44 · 没有 style= · 不用红${scheme === 'dark' ? ' · 不刺眼' : ''}`, pr);
        }
        S.ok(Object.values(r.cr).every(c => c >= 3), `${scheme}:线稿、区块虚线、选中描边、左右小字、标记圈对底色都 ≥3:1(看得清)`, r.cr);
        S.ok(!p.errors.length, `${scheme}:0 报错`, p.errors);
    }
}
