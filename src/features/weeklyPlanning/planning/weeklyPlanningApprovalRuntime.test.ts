import { afterEach, describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../types';
import { validateWeeklyPreviewApproval } from './weeklyPlanningApproval';
import {
  clearWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from './weeklyPlanningSessionRuntime';

function block(conversationId = 'conversation-1', stateRevision = 5): WeeklyPlanDraftBlock {
  return {
    id: 'block-1',
    userId: 'user-1',
    date: '2026-07-14',
    startTime: '18:00',
    endTime: '19:00',
    title: '英語',
    subject: '英語',
    type: 'study',
    label: '英語',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    behaviorMetadata: {
      stateRevision,
      sourceFactRefs: ['task:0'],
      usedAssumptionProposalRefs: [],
      taskRef: 'task:0',
      opportunityTags: [],
      reasoningKey: 'explicit-duration',
      compatibility: {
        workItemSemantic: 'behavior_aware_task',
        schedulerInputSource: 'exam_prep_request',
        candidateSource: 'weekly_exam_prep',
      },
      previewMetadata: {
        previewId: `behavior-preview:${conversationId}:${stateRevision}`,
        conversationId,
        stateRevision,
        assumptionDependencies: [],
        approvalEligibility: 'eligible',
        stale: false,
        authorizedUserId: 'user-1',
      },
    },
    createdAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:00:00Z',
  };
}

afterEach(() => clearWeeklyPlanningSessionRuntime());

describe('weeklyPlanningApproval current runtime', () => {
  it('rejects a preview whose revision is older than the current dialogue state', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-1',
      stateRevision: 6,
      proposalRecords: [],
    });
    const result = validateWeeklyPreviewApproval({
      blocks: [block('conversation-1', 5)],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.attempt.kind).toBe('stale_preview_approval_attempt');
  });

  it('rejects a preview from another current conversation', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-2',
      stateRevision: 5,
      proposalRecords: [],
    });
    const result = validateWeeklyPreviewApproval({
      blocks: [block('conversation-1', 5)],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.attempt.kind).toBe('stale_preview_approval_attempt');
  });

  it('requires a live session runtime for behavior-aware preview after reload', () => {
    const result = validateWeeklyPreviewApproval({
      blocks: [block()],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.attempt).toMatchObject({
        kind: 'invalid_preview_approval_attempt',
        reason: 'session-runtime-unavailable',
      });
    }
  });
});
