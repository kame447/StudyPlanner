import { plannerReadMethods as names, spyPlannerReads } from './plannerReadSpies.testUtils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyDayNoteDraft } from '../domain/planner';
import { actual, createLocalFixture, DATE, deferred, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: vi.fn() }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const draft = () => ({ ...createEmptyDayNoteDraft('owner', DATE), quickMemo: 'saved new memo' });
async function mount() {
  const fixture = createLocalFixture();
  boundary.repository = { ...fixture.repository };
  await fixture.repository.upsertDayNote({ ...createEmptyDayNoteDraft('owner', DATE), id: 'note', quickMemo: 'old memo', updatedAt: STAMP });
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}

it('native full-read then DayNote save preserves the saved memo', async () => {
  const { repository } = await mount();
  const order: string[] = [];
  const get = boundary.repository.getDayNotes;
  boundary.repository.getDayNotes = async owner => { const rows = await get(owner); order.push('captured'); return rows; };
  const put = boundary.repository.upsertDayNote;
  boundary.repository.upsertDayNote = async row => { const saved = await put(row); order.push('persisted'); return saved; };
  await act(async () => {
    const loading = state.loadPlannerData('owner').then(() => { order.push('full returned'); });
    await Promise.all([loading, state.saveDayNote(draft())]);
  });
  expect(order.indexOf('captured')).toBeLessThan(order.indexOf('persisted'));
  expect(order.indexOf('persisted')).toBeLessThan(order.indexOf('full returned'));
  const stored = await repository.getDayNotes('owner');
  expect(stored[0].quickMemo).toBe('saved new memo');
  expect(state.dayNotes).toEqual(stored);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('late DayNote save acknowledgment cannot overwrite a newer accepted memo', async () => {
  const { repository } = await mount();
  const persisted = deferred(), response = deferred();
  const put = boundary.repository.upsertDayNote;
  boundary.repository.upsertDayNote = async row => { const saved = await put(row); persisted.resolve(); await response.promise; return saved; };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveDayNote(draft()); });
  await persisted.promise;
  await repository.upsertDayNote({ ...(await repository.getDayNotes('owner'))[0], quickMemo: 'newer accepted memo' });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.dayNotes[0].quickMemo).toBe('newer accepted memo');
  const repair = deferred();
  const get = boundary.repository.getDayNotes;
  boundary.repository.getDayNotes = async owner => { const rows = await get(owner); await repair.promise; return rows; };
  await act(async () => { response.resolve(); await saving; });
  expect(state.dayNotes[0].quickMemo).toBe('newer accepted memo');
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  await act(async () => { repair.resolve(); });
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
  expect(state.dayNotes[0].quickMemo).toBe('newer accepted memo');
});

it('a DayNote write after a full read still becomes visible', async () => {
  const { repository } = await mount();
  const gate = deferred();
  const put = boundary.repository.upsertDayNote;
  boundary.repository.upsertDayNote = async row => { await gate.promise; return put(row); };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveDayNote(draft()); });
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { gate.resolve(); await saving; });
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
  expect(state.dayNotes[0].quickMemo).toBe('saved new memo');
});

it('uncontended DayNote save adds no getters', async () => {
  const { repository } = await mount();
  const notes = vi.spyOn(boundary.repository, 'getDayNotes');
  const actuals = vi.spyOn(boundary.repository, 'getActuals');
  await act(async () => { await state.saveDayNote(draft()); });
  expect(notes).not.toHaveBeenCalled();
  expect(actuals).not.toHaveBeenCalled();
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
});

