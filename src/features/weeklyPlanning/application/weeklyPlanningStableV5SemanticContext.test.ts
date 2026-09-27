import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  createStableV5SemanticPublicStateSummary,
  stableV5RequestContextForInput,
} from './weeklyPlanningStableV5SemanticContext';

function baseState(): PlanningIntakeState {
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
    draftGenerationIntent: 'user_authorized',
    sourceTurns: [],
  };
}

describe('Stable V5 request context authority', () => {
  it('uses the captured request context without regenerating temporal defaults', () => {
    const requestContext = {
      startedAtIso: '2026-08-30T12:34:56.000Z',
      timeZone: 'America/Los_Angeles',
      currentDate: '2026-08-30',
      currentTime: '05:34',
      notBeforeDate: '2026-08-30',
      notBeforeTime: '05:35',
      weekStartsOn: 'sunday' as const,
    };

    const resolved = stableV5RequestContextForInput({
      messages: [],
      userText: 'next week',
      selectedDate: '2030-01-01',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-1',
      traceRequestId: 'request-1',
      requestContext,
    });

    expect(resolved).toEqual({
      context: requestContext,
      source: 'captured_request',
    });
    expect(resolved.context).toBe(requestContext);
  });
});

describe('Stable V5 semantic public-state question binding', () => {
  it('publishes an options proposal as the exact machine pending question', () => {
    const previousState: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'options',
        targetSlot: 'stable_v5:learning_strategy_proposal',
        intent: 'learning_strategy_proposal',
        topicId: 'workload-1',
        actionId: 'proposal-1',
      },
      learningStrategyProposalRecords: [{
        id: 'proposal-1',
        kind: 'spaced_memory_practice',
        taskId: 'task-1',
        workloadFactId: 'workload-1',
        scope: 'week',
        status: 'pending',
        suggestedSessionMinutes: { min: 15, max: 30 },
        selectedSessionMinutes: null,
        createdRevision: 2,
        proposedAtTurnId: 'turn-1',
        decidedAtTurnId: null,
      }],
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 2,
    };

    const summary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState,
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'proposal-1',
      questionCode: 'learning_strategy_proposal',
      targetFactId: 'workload-1',
      graphRevision: 2,
      effortMeasurement: null,
      estimateForWorkloadFactId: null,
      questionBasis: null,
    });
    expect(summary.learningStrategyProposals).toEqual([
      expect.objectContaining({
        publicId: 'proposal-1',
        workloadPublicId: 'workload-1',
        status: 'pending',
      }),
    ]);
  });

  it('keeps typed effort measurement on a normal machine question', () => {
    const previousState: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'missing',
        targetSlot: 'stable_v5:missing_effort_estimate',
        intent: 'session_duration',
        topicId: 'workload-1',
        actionId: 'question-1',
      },
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 4,
    };

    const summary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState,
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'question-1',
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-1',
      graphRevision: 4,
      effortMeasurement: 'session_duration',
      estimateForWorkloadFactId: null,
      questionBasis: null,
    });
  });

  it('preserves the schedulable estimate target separately from completed-work evidence', () => {
    const previousState: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'missing',
        targetSlot: 'stable_v5:missing_effort_estimate',
        intent: 'total_duration',
        topicId: 'workload-completed-70',
        estimateForWorkloadFactId: 'workload-remaining-30',
        questionBasis: 'completed_workload_total',
      },
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 5,
    };

    const summary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState,
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: null,
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-completed-70',
      graphRevision: 5,
      effortMeasurement: 'total_duration',
      estimateForWorkloadFactId: 'workload-remaining-30',
      questionBasis: 'completed_workload_total',
    });
  });
});

describe('Stable V5 semantic public-state question presentation exclusion', () => {
  it('keeps the presentation binding out of the semantic model input', () => {
    const unbound: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'options',
        targetSlot: 'stable_v5:learning_strategy_proposal',
        intent: 'learning_strategy_proposal',
        topicId: 'workload-1',
        actionId: 'proposal-1',
      },
    };
    const bound: PlanningIntakeState = {
      ...unbound,
      lastQuestionContext: {
        ...unbound.lastQuestionContext!,
        presentation: {
          version: 1,
          turnId: 'turn-presentation-sentinel',
          assistantMessageId: 'turn-presentation-sentinel:assistant',
          planningStateRevision: 8,
          graphRevision: 2,
          content: {
            responseSource: 'ai',
            currentTurnGrounding: 'none',
            selfRepairNotice: false,
          groundingContext: { proposed: 0, contested: 0 },
          previewPromotionControl: false,},
        },
      },
    };
    const graph = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2 };

    const boundSummary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState: bound,
    });

    // The binding is application-owned freshness evidence; semantic interpretation is unchanged.
    expect(boundSummary).toEqual(createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState: unbound,
    }));
    expect(JSON.stringify(boundSummary)).not.toContain('turn-presentation-sentinel');
  });
});
