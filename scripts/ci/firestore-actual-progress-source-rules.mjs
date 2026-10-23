import assert from 'node:assert/strict';
import { collection, doc, documentId, getDocFromServer, getDocsFromServer, query, runTransaction, setDoc, where } from 'firebase/firestore';

export async function verifyActualProgressSourceRules({ owner, intruder, expectPermissionDenied, projectId, firestoreHost, monthScheduleEvent }) {
  assert.ok(projectId.startsWith('demo-'), 'Actual source fixtures require a demo project');
  assert.match(firestoreHost, /^(127\.0\.0\.1|localhost):\d+$/, 'Actual source fixtures require a loopback emulator');
  const id = 'actual-progress-source-rules';
  const ref = context => doc(context.db, 'actuals', id);
  const source = { kind: 'general-event', sourceId: 'legacy-month-event' };
  const original = { id, userId: owner.user.uid, planId: 'legacy-month-event', occurrenceDate: '2026-10-15',
    actualStartTime: '17:00', actualEndTime: '21:30', title: 'Work', subject: '', note: '', updatedAt: '2026-10-15T00:00:00.000Z' };
  for (const kind of ['study', 'general-event', 'timetable']) {
    const created = { ...original, id: `${id}-${kind}`, progressSource: { kind, sourceId: `source-${kind}`, planType: 'study' } };
    const createdRef = doc(owner.db, 'actuals', created.id);
    await setDoc(createdRef, created);
    const verified = await getDocsFromServer(query(collection(owner.db, 'actuals'),
      where('userId', '==', owner.user.uid), where(documentId(), '==', created.id)));
    assert.equal(verified.size, 1); assert.deepEqual(verified.docs[0].data(), created);
  }
  await setDoc(ref(owner), original);
  await setDoc(ref(owner), { progressSource: source }, { merge: true });
  await setDoc(ref(owner), { planId: null, occurrenceDate: '2026-10-14' }, { merge: true });
  assert.deepEqual((await getDocFromServer(ref(owner))).data().progressSource, source);
  await expectPermissionDenied('foreign Actual source update', () => setDoc(ref(intruder), { progressSource: source }, { merge: true }));
  await expectPermissionDenied('Actual source cannot change owner', () => setDoc(ref(owner), { userId: intruder.user.uid }, { merge: true }));

  const eventRef = doc(owner.db, 'schedule_events', 'month-event:legacy-month-event');
  await setDoc(eventRef, monthScheduleEvent(owner.user.uid));
  await setDoc(ref(owner), original);
  await runTransaction(owner.db, async transaction => {
    const event = await transaction.get(eventRef), actual = await transaction.get(ref(owner));
    assert.equal(event.data().userId, owner.user.uid); assert.equal(actual.data().userId, owner.user.uid);
    transaction.set(ref(owner), { progressSource: source }, { merge: true });
    transaction.delete(eventRef);
  });
  const remaining = await getDocsFromServer(query(collection(owner.db, 'schedule_events'), where('userId', '==', owner.user.uid)));
  assert.equal(remaining.docs.some(row => row.id === eventRef.id), false);
  await expectPermissionDenied('missing source cannot be read under owner Rules', () => getDocFromServer(eventRef));
  assert.deepEqual((await getDocFromServer(ref(owner))).data(), { ...original, progressSource: source });
  await setDoc(eventRef, monthScheduleEvent(owner.user.uid));
  const absentActual = doc(owner.db, 'actuals', 'deleted-after-source-query');
  await expectPermissionDenied('deleted Actual candidate aborts source transaction', () => runTransaction(owner.db, async transaction => {
    await transaction.get(eventRef);
    await transaction.get(absentActual);
    transaction.delete(eventRef);
  }));
  assert.equal((await getDocFromServer(eventRef)).exists(), true);
  console.log('Actual progress provenance create/update, owner isolation and source deletion transaction rules passed.');
}
