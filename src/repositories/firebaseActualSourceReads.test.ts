import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { scheduleEventFromMonthEvent, scheduleEventFromPlan, type ScheduleEvent } from '../domain/scheduleEvent';
import type { Actual } from '../types/domain';
import { actual, event, plan } from './localPersistenceConcurrency.testUtils';
import { createConfirmedStudyHistory, invalidateStudyHistoryOnWrites } from './confirmedStudyHistory';
import type { ScheduleEventAuthorityRepository } from './scheduleEventAuthorityRepository';

type Ref = { name: string; id: string };
type Query = { name: string; conditions: { field: string; op: string; value: string }[] };
const sdk = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(), getDocs: vi.fn(),
  queries: [] as Array<{ query: Query; returned: number }>,
}));
const metadata = { fromCache: false, hasPendingWrites: false };
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: object, ...conditions: object[]) => ({ ...source, conditions }),
  getDocs: sdk.getDocs, getDocsFromServer: sdk.getDocs,
  getDocFromServer: async () => ({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true,
    data: () => ({ schemaVersion: 1, migrationVersion: 1, status: 'completed' }) }),
  deleteField: () => null,
  setDoc: vi.fn(), writeBatch: vi.fn(),
  runTransaction: async (_db: unknown, work: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = [];
    const result = await work({
      get: async (ref: Ref) => {
        const row = sdk.rows.get(`${ref.name}/${ref.id}`);
        if (!row || row.userId !== 'owner') throw new Error('permission-denied');
        return { id: ref.id, exists: () => true, data: () => structuredClone(row) };
      },
      set: (ref: Ref, value: Record<string, unknown>, options?: { merge: boolean }) => {
        const old = sdk.rows.get(`${ref.name}/${ref.id}`);
        if (value.userId !== 'owner' || old && old.userId !== 'owner') throw new Error('permission-denied');
        writes.push(() => sdk.rows.set(`${ref.name}/${ref.id}`, structuredClone({ ...(options?.merge ? old : {}), ...value })));
      },
      delete: (ref: Ref) => writes.push(() => { sdk.rows.delete(`${ref.name}/${ref.id}`); }),
    });
    writes.forEach(write => write()); return result;
  },
}));
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository, ScheduleEventMigrationCapabilityUnavailableError } from './scheduleEventAuthorityRepository';

function response(query: Query) {
  const rows = [...sdk.rows].sort(([left], [right]) => left.localeCompare(right)).filter(([key, row]) => key.startsWith(`${query.name}/`)
    && query.conditions.every(condition => {
      const value = condition.field === '__name__' ? key.slice(query.name.length + 1)
        : condition.field.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], row);
      if (condition.op === '>=') return String(value) >= condition.value;
      if (condition.op === '<=') return String(value) <= condition.value;
      return value === condition.value;
    }));
  sdk.queries.push({ query, returned: rows.length });
  return { metadata, docs: rows.map(([key, row]) => ({ id: key.slice(query.name.length + 1), data: () => structuredClone(row) })) };
}
beforeEach(() => {
  sdk.rows.clear(); sdk.queries.length = 0; sdk.getDocs.mockReset();
  sdk.getDocs.mockImplementation(async (query: Query) => response(query));
});
function seed(events: ScheduleEvent[], actuals: Actual[] = []) {
  sdk.rows.clear(); sdk.queries.length = 0;
  for (const row of events) sdk.rows.set(`schedule_events/${row.id}`, structuredClone({ ...row }));
  for (const row of actuals) sdk.rows.set(`actuals/${row.id}`, structuredClone({ ...row }));
}
function bundle(narrow = true, receipt?: ReturnType<typeof createConfirmedStudyHistory>) {
  const db = {} as Firestore, authority = createFirebaseScheduleEventAuthority(db, receipt);
  const selected: ScheduleEventAuthorityRepository = narrow ? authority : { ...authority, getActualProgressSources: undefined };
  const api = createScheduleEventBackedPlannerRepository(createFirebasePlannerRepository(db, receipt), selected);
  return { api: receipt ? invalidateStudyHistoryOnWrites(api, receipt) : api, authority: selected };
}
async function execute(narrow: boolean, sources: ScheduleEvent[], rows: Actual[], next: Actual, material = false) {
  seed(sources, rows); const { api } = bundle(narrow);
  let saved: Actual | undefined, error: string | undefined;
  try { saved = material ? await api.upsertActualWithMaterialProgress({ actual: next, materials: [] }) : await api.upsertActual(next); }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { saved, error, stored: [...sdk.rows].sort(), queries: structuredClone(sdk.queries) };
}
const source = { kind: 'general-event' as const, sourceId: 'event' };
const overridePlan = plan({ recurrenceRules: [{ id: 'override', kind: 'date', startDate: '2026-10-04',
  until: null, dates: ['2026-10-04'], weekdays: [], dayType: null, isOverride: true, type: 'school-event', startTime: '09:00', endTime: '10:00' }] });
