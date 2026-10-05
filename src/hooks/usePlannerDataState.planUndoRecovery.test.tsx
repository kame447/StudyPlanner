import { plannerReadMethods as allGetters, spyPlannerReads } from './plannerReadSpies.testUtils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as dates from '../lib/date';
import { createMonthEventDraftFromEvent } from '../domain/planner';
import {
  actual as makeActual, createLocalFixture, DATE, deferred, event as makeEvent,
  MemoryStorage, microtasks, plan as makePlan, STAMP, todo as makeTodo,
} from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { StudyMaterial } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));

const P = makePlan({ sourceType: 'todo', sourceId: 'todo' });
const T = makeTodo();
const M: StudyMaterial = {
  id: 'material', userId: 'owner', name: 'Book', subjectId: 'math', subjectName: 'Math',
  paceEnabled: true, currentUnit: 25, totalUnits: 100, progressUnit: 'page', createdAt: STAMP, updatedAt: STAMP,
};
const repairGetters = ['getPlans', 'getTodos', 'getActuals', 'getStudyMaterials'] as const;
const payloadCases = [
  { actualCount: 0, linkedTodo: false }, { actualCount: 1, linkedTodo: false },
  { actualCount: 2, linkedTodo: false }, { actualCount: 0, linkedTodo: true },
  { actualCount: 1, linkedTodo: true }, { actualCount: 2, linkedTodo: true },
];
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let harnessOwner: string | null = 'owner';
function Harness() { state = usePlannerDataState({ userId: harnessOwner, showNotice }); return null; }
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

