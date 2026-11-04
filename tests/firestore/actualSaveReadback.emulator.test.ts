import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { collection, connectFirestoreEmulator, doc, getFirestore, setDoc, terminate, type Firestore } from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import { createFirebaseActualSaveReadback } from '../../src/repositories/firebaseActualSaveReadback';
import { ActualSaveReadbackUnknownError, type ActualSaveIntentRecord } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextActualSaveReadback';
import { readAndClassifyActualSaveFromServer } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextActualSaveServerReadback';
import { vnextActualRecordId } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-studyplanner';
const sessions: Array<{ app: FirebaseApp; db: Firestore }> = [];
let sequence = 0;
function client(uid: string): Firestore {
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !projectId.startsWith('demo-')) {
    throw new Error('Explicit loopback Firestore emulator and demo project required.');
  }
  const app = initializeApp({ projectId, apiKey: 'demo-key' }, `a2-readback-${Date.now()}-${sequence++}`);
  const db = getFirestore(app);
  const [address, port] = host.split(':');
  connectFirestoreEmulator(db, address, Number(port), { mockUserToken: { sub: uid } });
  sessions.push({ app, db });
  return db;
}
const auth = (uid: string) => ({ currentUser: { uid } } as Auth);
const attemptedFor = (uid: string, subject: string, minutes: number): ActualSaveIntentRecord => {
  const occurrenceDate = '2026-10-26';
  return { id: vnextActualRecordId(uid, occurrenceDate, subject), occurrenceDate, subject, minutes };
};
const saved = (uid: string, record: ActualSaveIntentRecord) => ({ userId: uid, planId: null,
  occurrenceDate: record.occurrenceDate, subject: record.subject, actualDurationMinutes: record.minutes,
  note: '', updatedAt: '2026-10-27T00:00:00.000Z' });

describe.skipIf(!host)('A2 readback: real Firestore SDK and owner Rules', () => {
  const owner = `a2-owner-${Date.now()}`;
  const foreign = `a2-foreign-${Date.now()}`;
  let ownerDb: Firestore, foreignDb: Firestore;
  beforeAll(() => { ownerDb = client(owner); foreignDb = client(foreign); });
  afterAll(async () => { await Promise.all(sessions.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); })); });

  it('reads only the owner’s exact IDs from the server, including absent documents', async () => {
    const own = attemptedFor(owner, '数学', 60);
    const absent = attemptedFor(owner, '英語', 45);
    const collision = attemptedFor(owner, '化学', 90);
    await setDoc(doc(ownerDb, 'actuals', own.id), saved(owner, own));
    // The same document ID exists but belongs to someone else; the owner query must omit it.
    await setDoc(doc(foreignDb, 'actuals', collision.id), saved(foreign, collision));
    const readConfirmed = createFirebaseActualSaveReadback(ownerDb, auth(owner));
    const server = await readConfirmed(owner, [own.id, absent.id, collision.id]);
    expect(server).toMatchObject({ fromCache: false, hasPendingWrites: false });
    expect(server.records.map(record => record.id)).toEqual([own.id]);
    const result = await readAndClassifyActualSaveFromServer({ firestoreDb: ownerDb, firebaseAuth: auth(owner),
      ownerId: owner, attempted: [own, absent, collision] });
    expect(result.status).toBe('partial');
    expect(result.confirmedIds).toEqual([own.id]);
    expect(result.unconfirmedRecords.map(record => record.id)).toEqual([absent.id, collision.id]);
    expect(result.conflictingIds).toEqual([]);
  });

  it('treats a mismatched authenticated SDK user as permission-denied, never as absent', async () => {
    const probe = attemptedFor(owner, '物理', 30);
    // The local auth claim is deliberately stale; Rules see the foreign SDK token.
    const readConfirmed = createFirebaseActualSaveReadback(foreignDb, auth(owner));
    await expect(readConfirmed(owner, [probe.id])).rejects.toMatchObject({
      name: 'ActualSaveReadbackUnknownError', reason: 'permission_denied',
    });
    await expect(createFirebaseActualSaveReadback(ownerDb, auth(foreign))(owner, [probe.id]))
      .rejects.toBeInstanceOf(ActualSaveReadbackUnknownError);
  });
});
