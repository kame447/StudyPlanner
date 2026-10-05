import { StrictMode, Suspense, startTransition, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actual, createLocalFixture, DATE, deferred, microtasks, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { Plan } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const showNotice = vi.fn<ShowNotice>();
const P = (owner: string) => plan({ id: `plan-${owner}`, seriesId: `plan-${owner}`, userId: owner });
const SOURCE = (owner: string) => actual({ id: `actual-${owner}`, userId: owner, planId: P(owner).id });
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ owner }: { owner: string | null }) { state = usePlannerDataState({ userId: owner, showNotice }); return null; }
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function setupRepository() {
  const fixture = createLocalFixture();
  for (const owner of ['owner-a', 'owner-b']) {
    await fixture.repository.upsertPlan(P(owner));
    await fixture.repository.upsertActual(SOURCE(owner));
  }
  boundary.repository = { ...fixture.repository };
  showNotice.mockClear();
  return fixture;
}

// The facade gates deliberately model response schedules. Underlying admitted
// persistence uses the public local factory; no native timing claim is made.
async function failedPlanClaim(getState: () => UsePlannerDataStateResult, target: Plan) {
  const entered = deferred(), release = deferred();
  const remove = boundary.repository.deletePlanWithDependents;
  boundary.repository.deletePlanWithDependents = async mutation => {
    entered.resolve(); await release.promise; return remove(mutation);
  };
  let deleting!: Promise<void>;
  await act(async () => { deleting = getState().deletePlan(target); await entered.promise; });
  await act(async () => { await getState().loadPlannerData(target.userId); });
  const readActuals = boundary.repository.getActuals;
  boundary.repository.getActuals = vi.fn(readActuals).mockRejectedValueOnce(new Error('Repair offline'));
  await act(async () => { release.resolve(); await deleting; });
  expect(getState().plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  const occurrence = { userId: target.userId, planId: target.id, occurrenceDate: DATE };
  expect(getState().getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
  const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  expect(action).toBeTypeOf('function');
  boundary.repository.getActuals = readActuals;
  return { occurrence, undo: async () => { await action!(); } };
}
function holdNextFullActualRead() {
  const entered = deferred(), release = deferred();
  const original = boundary.repository.getActuals;
  let first = true;
  const reads = vi.fn(async (owner: string) => {
    const snapshot = await original(owner);
    if (first) { first = false; entered.resolve(); await release.promise; }
    return snapshot;
  });
  boundary.repository.getActuals = reads;
  return { entered, release, reads };
}
async function saveUnrelatedDayNote(getState: () => UsePlannerDataStateResult, owner: string) {
  await act(async () => {
    await getState().saveDayNote({ userId: owner, date: DATE, quickMemo: 'Unrelated note', reflection: '', nextFocus: '',
      checkedPlan: false, checkedRecord: false, checkedReady: false });
  });
}

describe('retained planner loader identity and current admission ownership', () => {
  it('keeps the same loader through null-owner initialization, explicit resets, owner changes and routine rerenders', async () => {
    await setupRepository();
    await act(async () => { renderer = create(<Harness owner={null} />); });
    const retained = state.loadPlannerData;
    await act(async () => { renderer!.update(<Harness owner="owner-a" />); await retained('owner-a'); });
    expect(state.loadPlannerData).toBe(retained);
    expect(state.actuals).toEqual([SOURCE('owner-a')]);
    await act(async () => { state.setViewMode('day'); state.openDay('2026-10-06'); });
    expect(state.loadPlannerData).toBe(retained);
    await act(async () => { state.resetPlannerData(); });
    expect(state.loadPlannerData).toBe(retained);
    expect(state.actuals).toEqual([]);
    await act(async () => { await retained('owner-a'); });
    expect(state.loadPlannerData).toBe(retained);
    await act(async () => { renderer!.update(<Harness owner="owner-b" />); await retained('owner-b'); });
    expect(state.loadPlannerData).toBe(retained);
    expect(state.actuals).toEqual([SOURCE('owner-b')]);
    await act(async () => { state.resetPlannerData(); renderer!.update(<Harness owner={null} />); });
    expect(state.loadPlannerData).toBe(retained);
    expect(state.actuals).toEqual([]);
  });

  it.each(['initial-scope', 'explicit-reset', 'owner-switch'] as const)('retained pre-load callback discharges current Plan claims after %s', async transition => {
    const fixture = await setupRepository();
    let owner = 'owner-a';
    await act(async () => { renderer = create(<Harness owner={owner} />); });
    const retained = state.loadPlannerData;
    await act(async () => { await retained(owner); });
    expect(state.loadPlannerData).toBe(retained);
    if (transition === 'explicit-reset') await act(async () => { state.resetPlannerData(); });
    if (transition === 'owner-switch') {
      owner = 'owner-b';
      await act(async () => { renderer!.update(<Harness owner={owner} />); });
    }
    if (transition !== 'initial-scope') await act(async () => { await retained(owner); });
    expect(state.loadPlannerData).toBe(retained);
    const claim = await failedPlanClaim(() => state, P(owner));
    const read = holdNextFullActualRead();
    let loading!: Promise<void>;
    await act(async () => { loading = retained(owner); await read.entered.promise; });
    // Activity after capture prevents a quiescent full-read shortcut. Current
    // admission's required Plan+Actual groups must be carried into repair.
    await saveUnrelatedDayNote(() => state, owner);
    expect(state.getActualActionBlockReason(claim.occurrence)).toMatch(/再読み込み/);
    await act(async () => { read.release.resolve(); await loading; await microtasks(); });
    expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: owner });
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.plans).toEqual([]);
    expect(state.actuals).toEqual([]);
    expect(state.getActualActionBlockReason(claim.occurrence)).toBeNull();
    expect(state.loadPlannerData).toBe(retained);
    expect(read.reads.mock.calls.every(([readOwner]) => readOwner === owner)).toBe(true);
    await act(async () => { await claim.undo(); });
    expect(state.getActualActionBlockReason(SOURCE(owner))).toBeNull();
    expect((await fixture.repository.getPlans(owner)).map(plan => plan.id)).toEqual([P(owner).id]);
    expect((await fixture.repository.getActuals(owner)).map(actual => actual.id)).toEqual([SOURCE(owner).id]);
    expect((await fixture.repository.getDayNotes(owner))[0].quickMemo).toBe('Unrelated note');
  });

  it('an abandoned concurrent owner render cannot redirect retained-loader discharge away from the committed owner', async () => {
    const fixture = await setupRepository();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let owner = 'owner-a';
    let suspendedOwner: string | null = null;
    let committed!: UsePlannerDataStateResult;
    const rendered: Array<{ owner: string; loader: UsePlannerDataStateResult['loadPlannerData'] }> = [];
    const never = new Promise<void>(() => undefined);
    function ConcurrentHarness() {
      const value = usePlannerDataState({ userId: owner, showNotice });
      useLayoutEffect(() => { committed = value; });
      rendered.push({ owner, loader: value.loadPlannerData });
      if (owner === suspendedOwner) throw never;
      return <span>{owner}</span>;
    }
    const tree = () => <StrictMode><Suspense fallback={<span>Loading</span>}><ConcurrentHarness /></Suspense></StrictMode>;
    await act(async () => {
      renderer = create(tree(), { createNodeMock: () => null, unstable_isConcurrent: true } as Parameters<typeof create>[1]);
    });
    const retained = committed.loadPlannerData;
    await act(async () => { await retained('owner-a'); });
    const claim = await failedPlanClaim(() => committed, P('owner-a'));
    const read = holdNextFullActualRead();
    let loading!: Promise<void>;
    await act(async () => { loading = retained('owner-a'); await read.entered.promise; });
    await saveUnrelatedDayNote(() => committed, 'owner-a');
    suspendedOwner = 'owner-b';
    await act(async () => { startTransition(() => { owner = 'owner-b'; renderer!.update(tree()); }); });
    expect(rendered.some(render => render.owner === 'owner-b')).toBe(true);
    expect(rendered.every(render => render.loader === retained)).toBe(true);
    expect(renderer!.toJSON()).toMatchObject({ children: ['owner-a'] });
    await act(async () => { read.release.resolve(); await loading; await microtasks(); });
    // Abandon the suspended candidate so React can commit the completed read.
    // Acceptance already ran while that owner was uncommitted.
    owner = 'owner-a'; suspendedOwner = null;
    await act(async () => { renderer!.update(tree()); await microtasks(); });
    expect(committed.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: 'owner-a' });
    expect(committed.plannerDataRecovery).toBeNull();
    expect(committed.getActualActionBlockReason(claim.occurrence)).toBeNull();
    expect(read.reads.mock.calls.every(([readOwner]) => readOwner === 'owner-a')).toBe(true);
    await act(async () => { await claim.undo(); });
    expect(committed.loadPlannerData).toBe(retained);
    expect(committed.getActualActionBlockReason(SOURCE('owner-a'))).toBeNull();
    expect(committed.actuals).toEqual(await fixture.repository.getActuals('owner-a'));
    expect((await fixture.repository.getActuals('owner-b'))).toEqual([SOURCE('owner-b')]);
  });
});
