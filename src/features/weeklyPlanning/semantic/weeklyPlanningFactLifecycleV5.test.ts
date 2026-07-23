import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  applyWeeklyPlanningCorrectionIntentV5,
  applyWeeklyPlanningFactLifecycleOperationV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  validateWeeklyPlanningFactGraphValueV5,
} from './weeklyPlanningFactGraphValidatorV5';
import {
  compileGenericSchedulerInput,
} from './weeklyPlanningGenericSchedulerInput';
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
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-24',
      start: '2026-07-24',
      end: '2026-07-24',
      sourceText: '24日の計画',
    },
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
            sourceText: '最初は30分',
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
            sourceText: '45分に変更',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を45分に変更する',
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

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-24',
  planningEndDate: '2026-07-24',
  timeZone: 'Asia/Tokyo',
};

describe('Fact Graph V5 lifecycle', () => {
  it('applies correction lifecycle atomically and excludes inactive facts', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });
    expect(canonical.status).toBe('applied');
    expect(canonical.graph.factLifecycles).toHaveLength(canonical.diff?.added.length ?? 0);
    expect(validateWeeklyPlanningFactGraphValueV5(canonical.graph).errors).toEqual([]);

    const corrected = applyWeeklyPlanningCorrectionIntentV5({
      graph: canonical.graph,
      expectedRevision: 1,
      correctionIntentFactId: canonical.localToFactId['correction-1'],
      operationKey: 'correction-apply-1',
    });
    expect(corrected.status).toBe('applied');
    expect(corrected.graph.revision).toBe(2);
    expect(corrected.superseded).toEqual([
      {
        kind: 'workload',
        id: canonical.localToFactId['workload-old'],
      },
    ]);
    expect(corrected.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: canonical.localToFactId['workload-old'],
        status: 'superseded',
        terminalRevision: 2,
        supersededByFactId: canonical.localToFactId['workload-new'],
      }),
      expect.objectContaining({
        factId: canonical.localToFactId['workload-new'],
        status: 'active',
      }),
    ]));
    expect(validateWeeklyPlanningFactGraphValueV5(corrected.graph).errors).toEqual([]);

    const compiled = compileGenericSchedulerInput({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(corrected.graph),
      context: schedulerContext,
    });
    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems).toEqual([
      expect.objectContaining({
        workloadFactId: canonical.localToFactId['workload-new'],
        estimatedMinutes: 45,
      }),
    ]);

    const duplicate = applyWeeklyPlanningCorrectionIntentV5({
      graph: corrected.graph,
      expectedRevision: 1,
      correctionIntentFactId: canonical.localToFactId['correction-1'],
      operationKey: 'correction-apply-1',
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.graph).toBe(corrected.graph);
  });

  it('removes a leaf fact and rejects removal of a task with active dependents', () => {
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

    const removed = applyWeeklyPlanningFactLifecycleOperationV5({
      graph: canonical.graph,
      expectedRevision: 1,
      operation: {
        operationKey: 'remove-workload-new',
        kind: 'remove',
        targetFactId: canonical.localToFactId['workload-new'],
      },
    });
    expect(removed.status).toBe('applied');
    expect(removed.removed).toEqual([
      {
        kind: 'workload',
        id: canonical.localToFactId['workload-new'],
      },
    ]);

    const rejectedTaskRemoval = applyWeeklyPlanningFactLifecycleOperationV5({
      graph: removed.graph,
      expectedRevision: 2,
      operation: {
        operationKey: 'remove-task',
        kind: 'remove',
        targetFactId: canonical.localToFactId['task-1'],
      },
    });
    expect(rejectedTaskRemoval.status).toBe('rejected');
    expect(rejectedTaskRemoval.graph).toBe(removed.graph);
    expect(rejectedTaskRemoval.errors[0]).toContain('target-has-active-dependents');
  });
});
