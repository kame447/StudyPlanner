import type {
  EffortEstimateFact,
  PlanningTaskFact,
  StudyComponentFact,
  TaskRelationFact,
  TemporalConstraintFact,
  WeeklyPlanningFactDiff,
  WeeklyPlanningFactGraph,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';
import type {
  GenericPlanningWorkItem,
  GenericWorkItemCompilationResult,
  GenericWorkItemIssue,
} from './weeklyPlanningGenericWorkItems';

export type GenericDialogueReadinessStage =
  | 'needs_task'
  | 'needs_workload'
  | 'needs_resolution'
  | 'preview_ready';

export interface GenericDialogueAcknowledgementItem {
  factId: string;
  kind: 'task' | 'workload' | 'effort' | 'temporal' | 'relation';
  text: string;
}

export interface GenericDialogueQuestion {
  issueCode:
    | GenericWorkItemIssue['code']
    | 'missing_task'
    | 'missing_workload';
  targetFactId: string | null;
  text: string;
}

export interface GenericDialoguePolicySnapshot {
  graphRevision: number;
  readinessStage: GenericDialogueReadinessStage;
  acknowledgementItems: GenericDialogueAcknowledgementItem[];
  nextQuestion: GenericDialogueQuestion | null;
  blockingIssueCodes: GenericWorkItemIssue['code'][];
  workItemIds: string[];
}

export interface GenericDraftAuthorization {
  status: 'not_requested' | 'assistant_suggested' | 'user_authorized';
  conversationId: string;
  graphRevision: number | null;
}

export interface GenericPreviewGateResult {
  allowed: boolean;
  reasons: Array<
    | 'readiness_not_ready'
    | 'authorization_missing'
    | 'authorization_revision_mismatch'
    | 'blocking_compilation_issue'
    | 'unresolved_work_item'
    | 'missing_estimated_minutes'
  >;
}

const DISPLAY_UNIT_LABELS: Record<SemanticWorkloadUnitCode, string> = {
  minute: '分',
  hour: '時間',
  page: 'ページ',
  problem: '問',
  word: '語',
  lesson: '回',
  chapter: '章',
  section: '節',
  exam_year: '年分',
  mock_exam: '回',
  session: '回',
  custom: '単位',
};

function taskMap(graph: WeeklyPlanningFactGraph): Map<string, PlanningTaskFact> {
  return new Map(graph.tasks.map((task) => [task.id, task]));
}

function componentMap(graph: WeeklyPlanningFactGraph): Map<string, StudyComponentFact> {
  return new Map(graph.components.map((component) => [component.id, component]));
}

function workloadMap(graph: WeeklyPlanningFactGraph): Map<string, WorkloadFact> {
  return new Map(graph.workloads.map((workload) => [workload.id, workload]));
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(3)));
}

function workloadTargetLabel(params: {
  workload: WorkloadFact;
  tasks: Map<string, PlanningTaskFact>;
  components: Map<string, StudyComponentFact>;
}): string {
  if (params.workload.componentId) {
    return params.components.get(params.workload.componentId)?.label
      ?? params.tasks.get(params.workload.taskId)?.title
      ?? 'このタスク';
  }
  return params.tasks.get(params.workload.taskId)?.title ?? 'このタスク';
}

function formatWorkloadAcknowledgement(params: {
  workload: WorkloadFact;
  tasks: Map<string, PlanningTaskFact>;
  components: Map<string, StudyComponentFact>;
}): string {
  const target = workloadTargetLabel(params);
  const range = params.workload.rangeStart && params.workload.rangeEnd
    ? `（${params.workload.rangeStart}〜${params.workload.rangeEnd}）`
    : '';
  return `${target}を${formatAmount(params.workload.amount)}${params.workload.unitLabel}${range}`;
}

function formatTemporalAcknowledgement(params: {
  constraint: TemporalConstraintFact;
  tasks: Map<string, PlanningTaskFact>;
  components: Map<string, StudyComponentFact>;
}): string {
  const task = params.tasks.get(params.constraint.taskId);
  const target = params.constraint.targetFactId === params.constraint.taskId
    ? task?.title
    : params.components.get(params.constraint.targetFactId)?.label ?? task?.title;
  const label = target ?? 'このタスク';
  const approximate = params.constraint.precision === 'approximate' ? '頃' : '';
  switch (params.constraint.kind) {
    case 'earliest_start':
      return `${label}は${params.constraint.startTime ?? ''}${approximate}から`;
    case 'latest_end':
      return `${label}は${params.constraint.endTime ?? ''}${approximate}まで`;
    case 'fixed_interval':
      return `${label}は${params.constraint.startTime ?? ''}〜${params.constraint.endTime ?? ''}`;
    case 'deadline':
      return `${label}の締切は${params.constraint.dateExpression ?? params.constraint.endTime ?? ''}`;
    case 'preferred_window':
      return `${label}は${params.constraint.dateExpression ?? ''}${params.constraint.startTime ?? ''}${params.constraint.endTime ?? ''}が希望`;
    case 'avoid_window':
      return `${label}は${params.constraint.dateExpression ?? ''}${params.constraint.startTime ?? ''}${params.constraint.endTime ?? ''}を避ける`;
  }
}

