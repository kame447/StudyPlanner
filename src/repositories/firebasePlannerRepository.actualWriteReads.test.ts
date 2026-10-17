import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Actual } from '../types/domain';
import type { ConfirmedStudyHistory } from './confirmedStudyHistory';
import type { ScheduleEventAuthorityRepository } from './scheduleEventAuthorityRepository';

type Ref = { name: string; id: string };
type Condition = { field: string; op: string; value: string };
type Query = { name: string; conditions: Condition[] };
const sdk = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  getDocs: vi.fn(),
  queries: [] as Array<{ query: Query; returned: number }>,
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: { name: string }, ...conditions: Condition[]) => ({ ...source, conditions }),
  documentId: () => '__name__',
  getDocs: sdk.getDocs,
  getDocsFromServer: sdk.getDocs,
  deleteField: () => null,
  runTransaction: async (_db: unknown, action: (transaction: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = [];
    const result = await action({
      get: async (ref: Ref) => {
        const value = sdk.rows.get(`${ref.name}/${ref.id}`);
        if (!value || value.userId !== 'owner') throw new Error('permission-denied');
        return { id: ref.id, exists: () => true, data: () => structuredClone(value) };
      },
      set: (ref: Ref, value: Record<string, unknown>, options?: { merge: boolean }) => {
        writes.push(() => sdk.rows.set(`${ref.name}/${ref.id}`, structuredClone({
          ...(options?.merge ? sdk.rows.get(`${ref.name}/${ref.id}`) : {}), ...value,
        })));
      },
      delete: (ref: Ref) => writes.push(() => { sdk.rows.delete(`${ref.name}/${ref.id}`); }),
    });
    writes.forEach(write => write());
    return result;
  },
}));
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';
import { actual, event, plan } from './localPersistenceConcurrency.testUtils';

const metadata = { fromCache: false, hasPendingWrites: false };
function seed(rows: Array<Actual | Record<string, unknown>>, ids?: string[]) {
  sdk.rows.clear();
  rows.forEach((row, index) => sdk.rows.set(`actuals/${ids?.[index] ?? row.id}`, structuredClone({ ...row })));
}
function repository(receipt?: ConfirmedStudyHistory) { return createFirebasePlannerRepository({} as Firestore, receipt); }
function sdkRows(query: Query) {
  const rows = [...sdk.rows].filter(([key, row]) => key.startsWith(`${query.name}/`) && query.conditions.every(condition => {
    const value = condition.field === '__name__' ? key.slice(query.name.length + 1) : row[condition.field];
    if (condition.op === '>=') return String(value) >= condition.value;
    if (condition.op === '<=') return String(value) <= condition.value;
    return value === condition.value;
  })).map(([key, row]) => ({ id: key.slice(query.name.length + 1), data: () => structuredClone(row) }));
  sdk.queries.push({ query, returned: rows.length });
  return { metadata, docs: rows };
}
beforeEach(() => {
  sdk.rows.clear(); sdk.queries.length = 0; sdk.getDocs.mockReset();
  sdk.getDocs.mockImplementation(async (query: Query) => sdkRows(query));
});

