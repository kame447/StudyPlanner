import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticCorrectionV5,
  type SemanticEffortEstimateV5,
  type SemanticWorkloadV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

// Regressions for the 2026-10-29 state audit (#882 U4/U3, ported from PR #567):
// - one utterance that corrects a remaining amount and its total duration must keep
//   both explicit replacements, whatever the order of the provider's correction array;
// - correcting progress after an effort was attached to the derived remaining must
//   migrate that effort with the existing dependent policy instead of rejecting forever.

function workload(params: Partial<SemanticWorkloadV5> & Pick<SemanticWorkloadV5, 'localId' | 'quantityRole' | 'amount'>): SemanticWorkloadV5 {
  return {
    unitCode: 'custom',
    unitLabel: '枚',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText: `${params.amount}枚`,
    ...params,
  };
}

function document(params: {
  taskLocalId: string;
  existingTaskId?: string;
  workloads: SemanticWorkloadV5[];
  effortEstimates?: SemanticEffortEstimateV5[];
  corrections?: SemanticCorrectionV5[];
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: params.taskLocalId,
      existingPublicId: params.existingTaskId ?? null,
      category: 'study',
      title: 'スライド',
      study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: params.workloads,
      effortEstimates: params.effortEstimates ?? [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: params.sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: params.corrections ?? [],
    decisions: [],
  };
}

function commitTurn(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  turnId: string;
}) {
  const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: params.graph,
    document: params.document,
    context: {
      conversationId: 'conversation-compound',
      turnId: params.turnId,
      expectedRevision: params.graph.revision,
    },
  });
  return finalizeWeeklyPlanningSemanticCanonicalizationV5({
    originalGraph: params.graph,
    document: params.document,
    baseCanonicalization: base,
    contextualAnswer: false,
    questionCode: null,
    operationKeyPrefix: `test:${params.turnId}`,
  }).canonicalization;
}

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5): WorkloadFactV5[] {
  const active = activeIds(graph);
  return graph.workloads.filter((fact) => active.has(fact.id));
}

function activeEfforts(graph: WeeklyPlanningFactGraphV5): EffortEstimateFactV5[] {
  const active = activeIds(graph);
  return graph.effortEstimates.filter((fact) => active.has(fact.id));
}

// The scheduler-facing view: the invalidated total must come back as a blocking missing estimate (asked again).
function missingEffortWorkloadIds(graph: WeeklyPlanningFactGraphV5): string[] {
  const active = activeIds(graph);
  const result = compileGenericPlanningWorkItems({
    tasks: graph.tasks.filter((fact) => active.has(fact.id)),
    components: graph.components.filter((fact) => active.has(fact.id)),
    workloads: activeWorkloads(graph),
    effortEstimates: activeEfforts(graph),
  });
  return result.issues
    .filter((issue) => issue.code === 'missing_effort_estimate' && issue.blocking)
    .map((issue) => issue.workloadFactId);
}

function attachEffort(graph: WeeklyPlanningFactGraphV5, params: {
  id: string;
  target: WorkloadFactV5;
  kind: EffortEstimateFactV5['kind'];
  minutes: number;
  unitCode?: EffortEstimateFactV5['unitCode'];
}): WeeklyPlanningFactGraphV5 {
  const effort: EffortEstimateFactV5 = {
    id: params.id,
    taskId: params.target.taskId,
    targetFactId: params.target.id,
    kind: params.kind,
    minutes: params.minutes,
    unitCode: params.unitCode ?? null,
    precision: 'exact',
    source: { ...params.target.source, semanticLocalId: `${params.id}-local`, sourceText: `${params.minutes}分` },
    createdRevision: graph.revision,
  };
  return {
    ...graph,
    effortEstimates: [...graph.effortEstimates, effort],
    factLifecycles: [...graph.factLifecycles, {
      factId: effort.id,
      status: 'active',
      createdRevision: graph.revision,
      terminalRevision: null,
      supersededByFactId: null,
    }],
  };
}

