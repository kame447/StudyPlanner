import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, Timestamp, updateDoc, type Firestore,
} from 'firebase/firestore';

// Client Rules for user_planning_contexts (#382 R1) and the approval operation/item update invariants (#382 R2).
// Prepared for the demo-studyplanner Auth/Firestore emulators; it skips ordinary CI.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-studyplanner';
const enabled = Boolean(authHost && firestoreHost);
const apps: FirebaseApp[] = [];
const run = `${Date.now()}`;
const SCHEMA = 'studyplanner-user-planning-context-cloud-v1';

function address(value: string) {
  const url = new URL(`http://${value}`);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) throw new Error('loopback-emulators-only');
  return { host: url.hostname, port: Number(url.port) };
}
async function seed(path: string, fields: object) {
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  });
  expect(response.status).toBe(200);
}
async function user(label: string, options: { policy: boolean; deleting?: boolean }) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: project }, `planning-context-rules-${label}-${run}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const location = address(firestoreHost!);
  connectFirestoreEmulator(db, location.host, location.port);
  const uid = (await createUserWithEmailAndPassword(auth, `rules-${label}-${run}@example.test`, 'demo-test-password')).user.uid;
  if (options.policy) {
    await seed(`profiles/${uid}`, { weeklyPlanningTracePolicy: { mapValue: { fields: { version: { stringValue: '2026-07-18-v1' } } } } });
  }
  if (options.deleting) await seed(`account_deletions/${uid}`, { userId: { stringValue: uid } });
  return { db, uid };
}
type Actor = Awaited<ReturnType<typeof user>>;
const denied = { code: 'permission-denied' };

const contextDocument = (uid: string, revision: unknown = 1, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: SCHEMA, ownerId: uid, revision, updatedAt: '2026-11-08T00:00:00.000Z',
  snapshot: { version: 1, ownerId: uid, records: [], updatedAt: '2026-11-08T00:00:00.000Z' }, ...overrides,
});

describe.skipIf(!enabled)('user_planning_contexts Rules', () => {
  let owner: Actor; let foreign: Actor; let noPolicy: Actor; let deleting: Actor; let writer: Actor;
  beforeAll(async () => {
    if (project !== 'demo-studyplanner') throw new Error('demo-studyplanner-required');
    address(authHost!); address(firestoreHost!);
    owner = await user('ctx-owner', { policy: true }); foreign = await user('ctx-foreign', { policy: true });
    noPolicy = await user('ctx-nopolicy', { policy: false }); deleting = await user('ctx-deleting', { policy: true, deleting: true });
    writer = await user('ctx-writer', { policy: true });
  });
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
  const ref = (actor: Actor, uid = actor.uid) => doc(actor.db, 'user_planning_contexts', uid);

  it('lets the owner with the accepted policy create (revision 1), read and update; another user cannot read or write it', async () => {
    await setDoc(ref(owner), contextDocument(owner.uid));
    expect((await getDoc(ref(owner))).data()).toMatchObject({ revision: 1 });
    await setDoc(ref(owner), contextDocument(owner.uid, 2));
    expect((await getDoc(ref(owner))).data()).toMatchObject({ revision: 2 });
    await expect(getDoc(ref(foreign, owner.uid))).rejects.toMatchObject(denied);
    await expect(setDoc(ref(foreign, owner.uid), contextDocument(owner.uid, 3))).rejects.toMatchObject(denied);
    await expect(setDoc(ref(foreign, owner.uid), contextDocument(foreign.uid, 3))).rejects.toMatchObject(denied);
    expect((await getDoc(ref(owner))).data()).toMatchObject({ revision: 2 });
  });

  it('allows neither read nor write without the accepted weekly-planning policy', async () => {
    await expect(getDoc(ref(noPolicy))).rejects.toMatchObject(denied);
    await expect(setDoc(ref(noPolicy), contextDocument(noPolicy.uid))).rejects.toMatchObject(denied);
  });

  it.each([
    ['a different schemaVersion', (uid: string) => contextDocument(uid, 1, { schemaVersion: 'other' })],
    ['a missing schemaVersion', (uid: string) => { const { schemaVersion, ...rest } = contextDocument(uid); void schemaVersion; return rest; }],
    ['another ownerId', (uid: string) => contextDocument(uid, 1, { ownerId: 'someone-else' })],
    ['another snapshot owner', (uid: string) => contextDocument(uid, 1, { snapshot: { version: 1, ownerId: 'someone-else', records: [] } })],
    ['revision 0', (uid: string) => contextDocument(uid, 0)],
    ['a fractional revision', (uid: string) => contextDocument(uid, 1.5)],
    ['a string revision', (uid: string) => contextDocument(uid, '1')],
  ])('rejects %s on create', async (_label, build) => {
    await expect(setDoc(ref(writer), build(writer.uid))).rejects.toMatchObject(denied);
    expect((await getDoc(ref(writer))).exists()).toBe(false);
  });

  it('rejects an invalid update and never deletes, even for the owner', async () => {
    const own = await user('ctx-update', { policy: true });
    await setDoc(ref(own), contextDocument(own.uid));
    await expect(setDoc(ref(own), contextDocument(own.uid, 2, { ownerId: 'someone-else' }))).rejects.toMatchObject(denied);
    await expect(setDoc(ref(own), contextDocument(own.uid, 0))).rejects.toMatchObject(denied);
    await expect(deleteDoc(ref(own))).rejects.toMatchObject(denied);
    expect((await getDoc(ref(own))).data()).toMatchObject({ revision: 1 });
  });

  it('cannot update once account deletion has started', async () => {
    // The document exists before deletion starts, as for an account that used long-term memory earlier.
    const early = await user('ctx-deleting-early', { policy: true });
    await setDoc(ref(early), contextDocument(early.uid));
    await seed(`account_deletions/${early.uid}`, { userId: { stringValue: early.uid } });
    await expect(setDoc(ref(early), contextDocument(early.uid, 2))).rejects.toMatchObject(denied);
    await expect(setDoc(ref(deleting), contextDocument(deleting.uid))).rejects.toMatchObject(denied);
    expect((await getDoc(ref(early))).data()).toMatchObject({ revision: 1 });
  });
});

describe.skipIf(!enabled)('weekly planning approval operation and item update Rules', () => {
  let owner: Actor; let foreign: Actor;
  beforeAll(async () => {
    if (project !== 'demo-studyplanner') throw new Error('demo-studyplanner-required');
    owner = await user('approval-owner', { policy: false }); foreign = await user('approval-foreign', { policy: false });
  });
  const operationFields = (uid: string, id: string, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1, userId: uid, approvalOperationId: id, status: 'active', savedItemCount: 1, expectedItemCount: 3,
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', ...overrides,
  });
  const itemFields = (uid: string, id: string, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1, userId: uid, approvalOperationId: id, sourceDraftBlockId: 'block-1', savedPlanId: 'plan-1',
    status: 'saved', expiresAt: Timestamp.fromDate(new Date('2027-01-01T00:00:00Z')), updatedAt: '2026-11-08T00:00:00.000Z', ...overrides,
  });
  let counter = 0;
  async function operation(actor: Actor, overrides: Record<string, unknown> = {}) {
    const id = `weekly-approval-${actor.uid}-${run}-${++counter}`;
    const ref = doc(actor.db, 'weekly_planning_approval_operations', id);
    await setDoc(ref, operationFields(actor.uid, id, overrides));
    return ref;
  }
  const status = async (ref: ReturnType<typeof doc>) => (await getDoc(ref)).data();

  it('lets the owner raise savedItemCount and complete the operation, but never lower the count', async () => {
    const ref = await operation(owner);
    await updateDoc(ref, { savedItemCount: 2, updatedAt: 'later' });
    await expect(updateDoc(ref, { savedItemCount: 1 })).rejects.toMatchObject(denied);
    expect(await status(ref)).toMatchObject({ savedItemCount: 2, status: 'active' });
    await expect(updateDoc(ref, { status: 'completed', savedItemCount: 3, expectedItemCount: 4, completedAt: 'done' })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { status: 'completed', savedItemCount: 3, expectedItemCount: 3 })).rejects.toMatchObject(denied);
    await updateDoc(ref, { status: 'completed', savedItemCount: 3, expectedItemCount: 3, completedAt: 'done' });
    expect(await status(ref)).toMatchObject({ status: 'completed', savedItemCount: 3 });
  });

  it('does not let a completed operation return to active or lose its count', async () => {
    const ref = await operation(owner, { status: 'completed', savedItemCount: 3, expectedItemCount: 3, completedAt: 'done' });
    await expect(updateDoc(ref, { status: 'active' })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { savedItemCount: 2, expectedItemCount: 2 })).rejects.toMatchObject(denied);
    await updateDoc(ref, { updatedAt: 'touched', expiresAt: Timestamp.fromDate(new Date('2027-02-01T00:00:00Z')) });
    expect(await status(ref)).toMatchObject({ status: 'completed', savedItemCount: 3 });
  });

  it('keeps identity, creation time and the allowed field set of an operation unchanged', async () => {
    const ref = await operation(owner);
    await expect(updateDoc(ref, { createdAt: '2030-01-01T00:00:00.000Z' })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { approvalOperationId: 'another-id' })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { schemaVersion: 2 })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { userId: foreign.uid })).rejects.toMatchObject(denied);
    await expect(updateDoc(ref, { unlistedField: 'value' })).rejects.toMatchObject(denied);
    expect(await status(ref)).toMatchObject({ approvalOperationId: ref.id, createdAt: '2026-11-08T00:00:00.000Z', schemaVersion: 1 });
  });

  it('never deletes an operation and lets another user neither update nor read it', async () => {
    const ref = await operation(owner);
    await expect(deleteDoc(ref)).rejects.toMatchObject(denied);
    const other = doc(foreign.db, ref.path);
    await expect(updateDoc(other, { savedItemCount: 2 })).rejects.toMatchObject(denied);
    await expect(getDoc(other)).rejects.toMatchObject(denied);
    expect(await status(ref)).toMatchObject({ savedItemCount: 1 });
  });

  it('cannot update an operation once account deletion has started', async () => {
    const early = await user('approval-early-deleting', { policy: false });
    const ref = await operation(early);
    await seed(`account_deletions/${early.uid}`, { userId: { stringValue: early.uid } });
    await expect(updateDoc(ref, { savedItemCount: 2 })).rejects.toMatchObject(denied);
  });

  it('lets an item change only updatedAt and a not-earlier expiresAt, and never delete it', async () => {
    const ref = await operation(owner);
    const item = doc(collection(ref, 'weekly_planning_approval_items'), 'item-1');
    await setDoc(item, itemFields(owner.uid, ref.id));
    const later = Timestamp.fromDate(new Date('2027-03-01T00:00:00Z'));
    await updateDoc(item, { updatedAt: 'touched', expiresAt: later });
    expect((await getDoc(item)).data()).toMatchObject({ updatedAt: 'touched', expiresAt: later });
    await expect(updateDoc(item, { expiresAt: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')) })).rejects.toMatchObject(denied);
    for (const changes of [{ savedPlanId: 'plan-2' }, { sourceDraftBlockId: 'block-2' }, { approvalOperationId: 'other' },
      { status: 'removed' }, { schemaVersion: 2 }, { userId: foreign.uid }, { extra: true }]) {
      await expect(updateDoc(item, changes)).rejects.toMatchObject(denied);
    }
    await expect(deleteDoc(item)).rejects.toMatchObject(denied);
    expect((await getDoc(item)).data()).toMatchObject({ savedPlanId: 'plan-1', status: 'saved', expiresAt: later });
  });
});