const source = { kind: 'general-event' as const, sourceId: 'event' };
describe('targeted previous Actual retains full-query semantics', () => {
  it.each([
    ['missing', [], 'missing'],
    ['standalone', [actual({ planId: null })], 'actual'],
    ['linked', [actual()], 'actual'],
    ['older duplicate hidden', [actual({ updatedAt: '2026-01-01' }), actual({ id: 'newer', updatedAt: '2026-10-01' })], 'actual'],
    ['newer duplicate retained', [actual({ updatedAt: '2026-10-01' }), actual({ id: 'older', updatedAt: '2026-01-01' })], 'actual'],
    ['same-time ID tie hidden', [actual({ id: 'z' }), actual({ id: 'a' })], 'z'],
    ['same-time ID tie retained', [actual({ id: 'z' }), actual({ id: 'a' })], 'a'],
    ['other occurrence retained', [actual(), actual({ id: 'later', occurrenceDate: '2026-10-05', updatedAt: '2026-10-10' })], 'actual'],
    ['foreign identity hidden', [actual({ userId: 'other' })], 'actual'],
    ['foreign duplicate excluded', [actual(), actual({ id: 'foreign', userId: 'other', updatedAt: '2026-12-01' })], 'actual'],
  ] as Array<[string, Actual[], string]>)('%s', async (_label, rows, id) => {
    seed(rows);
    const api = repository();
    const expected = (await api.getActuals('owner')).find(row => row.id === id);
    expect(await api.getActualForWritePreparation!('owner', id)).toEqual(expected);
  });

  it('includes legacy date-only duplicates and missing stored id without an occurrence-date filter', async () => {
    const { id: _id, occurrenceDate: _date, ...legacy } = actual({ updatedAt: '2026-12-01' });
    seed([actual(), { ...legacy, date: '2026-10-04' }], ['actual', 'legacy']);
    const api = repository();
    const expected = await api.getActuals('owner'); sdk.queries.length = 0;
    expect(await api.getActualForWritePreparation!('owner', 'actual')).toBeUndefined();
    expect(await api.getActualForWritePreparation!('owner', 'legacy')).toEqual(expected.find(row => row.id === 'legacy'));
    expect(sdk.queries.filter(row => row.query.conditions.some(condition => condition.field === 'planId')))
      .toHaveLength(2);
    expect(sdk.queries.flatMap(row => row.query.conditions).some(condition => condition.field === 'occurrenceDate')).toBe(false);
  });

  it('never publishes partial rows as complete study history', async () => {
    seed([actual()]);
    const beginRead = vi.fn();
    await repository({ beginRead } as unknown as ConfirmedStudyHistory).getActualForWritePreparation!('owner', 'actual');
    expect(beginRead).not.toHaveBeenCalled();
  });

  it('uses owner-qualified equal inclusive ID ranges and keeps standalone reads independent of history size', async () => {
    seed(Array.from({ length: 1000 }, (_, index) => actual({ id: `a${index}`, planId: null })));
    const api = repository();
    expect(await api.getActualForWritePreparation!('owner', 'absent')).toBeUndefined();
    expect(await api.getActualForWritePreparation!('owner', 'a0')).toMatchObject({ id: 'a0' });
    expect(sdk.queries.map(row => row.returned)).toEqual([0, 1]);
    expect(sdk.queries[0].query.conditions).toEqual([
      { field: 'userId', op: '==', value: 'owner' },
      { field: '__name__', op: '>=', value: 'absent' },
      { field: '__name__', op: '<=', value: 'absent' },
    ]);
  });

  it.each([1, 2])('propagates failure of read %i without falling back to a full history or writing', async failureAt => {
    seed([actual()]);
    const before = structuredClone([...sdk.rows]);
    if (failureAt === 2) sdk.getDocs.mockImplementationOnce(async (query: Query) => sdkRows(query));
    sdk.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(repository().getActualForWritePreparation!('owner', 'actual')).rejects.toThrow('permission-denied');
    expect(sdk.getDocs).toHaveBeenCalledTimes(failureAt);
    expect([...sdk.rows]).toEqual(before);
  });
});

function composed(targeted: boolean, sources = { plans: [plan()], monthEvents: [event()] }) {
  const legacy = repository();
  if (!targeted) delete legacy.getActualForWritePreparation;
  const authority = { ensureMigrated: vi.fn(async () => {}), getScheduleSnapshot: vi.fn(async () => sources) };
  return { api: createScheduleEventBackedPlannerRepository(legacy, authority as unknown as ScheduleEventAuthorityRepository), authority };
}

