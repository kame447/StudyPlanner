import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { actual, plan, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { createMonthEventRecoveryRepository } from './monthEventRecovery.testUtils';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ActualDraft } from '../types/domain';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const source = actual();
const independent = actual({ id: 'independent', planId: null });
const draft: ActualDraft = { ...source, title: source.title ?? '', isAlignedToPlan: true, note: 'saved', materialProgressUpdates: [] };
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: vi.fn() }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
async function mount() {
  const fixture = createMonthEventRecoveryRepository('legacy', [source, independent]);
  boundary.repository = { ...fixture.repository };
  await boundary.repository.upsertPlan(plan());
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}

// These are deliberately controlled application-facade schedules for projection
// admission, not claims about callback order in the native local storage adapter.
it.each(['actual', 'material'] as const)('retains only affected admission after failed %s repair, settles the writer, and unlocks after retry', async failedRead => {
  const fixture = await mount();
  const dispatch = deferred();
  const original = boundary.repository.upsertActualWithMaterialProgress;
  boundary.repository.upsertActualWithMaterialProgress = async mutation => {
    await dispatch.promise;
    return original(mutation);
  };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveActual(plan(), draft, source.id); });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.actuals.find(a => a.id === source.id)?.note).toBe(source.note);
  const actualRead = vi.spyOn(boundary.repository, 'getActuals');
  const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
  (failedRead === 'actual' ? actualRead : materialRead).mockRejectedValueOnce(Error('repair offline'));
  await act(async () => { dispatch.resolve(); await saving; });
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(state.getActualActionBlockReason(source)).toMatch(/再読み込み/);
  expect(state.getActualActionBlockReason(independent)).toBeNull();
  await act(async () => { await expect(state.deleteActual(source)).rejects.toThrow(/再読み込み/); });
  // A disjoint edit does not erase the waiting claim or deadlock on it.
  await act(async () => { await state.saveStandaloneActual({ ...draft, planId: null, note: 'independent saved' }, independent.id); });
  expect(state.getActualActionBlockReason(source)).toMatch(/再読み込み/);
  expect(state.actuals.find(a => a.id === independent.id)?.note).toBe('independent saved');
  await act(async () => { await state.retryPlannerData(); });
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.getActualActionBlockReason(source)).toBeNull();
  expect(state.actuals).toEqual(await fixture.storage.actuals.read());
  await act(async () => { await state.deleteActual(state.actuals.find(a => a.id === source.id)!); });
  expect((await fixture.storage.actuals.read()).map(a => a.id)).toEqual([independent.id]);
});

it('does not unlock a captured provisional target from an intervening full read before a canonical acknowledgement and failed repair', async () => {
  const fixture = await mount();
  const response = deferred();
  const canonical = { ...source, id: 'canonical', note: 'canonical saved' };
  boundary.repository.upsertActualWithMaterialProgress = async () => {
    await response.promise;
    await fixture.storage.actuals.write([canonical, independent]);
    return canonical;
  };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveActual(plan(), draft, source.id); });
  // This accepted snapshot still contains the old explicit ID.
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.actuals.some(a => a.id === source.id)).toBe(true);
  vi.spyOn(boundary.repository, 'getActuals').mockRejectedValueOnce(Error('repair offline'));
  await act(async () => { response.resolve(); await saving; });
  expect(state.actuals.some(a => a.id === source.id)).toBe(true);
  await act(async () => { await expect(state.deleteActual(source)).rejects.toThrow(/再読み込み/); });
  expect((await fixture.storage.actuals.read()).map(a => a.id)).toContain('canonical');
  await act(async () => { await state.retryPlannerData(); });
  expect(state.getActualActionBlockReason(source)).toMatch(/開き直し/);
  expect(state.getActualActionBlockReason(canonical)).toBeNull();
  await act(async () => { await expect(state.saveActual(plan(), draft, source.id)).rejects.toThrow(/開き直し/); });
  await act(async () => { await state.deleteActual(canonical); });
  expect((await fixture.storage.actuals.read()).map(a => a.id)).toEqual([independent.id]);
});

