// Hands the VNext projection to the existing Stable V5 scheduler. One rule set:
// - the projection is the only authority for amounts and estimates: each
//   scheduled work becomes one scheduler workload with one total of its minutes;
// - stated scheduling policy (session length) and all other facts pass through,
//   with owner references resolved to their current versions;
// - the task set matches the scheduled work: a task whose work is not ready
//   (asked or deferred) is left out and reported as unplaced, never dropped;
// - ids that exist only in this scheduling view are mapped back to the facts
//   they stand for before any provenance leaves this module.
// - the scheduling context (planning horizon, week start, named periods) is
//   derived from the state by the same V5 resolvers, so a stated planning
//   window moves the horizon exactly as in V5.
// Read-only; nothing here writes state, preview, trace or storage.
import {
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningAcceptedPlanningWindow,
  resolveWeeklyPlanningPlanningHorizon,
  type WeeklyPlanningTurnRequestContext,
} from '../../application/weeklyPlanningTemporalContext';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../../semantic/weeklyPlanningResolvedDateExpressionsV5';
import { resolveWeeklyPlanningTemporalConstraintsV5 } from '../../semantic/weeklyPlanningResolvedTemporalConstraintsV5';
import type { EffortEstimateFactV5, WorkloadFactV5 } from '../weeklyPlanningVNextV5Boundary';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
  type GenericSchedulerInputContext,
} from '../../semantic/weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
  type WeeklyPlanningPlacementGraphViewV5,
} from '../../semantic/weeklyPlanningPlacementGraphViewV5';
import type { WeeklyPlanningVNextProjection, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';

export type WeeklyPlanningVNextSchedulerCompilation =
  | { status: 'not_ready' }
  | {
      status: 'compiled';
      compilation: GenericSchedulerInputCompilationResult;
      placementGraph: WeeklyPlanningPlacementGraphViewV5;
      /** Owners with deferred questions: shown as unplaced, not scheduled, not deleted. */
      unplacedOwnerKeys: string[];
    };

/**
 * The scheduler context of a state, by V5's resolvers in V5's order: the accepted planning window,
 * dates resolved within it, temporal constraints, then the horizon (the window, or the selected
 * week extended by recurring hard bounds). VNext fixes relative dates when they are stated, so the
 * V5 grounding records that froze them are not needed.
 */
export function createWeeklyPlanningVNextSchedulerContext(params: {
  state: WeeklyPlanningVNextState;
  ownerId: string;
  requestContext: WeeklyPlanningTurnRequestContext;
  /** First day of the selected week: the horizon's start when no planning window is stated. */
  selectedDate: string;
}): GenericSchedulerInputContext {
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(params.state.graph);
  const { requestContext } = params;
  const { currentDate, weekStartsOn } = requestContext;
  const planningWindow = resolveWeeklyPlanningAcceptedPlanningWindow({ graph, requestContext });
  const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({ graph, currentDate, weekStartsOn,
    resolvedDateExpressions: resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate, weekStartsOn, planningWindow }) });
  const horizon = resolveWeeklyPlanningPlanningHorizon({ graph, selectedDate: params.selectedDate, requestContext, resolvedTemporalConstraints });
  return createWeeklyPlanningSchedulerContext({ ownerId: params.ownerId, horizon, requestContext });
}

