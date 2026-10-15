import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Actual, StudyMaterial } from '../types/domain';
import { actual } from './localPersistenceConcurrency.testUtils';

type Ref = { collectionName: string; id: string };
type Operation = { ref: Ref; value?: Record<string, unknown>; merge?: boolean };
const sdk = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  beforeTransaction: () => {},
  failCommit: false,
  transactions: [] as Operation[][],
  reads: [] as string[],
  getDocs: vi.fn(),
}));
vi.mock('firebase/firestore', () => {
  const key = (ref: Ref) => `${ref.collectionName}/${ref.id}`;
  const apply = (operations: Operation[]) => {
    if (sdk.failCommit) throw new Error('synthetic transaction failure');
    for (const { ref, value } of operations) {
      const old = sdk.rows.get(key(ref));
      if (old?.userId !== undefined && old.userId !== 'owner'
        || value?.userId !== undefined && value.userId !== 'owner') {
        throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
      }
    }
    for (const { ref, value, merge } of operations) {
      if (value) sdk.rows.set(key(ref), structuredClone(merge ? { ...sdk.rows.get(key(ref)), ...value } : value));
      else sdk.rows.delete(key(ref));
    }
  };
  const writer = (operations: Operation[]) => ({
    set: (ref: Ref, value: Record<string, unknown>, options?: { merge: boolean }) => { operations.push({ ref, value, merge: options?.merge }); },
    delete: (ref: Ref) => { operations.push({ ref }); },
  });
  return {
    collection: (_db: unknown, name: string) => ({ name }),
    doc: (_db: unknown, collectionName: string, id: string) => ({ collectionName, id }),
    where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    query: (collection: { name: string }, ...conditions: unknown[]) => ({ ...collection, conditions }),
    deleteField: () => null,
    documentId: () => '__name__',
    getDocs: sdk.getDocs,
    getDocsFromServer: sdk.getDocs,
    deleteDoc: async (ref: Ref) => apply([{ ref }]),
    setDoc: async (ref: Ref, value: Record<string, unknown>, options?: { merge: boolean }) => apply([{ ref, value, merge: options?.merge }]),
    writeBatch: () => { const operations: Operation[] = []; return { ...writer(operations), commit: async () => apply(operations) }; },
    runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
      sdk.beforeTransaction();
      const operations: Operation[] = [];
      const result = await callback({ ...writer(operations), get: async (ref: Ref) => {
        if (operations.length) throw new Error('transaction read after write');
        sdk.reads.push(key(ref));
        const row = sdk.rows.get(key(ref));
        // Existing owner-only Rules deny a read of a missing or foreign Actual.
        if (!row || row.userId !== 'owner') throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
        return { id: ref.id, exists: () => true, data: () => structuredClone(row) };
      } });
      apply(operations); sdk.transactions.push(operations); return result;
    },
  };
});
import { createFirebasePlannerRepository } from './firebasePlannerRepository';

const eventSource = { kind: 'general-event' as const, sourceId: 'event' };
const studySource = { kind: 'study' as const, sourceId: 'study' };
const repository = () => createFirebasePlannerRepository({} as Firestore);
const material = (): StudyMaterial => ({ id: 'material', userId: 'owner', name: 'Book', subjectId: '', subjectName: '',
  status: 'active', paceEnabled: true, currentUnit: 10, createdAt: '2026-10-01', updatedAt: '2026-10-15' });
const save = (api: 'actual' | 'material', row: Actual) => api === 'actual'
  ? repository().upsertActual(row)
  : repository().upsertActualWithMaterialProgress({ actual: row, materials: [material()] });
beforeEach(() => {
  sdk.rows.clear(); sdk.transactions.length = 0; sdk.reads.length = 0; sdk.failCommit = false; sdk.beforeTransaction = () => {};
  sdk.getDocs.mockReset();
  sdk.getDocs.mockImplementation(async (query: { name: string; conditions: { field: string; value: unknown }[] }) => ({
    docs: [...sdk.rows.entries()].filter(([key, row]) => key.startsWith(query.name + '/')
      && query.conditions.every(condition => (condition.field === '__name__' ? key.split('/')[1] : row[condition.field]) === condition.value))
      .map(([key, row]) => { const snapshot = structuredClone(row); return { id: key.split('/')[1], data: () => snapshot }; }),
  }));
});