it.each(['getPlans', 'getActuals'] as const)('a crossed Plan deletion keeps the plan reservation through failed %s repair and releases after both groups publish', async failedGetter => {
  const fixture = await mount();
  const gate = deferred();
  const remove = boundary.repository.deletePlanWithDependents;
  boundary.repository.deletePlanWithDependents = async mutation => { await gate.promise; return remove(mutation); };
  let deleting!: Promise<void>;
  await act(async () => { deleting = state.deletePlan(plan()); });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.plans.some(p => p.id === source.planId)).toBe(true);
  vi.spyOn(boundary.repository, failedGetter).mockRejectedValueOnce(Error('compound repair offline'));
  await act(async () => { gate.resolve(); await deleting; });
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  const target = { userId: source.userId, planId: source.planId, occurrenceDate: source.occurrenceDate };
  expect(state.getActualActionBlockReason(target)).toMatch(/再読み込み/);
  await act(async () => { await expect(state.saveActual(plan(), draft)).rejects.toThrow(/再読み込み/); });
  // A Plans read cannot release an Actual-dependent claim, or vice versa.
  // Failed grouped reads publish neither replacement and retain the reservation.
  expect(state.plans.some(p => p.id === source.planId)).toBe(true);
  expect(state.actuals.some(a => a.id === source.id)).toBe(true);
  await act(async () => { await state.retryPlannerData(); });
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.plans).toEqual([]);
  expect(state.getActualActionBlockReason(target)).toBeNull();
  await act(async () => { await expect(state.saveActual(plan(), draft)).rejects.toThrow(/開き直し/); });
  expect((await fixture.storage.actuals.read()).map(a => a.id)).toEqual([independent.id]);
});

it.each([
  { outcome: 'success', holdAfterPersist: false },
  { outcome: 'reject-before-write', holdAfterPersist: false },
  { outcome: 'reject-after-write', holdAfterPersist: false },
  { outcome: 'success', holdAfterPersist: true },
  { outcome: 'reject-after-write', holdAfterPersist: true },
] as const)('crossed direct delete holds ID and occurrence through failed repair: $outcome, acknowledgement hold=$holdAfterPersist', async ({ outcome, holdAfterPersist }) => {
  const fixture = await mount();
  const gate = deferred();
  const entered = deferred();
  const remove = boundary.repository.deleteActual;
  const failure = Error('delete outcome unavailable');
  boundary.repository.deleteActual = async (...args) => {
    if (holdAfterPersist) await remove(...args);
    entered.resolve();
    await gate.promise;
    if (outcome === 'reject-before-write') throw failure;
    if (!holdAfterPersist) await remove(...args);
    if (outcome === 'reject-after-write') throw failure;
  };
  let deleting!: Promise<unknown>;
  await act(async () => {
    deleting = state.deleteActual(source).catch(error => error);
    await entered.promise;
  });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.actuals.some(a => a.id === source.id)).toBe(!holdAfterPersist);
  const actualRead = vi.spyOn(boundary.repository, 'getActuals').mockRejectedValueOnce(Error('delete repair offline'));
  await act(async () => {
    gate.resolve();
    expect(await deleting).toBe(outcome === 'success' ? undefined : failure);
  });
  expect(actualRead).toHaveBeenCalledTimes(1);
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  const occurrence = { userId: source.userId, planId: source.planId, occurrenceDate: source.occurrenceDate };
  expect(state.getActualActionBlockReason(source)).toMatch(/再読み込み/);
  expect(state.getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
  const save = vi.spyOn(boundary.repository, 'upsertActualWithMaterialProgress');
  await act(async () => {
    await expect(state.saveActual(plan(), draft, source.id)).rejects.toThrow(/再読み込み/);
    // Also block an empty Plan editor with no captured Actual ID. Its occurrence
    // must remain reserved even if the accepted snapshot already shows no row.
    await expect(state.saveActual(plan(), draft)).rejects.toThrow(/再読み込み/);
    await expect(state.deleteActual(source)).rejects.toThrow(/再読み込み/);
  });
  expect(save).not.toHaveBeenCalled();
  expect(state.getActualActionBlockReason(independent)).toBeNull();
  await act(async () => { await state.saveStandaloneActual({ ...draft, planId: null, note: 'disjoint' }, independent.id); });
  expect(state.getActualActionBlockReason(occurrence)).toMatch(/再読み込み/);
  expect(actualRead).toHaveBeenCalledTimes(1);
  await act(async () => { await state.retryPlannerData(); });
  expect(actualRead).toHaveBeenCalledTimes(2);
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.getActualActionBlockReason(occurrence)).toBeNull();
  expect(state.actuals).toEqual(await fixture.storage.actuals.read());
  if (outcome === 'reject-before-write') {
    expect(state.getActualActionBlockReason(source)).toBeNull();
    await act(async () => { await state.saveActual(plan(), draft, source.id); });
  } else {
    expect(state.getActualActionBlockReason(source)).toMatch(/開き直し/);
    await act(async () => { await expect(state.saveActual(plan(), draft, source.id)).rejects.toThrow(/開き直し/); });
    expect((await fixture.storage.actuals.read()).map(a => a.id)).toEqual([independent.id]);
    // A genuinely new record is allowed only after the successful authoritative read.
    await act(async () => { await state.saveActual(plan(), draft); });
    expect(state.actuals.find(a => a.planId === source.planId)?.id).not.toBe(source.id);
  }
});
