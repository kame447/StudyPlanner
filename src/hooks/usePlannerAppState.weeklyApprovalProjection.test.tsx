import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlanDraft, createPlanDraftFromPlan } from '../domain/planner';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository, PlannerStorageGateway } from '../repositories/repositoryContracts';
import {
  createMemoryWeeklyPlanningApprovalPlanRepository,
  createWeeklyPlanningApprovalMemoryState,
  type WeeklyPlanningApprovalMemoryState,
} from '../features/weeklyPlanning/application/weeklyPlanningApprovalMemoryRepository';
import type { WeeklyPlanningApprovalPlanRepository } from '../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepositoryContract';
import { buildWeeklyPlanningPlanSourceId, WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';
import type { WeeklyDraftApprovalOperation } from '../features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';
import type { Plan, PlanDraft } from '../types/domain';
import { usePlannerAppState } from './usePlannerAppState';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';

const boundary = vi.hoisted(() => ({
  repository: null as unknown as PlannerRepository,
  approval: null as unknown as WeeklyPlanningApprovalPlanRepository,
  owner: 'owner',
  load: null as unknown as (owner: string) => Promise<void>,
  bootstrap: vi.fn(async (load: (owner: string) => Promise<void>) => {
    boundary.load = load;
    await load(boundary.owner);
  }),
  noop: vi.fn(async () => undefined),
  notice: vi.fn(),
}));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => boundary.approval,
}));
vi.mock('./useAuthSessionState', () => ({ useAuthSessionState: () => ({
  booting: false,
  user: { id: boundary.owner, email: 'owner@example.com', username: 'Owner', avatar: '', createdAt: '2026-10-08T00:00:00.000Z' },
  bootstrapSession: boundary.bootstrap,
  signUpWithPassword: boundary.noop, signInWithPassword: boundary.noop,
  signInWithGoogle: boundary.noop, sendPasswordReset: boundary.noop,
  saveUserProfile: boundary.noop, signOut: boundary.noop,
}) }));
vi.mock('./useNoticeState', () => ({ useNoticeState: () => ({
  notice: null, showNotice: boundary.notice, dismissNotice: boundary.noop,
}) }));
vi.mock('../data/naturalLanguageCatalog', () => ({
  loadNaturalLanguageCatalogWithOutcome: async () => ({ source: 'server' }),
}));

let state: ReturnType<typeof usePlannerAppState>;
let renderer: ReactTestRenderer | undefined;
let ledger: WeeklyPlanningApprovalMemoryState;
let getters: Record<string, ReturnType<typeof vi.fn>>;
function Harness() { state = usePlannerAppState(); return null; }
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function draft(block = 'block-1', operation = 'operation-1'): PlanDraft {
  return { ...createEmptyPlanDraft('owner', '2026-10-08'), title: `Approved ${block}`,
    startTime: '09:00', endTime: '10:00', sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
    sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: operation, sourceDraftBlockId: block }) };
}
function operation(plans: Plan[], blocks = plans.map((_, index) => `block-${index + 1}`)): WeeklyDraftApprovalOperation {
  return { approvalOperationId: 'operation-1', userId: 'owner', previewId: 'preview-1',
    previewStateRevision: 1, startedAt: '2026-10-08T00:00:00.000Z', status: 'completed',
    items: plans.map((plan, index) => ({ sourceDraftBlockId: blocks[index], status: 'saved', savedPlanId: plan.id,
      attemptCount: 1, updatedAt: '2026-10-08T00:00:00.000Z' })) };
}
function clearReads() { Object.values(getters).forEach(getter => getter.mockClear()); }
function readCounts() { return Object.fromEntries(Object.entries(getters).map(([key, getter]) => [key, getter.mock.calls.length])); }
function expectNoReads() { expect(Object.values(readCounts()).reduce((sum, count) => sum + count, 0)).toBe(0); }
async function refresh() { await act(async () => { await boundary.load(boundary.owner); }); }
function holdApprovalResponse() {
  const persisted = deferred<Plan>(); const response = deferred();
  const original = boundary.approval.saveApprovedPlan;
  boundary.approval.saveApprovedPlan = vi.fn(async input => {
    const saved = await original(input);
    persisted.resolve(saved);
    await response.promise;
    return saved;
  });
  return { persisted, response };
}

