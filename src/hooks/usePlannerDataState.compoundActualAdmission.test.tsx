import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlanDraftFromPlan } from '../domain/planner';
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import {
  actual as makeActual, createLocalFixture, DATE, deferred, event as makeEvent, plan as makePlan,
} from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { Actual, ActualDraft, Plan, RecurringPlanScope } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const A = makePlan({ id: 'a', seriesId: 'a' });
const B = makePlan({ id: 'b', seriesId: 'b' });
const C = makePlan({ id: 'c', seriesId: 'c' });
const R = makePlan({ id: 'recurring', seriesId: 'recurring', repeat: 'daily', repeatUntil: '2026-10-31' });
const LINKED = makeActual({ id: 'linked', planId: A.id });
const STANDALONE = makeActual({ id: 'standalone', planId: null });
const R_ACTUAL = makeActual({ id: 'recurring-actual', planId: R.id });
const NEXT_DATE = '2026-10-05';
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
function draft(plan: Plan = A, overrides: Partial<ActualDraft> = {}): ActualDraft {
  return { userId: 'owner', planId: plan.id, occurrenceDate: DATE, title: 'Actual input', subject: 'Math',
    actualStartTime: '09:00', actualEndTime: '10:00', isAlignedToPlan: false, note: 'Keep this draft',
    materialProgressUpdates: [], ...overrides };
}
async function mount(actuals: Actual[] = [LINKED, STANDALONE, R_ACTUAL]) {
  const fixture = createLocalFixture();
  for (const plan of [A, B, C, R]) await fixture.repository.upsertPlan(plan);
  for (const actual of actuals) await fixture.repository.upsertActual(actual);
  const save = vi.fn(fixture.repository.upsertActualWithMaterialProgress);
  const link = vi.fn(fixture.repository.upsertActual);
  const remove = vi.fn(fixture.repository.deleteActual);
  const deletePlan = vi.fn(fixture.repository.deletePlanWithDependents);
  const restore = vi.fn(fixture.repository.restorePlanWithDependents);
  const recurring = vi.fn(fixture.repository.applyRecurringPlanMutation);
  boundary.repository = { ...fixture.repository, upsertActualWithMaterialProgress: save, upsertActual: link,
    deleteActual: remove, deletePlanWithDependents: deletePlan, restorePlanWithDependents: restore,
    applyRecurringPlanMutation: recurring };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return { ...fixture, save, link, remove, deletePlan, restore, recurring };
}
// Artificial facade admission gates exercise bidirectional hook exclusions;
// admitted persistence still runs through the normal public local factory.
function hold(method: keyof PlannerRepository) {
  const entered = deferred(), release = deferred();
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  let first = true;
  const dispatch = vi.fn(async (...args: unknown[]) => {
    if (!first) return original(...args);
    first = false;
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  boundary.repository = { ...boundary.repository, [method]: dispatch };
  return { entered, release, dispatch };
}
const capture = (operation: Promise<unknown>) => operation.then(() => undefined, (error: unknown) => error);
async function start(operation: () => Promise<unknown>, gate: ReturnType<typeof hold>) {
  let done!: Promise<unknown>;
  await act(async () => { done = capture(operation()); await gate.entered.promise; });
  return { done };
}
async function finish(gate: ReturnType<typeof hold>, done: Promise<unknown>, failure?: Error) {
  let result: unknown;
  await act(async () => {
    if (failure) gate.release.reject(failure); else gate.release.resolve();
    result = await done;
  });
  return result;
}
async function rejected(operation: () => Promise<unknown>) {
  let error: unknown;
  await act(async () => { error = await capture(operation()); });
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message.trim()).not.toBe('');
  return error as Error;
}
async function retainUndo() {
  await act(async () => { await state.deletePlan(A); });
  const undo = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  expect(undo).toBeTypeOf('function');
  return async () => { await undo!(); };
}
async function stageRecurringDelete() {
  await act(async () => { await state.deletePlan(R); });
  expect(state.pendingRecurringPlanAction).toMatchObject({ kind: 'delete', plan: { id: R.id } });
}
async function expectActualActionsBlocked(plan: Plan, actual?: Actual) {
  await rejected(() => state.saveActual(plan, draft(plan)));
  await rejected(() => state.linkStandaloneActualToPlan(STANDALONE, plan));
  if (actual) {
    await rejected(() => state.saveActual(plan, draft(plan), actual.id));
    await rejected(() => state.deleteActual(actual));
  }
}
async function saveUnrelated() {
  await act(async () => {
    await state.saveActual(B, draft(B));
    await state.saveStandaloneActual(draft(B, { planId: null }), STANDALONE.id);
  });
}
const normalize = (records: Actual[]) => records.slice().sort((left, right) => left.id.localeCompare(right.id));

// Direct Actual versus compound Plan writers share admission, without queued
// retries, identity aliases, or cross-client/backend transaction guarantees.
describe('compound Plan / Actual shared admission', () => {
  it('rejects Plan deletion during a pending Actual create without orphaning its record', async () => {
    const fixture = await mount([STANDALONE]);
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveActual(A, draft()), gate);
    await rejected(() => state.deletePlan(A));
    expect(fixture.deletePlan).not.toHaveBeenCalled();
    expect(state.plans.some(plan => plan.id === A.id)).toBe(true);
    await act(async () => { await state.deletePlan(C); });
    expect(await finish(gate, done)).toBeUndefined();
    await act(async () => { await state.deletePlan(A); });
    expect((await fixture.repository.getActuals('owner')).some(actual => actual.planId === A.id)).toBe(false);
    expect((await fixture.repository.getPlans('owner')).some(plan => plan.id === A.id)).toBe(false);
  });

  it('reserves both source and destination Plans while an Actual moves between them', async () => {
    const fixture = await mount();
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveActual(A, draft(B), LINKED.id), gate);
    await rejected(() => state.deletePlan(A));
    await rejected(() => state.deletePlan(B));
    expect(fixture.deletePlan).not.toHaveBeenCalled();
    await act(async () => { await state.deletePlan(C); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.actuals.find(actual => actual.id === LINKED.id)?.planId).toBe(B.id);
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
  });

  it('rejects recurring scope dispatch while its Actual is pending, then allows retry after settlement', async () => {
    const fixture = await mount([STANDALONE]);
    await stageRecurringDelete();
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveActual(R, draft(R)), gate);
    showNotice.mockClear();
    await act(async () => { await capture(state.confirmRecurringPlanScope('all')); });
    expect(fixture.recurring).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(await finish(gate, done)).toBeUndefined();
    await stageRecurringDelete();
    await act(async () => { await state.confirmRecurringPlanScope('all'); });
    expect(fixture.recurring).toHaveBeenCalledTimes(1);
    expect((await fixture.repository.getActuals('owner')).some(actual => actual.planId === R.id)).toBe(false);
  });

  it.each([false, true])('Plan deletion blocks same-Plan Actual actions until settlement (failure=%s)', async failDelete => {
    const fixture = await mount();
    const gate = hold('deletePlanWithDependents');
    const { done } = await start(() => state.deletePlan(A), gate);
    await expectActualActionsBlocked(A, LINKED);
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.link).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    await saveUnrelated();
    const failure = new Error('Plan deletion failed');
    expect(await finish(gate, done, failDelete ? failure : undefined)).toBe(failDelete ? failure : undefined);
    if (failDelete) {
      expect(state.getActualActionBlockReason(LINKED)).toBeNull();
      await act(async () => { await state.saveActual(A, draft(), LINKED.id); });
    } else {
      expect(state.plans.some(plan => plan.id === A.id)).toBe(false);
      await rejected(() => state.saveActual(A, draft()));
    }
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
  });

  it.each([false, true])('captured Undo blocks Actual actions and releases after settlement (failure=%s)', async failUndo => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = hold('restorePlanWithDependents');
    const { done } = await start(undo, gate);
    await expectActualActionsBlocked(A, LINKED);
    await saveUnrelated();
    await act(async () => { await undo(); });
    expect(gate.dispatch).toHaveBeenCalledTimes(1);
    showNotice.mockClear();
    const failure = new Error('Undo failed');
    await finish(gate, done, failUndo ? failure : undefined);
    if (failUndo) {
      expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
      expect(state.plans.some(plan => plan.id === A.id)).toBe(false);
      await act(async () => { await undo(); });
    }
    expect(state.plans.some(plan => plan.id === A.id)).toBe(true);
    expect(state.getActualActionBlockReason(LINKED)).toBeNull();
    await act(async () => { await state.saveActual(A, draft(), LINKED.id); });
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
  });

  it('rejects a retained Undo while a newly admitted Actual action owns its restored Plan', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    await act(async () => { await undo(); });
    expect(fixture.restore).toHaveBeenCalledTimes(1);
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveActual(A, draft(), LINKED.id), gate);
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.restore).toHaveBeenCalledTimes(1);
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.getActualActionBlockReason(LINKED)).toBeNull();
  });

  it.each(['single', 'future', 'all'] as const)('pending recurring %s deletion excludes Actual mutations without freezing other Plans', async (scope: RecurringPlanScope) => {
    const fixture = await mount();
    await stageRecurringDelete();
    const gate = hold('applyRecurringPlanMutation');
    const { done } = await start(() => state.confirmRecurringPlanScope(scope), gate);
    await expectActualActionsBlocked(R, R_ACTUAL);
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.link).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    await saveUnrelated();
    expect(await finish(gate, done)).toBeUndefined();
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
    expect(state.getActualActionBlockReason(STANDALONE)).toBeNull();
  });

  it('failed recurring mutation releases its claims and permits the current Actual to retry', async () => {
    const fixture = await mount();
    await stageRecurringDelete();
    const gate = hold('applyRecurringPlanMutation');
    const { done } = await start(() => state.confirmRecurringPlanScope('all'), gate);
    await expectActualActionsBlocked(R, R_ACTUAL);
    await finish(gate, done, new Error('Recurring persistence failed'));
    expect(state.plans.some(plan => plan.id === R.id)).toBe(true);
    expect(state.getActualActionBlockReason(R_ACTUAL)).toBeNull();
    await act(async () => { await state.saveActual(R, draft(R), R_ACTUAL.id); });
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
  });

  it('reserves newly created recurrence destination IDs as well as the source Plan', async () => {
    await mount();
    const occurrence = { ...R, date: NEXT_DATE, occurrenceDate: NEXT_DATE };
    await act(async () => { state.openEditPlan(occurrence); });
    await act(async () => { await state.savePlanDraft({ ...createPlanDraftFromPlan(occurrence), title: 'Future segment' }, R.id); });
    expect(state.pendingRecurringPlanAction?.kind).toBe('edit');
    const gate = hold('applyRecurringPlanMutation');
    const { done } = await start(() => state.confirmRecurringPlanScope('future'), gate);
    const mutation = gate.dispatch.mock.calls[0][1] as RecurringPlanMutation;
    const destination = mutation.planUpserts.find(plan => plan.id !== R.id)!;
    expect(destination).toBeDefined();
    await rejected(() => state.saveActual(R, draft(R)));
    await rejected(() => state.saveActual(destination, draft(destination, { occurrenceDate: NEXT_DATE })));
    expect(await finish(gate, done)).toBeUndefined();
    const reopened = state.plans.find(plan => plan.id === destination.id)!;
    await act(async () => { await state.saveActual(reopened, draft(reopened, { occurrenceDate: NEXT_DATE })); });
    expect(state.actuals.some(actual => actual.planId === destination.id)).toBe(true);
  });

  it.each(['create', 'link'] as const)('rejects retained %s after the target Plan was deleted instead of producing an orphan', async action => {
    const fixture = await mount([STANDALONE]);
    const retained = state;
    await act(async () => { await state.deletePlan(A); });
    const error = await rejected(() => action === 'create'
      ? retained.saveActual(A, draft()) : retained.linkStandaloneActualToPlan(STANDALONE, A));
    expect(error.message).toMatch(/開き直|開きなお|reopen/i);
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.link).not.toHaveBeenCalled();
    expect(await fixture.repository.getActuals('owner')).toEqual([STANDALONE]);
  });

  it('accepts a current month-event-backed Actual target even though it is absent from stored Plans', async () => {
    const fixture = await mount([STANDALONE]);
    const event = makeEvent({ id: 'month-event-target' });
    await fixture.repository.upsertMonthEvent(event);
    await act(async () => { await state.loadPlannerData('owner'); });
    const target = makePlan({ id: event.id, seriesId: event.id, sourceType: 'manual', sourceId: event.id, type: 'other' });
    expect(state.plans.some(plan => plan.id === target.id)).toBe(false);
    await act(async () => { await state.saveActual(target, draft(target)); });
    expect(state.actuals.some(actual => actual.planId === event.id)).toBe(true);
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
  });
});
