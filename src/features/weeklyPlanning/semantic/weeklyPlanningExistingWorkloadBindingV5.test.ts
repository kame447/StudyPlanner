import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningExistingEntityBindingsV5,
} from './weeklyPlanningExistingEntityBindingApplicationV5';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

const source = {
  conversationId: 'conversation-workload-binding',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '数学の問題集80問をやりたい',
  origin: 'user' as const,
};

function originalGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-workload-binding:turn-1'],
    tasks: [{
      id: 'task-public',
      category: 'study',
      title: '数学の問題集を解く',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-public',
      taskId: 'task-public',
      componentId: null,
      quantityRole: 'target',
      amount: 80,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-public',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-public',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function contextualDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-local',
      existingPublicId: 'task-public',
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '数学の問題集を解く',
      study: {
        purpose: 'unknown',
        activityKind: 'problem_solving',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-replayed',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: 'これ',
      }],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'deadline-local',
        targetLocalId: 'task-local',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: '2026-08-23',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        sourceText: '来週まで',
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText: 'これ来週まで',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [{
      localId: 'uncertainty-local',
      targetLocalId: 'workload-replayed',
      field: 'duration_per_unit',
      reason: 'pending effort remains unresolved',
      sourceText: 'まだほぼやってない',
    }],
    corrections: [],
    decisions: [],
  };
}

function apply(document: WeeklyPlanningSemanticDocumentV5, original = originalGraph()) {
  const canonicalization = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: original,
    document,
    context: {
      conversationId: 'conversation-workload-binding',
      turnId: 'turn-2',
      expectedRevision: 1,
    },
  });
  if (canonicalization.status !== 'applied') {
    throw new Error(canonicalization.errors.join(','));
  }
  return applyWeeklyPlanningExistingEntityBindingsV5({
    originalGraph: original,
    document,
    canonicalization,
  });
}

describe('Stable V5 existing workload binding', () => {
  it('collapses an unchanged replayed workload onto the active existing workload', () => {
    const result = apply(contextualDocument());

    expect(result.status).toBe('applied');
    expect(result.canonicalization.localToFactId['workload-replayed']).toBe('workload-public');
    expect(result.canonicalization.diff?.added).not.toContainEqual(
      expect.objectContaining({ kind: 'workload' }),
    );

    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(
      result.canonicalization.graph,
    );
    expect(active.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-public',
        taskId: 'task-public',
        amount: 80,
        unitCode: 'problem',
      }),
    ]);
    expect(active.temporalConstraints).toEqual([
      expect.objectContaining({
        taskId: 'task-public',
        targetFactId: 'task-public',
        kind: 'deadline',
        dateExpression: '2026-08-23',
      }),
    ]);
    expect(active.uncertainties).toEqual([
      expect.objectContaining({
        targetFactId: 'workload-public',
      }),
    ]);
  });

  it('uses the stable unit label to bind an effort-only replay when Luna changes only the canonical unit code', () => {
    const original = originalGraph();
    original.workloads[0] = {
      ...original.workloads[0],
      quantityRole: 'completed',
      amount: 12,
      unitCode: 'custom',
      unitLabel: '枚',
    };
    const document = contextualDocument();
    document.tasks[0].workloads = [{
      localId: 'workload-replayed',
      quantityRole: 'completed',
      amount: 12,
      unitCode: 'page',
      unitLabel: '枚',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '1枚あたりだいたい8分くらいです',
    }];
    document.tasks[0].effortEstimates = [{
      localId: 'effort-1',
      targetLocalId: 'workload-replayed',
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      sourceText: '1枚あたりだいたい8分くらいです',
    }];
    document.tasks[0].temporalConstraints = [];
    document.uncertainties = [];

    const result = apply(document, original);
    expect(result.status).toBe('applied');
    expect(result.canonicalization.localToFactId['workload-replayed']).toBe('workload-public');
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(result.canonicalization.graph);
    expect(active.workloads).toEqual([
      expect.objectContaining({ id: 'workload-public', unitCode: 'custom', unitLabel: '枚', amount: 12 }),
    ]);
    expect(active.effortEstimates).toEqual([
      expect.objectContaining({
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'custom',
        targetFactId: 'workload-public',
      }),
    ]);
  });
});
