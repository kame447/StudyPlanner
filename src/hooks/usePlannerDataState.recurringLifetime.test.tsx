import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanDraftFromPlan } from '../domain/planner';
import { PlanEditorPanel } from '../components/PlanEditorPanel';
import { RecurringPlanScopeDialog } from '../components/RecurringPlanScopeDialog';
import { createLocalFixture, deferred, plan as makePlan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const A = makePlan({ id: 'a', seriesId: 'a', title: 'Plan A', repeat: 'daily', repeatUntil: '2026-12-31' });
const B = makePlan({ id: 'b', seriesId: 'b', title: 'Plan B', repeat: 'daily', repeatUntil: '2026-12-31' });
const LATER = '2026-11-14';
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer;
function Harness({ owner = 'owner' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: () => undefined });
  return <><PlanEditorPanel draft={state.editorDraft} heading="Editor" submitLabel="Save" onChange={state.setEditorDraft}
    onSubmit={() => state.savePlanDraft(state.editorDraft!)} onCancel={state.closePlanEditor} />
    {state.pendingRecurringPlanAction && <RecurringPlanScopeDialog action={state.pendingRecurringPlanAction.kind}
      plan={state.pendingRecurringPlanAction.plan} onSelect={state.confirmRecurringPlanScope} onClose={state.cancelRecurringPlanScope} />}</>;
}
async function mount() {
  const fixture = createLocalFixture();
  await fixture.repository.upsertPlan(A); await fixture.repository.upsertPlan(B);
  boundary.repository = fixture.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); state.openDay(A.date); });
  return fixture;
}
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
async function stage(kind: 'edit' | 'delete', plan = A) {
  if (kind === 'delete') await act(async () => { await state.deletePlan(plan); });
  else {
    await act(async () => { state.openEditPlan(plan); });
    await act(async () => { await state.savePlanDraft({ ...createPlanDraftFromPlan(plan), title: plan.title + ' edited' }); });
  }
}
async function start(kind: 'edit' | 'delete', afterPersist: boolean) {
  const gate = deferred(); const entered = deferred();
  const original = boundary.repository.applyRecurringPlanMutation;
  const dispatch = vi.fn(async (...args: Parameters<typeof original>) => {
    if (afterPersist) await original(...args);
    entered.resolve(); await gate.promise;
    if (!afterPersist) await original(...args);
  });
  boundary.repository = { ...boundary.repository, applyRecurringPlanMutation: dispatch };
  await stage(kind);
  let done!: Promise<void>;
  await act(async () => { done = renderer.root.findByType(RecurringPlanScopeDialog).props.onSelect('all'); await entered.promise; });
  return { gate, done, dispatch };
}

it.each((['edit', 'delete'] as const).flatMap(kind => [false, true].flatMap(afterPersist => ['editor', 'scope'].map(newer => ({ kind, afterPersist, newer })))))
 ('$kind completion preserves newer $newer, afterPersist=$afterPersist', async ({ kind, afterPersist, newer }) => {
    const fixture = await mount(); const pending = await start(kind, afterPersist);
    await act(async () => { renderer.root.findByType(RecurringPlanScopeDialog).props.onClose(); });
    await act(async () => { state.openEditPlan(B); state.openDay(LATER); });
    if (newer === 'scope') await stage('edit', B);
    else await act(async () => { state.setEditorDraft({ ...state.editorDraft!, title: 'Unsaved B' }); });
    // Accepted same-owner reads must not grant an old completion a new UI lifetime.
    await act(async () => { await state.loadPlannerData('owner'); });
    await act(async () => { pending.gate.resolve(); await pending.done; });
    expect(state.selectedDate).toBe(LATER);
    expect(state.monthDate).toBe('2026-11-01');
    if (newer === 'scope') expect(state.pendingRecurringPlanAction?.plan.id).toBe(B.id);
    else { expect(state.editorDraft?.title).toBe('Unsaved B'); expect(state.editingPlanId).toBe(B.id); }
    const saved = await fixture.repository.getPlans('owner');
    expect(saved.some(plan => plan.id === A.id)).toBe(kind === 'edit');
    if (kind === 'edit') expect(saved.find(plan => plan.id === A.id)?.title).toBe('Plan A edited');
  });

it.each(['selectDate', 'changeMonth', 'openDay', 'openWeek', 'same-date'] as const)('preserves explicit %s navigation after recurring success', async intent => {
  await mount(); const pending = await start('edit', false);
  await act(async () => {
    if (intent === 'same-date') state.selectDate(A.date);
    else state[intent](LATER);
  });
  const expected = { date: state.selectedDate, month: state.monthDate, view: state.viewMode };
  await act(async () => { pending.gate.resolve(); await pending.done; });
  expect({ date: state.selectedDate, month: state.monthDate, view: state.viewMode }).toEqual(expected);
  expect(state.pendingRecurringPlanAction).toBeNull();
});

