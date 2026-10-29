// 同步指纹的真 Firestore 往返:写进去、读回来,_stableStr 必须一字不差。
// 「认得是自己写的」「云端没变过」都靠这个指纹;往返后序列化不一样 = 她会跟自己冲突、弹选择框。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';

// 用 App 自己的 _stableStr / cloneSync(js/store.js),不再抄一份
import { _stableStr, cloneSync } from '../js/store.js';
const clone = cloneSync;

// 照 CLOUD_KEYS 里真实数据的形状造的,外加各种数值/空容器/中文/键序的边角
const payload = {
  sk_jrnl1: { '2026-10-28': { status: ['出油', '闭口'], note: '下巴两颗闭口', skipped: ['acid'], auto: false, spots: [{ zone: '下巴', type: '闭口' }] },
              '2026-10-29': { status: [], note: '', skipped: [], auto: true } },
  sk_profile1: { hrt: true, minimalMode: false, acidLevel: 1, acidLevelAt: 1761700000000, medical: null, zones: [{ name: '人中/鼻下', avoid: ['acid', 'mask'], care: '只温和清洁' }],
                 stamp: '我', oobeAt: '2026-10-29', excluded: [], weird: { b: 1, a: 2, 'z.k': 3, 'é': 4, '中': 5 } },
  sk_regimen1: { v: 9, sig: 'e7|abc‖def', rules: { acidCap: 2, acidName: "Paula's Choice 6%杏仁酸+2%乳酸", acidZones: [], repair: 'spot' },
                 versions: [{ id: 'r9', at: 1761700000123, kind: 'plan', rules: { acidCap: 1 } }, { id: 'r8', at: 0, undo: null }] },
  sk_prodstat1: { pc: 'owned', votary: 'paused' },
  sk_empty1: { b5: [{ date: '2026-10-20', weeks: 10.5, uses: 41 }] },
  nums: { f: 0.1, g: 1.5, h: 1e-7, i: -3, j: 1.0, k: 123456789012, l: 0, m: 2.0000000001, n: 1e21, o: -0.25 },
  empties: { a: {}, b: [], c: '', d: [{}], e: { x: [] } },
  deep: { a: { b: { c: { d: { e: { f: { g: { h: 'deep' } } } } } } } },
  text: { s: '引号"和\\反斜杠\n换行\t制表 · — 🙂  ' }
};

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-skin-care-cait', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });

test('写入 → 读回:指纹不变(整份 set,和 pushToCloud 一样)', async () => {
  const db = env.authenticatedContext('cait').firestore();
  const ref = doc(db, 'users/cait');
  const out = Object.assign(clone(payload), { _updatedAt: Date.now() });
  await setDoc(ref, out);
  const raw = (await getDoc(ref)).data();
  delete raw._updatedAt;
  for (const k of Object.keys(payload)) assert.equal(_stableStr(raw[k]), _stableStr(clone(payload[k])), k);
  assert.equal(_stableStr(raw), _stableStr(clone(payload)));
});

test('事务里读回的也一样(pushToCloud 走 runTransaction)', async () => {
  const db = env.authenticatedContext('cait').firestore();
  const ref = doc(db, 'users/cait');
  await setDoc(ref, Object.assign(clone(payload), { _updatedAt: Date.now() }));
  const got = await runTransaction(db, async tx => { const s = await tx.get(ref); const d = s.data(); delete d._updatedAt; return d; });
  assert.equal(_stableStr(got), _stableStr(clone(payload)));
});
