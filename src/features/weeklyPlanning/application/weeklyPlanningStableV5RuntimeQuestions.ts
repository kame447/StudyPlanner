import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningStableQuestionV5 } from '../semantic/weeklyPlanningStableDialoguePolicyV5';

const QUESTION_SOURCE_EXCERPT_LIMIT = 80;

export function stableV5MissingSchedulableWorkQuestion(
  graph: WeeklyPlanningFactGraphV5,
): { message: string; questionCode: 'missing_schedulable_work'; taskTitles: string[] } {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const taskTitles = active.tasks.map((task) => task.title.trim()).filter(Boolean);
  const componentWithNoWorkload = active.components.find(
    (component) => !active.workloads.some((workload) => workload.componentId === component.id),
  );
  if (componentWithNoWorkload) {
    return {
      message: `「${componentWithNoWorkload.label}」について、まず全体の範囲と、今どこまで終わっているかを教えてください。問題数・ページ数・単語数・章など、分かる単位で大丈夫です。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  const taskWithNoWorkload = active.tasks.find(
    (task) => !active.workloads.some((workload) => workload.taskId === task.id),
  );
  if (taskWithNoWorkload) {
    return {
      message: `「${taskWithNoWorkload.title}」について、まず全体の範囲と、今どこまで終わっているかを教えてください。分かる単位で大丈夫です。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  return {
    message: '予定に入れる作業がまだありません。まず一つ、何を進めたいか教えてください。',
    questionCode: 'missing_schedulable_work',
    taskTitles,
  };
}

export function stableV5IssueTaskLabel(
  graph: WeeklyPlanningFactGraphV5,
  issue: WeeklyPlanningStableQuestionV5,
): string {
  const taskId = typeof issue.details.taskId === 'string'
    ? issue.details.taskId
    : graph.workloads.find((workload) => workload.id === issue.factId)?.taskId;
  const task = taskId ? graph.tasks.find((fact) => fact.id === taskId) : null;
  const workload = issue.factId
    ? graph.workloads.find((fact) => fact.id === issue.factId)
    : null;
  const component = workload?.componentId
    ? graph.components.find((fact) => fact.id === workload.componentId)
    : null;
  return component?.label || task?.title || 'この予定';
}

function questionSourceExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= QUESTION_SOURCE_EXCERPT_LIMIT) return normalized;
  return `${normalized.slice(0, QUESTION_SOURCE_EXCERPT_LIMIT)}…`;
}

function semanticUncertaintyQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
): string {
  const uncertainty = question.factId
    ? graph.uncertainties.find((fact) => fact.id === question.factId)
    : null;
  if (uncertainty?.field === 'work_breakdown' && uncertainty.targetFactId) {
    const task = graph.tasks.find((fact) => fact.id === uncertainty.targetFactId);
    const label = task?.title?.trim() || 'この予定';
    return `「${label}」は、まず中身を分けて考えましょう。今残っているものをざっくり教えてもらえますか？`;
  }
  const sourceText = uncertainty
    ? questionSourceExcerpt(uncertainty.source.sourceText)
    : '';
  if (!sourceText) {
    return '意味を一つに決められない条件があります。曖昧な部分だけ、もう少し具体的に教えてください。';
  }
  return `「${sourceText}」の意味を一つに決められませんでした。この部分だけ、もう少し具体的に教えてください。`;
}

export function renderStableV5RuntimeQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
): string {
  const label = stableV5IssueTaskLabel(graph, question);
  switch (question.code) {
    case 'semantic_uncertainty':
      return semanticUncertaintyQuestion(graph, question);
    case 'invalid_planning_horizon':
      return 'いつからいつまでの予定を作るか教えてください。例: 今日、今週、来週、7月25日から7月31日。';
    case 'ambiguous_planning_window':
      return '計画期間が複数あります。今回使う期間を一つ教えてください。';
    case 'quantity_role_unresolved':
      return `${label}の量は、今回進めたい量ですか、それとも残っている全体量ですか？`;
    case 'missing_effort_estimate':
      return `${label}を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？`;
    case 'ambiguous_effort_estimate':
      return `${label}の所要時間が複数あります。今回使う見積りを一つ教えてください。`;
    case 'missing_availability_date_scope':
      return 'その空き時間または予定を入れられない時間は、どの日に適用しますか？';
    case 'missing_time_bounds':
    case 'invalid_time_interval':
      return 'その時間条件の開始時刻と終了時刻を教えてください。';
    case 'named_time_period_unresolved':
      return 'その時間帯が何時から何時までか教えてください。';
    case 'missing_commitment_date_scope':
      return `${label}は何日の固定予定ですか？`;
    case 'invalid_commitment_interval':
      return `${label}の開始時刻と終了時刻を教えてください。`;
    case 'conflicting_task_date_rule':
      return `${label}を同じ日に「行う」と「行わない」の両方で指定しています。どちらを採用しますか？`;
    case 'constraint_source_unavailable':
    case 'active_constraint_source_missing':
      return '指定された外部予定を確認できませんでした。時間割・登録済み予定・カレンダーのどれを使うか確認してください。';
    case 'orphan_relation_task':
    case 'self_relation':
      return 'タスクの順序関係を確認できませんでした。どの予定を先にするか教えてください。';
    default:
      return `${label}について、予定作成に必要な条件をもう少し具体的に教えてください。`;
  }
}

export function stableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return compilation.issues.find((issue) => issue.blocking)?.code;
}
