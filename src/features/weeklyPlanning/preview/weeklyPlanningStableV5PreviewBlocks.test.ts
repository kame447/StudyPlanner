import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from './weeklyPlanningPreviewBlocks';

function stableCandidate(): WeeklyDraftCandidate {
  return {
    stableKey: 'stable-v5:1:work-item-1:0',
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
      graphRevision: 3,
      taskId: 'task-1',
      sourceFactRefs: ['task-1', 'workload-1'],
      planType: 'other',
    },
  } as WeeklyDraftCandidate;
}

describe('Stable V5 preview blocks', () => {
  it('preserves non-study plan type in preview display and promoted drafts', () => {
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
  });
});
