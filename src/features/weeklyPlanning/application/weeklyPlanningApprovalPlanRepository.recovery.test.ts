import { describe, expect, it } from 'vitest';
import type { PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import {
  createMemoryWeeklyPlanningApprovalPlanRepository,
  createWeeklyPlanningApprovalMemoryState,
} from './weeklyPlanningApprovalPlanRepository';

const USER_ID = 'user-1';
const OPERATION_ID = 'weekly-approval:recovery';

function draft(sourceDraftBlockId: string): PlanDraft {
  return {
    userId: USER_ID,
    title: sourceDraftBlockId,
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

function completedOperation(blockIds: string[]): WeeklyDraftApprovalOperation {
  const timestamp = '2026-07-18T00:00:00.000Z';
  return {
    approvalOperationId: OPERATION_ID,
    userId: USER_ID,
    previewId: 'preview-recovery',
    previewStateRevision: 0,
    startedAt: timestamp,
    completedAt: timestamp,
    status: 'completed',
    items: blockIds.map((sourceDraftBlockId) => ({
      sourceDraftBlockId,
      status: 'saved',
      attemptCount: 1,
      updatedAt: timestamp,
    })),
  };
}

describe('weeklyPlanningApprovalPlanRepository operation recovery', () => {
  it('rebuilds a deleted parent operation from durable item and Plan records', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    await repository.saveApprovedPlan(draft('block-1'));
    await repository.saveApprovedPlan(draft('block-2'));
    state.operations.clear();

    await repository.completeOperation(completedOperation(['block-1', 'block-2']));

    expect(state.operations.size).toBe(1);
    const operation = Array.from(state.operations.values())[0];
    expect(operation.status).toBe('completed');
    expect(operation.savedItemCount).toBe(2);
    expect(operation.expectedItemCount).toBe(2);
    expect(state.metrics.planWrites).toBe(2);
  });

  it('does not rebuild completion when one durable item record is missing', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    await repository.saveApprovedPlan(draft('block-1'));
    await repository.saveApprovedPlan(draft('block-2'));
    state.operations.clear();
    const secondItemKey = Array.from(state.items.keys()).find((key) => key.includes('block-2'));
    expect(secondItemKey).toBeDefined();
    state.items.delete(secondItemKey!);

    await expect(
      repository.completeOperation(completedOperation(['block-1', 'block-2'])),
    ).rejects.toMatchObject({
      code: 'incomplete_operation',
      retryable: true,
    });

    expect(state.operations.size).toBe(0);
  });
});