beforeEach(async () => {
  ledger = createWeeklyPlanningApprovalMemoryState();
  boundary.approval = createMemoryWeeklyPlanningApprovalPlanRepository(ledger);
  boundary.owner = 'owner';
  boundary.notice.mockClear(); boundary.bootstrap.mockClear();
  const emptyRead = () => vi.fn(async () => []);
  getters = {
    plans: vi.fn(async () => [...ledger.plans.values()]), actuals: emptyRead(), dayNotes: emptyRead(),
    monthEvents: emptyRead(), todos: emptyRead(), studySubjects: emptyRead(), studyMaterials: emptyRead(),
    scheduleTemplates: emptyRead(), timetableTerms: emptyRead(), timetablePeriods: emptyRead(),
  };
  const gateway = Object.fromEntries(Object.entries(getters).flatMap(([name, read]) => {
    const suffix = name[0].toUpperCase() + name.slice(1);
    return [[`read${suffix}`, read], [`write${suffix}`, vi.fn(async () => undefined)]];
  })) as unknown as PlannerStorageGateway;
  gateway.writePlans = async values => {
    ledger.plans.clear();
    (await values).forEach(plan => ledger.plans.set(plan.id, plan));
  };
  boundary.repository = createPlannerRepository(gateway);
  await act(async () => { renderer = create(<Harness />); });
  expect(state.plannerDataAvailability.status).toBe('ready');
  clearReads();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('weekly approval confirmed projection', () => {
  it('publishes K confirmed items and finalizes their ledger without any per-item full reads', async () => {
    const saved: Plan[] = [];
    const selection = { date: state.selectedDate, month: state.monthDate, view: state.viewMode };
    await act(async () => {
      for (let index = 1; index <= 3; index += 1) saved.push(await state.saveWeeklyApprovedPlan(draft(`block-${index}`)));
      await state.completeWeeklyApprovalOperation(operation(saved));
    });
    expect(state.plans).toEqual(saved);
    expect(ledger.metrics.planWrites).toBe(3);
    expect([...ledger.operations.values()][0].status).toBe('completed');
    expect([...ledger.items.values()].map(item => item.savedPlanId)).toEqual(saved.map(plan => plan.id));
    expect({ date: state.selectedDate, month: state.monthDate, view: state.viewMode }).toEqual(selection);
    expect(state.editorDraft).toBeNull();
    expect(state.plannerDataAvailability.status).toBe('ready');
    expectNoReads();
  });

  it('keeps a confirmed item when a later item rejects, and resumes with its original idempotent identity', async () => {
    const original = boundary.approval.saveApprovedPlan;
    const error = new Error('approval rejected');
    boundary.approval.saveApprovedPlan = vi.fn().mockImplementationOnce(original).mockRejectedValueOnce(error).mockImplementation(original);
    let first!: Plan;
    await act(async () => { first = await state.saveWeeklyApprovedPlan(draft()); });
    await act(async () => { await expect(state.saveWeeklyApprovedPlan(draft('block-2'))).rejects.toBe(error); });
    expect(state.plans).toEqual([first]);
    let second!: Plan;
    await act(async () => {
      expect(await state.saveWeeklyApprovedPlan(draft())).toEqual(first);
      second = await state.saveWeeklyApprovedPlan(draft('block-2'));
      await state.completeWeeklyApprovalOperation(operation([first, second]));
    });
    expect(state.plans).toEqual([first, second]);
    expect(ledger.metrics.planWrites).toBe(2);
    expectNoReads();
  });

  it('does not report an unknown write outcome as success and retries through the server ledger', async () => {
    const original = boundary.approval.saveApprovedPlan;
    const error = new Error('response lost after commit');
    boundary.approval.saveApprovedPlan = vi.fn(async input => { await original(input); throw error; });
    await act(async () => { await expect(state.saveWeeklyApprovedPlan(draft())).rejects.toBe(error); });
    expect(state.plans).toEqual([]);
    expect(ledger.metrics.planWrites).toBe(1);
    boundary.approval.saveApprovedPlan = original;
    let saved!: Plan;
    await act(async () => { saved = await state.saveWeeklyApprovedPlan(draft()); });
    expect(state.plans).toEqual([saved]);
    expect(ledger.metrics.planWrites).toBe(1);
    expectNoReads();
  });

  it('does not replace a newer accepted projection with a delayed approval response', async () => {
    const held = holdApprovalResponse();
    let saving!: Promise<Plan>;
    await act(async () => { saving = state.saveWeeklyApprovedPlan(draft()); });
    const saved = await held.persisted.promise;
    const newer = { ...saved, title: 'Edited after approval commit' };
    ledger.plans.set(saved.id, newer);
    await refresh();
    clearReads();
    await act(async () => { held.response.resolve(); expect(await saving).toEqual(saved); });
    expect(state.plans).toEqual([newer]);
    expect(readCounts()).toEqual({ plans: 1, todos: 1, actuals: 1, studyMaterials: 1,
      dayNotes: 0, monthEvents: 0, studySubjects: 0, scheduleTemplates: 0, timetableTerms: 0, timetablePeriods: 0 });
  });

  it('does not let a delayed duplicate approval overwrite a concurrent ordinary edit', async () => {
    let first!: Plan;
    await act(async () => { first = await state.saveWeeklyApprovedPlan(draft()); });
    const held = holdApprovalResponse();
    let saving!: Promise<Plan>;
    await act(async () => { saving = state.saveWeeklyApprovedPlan(draft()); });
    await held.persisted.promise;
    await act(async () => { await state.savePlanDraft({ ...createPlanDraftFromPlan(first), title: 'Newer manual edit' }, first.id); });
    clearReads();
    await act(async () => { held.response.resolve(); await saving; });
    expect(state.plans).toEqual([expect.objectContaining({ id: first.id, title: 'Newer manual edit' })]);
    expect(readCounts()).toEqual({ plans: 1, todos: 1, actuals: 0, studyMaterials: 0,
      dayNotes: 0, monthEvents: 0, studySubjects: 0, scheduleTemplates: 0, timetableTerms: 0, timetablePeriods: 0 });
  });

  it('keeps a failed crossed-projection repair retryable without re-saving the approved item', async () => {
    const held = holdApprovalResponse();
    let saving!: Promise<Plan>;
    await act(async () => { saving = state.saveWeeklyApprovedPlan(draft()); });
    const saved = await held.persisted.promise;
    await refresh();
    clearReads();
    getters.plans.mockRejectedValueOnce(new Error('plans unavailable'));
    await act(async () => { held.response.resolve(); expect(await saving).toEqual(saved); });
    expect(state.plannerDataAvailability.status).not.toBe('ready');
    expect(state.plannerDataRecovery).not.toBeNull();
    expect(ledger.metrics.planWrites).toBe(1);
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plans).toEqual([saved]);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(ledger.metrics.planWrites).toBe(1);
    expect(getters.dayNotes).not.toHaveBeenCalled();
  });

  it('repairs an older full snapshot accepted after an approval has already succeeded', async () => {
    const gate = deferred();
    getters.plans.mockImplementationOnce(async () => { const rows = [...ledger.plans.values()]; await gate.promise; return rows; });
    let loading!: Promise<void>;
    await act(async () => { loading = boundary.load('owner'); });
    let saved!: Plan;
    await act(async () => { saved = await state.saveWeeklyApprovedPlan(draft()); });
    expect(state.plans).toEqual([saved]);
    clearReads();
    await act(async () => { gate.resolve(); await loading; });
    expect(state.plans).toEqual([saved]);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(getters.plans).toHaveBeenCalledTimes(1);
    expect(getters.todos).toHaveBeenCalledTimes(1);
    expect(getters.dayNotes).not.toHaveBeenCalled();
    expect(ledger.metrics.planWrites).toBe(1);
  });

  it('preserves failed full-read health while projecting an uncontended confirmed save', async () => {
    getters.plans.mockRejectedValueOnce(new Error('full read unavailable'));
    await act(async () => { await expect(boundary.load('owner')).rejects.toThrow('full read unavailable'); });
    clearReads();
    let saved!: Plan;
    await act(async () => { saved = await state.saveWeeklyApprovedPlan(draft()); });
    expect(state.plans).toEqual([saved]);
    expect(state.plannerDataAvailability.status).not.toBe('ready');
    expect(state.plannerDataRecovery).not.toBeNull();
    expectNoReads();
  });

  it('waits for an ordinary edit already pending before duplicate approval before reconciling', async () => {
    let first!: Plan;
    await act(async () => { first = await state.saveWeeklyApprovedPlan(draft()); });
    const editGate = deferred();
    const original = boundary.repository.upsertPlan;
    boundary.repository.upsertPlan = async plan => { await editGate.promise; return original(plan); };
    let editing!: Promise<void>;
    await act(async () => { editing = state.savePlanDraft({ ...createPlanDraftFromPlan(first), title: 'Pending manual edit' }, first.id); });
    clearReads();
    await act(async () => { expect(await state.saveWeeklyApprovedPlan(draft())).toEqual(first); });
    expect(state.plans[0].title).toBe('Pending manual edit');
    expect(state.plannerDataAvailability.status).not.toBe('ready');
    expectNoReads();
    await act(async () => { editGate.resolve(); await editing; });
    expect(state.plans).toEqual([expect.objectContaining({ id: first.id, title: 'Pending manual edit' })]);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(getters.todos).toHaveBeenCalledTimes(1);
    expect(getters.dayNotes).not.toHaveBeenCalled();
  });

  it('propagates finalization failure and retries only finalization without another Plan write', async () => {
    let saved!: Plan;
    await act(async () => { saved = await state.saveWeeklyApprovedPlan(draft()); });
    const original = boundary.approval.completeOperation;
    const error = new Error('finalization response lost');
    boundary.approval.completeOperation = vi.fn(async operation => { await original(operation); throw error; });
    await act(async () => { await expect(state.completeWeeklyApprovalOperation(operation([saved]))).rejects.toBe(error); });
    expect(state.plans).toEqual([saved]);
    boundary.approval.completeOperation = original;
    await act(async () => { await state.completeWeeklyApprovalOperation(operation([saved])); });
    expect([...ledger.operations.values()][0].status).toBe('completed');
    expect(ledger.metrics.planWrites).toBe(1);
    expectNoReads();
  });

  it('rejects a foreign-owner acknowledgement without adopting its row', async () => {
    const original = boundary.approval.saveApprovedPlan;
    boundary.approval.saveApprovedPlan = async input => ({ ...await original(input), userId: 'other' });
    await act(async () => { await expect(state.saveWeeklyApprovedPlan(draft())).rejects.toThrow('所有者'); });
    expect(state.plans).toEqual([]);
    expectNoReads();
  });

  it.each(['owner-change', 'owner-aba', 'sign-out', 'unmount'] as const)('fences late success after %s without another read or write dispatch', async transition => {
    const held = holdApprovalResponse();
    const retainedSave = state.saveWeeklyApprovedPlan;
    let saving!: Promise<unknown>;
    await act(async () => { saving = retainedSave(draft()).catch(error => error); });
    await held.persisted.promise;
    if (transition === 'sign-out') await act(async () => { await state.signOut(); });
    else if (transition === 'unmount') { act(() => renderer!.unmount()); renderer = undefined; }
    else {
      boundary.owner = 'other';
      await act(async () => { renderer!.update(<Harness />); });
      if (transition === 'owner-aba') {
        boundary.owner = 'owner';
        await act(async () => { renderer!.update(<Harness />); });
      }
    }
    clearReads();
    await act(async () => {
      held.response.resolve();
      expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError);
      await expect(retainedSave(draft('block-2'))).rejects.toBeInstanceOf(PlannerMutationScopeExpiredError);
    });
    expect(ledger.metrics.planWrites).toBe(1);
    expectNoReads();
  });
});
