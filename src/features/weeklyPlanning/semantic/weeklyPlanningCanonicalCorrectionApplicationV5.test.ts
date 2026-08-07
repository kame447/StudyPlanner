import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningCanonicalCorrectionsV5,
} from './weeklyPlanningCanonicalCorrectionApplicationV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
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
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function task(localId: string, title: string, workloadLocalId: string, hours: number): SemanticTaskV5 {
  return {
    localId,
    category: 'study',
    title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: workloadLocalId,
      quantityRole: 'target',
      amount: hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${title}${hours}時間`,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: `${title}を${hours}時間`,
  };
}

function document(params: {
  tasks: SemanticTaskV5[];
  corrections?: WeeklyPlanningSemanticDocumentV5['corrections'];
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: params.tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: params.corrections ?? [],
    decisions: [],
  };
}

function canonicalize(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  conversationId: string;
  turnId: string;
}) {
  const graph = params.graph ?? createEmptyWeeklyPlanningFactGraphV5();
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph,
    document: params.document,
    context: {
      conversationId: params.conversationId,
      turnId: params.turnId,
      expectedRevision: graph.revision,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result;
}

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

describe('Stable V5 canonical correction application', () => {
  it('replaces a prior-turn workload and removes the duplicate replacement container', () => {
    const first = canonicalize({
      document: document({
        tasks: [task('task-math-old', '数学', 'workload-math-old', 3)],
      }),
      conversationId: 'conversation-single',
      turnId: 'turn-1',
    });
    const oldTaskId = first.localToFactId['task-math-old'];
    const oldWorkloadId = first.localToFactId['workload-math-old'];

    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [task('task-math-new', '数学', 'workload-math-new', 1)],
        corrections: [{
          localId: 'correction-math',
          target: {
            kind: 'workload',
            publicId: oldWorkloadId,
            localId: null,
            mention: '数学3時間',
          },
          operation: 'replace',
          replacementLocalId: 'workload-math-new',
          sourceText: '数学は3時間ではなく1時間',
        }],
      }),
      conversationId: 'conversation-single',
      turnId: 'turn-2',
    });

    const applied = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-single:turn-2',
    });

    expect(applied.status).toBe('applied');
    const active = activeIds(applied.graph);
    const activeTasks = applied.graph.tasks.filter((fact) => active.has(fact.id));
    const activeWorkloads = applied.graph.workloads.filter((fact) => active.has(fact.id));
    expect(activeTasks).toHaveLength(1);
    expect(activeTasks[0]?.id).toBe(oldTaskId);
    expect(activeWorkloads).toHaveLength(1);
    expect(activeWorkloads[0]).toMatchObject({
      id: second.localToFactId['workload-math-new'],
      taskId: oldTaskId,
      amount: 1,
      unitCode: 'hour',
    });
    expect(applied.graph.factLifecycles.find(
      (entry) => entry.factId === oldWorkloadId,
    )).toMatchObject({
      status: 'superseded',
      supersededByFactId: second.localToFactId['workload-math-new'],
    });
    expect(validateWeeklyPlanningFactGraphValueV5(applied.graph).errors).toEqual([]);
  });

  it('applies two task-specific corrections without crossing their targets', () => {
    const first = canonicalize({
      document: document({
        tasks: [
          task('task-english-old', '英語', 'workload-english-old', 2),
          task('task-math-old', '数学', 'workload-math-old', 3),
        ],
      }),
      conversationId: 'conversation-multi',
      turnId: 'turn-1',
    });
    const oldEnglishTaskId = first.localToFactId['task-english-old'];
    const oldMathTaskId = first.localToFactId['task-math-old'];

    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [
          task('task-english-new', '英語', 'workload-english-new', 3),
          task('task-math-new', '数学', 'workload-math-new', 2),
        ],
        corrections: [
          {
            localId: 'correction-english',
            target: {
              kind: 'workload',
              publicId: first.localToFactId['workload-english-old'],
              localId: null,
              mention: '英語2時間',
            },
            operation: 'replace',
            replacementLocalId: 'workload-english-new',
            sourceText: '英語は3時間',
          },
          {
            localId: 'correction-math',
            target: {
              kind: 'workload',
              publicId: first.localToFactId['workload-math-old'],
              localId: null,
              mention: '数学3時間',
            },
            operation: 'replace',
            replacementLocalId: 'workload-math-new',
            sourceText: '数学は2時間',
          },
        ],
      }),
      conversationId: 'conversation-multi',
      turnId: 'turn-2',
    });

    const applied = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-multi:turn-2',
    });

    expect(applied.status).toBe('applied');
    const active = activeIds(applied.graph);
    const activeTasks = applied.graph.tasks.filter((fact) => active.has(fact.id));
    const activeWorkloads = applied.graph.workloads.filter((fact) => active.has(fact.id));
    expect(activeTasks.map((fact) => fact.id).sort()).toEqual(
      [oldEnglishTaskId, oldMathTaskId].sort(),
    );
    expect(activeWorkloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: oldEnglishTaskId, amount: 3 }),
      expect.objectContaining({ taskId: oldMathTaskId, amount: 2 }),
    ]));
    expect(activeWorkloads).toHaveLength(2);
    expect(validateWeeklyPlanningFactGraphValueV5(applied.graph).errors).toEqual([]);
  });

  it('rejects an unresolved public target and rolls the whole turn back', () => {
    const first = canonicalize({
      document: document({
        tasks: [task('task-old', '英語', 'workload-old', 2)],
      }),
      conversationId: 'conversation-reject',
      turnId: 'turn-1',
    });
    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [task('task-new', '英語', 'workload-new', 3)],
        corrections: [{
          localId: 'correction-unresolved',
          target: {
            kind: 'workload',
            publicId: 'missing-public-id',
            localId: null,
            mention: '英語2時間',
          },
          operation: 'replace',
          replacementLocalId: 'workload-new',
          sourceText: '英語は3時間',
        }],
      }),
      conversationId: 'conversation-reject',
      turnId: 'turn-2',
    });

    const rejected = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-reject:turn-2',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.graph).toBe(first.graph);
    expect(rejected.errors).toEqual([
      expect.stringContaining('correction-target-kind-mismatch'),
    ]);
    expect(first.graph.revision).toBe(1);
  });
});
