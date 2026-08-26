import type {
  WeeklyPlanningMemoryPaceObservationSourceV1,
} from '../../../types/domain';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
} from './weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningResolvedTemporalConstraintsV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';

type CompilerInput = Parameters<typeof compileGenericSchedulerInput>[0];
type SchedulerGraph = CompilerInput['graph'];
type SchedulerWorkload = SchedulerGraph['workloads'][number];
type SchedulerEffort = SchedulerGraph['effortEstimates'][number];

export type MemoryCalibrationSchedulerWorkItemV5 =
  GenericSchedulerInputCompilationResult extends { input: infer T }
    ? T
    : never;

export function compileWeeklyPlanningMemoryCalibrationSchedulerInputV5(params: {
  graph: SchedulerGraph;
  workloadFactId: string;
  sessionMinutes: number;
  context: CompilerInput['context'];
  externalSources: CompilerInput['externalSources'];
  resolvedTemporalConstraints?: WeeklyPlanningResolvedTemporalConstraintsV5;
}): GenericSchedulerInputCompilationResult | null {
  if (!Number.isFinite(params.sessionMinutes) || params.sessionMinutes <= 0) return null;

  const sourceWorkload = params.graph.workloads.find(
    (workload) => workload.id === params.workloadFactId,
  );
  if (!sourceWorkload) return null;
  const task = params.graph.tasks.find((candidate) => candidate.id === sourceWorkload.taskId);
  if (!task) return null;

  const sourceSessionEffort = params.graph.effortEstimates.find((estimate) =>
    estimate.targetFactId === sourceWorkload.id
    && estimate.kind === 'session_duration'
    && estimate.minutes === params.sessionMinutes);
  if (!sourceSessionEffort) return null;

  // Scheduler-only projection. Keep durable public IDs so already-grounded
  // temporal/date constraints and preview provenance continue to refer to the
  // real facts. The persisted graph still means “full memorization scope plus
  // one-session duration”; only this local projection means “schedule one trial”.
  const projectedWorkload: SchedulerWorkload = {
    ...sourceWorkload,
    quantityRole: 'target',
    amount: 1,
    unitCode: 'session',
    unitLabel: '回',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
  };
  const projectedEffort: SchedulerEffort = {
    ...sourceSessionEffort,
    kind: 'session_duration',
    unitCode: 'session',
  };
  const projectedGraph: SchedulerGraph = {
    ...params.graph,
    workloads: params.graph.workloads.map((workload) =>
      workload.id === sourceWorkload.id ? projectedWorkload : workload),
    effortEstimates: params.graph.effortEstimates.map((estimate) =>
      estimate.id === sourceSessionEffort.id ? projectedEffort : estimate),
  };

  const compiled = compileGenericSchedulerInput({
    graph: projectedGraph,
    context: params.context,
    externalSources: params.externalSources,
    resolvedTemporalConstraints: params.resolvedTemporalConstraints,
  });
  if (!compiled.input) return compiled;

  const observationSource: WeeklyPlanningMemoryPaceObservationSourceV1 = {
    version: 1,
    kind: 'memory_pace_calibration',
    conversationId: task.source.conversationId,
    graphRevision: params.graph.revision,
    taskId: task.id,
    workloadFactId: sourceWorkload.id,
    sessionEffortFactId: sourceSessionEffort.id,
    activityKind: 'memorization_retrieval',
    targetAmount: sourceWorkload.amount,
    unitCode: sourceWorkload.unitCode,
    unitLabel: sourceWorkload.unitLabel,
    plannedSessionMinutes: params.sessionMinutes,
  };

  return {
    ...compiled,
    input: {
      ...compiled.input,
      movableWorkItems: compiled.input.movableWorkItems.map((item) =>
        item.workloadFactId === sourceWorkload.id
          ? {
              ...item,
              label: `${task.title}（ペース計測）`,
              sourceFactRefs: [
                ...new Set([
                  ...item.sourceFactRefs,
                  sourceWorkload.id,
                  sourceSessionEffort.id,
                ]),
              ],
              weeklyPlanningObservationSource: observationSource,
            }
          : item),
    },
  };
}