const cases: Array<[string, ScheduleEvent[], Actual[], Actual]> = [
  ['new study Plan', [scheduleEventFromPlan(plan())], [], actual()],
  ['new timetable Plan', [scheduleEventFromPlan(plan({ sourceType: 'timetable' }))], [], actual()],
  ['new general Plan', [scheduleEventFromPlan(plan({ type: 'other' }))], [], actual()],
  ['new mock-exam Plan', [scheduleEventFromPlan(plan({ type: 'mock-exam' }))], [], actual()],
  ['new cram-school Plan', [scheduleEventFromPlan(plan({ type: 'cram-school' }))], [], actual()],
  ['old recurring Plan', [scheduleEventFromPlan(plan({ date: '2000-01-02', repeat: 'weekly' }))], [], actual()],
  ['occurrence override', [scheduleEventFromPlan(overridePlan)], [], actual()],
  ['new MonthEvent', [scheduleEventFromMonthEvent(event())], [], actual({ planId: 'event' })],
  ['old monthly MonthEvent', [scheduleEventFromMonthEvent(event({ date: '2000-01-04', endDate: '2000-01-04', repeat: 'monthly' }))], [], actual({ planId: 'event' })],
  ['same-ID Plan takes precedence', [scheduleEventFromPlan(plan()), scheduleEventFromMonthEvent(event({ id: 'plan' }))], [], actual()],
  ['same-ID nonoccurring Plan still takes precedence', [scheduleEventFromPlan(plan({ date: '2026-10-03' })), scheduleEventFromMonthEvent(event({ id: 'plan' }))], [], actual()],
  ['document name differs from provenance', [{ ...scheduleEventFromPlan(plan()), id: 'arbitrary-canonical-name' }], [], actual()],
  ['foreign source rejected', [scheduleEventFromPlan(plan({ userId: 'other' }))], [], actual()],
  ['new vanished source rejected', [], [], actual()],
  ['edit current link overrides old snapshot', [scheduleEventFromPlan(plan())], [actual({ progressSource: source })], actual({ note: 'edited' })],
  ['unlink legacy source', [scheduleEventFromMonthEvent(event())], [actual({ planId: 'event' })], actual({ planId: null, occurrenceDate: '2026-10-03' })],
  ['unlink retains prior occurrence override', [scheduleEventFromPlan(overridePlan)], [actual()], actual({ planId: null, occurrenceDate: '2026-10-03' })],
  ['relink chooses only new source', [scheduleEventFromPlan(plan()), scheduleEventFromMonthEvent(event())], [actual({ planId: 'event', progressSource: source })], actual()],
  ['relink vanished source rejected despite old snapshot', [scheduleEventFromMonthEvent(event())], [actual({ planId: 'event', progressSource: source })], actual()],
  ['deleted source snapshot retained', [], [actual({ progressSource: source })], actual({ note: 'edited' })],
  ['deleted source legacy orphan stays unknown', [], [actual()], actual({ note: 'edited' })],
  ['deleted source unlink retains snapshot', [], [actual({ progressSource: source })], actual({ planId: null })],
  ['standalone caller snapshot rejected', [], [], actual({ planId: null, progressSource: source })],
];

describe.each([false, true])('Actual source query equivalence (material=%s)', material => {
  it.each(cases)('%s', async (label, sources, rows, next) => {
    const full = await execute(false, sources, rows, next, material);
    const narrow = await execute(true, sources, rows, next, material);
    if (label.includes('rejected') && label !== 'standalone caller snapshot rejected') {
      expect(full.error).toContain('再読み込み'); expect(full.saved).toBeUndefined();
    } else { expect(full.error).toBeUndefined(); expect(full.saved).toBeDefined(); }
    if (label.startsWith('same-ID')) expect(narrow.saved?.progressSource).toEqual({ kind: 'study', sourceId: 'plan', planType: 'study' });
    expect(narrow.saved).toEqual(full.saved); expect(narrow.error).toEqual(full.error); expect(narrow.stored).toEqual(full.stored);
  });
});

