import type {
  CanonicalSemanticReferenceV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningSelfRepairNoticeV5 {
  targetFactId: string;
  replacementFactId: string;
  message: string;
}

function taskLabelForFact(graph: WeeklyPlanningFactGraphV5, factId: string): string | null {
  const workload = graph.workloads.find((fact) => fact.id === factId);
  if (workload) {
    return graph.tasks.find((task) => task.id === workload.taskId)?.title?.trim() || null;
  }
  const effort = graph.effortEstimates.find((fact) => fact.id === factId);
  if (effort) {
    return graph.tasks.find((task) => task.id === effort.taskId)?.title?.trim() || null;
  }
  const temporal = graph.temporalConstraints.find((fact) => fact.id === factId);
  if (temporal) {
    return graph.tasks.find((task) => task.id === temporal.taskId)?.title?.trim() || null;
  }
  const task = graph.tasks.find((fact) => fact.id === factId);
  return task?.title?.trim() || null;
}

function factLabel(
  graph: WeeklyPlanningFactGraphV5,
  reference: CanonicalSemanticReferenceV5,
  factId: string,
): string | null {
  if (reference.kind === 'workload') {
    const fact = graph.workloads.find((item) => item.id === factId);
    return fact ? `${fact.amount}${fact.unitLabel}` : reference.mention;
  }
  if (reference.kind === 'effort_estimate') {
    const fact = graph.effortEstimates.find((item) => item.id === factId);
    return fact ? `${fact.minutes}分` : reference.mention;
  }
  if (reference.kind === 'temporal_constraint') {
    const fact = graph.temporalConstraints.find((item) => item.id === factId);
    if (!fact) return reference.mention;
    if (fact.namedTimePeriod) return fact.namedTimePeriod;
    if (fact.startTime && fact.endTime) return `${fact.startTime}〜${fact.endTime}`;
    return fact.dateExpression ?? reference.mention;
  }
  if (reference.kind === 'task') {
    return graph.tasks.find((item) => item.id === factId)?.title ?? reference.mention;
  }
  if (reference.kind === 'component') {
    return graph.components.find((item) => item.id === factId)?.label ?? reference.mention;
  }
  if (reference.kind === 'planning_window') {
    const fact = graph.planningWindows.find((item) => item.id === factId);
    return fact?.start && fact.end ? `${fact.start}〜${fact.end}` : fact?.value ?? reference.mention;
  }
  return reference.mention;
}

export function createWeeklyPlanningSelfRepairNoticeV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  currentTurnId: string;
}): WeeklyPlanningSelfRepairNoticeV5 | null {
  const correction = [...params.graph.correctionIntents]
    .reverse()
    .find((item) =>
      item.source.turnId === params.currentTurnId
      && (item.operation === 'replace' || item.operation === 'modify')
      && Boolean(item.target.factId)
      && Boolean(item.replacementFactId));
  if (!correction?.target.factId || !correction.replacementFactId) return null;

  const before = factLabel(params.graph, correction.target, correction.target.factId);
  const after = factLabel(params.graph, correction.target, correction.replacementFactId);
  if (!before || !after || before === after) return null;
  const taskLabel = taskLabelForFact(params.graph, correction.replacementFactId)
    ?? taskLabelForFact(params.graph, correction.target.factId);
  const subject = taskLabel ? `${taskLabel}は` : '';
  return {
    targetFactId: correction.target.factId,
    replacementFactId: correction.replacementFactId,
    message: `${subject}${before}ではなく${after}ですね。修正しました。`,
  };
}
