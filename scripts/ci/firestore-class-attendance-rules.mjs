import assert from 'node:assert/strict';
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

// Reuses the repository's existing demo-only authenticated emulator contexts.
export async function verifyClassAttendanceRules({ owner, intruder, expectPermissionDenied, projectId, firestoreHost }) {
  assert.ok(projectId.startsWith('demo-'), 'Attendance fixtures require a demo project');
  assert.match(firestoreHost, /^(127\.0\.0\.1|localhost):\d+$/, 'Attendance fixtures require a loopback emulator');
  const id = `attendance-class-${owner.user.uid}`;
  const otherId = `attendance-class-${intruder.user.uid}`;
  const classRef = doc(owner.db, 'schedule_templates', id);
  await setDoc(classRef, { id, userId: owner.user.uid, title: 'Original class' });
  await setDoc(doc(intruder.db, 'schedule_templates', otherId), { id: otherId, userId: intruder.user.uid, title: 'Foreign class' });
  const ref = (context, userId = owner.user.uid, templateId = id, date = '2026-10-13') => doc(context.db, 'class_attendance', userId, 'classes', templateId, 'records', date);
  const payload = { schemaVersion: 1, userId: owner.user.uid, templateId: id, date: '2026-10-13', status: 'present', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' };
  assert.equal((await getDocFromServer(ref(owner))).exists(), false, 'Owner may read an absent occurrence before transaction creation');
  await setDoc(ref(owner), payload);
  for (const status of ['absent', 'late-or-left', 'present']) {
    await setDoc(ref(owner), { ...payload, status, updatedAt: '2026-10-13T01:00:00Z' });
    assert.equal((await getDocFromServer(ref(owner))).data().status, status);
  }
  await setDoc(classRef, { title: 'Renamed class' }, { merge: true });
  assert.equal((await getDocFromServer(ref(owner))).data().createdAt, payload.createdAt);
  assert.equal((await getDocsFromServer(collection(owner.db, 'class_attendance', owner.user.uid, 'classes', id, 'records'))).size, 1);
  await expectPermissionDenied('foreign attendance read', () => getDocFromServer(ref(intruder)));
  await expectPermissionDenied('foreign attendance history list', () => getDocsFromServer(collection(intruder.db, 'class_attendance', owner.user.uid, 'classes', id, 'records')));
  await expectPermissionDenied('foreign attendance update', () => setDoc(ref(intruder), payload));
  await expectPermissionDenied('foreign class cannot be linked from own attendance', () => setDoc(ref(owner, owner.user.uid, otherId), { ...payload, templateId: otherId }));
  for (const [label, patch] of [
    ['foreign payload owner', { userId: intruder.user.uid }],
    ['mismatched class', { templateId: otherId }],
    ['mismatched occurrence date', { date: '2026-10-14' }],
    ['invalid status', { status: 'unknown' }],
    ['unsupported schema', { schemaVersion: 2 }],
    ['rewritten creation', { createdAt: 'later' }],
    ['unexpected sensitive field', { note: 'not part of attendance' }],
  ]) await expectPermissionDenied(`attendance rejects ${label}`, () => setDoc(ref(owner), { ...payload, ...patch }));
  await expectPermissionDenied('malformed attendance date', () => setDoc(ref(owner, owner.user.uid, id, '2026-99-99'), { ...payload, date: '2026-99-99' }));
  for (const date of ['2026-02-31', '2026-02-29', '2026-04-31', '1900-02-29', '0099-01-01']) {
    await expectPermissionDenied(`nonexistent attendance date ${date}`, () => setDoc(ref(owner, owner.user.uid, id, date), { ...payload, date }));
  }
  for (const date of ['2026-02-28', '2026-04-30', '2024-02-29', '1900-02-28', '2000-02-29']) {
    await setDoc(ref(owner, owner.user.uid, id, date), { ...payload, date });
    assert.equal((await getDocFromServer(ref(owner, owner.user.uid, id, date))).data().date, date);
  }
  await expectPermissionDenied('missing class attendance', () => setDoc(ref(owner, owner.user.uid, 'missing-class'), { ...payload, templateId: 'missing-class' }));
  await expectPermissionDenied('attendance deletion is not exposed', () => deleteDoc(ref(owner)));
  // Removing a class cannot silently erase historical evidence or grant a new write.
  await deleteDoc(classRef);
  assert.equal((await getDocFromServer(ref(owner))).data().status, 'present');
  await expectPermissionDenied('deleted class cannot accept a new attendance', () => setDoc(ref(owner, owner.user.uid, id, '2026-10-14'), { ...payload, date: '2026-10-14' }));
  console.log('Firestore class attendance owner isolation, correction and history rules regression passed.');
}