it('returns only one relevant source from 1000 schedules without adding a query', async () => {
  const sources = [scheduleEventFromPlan(plan()), ...Array.from({ length: 999 }, (_, index) => scheduleEventFromMonthEvent(event({ id: `unrelated-${index}` })))];
  const full = await execute(false, sources, [], actual());
  const narrow = await execute(true, sources, [], actual());
  expect(narrow.saved).toEqual(full.saved); expect(narrow.error).toBeUndefined();
  const count = (result: typeof full) => ({ queries: result.queries.length, returned: result.queries.reduce((sum, row) => sum + row.returned, 0),
    sourceQueries: result.queries.filter(row => row.query.name === 'schedule_events').length,
    sourceDocuments: result.queries.filter(row => row.query.name === 'schedule_events').reduce((sum, row) => sum + row.returned, 0) });
  console.info('ACTUAL_SOURCE_COUNTS', JSON.stringify({ full: count(full), narrow: count(narrow) }));
  expect(count(full)).toEqual({ queries: 4, returned: 1000, sourceQueries: 1, sourceDocuments: 1000 });
  expect(count(narrow)).toEqual({ queries: 4, returned: 1, sourceQueries: 1, sourceDocuments: 1 });
  expect(narrow.queries.find(row => row.query.name === 'schedule_events')?.query.conditions).toEqual([
    { field: 'userId', op: '==', value: 'owner' }, { field: 'provenance.legacy.id', op: '==', value: 'plan' },
  ]);
});

it('keeps both kinds and every same-identity row in document order', async () => {
  const first = { ...scheduleEventFromPlan(plan()), id: 'a-custom' };
  const second = { ...scheduleEventFromPlan(plan({ type: 'mock-exam' })), id: 'z-custom' };
  seed([second, scheduleEventFromMonthEvent(event({ id: 'plan' })), first]);
  const { authority } = bundle();
  const selected = await authority.getActualProgressSources!('owner', 'plan');
  const full = await authority.getScheduleSnapshot('owner');
  expect(selected).toEqual(full);
  expect(selected.plans.map(row => row.type)).toEqual(['study', 'mock-exam']);
  expect(selected.monthEvents).toHaveLength(1);
});

it('leaves complete-history receipts untouched and cannot certify a partial source slice', async () => {
  const receipt = createConfirmedStudyHistory(() => '2026-10-04');
  receipt.confirmMigration('owner');
  receipt.beginRead('owner', 'actuals')([], metadata);
  const begin = vi.spyOn(receipt, 'beginRead');
  seed([scheduleEventFromPlan(plan())]);
  const { authority } = bundle(true, receipt);
  const generation = receipt.generation;
  const selected = await authority.getActualProgressSources!('owner', 'plan');
  expect(begin).not.toHaveBeenCalled(); expect(receipt.generation).toBe(generation);
  expect(receipt.read('owner', { ...selected, actuals: [] }, '2026-10-04')).toBeNull();
  const full = await authority.getScheduleSnapshot('owner');
  expect(receipt.read('owner', { ...full, actuals: [] }, '2026-10-04')).not.toBeNull();
  const completeGeneration = receipt.generation;
  await authority.getActualProgressSources!('owner', 'absent');
  expect(receipt.generation).toBe(completeGeneration);
  expect(receipt.read('owner', { ...full, actuals: [] }, '2026-10-04')).not.toBeNull();
});

it.each([false, true])('invalidates a prior full receipt before and after a pending save (material=%s)', async material => {
  const receipt = createConfirmedStudyHistory(() => '2026-10-04');
  seed([scheduleEventFromPlan(plan())]);
  const { api } = bundle(true, receipt);
  const full = await api.getScheduleSnapshot('owner');
  await api.getActuals('owner');
  const hint = { ...full, actuals: [] };
  expect(receipt.read('owner', hint, '2026-10-04')).not.toBeNull();
  const generation = receipt.generation;
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  sdk.getDocs.mockImplementation(async (query: Query) => {
    if (query.name === 'schedule_events') { enter(); await gate; }
    return response(query);
  });
  const saving = material ? api.upsertActualWithMaterialProgress({ actual: actual(), materials: [] }) : api.upsertActual(actual());
  await entered;
  expect(receipt.writing).toBe(true); expect(receipt.generation).toBeGreaterThan(generation);
  expect(receipt.read('owner', hint, '2026-10-04')).toBeNull();
  const during = receipt.generation;
  release(); await saving;
  expect(receipt.writing).toBe(false); expect(receipt.generation).toBeGreaterThan(during);
  expect(receipt.read('owner', hint, '2026-10-04')).toBeNull();
});