describe.each(['actual', 'material'] as const)('%s save after bounded preparation', kind => {
  async function run(targeted: boolean, rows: Actual[], next: Actual) {
    seed(rows); sdk.queries.length = 0;
    const { api, authority } = composed(targeted);
    const saved = kind === 'actual' ? await api.upsertActual(next)
      : await api.upsertActualWithMaterialProgress({ actual: next, materials: [] });
    return { saved, stored: [...sdk.rows].sort(), queries: [...sdk.queries], schedules: authority.getScheduleSnapshot.mock.calls.length };
  }
  it.each([
    ['new standalone', [], actual({ planId: null })],
    ['new linked', [], actual()],
    ['edit', [actual()], actual({ note: 'edited' })],
    ['unlink', [actual({ planId: 'event' })], actual({ planId: null, occurrenceDate: '2026-10-09' })],
    ['relink', [actual({ planId: 'event', progressSource: source })], actual()],
    ['retained deleted source', [actual({ planId: null, progressSource: source })], actual({ planId: null, note: 'edited' })],
    ['canonical duplicate ID', [actual({ id: 'canonical' })], actual({ id: 'new-editor' })],
    ['duplicate loser', [actual({ updatedAt: '2026-01-01' }), actual({ id: 'newer', updatedAt: '2026-10-01' })], actual({ note: 'edited' })],
    ['forged standalone source', [], actual({ planId: null, progressSource: source })],
  ] as Array<[string, Actual[], Actual]>)('matches original full preparation for %s', async (_label, rows, next) => {
    const previous = await run(false, rows, next);
    const targeted = await run(true, rows, next);
    expect(targeted.saved).toEqual(previous.saved);
    expect(targeted.stored).toEqual(previous.stored);
    expect(targeted.schedules).toEqual(previous.schedules);
  });
  it('avoids all 1,000 irrelevant Actuals when saving one new record', async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => actual({ id: `old${index}`, planId: null }));
    const previous = await run(false, rows, actual({ planId: null }));
    const targeted = await run(true, rows, actual({ planId: null }));
    expect(previous.queries).toHaveLength(2); expect(targeted.queries).toHaveLength(2);
    expect(previous.queries.reduce((sum, row) => sum + row.returned, 0)).toBe(1000);
    expect(targeted.queries.reduce((sum, row) => sum + row.returned, 0)).toBe(0);
    expect(targeted.stored).toEqual(previous.stored);
    expect(targeted.schedules).toBe(0);
  });
});

it('still rejects a new link or relink to a vanished source before dispatching writes', async () => {
  for (const rows of [[], [actual({ planId: null })]]) {
    seed(rows); const before = structuredClone([...sdk.rows]);
    const { api } = composed(true, { plans: [], monthEvents: [] });
    await expect(api.upsertActual(actual())).rejects.toThrow('再読み込み');
    expect([...sdk.rows]).toEqual(before);
  }
});


it('makes the existing-linked tradeoff explicit when the whole history belongs to one source', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => actual({ id: `a${index}`, occurrenceDate: `historical-${index}` }));
  seed(rows); const api = repository();
  await api.getActuals('owner');
  const original = [...sdk.queries]; sdk.queries.length = 0;
  await api.getActualForWritePreparation!('owner', 'a0');
  expect(original).toHaveLength(1); expect(original[0].returned).toBe(1000);
  expect(sdk.queries.map(row => row.returned)).toEqual([1, 1000]);
});

it.each(['deleted', 'relinked', 'owner-changed'] as const)('does not use an initial linked candidate after it is %s before group confirmation', async change => {
  seed([actual()]);
  sdk.getDocs.mockImplementationOnce(async (query: Query) => {
    const initial = sdkRows(query);
    if (change === 'deleted') sdk.rows.delete('actuals/actual');
    else sdk.rows.set('actuals/actual', { ...actual(), ...(change === 'relinked' ? { planId: 'other-plan' } : { userId: 'other' }) });
    return initial;
  });
  await expect(repository().getActualForWritePreparation!('owner', 'actual')).rejects.toThrow('再読み込み');
});


it.each(['actual', 'material'] as const)('rejects %s unlink after the previous source-bearing record disappears between preparation reads', async kind => {
  const previous = actual({ planId: 'event', progressSource: source });
  seed([previous]);
  sdk.getDocs.mockImplementationOnce(async (query: Query) => {
    const first = sdkRows(query);
    sdk.rows.delete('actuals/actual');
    return first;
  });
  const { api } = composed(true);
  const next = { ...previous, planId: null, note: 'stale unlink' };
  const save = kind === 'actual' ? api.upsertActual(next)
    : api.upsertActualWithMaterialProgress({ actual: next, materials: [] });
  await expect(save).rejects.toThrow('再読み込み');
  expect(sdk.rows.size).toBe(0);
  expect(sdk.getDocs).toHaveBeenCalledTimes(2);
});
