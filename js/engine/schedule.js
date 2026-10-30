// ══ 离线排班:15 天滚动窗(过去 7 + 今天 + 未来 7)+ 今晚步骤 ══════════════════════════════════
// 顾问写今晚(/api/tonight)不可用时,这里必须能独立排出今晚和未来 7 晚。
// 酸的**频率由方案定**(顾问 / 离线阶梯)× 安全闸;面膜 / 维 A 按各自每周上限;洗澡 / 刮胡来自 model/week.js 的单一来源。
// 纯函数:不写 sk_planday1 —— 调用方(model/world.js 的 planNow)拿 plandayOf() 的结果去写('system')。
import { memo, offset, lastNDays, acidTags, exfoliantTags, retinolTags, maskTags, exfoliantCountInLastNDays, lastAcidUsed, lastAcidEntry, isExcluded, isGone, prodById, prodByName } from './util.js';
import { safetyGate, gateBlocks } from './gate.js';
import { regimenRules, maxAcidPerWeek, allowRetinol, allowMask, restedNow, includedNow, usableTonight, acidTiming, zoneHintFor,
         repairUse, irritatedNow, blockedNow, pickCleanser, cleanserReason, introNightsLeft, introHint, tonightOverride } from './rules.js';
import { isSchedActive, statusOf, hasTrait, visNotes, ROLE_ORDER } from '../model/products.js';
import { dayState } from '../model/week.js';
import { daysBetween, addDays } from '../clock.js';

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function rollingDays(W) {
    const t = W.today;
    return Array.from({ length: 15 }, (_, i) => {
        const date = addDays(t, i - 7);
        const s = dayState(W, date);
        const d = new Date(date + 'T12:00:00');
        return { date, dayName: DAY_NAMES[d.getDay()], shortDate: (d.getMonth() + 1) + '/' + d.getDate(),
                 isPast: date < t, isToday: date === t, isFuture: date > t, shower: s.shower, shave: s.shave, items: [], conflicts: [] };
    });
}

