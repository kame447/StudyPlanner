import { describe, expect, it } from 'vitest';
import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import type { WeeklyPlanDraftBlock } from '../types';
import {
  createWeeklyDraftApprovalOperation,
  executeWeeklyDraftApproval,
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
  validateWeeklyPreviewApproval,
} from './weeklyPlanningApproval';
import type { WeeklyPreviewMetadata } from './weeklyPlanningApprovalTypes';

const metadata: WeeklyPreviewMetadata = {
  previewId: 'preview-1',
  stateRevision: 5,
  assumptionDependencies: [],
  approvalEligibility: 'eligible',
  stale: false,
  authorizedUserId: 'user-1',
};

function block(id: string, previewMetadata = metadata): WeeklyPlanDraftBlock {
  return {
    id,
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
      usedAssumptionProposalRefs: [],
      taskRef: 'task:0',
      opportunityTags: [],
      reasoningKey: 'explicit-duration',
      compatibility: {
        workItemSemantic: 'behavior_aware_task',
        schedulerInputSource: 'exam_prep_request',
        candidateSource: 'weekly_exam_prep',
      },
      previewMetadata,
    },
    createdAt: '2026-07-14T10:00:00Z',
    updatedAt: '2026-07-14T10:00:00Z',
  };
}

function proposal(status: AssumptionProposalRecord['status']): AssumptionProposalRecord {
  return {
    proposalId: 'proposal-1',
    conversationId: 'conversation-1',
    slot: 'duration',
    targetRef: 'task:0',
    proposedValue: 60,
    proposedUnit: 'minutes',
    reasonCode: 'missing_duration',
    sourceFactRefs: ['task:0'],
    createdAtTurnId: 'turn-1',
    createdFromStateRevision: 4,
    status,
  };
}

describe('weeklyPlanningApproval', () => {
  it('rejects stale preview before starting a ledger', () => {
    const result = validateWeeklyPreviewApproval({
      blocks: [block('block-1')],
      currentStateRevision: 6,
      userId: 'user-1',
      proposalRecords: [],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.attempt.kind).toBe('stale_preview_approval_attempt');
  });

  it('rejects current preview with pending assumption separately from stale', () => {
    const pendingMetadata: WeeklyPreviewMetadata = {
      ...metadata,
      assumptionDependencies: [{
        proposalId: 'proposal-1',
        targetRef: 'task:0',
        proposalCreatedFromStateRevision: 4,
      }],
      approvalEligibility: 'blocked_pending_assumption',
    };
    const result = validateWeeklyPreviewApproval({
      blocks: [block('block-1', pendingMetadata)],
      currentStateRevision: 5,
      userId: 'user-1',
      proposalRecords: [proposal('pending')],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.attempt.kind).toBe('pending_assumption_preview_approval_attempt');
    }
  });

  it('saves items independently and skips duplicates on retry', async () => {
    const operation = createWeeklyDraftApprovalOperation({
      userId: 'user-1',
      metadata,
      blocks: [block('block-1'), block('block-2')],
      now: '2026-07-14T10:00:00Z',
    });
    const saved: string[] = [];
    const result = await executeWeeklyDraftApproval({
      operation,
      blocks: [block('block-1'), block('block-2')],
      dependencies: {
        async findExistingPlanId({ sourceDraftBlockId }) {
          return sourceDraftBlockId === 'block-1' ? 'plan-existing' : undefined;
        },
        async saveBlock({ block: target }) {
          saved.push(target.id);
          return { planId: `plan-${target.id}` };
        },
        now: () => '2026-07-14T10:01:00Z',
      },
    });

    expect(result.status).toBe('completed');
    expect(result.items.map((item) => item.status)).toEqual(['skipped_duplicate', 'saved']);
    expect(saved).toEqual(['block-2']);
  });

  it('safe-discards corrupt or oversized ledger data', () => {
    expect(parseWeeklyApprovalLedger('{broken')).toBeNull();
    expect(parseWeeklyApprovalLedger('x'.repeat(1_000_001))).toBeNull();

    const operation = createWeeklyDraftApprovalOperation({
      userId: 'user-1',
      metadata,
      blocks: [block('block-1')],
      now: '2026-07-14T10:00:00Z',
    });
    expect(parseWeeklyApprovalLedger(serializeWeeklyApprovalLedger([operation]))?.operations).toHaveLength(1);
  });
});
