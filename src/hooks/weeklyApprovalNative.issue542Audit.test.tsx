import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createEmptyPlanDraft, createPlanDraftFromPlan } from '../domain/planner';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { MemoryStorage, deferred, event, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { createPlannerBackedWeeklyPlanningApprovalPlanRepository } from '../features/weeklyPlanning/application/weeklyPlanningApprovalLocalRepository';
import type { WeeklyPlanningApprovalPlanRepository } from '../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepositoryContract';
import { buildWeeklyPlanningPlanSourceId, WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';
import { createWeeklyDraftApprovalOperation } from '../features/weeklyPlanning/planning/weeklyPlanningApproval';
import { executeInterruptibleWeeklyDraftApproval } from '../features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval';
import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPreviewMetadata } from '../features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';
import type { Plan, PlanDraft } from '../types/domain';
import { usePlannerAppState } from './usePlannerAppState';

const boundary = vi.hoisted(() => ({
  repository: null as unknown as PlannerRepository,
  approval: null as unknown as WeeklyPlanningApprovalPlanRepository,
  bootstrap: vi.fn(async (load: (owner: string) => Promise<void>) => { await load('owner'); }),
  noop: vi.fn(async () => undefined),
}));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => boundary.approval,
}));
vi.mock('./useAuthSessionState', () => ({ useAuthSessionState: () => ({
  booting: false,
  user: { id: 'owner', email: 'owner@example.com', username: 'Owner', avatar: '', createdAt: '2026-10-08T00:00:00.000Z' },
  bootstrapSession: boundary.bootstrap,
  signUpWithPassword: boundary.noop, signInWithPassword: boundary.noop,
  signInWithGoogle: boundary.noop, sendPasswordReset: boundary.noop,
  saveUserProfile: boundary.noop, signOut: boundary.noop,
}) }));
vi.mock('./useNoticeState', () => ({ useNoticeState: () => ({
  notice: null, showNotice: boundary.noop, dismissNotice: boundary.noop,
}) }));
vi.mock('../data/naturalLanguageCatalog', () => ({
  loadNaturalLanguageCatalogWithOutcome: async () => ({ source: 'server' }),
}));

let state: ReturnType<typeof usePlannerAppState>;
let renderer: ReactTestRenderer | undefined;
let fullRead: MockInstance<PlannerRepository['getScheduleSnapshot']>;
function Harness() { state = usePlannerAppState(); return null; }
function draft(block = 'block-1', operation = 'operation-1'): PlanDraft {
  return { ...createEmptyPlanDraft('owner', '2026-10-08'), title: `Approved ${block}`,
    startTime: '09:00', endTime: '10:00', sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
    sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: operation, sourceDraftBlockId: block }) };
}

