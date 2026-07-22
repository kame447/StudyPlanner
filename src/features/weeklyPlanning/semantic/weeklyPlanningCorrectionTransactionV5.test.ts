import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningCorrectionTransactionV5,
} from './weeklyPlanningCorrectionTransactionV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
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
    expect(canonical.graph.factLifecycles.find(
      (entry) => entry.factId === canonical.localToFactId['correction-1'],
    )?.status).toBe('active');
  });
});