describe.each(['actual', 'material'] as const)('Firebase %s save provenance transaction', api => {
  it('retains source added after candidate enumeration in both persistence and return value', async () => {
    const original = actual({ planId: 'event' });
    sdk.rows.set('actuals/actual', { ...original });
    sdk.beforeTransaction = () => sdk.rows.set('actuals/actual', { ...original, progressSource: eventSource });
    const saved = await save(api, { ...original, planId: null, occurrenceDate: '2026-10-15', note: 'new user note' });
    expect(saved).toMatchObject({ planId: null, note: 'new user note', progressSource: eventSource });
    expect(sdk.rows.get('actuals/actual')).toMatchObject(saved);
    expect(sdk.transactions).toHaveLength(1);
    if (api === 'material') expect(sdk.rows.get('study_materials/material')).toMatchObject({ currentUnit: 10 });
  });
  it('keeps a validated explicit relink source instead of reviving the old source', async () => {
    sdk.rows.set('actuals/actual', { ...actual({ planId: null }), progressSource: eventSource });
    const saved = await save(api, actual({ planId: 'study', progressSource: studySource }));
    expect(saved.progressSource).toEqual(studySource);
    expect(sdk.rows.get('actuals/actual')?.progressSource).toEqual(studySource);
  });
  it('creates a standalone study record without a forbidden read of its nonexistent document', async () => {
    const saved = await save(api, actual({ planId: null }));
    expect(saved.progressSource).toBeUndefined();
    expect(sdk.rows.get('actuals/actual')).toMatchObject({ planId: null });
    expect(sdk.reads).not.toContain('actuals/actual');
  });
  it('fails closed if an enumerated Actual becomes unreadable and leaves all collections unchanged', async () => {
    sdk.rows.set('actuals/actual', { ...actual({ planId: null }) });
    sdk.beforeTransaction = () => sdk.rows.set('actuals/actual', { ...actual({ planId: null, userId: 'other' }) });
    await expect(save(api, actual({ planId: null }))).rejects.toThrow('permission-denied');
    expect(sdk.rows.get('actuals/actual')?.userId).toBe('other');
    expect(sdk.rows.has('study_materials/material')).toBe(false);
    expect(sdk.transactions).toEqual([]);
  });
  it('does not partly save an Actual or material when commit fails', async () => {
    const before = { ...actual({ planId: null }), progressSource: eventSource };
    sdk.rows.set('actuals/actual', before); sdk.failCommit = true;
    await expect(save(api, actual({ planId: null, note: 'new note' }))).rejects.toThrow('synthetic transaction failure');
    expect(sdk.rows.get('actuals/actual')).toEqual(before);
    expect(sdk.rows.has('study_materials/material')).toBe(false);
    expect(sdk.transactions).toEqual([]);
  });
});

it('rejects a foreign material before the Actual transaction', async () => {
  await expect(repository().upsertActualWithMaterialProgress({ actual: actual({ planId: null }), materials: [{ ...material(), userId: 'other' }] }))
    .rejects.toThrow('所有者');
  expect(sdk.rows.size).toBe(0); expect(sdk.transactions).toEqual([]);
});

it('does not delete a duplicate candidate that was relinked before the transaction', async () => {
  sdk.rows.set('actuals/actual', { ...actual() });
  sdk.rows.set('actuals/duplicate', { ...actual({ id: 'duplicate' }) });
  const relinked = { ...actual({ id: 'duplicate', planId: 'different-plan', note: 'newer independent record' }), progressSource: studySource };
  sdk.beforeTransaction = () => sdk.rows.set('actuals/duplicate', relinked);
  await repository().upsertActual(actual({ note: 'edit original' }));
  expect(sdk.rows.get('actuals/duplicate')).toEqual(relinked);
});

it('rereads existing legacy documents by document identity even when the stored id field is absent', async () => {
  const { id: _id, ...legacy } = actual({ planId: 'event' });
  sdk.rows.set('actuals/actual', legacy);
  sdk.beforeTransaction = () => sdk.rows.set('actuals/actual', { ...legacy, progressSource: eventSource });
  const saved = await repository().upsertActual(actual({ planId: null }));
  expect(saved.progressSource).toEqual(eventSource);
  expect(sdk.reads).toContain('actuals/actual');
});

it('does not overwrite a canonical candidate that was relinked after enumeration', async () => {
  sdk.rows.set('actuals/canonical', { ...actual({ id: 'canonical' }) });
  const relinked = { ...actual({ id: 'canonical', planId: 'different-plan', note: 'keep independently relinked record' }), progressSource: studySource };
  sdk.beforeTransaction = () => sdk.rows.set('actuals/canonical', relinked);
  await expect(repository().upsertActual(actual({ id: 'new-editor-id' }))).rejects.toThrow();
  expect(sdk.rows.get('actuals/canonical')).toEqual(relinked);
});
