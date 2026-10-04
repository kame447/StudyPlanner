import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actual as makeActual, createLocalFixture, DATE, deferred, plan as makePlan, STAMP,
} from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { Actual, ActualDraft, Plan, StudyMaterial } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));

const A = makePlan({ id: 'plan-a', seriesId: 'plan-a' });
const B = makePlan({ id: 'plan-b', seriesId: 'plan-b' });
const STANDALONE = makeActual({ id: 'standalone', planId: null });
const LINKED = makeActual({ id: 'linked', planId: A.id });
const NEXT_DATE = '2026-10-05';
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ owner = 'owner' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice });
  return null;
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

function draft(overrides: Partial<ActualDraft> = {}): ActualDraft {
  return { userId: 'owner', planId: A.id, occurrenceDate: DATE, title: 'Edited record',
    subject: 'Math', actualStartTime: '10:00', actualEndTime: '11:00', isAlignedToPlan: false,
    note: 'Preserve this input', materialProgressUpdates: [], ...overrides };
}
function occurrence(plan: Plan, date = DATE) {
  return { userId: plan.userId, planId: plan.id, occurrenceDate: date };
}
async function mount(actuals: Actual[] = [], materials: StudyMaterial[] = []) {
  const fixture = createLocalFixture();
  await fixture.repository.upsertPlan(A);
  await fixture.repository.upsertPlan(B);
  for (const actual of actuals) await fixture.repository.upsertActual(actual);
  for (const material of materials) await fixture.repository.upsertStudyMaterial(material);
  const save = vi.fn(fixture.repository.upsertActualWithMaterialProgress);
  const link = vi.fn(fixture.repository.upsertActual);
  const remove = vi.fn(fixture.repository.deleteActual);
  boundary.repository = { ...fixture.repository, upsertActualWithMaterialProgress: save,
    upsertActual: link, deleteActual: remove };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return { ...fixture, save, link, remove };
}

// These are artificial facade admission/response gates for the hook contract.
// All admitted writes still use the public local factory. They do not model
// ordinary synchronous local-storage timing or prove a current UI gesture.
function holdSave({ afterPersist = false }: { afterPersist?: boolean } = {}) {
  const entered = deferred(), release = deferred();
  const method = boundary.repository.upsertActualWithMaterialProgress;
  const original = vi.isMockFunction(method) ? method.getMockImplementation()! : method;
  let first = true;
  const held: PlannerRepository['upsertActualWithMaterialProgress'] = async mutation => {
    if (!first) return original(mutation);
    first = false;
    const saved = afterPersist ? await original(mutation) : undefined;
    entered.resolve();
    await release.promise;
    return saved ?? original(mutation);
  };
  if (vi.isMockFunction(method)) method.mockImplementation(held);
  else boundary.repository.upsertActualWithMaterialProgress = vi.fn(held);
  return { entered, release };
}
function holdLink() {
  const entered = deferred(), release = deferred();
  const method = boundary.repository.upsertActual;
  const original = vi.isMockFunction(method) ? method.getMockImplementation()! : method;
  let first = true;
  const held: PlannerRepository['upsertActual'] = async actual => {
    if (!first) return original(actual);
    first = false;
    entered.resolve();
    await release.promise;
    return original(actual);
  };
  if (vi.isMockFunction(method)) method.mockImplementation(held);
  else boundary.repository.upsertActual = vi.fn(held);
  return { entered, release };
}
function holdDelete() {
  const entered = deferred(), release = deferred();
  const method = boundary.repository.deleteActual;
  const original = vi.isMockFunction(method) ? method.getMockImplementation()! : method;
  let first = true;
  const held: PlannerRepository['deleteActual'] = async (owner, id) => {
    if (!first) return original(owner, id);
    first = false;
    entered.resolve();
    await release.promise;
    return original(owner, id);
  };
  if (vi.isMockFunction(method)) method.mockImplementation(held);
  else boundary.repository.deleteActual = vi.fn(held);
  return { entered, release };
}
const capture = (operation: Promise<void>) => operation.then(() => undefined, (error: unknown) => error);
async function start(operation: () => Promise<void>, gate: { entered: ReturnType<typeof deferred<void>> }) {
  let done!: Promise<unknown>;
  await act(async () => { done = capture(operation()); await gate.entered.promise; });
  return { done };
}
async function finish(gate: { release: ReturnType<typeof deferred<void>> }, done: Promise<unknown>, error?: Error) {
  let result: unknown;
  await act(async () => {
    if (error) gate.release.reject(error); else gate.release.resolve();
    result = await done;
  });
  return result;
}
async function expectBlocked(operation: () => Promise<void>, reason: string | null) {
  expect(reason).toBeTypeOf('string');
  expect(reason?.trim().length).toBeGreaterThan(0);
  let error: unknown;
  await act(async () => { error = await capture(operation()); });
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(reason);
}
const actions = ['standalone-save', 'linked-save', 'link', 'delete'] as const;
type Action = typeof actions[number];
function dispatch(action: Action, actual: Actual, api = state) {
  switch (action) {
    case 'standalone-save': return api.saveStandaloneActual(draft({ planId: null, userId: actual.userId }), actual.id);
    case 'linked-save': return api.saveActual(A, draft({ userId: actual.userId }), actual.id);
    case 'link': return api.linkStandaloneActualToPlan(actual, B);
    case 'delete': return api.deleteActual(actual);
  }
}

