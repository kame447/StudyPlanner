import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from './repositoryContracts';
import type { ScheduleEvent } from '../domain/scheduleEvent';
import { migrateLegacyScheduleRecords, scheduleEventFromMonthEvent, scheduleEventFromPlan } from '../domain/scheduleEvent';
import { createMonthEventDraftFromEvent } from '../domain/planner';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';
import { createUnavailablePlannerRepository } from './unavailableRepositories';
import { deferred, event, plan } from './localPersistenceConcurrency.testUtils';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';

const boundary = vi.hoisted(() => ({
  repository: null as unknown as PlannerRepository,
  getDocs: vi.fn(), getDocFromServer: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: { name: string }, ...clauses: unknown[]) => ({ source, clauses }),
  getDocs: boundary.getDocs, getDocFromServer: boundary.getDocFromServer,
  setDoc: boundary.setDoc, deleteDoc: boundary.deleteDoc,
  runTransaction: boundary.runTransaction, writeBatch: vi.fn(),
}));

type Query = { source: { name: string }; clauses: { field: string; op: string; value: string }[] };
const records = new Map<string, ScheduleEvent>();
const reads: { query: Query; ids: string[] }[] = [];
const actualQueries: Query[] = [];
function seed(rows: ScheduleEvent[]) { for (const row of rows) records.set(row.id, row); }
function repository() {
  const legacy = { ...createUnavailablePlannerRepository(), applyTimetableMutation: async () => undefined };
  return createScheduleEventBackedPlannerRepository(legacy, createFirebaseScheduleEventAuthority({} as Firestore));
}
function history() {
  const plans = Array.from({ length: 1_000 }, (_, i) => plan({ id: `plan-${i}`, seriesId: `plan-${i}`, date: '2020-01-01' }));
  const monthEvents = Array.from({ length: 20 }, (_, i) => event({ id: `event-${i}` }));
  seed(migrateLegacyScheduleRecords({ plans, monthEvents }).events);
  return { plans, monthEvents };
}
let renderer: ReactTestRenderer | undefined;
let state: UsePlannerDataStateResult;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: vi.fn() }); return null; }
beforeEach(() => {
  vi.resetAllMocks(); records.clear(); reads.length = 0; actualQueries.length = 0;
  boundary.getDocFromServer.mockImplementation(async () => ({
    exists: () => true,
    data: () => ({ schemaVersion: 1, migrationVersion: 1, status: 'completed', userId: 'owner' }),
    metadata: { fromCache: false, hasPendingWrites: false },
  }));
  boundary.getDocs.mockImplementation(async (query: Query) => {
    if (query.source.name === 'actuals') { actualQueries.push(query); return { docs: [] }; }
    const rows = [...records.values()].filter(row => query.clauses.every(({ field, op, value }) => {
      expect(op).toBe('==');
      const actual = field.split('.').reduce<unknown>((current, key) =>
        current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, row);
      return actual === value;
    })).sort((a, b) => a.id.localeCompare(b.id));
    expect(query.source.name).toBe('schedule_events');
    reads.push({ query, ids: rows.map(row => row.id) });
    return { docs: rows.map(row => ({ id: row.id, data: () => structuredClone(row) })) };
  });
  boundary.setDoc.mockImplementation(async (ref: { id: string }, row: ScheduleEvent) => { records.set(ref.id, structuredClone(row)); });
  boundary.deleteDoc.mockImplementation(async (ref: { id: string }) => { records.delete(ref.id); });
  boundary.runTransaction.mockImplementation(async (_db, callback) => {
    const deleted: string[] = [];
    await callback({
      get: async (ref: { name: string; id: string }) => {
        expect(ref.name).toBe('schedule_events');
        return { id: ref.id, exists: () => records.has(ref.id), data: () => structuredClone(records.get(ref.id)) };
      },
      delete: (ref: { name: string; id: string }) => { expect(ref.name).toBe('schedule_events'); deleted.push(ref.id); },
    });
    deleted.forEach(id => records.delete(id));
  });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('canonical schedule projection query footprint', () => {
  it('returns only the requested provenance while full refresh still returns all history', async () => {
    history(); const repo = repository();
    expect((await repo.getMonthEvents('owner')).length).toBe(20);
    expect((await repo.getPlans('owner')).length).toBe(1_000);
    const all = await repo.getScheduleSnapshot('owner');
    expect(all.plans).toHaveLength(1_000); expect(all.monthEvents).toHaveLength(20);
    const counts = reads.map(read => read.ids.length);
    console.info('schedule document results (month-only, plan-only, full):', counts);
    expect(counts).toEqual([20, 1_000, 1_020]);
    expect(reads.map(read => read.query.clauses)).toEqual([
      [{ field: 'userId', op: '==', value: 'owner' }, { field: 'provenance.legacy.kind', op: '==', value: 'month-event' }],
      [{ field: 'userId', op: '==', value: 'owner' }, { field: 'provenance.legacy.kind', op: '==', value: 'plan' }],
      [{ field: 'userId', op: '==', value: 'owner' }],
    ]);
    expect(boundary.getDocFromServer).toHaveBeenCalledTimes(1);
    expect(boundary.runTransaction).not.toHaveBeenCalled();
  });

  it('preserves migration output, non-study plans, old/future recurrences, multi-day spans and colliding legacy IDs', async () => {
    const plans = [
      plan({ id: 'same-id', date: '2019-01-01', type: 'deadline', busy: false }),
      plan({ id: 'repeating', seriesId: 'repeating', date: '2030-01-01', repeat: 'weekly', repeatUntil: '2031-01-01',
        excludedDates: ['2030-01-08'], recurrenceRules: [{ id: 'rule', kind: 'weekday', startDate: '2030-01-01', until: '2031-01-01', dates: [], weekdays: ['tue'], dayType: null, startTime: '23:00', endTime: '24:00', isOverride: false }] }),
      plan({ id: 'child', seriesId: 'repeating', sourceType: 'timetable', sourceId: 'template', sourceDate: '2030-01-08' }),
    ];
    const monthEvents = [event({ id: 'same-id', date: '2020-01-01', endDate: '2020-01-04', repeat: 'yearly', repeatUntil: '2032-01-01', excludedDates: ['2027-01-01'], busy: false,
      url: 'https://example.com', memo: 'Preserve', locationTags: ['School'], checklist: [{ id: 'c', text: 'Prepare', checked: true }] })];
    // Inputs are real legacy records with no canonical kind/provenance fields.
    seed(migrateLegacyScheduleRecords({ plans, monthEvents }).events);
    seed([scheduleEventFromPlan(plan({ userId: 'other', id: 'foreign-plan' })), scheduleEventFromMonthEvent(event({ userId: 'other', id: 'foreign-event' }))]);
    const repo = repository(); const full = await repo.getScheduleSnapshot('owner');
    expect(await repo.getPlans('owner')).toEqual(full.plans);
    expect(await repo.getMonthEvents('owner')).toEqual(full.monthEvents);
    expect(full.plans).toHaveLength(3); expect(full.monthEvents).toHaveLength(1);
    for (const row of plans) expect(full.plans).toContainEqual(expect.objectContaining(row));
    expect(full.monthEvents).toEqual([expect.objectContaining(monthEvents[0])]);
    expect((await repo.getPlans('other')).map(row => row.id)).toEqual(['foreign-plan']);
    expect((await repo.getMonthEvents('other')).map(row => row.id)).toEqual(['foreign-event']);
  });

  it('does not use top-level kind or category to decide the compatibility projection', async () => {
    const row = scheduleEventFromPlan(plan({ type: 'school-event' }));
    // Historical presentation metadata cannot turn a Plan into a MonthEvent.
    delete (row as Partial<ScheduleEvent>).kind;
    seed([row]);
    const repo = repository();
    expect((await repo.getPlans('owner')).map(value => value.id)).toEqual(['plan']);
    expect(await repo.getMonthEvents('owner')).toEqual([]);
  });

  it('does not cache failed queries, saved rows or external edits and retains fresh deletion/reload', async () => {
    const repo = repository(); const original = event();
    await repo.upsertMonthEvent(original);
    expect(await repo.getMonthEvents('owner')).toEqual([original]);
    boundary.getDocs.mockRejectedValueOnce({ code: 'permission-denied', message: 'denied' });
    await expect(repo.getMonthEvents('owner')).rejects.toThrow('permission-denied');
    seed([scheduleEventFromMonthEvent({ ...original, title: 'Other device edit' })]);
    expect((await repo.getMonthEvents('owner'))[0].title).toBe('Other device edit');
    await repo.deleteMonthEvent('owner', original.id);
    expect(await repository().getMonthEvents('owner')).toEqual([]);
    expect(reads.map(read => read.ids.length)).toEqual([1, 1, 0]);
    expect(actualQueries).toEqual([{ source: { name: 'actuals' }, clauses: [
      { field: 'userId', op: '==', value: 'owner' }, { field: 'planId', op: '==', value: original.id },
    ] }]);
    expect(boundary.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy capability fallback and checks the migration marker again on the next read', async () => {
    const legacy = createUnavailablePlannerRepository();
    legacy.getMonthEvents = vi.fn(async () => [event({ title: 'Legacy source' })]);
    const repo = createScheduleEventBackedPlannerRepository(legacy, createFirebaseScheduleEventAuthority({} as Firestore));
    boundary.getDocFromServer.mockRejectedValueOnce({ code: 'permission-denied' });
    expect((await repo.getMonthEvents('owner'))[0].title).toBe('Legacy source');
    expect(reads).toHaveLength(0);
    seed([scheduleEventFromMonthEvent(event({ title: 'Migrated source' }))]);
    expect((await repo.getMonthEvents('owner'))[0].title).toBe('Migrated source');
    expect(boundary.getDocFromServer).toHaveBeenCalledTimes(2);
    expect(legacy.getMonthEvents).toHaveBeenCalledOnce();
    expect(reads[0].ids).toEqual(['month-event:event']);
  });

  it('bounds actual hook recovery after an overlapping MonthEvent save to its 20 documents', async () => {
    const { monthEvents } = history(); boundary.repository = repository();
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.plannerDataAvailability.status).toBe('ready');
    const write = deferred(), entered = deferred();
    const save = boundary.repository.upsertMonthEvent;
    boundary.repository.upsertMonthEvent = async row => { entered.resolve(); await write.promise; return save(row); };
    let saving!: Promise<void>;
    await act(async () => { saving = state.saveMonthEvent({ ...createMonthEventDraftFromEvent(monthEvents[0]), title: 'New title' }, monthEvents[0].id); await entered.promise; });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.plannerDataAvailability.status).toBe('stale');
    reads.length = 0;
    await act(async () => { write.resolve(); await saving; });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.monthEvents.find(row => row.id === monthEvents[0].id)?.title).toBe('New title');
    expect(state.plans).toHaveLength(1_000);
    console.info('overlapping-save targeted recovery document results:', reads.map(read => read.ids.length));
    expect(reads.map(read => read.ids.length)).toEqual([20]);
    // An explicit reload remains complete and sees the saved event.
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(reads[reads.length - 1]?.ids).toHaveLength(1_020);
    expect(state.monthEvents.find(row => row.id === monthEvents[0].id)?.title).toBe('New title');
  });
});
