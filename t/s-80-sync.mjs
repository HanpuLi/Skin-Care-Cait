// 同步信封的逻辑测试:不开浏览器,在 vm 里跑 index.html 里真的存储 / 同步函数(测试本体在 t/sync-unit.mjs,CI 里 npm run test:sync 跑同一组)
import { runSyncUnit } from './sync-unit.mjs';
export default async function ({ S }) { await runSyncUnit(S); }
