import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from './weeklyPlanningEffortQuestionPolicyV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

function targetLabel(graph: WeeklyPlanningFactGraphV5, taskId: string, componentId: string | null): string {
  if (componentId) {
    const component = graph.components.find((fact) => fact.id === componentId);
    if (component?.label.trim()) return component.label.trim();
  }
  return graph.tasks.find((fact) => fact.id === taskId)?.title.trim() || 'この作業';
}

function quantityText(amount: number, unitLabel: string): string {
  return `${amount}${unitLabel}`;
}

export function renderWeeklyPlanningEffortQuestionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  workloadFactId: string;
}): string | null {
  const workload = params.graph.workloads.find((fact) => fact.id === params.workloadFactId);
  if (!workload) return null;
  const label = targetLabel(params.graph, workload.taskId, workload.componentId);
  const plan = createWeeklyPlanningEffortQuestionPlanV5(workload);

  if (workload.quantityRole === 'completed') {
    return `${label}について、完了した${quantityText(workload.amount, workload.unitLabel)}には、合計でどれくらい時間がかかりましたか？`;
  }

  if (plan.kind === 'duration_per_unit') {
    return `${label}について、1${workload.unitLabel}あたりどれくらい時間がかかりますか？`;
  }

  if (workload.unitCode === 'word' && plan.kind === 'total_duration') {
    return `${label}について、${quantityText(workload.amount, workload.unitLabel)}を一通り覚えるために、合計でどれくらい時間がかかりそうですか？`;
  }

  return `${label}について、指定した量を進めるのに合計でどれくらい時間がかかりますか？`;
}

export function rewriteWeeklyPlanningEffortQuestionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  workloadFactId: string;
  message: string;
}): string {
  const workload = params.graph.workloads.find((fact) => fact.id === params.workloadFactId);
  if (!workload) return params.message;
  const label = targetLabel(params.graph, workload.taskId, workload.componentId);
  const previous = `${label}を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？`;
  const next = renderWeeklyPlanningEffortQuestionV5(params);
  if (!next || !params.message.includes(previous)) return params.message;
  return params.message.replace(previous, next);
}