export function computePlan(W) {
    return memo(W, 'plan', () => {
        const PD = W.products || [], P = W.profile || {}, t = W.today;
        const days = rollingDays(W);
        const jrnl = W.journal || [];
        const aT = acidTags(W), rT = retinolTags(W), mT = maskTags(W);
        // 过去 + 今天:按日志回填(今天也要:勾掉的酸要占住今晚的槽位,不然刚勾的步骤会从今晚列表消失)
        days.forEach(day => {
            if (!(day.isPast || day.isToday)) return;
            const entry = jrnl.find(e => e.date === day.date);
            if (entry) (entry.products || []).forEach(tag => {
                const rp = PD.find(p => (p.journalTag || p.name) === tag);
                const pid = rp ? rp.id : null, plabel = rp ? rp.name : tag;
                if (aT.includes(tag)) day.items.push({ id: pid, type: 'acid', label: plabel, logged: true });
                if (rT.includes(tag)) day.items.push({ id: pid, type: 'retinol', label: plabel, logged: true });
                if (mT.includes(tag)) day.items.push({ id: pid, type: 'mask', label: plabel, logged: true });
            });
        });
        const futureDays = days.filter(d => !d.isPast);
        const dayDist = (a, b) => Math.abs(daysBetween(a, b));
        // ?? 不是 ||:0 是合法值(上限 0 = 停用、间隔 0 = 允许连着两晚)
        const capOf = p => (p.schedule.maxPerWeek ?? 1);
        const gapOf = p => (p.schedule.minDaysBetween ?? 2);
        const maxAcid = maxAcidPerWeek(W);
        const journalAcidCnt = exfoliantCountInLastNDays(W, 7);
        const la = lastAcidUsed(W);
        const lae = lastAcidEntry(W), lastAcidDate = lae ? lae.date : null;
        const pastUseDates = prod => { const tag = prod.journalTag || prod.name; return lastNDays(W, 7).filter(x => (x.products || []).includes(tag)).map(x => x.date); };
        const exTags = exfoliantTags(W);
        // 谁有资格被自动排:家里有、没标不用、这一版没停它、状态启用(或顾问点名启用)。酸的总次数由方案定;
        // 设成 0 或关掉自动排班仍算「别排它」,除非顾问方案点名。
        const rr = regimenRules(W), gate = safetyGate(W);
        const namedByRule = p => !!rr.acidName && String(rr.acidName).split(' / ').map(x => x.trim()).indexOf(p.name) >= 0;
        let schedulable = PD.filter(p => !p.hidden && !isExcluded(W, p) && !restedNow(W, p) && p.schedule && ['acid', 'mask', 'retinol'].includes(p.schedule.type) &&
            (isSchedActive(p, statusOf(p, W.ps)) || includedNow(W, p)) &&
            ((p.schedule.enableAutoSchedule && capOf(p) > 0) || (rr.source === 'ai' && (namedByRule(p) || includedNow(W, p)))));
        schedulable = schedulable.filter(p => !gateBlocks(p, gate, W));   // 安全闸(唯一红线)
        if (!allowMask(W)) schedulable = schedulable.filter(p => p.schedule.type !== 'mask');
        if (!allowRetinol(W)) schedulable = schedulable.filter(p => p.schedule.type !== 'retinol');
        let acids = schedulable.filter(p => p.schedule.type === 'acid');
        const masks = schedulable.filter(p => p.schedule.type === 'mask');
        const retinols = schedulable.filter(p => p.schedule.type === 'retinol');
        // 用哪支酸:顾问点了名就只用那支;离线兜底只轮换温和酸 —— 猛酸**从不自动排**
        const named = acids.filter(namedByRule);
        if (named.length) acids = named;
        else acids = acids.filter(p => !hasTrait(p, 'strong-exfo') || (rr.source === 'ai' && includedNow(W, p)));

        // === 1. 酸 ===
        const acidSlotsLeft = Math.max(0, maxAcid - journalAcidCnt);
        let order = [...acids];
        if (la) {
            const li = order.findIndex(a => (a.journalTag || a.name) === la);
            if (li > 0) order = [...order.slice(li), ...order.slice(0, li)];
            if (order.length > 1) order.push(order.shift());
        }
        const acidSlots = [];
        for (let n = 0; order.length && n < acidSlotsLeft; n++) acidSlots.push(order[n % order.length]);
        const assigned = [];
        const windowLoad = (date) => {
            const from = addDays(date, -6);
            return lastNDays(W, 7).filter(x => x.date >= from && x.date <= date && (x.products || []).some(tg => exTags.includes(tg))).length
                + assigned.filter(d => d >= from && d <= date).length;
        };
        for (const prod of acidSlots) {
            let best = -1, bestScore = -Infinity;
            for (let i = 0; i < futureDays.length; i++) {
                const fd = futureDays[i];
                if (fd.shave && prod.schedule.avoidShaveDay) continue;
                if (fd.items.some(it => it.type === 'acid' || it.type === 'mask')) continue;
                const all = lastAcidDate ? [lastAcidDate, ...assigned] : [...assigned];
                let minDist = 999;
                for (const d of all) minDist = Math.min(minDist, dayDist(fd.date, d));
                if (all.length > 0 && minDist < gapOf(prod)) continue;
                if (windowLoad(fd.date) >= maxAcid) continue;   // 近 7 天滚动上限
                let score = minDist * 10;
                const tim = acidTiming(W);
                if (tim === 'prefer' && prod.schedule.preferShowerNight) score += fd.shower ? 25 : -12;
                else if (tim === 'avoid') score += fd.shower ? -25 : 12;
                if (score > bestScore) { bestScore = score; best = i; }
            }
            if (best >= 0) { futureDays[best].items.push({ id: prod.id, type: 'acid', label: prod.name }); assigned.push(futureDays[best].date); }
        }
        // === 2. 面膜(计历史用量;和酸共用去角质预算)===
        const exLoadAt = date => {
            const from = addDays(date, -6);
            return lastNDays(W, 7).filter(x => x.date >= from && x.date <= date && (x.products || []).some(tg => exTags.includes(tg))).length
                + futureDays.filter(d => d.date >= from && d.date <= date && d.items.some(it => it.type === 'acid' || it.type === 'mask')).length;
        };
        masks.forEach(prod => {
            const used = pastUseDates(prod); let placed = used.length; const taken = [...used]; let guard = 0;
            while (placed < capOf(prod) && guard++ < 14) {
                let best = -1, bestScore = -Infinity;
                for (let pass = 0; pass < 2 && best < 0; pass++) for (let i = 0; i < futureDays.length; i++) {
                    const fd = futureDays[i];
                    if (fd.shave && prod.schedule.avoidShaveDay) continue;
                    if (fd.items.some(it => it.type === 'mask')) continue;
                    if (prod.schedule.avoidAcid && fd.items.some(it => it.type === 'acid')) continue;
                    if (prod.schedule.preferShowerNight && !fd.shower && pass === 0) continue;
                    if (exLoadAt(fd.date) >= maxAcid) continue;
                    let minDist = 999; for (const d of taken) minDist = Math.min(minDist, dayDist(fd.date, d));
                    if (taken.length > 0 && minDist < gapOf(prod)) continue;
                    const score = minDist * 10 + (prod.schedule.preferShowerNight ? (fd.shower ? 60 : -30) : 0);
                    if (score > bestScore) { bestScore = score; best = i; }
                }
                if (best < 0) break;
                futureDays[best].items.push({ id: prod.id, type: 'mask', label: prod.name }); taken.push(futureDays[best].date); placed++;
            }
        });
        // === 3. 维 A(同样计历史用量,优先非洗澡夜)===
        retinols.forEach(prod => {
            const used = pastUseDates(prod); let placed = used.length; const taken = [...used]; let guard = 0;
            while (placed < capOf(prod) && guard++ < 14) {
                let best = -1, bestScore = -Infinity;
                for (let pass = 0; pass < 2 && best < 0; pass++) for (let i = 0; i < futureDays.length; i++) {
                    const fd = futureDays[i];
                    if (fd.shave && prod.schedule.avoidShaveDay) continue;
                    if (fd.items.some(it => it.type === 'retinol')) continue;
                    if (prod.schedule.avoidAcid && fd.items.some(it => it.type === 'acid')) continue;
                    if (fd.items.some(it => it.type === 'mask')) continue;
                    if (pass === 0 && fd.shower) continue;
                    let minDist = 999; for (const d of taken) minDist = Math.min(minDist, dayDist(fd.date, d));
                    if (taken.length > 0 && minDist < gapOf(prod)) continue;
                    const score = minDist * 10;
                    if (score > bestScore) { bestScore = score; best = i; }
                }
                if (best < 0) break;
                futureDays[best].items.push({ id: prod.id, type: 'retinol', label: prod.name }); taken.push(futureDays[best].date); placed++;
            }
        });
        // === 3.5 今晚的小改(顾问 change_tonight)落到**今天的槽位**上 ===
        // 必须改在这里:极简模式第二天靠 sk_planday1 推定「排上的都用了」—— 顾问说今晚停酸,槽位里就得真的没有酸(8/15 那类假数据)。
        // 她已经勾过 / 记过的(logged)是事实,不动。
        (function applyTonightOverride() {
            const ov = tonightOverride(W); if (!ov) return;
            const ts = days.find(d => d.isToday); if (!ts) return;
            const ACT = ['acid', 'mask', 'retinol'];
            const nameOf = it => { const q = prodById(W, it.id); return q ? q.name : it.label; };
            ov.ops.forEach(c => {
                if (c.op === 'acid') {
                    const ai = ts.items.find(it => it.type === 'acid' && !it.logged); if (!ai) return;
                    if (c.level === 'stop') { ts.items = ts.items.filter(it => it !== ai); return; }
                    const cur = prodById(W, ai.id);
                    if (cur && hasTrait(cur, 'strong-exfo')) {
                        const mild = acids.concat(PD.filter(x => x.role === 'acid' && usableTonight(W, x)))
                            .find(x => x.id !== cur.id && hasTrait(x, 'gentle-exfo') && !gateBlocks(x, gate, W));
                        if (mild) { ai.id = mild.id; ai.label = mild.name; }
                    }
                    ai.down = true;
                } else if (c.op === 'skip') {
                    ts.items = ts.items.filter(it => it.logged || !ACT.includes(it.type) || nameOf(it) !== c.product);
                } else if (c.op === 'swap') {
                    const it = ts.items.find(x => !x.logged && ACT.includes(x.type) && nameOf(x) === c.product);
                    const np = prodByName(W, c.to);
                    if (it && np && !gateBlocks(np, gate, W)) { it.id = np.id; it.label = np.name; it.type = (np.schedule && ACT.includes(np.schedule.type)) ? np.schedule.type : it.type; }
                } else if (c.op === 'add') {
                    const np = prodByName(W, c.product);
                    const ty = np && np.schedule && np.schedule.type;
                    if (!np || !ACT.includes(ty) || gateBlocks(np, gate, W) || ts.items.some(x => x.type === ty)) return;
                    if (ts.shave) return;   // 刮胡夜不加酸、维 A、泥膜(和 ai/apply.js validateTonight、gateTonightPlan 同一条)
                    if (ty === 'acid' && (maxAcid === 0 || journalAcidCnt >= gate.acidCapMax)) return;   // 闸压到 0 / 已到上限:不加酸
                    // 泥膜和酸共用去角质额度(产品备注「使用当晚视为酸类占用」):HRT 波动期 1 次 / 周也管泥膜
                    if (ty === 'mask' && (maxAcid === 0 || journalAcidCnt >= Math.min(maxAcid, gate.acidCapMax))) return;
                    ts.items.push({ id: np.id, type: ty, label: np.name, byAI: true });
                }
            });
        })();
        // === 4. 冲突 + 刮胡夜支援(只管未来)。冲突规则和上面放置约束同源:只在产品自己声明了约束时才判 ===
        const flagOn = (item, flag) => { const prod = prodById(W, item.id); return !prod || !prod.schedule || prod.schedule[flag] !== false; };
        futureDays.forEach(p => {
            p.items = p.items.filter(i => !i.id || (!isGone(W, i.id) && PD.some(d => d.id === i.id && !d.hidden)));
            if (p.shave && P.shaving) {
                const sup = PD.find(x => !x.hidden && x.role === 'repair' && isSchedActive(x, statusOf(x, W.ps)));
                if (sup) p.items.push({ id: sup.id, type: 'support', label: sup.name });
            }
            const dayLabel = p.dayName + ' ' + p.shortDate;
            const has = ty => p.items.some(i => i.type === ty);
            const dropIf = (type, flag, msg) => {
                const hits = p.items.filter(i => i.type === type && flagOn(i, flag));
                if (!hits.length) return;
                p.conflicts.push(`${dayLabel}：${msg}`);
                p.items = p.items.filter(i => !hits.includes(i));
            };
            if (p.shave) {
                dropIf('acid', 'avoidShaveDay', '刷酸与刮胡冲突'); dropIf('retinol', 'avoidShaveDay', '维 A 与刮胡冲突');
                // 泥膜也不和刮胡同晚(刮胡夜的步骤本来就不显示它;不从槽位里拿掉,极简模式第二天会被推定成用过)。已记下的是事实,不动
                const mk = p.items.filter(i => i.type === 'mask' && !i.logged && flagOn(i, 'avoidShaveDay'));
                if (mk.length) { p.conflicts.push(`${dayLabel}：面膜与刮胡冲突`); p.items = p.items.filter(i => mk.indexOf(i) < 0); }
            }
            if (has('acid')) dropIf('retinol', 'avoidAcid', '维 A 与刷酸冲突');
            if (has('acid')) dropIf('mask', 'avoidAcid', '面膜与刷酸同晚');
            if (has('mask') && has('retinol')) { p.conflicts.push(`${dayLabel}：面膜与维 A 同晚`); p.items = p.items.filter(i => i.type !== 'retinol'); }
        });
        return days;
    });
}
// 今天排了哪些活性 → sk_planday1 的值(极简模式第二天据此推定已执行;8/15 Cici 连刷三天酸的根因修复)
export function plandayOf(W, days) {
    const ts = (days || computePlan(W)).find(d => d.isToday);
    if (!ts) return null;
    const items = ts.items.filter(it => ['acid', 'mask', 'retinol'].includes(it.type))
        .map(it => { const p = prodById(W, it.id); return { type: it.type, name: p ? p.name : it.label, tag: p ? (p.journalTag || p.name) : it.label }; });
    return { date: W.today, items };
}
export function slotFor(W, date) { return computePlan(W).find(d => d.date === date) || { date, items: [] }; }

