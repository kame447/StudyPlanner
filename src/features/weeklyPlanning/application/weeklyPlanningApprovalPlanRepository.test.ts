import { describe, expect, it } from 'vitest';
import type { PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import {
  createMemoryWeeklyPlanningApprovalPlanRepository,
  createWeeklyPlanningApprovalMemoryState,
  WeeklyPlanningApprovalPersistenceError,
} from './weeklyPlanningApprovalPlanRepository';

const USER_ID = 'user-1';
const OPERATION_ID = 'weekly-approval:operation-1';

function draft(sourceDraftBlockId: string, title = '英語ワーク'): PlanDraft {
  return {
    userId: USER_ID,
    title,
    subject: '英語',
    date: '2026-07-20',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    sourceType: 'weekly-planning',
    sourceId: buildWeeklyPlanningPlanSourceId({
      approvalOperationId: OPERATION_ID,
      sourceDraftBlockId,
    }),
  };
}

function completedOperation(sourceDraftBlockIds: string[]): WeeklyDraftApprovalOperation {
  const timestamp = '2026-07-18T00:00:00.000Z';
  return {
    approvalOperationId: OPERATION_ID,
    userId: USER_ID,
    previewId: 'preview-1',
    previewStateRevision: 0,
    startedAt: timestamp,
    completedAt: timestamp,
    status: 'completed',
    items: sourceDraftBlockIds.map((sourceDraftBlockId) => ({
      sourceDraftBlockId,
      status: 'saved',
      attemptCount: 1,
      updatedAt: timestamp,
    })),
  };
}

async function expectPersistenceError(
  promise: Promise<unknown>,
  code: WeeklyPlanningApprovalPersistenceError['code'],
): Promise<WeeklyPlanningApprovalPersistenceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WeeklyPlanningApprovalPersistenceError);
    const persistenceError = error as WeeklyPlanningApprovalPersistenceError;
    expect(persistenceError.code).toBe(code);
    return persistenceError;
  }
  throw new Error('expected persistence error');
}

describe('weeklyPlanningApprovalPlanRepository', () => {
  it('creates one Plan when two clients save the same approval item concurrently', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const clientA = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    const clientB = createMemoryWeeklyPlanningApprovalPlanRepository(state);

    const [savedByA, savedByB] = await Promise.all([
      clientA.saveApprovedPlan(draft('block-1')),
      clientB.saveApprovedPlan(draft('block-1')),
    ]);

    expect(savedByA.id).toBe(savedByB.id);
    expect(savedByA.sourceType).toBe('weekly-planning');
    expect(state.plans.size).toBe(1);
    expect(state.items.size).toBe(1);
    expect(state.metrics.planWrites).toBe(1);
  });

  it('does not deduplicate independently identified items with identical content', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);

    const first = await repository.saveApprovedPlan(draft('block-1'));
    const second = await repository.saveApprovedPlan(draft('block-2'));

    expect(first.id).not.toBe(second.id);
    expect(state.plans.size).toBe(2);
    expect(state.metrics.planWrites).toBe(2);
  });

  it('repairs missing operation progress from the deterministic Plan provenance', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const firstClient = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    const saved = await firstClient.saveApprovedPlan(draft('block-1'));
    state.operations.clear();
    state.items.clear();

    const restored = await createMemoryWeeklyPlanningApprovalPlanRepository(state)
      .saveApprovedPlan(draft('block-1'));

    expect(restored.id).toBe(saved.id);
    expect(state.plans.size).toBe(1);
    expect(state.items.size).toBe(1);
    expect(state.operations.size).toBe(1);
    expect(state.metrics.planWrites).toBe(1);
  });

  it('does not recreate a Plan when a saved item points to a missing Plan', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    const saved = await repository.saveApprovedPlan(draft('block-1'));
    state.plans.delete(saved.id);

    await expectPersistenceError(
      repository.saveApprovedPlan(draft('block-1')),
      'saved_plan_missing',
    );

    expect(state.metrics.planWrites).toBe(1);
  });

  it('marks the operation completed only after every expected item is durable', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    await repository.saveApprovedPlan(draft('block-1'));

    const incompleteError = await expectPersistenceError(
      repository.completeOperation(completedOperation(['block-1', 'block-2'])),
      'incomplete_operation',
    );
    expect(incompleteError.retryable).toBe(true);

    await repository.saveApprovedPlan(draft('block-2'));
    await repository.completeOperation(completedOperation(['block-1', 'block-2']));

    const operation = Array.from(state.operations.values())[0];
    expect(operation.status).toBe('completed');
    expect(operation.savedItemCount).toBe(2);
    expect(operation.expectedItemCount).toBe(2);
    expect(operation.completedAt).toBeDefined();
  });

  it('rejects drafts without structured weekly-planning provenance', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    const invalidDraft = {
      ...draft('block-1'),
      sourceType: 'manual' as const,
      sourceId: null,
    };

    await expectPersistenceError(
      repository.saveApprovedPlan(invalidDraft),
      'invalid_request',
    );
    expect(state.plans.size).toBe(0);
  });
});