beforeEach(async () => {
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.plans', JSON.stringify([plan({ id: 'historic', date: '2020-01-01' })]));
  storage.setItem('studyplanner.monthEvents', JSON.stringify([event({ id: 'multiday', endDate: '2026-10-09', repeat: 'weekly' })]));
  boundary.repository = createLocalPlannerRepository(storage);
  boundary.approval = createPlannerBackedWeeklyPlanningApprovalPlanRepository();
  boundary.bootstrap.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await boundary.bootstrap.mock.results[0].value; });
  expect(state.plannerDataAvailability.status).toBe('ready');
  fullRead = vi.spyOn(boundary.repository, 'getScheduleSnapshot');
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('Issue 542 independent native approval audit', () => {
  it('keeps a completed ordinary edit when the same approval is retried later, without full reload', async () => {
    let first!: Plan;
    await act(async () => { first = await state.saveWeeklyApprovedPlan(draft()); });
    await act(async () => { await state.savePlanDraft({ ...createPlanDraftFromPlan(first), title: 'Later edit' }, first.id); });
    let retried!: Plan;
    await act(async () => { retried = await state.saveWeeklyApprovedPlan(draft()); });
    expect(retried).toMatchObject({ id: first.id, title: 'Later edit' });
    expect(state.plans.find(row => row.id === first.id)?.title).toBe('Later edit');
    expect(state.plans.map(row => row.id)).toEqual(['historic', first.id]);
    expect(state.monthEvents).toEqual([expect.objectContaining({ id: 'multiday', endDate: '2026-10-09', repeat: 'weekly' })]);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it('preserves both concurrent durable saves when targeted repair fails, then retries reads without writing again', async () => {
    const originalSave = boundary.approval.saveApprovedPlan;
    const response = deferred();
    const firstPersisted = deferred();
    const persisted = deferred();
    let writesSettled = 0;
    boundary.approval.saveApprovedPlan = vi.fn(async input => {
      const saved = await originalSave(input);
      if (++writesSettled === 1) firstPersisted.resolve();
      else persisted.resolve();
      await response.promise;
      return saved;
    });
    let first!: Promise<Plan>, second!: Promise<Plan>;
    await act(async () => {
      first = state.saveWeeklyApprovedPlan(draft());
      await Promise.race([firstPersisted.promise, first]);
    });
    await act(async () => {
      second = state.saveWeeklyApprovedPlan(draft('block-2'));
      await Promise.race([persisted.promise, second]);
    });
    vi.spyOn(boundary.repository, 'getPlans').mockRejectedValueOnce(new Error('repair read offline'));
    let saved!: Plan[];
    await act(async () => { response.resolve(); saved = await Promise.all([first, second]); });
    expect(saved).toHaveLength(2);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery?.canRetry).toBe(true);
    const saveCalls = vi.mocked(boundary.approval.saveApprovedPlan).mock.calls.length;
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.plans.map(row => row.id)).toEqual(['historic', ...saved.map(row => row.id)]);
    expect(boundary.approval.saveApprovedPlan).toHaveBeenCalledTimes(saveCalls);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it('does not claim an unknown commit succeeded and discovers the same canonical identity on retry', async () => {
    const originalSave = boundary.approval.saveApprovedPlan;
    const failure = new Error('lost acknowledgement');
    boundary.approval.saveApprovedPlan = async input => { await originalSave(input); throw failure; };
    await act(async () => { await expect(state.saveWeeklyApprovedPlan(draft())).rejects.toBe(failure); });
    expect(state.plans.map(row => row.id)).toEqual(['historic']);
    const durableBefore = await boundary.repository.getPlans('owner');
    boundary.approval.saveApprovedPlan = originalSave;
    await act(async () => { await state.saveWeeklyApprovedPlan(draft()); });
    expect(state.plans).toEqual(durableBefore);
    expect(await boundary.repository.getPlans('owner')).toEqual(durableBefore);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it('finishes the active item on cancellation and resumes only the unsaved item through the real app callback', async () => {
    const metadata: WeeklyPreviewMetadata = { previewId: 'audit-preview', stateRevision: 0,
      assumptionDependencies: [], approvalEligibility: 'eligible', stale: false, authorizedUserId: 'owner' };
    const blocks = ['block-1', 'block-2'].map(id => ({
      ...createWeeklyPlanningTestDraftBlock({ id, previewMetadata: metadata }), userId: 'owner',
    }));
    const operation = createWeeklyDraftApprovalOperation({ userId: 'owner', metadata, blocks, now: '2026-10-08T00:00:00.000Z' });
    let continuing = true;
    const saveBlock = vi.fn(async ({ block }: { block: { id: string } }) => {
      const saved = await state.saveWeeklyApprovedPlan(draft(block.id, operation.approvalOperationId));
      continuing = false;
      return { planId: saved.id };
    });
    const dependencies = { findExistingPlanId: async () => undefined, saveBlock, now: () => '2026-10-08T00:01:00.000Z' };
    let partial!: typeof operation;
    await act(async () => { partial = await executeInterruptibleWeeklyDraftApproval({ operation, blocks, dependencies, shouldContinue: () => continuing }); });
    expect(partial.items.map(item => item.status)).toEqual(['saved', 'pending']);
    continuing = true;
    let complete!: typeof operation;
    await act(async () => { complete = await executeInterruptibleWeeklyDraftApproval({ operation: partial, blocks, dependencies, shouldContinue: () => continuing }); });
    expect(complete.status).toBe('completed');
    expect(saveBlock.mock.calls.map(([input]) => input.block.id)).toEqual(['block-1', 'block-2']);
    expect(state.plans).toHaveLength(3);
    expect(fullRead).not.toHaveBeenCalled();
  });
});
