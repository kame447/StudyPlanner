import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actual as makeActual, createLocalFixture, DATE, deferred, microtasks, plan as makePlan,
} from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ActualDraft, Plan } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const P = makePlan();
const INDEPENDENT = makeActual({ id: 'independent', planId: null });
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const capture = (operation: Promise<unknown>) => operation.then(() => undefined, (error: unknown) => error);
const normalize = <T extends { id: string }>(rows: T[]) => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
function draft(plan: Plan, overrides: Partial<ActualDraft> = {}): ActualDraft {
  return { userId: 'owner', planId: plan.id, occurrenceDate: DATE, title: 'Saved input', subject: 'Math',
    actualStartTime: '10:00', actualEndTime: '11:00', isAlignedToPlan: false, note: 'New input',
    materialProgressUpdates: [], ...overrides };
}
const operations = ['save', 'standalone-save', 'link', 'delete', 'plan-delete', 'undo', 'recurrence'] as const;
type Operation = typeof operations[number];
type Outcome = 'success' | 'reject-before-write' | 'reject-after-write';
type Timing = 'read-before-settlement' | 'read-after-settlement';
const compound = (operation: Operation) => ['plan-delete', 'undo', 'recurrence'].includes(operation);
const methodFor = (operation: Operation): keyof PlannerRepository => {
  switch (operation) {
    case 'save': case 'standalone-save': return 'upsertActualWithMaterialProgress';
    case 'link': return 'upsertActual';
    case 'delete': return 'deleteActual';
    case 'plan-delete': return 'deletePlanWithDependents';
    case 'undo': return 'restorePlanWithDependents';
    case 'recurrence': return 'applyRecurringPlanMutation';
  }
};
async function mount(operation: Operation) {
  const fixture = createLocalFixture();
  const plan = operation === 'recurrence' ? { ...P, repeat: 'daily' as const, repeatUntil: '2026-10-31' } : P;
  const source = makeActual({ planId: operation === 'link' || operation === 'standalone-save' ? null : plan.id });
  await fixture.repository.upsertPlan(plan);
  await fixture.repository.upsertActual(source);
  await fixture.repository.upsertActual(INDEPENDENT);
  boundary.repository = { ...fixture.repository };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  let undo = async () => undefined as void;
  if (operation === 'undo') {
    await act(async () => { await state.deletePlan(plan); });
    const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
    expect(action).toBeTypeOf('function');
    undo = async () => { await action!(); };
  }
  if (operation === 'recurrence') await act(async () => { await state.deletePlan(plan); });
  const run = () => {
    switch (operation) {
      case 'save': return state.saveActual(plan, draft(plan), source.id);
      case 'standalone-save': return state.saveStandaloneActual(draft(plan, { planId: null }), source.id);
      case 'link': return state.linkStandaloneActualToPlan(source, plan);
      case 'delete': return state.deleteActual(source);
      case 'plan-delete': return state.deletePlan(plan);
      case 'undo': return undo();
      case 'recurrence': return state.confirmRecurringPlanScope('all');
    }
  };
  return { ...fixture, plan, source, run };
}

/** Holds a full read's captured snapshot outside the local repository queue.
 * Later repair reads fail persistently until explicitly retried. A second gate
 * holds successful retry publication, so admission cannot pass merely because
 * a retry was clicked or only the other dependency group returned. */
function holdFullRead(failedGetter: 'getActuals' | 'getPlans') {
  const initialEntered = deferred(), initialRelease = deferred();
  const retryEntered = deferred(), retryRelease = deferred();
  const actualRead = boundary.repository.getActuals;
  const planRead = boundary.repository.getPlans;
  let firstActual = true, firstPlans = true, holdRetry = true;
  let mode: 'fail' | 'hold-retry' | 'open' = 'fail';
  const actualReads = vi.fn(async (owner: string) => {
    if (firstActual) {
      firstActual = false;
      const snapshot = await actualRead(owner);
      initialEntered.resolve();
      await initialRelease.promise;
      return snapshot;
    }
    if (mode === 'fail' && failedGetter === 'getActuals') throw new Error('Repair Actual read unavailable');
    const snapshot = await actualRead(owner);
    if (mode === 'hold-retry' && holdRetry) {
      holdRetry = false;
      retryEntered.resolve();
      await retryRelease.promise;
    }
    return snapshot;
  });
  const planReads = vi.fn(async (owner: string) => {
    if (firstPlans) { firstPlans = false; return planRead(owner); }
    if (mode === 'fail' && failedGetter === 'getPlans') throw new Error('Repair Plan read unavailable');
    return planRead(owner);
  });
  boundary.repository.getActuals = actualReads;
  boundary.repository.getPlans = planReads;
  return { initialEntered, initialRelease, retryEntered, retryRelease, actualReads, planReads,
    beginRetry: () => { mode = 'hold-retry'; }, open: () => { mode = 'open'; } };
}