it.each(['getDayNotes', 'getActuals'] as const)('failed %s union publishes neither group and retry only reads without resaving', async failedGetter => {
  const { repository, storage } = await mount();
  const gate = deferred();
  const put = boundary.repository.upsertDayNote;
  const write = vi.fn(async (row: Parameters<typeof put>[0]) => { await gate.promise; return put(row); });
  boundary.repository.upsertDayNote = write;
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveDayNote(draft()); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const externalActual = actual({ planId: null });
  await repository.upsertActual(externalActual);
  const get = boundary.repository[failedGetter];
  boundary.repository = { ...boundary.repository, [failedGetter]: async () => { throw new Error('repair failed'); } };
  await act(async () => { state.openDay('2026-12-15'); gate.resolve(); await saving; });
  expect(state.dayNotes[0].quickMemo).toBe('old memo');
  expect(state.actuals).toEqual([]);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect((await repository.getDayNotes('owner'))[0].quickMemo).toBe('saved new memo');
  const storageWrites = vi.spyOn(storage, 'setItem');
  boundary.repository = { ...boundary.repository, [failedGetter]: get };
  const reads = spyPlannerReads(boundary.repository);
  const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await state.retryPlannerData(); });
  for (const name of names) expect(reads[name], name).toHaveBeenCalledTimes(
    ['getDayNotes', 'getActuals', 'getStudyMaterials'].includes(name) ? 1 : 0);
  expect(normalize).not.toHaveBeenCalled();
  expect(storageWrites).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(1);
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
  expect(state.actuals).toEqual(await repository.getActuals('owner'));
  expect(state.selectedDate).toBe('2026-12-15');
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('rejected DayNote write adds no note repair and preserves the accepted snapshot', async () => {
  const { repository } = await mount();
  const gate = deferred();
  boundary.repository.upsertDayNote = async () => { await gate.promise; throw new Error('not persisted'); };
  let saving!: Promise<unknown>;
  await act(async () => { saving = state.saveDayNote(draft()).catch(error => error); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const reads = vi.spyOn(boundary.repository, 'getDayNotes');
  await act(async () => { gate.resolve(); expect(await saving).toBeInstanceOf(Error); });
  expect(reads).not.toHaveBeenCalled();
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['reset', 'unmount'] as const)('old DayNote acknowledgement cannot publish or repair after %s', async lifetime => {
  await mount();
  const persisted = deferred(), response = deferred();
  const put = boundary.repository.upsertDayNote;
  boundary.repository.upsertDayNote = async row => { const saved = await put(row); persisted.resolve(); await response.promise; return saved; };
  let saving!: Promise<unknown>;
  await act(async () => { saving = state.saveDayNote(draft()).catch(error => error); });
  await persisted.promise;
  await act(async () => {
    if (lifetime === 'reset') state.resetPlannerData();
    else { renderer!.unmount(); renderer = undefined; }
  });
  const reads = vi.spyOn(boundary.repository, 'getDayNotes');
  await act(async () => { response.resolve(); expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError); });
  expect(reads).not.toHaveBeenCalled();
  if (lifetime === 'reset') expect(state.dayNotes).toEqual([]);
});

it.each([false, true])('failed full read preserves valid DayNote acknowledgement, superseded=%s', async superseded => {
  const { repository } = await mount();
  const persisted = deferred(), response = deferred(), oldRead = deferred();
  const put = boundary.repository.upsertDayNote;
  boundary.repository.upsertDayNote = async row => { const result = await put(row); persisted.resolve(); await response.promise; return result; };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveDayNote(draft()); });
  await persisted.promise;
  const get = boundary.repository.getScheduleSnapshot;
  let first = true;
  boundary.repository.getScheduleSnapshot = async owner => {
    if (superseded && first) { first = false; const rows = await get(owner); await oldRead.promise; return rows; }
    throw new Error('full read failed');
  };
  let loading: Promise<void> | undefined;
  if (superseded) await act(async () => { loading = state.loadPlannerData('owner'); });
  await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('full read failed'); });
  if (loading) await act(async () => { oldRead.resolve(); await loading; });
  const reads = vi.spyOn(boundary.repository, 'getDayNotes');
  await act(async () => { response.resolve(); await saving; });
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
  expect(state.dayNotes[0].quickMemo).toBe('saved new memo');
  expect(reads).not.toHaveBeenCalled();
  expect(state.plannerDataAvailability.status).toBe('stale');
});

it('pure Actual/material repair does not read DayNotes', async () => {
  await mount();
  const persisted = deferred(), response = deferred();
  const put = boundary.repository.upsertActualWithMaterialProgress;
  boundary.repository.upsertActualWithMaterialProgress = async (...args) => {
    const saved = await put(...args); persisted.resolve(); await response.promise; return saved;
  };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveStandaloneActual({ ...actual({ planId: null }),
    title: 'Actual control', isAlignedToPlan: false, materialProgressUpdates: [] }); });
  await persisted.promise;
  await act(async () => { await state.loadPlannerData('owner'); });
  const reads = vi.spyOn(boundary.repository, 'getDayNotes');
  await act(async () => { response.resolve(); await saving; });
  expect(reads).not.toHaveBeenCalled();
  expect(state.plannerDataAvailability.status).toBe('ready');
});
