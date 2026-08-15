import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
} from './weeklyPlanningGenericSchedulerInput';

type CompilerInput = Parameters<typeof compileGenericSchedulerInput>[0];

export function compileWeeklyPlanningMemoryCalibrationSchedulerInputV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  workloadFactId: string;
  sessionMinutes: number;
  context: CompilerInput['context'];
  externalSources: CompilerInput['externalSources'];
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
  const projectedWorkload: WorkloadFactV5 = {
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
  const projectedEffort: EffortEstimateFactV5 = {
    ...sourceSessionEffort,
    kind: 'total_duration',
    unitCode: null,
  };
  const projectedGraph: WeeklyPlanningFactGraphV5 = {
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
  });
  if (!compiled.input) return compiled;

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
            }
          : item),
    },
  };
}
