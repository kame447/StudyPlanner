import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningEffortMeasurementV5 } from './weeklyPlanningPendingQuestionV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  applyWeeklyPlanningStableV5ContextualAnswer,
} from './weeklyPlanningStableV5ContextualAnswer';

const factSource = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '問題集を10ページ進める',
  origin: 'user' as const,
};

function graph(params: {
  quantityRole: 'target' | 'declared';
  workloadCount?: number;
}): WeeklyPlanningFactGraphV5 {
  const workloadCount = params.workloadCount ?? 1;
  const tasks: WeeklyPlanningFactGraphV5['tasks'] = Array.from(
    { length: workloadCount },
    (_, index) => ({
      id: `task-${index + 1}`,
      category: 'study' as const,
      title: `問題集${index + 1}`,
      source: {
        ...factSource,
        semanticLocalId: `source-${index + 1}`,
        sourceText: `問題集${index + 1}を${(index + 1) * 10}ページ進める`,
      },
      createdRevision: 1,
    }),
  );
  const workloads: WeeklyPlanningFactGraphV5['workloads'] = tasks.map((task, index) => ({
    id: `workload-${index + 1}`,
    taskId: task.id,
    componentId: null,
    quantityRole: params.quantityRole,
    amount: (index + 1) * 10,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: task.source,
    createdRevision: 1,
  }));
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks,
    workloads,
    factLifecycles: [...tasks, ...workloads].map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function answerDocument(params: {
  minutes?: number;
  quantityRole?: 'target';
  includeAdditionalTask?: boolean;
}): WeeklyPlanningSemanticDocumentV5 {
  const tasks: WeeklyPlanningSemanticDocumentV5['tasks'] = [{
    localId: 'answer-task',
    category: 'study',
    title: '直前の質問対象',
    study: null,
    workloads: params.quantityRole
      ? [{
          localId: 'answer-workload',
          quantityRole: params.quantityRole,
          amount: 10,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText: '今回進めたい量です',
        }]
      : [],
    effortEstimates: params.minutes
      ? [{
          localId: 'answer-effort',
          targetLocalId: 'answer-task',
          kind: 'total_duration',
          minutes: params.minutes,
          unitCode: null,
          precision: 'exact',
          sourceText: '3時間です',
        }]
      : [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: params.minutes ? '3時間です' : '今回進めたい量です',
  }];
  if (params.includeAdditionalTask) {
    tasks.push({
      localId: 'additional-task',
      category: 'study',
      title: '数学',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学も追加する',
    });
  }
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function pendingQuestion(params: {
  code: 'missing_effort_estimate' | 'quantity_role_unresolved';
  targetFactId?: string | null;
  graphRevision?: number;
  effortMeasurement?: WeeklyPlanningEffortMeasurementV5 | null;
}) {
  return {
    actionId: 'stable-v5:question-1',
    questionCode: params.code,
    targetFactId: params.targetFactId === undefined ? 'workload-1' : params.targetFactId,
    graphRevision: params.graphRevision ?? 1,
    ...(params.code === 'missing_effort_estimate'
      ? { effortMeasurement: params.effortMeasurement === undefined
          ? 'duration_per_unit' as const
          : params.effortMeasurement }
      : {}),
  };
}

const multipleTargetCase = fc.integer({ min: 2, max: 8 }).chain((workloadCount) =>
  fc.record({
    workloadCount: fc.constant(workloadCount),
    targetIndex: fc.integer({ min: 0, max: workloadCount - 1 }),
  }));

describe('Stable V5 contextual answers', () => {
  it('binds an AI duration answer using the exact typed pending-question measurement and target', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph({ quantityRole: 'target' }),
      document: answerDocument({ minutes: 180 }),
      pendingQuestion: pendingQuestion({ code: 'missing_effort_estimate' }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: 'any wording is observational only',
    });

    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        targetFactId: 'workload-1',
        kind: 'duration_per_unit',
        unitCode: 'page',
        minutes: 180,
      }),
    ]);
  });

  it('supersedes the exact unresolved workload for an AI quantity-role answer', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph({ quantityRole: 'declared' }),
      document: answerDocument({ quantityRole: 'target' }),
      pendingQuestion: pendingQuestion({ code: 'quantity_role_unresolved' }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: 'wording is not parsed',
    });

    const workloads = result?.graph.workloads ?? [];
    expect(workloads[workloads.length - 1]).toMatchObject({
      taskId: 'task-1',
      quantityRole: 'target',
      amount: 10,
    });
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-1', status: 'superseded' }),
    ]));
  });

  it('updates only the machine-selected workload for any unresolved-set size', () => {
    fc.assert(fc.property(multipleTargetCase, ({ workloadCount, targetIndex }) => {
      const initialGraph = graph({ quantityRole: 'declared', workloadCount });
      const target = initialGraph.workloads[targetIndex];
      const result = applyWeeklyPlanningStableV5ContextualAnswer({
        graph: initialGraph,
        document: answerDocument({ quantityRole: 'target' }),
        pendingQuestion: pendingQuestion({
          code: 'quantity_role_unresolved',
          targetFactId: target.id,
        }),
        conversationId: 'conversation-1',
        turnId: 'turn-2',
        expectedRevision: 1,
        userText: 'not interpreted',
      });
      if (!result) throw new Error('valid machine-selected answer was rejected');

      expect(result.graph.revision).toBe(initialGraph.revision + 1);
      expect(result.diff?.superseded).toEqual([{ kind: 'workload', id: target.id }]);
      expect(result.graph.workloads[result.graph.workloads.length - 1]).toMatchObject({
        taskId: target.taskId,
        amount: target.amount,
        unitCode: target.unitCode,
        quantityRole: 'target',
      });

      const lifecycleById = new Map(
        result.graph.factLifecycles.map((entry) => [entry.factId, entry]),
      );
      for (const workload of initialGraph.workloads) {
        expect(lifecycleById.get(workload.id)?.status).toBe(
          workload.id === target.id ? 'superseded' : 'active',
        );
      }
    }), { numRuns: 100 });
  });

  it('returns null for stale, missing, non-minimal, or incomplete machine question contracts', () => {
    const base = {
      graph: graph({ quantityRole: 'target' }),
      document: answerDocument({ minutes: 180 }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: 'not interpreted',
    };

    const nonContextualInputs = [
      {
        ...base,
        pendingQuestion: pendingQuestion({
          code: 'missing_effort_estimate',
          graphRevision: 0,
        }),
      },
      {
        ...base,
        pendingQuestion: pendingQuestion({
          code: 'missing_effort_estimate',
          targetFactId: null,
        }),
      },
      {
        ...base,
        pendingQuestion: pendingQuestion({ code: 'missing_effort_estimate' }),
        document: answerDocument({ minutes: 180, includeAdditionalTask: true }),
      },
      {
        ...base,
        pendingQuestion: pendingQuestion({
          code: 'missing_effort_estimate',
          effortMeasurement: null,
        }),
      },
    ];

    for (const invalidInput of nonContextualInputs) {
      expect(applyWeeklyPlanningStableV5ContextualAnswer(invalidInput)).toBeNull();
    }
  });

  it('rejects a contextual reply whose machine-selected target no longer exists', () => {
    const initialGraph = graph({ quantityRole: 'target' });
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initialGraph,
      document: answerDocument({ minutes: 180 }),
      pendingQuestion: pendingQuestion({
        code: 'missing_effort_estimate',
        targetFactId: 'unknown-workload',
      }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: 'not interpreted',
    });

    expect(result).toEqual({
      status: 'rejected',
      graph: initialGraph,
      diff: null,
      errors: [
        'contextual-answer-target-unavailable:missing_effort_estimate:unknown-workload',
      ],
      localToFactId: {},
    });
  });
});
