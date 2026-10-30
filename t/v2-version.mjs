// 版本小注:BUILD = sw.js CACHE_NAME 尾号;VERSION 三段式且等于更新日志第一条;日期 YYYY-MM-DD、新的在前;条目非空、不写 em dash
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname), ROOT = path.join(DIR, '..');
const { VERSION, BUILD, CHANGELOG } = await import(path.join(ROOT, 'js/version.js'));
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const m = sw.match(/CACHE_NAME = 'skincare-app-v(\d+)'/);
let fail = 0;
const ok = (c, name, info) => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  → ' + JSON.stringify(info))); if (!c) fail++; };
console.log('\n■ v2-version');
ok(m && +m[1] === BUILD, 'BUILD 和 sw.js CACHE_NAME 尾号一致', { BUILD, sw: m && m[1] });
ok(/^\d+\.\d+\.\d+$/.test(VERSION), 'VERSION 三段式', VERSION);
ok(CHANGELOG.length && CHANGELOG[0][0] === VERSION, '更新日志第一条就是当前版本', CHANGELOG[0] && CHANGELOG[0][0]);
ok(CHANGELOG.every(([v, d, L]) => /^\d+\.\d+\.\d+$/.test(v) && /^\d{4}-\d{2}-\d{2}$/.test(d) && L.length && L.every(x => x && !x.includes('—'))), '每条:版本三段式、日期、条目非空、没有 em dash');
ok(CHANGELOG.every((e, i) => !i || CHANGELOG[i - 1][1] >= e[1]), '新的在前');
console.log(fail ? `\n✗ ${fail} 条失败` : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);
