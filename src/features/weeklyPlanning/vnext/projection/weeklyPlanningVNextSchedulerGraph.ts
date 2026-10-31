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
import type { EffortEstimateFactV5, WorkloadFactV5, ExternalConstraintSourceSnapshot } from '../weeklyPlanningVNextV5Boundary';
import { applyAcceptedMemorySessionProjectionV5, compileWeeklyPlanningMemoryCalibrationSchedulerInputV5 } from '../weeklyPlanningVNextV5Boundary';
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
import { createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';

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
  externalSources?: ExternalConstraintSourceSnapshot[];
  estimateCalibrationMultiplier?: number;
}): WeeklyPlanningVNextSchedulerCompilation {
  const { state, projection } = params;
  // Empty movable work can still contain fixed reservations for V5's registration projection.
  // Unresolved questions and stale revisions remain blocking (EventRegistration integration).
  if (projection.readiness === 'needs_resolution' || projection.graphRevision !== state.graph.revision) return { status: 'not_ready' };
  const resolver = createVNextLineageResolver(state.graph);
  const current = (id: string) => resolver.leafOf(id) ?? id;
  const currentOrNull = (id: string | null) => (id === null ? null : current(id));
  const base = withCurrentVNextReferences(createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), current);
  // A plain work deferral still has nothing compilable. The empty-work extension is only
  // for actual active hard fixed intervals; it never gives deferred work a timebox.
  if (projection.readiness === 'empty' && !base.temporalConstraints.some(bound =>
    bound.kind === 'fixed_interval' && bound.constraintLevel === 'hard')) return { status: 'not_ready' };
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
    // Task-level work (a stated task total, or a provisional block for a task with no work) needs its own id.
    const taskLevel = item.definingFactId === item.taskId;
    const id = taskLevel ? `vnext-task-total:${current(item.taskId)}` : current(item.definingFactId);
    // A task total stands for its stated totals; a provisional block only for its task.
    if (taskLevel) canonical.set(id, item.estimateBasis === 'task_total' ? item.estimateFactIds : [current(item.taskId)]);
    projectedEstimates.set(id, item.estimateFactIds);
    const source = sources.get(item.definingFactId)!;
    // A provisional block is scheduler-only minute work, as V5's projectWeeklyPlanningProvisionalTimeboxGraphV5
    // makes it: an estimate attached to the stated quantity would get the ordinary buffer (60 → 70, Astra P02).
    const timebox = item.estimateBasis === 'provisional_timebox';
    workloads.push({
      id, taskId: current(item.taskId), componentId: currentOrNull(item.componentId), quantityRole: 'target',
      ...(timebox
        ? { amount: item.minutes ?? 0, unitCode: 'minute' as const, unitLabel: '分', rangeStart: null, rangeEnd: null,
            perOccurrence: false, periodExpression: null }
        : { amount: item.amount, unitCode: item.unitCode, unitLabel: item.unitLabel, rangeStart: item.rangeStart,
            rangeEnd: item.rangeEnd, perOccurrence: item.perOccurrence, periodExpression: item.periodExpression }),
      source, createdRevision: state.graph.revision,
    });
    const estimateId = `vnext-estimate:${id}`;
    canonical.set(estimateId, item.estimateFactIds);
    estimates.push({
      id: estimateId, taskId: current(item.taskId), targetFactId: id, kind: 'total_duration',
      minutes: item.minutes ?? 0, unitCode: null, precision: 'exact', source, createdRevision: state.graph.revision,
    });
  }
  // Projection uses V5's single relevant-workload selection, not every historical accepted trial.
  const calibration = readyOwners.find(owner => owner.calibration)?.calibration;
  workloads.push(...base.workloads.filter(workload => workload.id === calibration?.workloadFactId));
  const scheduledIds = new Set([...workloads.map((workload) => workload.id), ...base.tasks.map((task) => task.id),
    ...base.components.map((component) => component.id)]);
  const sessionPolicies = base.effortEstimates
    .filter((effort) => effort.kind === 'session_duration')
    .filter((effort) => scheduledIds.has(effort.targetFactId) && scheduledTaskIds.has(effort.taskId));

  const graph = {
    ...base,
    tasks: base.tasks.filter((task) => scheduledTaskIds.has(task.id) || !ownedTaskIds.has(task.id)),
    workloads,
    // Intrinsic minute/hour work needs no estimate; V5 reads the amount itself.
    effortEstimates: [...estimates.filter((estimate) => {
      const work = workloads.find((workload) => workload.id === estimate.targetFactId)!;
      return work.unitCode !== 'minute' && work.unitCode !== 'hour';
    }), ...sessionPolicies],
  };

  let compiled = (calibration ? compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({ graph, context: params.context,
    externalSources: params.externalSources, workloadFactId: calibration.workloadFactId, sessionMinutes: calibration.sessionMinutes,
    estimateCalibrationMultiplier: params.estimateCalibrationMultiplier }) : null)
    ?? compileGenericSchedulerInput({ graph, context: params.context, externalSources: params.externalSources,
      estimateCalibrationMultiplier: params.estimateCalibrationMultiplier });
  compiled = applyAcceptedMemorySessionProjectionV5({ compilation: compiled, graph,
    acceptedSpacedProposal: projection.learningStrategy?.acceptedSpacedProposal ?? null,
    acceptedCalibrationProposal: projection.learningStrategy?.acceptedCalibrationProposal ?? null });
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
