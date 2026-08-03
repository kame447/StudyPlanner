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

function graph(): WeeklyPlanningFactGraphV5 {
  const task = {
    id: 'task-english',
    category: 'study' as const,
    title: '英語',
    source: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'task-1',
      sourceText: '英語40問',
      origin: 'user' as const,
    },
    createdRevision: 1,
  };
  const workload = {
    id: 'workload-english',
    taskId: task.id,
    componentId: null,
    quantityRole: 'target' as const,
    amount: 40,
    unitCode: 'problem' as const,
    unitLabel: '問',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: task.source,
    createdRevision: 1,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [task],
    workloads: [workload],
    factLifecycles: [task, workload].map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function durationDocument(minutes: number): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'reply-task',
      category: 'study',
      title: '英語',
      study: null,
      workloads: [],
      effortEstimates: [{
        localId: 'reply-effort',
        targetLocalId: 'reply-task',
        kind: 'total_duration',
        minutes,
        unitCode: null,
        precision: 'exact',
        sourceText: 'AI interpreted duration',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: 'AI interpreted answer',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function pendingQuestion() {
  return {
    actionId: 'question-1',
    questionCode: 'missing_effort_estimate' as const,
    targetFactId: 'workload-english',
    graphRevision: 1,
  };
}

describe('Stable V5 contextual answer semantic ownership', () => {
  it.each([
    ['3ページです', 180],
    ['2時間です', 180],
    ['arbitrary wording', 120],
  ])('uses accepted AI meaning without reparsing user text: %s', (userText, minutes) => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph(),
      document: durationDocument(minutes),
      pendingQuestion: pendingQuestion(),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText,
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: 'task-english',
        targetFactId: 'workload-english',
        minutes,
        kind: 'total_duration',
      }),
    ]);
  });

  it('leaves a correction for another public ID on the normal correction path', () => {
    const document = durationDocument(180);
    document.corrections.push({
      localId: 'reply-correction',
      target: {
        kind: 'workload',
        publicId: 'workload-other',
        localId: null,
        mention: '別の作業',
      },
      operation: 'replace',
      replacementLocalId: 'reply-effort',
      sourceText: '別の作業は3時間です',
    });

    expect(applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph(),
      document,
      pendingQuestion: pendingQuestion(),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '別の作業は3時間です',
    })).toBeNull();
  });
});