/** Rejection after persistence models an unknown response outcome, not an
 * assertion that the native local adapter normally rejects committed writes. */
function holdWriter(operation: Operation, outcome: Outcome) {
  const method = methodFor(operation);
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  const entered = deferred(), release = deferred();
  const failure = new Error(`${operation} ${outcome}`);
  let first = true;
  const dispatch = vi.fn(async (...args: unknown[]) => {
    if (!first) return original(...args);
    first = false;
    entered.resolve();
    await release.promise;
    if (outcome === 'reject-before-write') throw failure;
    const result = await original(...args);
    if (outcome === 'reject-after-write') throw failure;
    return result;
  });
  boundary.repository = { ...boundary.repository, [method]: dispatch };
  return { entered, release, failure, dispatch };
}
async function rejected(operation: () => Promise<unknown>) {
  let error: unknown;
  await act(async () => { error = await capture(operation()); });
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}
const cases = operations.flatMap(operation => (['read-before-settlement', 'read-after-settlement'] as Timing[])
  .flatMap(timing => (['success', 'reject-before-write', 'reject-after-write'] as Outcome[])
    .map(outcome => ({ operation, timing, outcome }))));

// Existing recovery tests start a write before refreshing. Here the full read
// starts FIRST, captures old data, and remains alive across writer admission.
// On recurring failure, its corrective full read can supersede the original;
// that distinct failure path must retain the same affected claims as well.
describe('Actual admission across the entire full-read lifetime', () => {
  it.each(cases)('$operation: $timing, $outcome', async ({ operation, timing, outcome }) => {
    const fixture = await mount(operation);
    const read = holdFullRead(compound(operation) ? 'getPlans' : 'getActuals');
    let loading!: Promise<unknown>;
    await act(async () => {
      loading = capture(state.loadPlannerData('owner'));
      await read.initialEntered.promise;
      await microtasks();
    });
    expect(state.plannerDataAvailability.status).toBe('loading');
    const writer = holdWriter(operation, outcome);
    let done!: Promise<unknown>;
    await act(async () => { done = capture(fixture.run()); await writer.entered.promise; });
    const occurrence = { userId: 'owner', planId: fixture.plan.id, occurrenceDate: DATE };
    if (timing === 'read-before-settlement') {
      await act(async () => { read.initialRelease.resolve(); await loading; });
    }
    let result: unknown;
    await act(async () => { writer.release.resolve(); result = await done; await microtasks(); });
    // Undo and recurring confirmation deliberately report failures via notices.
    if (operation !== 'undo' && operation !== 'recurrence') {
      expect(result).toBe(outcome === 'success' ? undefined : writer.failure);
    }
    expect(writer.dispatch).toHaveBeenCalledTimes(1);
    if (timing === 'read-after-settlement') {
      expect(state.getActualActionBlockReason(fixture.source)).not.toBeNull();
      if (operation !== 'standalone-save') expect(state.getActualActionBlockReason(occurrence)).not.toBeNull();
      await act(async () => { read.initialRelease.resolve(); await loading; await microtasks(); });
    }
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    const sourceReason = state.getActualActionBlockReason(fixture.source);
    expect(sourceReason).toMatch(/再読み込み/);
    if (operation !== 'standalone-save') {
      expect(state.getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
      // A retained empty editor supplies no Actual ID; the occurrence or Plan
      // dependency must still stop it from creating a replacement/orphan.
      expect((await rejected(() => state.saveActual(fixture.plan, draft(fixture.plan)))).message).toMatch(/再読み込み/);
    }
    await rejected(() => state.deleteActual(fixture.source));
    await rejected(() => operation === 'standalone-save'
      ? state.saveStandaloneActual(draft(fixture.plan, { planId: null }), fixture.source.id)
      : state.saveActual(fixture.plan, draft(fixture.plan), fixture.source.id));
    expect(writer.dispatch).toHaveBeenCalledTimes(1);

    expect(state.getActualActionBlockReason(INDEPENDENT)).toBeNull();
    await act(async () => {
      await state.saveStandaloneActual(draft(fixture.plan, { planId: null, note: 'Unrelated accepted input' }), INDEPENDENT.id);
    });
    expect(state.actuals.find(actual => actual.id === INDEPENDENT.id)?.note).toBe('Unrelated accepted input');
    expect(state.getActualActionBlockReason(fixture.source)).toBe(sourceReason);
    // For save operations this is one additional independent dispatch only.
    expect(writer.dispatch).toHaveBeenCalledTimes(operation === 'save' || operation === 'standalone-save' ? 2 : 1);

    read.beginRetry();
    let retrying!: Promise<void>;
    await act(async () => { retrying = state.retryPlannerData(); await read.retryEntered.promise; });
    expect(state.getActualActionBlockReason(fixture.source)).toBe(sourceReason);
    if (operation !== 'standalone-save') expect(state.getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
    expect(state.getActualActionBlockReason(INDEPENDENT)).toBeNull();
    await act(async () => { read.retryRelease.resolve(); await retrying; await microtasks(); });
    read.open();
    expect(state.plannerDataRecovery).toBeNull();
    expect(normalize(state.actuals)).toEqual(normalize(await fixture.repository.getActuals('owner')));
    expect(normalize(state.plans)).toEqual(normalize(await fixture.repository.getPlans('owner')));
    expect(state.getActualActionBlockReason(occurrence)).toBeNull();
    const current = state.actuals.find(actual => actual.id === fixture.source.id);
    if (current) {
      expect(state.getActualActionBlockReason(current)).toBeNull();
      await act(async () => { await state.deleteActual(current); });
    } else {
      expect(state.getActualActionBlockReason(fixture.source)).toMatch(/開き直|開きなお/);
      expect((await rejected(() => state.deleteActual(fixture.source))).message).toMatch(/開き直|開きなお/);
      expect((await rejected(() => state.saveActual(fixture.plan, draft(fixture.plan), fixture.source.id))).message).toMatch(/開き直|開きなお/);
    }
    expect((await fixture.repository.getActuals('owner')).some(actual => actual.id === fixture.source.id)).toBe(false);
  });

  it('keeps a retired explicit ID and its occurrence closed when a pre-save full read returns after canonical replacement', async () => {
    const fixture = await mount('save');
    const read = holdFullRead('getActuals');
    let loading!: Promise<unknown>;
    await act(async () => { loading = capture(state.loadPlannerData('owner')); await read.initialEntered.promise; });
    const canonical = { ...fixture.source, id: 'canonical', note: 'Canonical acknowledged value' };
    // Explicit modeled remote canonicalization outcome, matching the reviewer
    // reproduction. No assertion of a native-local remap for an existing ID.
    boundary.repository.upsertActualWithMaterialProgress = vi.fn(async () => {
      await fixture.gateway.writeActuals([canonical, INDEPENDENT]);
      return canonical;
    });
    await act(async () => { await state.saveActual(P, draft(P), fixture.source.id); });
    expect(state.actuals.map(actual => actual.id)).toContain(canonical.id);
    expect(state.getActualActionBlockReason(canonical)).toMatch(/再読み込み/);
    await act(async () => { read.initialRelease.resolve(); await loading; await microtasks(); });
    expect(state.actuals.map(actual => actual.id)).toContain(fixture.source.id);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    const occurrence = { userId: 'owner', planId: P.id, occurrenceDate: DATE };
    expect(state.getActualActionBlockReason(fixture.source)).toMatch(/再読み込み/);
    expect(state.getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
    await rejected(() => state.deleteActual(fixture.source));
    await rejected(() => state.saveActual(P, draft(P)));
    expect((await fixture.repository.getActuals('owner')).map(actual => actual.id)).toContain(canonical.id);
    read.beginRetry();
    let retrying!: Promise<void>;
    await act(async () => { retrying = state.retryPlannerData(); await read.retryEntered.promise; });
    expect(state.getActualActionBlockReason(fixture.source)).toMatch(/再読み込み/);
    await act(async () => { read.retryRelease.resolve(); await retrying; await microtasks(); });
    expect(state.getActualActionBlockReason(fixture.source)).toMatch(/開き直|開きなお/);
    expect(state.getActualActionBlockReason(canonical)).toBeNull();
    await rejected(() => state.saveActual(P, draft(P), fixture.source.id));
    await act(async () => { await state.deleteActual(canonical); });
    expect((await fixture.repository.getActuals('owner')).map(actual => actual.id)).toEqual([INDEPENDENT.id]);
  });
});
