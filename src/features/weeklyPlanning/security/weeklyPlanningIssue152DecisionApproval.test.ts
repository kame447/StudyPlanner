import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState, WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningDecisionTargetReferencesV5 } from '../semantic/weeklyPlanningDecisionReferenceValidationV5';
import { evaluateWeeklyPlanningLearningStrategyProposalsV5 } from '../application/weeklyPlanningStableV5LearningStrategyProposal';
import { validateWeeklyPreviewApproval } from '../planning/weeklyPlanningApproval';
import type { WeeklyPlanDraftBlock } from '../types';

function proposal(id: string, workloadFactId: string): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    id,
    kind: 'spaced_memory_practice',
    taskId: `task-${id}`,
    workloadFactId,
    scope: 'week',
    status: 'pending',
    suggestedSessionMinutes: { min: 15, max: 30 },
    selectedSessionMinutes: null,
    createdRevision: 1,
    proposedAtTurnId: 'turn-1',
    decidedAtTurnId: null,
  };
}

function intakeState(records: WeeklyPlanningLearningStrategyProposalRecord[]): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    learningStrategyProposalRecords: records,
    sourceTurns: [],
  };
}

function compilation(): GenericSchedulerInputCompilationResult {
  return {
    status: 'needs_resolution',
    input: null,
    issues: [],
  };
}

function decisionDocument(ids: string[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: ids.map((id, index) => ({
      localId: `decision-${index}`,
      target: { kind: 'proposal', publicId: id, localId: null, mention: null },
      decision: 'accept',
      sourceText: 'この2つの提案をお願いします',
    })),
  };
}

describe('Issue #152 V09 proposal decision application boundary', () => {
  it.fails('does not apply every accepted proposal when the document contains two pending decisions', () => {
    // Issue #152 V09 reproduced: application mutates every pending proposal referenced by a schema-valid document.
    const previous = [proposal('proposal-a', 'work-a'), proposal('proposal-b', 'work-b')];
    const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: intakeState(previous),
      document: decisionDocument(['proposal-a', 'proposal-b']),
      localToFactId: {},
      compilation: compilation(),
      graphRevision: 2,
      turnId: 'turn-2',
    });
    expect(result.records.filter((record) => record.status === 'accepted')).toHaveLength(1);
  });

  it.fails('requires proposal decisions to match the currently asked question target', () => {
    // Issue #152 V09 reproduced: reference validation checks active identity but does not bind a proposal decision to lastQuestionContext.
    const document = decisionDocument(['proposal-a']);
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, {
      learningStrategyProposals: [{ publicId: 'proposal-a' }],
      pendingQuestion: { actionId: 'different-question', topicId: 'work-other' },
    })).not.toEqual([]);
  });

  it('accepts explicit collective consent as a valid decision document', () => {
    const document = decisionDocument(['proposal-a', 'proposal-b']);
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, {
      learningStrategyProposals: [{ publicId: 'proposal-a' }, { publicId: 'proposal-b' }],
    })).toEqual([]);
  });
});

function legacyDraftBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-152',
    date: '2026-09-11',
    startTime: '18:00',
    endTime: '19:00',
    title: '数学',
    subject: '数学',
    type: 'study',
    label: '数学',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
  };
}

describe('Issue #152 V10 approval freshness boundary', () => {
  it.fails('does not approve metadata-free draft blocks without freshness metadata', () => {
    // Issue #152 V10 reproduced: metadata-free legacy drafts synthesize current revision and bypass conversation freshness.
    const result = validateWeeklyPreviewApproval({
      blocks: [legacyDraftBlock('legacy-1')],
      currentStateRevision: 99,
      userId: 'user-152',
      proposalRecords: [],
      runtimeSnapshot: null,
    });
    expect(result.allowed).toBe(false);
  });

  it('rejects cross-owner, stale-revision, and pending-assumption previews', () => {
    const metadata = {
      previewId: 'preview-152',
      stateRevision: 4,
      assumptionDependencies: [],
      approvalEligibility: 'eligible' as const,
      stale: false,
      authorizedUserId: 'user-152',
      conversationId: 'conversation-152',
    };
    const block: WeeklyPlanDraftBlock = {
      ...legacyDraftBlock('draft-1'),
      behaviorMetadata: {
        stateRevision: 4,
        sourceFactRefs: [],
        usedAssumptionProposalRefs: [],
        taskRef: 'task-1',
        opportunityTags: [],
        reasoningKey: 'explicit-duration',
        compatibility: {
          workItemSemantic: 'behavior_aware_task',
          schedulerInputSource: 'exam_prep_request',
          candidateSource: 'weekly_exam_prep',
        },
        previewMetadata: metadata,
      },
    };
    expect(validateWeeklyPreviewApproval({
      blocks: [{ ...block, userId: 'other-owner' }],
      currentStateRevision: 4,
      userId: 'user-152',
      proposalRecords: [],
      runtimeSnapshot: { conversationId: 'conversation-152', stateRevision: 4, proposalRecords: [] },
    }).allowed).toBe(false);
    expect(validateWeeklyPreviewApproval({
      blocks: [block],
      currentStateRevision: 5,
      userId: 'user-152',
      proposalRecords: [],
      runtimeSnapshot: { conversationId: 'conversation-152', stateRevision: 5, proposalRecords: [] },
    }).allowed).toBe(false);
  });
});
