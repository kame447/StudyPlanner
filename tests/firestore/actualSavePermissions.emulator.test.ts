import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, documentId, getDocFromServer,
  getDocsFromServer, getFirestore, query, setDoc, terminate, where, type Firestore,
} from 'firebase/firestore';
import { createFirebasePlannerRepository } from '../../src/repositories/firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from '../../src/repositories/firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from '../../src/repositories/scheduleEventAuthorityRepository';
import type { Actual, MonthEvent } from '../../src/types/domain';
import { createConfirmedStudyHistory } from '../../src/repositories/confirmedStudyHistory';

// A deterministic interleaving hook; every read/write still uses the real SDK
// against the loopback Emulator and unchanged owner Rules.
const queryReads = vi.hoisted(() => ({ afterRead: null as null | ((snapshot: { docs: readonly { id: string }[] }) => Promise<void>) }));
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>();
  return { ...sdk, getDocs: async (...args: Parameters<typeof sdk.getDocs>) => {
    const snapshot = await sdk.getDocs(...args);
    await queryReads.afterRead?.(snapshot);
    return snapshot;
  } };
});

// This is an actual SDK + Rules boundary, never a live Firebase project.
// All names, dates and times below are synthetic regression fixtures.
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-studyplanner';
const clients: Array<{ app: FirebaseApp; db: Firestore }> = [];
const stamp = '2026-09-10T00:00:00.000Z';
let sequence = 0;
function client(userId?: string) {
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !projectId.startsWith('demo-')) {
    throw new Error('Explicit loopback Firestore emulator and demo project required.');
  }
  const app = initializeApp({ projectId, apiKey: 'demo-key' }, `actual-save-${Date.now()}-${sequence++}`);
  const db = getFirestore(app);
  const [address, port] = host.split(':');
  connectFirestoreEmulator(db, address, Number(port), userId ? { mockUserToken: { sub: userId } } : undefined);
  clients.push({ app, db });
  return db;
}
function actual(userId: string, id: string, planId: string | null = null): Actual {
  return { id, userId, planId, occurrenceDate: '2026-09-10', actualStartTime: '14:00',
    actualEndTime: '17:30', title: 'Synthetic general event', subject: '主要予定', isAlignedToPlan: true,
    note: '', updatedAt: stamp };
}
function event(userId: string, id: string, recurring: boolean): MonthEvent {
  return { id, userId, title: 'Synthetic general event', date: recurring ? '2026-09-03' : '2026-09-10',
    endDate: recurring ? '2026-09-03' : '2026-09-10', startTime: '14:00', endTime: '17:30',
    repeat: recurring ? 'weekly' : 'none', repeatUntil: null, excludedDates: [],
    memo: '', url: '', checklist: [], locationTags: [], createdAt: stamp, updatedAt: stamp };
}
const exactRange = (db: Firestore, userId: string, id: string) => query(collection(db, 'actuals'),
  where('userId', '==', userId), where(documentId(), '>=', id), where(documentId(), '<=', id));

