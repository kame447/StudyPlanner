import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { createFirestoreConversationStore, CONVERSATION_COLLECTION } from '../../src/features/weeklyPlanning/vnext/sync/weeklyPlanningConversationFirestore';
import type { ConversationOperation, ConversationPayload, ConversationScope } from '../../src/features/weeklyPlanning/vnext/sync/weeklyPlanningConversationSync';
import { createInitialPlanningState } from '../../src/features/weeklyPlanning/weeklyPlanningReducer';
import { createEmptyWeeklyPlanningVNextState } from '../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { serializeWeeklyPlanningVNextSessionCheckpoint } from '../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-studyplanner';
const enabled = Boolean(authHost && firestoreHost);
const apps: FirebaseApp[] = [];
const run = `${Date.now()}`;
const password = 'synthetic-sync-password';
function address(value: string) {
  const url = new URL(`http://${value}`);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) throw new Error('loopback-emulators-only');
  return { host: url.hostname, port: Number(url.port) };
}
async function device(label: string, account?: { email: string }) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: project }, `conversation-sync-${label}-${run}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app); const location = address(firestoreHost!);
  connectFirestoreEmulator(db, location.host, location.port);
  const email = account?.email ?? `sync-${label}-${run}@example.test`;
  const credential = account ? await signInWithEmailAndPassword(auth, email, password)
    : await createUserWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  return { db, auth, email, uid, store: createFirestoreConversationStore(db, uid, () => auth.currentUser?.uid === uid) };
}
async function seed(path: string, fields: object) {
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  });
  expect(response.status).toBe(200);
}
async function acceptPolicy(uid: string) {
  await seed(`profiles/${uid}`, { weeklyPlanningTracePolicy: { mapValue: { fields: { version: { stringValue: '2026-07-18-v1' } } } } });
}
function operation(ownerId: string, name: string, baseRevision = 0): ConversationOperation {
  const scope: ConversationScope = { ownerId, chatId: `ai-chat-${name}`, weekStartDate: '2026-11-02', conversationId: `conversation-${name}` };
  const state = createInitialPlanningState(scope.weekStartDate);
  state.messages = [{ id: `${name}-message`, role: 'user', content: name, createdAt: '2026-11-07T00:00:00.000Z' }];
  const core = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId, weekStartDate: scope.weekStartDate,
    conversationId: scope.conversationId, savedAt: '2026-11-07T00:00:00.000Z',
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] } });
  const payload: ConversationPayload = { core, title: name, ui: JSON.stringify({ ownerId,
    conversationId: scope.conversationId, payload: { version: 2, state } }) };
  return { scope, payload, baseRevision, operationId: `operation-${name}-${baseRevision}` };
}

describe.skipIf(!enabled)('VNext shared conversation through real Auth, Firestore transactions and Rules', () => {
  let a: Awaited<ReturnType<typeof device>>;
  let b: Awaited<ReturnType<typeof device>>;
  let foreign: Awaited<ReturnType<typeof device>>;
  beforeAll(async () => {
    if (project !== 'demo-studyplanner') throw new Error('demo-studyplanner-required');
    address(authHost!); address(firestoreHost!);
    a = await device('a'); b = await device('b', a); foreign = await device('foreign');
    await acceptPolicy(a.uid); await acceptPolicy(foreign.uid);
  });
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
  it('restores on a second signed-in device and acknowledges the same operation once', async () => {
    const op = operation(a.uid, 'restore');
    const first = await a.store.commit(op);
    expect(first.status).toBe('accepted');
    expect(await b.store.read(op.scope)).toEqual(first.snapshot);
    expect(await b.store.commit(op)).toEqual(first);
    expect((await a.store.list()).items.some(row => row.operationId === op.operationId)).toBe(true);
  });
  it('two concurrent devices cannot both replace the same revision', async () => {
    const seedOp = operation(a.uid, 'concurrent'); await a.store.commit(seedOp);
    const first = { ...seedOp, operationId: 'from-a', baseRevision: 1, payload: { ...seedOp.payload!, title: 'A' } };
    const second = { ...seedOp, operationId: 'from-b', baseRevision: 1, payload: { ...seedOp.payload!, title: 'B' } };
    const results = await Promise.all([a.store.commit(first), b.store.commit(second)]);
    expect(results.map(result => result.status).sort()).toEqual(['accepted', 'conflict']);
    expect((await b.store.read(seedOp.scope))?.revision).toBe(2);
  });
  it('foreign users cannot read conversations or discover their absence', async () => {
    for (const name of ['restore', 'never-existed']) {
      await expect(foreign.store.read(operation(a.uid, name).scope)).rejects.toThrow('owner-changed');
      const ref = doc(foreign.db, CONVERSATION_COLLECTION, a.uid, 'sessions', `ai-chat-${name}.2026-11-02`);
      const { getDocFromServer } = await import('firebase/firestore');
      await expect(getDocFromServer(ref)).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('Rules reject stale direct writes, altered identity and physical removal', async () => {
    const op = operation(a.uid, 'rules'); await a.store.commit(op);
    const ref = doc(a.db, CONVERSATION_COLLECTION, a.uid, 'sessions', 'ai-chat-rules.2026-11-02');
    const value = { schemaVersion: 1, ...op.scope, revision: 1, operationId: 'different', deleted: false,
      payload: JSON.stringify(op.payload), updatedAt: serverTimestamp() };
    await expect(setDoc(ref, value)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(ref, { ...value, revision: 2, conversationId: 'changed' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(deleteDoc(ref)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('a tombstone cannot be resurrected by an older device, even with a newer guessed revision', async () => {
    const op = operation(a.uid, 'deleted'); await a.store.commit(op);
    await a.store.commit({ ...op, operationId: 'delete', baseRevision: 1, payload: null });
    expect((await b.store.commit({ ...op, operationId: 'late', baseRevision: 1 })).status).toBe('conflict');
    const ref = doc(a.db, CONVERSATION_COLLECTION, a.uid, 'sessions', 'ai-chat-deleted.2026-11-02');
    await expect(setDoc(ref, { schemaVersion: 1, ...op.scope, revision: 3, operationId: 'resurrect',
      deleted: false, payload: JSON.stringify(op.payload), updatedAt: serverTimestamp() })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('requires policy acceptance and denies new writes after account deletion begins', async () => {
    const user = await device('deleting'); const op = operation(user.uid, 'policy');
    await expect(user.store.commit(op)).rejects.toMatchObject({ code: 'permission-denied' });
    await acceptPolicy(user.uid); expect((await user.store.commit(op)).status).toBe('accepted');
    await seed(`account_deletions/${user.uid}`, { status: { stringValue: 'deleting' } });
    await expect(user.store.read(op.scope)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(user.store.commit({ ...op, baseRevision: 1, operationId: 'after-delete' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
