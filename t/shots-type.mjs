// 截图:纸墨 / 无衬线 × 浅 / 深 × 四屏 + 设置(极简 = Cici 那样用),给 Cait / Cici 看。不是测试,不进 run.mjs。
//   跑:node t/shots-type.mjs [输出目录](默认 ~/skincare-coach/shots/type)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { server, stopServer, fresh, tab, sleep } from './v2-a-lib.mjs';
const OUT = process.argv[2] || path.join(os.homedir(), 'skincare-coach/shots/type');
fs.mkdirSync(OUT, { recursive: true });
const { origin } = await server();
for (const scheme of ['light', 'dark']) for (const type of ['serif', 'sans']) for (const who of ['minimal', 'full']) {
    const p = await fresh(origin, { scheme, seed: who, after: `localStorage.setItem('sk_type','${type}')` });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(600);
    for (const id of ['tonight', 'advisor', 'record', 'products']) {
        await tab(p, id, 500);
        await p.eval(`window.scrollTo(0,0);return 1`);
        await p.shot(path.join(OUT, `${type}-${scheme}-${who}-${id}.png`));
    }
    await p.eval(`document.getElementById('btn-settings').click();return 1`); await sleep(500);
    await p.eval(`const s=document.getElementById('set-look');if(s)s.scrollIntoView();return 1`); await sleep(300);
    await p.shot(path.join(OUT, `${type}-${scheme}-${who}-settings.png`));
    p.done();
}
stopServer();
console.log('→ ' + OUT);