// 当晚护肤步骤 —— 今晚页、某一天的详情、方案快照共用这一个(以前两套会给出不一致的步骤)。
// 返回 {steps[{p 名字, h 怎么用, t 计时秒?, kind 'acid'|'mask'|'retinol'|'base', chg 今晚被顾问改过?}], skips[], warnings[{text, after}]}
// 【要紧】warnings 是安全类提示:任何模式都显示,不能藏(AUDIT-ux P0-6:8/28 事故就是它被极简模式藏了)
export function buildNightSteps(W, shower, shave, slot) {
    const P = W.profile || {}, PD = W.products || [];
    shave = !!shave && !!P.shaving;   // 逻辑收口:防止遗留数据给不刮胡的人产出刮胡文案
    const items = (slot && slot.items) || [];
    const schedAcid = items.find(it => it.type === 'acid'), schedMask = items.find(it => it.type === 'mask'), schedRet = items.find(it => it.type === 'retinol');
    const hasScheduledAcid = !!schedAcid && !shave;
    const pd = id => prodById(W, id);
    const active = id => { const p = pd(id); return p && !p.hidden && isSchedActive(p, statusOf(p, W.ps)); };
    const byRole = (role, single) => {
        const list = PD.filter(p => p.role === role && usableTonight(W, p) && ((p.schedule && p.schedule.time) || ['pm']).includes('pm'));
        return single ? list.slice(0, 1) : list;
    };
    const hint = p => p.pmHint || visNotes(p, P)[0] || '';
    const gate = safetyGate(W);
    const gb = p => gateBlocks(p, gate, W);
    const steps = [], skips = [], warnings = [];
    let coverCheck = null, ovApplied = false;
    const add = (p, h, extra) => steps.push(Object.assign({ p, h: h || '', kind: 'base' }, extra || {}));
    if (shave) {
        add('凉水冲洗（刮完立刻）', '降温止红');
        byRole('repair').forEach(p => add(p.name, hint(p) || '全脸薄涂，修护刮出来的小伤口'));
        byRole('serum').forEach(p => { const b = gb(p); b ? skips.push(p.name + '（' + b + '）') : add(p.name, hint(p) || '全脸轻拍到吸收'); });
        byRole('moist', true).forEach(p => add(p.name, hint(p) || '无香精封层'));
        skips.push('刷酸、维 A、泥膜（刮胡夜都不上）');
    } else {
        const ctx = { shower, acidTonight: hasScheduledAcid };
        const cleanser = pickCleanser(W, byRole('cleanse'), ctx);
        const pre = byRole('precleanse', true)[0];
        const wantPre = !!P.useMakeupRemoval;
        if (cleanser) {
            const why = cleanserReason(W, ctx);
            const preNote = (wantPre && pre) ? `（化了妆或涂了厚防晒，先用${pre.name}卸）` : '';
            add(cleanser.name, (why ? why + '；' : '') + (cleanser.pmHint || '打圈 30 到 60 秒，温水洗净') + preNote, { t: 60 });
        } else if (wantPre && pre) add(pre.name, hint(pre) || '化了妆或厚防晒时用');
        else add('温水冲洗', '家里还没有洁面，去「产品」加一支');
        const irritated = irritatedNow(W);
        let faceCovered = false;
        const soothers = irritated ? byRole('soothe').filter(p => !gb(p)) : [];
        soothers.forEach(p => add(p.name, (hint(p) || '敷 5 分钟左右洗掉') + '（最近有泛红才用）', { t: 300 }));
        if (hasScheduledAcid) {
            const ap = pd(schedAcid.id); const aName = ap ? ap.name : schedAcid.label;
            add(aName, ((ap && hint(ap)) || '薄涂，停留 3 到 5 分钟，不用冲') + (shower ? '；洗完澡等脸完全干了再涂' : '') + zoneHintFor(W, 'acid') +
                (schedAcid.down ? '（今晚降一档：只薄涂一层、时间减半，刺痛马上洗掉）' : ''), { kind: 'acid', chg: !!(schedAcid.down || schedAcid.byAI) });
            skips.push('修护精华（刷酸夜不用）', '维 A（刷酸夜不叠）');
            if (ap && introNightsLeft(W, ap)) warnings.push({ text: '这支酸还在试用的头几晚，别和别的新东西同一晚上脸：出了问题分不清是谁。', after: steps.length - 1 });
        } else if (schedMask) {
            const mp = pd(schedMask.id);
            if (mp && active(mp.id)) { add(mp.name, (hint(mp) || '敷 10 到 15 分钟后冲干净') + zoneHintFor(W, 'mask'), { t: 900, kind: 'mask', chg: !!schedMask.byAI }); skips.push('维 A（面膜夜不叠）'); }
        } else if (schedRet) {
            const rp = pd(schedRet.id);
            if (rp && active(rp.id)) { add(rp.name, (hint(rp) || '每周 1 次，薄涂全脸') + zoneHintFor(W, 'retinol'), { kind: 'retinol', chg: !!schedRet.byAI }); skips.push('刷酸（维 A 夜不叠）'); }
        } else {
            // 正在泛红 / 发炎、或一直闷闭口时,含精油·香精的精华和面油先不上
            const gentleOK = p => !blockedNow(W, p) && !gb(p);
            byRole('serum').forEach(p => gentleOK(p) ? (add(p.name, hint(p) || '全脸轻拍到吸收'), faceCovered = true) : skips.push(p.name + '（' + (gb(p) || '含精油 / 香精，泛红或闷闭口时先停') + '）'));
            if (!shower) byRole('oil').forEach(p => gentleOK(p) ? (add(p.name, hint(p) || '1 到 2 滴，两颊和脖子，额头避开'), faceCovered = true) : skips.push(p.name + '（' + (gb(p) || '闭口 / 发炎期面油先停') + '）'));
        }
        byRole('eye', true).forEach(p => { const b = gb(p); b ? skips.push(p.name + '（' + b + '）') : add(p.name, hint(p) || '无名指轻拍眼眶骨'); });
        const needCalm = irritated && !soothers.length;
        const spotUse = repairUse(W) === 'spot';
        byRole('moist', true).forEach(p => {
            const intro = introHint(W, p);
            add(p.name, (hasScheduledAcid ? '刷完酸直接封层' : (hint(p) || '全脸封层')) +
                (intro || (needCalm && hasTrait(p, 'calm') && !hasTrait(p, 'occlusive') ? '（最近有泛红：这支自带镇静成分，泛红处多按一层）' : '')));
            faceCovered = true;
            if (intro && hasScheduledAcid) warnings.push({ text: '今晚既刷酸、又是这支保湿的头几晚：建议酸往后挪一晚，两样一起上，出了问题分不清是谁。', after: steps.length - 1 });
        });
        const clogged = lastNDays(W, 14).some(e => (e.status || []).some(s => s === '闭口' || s === '爆痘'));
        byRole('repair').forEach(p => {
            add(p.name, (spotUse ? ('痘痘处、口罩线点涂' + (clogged && !P.repairUse ? '（近期有闭口 / 痘，先别全脸厚涂）' : '')) : '全脸薄涂封层') + (needCalm ? '（最近有泛红，泛红处多带一下）' : ''));
            if (!spotUse) faceCovered = true;
        });
        // 【要紧】洗完全脸什么都不涂 = 屏障只会更差。剩下的东西全被停掉 / 只点涂时必须说出来(2026-08-28 事故)
        //   在下面「今晚的小改」落地之后才判(顾问跳过 / 换掉了唯一的保湿,也得说)
        coverCheck = () => {
            if (ovApplied) faceCovered = steps.some(s => { const q = prodByName(W, s.p); return !!q && (['moist', 'serum', 'oil'].indexOf(q.role) >= 0 || (q.role === 'repair' && !spotUse)); });
            if (!faceCovered && PD.some(p => !p.hidden)) warnings.push({ text: '洗完全脸没有能涂的东西了：保湿这一档是空的。去「产品」看「要不要买新的」。', after: 0 });
        };
    }
    // 今晚的小改里**非活性**的那几条在这里落:跳过 / 换一支 / 临时加一支。只对今天生效。
    const ov = (slot && slot.date && slot.date === W.today) ? tonightOverride(W) : null;
    if (ov && !shave) {
        ovApplied = true;
        const roleIdx = n => { const q = prodByName(W, n); return q ? ROLE_ORDER.indexOf(q.role) : -1; };
        ov.ops.forEach(c => {
            const why = c.why ? '：' + c.why : '', who = c.by === 'user' ? '你' : '顾问';   // 她自己在今晚页划掉 / 换的(by:'user')不冒充顾问
            if (c.op === 'skip') {
                const i = steps.findIndex(x => x.p === c.product);
                if (i >= 0) { steps.splice(i, 1); skips.push(c.product + '（' + who + '：今晚先跳过' + why + '）'); warnings.forEach(w => { if (w.after >= i) w.after = Math.max(-1, w.after - 1); }); }
            } else if (c.op === 'swap') {
                const s = steps.find(x => x.p === c.product), np = prodByName(W, c.to);
                const ty = np && np.schedule && np.schedule.type;
                // 活性不在这里换进来:活性只走 computePlan 的 applyTonightOverride(同类互换),planday 才对得上
                if (s && np && !['acid', 'mask', 'retinol'].includes(ty) && np.role !== 'acid' && !gb(np)) { s.p = np.name; s.h = (hint(np) || '') + '（' + who + '今晚换的' + why + '）'; s.chg = true; }
            } else if (c.op === 'add') {
                const np = prodByName(W, c.product);
                const ty = np && np.schedule && np.schedule.type;
                if (!np || ['acid', 'mask', 'retinol'].includes(ty) || steps.some(x => x.p === np.name) || gb(np)) return;
                const ri = ROLE_ORDER.indexOf(np.role);
                let at = steps.findIndex(x => roleIdx(x.p) > ri);
                if (at < 0) at = steps.length;
                steps.splice(at, 0, { p: np.name, h: (hint(np) || '') + '（' + who + '今晚加的' + why + '）', kind: 'base', chg: true });
                warnings.forEach(w => { if (w.after >= at) w.after++; });
            }
        });
    }
    if (coverCheck) coverCheck();
    const low = W.low || [];
    if (low.length) {
        const lowNames = low.map(id => (pd(id) || {}).name).filter(Boolean);
        steps.forEach(s => { if (lowNames.indexOf(s.p) >= 0) s.h = (s.h || '') + '（这支快用完了）'; });
    }
    return { steps, skips, warnings };
}
// 一份「要显示的今晚步骤」的安全提示(顾问版也要有,不能拿离线那份的提示套):口径和 buildNightSteps 同一套
//   steps = [{p 产品名(纯动作为 ''), kind}];返回 [{text, after, key}]。
//   · 这支酸还在试用的头几晚 · 刷酸夜 + 新保湿的头几晚 · 洗完全脸没有能涂的(8/28 事故)
export const COVER_WARN = '洗完全脸没有能涂的东西了：保湿这一档是空的。去「产品」看「要不要买新的」。';
export function faceCoveredBy(W, names) {
    const spotUse = repairUse(W) === 'spot';
    return names.some(n => { const q = prodByName(W, n); return !!q && (['moist', 'serum', 'oil'].indexOf(q.role) >= 0 || (q.role === 'repair' && !spotUse)); });
}
export function stepWarnings(W, steps) {
    const out = [], list = (steps || []).filter(Boolean);
    const names = list.map(s => s.p || '').filter(Boolean);
    const ai = list.findIndex(s => s.kind === 'acid');
    if (ai >= 0) {
        const ap = prodByName(W, list[ai].p);
        if (ap && introNightsLeft(W, ap)) out.push({ key: 'acid-intro', text: '这支酸还在试用的头几晚，别和别的新东西同一晚上脸：出了问题分不清是谁。', after: ai });
        list.forEach((s, i) => {
            const q = s.p && prodByName(W, s.p);
            if (q && q.role === 'moist' && introHint(W, q)) out.push({ key: 'moist-intro', text: '今晚既刷酸、又是这支保湿的头几晚：建议酸往后挪一晚，两样一起上，出了问题分不清是谁。', after: i });
        });
    }
    if (!faceCoveredBy(W, names) && (W.products || []).some(p => !p.hidden)) out.push({ key: 'cover', text: COVER_WARN, after: 0 });
    return out;
}
// 今晚(按 W.tn 的洗澡 / 刮胡;没有就按排班)
export function tonight(W) {
    const slot = slotFor(W, W.today);
    const tn = W.tn || {};
    const shower = tn.date === W.today ? !!tn.shower : slot.shower, shave = tn.date === W.today ? !!tn.shave : slot.shave;
    return Object.assign({ slot, shower, shave: shave && !!(W.profile || {}).shaving }, buildNightSteps(W, shower, shave, slot));
}
// 顾问页「接下来 7 晚」:今天起 7 晚,每晚排了什么活性、洗不洗澡 / 刮不刮
export function next7(W) {
    return computePlan(W).filter(d => !d.isPast).slice(0, 7).map(d => ({
        date: d.date, dayName: d.dayName, shower: d.shower, shave: d.shave && !!(W.profile || {}).shaving,
        items: d.items.filter(i => i.type !== 'support').map(i => ({ type: i.type, name: i.label })), conflicts: d.conflicts
    }));
}
// 本周刷过酸的晚上(近 7 天,含今天)+ 最近几次刷酸 —— 给顾问看(否则它不知道这周刷没刷过)
export function acidHistory(W, n) {
    const tags = acidTags(W);
    const nameOf = tag => { const p = (W.products || []).find(x => (x.journalTag || x.name) === tag); return p ? p.name : tag; };
    const hit = e => (e.products || []).filter(p => tags.includes(p));
    const week = lastNDays(W, 7).filter(e => hit(e).length).map(e => ({ date: e.date, product: hit(e).map(nameOf).join(' / '), auto: !!e.auto }));
    const seen = new Set(), recent = [];
    (W.journal || []).filter(e => e && e.date && e.date <= W.today && hit(e).length).sort((a, b) => b.date.localeCompare(a.date))
        .forEach(e => { if (!seen.has(e.date) && recent.length < (n || 6)) { seen.add(e.date); recent.push({ date: e.date, product: hit(e).map(nameOf).join(' / ') }); } });
    return { thisWeek: week, recent, lastDate: recent.length ? recent[0].date : '', daysSinceLast: recent.length ? daysBetween(recent[0].date, W.today) : null };
}
export { offset };
