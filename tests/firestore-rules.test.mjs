import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'demo-skin-care-cait';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env?.cleanup();
});

test('owner can read and write their own user document', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const ref = doc(alice, 'users/alice');
  await assertSucceeds(setDoc(ref, { routine: ['cleanser'] }));
  await assertSucceeds(getDoc(ref));
});

test('another authenticated user cannot read or overwrite the document', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), { routine: ['cleanser'] }));
  await assertFails(getDoc(doc(bob, 'users/alice')));
  await assertFails(setDoc(doc(bob, 'users/alice'), { routine: ['tampered'] }));
});

test('anonymous access is denied', async () => {
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymous, 'users/alice')));
  await assertFails(setDoc(doc(anonymous, 'users/alice'), { routine: [] }));
});

test('unmatched subcollections are denied even to the parent owner', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const ref = doc(alice, 'users/alice/private/entry');
  await assertFails(setDoc(ref, { hidden: true }));
  await assertFails(getDoc(ref));
});