export function compileWeeklyPlanningVNextSchedulerInput(params: {
  state: WeeklyPlanningVNextState;
  projection: WeeklyPlanningVNextProjection;
  context: GenericSchedulerInputContext;
}): WeeklyPlanningVNextSchedulerCompilation {
  const { state, projection } = params;
  if (projection.readiness !== 'ready' || projection.graphRevision !== state.graph.revision) return { status: 'not_ready' };
  const resolver = createVNextLineageResolver(state.graph);
  const current = (id: string) => resolver.leafOf(id) ?? id;
  const currentOrNull = (id: string | null) => (id === null ? null : current(id));
  const base = createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph);
  const sources = new Map([...state.graph.workloads, ...state.graph.tasks].map((fact) => [fact.id, fact.source]));

  const readyOwners = projection.owners.filter((owner) => owner.status === 'ready');
  const scheduledTaskIds = new Set(readyOwners.map((owner) => current(owner.taskId)));
  const ownedTaskIds = new Set(projection.owners.map((owner) => current(owner.taskId)));
  // Scheduling-only ids → the stated facts they stand for; and each scheduled work's estimates
  // as the projection resolved them (the projection is the estimate authority).
  const canonical = new Map<string, string[]>();
  const projectedEstimates = new Map<string, string[]>();
  const workloads: WorkloadFactV5[] = [];
  const estimates: EffortEstimateFactV5[] = [];
  for (const item of readyOwners.flatMap((owner) => owner.work)) {
    const taskTotal = item.estimateBasis === 'task_total' && item.definingFactId === item.taskId;
    const id = taskTotal ? `vnext-task-total:${current(item.taskId)}` : current(item.definingFactId);
    if (taskTotal) canonical.set(id, item.estimateFactIds); // a task total stands for its stated totals
    projectedEstimates.set(id, item.estimateFactIds);
    const source = sources.get(item.definingFactId)!;
    workloads.push({
      id, taskId: current(item.taskId), componentId: currentOrNull(item.componentId), quantityRole: 'target',
      amount: item.amount, unitCode: item.unitCode, unitLabel: item.unitLabel,
      rangeStart: item.rangeStart, rangeEnd: item.rangeEnd, perOccurrence: item.perOccurrence,
      periodExpression: item.periodExpression, source, createdRevision: state.graph.revision,
    });
    const estimateId = `vnext-estimate:${id}`;
    canonical.set(estimateId, item.estimateFactIds);
    estimates.push({
      id: estimateId, taskId: current(item.taskId), targetFactId: id, kind: 'total_duration',
      minutes: item.minutes ?? 0, unitCode: null, precision: 'exact', source, createdRevision: state.graph.revision,
    });
  }
  const scheduledIds = new Set([...workloads.map((workload) => workload.id), ...base.tasks.map((task) => task.id),
    ...base.components.map((component) => component.id)]);
  const sessionPolicies = base.effortEstimates
    .filter((effort) => effort.kind === 'session_duration')
    .map((effort) => ({ ...effort, taskId: current(effort.taskId), targetFactId: current(effort.targetFactId) }))
    .filter((effort) => scheduledIds.has(effort.targetFactId) && scheduledTaskIds.has(effort.taskId));

  const graph = {
    ...base,
    tasks: base.tasks.filter((task) => scheduledTaskIds.has(task.id) || !ownedTaskIds.has(task.id)),
    studyContexts: base.studyContexts.map((fact) => ({ ...fact, taskId: current(fact.taskId) })),
    components: base.components.map((fact) => ({
      ...fact, taskId: current(fact.taskId), parentComponentId: currentOrNull(fact.parentComponentId),
    })),
    workloads,
    // Intrinsic minute/hour work needs no estimate; V5 reads the amount itself.
    effortEstimates: [...estimates.filter((estimate) => {
      const work = workloads.find((workload) => workload.id === estimate.targetFactId)!;
      return work.unitCode !== 'minute' && work.unitCode !== 'hour';
    }), ...sessionPolicies],
    temporalConstraints: base.temporalConstraints.map((fact) => ({
      ...fact, taskId: current(fact.taskId), targetFactId: current(fact.targetFactId),
    })),
    taskDateRules: base.taskDateRules.map((fact) => ({ ...fact, taskId: current(fact.taskId), targetFactId: current(fact.targetFactId) })),
    recurrences: base.recurrences.map((fact) => ({ ...fact, taskId: current(fact.taskId), targetFactId: current(fact.targetFactId) })),
    relations: base.relations.map((fact) => ({ ...fact, fromTaskId: current(fact.fromTaskId), toTaskId: current(fact.toTaskId) })),
  };

  const compiled = compileGenericSchedulerInput({ graph, context: params.context });
  const toCanonical = (ids: readonly string[]) => [...new Set(ids.flatMap((id) => canonical.get(id) ?? [id]))];
  const compilation: GenericSchedulerInputCompilationResult = compiled.input
    ? {
        ...compiled,
        input: {
          ...compiled.input,
          sourceFactRefs: toCanonical(compiled.input.sourceFactRefs),
          movableWorkItems: compiled.input.movableWorkItems.map((item) => {
            const estimateIds = projectedEstimates.get(item.workloadFactId) ?? toCanonical(item.estimateSourceFactIds);
            return {
              ...item,
              estimateSourceFactIds: estimateIds,
              estimateSourceWorkloadFactIds: toCanonical(item.estimateSourceWorkloadFactIds),
              sourceFactRefs: toCanonical([...item.sourceFactRefs, ...estimateIds]),
            };
          }),
        },
      }
    : compiled;
  return {
    status: 'compiled',
    compilation,
    placementGraph: createWeeklyPlanningPlacementGraphViewV5(graph),
    unplacedOwnerKeys: projection.owners.filter((owner) => owner.status !== 'ready').map((owner) => owner.ownerKey),
  };
}