it('confirms a fresh source on every edit and preserves its snapshot after source deletion', async () => {
  const canonical = scheduleEventFromPlan(plan()); seed([canonical]);
  const { api } = bundle();
  const first = await api.upsertActual(actual());
  expect(first.progressSource?.kind).toBe('study');
  sdk.rows.set(`schedule_events/${canonical.id}`, { ...scheduleEventFromPlan(plan({ type: 'school-event' })) });
  const second = await api.upsertActual({ ...first, note: 'reclassified' });
  expect(second.progressSource?.kind).toBe('general-event');
  sdk.rows.delete(`schedule_events/${canonical.id}`);
  const third = await api.upsertActual({ ...second, note: 'source removed' });
  expect(third.progressSource).toEqual(second.progressSource);
  await expect(api.upsertActual(actual({ id: 'new-link', occurrenceDate: '2026-10-05' }))).rejects.toThrow('再読み込み');
  expect(sdk.rows.has('actuals/new-link')).toBe(false);
  expect(sdk.queries.filter(row => row.query.name === 'schedule_events')).toHaveLength(4);
});

it.each([false, true])('propagates source-query denial without writes or legacy fallback (material=%s)', async material => {
  seed([scheduleEventFromPlan(plan())]);
  sdk.getDocs.mockImplementation(async (query: Query) => {
    if (query.name === 'schedule_events') throw { code: 'permission-denied', message: 'source denied' };
    return response(query);
  });
  const { api } = bundle();
  const saving = material ? api.upsertActualWithMaterialProgress({ actual: actual(), materials: [] }) : api.upsertActual(actual());
  await expect(saving).rejects.toThrow('permission-denied: source denied');
  expect(sdk.rows.has('actuals/actual')).toBe(false);
  expect(sdk.queries.some(row => row.query.name === 'plans' || row.query.name === 'month_events')).toBe(false);
});

it('rejects a foreign row even if a query adapter returns it', async () => {
  const row = scheduleEventFromPlan(plan({ userId: 'foreign' }));
  sdk.getDocs.mockResolvedValue({ metadata, docs: [{ id: row.id, data: () => row }] });
  await expect(bundle().authority.getActualProgressSources!('owner', 'plan')).rejects.toThrow('所有者');
});

it('keeps migration-capability fallback on the legacy full snapshot', async () => {
  seed([]); sdk.rows.set('plans/plan', { ...plan() });
  const db = {} as Firestore, legacy = createFirebasePlannerRepository(db), authority = createFirebaseScheduleEventAuthority(db);
  authority.ensureMigrated = async () => { throw new ScheduleEventMigrationCapabilityUnavailableError(); };
  const targeted = vi.spyOn(authority, 'getActualProgressSources');
  const saved = await createScheduleEventBackedPlannerRepository(legacy, authority).upsertActual(actual());
  expect(saved.progressSource?.kind).toBe('study'); expect(targeted).not.toHaveBeenCalled();
  expect(sdk.queries.map(row => row.query.name)).toContain('plans');
  expect(sdk.queries.map(row => row.query.name)).toContain('month_events');
});

it('rejects malformed selected recurrence but isolates unrelated malformed rows', async () => {
  const valid = scheduleEventFromPlan(plan());
  const malformed = { ...scheduleEventFromPlan(plan({ id: 'broken' })), recurrence: { ...valid.recurrence, rules: [{}] } } as ScheduleEvent;
  seed([valid, malformed]); const { authority, api } = bundle();
  await expect(authority.getScheduleSnapshot('owner')).rejects.toThrow();
  await expect(authority.getActualProgressSources!('owner', 'broken')).rejects.toThrow();
  await expect(api.upsertActual(actual({ planId: 'broken' }))).rejects.toThrow();
  expect(sdk.rows.has('actuals/actual')).toBe(false);
  expect((await api.upsertActual(actual())).progressSource?.kind).toBe('study');
});
