import { describe, expect, it } from 'vitest';
import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import type { WeeklyPlanDraftBlock } from '../types';
import { validateWeeklyPreviewApproval } from './weeklyPlanningApproval';

function proposal(
  status: AssumptionProposalRecord['status'],
  createdAtTurnId = 'turn-2',
): AssumptionProposalRecord {
  return {
    proposalId: 'proposal-accepted',
    conversationId: 'conversation-1',
    slot: 'duration',
    targetRef: 'task:0',
    proposedValue: 60,
    proposedUnit: 'minutes',
    reasonCode: 'missing_duration',
    sourceFactRefs: ['task:0'],
    createdAtTurnId,
    createdFromStateRevision: 2,
    status,
  };
}

function block(): WeeklyPlanDraftBlock {
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
      stateRevision: 5,
      sourceFactRefs: ['task:0'],
      usedAssumptionProposalRefs: ['proposal-accepted'],
      acceptedAssumptionDependencies: [{
        proposalId: 'proposal-accepted',
        targetRef: 'task:0',
        proposalCreatedFromStateRevision: 2,
      }],
      taskRef: 'task:0',
      opportunityTags: [],
      reasoningKey: 'accepted-assumption-duration',
      compatibility: {
        workItemSemantic: 'behavior_aware_task',
        schedulerInputSource: 'exam_prep_request',
        candidateSource: 'weekly_exam_prep',
      },
      previewMetadata: {
        previewId: 'preview-1',
        stateRevision: 5,
        assumptionDependencies: [{
          proposalId: 'proposal-accepted',
          targetRef: 'task:0',
          proposalCreatedFromStateRevision: 2,
        }],
        approvalEligibility: 'eligible',
        stale: false,
        authorizedUserId: 'user-1',
      },
    },
    createdAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:00:00Z',
  };
}

describe('weeklyPlanningApproval assumption dependency', () => {
  it('allows a current preview whose dependency is accepted', () => {
    expect(validateWeeklyPreviewApproval({
      blocks: [block()],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [proposal('accepted')],
    }).allowed).toBe(true);
  });

  it('allows the save-boundary compatibility record emitted from accepted preview metadata', () => {
    expect(validateWeeklyPreviewApproval({
      blocks: [block()],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [proposal('pending', 'preview-dependency')],
    }).allowed).toBe(true);
  });

  it('rejects an ordinary pending or superseded dependency', () => {
    const pending = validateWeeklyPreviewApproval({
      blocks: [block()],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [proposal('pending')],
    });
    expect(pending.allowed).toBe(false);
    if (!pending.allowed) expect(pending.attempt.kind).toBe('pending_assumption_preview_approval_attempt');

    const superseded = validateWeeklyPreviewApproval({
      blocks: [block()],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [proposal('superseded')],
    });
    expect(superseded.allowed).toBe(false);
    if (!superseded.allowed) expect(superseded.attempt.kind).toBe('invalid_preview_approval_attempt');
  });
});
