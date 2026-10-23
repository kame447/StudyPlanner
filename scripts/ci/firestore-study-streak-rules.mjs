import assert from 'node:assert/strict';
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

export async function verifyStudyStreakRules({ owner, intruder, expectPermissionDenied, projectId, firestoreHost }) {
  assert.ok(projectId.startsWith('demo-'), 'Streak fixtures require a demo project');
  assert.match(firestoreHost, /^(127\.0\.0\.1|localhost):\d+$/, 'Streak fixtures require a loopback emulator');
  const ref = context => doc(context.db, 'study_rest_days', owner.user.uid);
  const first = { schemaVersion: 1, userId: owner.user.uid, revision: 1, dates: ['2026-10-08'] };
  assert.equal((await getDocFromServer(ref(owner))).exists(), false);
  await expectPermissionDenied('foreign rest-date read', () => getDocFromServer(ref(intruder)));
  await expectPermissionDenied('foreign rest-date creation', () => setDoc(ref(intruder), first));
  await setDoc(ref(owner), first);
  const second = { ...first, revision: 2, dates: [...first.dates, '2026-10-16'] };
  await setDoc(ref(owner), second);
  assert.deepEqual((await getDocFromServer(ref(owner))).data(), second);
  await expectPermissionDenied('rest-date collection listing', () => getDocsFromServer(collection(owner.db, 'study_rest_days')));
  await expectPermissionDenied('foreign rest-date update', () => setDoc(ref(intruder), second));
  for (const [label, patch] of [
    ['wrong owner', { userId: intruder.user.uid }],
    ['unexpected stored balance', { balance: 999 }],
    ['stale revision', { revision: 2 }],
    ['duplicate date', { dates: [...second.dates, '2026-10-16'] }],
    ['removed history', { dates: ['2026-10-20'] }],
    ['multiple dates', { dates: [...second.dates, '2026-10-20', '2026-10-21'] }],
    ['invalid date', { dates: [...second.dates, '2026-02-29'] }],
    ['invalid type', { dates: [...second.dates, 123] }],
  ]) await expectPermissionDenied(`rest dates reject ${label}`, () => setDoc(ref(owner), {
    ...second, revision: 3, dates: [...second.dates, '2026-10-20'], ...patch,
  }));
  await expectPermissionDenied('rest-date deletion', () => deleteDoc(ref(owner)));
  assert.deepEqual((await getDocFromServer(ref(owner))).data(), second);
  console.log('Firestore rest-date owner isolation, append-only history and schema regression passed.');
}
