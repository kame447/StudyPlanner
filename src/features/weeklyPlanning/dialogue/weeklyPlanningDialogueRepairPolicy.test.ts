import { describe, expect, it } from 'vitest';
import type { PlanningHypothesisSnapshot } from '../planning/weeklyPlanningBehaviorTypes';
import {
  decideDialogueRepairPolicy,
  deriveGroundedAcknowledgementSummaries,
  renderGroundedAcknowledgement,
} from './weeklyPlanningDialogueRepairPolicy';

function snapshot(
  overrides: Partial<PlanningHypothesisSnapshot> = {},
): PlanningHypothesisSnapshot {
  return {
    conversationId: 'conversation-1',
    stateRevision: 3,
    taskProfiles: [],
    lifeActivityAnchors: [],
    opportunityAnnotations: [],
    resolutionOpportunities: [],
    readiness: {
      stage: 'hypothesis_ready',
      resolvedDimensions: ['planning_intent'],
      unresolvedDimensions: ['task_identity'],
      blockingDimensions: ['task_identity'],
      resolvedCount: 1,
      policyId: 'non_exam_weekly_plan',
      draftGenerationIntent: 'not_requested',
      allowedAssumptionSlots: ['tasks_or_goals'],
      stateRevision: 3,
    },
    suggestedNextAction: 'ask_required_fact',
    ...overrides,
  };
}

describe('weekly planning dialogue repair policy', () => {
  it('uses explicit repair for a blocking uncertainty', () => {
    const value = snapshot({
      resolutionOpportunities: [{
        topicId: 'task-identity',
        dimension: 'task_identity',
        mode: 'must_confirm',
        impact: 'high',
        uncertainty: 'high',
        allowedOptionIds: [],
        sourceFactRefs: [],
      }],
    });

    expect(decideDialogueRepairPolicy({ snapshot: value })).toMatchObject({
      mode: 'explicit_repair',
      targetTopicId: 'task-identity',
      repairForm: 'direct_question',
      reason: 'blocking_uncertainty',
    });
  });

  it('uses proposal confirmation rather than a free question when a safe proposal exists', () => {
    const value = snapshot({
      readiness: {
        ...snapshot().readiness,
        unresolvedDimensions: ['workload'],
        blockingDimensions: ['workload'],
      },
      resolutionOpportunities: [{
        topicId: 'workload-estimate',
        dimension: 'workload',
        mode: 'propose_default',
        impact: 'medium',
        uncertainty: 'medium',
        proposalSlot: 'unit_duration_estimate',
        allowedOptionIds: ['short-trial'],
        sourceFactRefs: [],
      }],
    });

    expect(decideDialogueRepairPolicy({ snapshot: value })).toMatchObject({
      mode: 'explicit_repair',
      targetTopicId: 'workload-estimate',
      repairForm: 'proposal_confirmation',
    });
  });

  it('passes over non-blocking uncertainty instead of asking every time', () => {
    const value = snapshot({
      readiness: {
        ...snapshot().readiness,
        stage: 'proposal_ready',
        unresolvedDimensions: ['deadline'],
        blockingDimensions: [],
        draftGenerationIntent: 'assistant_suggested',
      },
      resolutionOpportunities: [{
        topicId: 'deadline',
        dimension: 'deadline',
        mode: 'must_confirm',
        impact: 'high',
        uncertainty: 'high',
        allowedOptionIds: [],
        sourceFactRefs: [],
      }],
      suggestedNextAction: 'suggest_draft_generation',
    });

    expect(decideDialogueRepairPolicy({ snapshot: value })).toEqual({
      mode: 'pass_over',
      deferredTopicIds: ['deadline'],
      reason: 'non_blocking_uncertainty',
    });
  });

  it('always treats a user clarification request as explicit repair', () => {
    const value = snapshot({
      readiness: {
        ...snapshot().readiness,
        blockingDimensions: [],
        unresolvedDimensions: [],
      },
    });

    expect(decideDialogueRepairPolicy({
      snapshot: value,
      clarificationTopicId: 'planning-range',
    })).toMatchObject({
      mode: 'explicit_repair',
      targetTopicId: 'planning-range',
      repairForm: 'clarification',
      reason: 'clarification_requested',
    });
  });

  it('repeats only facts grounded in the latest user turn', () => {
    const summaries = deriveGroundedAcknowledgementSummaries({
      acceptedFacts: {
        taskLabels: ['英語ワーク', '数学'],
        planningPeriodLabel: '来週',
        constraintSummary: ['meal 19:00 20:00'],
      },
      recentConversation: [
        { role: 'assistant', content: '何を進めますか？' },
        { role: 'user', content: '来週、英語ワークを進めたい。夕食は19時です。' },
      ],
    });

    expect(summaries).toEqual([
      '計画期間は来週',
      '学習内容は「英語ワーク」',
      '食事 19:00〜20:00',
    ]);
    expect(renderGroundedAcknowledgement(summaries)).toBe(
      '計画期間は来週、学習内容は「英語ワーク」、食事 19:00〜20:00として受け取りました。',
    );
  });
});