// Direct Actual actions are covered here; compound Plan deletion, recurrence
// and Undo have a separate compound-admission matrix. No queue/alias semantics.
describe('shared Actual pending admission', () => {
  it('rejects same-render linked duplicate creation before a second repository dispatch', async () => {
    const fixture = await mount();
    const staleSave = state.saveActual;
    const staleQuery = state.getActualActionBlockReason;
    let first!: Promise<unknown>, duplicate!: Promise<unknown>;
    let reason: string | null = null;
    act(() => {
      first = capture(staleSave(A, draft({ note: 'Accepted first' })));
      reason = staleQuery(occurrence(A));
      duplicate = capture(staleSave(A, draft({ note: 'Must not overwrite first' })));
    });
    expect(reason).toBeTypeOf('string');
    await act(async () => {
      expect(await duplicate).toMatchObject({ message: reason });
      expect(await first).toBeUndefined();
    });
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(state.actuals).toHaveLength(1);
    expect(state.actuals[0].note).toBe('Accepted first');
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
    expect(state.getActualActionBlockReason(occurrence(A))).toBeNull();
  });

  it.each([false, true])('blocks a fresh-surface delete until linked save settles (acknowledgment hold=%s)', async afterPersist => {
    const fixture = await mount();
    const gate = holdSave({ afterPersist });
    const { done } = await start(() => state.saveActual(A, draft()), gate);
    const optimistic = { ...state.actuals[0] };
    const reason = state.getActualActionBlockReason(optimistic);
    expect(state.getActualActionBlockReason(occurrence(A))).toBe(reason);
    await expectBlocked(() => state.deleteActual(optimistic), reason);
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[0] === '記録を削除しました。')).toBe(false);
    expect(await finish(gate, done)).toBeUndefined();
    const reopened = state.actuals[0];
    expect(state.getActualActionBlockReason(reopened)).toBeNull();
    await act(async () => { await state.deleteActual(reopened); });
    expect(state.actuals).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
  });

  it.each(['standalone-save', 'link', 'delete'] as const)('%s blocks every competing action from fresh callbacks', async firstAction => {
    const fixture = await mount([STANDALONE]);
    const gate = firstAction === 'link' ? holdLink() : firstAction === 'delete' ? holdDelete() : holdSave();
    const { done } = await start(() => dispatch(firstAction, STANDALONE), gate);
    const reason = state.getActualActionBlockReason(STANDALONE);
    const calls = [fixture.save.mock.calls.length, fixture.link.mock.calls.length, fixture.remove.mock.calls.length];
    for (const action of actions) await expectBlocked(() => dispatch(action, STANDALONE), reason);
    expect([fixture.save.mock.calls.length, fixture.link.mock.calls.length, fixture.remove.mock.calls.length]).toEqual(calls);
    expect(await finish(gate, done)).toBeUndefined();
    if (firstAction !== 'delete') expect(state.getActualActionBlockReason(state.actuals[0])).toBeNull();
    else expect(state.actuals).toEqual([]);
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it('admits unrelated IDs, distinct linked occurrences and same-date standalone creation while one save is held', async () => {
    const fixture = await mount([STANDALONE]);
    const gate = holdSave();
    const { done } = await start(() => state.saveActual(A, draft()), gate);
    await act(async () => {
      await Promise.all([
        state.saveActual(A, draft({ occurrenceDate: NEXT_DATE })),
        state.saveActual(B, draft({ planId: B.id })),
        state.saveStandaloneActual(draft({ planId: null }), STANDALONE.id),
        state.saveStandaloneActual(draft({ planId: null, title: 'Independent new record' })),
      ]);
    });
    expect(fixture.save).toHaveBeenCalledTimes(5);
    expect(state.actuals).toHaveLength(5);
    expect(state.getActualActionBlockReason(occurrence(A))).not.toBeNull();
    expect(state.getActualActionBlockReason(occurrence(A, NEXT_DATE))).toBeNull();
    expect(state.getActualActionBlockReason(occurrence(B))).toBeNull();
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it.each(['different-plan', 'different-date', 'unlink'] as const)('retains source and actual destination claims for %s', async change => {
    const fixture = await mount([LINKED, STANDALONE]);
    const destinationPlan = change === 'different-plan' ? B : A;
    const destinationDate = change === 'different-plan' ? DATE : NEXT_DATE;
    const gate = holdSave();
    // The captured Plan argument stays A; draft.planId is the destination.
    const { done } = await start(() => state.saveActual(A, draft({
      planId: change === 'unlink' ? null : destinationPlan.id, occurrenceDate: destinationDate,
    }), LINKED.id), gate);
    const reason = state.getActualActionBlockReason(LINKED);
    expect(state.getActualActionBlockReason(occurrence(A))).toBe(reason);
    await expectBlocked(() => state.saveActual(A, draft()), reason);
    await expectBlocked(() => state.deleteActual(LINKED), reason);
    if (change === 'unlink') {
      expect(state.getActualActionBlockReason(occurrence(A, NEXT_DATE))).toBeNull();
      await act(async () => { await state.saveActual(A, draft({ occurrenceDate: NEXT_DATE })); });
    } else {
      expect(state.getActualActionBlockReason(occurrence(destinationPlan, destinationDate))).toBe(reason);
      await expectBlocked(() => state.saveActual(destinationPlan, draft({
        planId: destinationPlan.id, occurrenceDate: destinationDate,
      })), reason);
    }
    await act(async () => { await state.saveStandaloneActual(draft({ planId: null }), STANDALONE.id); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.getActualActionBlockReason(occurrence(A))).toBeNull();
    expect(state.getActualActionBlockReason(occurrence(destinationPlan, destinationDate))).toBeNull();
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it('reserves a link destination against another standalone link and a linked create', async () => {
    const other = makeActual({ id: 'other', planId: null });
    const fixture = await mount([STANDALONE, other]);
    const gate = holdLink();
    const { done } = await start(() => state.linkStandaloneActualToPlan(STANDALONE, B), gate);
    const reason = state.getActualActionBlockReason(occurrence(B));
    await expectBlocked(() => state.linkStandaloneActualToPlan(other, B), reason);
    await expectBlocked(() => state.saveActual(B, draft({ planId: B.id })), reason);
    expect(fixture.link).toHaveBeenCalledTimes(1);
    expect(fixture.save).not.toHaveBeenCalled();
    await act(async () => { await state.saveStandaloneActual(draft({ planId: null }), other.id); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.getActualActionBlockReason(occurrence(B))).toBeNull();
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it.each([false, true])('retains a deleted linked occurrence until success/rollback commits (failure=%s)', async failDelete => {
    const fixture = await mount([LINKED, STANDALONE]);
    const gate = holdDelete();
    const { done } = await start(() => state.deleteActual(LINKED), gate);
    expect(state.actuals.some(actual => actual.id === LINKED.id)).toBe(false);
    const reason = state.getActualActionBlockReason(occurrence(A));
    await expectBlocked(() => state.saveActual(A, draft()), reason);
    await expectBlocked(() => state.linkStandaloneActualToPlan(STANDALONE, A), reason);
    const failure = new Error('Delete rejected');
    expect(await finish(gate, done, failDelete ? failure : undefined)).toBe(failDelete ? failure : undefined);
    expect(state.getActualActionBlockReason(occurrence(A))).toBeNull();
    if (failDelete) expect(state.getActualActionBlockReason(LINKED)).toBeNull();
    await act(async () => { await state.saveActual(A, draft({ note: 'After settled delete' })); });
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it.each(['linked-create', 'standalone-create', 'linked-edit', 'standalone-edit'] as const)('releases failed %s after rollback and allows retry', async operation => {
    const existing = operation === 'linked-edit' ? LINKED : operation === 'standalone-edit' ? STANDALONE : undefined;
    const fixture = await mount(existing ? [existing] : []);
    const isLinked = operation.startsWith('linked');
    const input = draft({ planId: isLinked ? A.id : null });
    const save = () => isLinked ? state.saveActual(A, input, existing?.id) : state.saveStandaloneActual(input, existing?.id);
    const gate = holdSave();
    const failure = new Error('Injected save failure');
    const { done } = await start(save, gate);
    const pending = state.actuals[0];
    expect(state.getActualActionBlockReason(pending)).not.toBeNull();
    expect(await finish(gate, done, failure)).toBe(failure);
    expect(state.actuals).toEqual(existing ? [existing] : []);
    expect(state.getActualActionBlockReason(existing ?? (isLinked ? occurrence(A) : {
      userId: 'owner', planId: null, occurrenceDate: DATE,
    }))).toBeNull();
    await act(async () => { await save(); });
    expect(state.getActualActionBlockReason(state.actuals[0])).toBeNull();
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it('keeps a failed creator busy through physical compensation, then rolls back progress before admitting retry', async () => {
    const material: StudyMaterial = { id: 'book', userId: 'owner', name: 'Book', subjectId: 'math', subjectName: 'Math',
      paceEnabled: true, currentUnit: 20, totalUnits: 100, progressUnit: 'page', createdAt: STAMP, updatedAt: STAMP };
    const fixture = await mount([], [material]);
    const entered = deferred(), release = deferred();
    const failure = new Error('Injected material write failure');
    const writeActuals = fixture.gateway.writeActuals;
    let actualWrites = 0;
    vi.spyOn(fixture.gateway, 'writeActuals').mockImplementation(async rows => {
      if (++actualWrites === 2) { entered.resolve(); await release.promise; }
      await writeActuals(rows);
    });
    const writeMaterials = fixture.gateway.writeStudyMaterials;
    vi.spyOn(fixture.gateway, 'writeStudyMaterials').mockRejectedValueOnce(failure).mockImplementation(writeMaterials);
    const input = draft({ materialProgressUpdates: [{ materialId: material.id, deltaUnits: 5 }] });
    const { done } = await start(() => state.saveActual(A, input), { entered });
    expect((await fixture.gateway.readActuals())).toHaveLength(1);
    const reason = state.getActualActionBlockReason(occurrence(A));
    await expectBlocked(() => state.saveActual(A, input), reason);
    expect(await finish({ release }, done)).toBe(failure);
    expect(state.actuals).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
    expect((await fixture.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(20);
    expect(state.getActualActionBlockReason(occurrence(A))).toBeNull();
    await act(async () => { await state.saveActual(A, input); });
    expect((await fixture.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(25);
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it.each([false, true])('an unmounted callback cannot clear the remounted owner claim (old failure=%s)', async failOld => {
    const fixture = await mount([LINKED]);
    const oldGate = holdSave();
    const oldApi = state;
    const old = await start(() => state.saveActual(A, draft(), LINKED.id), oldGate);
    act(() => renderer!.unmount());
    renderer = undefined;
    boundary.repository = { ...fixture.repository };
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.getActualActionBlockReason(LINKED)).toBeNull();
    const newGate = holdSave();
    const current = await start(() => state.saveActual(A, draft({ note: 'Remounted input' }), LINKED.id), newGate);
    const reason = state.getActualActionBlockReason(LINKED);
    showNotice.mockClear();
    const result = await finish(oldGate, old.done, failOld ? new Error('Old instance failure') : undefined);
    expect(result).toBeInstanceOf(Error);
    expect(showNotice).not.toHaveBeenCalled();
    expect(state.actuals[0].note).toBe('Remounted input');
    expect(state.getActualActionBlockReason(LINKED)).toBe(reason);
    expect(state.getActualActionBlockReason(occurrence(A))).toBe(reason);
    await act(async () => { expect(await capture(oldApi.deleteActual(LINKED))).toBeInstanceOf(Error); });
    await expectBlocked(() => state.deleteActual(LINKED), reason);
    expect(await finish(newGate, current.done)).toBeUndefined();
    expect(state.getActualActionBlockReason(LINKED)).toBeNull();
    expect(state.actuals).toEqual(await fixture.repository.getActuals('owner'));
  });

  it.each([
    { switchOwner: false, failOld: false }, { switchOwner: false, failOld: true },
    { switchOwner: true, failOld: false }, { switchOwner: true, failOld: true },
  ])('isolates new generation claims from old settlement: $switchOwner owner switch, $failOld failure', async ({ switchOwner, failOld }) => {
    const fixture = await mount([STANDALONE]);
    const oldGate = holdSave();
    const oldApi = state;
    const old = await start(() => state.saveStandaloneActual(draft({ planId: null }), STANDALONE.id), oldGate);
    const owner = switchOwner ? 'next-owner' : 'owner';
    const currentActual = { ...STANDALONE, userId: owner };
    const currentFixture = switchOwner ? createLocalFixture() : fixture;
    if (switchOwner) {
      await currentFixture.repository.upsertActual(currentActual);
      boundary.repository = { ...currentFixture.repository };
      await act(async () => { renderer!.update(<Harness owner={owner} />); });
    } else await act(async () => { state.resetPlannerData(); });
    await act(async () => { await state.loadPlannerData(owner); });
    expect(state.getActualActionBlockReason(currentActual)).toBeNull();
    const newGate = holdSave();
    const current = await start(() => state.saveStandaloneActual(draft({ userId: owner, planId: null,
      note: 'Current generation input' }), currentActual.id), newGate);
    const reason = state.getActualActionBlockReason(currentActual);
    expect(reason).not.toBeNull();
    const oldResult = await finish(oldGate, old.done, failOld ? new Error('Old owner failure') : undefined);
    expect(oldResult).toBeInstanceOf(Error);
    expect(state.getActualActionBlockReason(currentActual)).toBe(reason);
    expect(state.actuals[0].note).toBe('Current generation input');
    await expectBlocked(() => state.deleteActual(currentActual), reason);
    await act(async () => { expect(await capture(oldApi.deleteActual(STANDALONE))).toBeInstanceOf(Error); });
    expect(await finish(newGate, current.done)).toBeUndefined();
    expect(state.getActualActionBlockReason(currentActual)).toBeNull();
    expect(state.actuals).toEqual(await currentFixture.repository.getActuals(owner));
  });
});

describe('stale explicit Actual targets', () => {
  it.each(actions)('rejects retained %s after provisional identity is replaced, without retargeting or creating', async action => {
    const fixture = await mount();
    const gate = holdSave();
    const { done } = await start(() => state.saveActual(A, draft()), gate);
    const captured = { ...state.actuals[0] };
    const retainedApi = state;
    const beforeDraft = draft({ planId: null });
    const preservedDraft = structuredClone(beforeDraft);
    // Modeled other-client premise: a canonical record appears after the loaded
    // snapshot. The normal adapter chooses it when the pending create executes.
    const canonical = makeActual({ id: 'canonical', planId: A.id });
    await fixture.repository.upsertActual(canonical);
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.actuals.map(actual => actual.id)).toEqual([canonical.id]);
    expect(state.getActualActionBlockReason(state.actuals[0])).toBeNull();
    const reason = state.getActualActionBlockReason(captured);
    expect(reason).toMatch(/開き直|開きなお|reopen/i);
    const counts = [fixture.save.mock.calls.length, fixture.link.mock.calls.length, fixture.remove.mock.calls.length];
    await expectBlocked(() => action === 'standalone-save'
      ? retainedApi.saveStandaloneActual(beforeDraft, captured.id)
      : dispatch(action, captured, retainedApi), reason);
    expect(beforeDraft).toEqual(preservedDraft);
    expect([fixture.save.mock.calls.length, fixture.link.mock.calls.length, fixture.remove.mock.calls.length]).toEqual(counts);
    expect(state.actuals.map(actual => actual.id)).toEqual([canonical.id]);
    await act(async () => { await state.deleteActual(state.actuals[0]); });
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
  });

  it.each(actions)('rejects %s through a retained callback after an authoritative refresh removed its target', async action => {
    const fixture = await mount([STANDALONE]);
    const retainedApi = state;
    await fixture.repository.deleteActual('owner', STANDALONE.id);
    await act(async () => { await state.loadPlannerData('owner'); });
    const reason = state.getActualActionBlockReason(STANDALONE);
    expect(reason).toMatch(/開き直|開きなお|reopen/i);
    await expectBlocked(() => dispatch(action, STANDALONE, retainedApi), reason);
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.link).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(state.actuals).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
  });
});