function effortTargetLabel(params: {
  estimate: EffortEstimateFact;
  tasks: Map<string, PlanningTaskFact>;
  components: Map<string, StudyComponentFact>;
}): string {
  const task = params.tasks.get(params.estimate.taskId);
  if (params.estimate.targetFactId === params.estimate.taskId) {
    return task?.title ?? 'このタスク';
  }
  return params.components.get(params.estimate.targetFactId)?.label
    ?? task?.title
    ?? 'このタスク';
}

function formatEffortAcknowledgement(params: {
  estimate: EffortEstimateFact;
  tasks: Map<string, PlanningTaskFact>;
  components: Map<string, StudyComponentFact>;
}): string {
  const label = effortTargetLabel(params);
  const approximate = params.estimate.precision === 'approximate' ? '約' : '';
  if (params.estimate.kind === 'duration_per_unit') {
    const unitLabel = params.estimate.unitCode
      ? DISPLAY_UNIT_LABELS[params.estimate.unitCode]
      : '単位';
    return `${label}は1${unitLabel}あたり${approximate}${params.estimate.minutes}分`;
  }
  if (params.estimate.kind === 'session_duration') {
    return `${label}は1回${approximate}${params.estimate.minutes}分`;
  }
  return `${label}は合計${approximate}${params.estimate.minutes}分`;
}

function formatRelationAcknowledgement(
  relation: TaskRelationFact,
  tasks: Map<string, PlanningTaskFact>,
): string {
  const from = tasks.get(relation.fromTaskId)?.title ?? '前のタスク';
  const to = tasks.get(relation.toTaskId)?.title ?? '後のタスク';
  switch (relation.kind) {
    case 'before':
      return `${from}を${to}より先に進める`;
    case 'after':
      return `${from}を${to}の後に進める`;
    case 'depends_on':
      return `${from}は${to}の完了後に進める`;
    case 'priority_over':
      return `${from}を${to}より優先する`;
    case 'sequence':
      return `${from}の次に${to}を進める`;
  }
}

function deriveAcknowledgementItems(params: {
  graph: WeeklyPlanningFactGraph;
  diff: WeeklyPlanningFactDiff | null;
}): GenericDialogueAcknowledgementItem[] {
  if (!params.diff) return [];
  const added = new Map(params.diff.added.map((entry) => [entry.id, entry.kind]));
  const tasks = taskMap(params.graph);
  const components = componentMap(params.graph);
  const items: GenericDialogueAcknowledgementItem[] = [];

  for (const task of params.graph.tasks) {
    if (added.get(task.id) === 'task') {
      items.push({ factId: task.id, kind: 'task', text: `「${task.title}」` });
    }
  }
  for (const workload of params.graph.workloads) {
    if (added.get(workload.id) === 'workload') {
      items.push({
        factId: workload.id,
        kind: 'workload',
        text: formatWorkloadAcknowledgement({ workload, tasks, components }),
      });
    }
  }
  for (const estimate of params.graph.effortEstimates) {
    if (added.get(estimate.id) === 'effort_estimate') {
      items.push({
        factId: estimate.id,
        kind: 'effort',
        text: formatEffortAcknowledgement({ estimate, tasks, components }),
      });
    }
  }
  for (const constraint of params.graph.temporalConstraints) {
    if (added.get(constraint.id) === 'temporal_constraint') {
      items.push({
        factId: constraint.id,
        kind: 'temporal',
        text: formatTemporalAcknowledgement({ constraint, tasks, components }),
      });
    }
  }
  for (const relation of params.graph.relations) {
    if (added.get(relation.id) === 'relation') {
      items.push({
        factId: relation.id,
        kind: 'relation',
        text: formatRelationAcknowledgement(relation, tasks),
      });
    }
  }

  return items;
}

const ISSUE_PRIORITY: Record<GenericWorkItemIssue['code'], number> = {
  orphan_workload: 0,
  invalid_actual_range: 1,
  non_integral_discrete_amount: 2,
  quantity_role_unresolved: 3,
  ambiguous_effort_estimate: 4,
  missing_effort_estimate: 5,
  completed_workload_skipped: 99,
};

function selectBlockingIssue(
  compilation: GenericWorkItemCompilationResult,
): GenericWorkItemIssue | null {
  return [...compilation.issues]
    .filter((issue) => issue.blocking)
    .sort((left, right) =>
      ISSUE_PRIORITY[left.code] - ISSUE_PRIORITY[right.code]
      || left.workloadFactId.localeCompare(right.workloadFactId))[0] ?? null;
}

