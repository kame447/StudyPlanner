import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signOut } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit,
  orderBy, documentId, query, runTransaction, serverTimestamp, setDoc, startAfter, Timestamp, writeBatch,
} from 'firebase/firestore';

// Invoked by the existing demo-only emulator entrypoint; never seeds production.
export async function verifyInquiryRules({ owner, intruder, createContext, contexts, expectPermissionDenied, projectId, firestoreHost }) {
  assert.ok(projectId.startsWith('demo-'), 'Inquiry fixtures require a demo project');
  assert.match(firestoreHost, /^(127\.0\.0\.1|localhost):\d+$/, 'Inquiry fixtures require a loopback emulator');
  const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
  async function seed(collectionName, id, fields) {
    const response = await fetch(`${baseUrl}/${collectionName}/${id}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    assert.equal(response.ok, true, `Emulator fixture seed failed: ${response.status}`);
  }
  const payload = (userId, body = 'アプリ内のお問い合わせ\n続き') => ({ schemaVersion: 1, userId, body, createdAt: serverTimestamp() });
  const sendBatch = (context, id, patch = {}, gatePatch = {}) => {
    const batch = writeBatch(context.db);
    batch.set(doc(context.db, 'support_inquiries', id), { ...payload(context.user.uid), ...patch });
    batch.set(doc(context.db, 'support_inquiry_limits', context.user.uid), { inquiryId: id, submittedAt: serverTimestamp(), ...gatePatch });
    return batch.commit();
  };
  async function sendTransaction(context, id) {
    return runTransaction(context.db, async (transaction) => {
      const ref = doc(context.db, 'support_inquiries', id);
      const saved = await transaction.get(ref);
      if (saved.exists()) {
        assert.equal(saved.data().userId, context.user.uid);
        assert.equal(saved.data().body, payload(context.user.uid).body);
        return;
      }
      const gate = doc(context.db, 'support_inquiry_limits', context.user.uid);
      await transaction.get(gate);
      transaction.set(gate, { inquiryId: id, submittedAt: serverTimestamp() });
      transaction.set(ref, payload(context.user.uid));
    });
  }

  const receipt = randomUUID();
  await expectPermissionDenied('inquiry cannot bypass cooldown gate', () => setDoc(doc(owner.db, 'support_inquiries', receipt), payload(owner.user.uid)));
  await expectPermissionDenied('gate cannot be written without a new inquiry', () => setDoc(doc(owner.db, 'support_inquiry_limits', owner.user.uid), { inquiryId: receipt, submittedAt: serverTimestamp() }));
  for (const [label, patch] of [
    ['foreign owner', { userId: intruder.user.uid }],
    ['empty body', { body: '' }],
    ['whitespace body', { body: ' \n\t ' }],
    ['overlong body', { body: 'あ'.repeat(2001) }],
    ['extra email', { email: 'should-not-be-collected@example.test' }],
    ['forged timestamp', { createdAt: Timestamp.fromMillis(1) }],
    ['unsupported schema', { schemaVersion: 2 }],
  ]) {
    await expectPermissionDenied(`inquiry rejects ${label}`, () => sendBatch(owner, randomUUID(), patch));
  }
  await expectPermissionDenied('inquiry rejects path-like id', () => sendBatch(owner, 'short'));
  await expectPermissionDenied('inquiry rejects mismatched gate', () => sendBatch(owner, randomUUID(), {}, { inquiryId: randomUUID() }));
  await expectPermissionDenied('inquiry rejects forged gate timestamp', () => sendBatch(owner, randomUUID(), {}, { submittedAt: Timestamp.fromMillis(1) }));

  // Two tabs retrying the same operation produce one immutable receipt.
  await Promise.all([sendTransaction(owner, receipt), sendTransaction(owner, receipt)]);
  const first = await getDocFromServer(doc(owner.db, 'support_inquiries', receipt));
  assert.equal(first.exists(), true);
  assert.deepEqual(Object.keys(first.data()).sort(), ['body', 'createdAt', 'schemaVersion', 'userId']);
  const gateBefore = await getDocFromServer(doc(owner.db, 'support_inquiry_limits', owner.user.uid));
  await sendTransaction(owner, receipt);
  const replay = await getDocFromServer(doc(owner.db, 'support_inquiries', receipt));
  assert.deepEqual(replay.data(), first.data(), 'Retry must preserve original timestamp and body');
  assert.deepEqual((await getDocFromServer(doc(owner.db, 'support_inquiry_limits', owner.user.uid))).data(), gateBefore.data(), 'Retry must not consume another cooldown');
  await expectPermissionDenied('fresh inquiry during cooldown', () => sendBatch(owner, randomUUID()));
  await expectPermissionDenied('gate cannot be reset to evade cooldown', () => deleteDoc(doc(owner.db, 'support_inquiry_limits', owner.user.uid)));
  await expectPermissionDenied('cannot mutate received inquiry', () => setDoc(doc(owner.db, 'support_inquiries', receipt), { body: 'changed' }, { merge: true }));
  await expectPermissionDenied('cannot delete received inquiry', () => deleteDoc(doc(owner.db, 'support_inquiries', receipt)));
  await expectPermissionDenied('foreign receipt read', () => getDocFromServer(doc(intruder.db, 'support_inquiries', receipt)));
  await expectPermissionDenied('foreign cooldown read', () => getDocFromServer(doc(intruder.db, 'support_inquiry_limits', owner.user.uid)));
  await expectPermissionDenied('foreign cooldown write', () => setDoc(doc(intruder.db, 'support_inquiry_limits', owner.user.uid), { inquiryId: randomUUID(), submittedAt: serverTimestamp() }));
  await expectPermissionDenied('regular user list', () => getDocsFromServer(query(collection(owner.db, 'support_inquiries'), limit(26))));

  // Aged emulator-only gate permits one of two distinct concurrent new submissions.
  await seed('support_inquiry_limits', owner.user.uid, {
    inquiryId: { stringValue: receipt }, submittedAt: { timestampValue: '2000-01-01T00:00:00Z' },
  });
  const concurrent = await Promise.allSettled([sendTransaction(owner, randomUUID()), sendTransaction(owner, randomUUID())]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = concurrent.find((result) => result.status === 'rejected');
  assert.match(String(rejected.reason.code), /permission-denied/);

  const admin = await createContext('inquiry-admin'); contexts.push(admin);
  await seed('admins', admin.user.uid, { enabled: { booleanValue: true } });
  const inbox = query(collection(admin.db, 'support_inquiries'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(26));
  const inboxPage = await getDocsFromServer(inbox);
  assert.equal(inboxPage.size, 2);
  assert.equal((await getDocFromServer(doc(admin.db, 'support_inquiries', receipt))).exists(), true);
  const last = inboxPage.docs[0];
  const secondPage = await getDocsFromServer(query(collection(admin.db, 'support_inquiries'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), startAfter(last.data().createdAt, last.id), limit(26)));
  assert.equal(secondPage.size, 1);
  await expectPermissionDenied('admin unbounded list', () => getDocsFromServer(collection(admin.db, 'support_inquiries')));
  await expectPermissionDenied('admin excessive page', () => getDocsFromServer(query(collection(admin.db, 'support_inquiries'), limit(27))));
  await expectPermissionDenied('admin cannot edit user inquiry', () => setDoc(doc(admin.db, 'support_inquiries', receipt), { body: 'admin changed' }, { merge: true }));
  await expectPermissionDenied('admin cannot delete user inquiry', () => deleteDoc(doc(admin.db, 'support_inquiries', receipt)));
  await seed('admins', admin.user.uid, { enabled: { booleanValue: false } });
  await expectPermissionDenied('disabled administrator list', () => getDocsFromServer(inbox));

  const unsigned = await createContext('inquiry-unsigned'); contexts.push(unsigned);
  await signOut(unsigned.auth);
  await expectPermissionDenied('signed-out create', () => sendBatch(unsigned, randomUUID()));
  await expectPermissionDenied('signed-out receipt read', () => getDocFromServer(doc(unsigned.db, 'support_inquiries', receipt)));
  console.log('Firestore inquiry authorization, immutable replay, bounded admin reads and cooldown regression passed.');
}