it.each([false, true])('failure preserves its retry scope or newer scope, replacement=%s', async replacement => {
  await mount(); const pending = await start('edit', false);
  if (replacement) {
    await act(async () => { state.cancelRecurringPlanScope(); });
    await stage('edit', B);
  }
  await act(async () => { state.openDay(LATER); });
  await act(async () => { pending.gate.reject(new Error('write failed')); await pending.done; });
  expect(state.pendingRecurringPlanAction?.plan.id).toBe(replacement ? B.id : A.id);
  expect(state.selectedDate).toBe(LATER);
});

it('blocks duplicate dispatch, clears its own scope, and rolls back selection after an isolated failure', async () => {
  await mount();
  await act(async () => { state.openDay(LATER); });
  const pending = await start('edit', false);
  expect(state.selectedDate).toBe(A.date);
  await act(async () => { await expect(state.confirmRecurringPlanScope('all')).rejects.toThrow(); });
  expect(pending.dispatch).toHaveBeenCalledOnce();
  await act(async () => { pending.gate.reject(new Error('write failed')); await pending.done; });
  expect(state.selectedDate).toBe(LATER);
  expect(state.pendingRecurringPlanAction?.plan.id).toBe(A.id);
});

it('retries the retained edit scope with its original draft after a failed confirmation', async () => {
  const fixture = await mount(); const pending = await start('edit', false);
  await act(async () => { pending.gate.reject(new Error('write failed')); await pending.done; });
  boundary.repository = fixture.repository;
  await act(async () => { await state.confirmRecurringPlanScope('all'); });
  expect(state.pendingRecurringPlanAction).toBeNull();
  expect((await fixture.repository.getPlans('owner')).find(plan => plan.id === A.id)?.title).toBe('Plan A edited');
});

it.each(['date', 'month'] as const)('failed recurring selection does not undo an explicit equal %s intent', async intent => {
  await mount(); await act(async () => { state.openDay(LATER); });
  const pending = await start('edit', false);
  await act(async () => { if (intent === 'date') state.selectDate(A.date); else state.changeMonth(A.date.slice(0, 7) + '-01'); });
  await act(async () => { pending.gate.reject(new Error('write failed')); await pending.done; });
  expect(state.selectedDate).toBe(A.date);
});

it.each(['owner', 'reset', 'unmount'] as const)('late recurring success is inert after %s', async boundaryKind => {
  await mount(); const pending = await start('edit', false);
  await act(async () => {
    if (boundaryKind === 'owner') renderer.update(<Harness owner="new-owner" />);
    else if (boundaryKind === 'reset') state.resetPlannerData();
    else { renderer.unmount(); renderer = create(<Harness />); }
  });
  await act(async () => { state.openCreatePlan(); state.openDay(LATER); });
  await act(async () => { state.setEditorDraft({ ...state.editorDraft!, title: 'New session draft' }); });
  await act(async () => {
    pending.gate.resolve();
    await expect(pending.done).rejects.toBeInstanceOf(PlannerMutationScopeExpiredError);
  });
  expect(state.editorDraft?.title).toBe('New session draft');
  expect(state.selectedDate).toBe(LATER);
});

it.each([false, true].flatMap(firstSuccess => [false, true].flatMap(secondSuccess => [false, true].map(olderFirst => ({ firstSuccess, secondSuccess, olderFirst })))))
  ('orders recurring/ordinary selections across settlements $firstSuccess/$secondSuccess/$olderFirst', async ({ firstSuccess, secondSuccess, olderFirst }) => {
    const fixture = await mount(); await act(async () => { state.openDay(LATER); });
    const first = await start('edit', false);
    const gate = deferred();
    boundary.repository = { ...boundary.repository, upsertPlan: async plan => { await gate.promise; return fixture.repository.upsertPlan(plan); } };
    let second!: Promise<unknown>;
    const secondDate = '2026-12-14';
    await act(async () => { second = state.savePlanDraft(createPlanDraftFromPlan(makePlan({ id: 'new', date: secondDate }))).catch(error => error); });
    const finishFirst = async () => { await act(async () => { if (firstSuccess) first.gate.resolve(); else first.gate.reject(new Error('recurring failed')); await first.done; }); };
    const finishSecond = async () => { await act(async () => { if (secondSuccess) gate.resolve(); else gate.reject(new Error('ordinary failed')); await second; }); };
    if (olderFirst) { await finishFirst(); await finishSecond(); }
    else { await finishSecond(); await finishFirst(); }
    expect(state.selectedDate).toBe(secondSuccess ? secondDate : firstSuccess ? A.date : LATER);
  });
