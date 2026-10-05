import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { actual, plan, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { createMonthEventRecoveryRepository } from './monthEventRecovery.testUtils';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const source = actual();
const notice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: notice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; notice.mockClear(); });

const cases = [false, true].flatMap(firstFails => [false, true].flatMap(secondFails =>
  [false, true].flatMap(firstReturnsLast => [false, true].map(useRetainedLoader => ({ firstFails, secondFails, firstReturnsLast, useRetainedLoader })))));

// Controlled read-response gates exercise full-read token replacement, not the
// public local storage timing. Each admitted write uses the real repository.
it.each(cases)('preserves compound claim liveness across superseding full reads: A fails=$firstFails, B fails=$secondFails, A returns last=$firstReturnsLast, retained loader=$useRetainedLoader', async ({ firstFails, secondFails, firstReturnsLast, useRetainedLoader }) => {
  const fixture = createMonthEventRecoveryRepository('legacy', [source]);
  boundary.repository = { ...fixture.repository };
  await boundary.repository.upsertPlan(plan());
  await act(async () => { renderer = create(<Harness />); });
  const retainedLoad = state.loadPlannerData;
  await act(async () => { await retainedLoad('owner'); });
  expect(state.loadPlannerData).toBe(retainedLoad);
  const remove = boundary.repository.deletePlanWithDependents;
  const writer = deferred();
  boundary.repository.deletePlanWithDependents = async mutation => { await writer.promise; return remove(mutation); };
  let deleting!: Promise<void>;
  await act(async () => { deleting = state.deletePlan(plan()); });

  const originalRead = boundary.repository.getActuals;
  const first = { entered: deferred(), response: deferred() };
  const second = { entered: deferred(), response: deferred() };
  const repair = { entered: deferred(), response: deferred() };
  let reads = 0;
  boundary.repository.getActuals = async owner => {
    const rows = await originalRead(owner);
    const call = ++reads;
    const gate = call === 1 ? first : call === 2 ? second : call === 3 ? repair : null;
    if (gate) { gate.entered.resolve(); await gate.response.promise; }
    if (call === 1 && firstFails) throw Error('superseded A failure');
    if (call === 2 && secondFails) throw Error('current B failure');
    if (call === 3 && secondFails) throw Error('current repair failure');
    return rows;
  };
  let fullA!: Promise<unknown>;
  await act(async () => { fullA = state.loadPlannerData('owner').catch(error => error); await first.entered.promise; });
  await act(async () => { writer.resolve(); await deleting; });
  const undo = [...notice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  expect(undo).toBeTypeOf('function');
  const target = { userId: 'owner', planId: source.planId, occurrenceDate: source.occurrenceDate };
  expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);

  let fullB!: Promise<unknown>;
  await act(async () => { fullB = (useRetainedLoader ? retainedLoad : state.loadPlannerData)('owner').catch(error => error); await second.entered.promise; });
  // This unrelated write makes B globally nonquiescent. It must not cause the
  // authority to forget Plans/Todos while admission still requires that group.
  await act(async () => { await state.saveDayNote({ userId: 'owner', date: source.occurrenceDate,
    quickMemo: 'unrelated note', reflection: '', nextFocus: '', checkedPlan: false, checkedRecord: false, checkedReady: false }); });
  if (!firstReturnsLast) {
    await act(async () => { first.response.resolve(); expect(await fullA).toBeUndefined(); });
    expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);
  }
  await act(async () => {
    second.response.resolve();
    const result = await fullB;
    if (secondFails) expect(result).toBeInstanceOf(Error); else expect(result).toBeUndefined();
    await repair.entered.promise;
  });
  expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);
  // Full-read failure remains visible even while its detached repair is reading.
  expect(state.plannerDataRecovery?.phase).toBe(secondFails ? 'failed' : 'refreshing');
  await act(async () => { repair.response.resolve(); });
  if (secondFails) {
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);
  } else {
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.getActualActionBlockReason(target)).toBeNull();
  }
  if (firstReturnsLast) {
    const before = state.actuals;
    await act(async () => { first.response.resolve(); expect(await fullA).toBeUndefined(); });
    expect(state.actuals).toBe(before);
    if (secondFails) expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);
    else expect(state.getActualActionBlockReason(target)).toBeNull();
  }
  if (secondFails) await act(async () => { await state.retryPlannerData(); });
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(state.getActualActionBlockReason(target)).toBeNull();
  expect(state.plans).toEqual([]);
  expect(state.actuals).toEqual([]);
  await act(async () => { await undo!(); });
  expect((await fixture.repository.getPlans('owner')).map(p => p.id)).toEqual([plan().id]);
  expect((await fixture.storage.actuals.read()).map(a => a.id)).toEqual([source.id]);
});
