import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { continueWeeklyPlanningStableV5RuntimeTurnCore } from '../application/weeklyPlanningStableV5RuntimeExecutorCore';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  applyWeeklyPlanningStableV5ContextualAnswer,
} from './weeklyPlanningStableV5ContextualAnswer';

const source = {
  conversationId: 'conversation-measurement',
  turnId: 'turn-1',
  semanticLocalId: 'source',
  sourceText: '英単語180語を進める',
  origin: 'user' as const,
};

function graphWithExistingEffort(
  existingKind: 'duration_per_unit' | 'session_duration',
): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    appliedTurnKeys: ['conversation-measurement:turn-1'],
    tasks: [{
      id: 'task-english',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-english',
      taskId: 'task-english',
      componentId: null,
      quantityRole: 'target',
      amount: 180,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'effort-existing',
      taskId: 'task-english',
      targetFactId: 'workload-english',
      kind: existingKind,
      minutes: existingKind === 'duration_per_unit' ? 5 : 20,
      unitCode: 'word',
      precision: 'approximate',
      source,
      createdRevision: 2,
    }],
    factLifecycles: [
      'task-english',
      'workload-english',
      'effort-existing',
    ].map((factId) => ({
      factId,
      status: 'active' as const,
      createdRevision: factId === 'effort-existing' ? 2 : 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function durationAnswerDocument(minutes: number): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: [],
      effortEstimates: [{
        localId: 'answer-effort',
        targetLocalId: 'answer-task',
        kind: 'session_duration',
        minutes,
        unitCode: 'word',
        precision: 'approximate',
        sourceText: '1回25分くらいです',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '1回25分くらいです',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function sessionDurationQuestion() {
  return {
    actionId: 'stable-v5:question-session-duration',
    questionCode: 'missing_effort_estimate' as const,
    targetFactId: 'workload-english',
    graphRevision: 2,
    effortMeasurement: 'session_duration' as const,
  };
}

describe('Stable V5 contextual effort measurement binding', () => {
  it('accepts a requested session duration when a different per-unit effort already exists', () => {
    const initialGraph = graphWithExistingEffort('duration_per_unit');
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initialGraph,
      document: durationAnswerDocument(25),
      pendingQuestion: sessionDurationQuestion(),
      conversationId: 'conversation-measurement',
      turnId: 'turn-3',
      expectedRevision: 2,
      userText: '1回25分くらいです',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'effort-existing',
        kind: 'duration_per_unit',
        minutes: 5,
        targetFactId: 'workload-english',
      }),
      expect.objectContaining({
        kind: 'session_duration',
        minutes: 25,
        targetFactId: 'workload-english',
      }),
    ]));
  });

  it.each(['generic', 'focused'] as const)('preserves typed total duration under per-unit question (%s)', shape => {
    const graph = graphWithExistingEffort('duration_per_unit');
    graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(f => f.factId !== 'effort-existing');
    const document = durationAnswerDocument(60);
    const task = document.tasks[0];
    task.effortEstimates[0] = { ...task.effortEstimates[0], kind: 'total_duration', unitCode: null,
      precision: 'approximate', sourceText: '全部で60分くらい' };
    if (shape === 'focused') {
      task.existingPublicId = 'task-english';
      task.effortEstimates[0].targetLocalId = 'workload-english';
      task.title = '英単語';
      task.study = { purpose: 'unknown', contextLabel: null, components: [] };
      task.workloads = [{ localId: 'workload-english', quantityRole: 'target', amount: 180, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '全部で60分くらい' }];
    }
    const contextual = applyWeeklyPlanningStableV5ContextualAnswer({ graph, document,
      pendingQuestion: { ...sessionDurationQuestion(), effortMeasurement: 'duration_per_unit' },
      conversationId: 'conversation-measurement', turnId: 'turn-3', expectedRevision: 2,
      userText: '全部で60分くらい' });
    const result = contextual ?? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document, context: { conversationId: 'conversation-measurement', turnId: 'turn-3', expectedRevision: 2 } });
    expect(result?.status, JSON.stringify(result?.errors)).toBe('applied');
    expect(result?.graph.effortEstimates).toMatchObject(shape === 'generic' ? [] : [{ kind: 'total_duration', unitCode: null, minutes: 60, precision: 'approximate' }]);
  });

  it.each([
    ['duration_per_unit', 'word', true], ['duration_per_unit', null, false], ['total_duration', null, false],
  ] as const)('generic ellipsis respects typed measurement/unit (%s/%s)', (kind, unitCode, accepts) => {
    const graph = graphWithExistingEffort('duration_per_unit');
    graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(f => f.factId !== 'effort-existing');
    const document = durationAnswerDocument(5);
    Object.assign(document.tasks[0].effortEstimates[0], { kind, unitCode, sourceText: '5分' });
    const result = applyWeeklyPlanningStableV5ContextualAnswer({ graph, document,
      pendingQuestion: { ...sessionDurationQuestion(), effortMeasurement: 'duration_per_unit' },
      conversationId: 'conversation-measurement', turnId: 'turn-3', expectedRevision: 2, userText: '5分' });
    expect(result?.status).toBe('applied');
    expect(result?.graph.effortEstimates).toHaveLength(accepts ? 1 : 0);
    expect(result?.graph.workloads).toEqual(graph.workloads);
  });

  it('keeps the user-facing pending effort question after an incompatible generic measurement', async () => {
    const graph = graphWithExistingEffort('duration_per_unit'); graph.effortEstimates = [];
    graph.factLifecycles = graph.factLifecycles.filter(f => f.factId !== 'effort-existing');
    graph.planningWindows = [{ id: 'window', kind: 'absolute', value: '2026-08-20/2026-08-26', start: '2026-08-20', end: '2026-08-26', source, createdRevision: 1 }];
    graph.factLifecycles.push({ factId: 'window', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const document = durationAnswerDocument(5); Object.assign(document.tasks[0].effortEstimates[0], { kind: 'total_duration', unitCode: null });
    const pendingQuestion = { ...sessionDurationQuestion(), effortMeasurement: 'duration_per_unit' as const };
    const semantic = await createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document, diagnostics: {
      schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
      attemptCount: 1, repairAttempted: false, requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null,
    } }) }).run({ graph, conversationId: 'conversation-measurement', turnId: 'turn-3', expectedRevision: 2, userText: '5分',
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion }, graph),
      schedulerContext: { ownerId: 'owner', currentDate: '2026-08-19', planningStartDate: '2026-08-20', planningEndDate: '2026-08-26', timeZone: 'Asia/Tokyo' } });
    const requestContext = { startedAtIso: '2026-08-19T01:00:00Z', timeZone: 'Asia/Tokyo', currentDate: '2026-08-19', currentTime: '10:00',
      notBeforeDate: '2026-08-19', notBeforeTime: '10:00', weekStartsOn: 'monday' as const };
    const output = continueWeeklyPlanningStableV5RuntimeTurnCore({ userId: 'owner', selectedDate: '2026-08-19', conversationId: 'conversation-measurement', traceRequestId: 'turn-3',
      userText: '5分', messages: [], plans: [], scheduleTemplates: [], requestContext }, { status: 'success', requestContext,
      pendingQuestionPresentation: { status: 'unbound' },
      runtimeSession: { ownerId: 'owner', conversationId: 'conversation-measurement', weekStartDate: '2026-08-17', graph, updatedAt: 0 }, semantic }, { stageTurn() {} });
    expect(output.failure).toBeUndefined();
    expect(output.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(output.state.questions.length).toBe(1);
    expect(output.message).not.toMatch(/エラー|失敗|更新できません/);
    expect(semantic.graph.effortEstimates).toEqual([]);
    expect(semantic.graph.workloads).toEqual(graph.workloads);
  });

  it('still rejects the pending target when the same requested measurement is already active', () => {
    const initialGraph = graphWithExistingEffort('session_duration');
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initialGraph,
      document: durationAnswerDocument(25),
      pendingQuestion: sessionDurationQuestion(),
      conversationId: 'conversation-measurement',
      turnId: 'turn-3',
      expectedRevision: 2,
      userText: '1回25分くらいです',
    });

    expect(result).toEqual({
      status: 'rejected',
      graph: initialGraph,
      diff: null,
      errors: [
        'contextual-answer-target-unavailable:missing_effort_estimate:workload-english',
      ],
      localToFactId: {},
    });
  });
});
