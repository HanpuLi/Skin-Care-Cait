// 日期:全 App 只有这一个「今天」。凌晨 0:00–2:59 仍算前一晚(深夜护肤常在 12 点后)。
// 所有日期都是本地日期串 'YYYY-MM-DD',比较一律用字符串,绝不经过 UTC(new Date('YYYY-MM-DD') 是 UTC 零点,会差一天)。
// clock.now 可以替换(测试里固定时间);引擎(engine/*)不调这里,它们从 world.today 拿日期。
export const clock = { now: () => new Date() };

export function localD(d) {
    if (!(d instanceof Date)) return d;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function today() {
    const d = new Date(clock.now().getTime());
    if (d.getHours() < 3) d.setDate(d.getDate() - 1);
    return localD(d);
}
// 某个日期串加减 n 天(按本地正午算,跨夏令时不出错)
export function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return localD(d); }
export function offsetDate(n) { return addDays(today(), n); }
export function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
export function isoWeek(d) {
    const t = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
    t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7);
    const w = new Date(t.getFullYear(), 0, 4);
    return t.getFullYear() + '-W' + String(1 + Math.round(((t - w) / 86400000 - 3 + (w.getDay() + 6) % 7) / 7)).padStart(2, '0');
}
// 0 = 周一 … 6 = 周日
export function wkIdxForDate(ds) { const day = new Date(ds + 'T12:00:00').getDay(); return day === 0 ? 6 : day - 1; }
export function dowOf(ds) { return new Date(ds + 'T12:00:00').getDay(); }
export function mdOf(ds) { return ds ? Number(ds.slice(5, 7)) + '月' + Number(ds.slice(8, 10)) + '日' : ''; }
