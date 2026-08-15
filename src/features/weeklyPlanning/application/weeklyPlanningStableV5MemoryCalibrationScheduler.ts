import type {
  WeeklyPlanningLearningStrategyProposalRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';

type CompilerInput = Parameters<typeof compileGenericSchedulerInput>[0];

function calibrationFactId(proposalId: string, suffix: string): string {
  return `${proposalId}:${suffix}`;
}

export function compileWeeklyPlanningMemoryCalibrationSchedulerV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  proposal: WeeklyPlanningLearningStrategyProposalRecord;
  context: CompilerInput['context'];
  externalSources: CompilerInput['externalSources'];
}): GenericSchedulerInputCompilationResult | null {
  if (params.proposal.kind !== 'calibrate_memory_pace' || params.proposal.status !== 'accepted') {
    return null;
  }
  const sessionMinutes = params.proposal.selectedSessionMinutes;
  if (!sessionMinutes || !Number.isFinite(sessionMinutes) || sessionMinutes <= 0) return null;

  const sourceWorkload = params.graph.workloads.find(
    (workload) => workload.id === params.proposal.workloadFactId,
  );
  if (!sourceWorkload) return null;
  const task = params.graph.tasks.find((candidate) => candidate.id === sourceWorkload.taskId);
  if (!task) return null;

  const derivedWorkloadId = calibrationFactId(params.proposal.id, 'trial-workload');
  const derivedEffortId = calibrationFactId(params.proposal.id, 'trial-effort');
  const source = {
    ...sourceWorkload.source,
    semanticLocalId: `${sourceWorkload.source.semanticLocalId}:pace-calibration`,
  };
  const derivedWorkload: WorkloadFactV5 = {
    ...sourceWorkload,
    id: derivedWorkloadId,
    quantityRole: 'target',
    amount: 1,
    unitCode: 'session',
    unitLabel: '回',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source,
  };
  const derivedEffort: EffortEstimateFactV5 = {
    id: derivedEffortId,
    taskId: sourceWorkload.taskId,
    targetFactId: derivedWorkloadId,
    kind: 'total_duration',
    minutes: sessionMinutes,
    unitCode: null,
    precision: 'exact',
    source,
    createdRevision: params.graph.revision,
  };
  const derivedGraph: WeeklyPlanningFactGraphV5 = {
    ...params.graph,
    workloads: [
      ...params.graph.workloads.filter((workload) => workload.id !== sourceWorkload.id),
      derivedWorkload,
    ],
    effortEstimates: [
      ...params.graph.effortEstimates.filter(
        (estimate) => estimate.targetFactId !== sourceWorkload.id,
      ),
      derivedEffort,
    ],
  };
  const compiled = compileGenericSchedulerInput({
    graph: derivedGraph,
    context: params.context,
    externalSources: params.externalSources,
  });
  if (!compiled.input) return compiled;

  return {
    ...compiled,
    input: {
      ...compiled.input,
      movableWorkItems: compiled.input.movableWorkItems.map((item) =>
        item.workloadFactId === derivedWorkloadId
          ? {
              ...item,
              label: `${task.title}（ペース計測）`,
              sourceFactRefs: [
                ...new Set([
                  ...item.sourceFactRefs,
                  sourceWorkload.id,
                ]),
              ],
            }
          : item),
    },
  };
}