describe('Stable V5 compound correction of a remaining amount and its effort (#882 U4)', () => {
  function priorGraph() {
    const first = commitTurn({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document({
        taskLocalId: 'task-slide',
        workloads: [workload({ localId: 'remaining-10', quantityRole: 'remaining', amount: 10, sourceText: '残り10枚' })],
        sourceText: 'スライドが残り10枚あります',
      }),
      turnId: 'turn-1',
    });
    expect(first.status).toBe('applied');
    const remaining = activeWorkloads(first.graph)[0];
    const graph = attachEffort(first.graph, { id: 'wpf_effort_total_80', target: remaining, kind: 'total_duration', minutes: 80 });
    return { graph, remaining, taskId: remaining.taskId };
  }

  for (const order of ['workload-first', 'effort-first'] as const) {
    it(`keeps the explicit R8 and E60 active and correctly linked (${order})`, () => {
      const prior = priorGraph();
      const sourceText = '訂正です。残り8枚で全部60分かかります';
      const workloadCorrection: SemanticCorrectionV5 = {
        localId: 'correction-remaining',
        target: { kind: 'workload', publicId: prior.remaining.id, localId: null, mention: null },
        operation: 'replace',
        replacementLocalId: 'remaining-8',
        sourceText,
      };
      const effortCorrection: SemanticCorrectionV5 = {
        localId: 'correction-effort',
        target: { kind: 'effort_estimate', publicId: 'wpf_effort_total_80', localId: null, mention: null },
        operation: 'replace',
        replacementLocalId: 'effort-60',
        sourceText,
      };
      const result = commitTurn({
        graph: prior.graph,
        document: document({
          taskLocalId: 'task-slide-again',
          existingTaskId: prior.taskId,
          workloads: [workload({ localId: 'remaining-8', quantityRole: 'remaining', amount: 8, sourceText: '残り8枚' })],
          effortEstimates: [{
            localId: 'effort-60',
            targetLocalId: 'remaining-8',
            kind: 'total_duration',
            minutes: 60,
            unitCode: null,
            precision: 'exact',
            sourceText: '全部60分かかります',
          }],
          corrections: order === 'workload-first'
            ? [workloadCorrection, effortCorrection]
            : [effortCorrection, workloadCorrection],
          sourceText,
        }),
        turnId: `turn-2-${order}`,
      });

      expect(result.status, result.errors.join(',')).toBe('applied');
      const workloads = activeWorkloads(result.graph);
      expect(workloads.map((fact) => [fact.quantityRole, fact.amount])).toEqual([['remaining', 8]]);
      const efforts = activeEfforts(result.graph);
      expect(efforts.map((fact) => [fact.kind, fact.minutes, fact.targetFactId])).toEqual([
        ['total_duration', 60, workloads[0].id],
      ]);
      expect(activeIds(result.graph).has(prior.remaining.id)).toBe(false);
      expect(activeIds(result.graph).has('wpf_effort_total_80')).toBe(false);
      expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
    });
  }
});

