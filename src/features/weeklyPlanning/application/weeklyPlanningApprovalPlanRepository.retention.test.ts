import { describe, expect, it } from 'vitest';
import type { PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import {
  createMemoryWeeklyPlanningApprovalPlanRepository,
  createWeeklyPlanningApprovalMemoryState,
} from './weeklyPlanningApprovalPlanRepository';

const USER_ID = 'user-1';
const OPERATION_ID = 'weekly-approval:retention';

function draft(): PlanDraft {
  return {
    userId: USER_ID,
    title: '英語',
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
      sourceDraftBlockId: 'block-1',
    }),
  };
}

function operation(): WeeklyDraftApprovalOperation {
  const timestamp = '2026-07-18T00:00:00.000Z';
  return {
    approvalOperationId: OPERATION_ID,
    userId: USER_ID,
    previewId: 'preview-retention',
    previewStateRevision: 0,
    startedAt: timestamp,
    completedAt: timestamp,
    status: 'completed',
    items: [{
      sourceDraftBlockId: 'block-1',
      status: 'saved',
      attemptCount: 1,
      updatedAt: timestamp,
    }],
  };
}

describe('weekly planning approval retention', () => {
  it('stores expiry on both operation and item and refreshes them at completion', async () => {
    const state = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(state);
    await repository.saveApprovedPlan(draft());

    const itemBefore = Array.from(state.items.values())[0];
    const operationBefore = Array.from(state.operations.values())[0];
    expect(itemBefore.expiresAt).toBeInstanceOf(Date);
    expect(operationBefore.expiresAt).toBeInstanceOf(Date);
    expect(state.metrics.itemWrites).toBe(1);

    await repository.completeOperation(operation());

    const itemAfter = Array.from(state.items.values())[0];
    const operationAfter = Array.from(state.operations.values())[0];
    expect(itemAfter.expiresAt).toBeInstanceOf(Date);
    expect(operationAfter.expiresAt).toBeInstanceOf(Date);
    expect(itemAfter.expiresAt.getTime()).toBeGreaterThanOrEqual(
      itemBefore.expiresAt.getTime(),
    );
    expect(operationAfter.expiresAt.getTime()).toBeGreaterThanOrEqual(
      operationBefore.expiresAt.getTime(),
    );
    expect(state.metrics.itemWrites).toBe(2);
  });
});
