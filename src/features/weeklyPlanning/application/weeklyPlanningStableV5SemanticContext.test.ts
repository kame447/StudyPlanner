import { bindWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { numericFixture } from '../semantic/weeklyPlanningNumericPendingChoiceV5.testUtils';
import { numericPendingCompleteScopeV5 } from '../semantic/weeklyPlanningNumericPendingScopeV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../semantic/weeklyPlanningSemanticPublicStateV5';
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
      messages: [{ id: 'question:assistant', role: 'assistant', content: '表示済みの質問', createdAt: '2026-10-10T00:00:00Z' }],
      inputStateRevision: 8,
      previousState: bindWeeklyPlanningQuestionPresentation({ state: previousState,
        turnId: 'question', assistantMessageId: 'question:assistant', planningStateRevision: 8,
        graphRevision: graph.revision, content: { responseSource: 'ai', currentTurnGrounding: 'none',
          selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }),
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'proposal-1',
      questionCode: 'learning_strategy_proposal',
      intent: 'learning_strategy_proposal',
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
      messages: [{ id: 'question:assistant', role: 'assistant', content: '表示済みの質問', createdAt: '2026-10-10T00:00:00Z' }],
      inputStateRevision: 8,
      previousState: bindWeeklyPlanningQuestionPresentation({ state: previousState,
        turnId: 'question', assistantMessageId: 'question:assistant', planningStateRevision: 8,
        graphRevision: graph.revision, content: { responseSource: 'ai', currentTurnGrounding: 'none',
          selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }),
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'question-1',
      questionCode: 'missing_effort_estimate',
      intent: 'session_duration',
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
      messages: [{ id: 'question:assistant', role: 'assistant', content: '表示済みの質問', createdAt: '2026-10-10T00:00:00Z' }],
      inputStateRevision: 8,
      previousState: bindWeeklyPlanningQuestionPresentation({ state: previousState,
        turnId: 'question', assistantMessageId: 'question:assistant', planningStateRevision: 8,
        graphRevision: graph.revision, content: { responseSource: 'ai', currentTurnGrounding: 'none',
          selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }),
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: null,
      questionCode: 'missing_effort_estimate',
      intent: 'total_duration',
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
      messages: [{ id: 'turn-presentation-sentinel:assistant', role: 'assistant', content: '表示済みの質問', createdAt: '2026-10-10T00:00:00Z' }],
      inputStateRevision: 8,
      previousState: bound,
    });

    // Application-owned freshness gates pendingQuestion; private binding IDs stay excluded.
    expect(boundSummary.pendingQuestion).not.toBeNull();
    expect(createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState: unbound,
    }).pendingQuestion).toBeNull();
    expect(JSON.stringify(boundSummary)).not.toContain('turn-presentation-sentinel');
  });
});

describe('Stable V5 semantic public-state component ancestry', () => {
  function nestedComponentFixture() {
    const h = numericFixture();
    h.graph.components.push(
      { id: 'component-0', taskId: 'task-1', parentComponentId: null, role: 'material', label: '山地の教材',
        source: h.graph.tasks[0].source, createdRevision: 2 },
      { id: 'component-1', taskId: 'task-1', parentComponentId: 'component-0', role: 'chapter', label: '章1',
        source: h.graph.tasks[0].source, createdRevision: 2 },
    );
    Object.assign(h.graph.workloads[0], { componentId: 'component-1' });
    h.graph.factLifecycles.push(...h.graph.components.map((fact) => ({ factId: fact.id, status: 'active' as const,
      createdRevision: 2, terminalRevision: null, supersededByFactId: null })));
    return h;
  }

  it('projects component ancestry exactly as the semantic public state does', () => {
    const h = nestedComponentFixture();
    const application = createStableV5SemanticPublicStateSummary({ graph: h.graph, messages: [] });
    const semantic = createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion: null }, h.graph);

    expect(application.components).toEqual(semantic.components);
    expect(application.components).toEqual([
      expect.objectContaining({ publicId: 'component-0', parentComponentPublicId: null }),
      expect.objectContaining({ publicId: 'component-1', parentComponentPublicId: 'component-0' }),
    ]);
  });

  it('lets the answer-stage D5 scope accept a component-linked workload from the application projection', () => {
    const h = nestedComponentFixture();
    const application = createStableV5SemanticPublicStateSummary({ graph: h.graph, messages: [] });
    h.input.publicStateSummary = {
      ...createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion: h.input.publicStateSummary!.pendingQuestion }, h.graph),
      components: application.components,
    };

    expect(numericPendingCompleteScopeV5(h.input)?.componentChain).toEqual([
      expect.objectContaining({ id: 'component-0', role: 'material' }),
      expect.objectContaining({ id: 'component-1', role: 'chapter' }),
    ]);
  });
});