const normalized = (rows: readonly { id: string }[]) => structuredClone([...rows]).sort((a, b) => a.id.localeCompare(b.id));
function projection() {
  return structuredClone({ plans: normalized(state.plans), actuals: normalized(state.actuals),
    todos: normalized(state.todos), materials: normalized(state.studyMaterials) });
}
function unrelated() {
  return structuredClone({ events: state.monthEvents, subjects: state.studySubjects, dayNotes: state.dayNotes,
    templates: state.scheduleTemplates, terms: state.timetableTerms, periods: state.timetablePeriods });
}
async function expectStoredProjection(repository: PlannerRepository) {
  expect(normalized(state.plans)).toEqual(normalized(await repository.getPlans('owner')));
  expect(normalized(state.actuals)).toEqual(normalized(await repository.getActuals('owner')));
  expect(normalized(state.todos)).toEqual(normalized(await repository.getTodos('owner')));
  expect(normalized(state.studyMaterials)).toEqual(normalized(await repository.getStudyMaterials('owner')));
}
async function mount({ actualCount = 1, linkedTodo = true, storage = new MemoryStorage() }: {
  actualCount?: number; linkedTodo?: boolean; storage?: Storage;
} = {}) {
  harnessOwner = 'owner';
  const fixture = createLocalFixture(storage);
  boundary.repository = { ...fixture.repository };
  const plan = linkedTodo ? P : makePlan();
  const actuals = Array.from({ length: actualCount }, (_, index) => makeActual({
    id: `actual-${index}`, occurrenceDate: index === 0 ? DATE : '2026-10-05',
    note: `Original Actual ${index}`, materialProgressUpdates: [{ materialId: M.id, deltaUnits: 5 }],
  }));
  await fixture.repository.upsertPlan(plan);
  for (const actual of actuals) await fixture.repository.upsertActual(actual);
  if (linkedTodo) await fixture.repository.upsertTodo(T);
  await fixture.repository.upsertStudyMaterial(M);
  await fixture.repository.upsertMonthEvent(makeEvent());
  await fixture.repository.upsertStudySubject({ id: 'math', userId: 'owner', name: 'Math', color: '#112233', createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertDayNote({ id: 'note', userId: 'owner', date: DATE, quickMemo: 'Keep memo', reflection: 'Keep reflection', nextFocus: 'Keep focus', checkedPlan: true, checkedRecord: false, checkedReady: false, updatedAt: STAMP });
  await fixture.repository.upsertTimetableTerm({ id: '2026-full-year', userId: 'owner', year: 2026, kind: 'fullYear', label: '2026年 通年', isActive: true, createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertTimetablePeriod({ id: 'period', userId: 'owner', termId: '2026-full-year', periodNumber: 1, label: 'Period sentinel', startTime: '12:00', endTime: '13:00', createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertScheduleTemplate({ id: 'template', userId: 'owner', title: 'Template sentinel', subject: 'Math', type: 'study', weekday: 'mon', startTime: '12:00', endTime: '13:00', termId: '2026-full-year', memo: '', active: true, createdAt: STAMP, updatedAt: STAMP });
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return { ...fixture, plan, actuals };
}
async function retainUndo() {
  await act(async () => { await state.deletePlan(state.plans.find(plan => plan.id === P.id)!); });
  const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  if (!action) throw Error('Delete must expose Undo');
  return async () => { await action(); };
}
function spyReads() {
  return spyPlannerReads(boundary.repository);
}
function expectRepairCost(reads: ReturnType<typeof spyReads>, count = 1) {
  for (const name of allGetters) {
    expect(reads[name], name).toHaveBeenCalledTimes(repairGetters.includes(name as typeof repairGetters[number]) ? count : 0);
  }
}

/** Artificial facade delivery/admission gates model callback schedules only.
 * The underlying production-local operation always enters the normal queue and
 * finishes before delivery is held. No raw adapter or queued operation is bypassed. */
function gateRestore({ holdAdmission = false }: { holdAdmission?: boolean } = {}) {
  const admission = deferred(), persisted = deferred(), response = deferred();
  const original = boundary.repository.restorePlanWithDependents;
  const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents').mockImplementation(async mutation => {
    if (holdAdmission) await admission.promise;
    await original(mutation);
    persisted.resolve();
    await response.promise;
  });
  return { admission, persisted, response, restore };
}
async function releaseRestore(gate: ReturnType<typeof gateRestore>, done: Promise<void>) {
  await act(async () => {
    gate.admission.resolve();
    await gate.persisted.promise;
    gate.response.resolve();
    await done;
  });
}
async function writeNewer(repository: PlannerRepository) {
  const plans = await repository.getPlans('owner');
  const actuals = await repository.getActuals('owner');
  const todos = await repository.getTodos('owner');
  await repository.upsertPlan({ ...plans[0], title: 'Newer accepted Plan' });
  for (const actual of actuals) await repository.upsertActual({ ...actual, note: 'Newer accepted Actual' });
  if (todos[0]) await repository.upsertTodo({ ...todos[0], title: 'Newer accepted Todo', memo: 'Newer accepted Todo' });
}

class CompensationFaultStorage extends MemoryStorage {
  armed = false;
  scheduleWrites = 0;
  override setItem(key: string, value: string) {
    if (this.armed && key === 'studyplanner.actuals') throw Error('Injected forward Actual write failure');
    if (this.armed && key === 'studyplanner.scheduleEvents.v1' && ++this.scheduleWrites === 2) {
      throw Error('Injected ScheduleEvent compensation failure');
    }
    super.setItem(key, value);
  }
}

describe('Plan Undo repair through the public local factory', () => {
  it.each(payloadCases)('uncontended Undo preserves payload and adds no reads: $actualCount Actuals, Todo=$linkedTodo', async options => {
    const fixture = await mount(options);
    const original = projection(), untouched = unrelated();
    const undo = await retainUndo();
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const progress = vi.spyOn(boundary.repository, 'upsertActualWithMaterialProgress');
    await act(async () => { await undo(); });
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(projection()).toEqual(original);
    expect(unrelated()).toEqual(untouched);
    expect(state.studyMaterials[0].currentUnit).toBe(25);
    expect(state.plannerDataAvailability.status).toBe('ready');
    await expectStoredProjection(fixture.repository);
  });

  it('a retained notice invoked after a finished full refresh starts a valid new restore without repair reads', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    await act(async () => { await state.loadPlannerData('owner'); });
    const reads = spyReads();
    const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents');
    await act(async () => { await undo(); });
    expect(restore).toHaveBeenCalledTimes(1);
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    expect(state.plans[0].id).toBe(P.id);
    expect(state.todos[0].scheduledPlanId).toBe(P.id);
    await expectStoredProjection(fixture.repository);
  });

  it.each(payloadCases)('NATIVE ungated: full-load then retained Undo repairs older accepted full: $actualCount Actuals, Todo=$linkedTodo', async options => {
    const fixture = await mount(options);
    const original = projection(), untouched = unrelated();
    const undo = await retainUndo();
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const trace: string[] = [];
    await act(async () => {
      const loading = state.loadPlannerData('owner').then(() => { trace.push('full returned'); });
      const restoring = undo().then(() => { trace.push('Undo returned'); });
      await Promise.all([loading, restoring]);
    });
    expect(trace).toEqual(['Undo returned', 'full returned']);
    for (const name of allGetters) expect(reads[name], name).toHaveBeenCalledTimes(repairGetters.includes(name as typeof repairGetters[number]) ? 2 : 1);
    expect(normalize).toHaveBeenCalledTimes(1); // Only the requested full load normalizes.
    await expectStoredProjection(fixture.repository);
    expect(state.plans).toHaveLength(1);
    expect(state.actuals).toHaveLength(options.actualCount);
    expect(projection()).toEqual(original);
    if (options.linkedTodo) expect(state.todos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: P.id });
    else expect(state.todos).toEqual([]);
    expect(unrelated()).toEqual(untouched);
    expect(state.plannerDataAvailability.status).toBe('ready');
  });

  it('NATIVE ungated: a full snapshot captured before failed physical compensation converges to final partial storage while retaining failure', async () => {
    const storage = new CompensationFaultStorage();
    const fixture = await mount({ storage });
    const untouched = unrelated();
    const undo = await retainUndo();
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    storage.armed = true;
    await act(async () => {
      const loading = state.loadPlannerData('owner');
      const restoring = undo();
      await Promise.all([loading, restoring]);
    });
    storage.armed = false;
    expect(storage.scheduleWrites).toBe(2);
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(false);
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect((await fixture.repository.getPlans('owner'))).toHaveLength(1);
    expect(state.plans).toHaveLength(1);
    expect(state.actuals).toEqual([]);
    expect(state.todos[0].status).toBe('open');
    for (const name of allGetters) expect(reads[name], name).toHaveBeenCalledTimes(repairGetters.includes(name as typeof repairGetters[number]) ? 2 : 1);
    expect(normalize).toHaveBeenCalledTimes(1);
    await expectStoredProjection(fixture.repository);
    expect(unrelated()).toEqual(untouched);
    expect(state.plannerDataAvailability.status).toBe('ready');
  });

  it('outer response-delivery schedule: fences captured Plan, Actual and Todo together before a four-read repair can finish', async () => {
    const fixture = await mount({ actualCount: 2 });
    const undo = await retainUndo();
    const gate = gateRestore();
    let done!: Promise<void>;
    await act(async () => { done = undo(); await gate.persisted.promise; });
    await writeNewer(fixture.repository);
    await act(async () => { await state.loadPlannerData('owner'); });
    const accepted = projection(), untouched = unrelated();
    await act(async () => {
      state.openEditPlan(state.plans[0]);
      state.openDay('2026-12-20');
    });
    const editor = state.editorDraft;
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const entered = deferred(), delivery = deferred();
    reads.getPlans.mockImplementationOnce(async (owner: string) => {
      const rows = await fixture.repository.getPlans(owner);
      entered.resolve(); await delivery.promise; return rows;
    });
    await act(async () => { gate.response.resolve(); await done; await entered.promise; });
    expect(projection()).toEqual(accepted);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.editorDraft).toBe(editor);
    expect(state.selectedDate).toBe('2026-12-20');
    await act(async () => { delivery.resolve(); });
    expectRepairCost(reads);
    expect(normalize).not.toHaveBeenCalled();
    expect(gate.restore).toHaveBeenCalledTimes(1);
    expect(projection()).toEqual(accepted);
    expect(unrelated()).toEqual(untouched);
    expect(state.plannerDataAvailability.status).toBe('ready');
    await expectStoredProjection(fixture.repository);
  });

  it('outer admission schedule: restore persisting after accepted full refresh rereads all four effect collections only', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = gateRestore({ holdAdmission: true });
    let done!: Promise<void>;
    await act(async () => { done = undo(); });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.plans).toEqual([]);
    expect(state.plannerDataAvailability.status).toBe('stale');
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const untouched = unrelated();
    await releaseRestore(gate, done);
    expectRepairCost(reads);
    expect(normalize).not.toHaveBeenCalled();
    expect(unrelated()).toEqual(untouched);
    await expectStoredProjection(fixture.repository);
    expect(state.plans).toHaveLength(1);
    expect(state.plannerDataAvailability.status).toBe('ready');
  });

  it.each(repairGetters)('outer admission schedule: %s failure atomically preserves every visible slice and latches a read-only four-read retry', async failedGetter => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = gateRestore({ holdAdmission: true });
    let done!: Promise<void>;
    await act(async () => { done = undo(); });
    await act(async () => { await state.loadPlannerData('owner'); });
    const before = projection(), untouched = unrelated();
    const reads = spyReads();
    reads[failedGetter].mockRejectedValueOnce(Error(`Injected ${failedGetter} failure`));
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const progress = vi.spyOn(boundary.repository, 'upsertActualWithMaterialProgress');
    await releaseRestore(gate, done);
    expect(projection()).toEqual(before);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'projections', phase: 'failed', canRetry: true });
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(true);
    expectRepairCost(reads);
    await act(async () => { await microtasks(); });
    expectRepairCost(reads); // The failed concern does not spin or silently retry.
    await act(async () => { await state.retryPlannerData(); });
    expectRepairCost(reads, 2);
    expect(gate.restore).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(unrelated()).toEqual(untouched);
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.studyMaterials[0].currentUnit).toBe(25);
    await expectStoredProjection(fixture.repository);
  });

  it.each(['plans', 'materials'] as const)('outer admission schedule: %s preparation failure publishes no subset and retries the entire union', async failedPreparation => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = gateRestore({ holdAdmission: true });
    let done!: Promise<void>;
    await act(async () => { done = undo(); });
    await act(async () => { await state.loadPlannerData('owner'); });
    const before = projection(), untouched = unrelated();
    const reads = spyReads();
    if (failedPreparation === 'plans') {
      vi.spyOn(dates, 'sortByDateTime').mockImplementationOnce(() => { throw Error('Injected Plan preparation failure'); });
    } else {
      // A malformed read value fails local preparation after all four getters
      // fulfilled; unlike a getter rejection this specifically tests prepare-all.
      reads.getStudyMaterials.mockResolvedValueOnce([M, { ...M, id: 'bad-material', subjectName: null }] as unknown as StudyMaterial[]);
    }
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await releaseRestore(gate, done);
    expect(projection()).toEqual(before);
    expect(unrelated()).toEqual(untouched);
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'projections', phase: 'failed', canRetry: true });
    expectRepairCost(reads);
    await act(async () => { await state.retryPlannerData(); });
    expectRepairCost(reads, 2);
    expect(gate.restore).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
    expect(state.plannerDataAvailability.status).toBe('ready');
    await expectStoredProjection(fixture.repository);
  });

  it('outer response-delivery schedule: successful targeted repair preserves a newer full-read failure until an explicit full retry', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = gateRestore();
    let done!: Promise<void>;
    await act(async () => { done = undo(); await gate.persisted.promise; });
    await act(async () => { await state.loadPlannerData('owner'); });
    vi.spyOn(boundary.repository, 'getDayNotes').mockRejectedValueOnce(Error('New full read failed'));
    await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('New full read failed'); });
    const reads = spyReads();
    for (const read of Object.values(reads)) read.mockClear();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await act(async () => { gate.response.resolve(); await done; });
    expectRepairCost(reads);
    expect(normalize).not.toHaveBeenCalled();
    await expectStoredProjection(fixture.repository);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'full-read', phase: 'failed', canRetry: true });
    expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
    await act(async () => { await state.retryPlannerData(); });
    expect(gate.restore).toHaveBeenCalledTimes(1);
    for (const name of allGetters) expect(reads[name], name).toHaveBeenCalledTimes(repairGetters.includes(name as typeof repairGetters[number]) ? 2 : 1);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
  });

  it('outer response-delivery schedule: a failed-only full read retains the valid acknowledgement and creates no targeted repair', async () => {
    const fixture = await mount({ actualCount: 2 });
    const original = projection();
    const undo = await retainUndo();
    const gate = gateRestore();
    let done!: Promise<void>;
    await act(async () => { done = undo(); await gate.persisted.promise; });
    vi.spyOn(boundary.repository, 'getDayNotes').mockRejectedValueOnce(Error('Only full attempt fails'));
    await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('Only full attempt fails'); });
    const reads = spyReads();
    for (const read of Object.values(reads)) read.mockClear();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await act(async () => { gate.response.resolve(); await done; });
    expect(projection()).toEqual(original);
    await expectStoredProjection(fixture.repository);
    expect(gate.restore).toHaveBeenCalledTimes(1);
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(true);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'full-read', phase: 'failed', canRetry: true });
    expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  });

  it.each(['owner', 'reset', 'unmount'] as const)('a retained old notice invoked after %s dispatches no restore and leaves no repair effects', async edge => {
    const fixture = await mount();
    const undo = await retainUndo();
    await act(async () => {
      if (edge === 'owner') {
        harnessOwner = 'other';
        renderer!.update(<Harness />);
      } else if (edge === 'reset') {
        state.resetPlannerData();
      } else {
        renderer!.unmount();
        renderer = create(<Harness />);
      }
    });
    const nextOwner = edge === 'owner' ? 'other' : 'owner';
    await act(async () => { await state.loadPlannerData(nextOwner); });
    const accepted = projection();
    const reads = spyReads();
    const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents');
    const notices = showNotice.mock.calls.length;
    await act(async () => { await undo(); await microtasks(); });
    expect(restore).not.toHaveBeenCalled();
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledTimes(notices);
    expect(projection()).toEqual(accepted);
    expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: nextOwner });
    expect(state.plannerDataRecovery).toBeNull();
    // A later full read also sees no activity/effect left by the rejected notice.
    await act(async () => { await state.loadPlannerData(nextOwner); });
    for (const read of Object.values(reads)) expect(read).toHaveBeenCalledTimes(1);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(await fixture.repository.getPlans('owner')).toEqual([]);
  });

  it('outer response-delivery schedule: old owner restoration cannot contaminate the next owner when acknowledgement arrives', async () => {
    const fixture = await mount();
    await fixture.repository.upsertPlan(makePlan({ id: 'other-plan', seriesId: 'other-plan', userId: 'other', title: 'Other owner Plan' }));
    await fixture.repository.upsertActual(makeActual({ id: 'other-actual', userId: 'other', planId: 'other-plan', note: 'Other owner Actual' }));
    await fixture.repository.upsertTodo(makeTodo({ id: 'other-todo', userId: 'other', scheduledPlanId: 'other-plan', title: 'Other owner Todo' }));
    await fixture.repository.upsertStudyMaterial({ ...M, id: 'other-material', userId: 'other', name: 'Other owner Book' });
    const undo = await retainUndo();
    const gate = gateRestore();
    let done!: Promise<void>;
    await act(async () => { done = undo(); await gate.persisted.promise; });
    await act(async () => { harnessOwner = 'other'; renderer!.update(<Harness />); });
    await act(async () => { await state.loadPlannerData('other'); });
    const accepted = projection(), untouched = unrelated();
    const notices = showNotice.mock.calls.length;
    const reads = spyReads();
    await act(async () => { gate.response.resolve(); await done; await microtasks(); });
    expect(projection()).toEqual(accepted);
    expect(unrelated()).toEqual(untouched);
    expect(state.plans.map(plan => plan.id)).toEqual(['other-plan']);
    expect(state.actuals.map(actual => actual.id)).toEqual(['other-actual']);
    expect(state.todos.map(todo => todo.id)).toEqual(['other-todo']);
    expect(state.studyMaterials.map(material => material.id)).toEqual(['other-material']);
    expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: 'other' });
    expect(state.plannerDataRecovery).toBeNull();
    expect(showNotice).toHaveBeenCalledTimes(notices);
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    expect(gate.restore).toHaveBeenCalledTimes(1);
    expect((await fixture.repository.getPlans('owner')).map(plan => plan.id)).toEqual([P.id]);
    expect(normalized(state.plans)).toEqual(normalized(await fixture.repository.getPlans('other')));
    expect(normalized(state.actuals)).toEqual(normalized(await fixture.repository.getActuals('other')));
    expect(normalized(state.todos)).toEqual(normalized(await fixture.repository.getTodos('other')));
    expect(normalized(state.studyMaterials)).toEqual(normalized(await fixture.repository.getStudyMaterials('other')));
  });


  it.each(['restore-first', 'month-event-first'] as const)('outer response-delivery schedule: combines Plan Undo and MonthEvent repair atomically using five reads, settlement=%s', async order => {
    const fixture = await mount();
    const undo = await retainUndo();
    const restoreGate = gateRestore();
    const monthPersisted = deferred(), monthResponse = deferred();
    const originalMonthWrite = boundary.repository.upsertMonthEvent;
    const monthWrite = vi.spyOn(boundary.repository, 'upsertMonthEvent').mockImplementation(async event => {
      const result = await originalMonthWrite(event);
      monthPersisted.resolve();
      await monthResponse.promise;
      return result;
    });
    let restored!: Promise<void>, savedEvent!: Promise<void>;
    await act(async () => {
      restored = undo();
      savedEvent = state.saveMonthEvent({ ...createMonthEventDraftFromEvent(state.monthEvents[0]), title: 'Saved event' }, 'event');
      await Promise.all([restoreGate.persisted.promise, monthPersisted.promise]);
    });
    await act(async () => { await state.loadPlannerData('owner'); });
    const accepted = projection(), acceptedEvents = structuredClone(state.monthEvents);
    const untouched = unrelated();
    // Further public writes make each repair slice distinguishable from the full
    // snapshot; the held final getter then proves publication is one atomic union.
    await writeNewer(fixture.repository);
    await fixture.repository.upsertStudyMaterial({ ...M, currentUnit: 31 });
    await fixture.repository.upsertMonthEvent({ ...acceptedEvents[0], title: 'Newest durable event' });
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const entered = deferred(), delivery = deferred();
    reads.getMonthEvents.mockImplementationOnce(async (owner: string) => {
      const rows = await fixture.repository.getMonthEvents(owner);
      entered.resolve(); await delivery.promise; return rows;
    });
    await act(async () => {
      if (order === 'restore-first') { restoreGate.response.resolve(); await restored; }
      else { monthResponse.resolve(); await savedEvent; }
      await microtasks();
    });
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
    await act(async () => {
      if (order === 'restore-first') { monthResponse.resolve(); await savedEvent; }
      else { restoreGate.response.resolve(); await restored; }
      await entered.promise;
    });
    expect(projection()).toEqual(accepted);
    expect(state.monthEvents).toEqual(acceptedEvents);
    expect(state.plannerDataAvailability.status).toBe('stale');
    await act(async () => { delivery.resolve(); });
    for (const name of allGetters) {
      expect(reads[name], name).toHaveBeenCalledTimes(name === 'getMonthEvents'
        || repairGetters.includes(name as typeof repairGetters[number]) ? 1 : 0);
    }
    expect(normalize).not.toHaveBeenCalled();
    expect(restoreGate.restore).toHaveBeenCalledTimes(1);
    expect(monthWrite).toHaveBeenCalledTimes(1);
    await expectStoredProjection(fixture.repository);
    expect(state.monthEvents).toEqual(await fixture.repository.getMonthEvents('owner'));
    expect(state.monthEvents[0].title).toBe('Newest durable event');
    expect(state.studyMaterials[0].currentUnit).toBe(31);
    expect(unrelated()).toEqual({ ...untouched, events: state.monthEvents });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.plannerDataRecovery).toBeNull();
  });


  it('without a full read: physical failed compensation repairs final partial storage with four getters and preserves the restore error', async () => {
    const storage = new CompensationFaultStorage();
    const fixture = await mount({ storage });
    const untouched = unrelated();
    const undo = await retainUndo();
    const reads = spyReads();
    const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents');
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    storage.armed = true;
    await act(async () => { await undo(); });
    storage.armed = false;
    const error = await (restore.mock.results[0].value as Promise<void>).catch(failure => failure as Error);
    if (!(error instanceof Error)) throw Error('The public restore must reject after failed compensation');
    expect(storage.scheduleWrites).toBe(2);
    expect(restore).toHaveBeenCalledTimes(1);
    expectRepairCost(reads);
    expect(normalize).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenLastCalledWith(error.message, 'error');
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(false);
    expect(state.plans).toHaveLength(1);
    expect(state.actuals).toEqual([]);
    expect(state.todos[0].status).toBe('open');
    expect(unrelated()).toEqual(untouched);
    await expectStoredProjection(fixture.repository);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.plannerDataRecovery).toBeNull();
  });

  it('without a full read: an untyped facade rejection conservatively reads all four effects even when it made no write', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    const before = projection(), untouched = unrelated();
    const error = Error('Untyped repository restore rejection');
    // The hook receives only Error, not a trustworthy no-write outcome receipt.
    // This facade stub makes no physical-write or production-local interleaving claim.
    const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents').mockRejectedValueOnce(error);
    const reads = spyReads();
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await act(async () => { await undo(); });
    expect(restore).toHaveBeenCalledTimes(1);
    expectRepairCost(reads);
    expect(normalize).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenLastCalledWith(error.message, 'error');
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(false);
    expect(projection()).toEqual(before);
    expect(unrelated()).toEqual(untouched);
    await expectStoredProjection(fixture.repository);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.plannerDataRecovery).toBeNull();
  });

  it.each(repairGetters)('without a full read: failed restore plus %s failure latches atomic read-only retry without inventing full-read failure', async failedGetter => {
    const storage = new CompensationFaultStorage();
    const fixture = await mount({ storage });
    const undo = await retainUndo();
    const before = projection(), untouched = unrelated();
    const reads = spyReads();
    reads[failedGetter].mockRejectedValueOnce(Error(`Injected failed-restore ${failedGetter} read`));
    const restore = vi.spyOn(boundary.repository, 'restorePlanWithDependents');
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const progress = vi.spyOn(boundary.repository, 'upsertActualWithMaterialProgress');
    storage.armed = true;
    await act(async () => { await undo(); });
    storage.armed = false;
    const error = await (restore.mock.results[0].value as Promise<void>).catch(failure => failure as Error);
    if (!(error instanceof Error)) throw Error('The public restore must reject after failed compensation');
    expect(projection()).toEqual(before);
    expectRepairCost(reads);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'projections', phase: 'failed', canRetry: true });
    expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
    expect(showNotice).toHaveBeenLastCalledWith(error.message, 'error');
    expect(showNotice.mock.calls.some(call => call[0] === '元に戻しました。')).toBe(false);
    const notices = showNotice.mock.calls.length;
    await act(async () => { await microtasks(); });
    expectRepairCost(reads); // Failed read concern stays latched until explicit retry.
    await act(async () => { await state.retryPlannerData(); });
    expectRepairCost(reads, 2);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledTimes(notices);
    expect(showNotice).toHaveBeenLastCalledWith(error.message, 'error');
    expect(unrelated()).toEqual(untouched);
    expect(state.plans).toHaveLength(1);
    await expectStoredProjection(fixture.repository);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
  });

});