describe.skipIf(!host)('Actual first save through real Firestore repository and owner Rules', () => {
  let ownerDb: Firestore, foreignDb: Firestore;
  const owner = `actual-owner-${Date.now()}`, foreign = `actual-foreign-${Date.now()}`;
  beforeAll(() => { ownerDb = client(owner); foreignDb = client(foreign); });
  afterEach(() => { queryReads.afterRead = null; });
  afterAll(async () => { await Promise.all(clients.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); })); });

  it('reproduces the absent equality-target failure and permits only the exact owner range', async () => {
    const id = 'absent-first-save-probe';
    await expect(getDocsFromServer(query(collection(ownerDb, 'actuals'), where('userId', '==', owner),
      where(documentId(), '==', id)))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDocsFromServer(exactRange(ownerDb, owner, id))).empty).toBe(true);
    await setDoc(doc(ownerDb, 'actuals', `${id}-neighbor`), actual(owner, `${id}-neighbor`));
    expect((await getDocsFromServer(exactRange(ownerDb, owner, id))).empty).toBe(true);
  });

  it.each(['actual', 'material'] as const)('creates a first standalone record via %s API and rereads it', async api => {
    const repository = createFirebasePlannerRepository(ownerDb);
    const input = actual(owner, `first-${api}`);
    const saved = api === 'actual' ? await repository.upsertActual(input)
      : await repository.upsertActualWithMaterialProgress({ actual: input, materials: [{
        id: 'first-material', userId: owner, name: 'Book', subjectId: '', subjectName: '',
        status: 'active', paceEnabled: true, currentUnit: 5, createdAt: stamp, updatedAt: stamp,
      }] });
    expect(saved).toMatchObject(input);
    expect((await getDocFromServer(doc(ownerDb, 'actuals', input.id))).data()).toMatchObject(input);
    if (api === 'material') expect((await getDocFromServer(doc(ownerDb, 'study_materials', 'first-material'))).data()?.currentUnit).toBe(5);
  });

  it.each([false, true])('creates, edits, reuses occurrence identity and unlinks a major-event record (recurring=%s)', async recurring => {
    const repository = createScheduleEventBackedPlannerRepository(createFirebasePlannerRepository(ownerDb), createFirebaseScheduleEventAuthority(ownerDb));
    const source = event(owner, `event-${recurring}`, recurring);
    await repository.upsertMonthEvent(source);
    const input = actual(owner, `first-event-${recurring}`, source.id);
    const saved = await repository.upsertActualWithMaterialProgress({ actual: input, materials: [] });
    expect(saved.progressSource).toEqual({ kind: 'general-event', sourceId: source.id });
    const edited = await repository.upsertActual({ ...input, id: 'provisional-' + input.id, note: 'edited' });
    expect(edited.id).toBe(saved.id);
    const unlinked = await repository.upsertActual({ ...edited, planId: null, occurrenceDate: '2026-09-09' });
    expect(unlinked.progressSource).toEqual(saved.progressSource);
    expect((await getDocFromServer(doc(ownerDb, 'actuals', saved.id))).data()).toMatchObject(unlinked);
    const rows = await repository.getActuals(owner);
    expect(rows.filter(row => row.id === saved.id)).toHaveLength(1);
  });

  it('finds an existing legacy document without stored id and preserves provenance on edit', async () => {
    const input = actual(owner, 'legacy-without-id');
    const { id, ...legacy } = input;
    const progressSource = { kind: 'general-event', sourceId: 'deleted-source' };
    await setDoc(doc(ownerDb, 'actuals', id), { ...legacy, progressSource });
    const saved = await createFirebasePlannerRepository(ownerDb).upsertActual({ ...input, note: 'edited legacy' });
    expect(saved.progressSource).toEqual(progressSource);
    expect((await getDocFromServer(doc(ownerDb, 'actuals', id))).data()?.progressSource).toEqual(progressSource);
  });

  it('does not expose or overwrite a foreign-owned target even when its ID collides', async () => {
    const input = actual(foreign, 'foreign-target');
    await setDoc(doc(foreignDb, 'actuals', input.id), input);
    expect((await getDocsFromServer(exactRange(ownerDb, owner, input.id))).empty).toBe(true);
    await expect(getDocsFromServer(exactRange(ownerDb, foreign, input.id))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(createFirebasePlannerRepository(ownerDb).upsertActual({ ...input, userId: owner })).rejects.toThrow('permission-denied');
    expect((await getDocFromServer(doc(foreignDb, 'actuals', input.id))).data()).toEqual(input);
  });

  it('matches full-history duplicate winners with legacy dates, old occurrences and owner isolation without certifying a partial read', async () => {
    const receipt = createConfirmedStudyHistory(() => '2026-09-10');
    receipt.confirmMigration(owner);
    const clean = { fromCache: false, hasPendingWrites: false };
    receipt.beginRead(owner, 'plans')([], clean);
    receipt.beginRead(owner, 'monthEvents')([], clean);
    const repository = createFirebasePlannerRepository(ownerDb, receipt);
    const linkedPlan = 'targeted-recurring-source';
    const winner = { ...actual(owner, 'targeted-legacy-winner', linkedPlan), occurrenceDate: '2000-01-03', updatedAt: '2026-09-11T00:00:00.000Z' };
    const loser = { ...actual(owner, 'targeted-older-duplicate', linkedPlan), occurrenceDate: winner.occurrenceDate };
    const { id, occurrenceDate, ...legacy } = winner;
    const otherOccurrence = { ...actual(owner, 'targeted-old-occurrence', linkedPlan), occurrenceDate: '1999-12-27' };
    const foreignRow = { ...actual(foreign, 'targeted-foreign', linkedPlan), occurrenceDate, updatedAt: '2026-09-12T00:00:00.000Z' };
    await Promise.all([
      setDoc(doc(ownerDb, 'actuals', id), { ...legacy, date: occurrenceDate }),
      setDoc(doc(ownerDb, 'actuals', loser.id), loser),
      setDoc(doc(ownerDb, 'actuals', otherOccurrence.id), otherOccurrence),
      setDoc(doc(foreignDb, 'actuals', foreignRow.id), foreignRow),
    ]);
    const selected = await repository.getActualForWritePreparation!(owner, id);
    expect(selected).toMatchObject(winner);
    expect(await repository.getActualForWritePreparation!(owner, loser.id)).toBeUndefined();
    expect(await repository.getActualForWritePreparation!(owner, foreignRow.id)).toBeUndefined();
    expect(await repository.getActualForWritePreparation!(owner, otherOccurrence.id)).toMatchObject(otherOccurrence);
    expect(receipt.read(owner, { plans: [], actuals: [selected!], monthEvents: [] }, '2026-09-10')).toBeNull();
    const complete = await repository.getActuals(owner);
    expect(complete.find(row => row.id === id)).toEqual(selected);
    expect(complete.some(row => row.id === loser.id || row.id === foreignRow.id)).toBe(false);
  });

  it('fails closed before stale unlink writes when the real ID read is followed by deletion or relinking', async () => {
    for (const change of ['delete', 'relink'] as const) {
      const input = { ...actual(owner, `targeted-race-${change}`, `source-${change}`),
        progressSource: { kind: 'general-event' as const, sourceId: `source-${change}` } };
      await setDoc(doc(ownerDb, 'actuals', input.id), input);
      const materialId = `targeted-material-${change}`;
      await setDoc(doc(ownerDb, 'study_materials', materialId), { userId: owner, currentUnit: 5 });
      const raw = createFirebasePlannerRepository(ownerDb);
      const repository = createScheduleEventBackedPlannerRepository(raw, createFirebaseScheduleEventAuthority(ownerDb));
      let interleaved = false;
      queryReads.afterRead = async snapshot => {
        if (interleaved || !snapshot.docs.some(row => row.id === input.id)) return;
        interleaved = true;
        queryReads.afterRead = null;
        if (change === 'delete') await deleteDoc(doc(ownerDb, 'actuals', input.id));
        else await setDoc(doc(ownerDb, 'actuals', input.id), { ...input, planId: 'changed-source' });
      };
      await expect(repository.upsertActualWithMaterialProgress({ actual: actual(owner, input.id), materials: [{
        id: materialId, userId: owner, name: 'Book', subjectId: '', subjectName: '',
        status: 'active', paceEnabled: true, currentUnit: 999, createdAt: stamp, updatedAt: stamp,
      }] })).rejects.toThrow('再読み込み');
      expect(interleaved).toBe(true);
      const after = await getDocsFromServer(exactRange(ownerDb, owner, input.id));
      if (change === 'delete') expect(after.empty).toBe(true);
      else expect(after.docs[0]?.data()).toMatchObject({ ...input, planId: 'changed-source' });
      expect((await getDocFromServer(doc(ownerDb, 'study_materials', materialId))).data()?.currentUnit).toBe(5);
    }
  });

  it('rejects unauthenticated first-save queries and writes', async () => {
    const db = client();
    await expect(getDocsFromServer(exactRange(db, owner, 'unauthenticated'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(createFirebasePlannerRepository(db).upsertActual(actual(owner, 'unauthenticated'))).rejects.toThrow('permission-denied');
  });
});
