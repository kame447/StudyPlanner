import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningDecisionTransactionV5,
} from './weeklyPlanningDecisionTransactionV5';
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

function document(decision: 'accept' | 'reject' | 'modify'): WeeklyPlanningSemanticDocumentV5 {
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
            localId: 'workload-1',
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
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を30分',
      },
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [
      {
        localId: 'decision-1',
        target: {
          kind: 'workload',
          publicId: null,
          localId: 'workload-1',
          mention: null,
        },
        decision,
        sourceText: decision === 'accept' ? 'これでよい' : 'これは使わない',
      },
    ],
  };
}

function canonical(decision: 'accept' | 'reject' | 'modify') {
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    document: document(decision),
    context: {
      conversationId: `conversation-${decision}`,
      turnId: 'turn-1',
      expectedRevision: 0,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result;
}

describe('Stable V5 decision transaction', () => {
  it('consumes an accept decision without changing the target fact', () => {
    const initial = canonical('accept');
    const result = applyWeeklyPlanningDecisionTransactionV5({
      graph: initial.graph,
      expectedRevision: 1,
      decisionIntentFactId: initial.localToFactId['decision-1'],
      operationKey: 'decision-accept-1',
    });

    expect(result.status).toBe('applied');
    expect(result.graph.revision).toBe(2);
    expect(result.removed).toEqual([
      {
        kind: 'decision_intent',
        id: initial.localToFactId['decision-1'],
      },
    ]);
    expect(result.graph.factLifecycles.find(
      (entry) => entry.factId === initial.localToFactId['workload-1'],
    )?.status).toBe('active');
    expect(result.graph.factLifecycles.find(
      (entry) => entry.factId === initial.localToFactId['decision-1'],
    )).toMatchObject({ status: 'removed', terminalRevision: 2 });
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });

  it('removes a rejected leaf fact and consumes the decision in one revision', () => {
    const initial = canonical('reject');
    const result = applyWeeklyPlanningDecisionTransactionV5({
      graph: initial.graph,
      expectedRevision: 1,
      decisionIntentFactId: initial.localToFactId['decision-1'],
      operationKey: 'decision-reject-1',
    });

    expect(result.status).toBe('applied');
    expect(result.graph.revision).toBe(2);
    expect(result.removed).toEqual(expect.arrayContaining([
      { kind: 'workload', id: initial.localToFactId['workload-1'] },
      { kind: 'decision_intent', id: initial.localToFactId['decision-1'] },
    ]));
    expect(result.graph.factLifecycles.find(
      (entry) => entry.factId === initial.localToFactId['workload-1'],
    )).toMatchObject({ status: 'removed', terminalRevision: 2 });
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });

  it('rejects modify until a correction replacement is available', () => {
    const initial = canonical('modify');
    const result = applyWeeklyPlanningDecisionTransactionV5({
      graph: initial.graph,
      expectedRevision: 1,
      decisionIntentFactId: initial.localToFactId['decision-1'],
      operationKey: 'decision-modify-1',
    });

    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(initial.graph);
    expect(result.errors).toContain('decision-modify-requires-correction-intent');
  });
});
