import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  applyWeeklyPlanningCorrectionTransactionV5,
} from './weeklyPlanningCorrectionTransactionV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  validateWeeklyPlanningFactGraphValueV5,
} from './weeklyPlanningFactGraphValidatorV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-1',
        category: 'study',
        title: '英単語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        },
        workloads: [
          {
            localId: 'workload-old',
            quantityRole: 'target',
            amount: 30,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '30分',
          },
          {
            localId: 'workload-new',
            quantityRole: 'target',
            amount: 45,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '45分',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を45分へ変更',
      },
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [
      {
        localId: 'correction-1',
        target: {
          kind: 'workload',
          publicId: null,
          localId: 'workload-old',
          mention: null,
        },
        operation: 'replace',
        replacementLocalId: 'workload-new',
        sourceText: '30分ではなく45分',
      },
    ],
    decisions: [],
  };
}

const source = {
  conversationId: 'conversation-correction',
  turnId: 'turn-1',
  semanticLocalId: 'source',
  sourceText: '英単語220語',
  origin: 'user' as const,
};

function graphWithEffort(
  kind: EffortEstimateFactV5['kind'],
): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 3,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [
      {
        id: 'workload-220',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'target',
        amount: 220,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source,
        createdRevision: 1,
      },
      {
        id: 'workload-180',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'target',
        amount: 180,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: {
          ...source,
          turnId: 'turn-3',
          semanticLocalId: 'workload-replacement',
          sourceText: '180語だった',
        },
        createdRevision: 3,
      },
    ],
    effortEstimates: [{
      id: 'effort-20',
      taskId: 'task-1',
      targetFactId: 'workload-220',
      kind,
      minutes: 20,
      unitCode: kind === 'total_duration' ? null : 'word',
      precision: 'approximate',
      source: {
        ...source,
        turnId: 'turn-2',
        semanticLocalId: 'effort-20',
        sourceText: '20分くらい',
      },
      createdRevision: 2,
    }],
    correctionIntents: [{
      id: 'correction-1',
      target: {
        kind: 'workload',
        publicId: 'workload-220',
        factId: 'workload-220',
        mention: '220語',
      },
      operation: 'replace',
      replacementFactId: 'workload-180',
      source: {
        ...source,
        turnId: 'turn-3',
        semanticLocalId: 'correction-1',
        sourceText: '220語じゃなくて180語だった',
      },
      createdRevision: 3,
    }],
    factLifecycles: [
      ['task-1', 1],
      ['workload-220', 1],
      ['effort-20', 2],
      ['workload-180', 3],
      ['correction-1', 3],
    ].map(([factId, createdRevision]) => ({
      factId: String(factId),
      status: 'active' as const,
      createdRevision: Number(createdRevision),
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

describe('Stable V5 correction transaction', () => {
  it('supersedes the target and consumes the correction intent atomically', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });
    if (canonical.status !== 'applied') throw new Error(canonical.errors.join(','));

    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph: canonical.graph,
      expectedRevision: 1,
      correctionIntentFactId: canonical.localToFactId['correction-1'],
      operationKey: 'correction-transaction-1',
    });

    expect(result.status).toBe('applied');
    expect(result.graph.revision).toBe(2);
    expect(result.added).toEqual([]);
    expect(result.superseded).toEqual([
      {
        kind: 'workload',
        id: canonical.localToFactId['workload-old'],
      },
    ]);
    expect(result.removed).toEqual([
      {
        kind: 'correction_intent',
        id: canonical.localToFactId['correction-1'],
      },
    ]);
    expect(result.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: canonical.localToFactId['workload-old'],
        status: 'superseded',
        terminalRevision: 2,
        supersededByFactId: canonical.localToFactId['workload-new'],
      }),
      expect.objectContaining({
        factId: canonical.localToFactId['correction-1'],
        status: 'removed',
        terminalRevision: 2,
        supersededByFactId: null,
      }),
    ]));
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });

  it('does not consume the intent when target application is rejected', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-2',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });
    if (canonical.status !== 'applied') throw new Error(canonical.errors.join(','));

    const rejected = applyWeeklyPlanningCorrectionTransactionV5({
      graph: canonical.graph,
      expectedRevision: 99,
      correctionIntentFactId: canonical.localToFactId['correction-1'],
      operationKey: 'correction-transaction-rejected',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.graph).toBe(canonical.graph);
    expect(rejected.added).toEqual([]);
    expect(canonical.graph.factLifecycles.find(
      (entry) => entry.factId === canonical.localToFactId['correction-1'],
    )?.status).toBe('active');
  });

  it('carries session duration to the replacement workload and leaves only 180 active', () => {
    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph: graphWithEffort('session_duration'),
      expectedRevision: 3,
      correctionIntentFactId: 'correction-1',
      operationKey: 'replace-workload',
    });

    expect(result.status).toBe('applied');
    expect(result.added).toEqual([
      expect.objectContaining({ kind: 'effort_estimate' }),
    ]);
    expect(result.superseded).toEqual(expect.arrayContaining([
      { kind: 'workload', id: 'workload-220' },
      { kind: 'effort_estimate', id: 'effort-20' },
    ]));
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);

    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph);
    expect(active.workloads).toEqual([
      expect.objectContaining({ id: 'workload-180', amount: 180, unitCode: 'word' }),
    ]);
    expect(active.effortEstimates).toEqual([
      expect.objectContaining({
        targetFactId: 'workload-180',
        kind: 'session_duration',
        minutes: 20,
        unitCode: 'word',
      }),
    ]);
  });

  it('invalidates a total-duration estimate when the total workload changes', () => {
    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph: graphWithEffort('total_duration'),
      expectedRevision: 3,
      correctionIntentFactId: 'correction-1',
      operationKey: 'replace-workload-total-duration',
    });

    expect(result.status).toBe('applied');
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(expect.arrayContaining([
      { kind: 'effort_estimate', id: 'effort-20' },
    ]));
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph);
    expect(active.workloads).toEqual([
      expect.objectContaining({ id: 'workload-180', amount: 180 }),
    ]);
    expect(active.effortEstimates).toEqual([]);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });
});
