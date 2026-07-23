import type { WeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import type {
  GenericSchedulerInputCompilationResult,
  GenericSchedulerInputIssue,
} from './weeklyPlanningGenericSchedulerInput';

export interface GenericSchedulerDialogueQuestion {
  issueCode: string;
  targetFactId: string | null;
  text: string;
}

export interface GenericSchedulerDialoguePolicySnapshot {
  graphRevision: number;
  readinessStage:
    | 'needs_task'
    | 'needs_workload'
    | 'needs_resolution'
    | 'preview_ready';
  nextQuestion: GenericSchedulerDialogueQuestion | null;
  blockingIssueCodes: string[];
  schedulerStatus: GenericSchedulerInputCompilationResult['status'];
}

export interface GenericSchedulerDraftAuthorization {
  status: 'not_requested' | 'assistant_suggested' | 'user_authorized';
  conversationId: string;
  graphRevision: number | null;
}

export interface GenericSchedulerPreviewGateResult {
  allowed: boolean;
  reasons: Array<
    | 'scheduler_not_ready'
    | 'scheduler_input_missing'
    | 'authorization_missing'
    | 'authorization_conversation_mismatch'
    | 'authorization_revision_mismatch'
  >;
}

const SECURITY_ISSUES = new Set<string>([
  'constraint_source_owner_mismatch',
  'constraint_event_owner_mismatch',
  'invalid_constraint_event',
]);

const HORIZON_ISSUES = new Set<string>([
  'invalid_planning_horizon',
  'ambiguous_planning_window',
  'invalid_planning_date_range',
]);

const COMMITMENT_ISSUES = new Set<string>([
  'unsupported_commitment_date_expression',
  'missing_commitment_date_scope',
  'ambiguous_commitment_recurrence',
  'invalid_commitment_weekday',
  'invalid_commitment_interval',
  'unknown_commitment_constraint_level',
  'soft_fixed_interval_not_allowed',
]);

const TASK_DATE_RULE_ISSUES = new Set<string>([
  'orphan_task_date_rule',
  'invalid_task_date_rule_level',
  'unsupported_task_date_expression',
  'conflicting_task_date_rule',
]);

const SOURCE_ISSUES = new Set<string>([
  'constraint_source_unavailable',
  'active_constraint_source_missing',
]);

const AVAILABILITY_ISSUES = new Set<string>([
  'unsupported_date_expression',
  'missing_availability_date_scope',
  'missing_time_bounds',
  'named_time_period_unresolved',
  'unknown_constraint_level',
  'invalid_weekday',
  'invalid_time_interval',
]);

const RELATION_ISSUES = new Set<string>([
  'orphan_relation_task',
  'self_relation',
]);

const WORK_ISSUE_PRIORITY: Record<string, number> = {
  orphan_workload: 0,
  invalid_actual_range: 1,
  non_integral_discrete_amount: 2,
  quantity_role_unresolved: 3,
  ambiguous_effort_estimate: 4,
  missing_effort_estimate: 5,
};

function issueKey(issue: GenericSchedulerInputIssue): string {
  return `${issue.domain}:${issue.code}`;
}

function issueDetail(
  issue: GenericSchedulerInputIssue,
  key: string,
): unknown {
  const details = issue.details as Record<string, unknown> | undefined;
  return details?.[key];
}

function priority(issue: GenericSchedulerInputIssue): number {
  if (SECURITY_ISSUES.has(issue.code)) return 0;
  if (HORIZON_ISSUES.has(issue.code)) return 10;
  if (COMMITMENT_ISSUES.has(issue.code)) return 20;
  if (TASK_DATE_RULE_ISSUES.has(issue.code)) return 25;
  if (SOURCE_ISSUES.has(issue.code)) return 30;
  if (AVAILABILITY_ISSUES.has(issue.code)) return 40;
  if (RELATION_ISSUES.has(issue.code)) return 50;
  if (issue.domain === 'work_item') {
    return 60 + (WORK_ISSUE_PRIORITY[issue.code] ?? 20);
  }
  return 100;
}

function taskTitle(graph: WeeklyPlanningFactGraphV2, taskId: string | null): string {
  if (!taskId) return 'このタスク';
  return graph.tasks.find((task) => task.id === taskId)?.title ?? 'このタスク';
}

function taskIdFromIssue(issue: GenericSchedulerInputIssue): string | null {
  const value = issueDetail(issue, 'taskId');
  return typeof value === 'string' ? value : null;
}

function workloadLabel(
  graph: WeeklyPlanningFactGraphV2,
  workloadFactId: string,
): string {
  const workload = graph.workloads.find((fact) => fact.id === workloadFactId);
  if (!workload) return 'この作業';
  if (workload.componentId) {
    const component = graph.components.find((fact) => fact.id === workload.componentId);
    if (component) return component.label;
  }
  return taskTitle(graph, workload.taskId);
}

function namedTimeLabel(value: unknown): string {
  if (typeof value !== 'string') return 'その時間帯';
  const labels: Record<string, string> = {
    morning: '午前中',
    afternoon: '午後',
    evening: '夕方',
    night: '夜',
    before_sleep: '寝る前',
    before_meal: '食事前',
    after_meal: '食事後',
  };
  return labels[value] ?? value.replace(/^custom:/, '');
}

function questionForWorkIssue(
  issue: GenericSchedulerInputIssue,
  graph: WeeklyPlanningFactGraphV2,
): string {
  const label = workloadLabel(graph, issue.factId ?? '');
  switch (issue.code) {
    case 'quantity_role_unresolved':
      return `${label}の量は、今回進めたい量ですか、それとも残っている全体量ですか？`;
    case 'missing_effort_estimate':
      return `${label}をこの量だけ進めるのに、どれくらい時間がかかりますか？`;
    case 'ambiguous_effort_estimate':
      return `${label}の所要時間の見積りが複数あります。今回使う見積りを一つ教えてください。`;
    case 'non_integral_discrete_amount':
      return `${label}の量を、問題数やページ数などの整数単位で教えてください。`;
    case 'invalid_actual_range':
      return `${label}の対象範囲の開始と終了を教えてください。`;
    case 'orphan_workload':
      return 'この量がどのタスクに対応するか教えてください。';
    default:
      return `${label}について、予定作成に必要な条件を確認させてください。`;
  }
}

function questionForCommitmentIssue(
  issue: GenericSchedulerInputIssue,
  graph: WeeklyPlanningFactGraphV2,
): string {
  const title = taskTitle(graph, taskIdFromIssue(issue));
  switch (issue.code) {
    case 'unsupported_commitment_date_expression':
      return `${title}を固定する日を、具体的な日付で教えてください。`;
    case 'missing_commitment_date_scope':
      return `${title}は何日に固定する予定ですか？`;
    case 'ambiguous_commitment_recurrence':
      return `${title}の繰り返し条件が複数あります。今回使う条件を一つ教えてください。`;
    case 'invalid_commitment_weekday':
      return `${title}を行う曜日を確認させてください。`;
    case 'invalid_commitment_interval':
      return `${title}の開始時刻と終了時刻を教えてください。`;
    case 'unknown_commitment_constraint_level':
      return `${title}の時間は動かせない予定ですか、それとも希望時間ですか？`;
    case 'soft_fixed_interval_not_allowed':
      return `${title}はその時間に固定ですか、それともその時間帯が希望ですか？`;
    default:
      return `${title}の固定予定を確認させてください。`;
  }
}

function questionForTaskDateRuleIssue(
  issue: GenericSchedulerInputIssue,
  graph: WeeklyPlanningFactGraphV2,
): string {
  const title = taskTitle(graph, taskIdFromIssue(issue));
  const dateValue = issueDetail(issue, 'date');
  const date = typeof dateValue === 'string' ? dateValue : '同じ日';
  switch (issue.code) {
    case 'unsupported_task_date_expression':
      return `${title}を行う日、または行わない日を具体的な日付で教えてください。`;
    case 'conflicting_task_date_rule':
      return `${title}を${date}に行う指定と、行わない指定が両方あります。どちらを採用しますか？`;
    case 'orphan_task_date_rule':
      return 'この特定日指定がどのタスクに対応するか教えてください。';
    case 'invalid_task_date_rule_level':
      return `${title}の特定日指定は、必ず守る条件として扱ってよいですか？`;
    default:
      return `${title}の実行日または除外日を確認させてください。`;
  }
}

function questionForAvailabilityIssue(issue: GenericSchedulerInputIssue): string {
  switch (issue.code) {
    case 'unsupported_date_expression':
      return 'その空き時間または利用できない時間が、具体的にいつか教えてください。';
    case 'missing_availability_date_scope':
      return 'その時間条件は、どの日に適用しますか？';
    case 'missing_time_bounds':
      return 'その時間条件の開始時刻と終了時刻を教えてください。';
    case 'named_time_period_unresolved':
      return `${namedTimeLabel(issueDetail(issue, 'namedTimePeriod'))}は、何時から何時までですか？`;
    case 'unknown_constraint_level':
      return 'その時間条件は必ず守る必要がありますか、それとも希望ですか？';
    case 'invalid_weekday':
      return 'その時間条件を適用する曜日を教えてください。';
    case 'invalid_time_interval':
      return 'その時間条件の開始時刻と終了時刻を確認させてください。';
    default:
      return '利用できる時間について、もう少し具体的に教えてください。';
  }
}

function sourceLabel(issue: GenericSchedulerInputIssue): string {
  const kindValue = issueDetail(issue, 'kind');
  const kind = typeof kindValue === 'string' ? kindValue : '予定データ';
  const labels: Record<string, string> = {
    timetable: '時間割',
    existing_plans: '登録済み予定',
    calendar: 'カレンダー',
  };
  return labels[kind] ?? '予定データ';
}

function questionForSourceIssue(issue: GenericSchedulerInputIssue): string {
  const label = sourceLabel(issue);
  if (issue.code === 'active_constraint_source_missing') {
    return `使用する${label}が設定されていません。対象を設定するか、${label}を使わずに進めてください。`;
  }

  const failureKind = issueDetail(issue, 'failureKind');
  const attemptCountValue = issueDetail(issue, 'attemptCount');
  const attemptCount = typeof attemptCountValue === 'number' ? attemptCountValue : 0;
  switch (failureKind) {
    case 'authentication_error':
      return `${label}の認証を確認できませんでした。接続設定を確認してください。入力済みの計画内容は保持しています。`;
    case 'permission_error':
      return `${label}を読む権限がありません。権限設定を確認するか、${label}を使わずに進めてください。入力済みの計画内容は保持しています。`;
    case 'source_not_configured':
      return `使用する${label}が設定されていません。対象を設定するか、${label}を使わずに進めてください。`;
    case 'invalid_response':
      return `${label}のデータを安全に確認できなかったため、予定には反映していません。設定を確認してください。入力済みの計画内容は保持しています。`;
    default: {
      const attempts = attemptCount > 1 ? `自動で${attemptCount}回取得しましたが、` : '';
      return `${label}を${attempts}確認できなかったため、まだ予定には反映していません。${label}を使わずに進めるか、設定を確認してください。入力済みの計画内容は保持しています。`;
    }
  }
}

function questionForIssue(
  issue: GenericSchedulerInputIssue,
  graph: WeeklyPlanningFactGraphV2,
): GenericSchedulerDialogueQuestion {
  let text: string;
  if (SECURITY_ISSUES.has(issue.code)) {
    text = '予定データを安全に確認できなかったため、その予定は反映していません。設定を確認してください。入力済みの計画内容は保持しています。';
  } else if (issue.code === 'invalid_planning_horizon') {
    text = '計画する期間の開始日と終了日を教えてください。';
  } else if (issue.code === 'ambiguous_planning_window') {
    text = '計画期間が複数あります。今回使う期間を一つ選んでください。';
  } else if (issue.domain === 'commitment') {
    text = questionForCommitmentIssue(issue, graph);
  } else if (issue.domain === 'task_date_rule') {
    text = questionForTaskDateRuleIssue(issue, graph);
  } else if (issue.domain === 'availability' && SOURCE_ISSUES.has(issue.code)) {
    text = questionForSourceIssue(issue);
  } else if (issue.domain === 'availability') {
    text = questionForAvailabilityIssue(issue);
  } else if (issue.domain === 'relation') {
    text = issue.code === 'self_relation'
      ? '同じタスク同士の順序関係になっています。どのタスクを先にするか教えてください。'
      : '順序関係の対象タスクを確認できませんでした。どのタスク同士の順序か教えてください。';
  } else if (issue.domain === 'work_item') {
    text = questionForWorkIssue(issue, graph);
  } else {
    text = '予定作成に必要な条件を確認させてください。';
  }

  return {
    issueCode: issueKey(issue),
    targetFactId: issue.factId,
    text,
  };
}

function selectBlockingIssue(
  issues: GenericSchedulerInputIssue[],
): GenericSchedulerInputIssue | null {
  return [...issues]
    .filter((issue) => issue.blocking)
    .sort((left, right) =>
      priority(left) - priority(right)
      || String(left.factId).localeCompare(String(right.factId)))[0] ?? null;
}

export function deriveGenericSchedulerDialoguePolicy(params: {
  graph: WeeklyPlanningFactGraphV2;
  compilation: GenericSchedulerInputCompilationResult;
}): GenericSchedulerDialoguePolicySnapshot {
  if (params.graph.tasks.length === 0) {
    return {
      graphRevision: params.graph.revision,
      readinessStage: 'needs_task',
      nextQuestion: {
        issueCode: 'missing_task',
        targetFactId: null,
        text: '計画に入れたいタスクを教えてください。',
      },
      blockingIssueCodes: [],
      schedulerStatus: params.compilation.status,
    };
  }

  const blockingIssue = selectBlockingIssue(params.compilation.issues);
  if (blockingIssue) {
    return {
      graphRevision: params.graph.revision,
      readinessStage: 'needs_resolution',
      nextQuestion: questionForIssue(blockingIssue, params.graph),
      blockingIssueCodes: params.compilation.issues
        .filter((issue) => issue.blocking)
        .map(issueKey),
      schedulerStatus: params.compilation.status,
    };
  }

  if (params.compilation.status === 'empty' || !params.compilation.input) {
    const task = params.graph.tasks[0];
    return {
      graphRevision: params.graph.revision,
      readinessStage: 'needs_workload',
      nextQuestion: {
        issueCode: 'missing_schedulable_work',
        targetFactId: task?.id ?? null,
        text: `「${task?.title ?? 'このタスク'}」をどれくらい進めたいですか？`,
      },
      blockingIssueCodes: [],
      schedulerStatus: params.compilation.status,
    };
  }

  return {
    graphRevision: params.graph.revision,
    readinessStage: 'preview_ready',
    nextQuestion: null,
    blockingIssueCodes: [],
    schedulerStatus: params.compilation.status,
  };
}

export function evaluateGenericSchedulerPreviewGate(params: {
  conversationId: string;
  graph: WeeklyPlanningFactGraphV2;
  compilation: GenericSchedulerInputCompilationResult;
  authorization: GenericSchedulerDraftAuthorization;
}): GenericSchedulerPreviewGateResult {
  const reasons: GenericSchedulerPreviewGateResult['reasons'] = [];
  if (params.compilation.status !== 'ready') reasons.push('scheduler_not_ready');
  if (!params.compilation.input) reasons.push('scheduler_input_missing');
  if (params.authorization.status !== 'user_authorized') {
    reasons.push('authorization_missing');
  }
  if (params.authorization.conversationId !== params.conversationId) {
    reasons.push('authorization_conversation_mismatch');
  }
  if (params.authorization.graphRevision !== params.graph.revision) {
    reasons.push('authorization_revision_mismatch');
  }
  return {
    allowed: reasons.length === 0,
    reasons,
  };
}
