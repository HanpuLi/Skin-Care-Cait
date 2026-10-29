// icon.svg → icon-180.png / icon-192.png / icon-512.png(无头 Chrome 截图,不装依赖)
//   node tools/render-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { serve, browser, page, sleep } from '../t/harness.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srv = await serve(); const origin = 'http://127.0.0.1:' + srv.address().port;
const br = await browser();
try {
    for (const n of [180, 192, 512]) {
        const p = await page(br, origin, { width: n, height: n });
        await p.send('Emulation.setDeviceMetricsOverride', { width: n, height: n, deviceScaleFactor: 1, mobile: false });
        await p.send('Page.navigate', { url: origin + '/icon.svg' }); await sleep(500);
        await p.eval(`document.documentElement.setAttribute('width','${n}');document.documentElement.setAttribute('height','${n}');return 1`);
        await sleep(200);
        await p.shot(path.join(ROOT, `icon-${n}.png`));
        p.close();
        console.log('icon-' + n + '.png', fs.statSync(path.join(ROOT, `icon-${n}.png`)).size, 'bytes');
    }
} finally { br.close(); srv.close(); }
