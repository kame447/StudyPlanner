import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
  serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, terminate, type Firestore } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-studyplanner';
const apps: Array<{ app: FirebaseApp; db: Firestore }> = [];
function client(uid: string) {
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !project.startsWith('demo-')) throw new Error('Loopback emulator + demo project required');
  const app = initializeApp({ projectId: project, apiKey: 'demo-key' }, `deletion-rules-${uid}`), db = getFirestore(app);
  const [address, port] = host.split(':');
  connectFirestoreEmulator(db, address, Number(port), { mockUserToken: { sub: uid } });
  apps.push({ app, db }); return db;
}
async function tombstone(uid: string) {
  const result = await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents/account_deletions/${uid}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { uid: { stringValue: uid }, status: { stringValue: 'deleting' } } }),
  });
  expect(result.ok).toBe(true);
}

describe.skipIf(!host)('account deletion tombstone Rules', () => {
  const uid = `deleting-rules-${Date.now()}`, other = `${uid}-other`;
  let db: Firestore, otherDb: Firestore;
  beforeAll(() => { db = client(uid); otherDb = client(other); });
  afterAll(async () => { await Promise.all(apps.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); })); });

  it('preserves valid owner writes, then denies creates, updates and a batch after the tombstone; B remains writable', async () => {
    const collections = ['plans', 'actuals', 'day_notes', 'month_events', 'todos', 'study_subjects',
      'study_materials', 'schedule_templates', 'timetable_terms', 'timetable_periods'];
    for (const name of collections) await setDoc(doc(db, name, uid), { userId: uid, title: 'before' });
    await setDoc(doc(db, 'profiles', uid), { id: uid, username: 'before', registeredAt: serverTimestamp() });
    await setDoc(doc(db, 'study_rest_days', uid), { schemaVersion: 1, userId: uid, revision: 1, dates: ['2026-10-29'] });
    await setDoc(doc(db, 'announcement_reads', uid), { through: Timestamp.fromMillis(1) });
    await tombstone(uid);
    for (const name of collections) {
      await expect(setDoc(doc(db, name, `${uid}-new`), { userId: uid, title: 'after' })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(doc(db, name, uid), { title: 'after' })).rejects.toMatchObject({ code: 'permission-denied' });
      await setDoc(doc(otherDb, name, other), { userId: other });
    }
    await expect(updateDoc(doc(db, 'profiles', uid), { username: 'after' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(db, 'study_rest_days', uid), { schemaVersion: 1, userId: uid, revision: 2, dates: ['2026-10-29', '2026-10-30'] })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(db, 'announcement_reads', uid), { through: Timestamp.fromMillis(2) })).rejects.toMatchObject({ code: 'permission-denied' });
    const batch = writeBatch(db);
    batch.set(doc(db, 'todos', `${uid}-batch`), { userId: uid });
    batch.update(doc(db, 'actuals', uid), { title: 'batch' });
    await expect(batch.commit()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDocFromServer(doc(db, 'actuals', uid))).data()?.title).toBe('before');
    const inquiry = writeBatch(db), id = `inquiry-${uid}`;
    inquiry.set(doc(db, 'support_inquiries', id), { schemaVersion: 1, userId: uid, body: 'synthetic', createdAt: serverTimestamp() });
    inquiry.set(doc(db, 'support_inquiry_limits', uid), { inquiryId: id, submittedAt: serverTimestamp() });
    await expect(inquiry.commit()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDocFromServer(doc(db, 'account_deletions', uid))).exists()).toBe(true);
    await expect(getDocFromServer(doc(otherDb, 'account_deletions', uid))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDocsFromServer(collection(db, 'account_deletions'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(db, 'account_deletions', uid), { status: 'completed' })).rejects.toMatchObject({ code: 'permission-denied' });
  }, 60_000);
  it('also prevents profile creation when no profile remains', async () => {
    const fresh = `${uid}-missing-profile`, freshDb = client(fresh);
    await tombstone(fresh);
    await expect(setDoc(doc(freshDb, 'profiles', fresh), { id: fresh, registeredAt: serverTimestamp() })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