describe('Stable V5 progress correction after an effort on the derived remaining (#882 U3)', () => {
  function graphWithDerivedRemaining() {
    const first = commitTurn({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document({
        taskLocalId: 'task-slide',
        workloads: [
          workload({ localId: 'total-20', quantityRole: 'scope_total', amount: 20, sourceText: '全部で20枚' }),
          workload({ localId: 'completed-10', quantityRole: 'completed', amount: 10, sourceText: '今10枚' }),
        ],
        sourceText: '全部で20枚、今10枚',
      }),
      turnId: 'turn-1',
    });
    expect(first.status).toBe('applied');
    const remaining = activeWorkloads(first.graph).filter((fact) => fact.quantityRole === 'remaining');
    expect(remaining.map((fact) => fact.amount)).toEqual([10]);
    const completed = activeWorkloads(first.graph).find((fact) => fact.quantityRole === 'completed')!;
    return { graph: first.graph, remaining: remaining[0], completed };
  }

  function correctCompletedTo12(graph: WeeklyPlanningFactGraphV5, completed: WorkloadFactV5, turnId: string) {
    const sourceText = '訂正、今は12枚';
    return commitTurn({
      graph,
      document: document({
        taskLocalId: 'task-slide-again',
        existingTaskId: completed.taskId,
        workloads: [workload({ localId: 'completed-12', quantityRole: 'completed', amount: 12, sourceText: '今は12枚' })],
        corrections: [{
          localId: 'correction-completed',
          target: { kind: 'workload', publicId: completed.id, localId: null, mention: null },
          operation: 'replace',
          replacementLocalId: 'completed-12',
          sourceText,
        }],
        sourceText,
      }),
      turnId,
    });
  }

  it('invalidates a total duration that depended on the old remaining amount', () => {
    const prior = graphWithDerivedRemaining();
    const graph = attachEffort(prior.graph, { id: 'wpf_effort_total_80', target: prior.remaining, kind: 'total_duration', minutes: 80 });
    const result = correctCompletedTo12(graph, prior.completed, 'turn-2');

    expect(result.status, result.errors.join(',')).toBe('applied');
    const remaining = activeWorkloads(result.graph).filter((fact) => fact.quantityRole === 'remaining');
    expect(remaining.map((fact) => fact.amount)).toEqual([8]);
    expect(activeEfforts(result.graph)).toEqual([]);
    expect(missingEffortWorkloadIds(result.graph)).toEqual([remaining[0].id]);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });

  it('carries a same-unit per-unit duration and a session duration to the new remaining amount', () => {
    const prior = graphWithDerivedRemaining();
    let graph = attachEffort(prior.graph, { id: 'wpf_effort_rate_8', target: prior.remaining, kind: 'duration_per_unit', minutes: 8, unitCode: 'custom' });
    graph = attachEffort(graph, { id: 'wpf_effort_session_30', target: prior.remaining, kind: 'session_duration', minutes: 30 });
    const result = correctCompletedTo12(graph, prior.completed, 'turn-2');

    expect(result.status, result.errors.join(',')).toBe('applied');
    const remaining = activeWorkloads(result.graph).filter((fact) => fact.quantityRole === 'remaining');
    expect(remaining.map((fact) => fact.amount)).toEqual([8]);
    expect(activeEfforts(result.graph).map((fact) => [fact.kind, fact.minutes, fact.targetFactId]).sort()).toEqual([
      ['duration_per_unit', 8, remaining[0].id],
      ['session_duration', 30, remaining[0].id],
    ]);
    expect(missingEffortWorkloadIds(result.graph)).toEqual([]);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });

  it('is idempotent when the same correction turn is replayed', () => {
    const prior = graphWithDerivedRemaining();
    const graph = attachEffort(prior.graph, { id: 'wpf_effort_rate_8', target: prior.remaining, kind: 'duration_per_unit', minutes: 8, unitCode: 'custom' });
    const first = correctCompletedTo12(graph, prior.completed, 'turn-2');
    expect(first.status, first.errors.join(',')).toBe('applied');
    const replay = correctCompletedTo12(first.graph, prior.completed, 'turn-2');
    expect(replay.status).toBe('duplicate');
    expect(replay.graph.revision).toBe(first.graph.revision);
  });
});

describe('Stable V5 percentage progress correction after an effort on the derived remaining (#882 U3, artifact A)', () => {
  it('rebases 40% to 30% and invalidates the total duration instead of rejecting the correction', () => {
    const first = commitTurn({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document({
        taskLocalId: 'task-slide',
        workloads: [workload({ localId: 'completed-60', quantityRole: 'completed', amount: 60, unitLabel: '%', sourceText: '今60%' })],
        sourceText: '完成を100%とすると今60%',
      }),
      turnId: 'turn-1',
    });
    expect(first.status, first.errors.join(',')).toBe('applied');
    const remaining = activeWorkloads(first.graph).filter((fact) => fact.quantityRole === 'remaining');
    expect(remaining.map((fact) => fact.amount)).toEqual([40]);
    const completed = activeWorkloads(first.graph).find((fact) => fact.quantityRole === 'completed')!;
    const graph = attachEffort(first.graph, { id: 'wpf_effort_total_120', target: remaining[0], kind: 'total_duration', minutes: 120 });

    const sourceText = '訂正です、今は70%くらいです';
    const result = commitTurn({
      graph,
      document: document({
        taskLocalId: 'task-slide-again',
        existingTaskId: completed.taskId,
        workloads: [workload({ localId: 'completed-70', quantityRole: 'completed', amount: 70, unitLabel: '%', sourceText: '今は70%' })],
        corrections: [{
          localId: 'correction-completed',
          target: { kind: 'workload', publicId: completed.id, localId: null, mention: null },
          operation: 'replace',
          replacementLocalId: 'completed-70',
          sourceText,
        }],
        sourceText,
      }),
      turnId: 'turn-2',
    });

    expect(result.status, result.errors.join(',')).toBe('applied');
    const remainingAfter = activeWorkloads(result.graph).filter((fact) => fact.quantityRole === 'remaining');
    expect(remainingAfter.map((fact) => fact.amount)).toEqual([30]);
    expect(activeEfforts(result.graph)).toEqual([]);
    expect(missingEffortWorkloadIds(result.graph)).toEqual([remainingAfter[0].id]);
    expect(validateWeeklyPlanningFactGraphValueV5(result.graph).errors).toEqual([]);
  });
});