function questionForIssue(params: {
  issue: GenericWorkItemIssue;
  graph: WeeklyPlanningFactGraph;
}): GenericDialogueQuestion {
  const workloads = workloadMap(params.graph);
  const tasks = taskMap(params.graph);
  const components = componentMap(params.graph);
  const workload = workloads.get(params.issue.workloadFactId);
  const label = workload
    ? workloadTargetLabel({ workload, tasks, components })
    : 'この作業';

  switch (params.issue.code) {
    case 'quantity_role_unresolved':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}の量は、今回進めたい量ですか、それとも残っている全体量ですか？`,
      };
    case 'missing_effort_estimate':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}をこの量だけ進めるのに、どれくらい時間がかかりますか？`,
      };
    case 'ambiguous_effort_estimate':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}の所要時間の見積りが複数あります。今回使う見積りを教えてください。`,
      };
    case 'non_integral_discrete_amount':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}の量を、問題数やページ数などの整数単位で教えてください。`,
      };
    case 'invalid_actual_range':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}の対象範囲の開始と終了を教えてください。`,
      };
    case 'orphan_workload':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: 'この量がどのタスクに対応するか確認させてください。',
      };
    case 'completed_workload_skipped':
      return {
        issueCode: params.issue.code,
        targetFactId: params.issue.workloadFactId,
        text: `${label}は完了済みとして扱っています。`,
      };
  }
}

function firstTaskWithoutSchedulableWorkload(
  graph: WeeklyPlanningFactGraph,
): PlanningTaskFact | null {
  const taskIdsWithWork = new Set(
    graph.workloads
      .filter((workload) => workload.quantityRole !== 'completed')
      .map((workload) => workload.taskId),
  );
  return graph.tasks.find((task) => !taskIdsWithWork.has(task.id)) ?? null;
}

export function deriveGenericDialoguePolicy(params: {
  graph: WeeklyPlanningFactGraph;
  diff: WeeklyPlanningFactDiff | null;
  compilation: GenericWorkItemCompilationResult;
}): GenericDialoguePolicySnapshot {
  const blockingIssue = selectBlockingIssue(params.compilation);
  const taskWithoutWorkload = firstTaskWithoutSchedulableWorkload(params.graph);
  let readinessStage: GenericDialogueReadinessStage;
  let nextQuestion: GenericDialogueQuestion | null;

  if (params.graph.tasks.length === 0) {
    readinessStage = 'needs_task';
    nextQuestion = {
      issueCode: 'missing_task',
      targetFactId: null,
      text: '計画に入れたいタスクを教えてください。',
    };
  } else if (taskWithoutWorkload) {
    readinessStage = 'needs_workload';
    nextQuestion = {
      issueCode: 'missing_workload',
      targetFactId: taskWithoutWorkload.id,
      text: `「${taskWithoutWorkload.title}」をどれくらい進めたいですか？`,
    };
  } else if (blockingIssue) {
    readinessStage = 'needs_resolution';
    nextQuestion = questionForIssue({ issue: blockingIssue, graph: params.graph });
  } else {
    readinessStage = 'preview_ready';
    nextQuestion = null;
  }

  return {
    graphRevision: params.graph.revision,
    readinessStage,
    acknowledgementItems: deriveAcknowledgementItems({
      graph: params.graph,
      diff: params.diff,
    }),
    nextQuestion,
    blockingIssueCodes: params.compilation.issues
      .filter((issue) => issue.blocking)
      .map((issue) => issue.code),
    workItemIds: params.compilation.items.map((item) => item.id),
  };
}

function hasUnresolvedItem(items: GenericPlanningWorkItem[]): boolean {
  return items.some((item) => item.actionability !== 'actionable');
}

function hasMissingEstimate(items: GenericPlanningWorkItem[]): boolean {
  return items.some((item) => item.estimatedMinutes === null);
}

export function evaluateGenericPreviewGate(params: {
  conversationId: string;
  graph: WeeklyPlanningFactGraph;
  policy: GenericDialoguePolicySnapshot;
  compilation: GenericWorkItemCompilationResult;
  authorization: GenericDraftAuthorization;
}): GenericPreviewGateResult {
  const reasons: GenericPreviewGateResult['reasons'] = [];
  if (params.policy.readinessStage !== 'preview_ready') {
    reasons.push('readiness_not_ready');
  }
  if (params.authorization.status !== 'user_authorized'
    || params.authorization.conversationId !== params.conversationId) {
    reasons.push('authorization_missing');
  } else if (params.authorization.graphRevision !== params.graph.revision) {
    reasons.push('authorization_revision_mismatch');
  }
  if (params.compilation.issues.some((issue) => issue.blocking)) {
    reasons.push('blocking_compilation_issue');
  }
  if (hasUnresolvedItem(params.compilation.items)) {
    reasons.push('unresolved_work_item');
  }
  if (hasMissingEstimate(params.compilation.items)) {
    reasons.push('missing_estimated_minutes');
  }

  return { allowed: reasons.length === 0, reasons };
}
