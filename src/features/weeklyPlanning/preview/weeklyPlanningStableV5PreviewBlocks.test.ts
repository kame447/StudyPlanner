import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWeeklyPlanningApprovalAvailability,
} from '../application/weeklyPlanningApprovalAvailability';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from './weeklyPlanningPreviewBlocks';

function stableCandidate(): WeeklyDraftCandidate {
  return {
    stableKey: 'stable-v5:3:work-item-1:0',
    date: '2026-07-27',
    startTime: '10:00',
    endTime: '11:00',
    durationMinutes: 60,
    title: '部屋の掃除 60分',
    field: '部屋の掃除',
    year: 0,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'work-item-1',
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId: 'conversation-1',
      graphRevision: 3,
      taskId: 'task-1',
      sourceFactRefs: ['task-1', 'workload-1'],
      planType: 'other',
    },
  } as WeeklyDraftCandidate;
}

function publishRevision(revision: number): void {
  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: 'owner-1',
    conversationId: 'conversation-1',
    graph: {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision,
    },
  });
}

describe('Stable V5 preview blocks', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  it('preserves non-study plan type in preview display and promoted drafts', () => {
    publishRevision(3);
    const preview = createWeeklyPlanningPreviewBlocks([stableCandidate()]);
    expect(preview[0]).toMatchObject({
      planType: 'other',
      stableV5Metadata: {
        runtime: 'stable_v5',
        graphRevision: 3,
      },
    });

    const display = createWeeklyPlanningPreviewDisplayBlock(preview[0], 'owner-1');
    expect(display.type).toBe('other');
    expect(display.memo).toContain('Stable V5 preview');
    expect(display.memo).not.toContain('year: 0');

    const promoted = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [stableCandidate()],
      userId: 'owner-1',
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    expect(promoted[0].type).toBe('other');
    expect(promoted[0].memo).toContain('graphRevision: 3');
    expect(promoted[0].memo).not.toContain('year: 0');
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: promoted,
      userId: 'owner-1',
    })).toMatchObject({ kind: 'eligible', reason: 'current_session' });
  });

  it('requires recomputation after the Stable graph revision advances', () => {
    publishRevision(3);
    const promoted = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [stableCandidate()],
      userId: 'owner-1',
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    publishRevision(4);
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: promoted,
      userId: 'owner-1',
    })).toMatchObject({
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
    });
  });
});
