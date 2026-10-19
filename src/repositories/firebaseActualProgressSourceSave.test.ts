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
  queries: [] as Array<{ fields: string[]; returned: number }>,
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
  sdk.rows.clear(); sdk.transactions.length = 0; sdk.reads.length = 0; sdk.queries.length = 0; sdk.failCommit = false; sdk.beforeTransaction = () => {};
  sdk.getDocs.mockReset();
  sdk.getDocs.mockImplementation(async (query: { name: string; conditions: { field: string; op: string; value: unknown }[] }) => {
    const exactId = query.conditions.find(condition => condition.field === '__name__' && condition.op === '==');
    // A real Firestore equality target evaluates the absent resource under the
    // owner-only Rules. Ordinary range queries instead evaluate query bounds.
    if (exactId && !sdk.rows.has(`${query.name}/${exactId.value}`)) {
      throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    }
    const docs = [...sdk.rows.entries()].filter(([key, row]) => key.startsWith(query.name + '/')
      && query.conditions.every(condition => {
        const value = condition.field === '__name__' ? key.split('/')[1] : row[condition.field];
        if (condition.op === '>=') return String(value) >= String(condition.value);
        if (condition.op === '<=') return String(value) <= String(condition.value);
        return value === condition.value;
      })).map(([key, row]) => { const snapshot = structuredClone(row); return { id: key.split('/')[1], data: () => snapshot }; });
    sdk.queries.push({ fields: query.conditions.map(condition => condition.field), returned: docs.length });
    return { docs };
  });
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
  it('fails closed when an enumerated Actual disappears before the transaction', async () => {
    sdk.rows.set('actuals/actual', { ...actual({ planId: null }) });
    sdk.beforeTransaction = () => { sdk.rows.delete('actuals/actual'); };
    await expect(save(api, actual({ planId: null }))).rejects.toThrow('permission-denied');
    expect(sdk.rows.has('actuals/actual')).toBe(false);
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


describe.each(['actual', 'material'] as const)('Firebase %s existing-target read budget', api => {
  it.each([
    ['same linked ID', [actual()], actual({ note: 'edited' }), 1, 1, 'actual', true],
    ['canonical duplicate winner', [actual({ id: 'canonical' })], actual({ id: 'new-editor' }), 1, 1, 'canonical', true],
    ['new linked ID', [], actual(), 2, 0, 'actual', false],
    ['new standalone ID', [], actual({ planId: null }), 1, 0, 'actual', false],
    ['existing standalone ID', [actual({ planId: null })], actual({ planId: null, note: 'edited' }), 1, 1, 'actual', true],
    ['changed occurrence', [actual()], actual({ occurrenceDate: '2026-10-05' }), 2, 1, 'actual', true],
  ] as Array<[string, Actual[], Actual, number, number, string, boolean]>)('%s', async (label, rows, next, queries, returned, id, reread) => {
    // Irrelevant history is deliberately retained; none of these queries may truncate it.
    for (let index = 0; index < 1000; index += 1) {
      const row = actual({ id: `historical-${index}`, planId: 'other-plan', occurrenceDate: '2001-01-01' });
      sdk.rows.set(`actuals/${row.id}`, { ...row });
    }
    rows.forEach(row => sdk.rows.set(`actuals/${row.id}`, { ...row }));
    const saved = await save(api, next);
    const measurement = { api, label, queries: sdk.queries.length,
      returned: sdk.queries.reduce((sum, query) => sum + query.returned, 0), transactionReads: sdk.reads.length };
    console.info('ACTUAL_EXISTING_WRITE_READ', JSON.stringify(measurement));
    expect(saved).toMatchObject({ ...next, id });
    expect(sdk.rows.get(`actuals/${id}`)).toMatchObject(saved);
    expect([...sdk.rows.keys()].filter(key => key.startsWith('actuals/historical-'))).toHaveLength(1000);
    expect(sdk.reads).toEqual(reread ? [`actuals/${id}`] : []);
    expect(sdk.queries).toHaveLength(queries);
    expect(measurement.returned).toBe(returned);
    expect(sdk.queries.every(query => query.fields.includes('userId'))).toBe(true);
    if (api === 'material') expect(sdk.rows.get('study_materials/material')).toMatchObject({ currentUnit: 10 });
  });

  it.each(['missing stored id', 'legacy date only', 'legacy array date'])('retains the existing identity/normalization boundary for %s', async shape => {
    const { id: _id, occurrenceDate, ...fields } = actual();
    const row = shape === 'missing stored id' ? { ...fields, occurrenceDate }
      : { ...fields, date: shape === 'legacy array date' ? [occurrenceDate] : occurrenceDate };
    sdk.rows.set('actuals/actual', row);
    const saved = await save(api, actual({ note: 'edit legacy record' }));
    expect(saved.id).toBe('actual');
    expect(sdk.reads).toEqual(['actuals/actual']);
    expect(sdk.queries).toHaveLength(shape === 'missing stored id' ? 1 : 2);
    expect(sdk.rows.get('actuals/actual')).toMatchObject({ note: 'edit legacy record' });
  });

  it('does not recreate a known matching target deleted immediately after its occurrence query', async () => {
    sdk.rows.set('actuals/actual', { ...actual(), progressSource: eventSource });
    const read = sdk.getDocs.getMockImplementation()!;
    sdk.getDocs.mockImplementationOnce(async query => {
      const snapshot = await read(query);
      sdk.rows.delete('actuals/actual');
      return snapshot;
    });
    await expect(save(api, actual({ note: 'stale editor' }))).rejects.toThrow('permission-denied');
    expect(sdk.reads).toEqual(['actuals/actual']);
    expect(sdk.rows.size).toBe(0);
    expect(sdk.transactions).toEqual([]);
  });

  it('still reads current provenance when the occurrence query already found the target', async () => {
    sdk.rows.set('actuals/actual', { ...actual() });
    sdk.beforeTransaction = () => sdk.rows.set('actuals/actual', { ...actual(), progressSource: eventSource });
    const saved = await save(api, actual({ note: 'new note' }));
    expect(saved.progressSource).toEqual(eventSource);
    expect(sdk.rows.get('actuals/actual')).toMatchObject(saved);
    expect(sdk.queries).toHaveLength(1);
    expect(sdk.reads).toEqual(['actuals/actual']);
  });

  it('rejects an owner change before the retained transaction read without saving a material', async () => {
    sdk.rows.set('actuals/actual', { ...actual() });
    const foreign = { ...actual({ userId: 'other', note: 'other owner' }) };
    sdk.beforeTransaction = () => sdk.rows.set('actuals/actual', foreign);
    await expect(save(api, actual())).rejects.toThrow('permission-denied');
    expect(sdk.rows.get('actuals/actual')).toEqual(foreign);
    expect(sdk.rows.has('study_materials/material')).toBe(false);
    expect(sdk.transactions).toEqual([]);
  });

  it('keeps commit failure atomic after reusing occurrence-query existence', async () => {
    const before = { ...actual(), progressSource: eventSource };
    sdk.rows.set('actuals/actual', before); sdk.failCommit = true;
    await expect(save(api, actual({ note: 'unsaved' }))).rejects.toThrow('synthetic transaction failure');
    expect(sdk.rows.get('actuals/actual')).toEqual(before);
    expect(sdk.rows.has('study_materials/material')).toBe(false);
    expect(sdk.transactions).toEqual([]);
  });
});
