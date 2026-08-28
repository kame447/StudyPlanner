import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningFactGraphV5, WorkloadFactV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  getWeeklyPlanningRegisteredMaterialSummariesV5,
  registeredMaterialProgressQuestionV5,
  type WeeklyPlanningRegisteredMaterialSummaryV5,
} from '../semantic/weeklyPlanningRegisteredMaterialContextV5';
import type { WeeklyPlanningStableQuestionV5 } from '../semantic/weeklyPlanningStableDialoguePolicyV5';

const QUESTION_SOURCE_EXCERPT_LIMIT = 80;

export type WeeklyPlanningStableV5MissingWorkIntent =
  | 'existing_target_progress'
  | 'missing_task_identity'
  | 'all_requested_work_complete';

function isSchedulableWorkload(workload: WorkloadFactV5): boolean {
  return workload.quantityRole !== 'completed' && workload.quantityRole !== 'scope_total';
}

function workloadsForTarget(params: {
  workloads: readonly WorkloadFactV5[];
  targetFactId: string;
  targetKind: 'task' | 'component';
}): WorkloadFactV5[] {
  return params.workloads.filter((workload) =>
    params.targetKind === 'component'
      ? workload.componentId === params.targetFactId
      : workload.taskId === params.targetFactId && workload.componentId === null);
}

function isPercentageCompletion(workload: WorkloadFactV5): boolean {
  return workload.quantityRole === 'completed'
    && workload.unitCode === 'custom'
    && workload.unitLabel.trim() === '%'
    && workload.amount >= 100;
}

function sameBoundedUnit(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return left.unitCode === right.unitCode
    && left.unitLabel.trim() === right.unitLabel.trim();
}

function targetIsComplete(params: {
  workloads: readonly WorkloadFactV5[];
  targetFactId: string;
  targetKind: 'task' | 'component';
}): boolean {
  const scoped = workloadsForTarget(params);
  if (scoped.some(isPercentageCompletion)) return true;

  const totals = scoped.filter((workload) => workload.quantityRole === 'scope_total');
  const completed = scoped.filter((workload) => workload.quantityRole === 'completed');
  return totals.some((total) => completed.some((done) =>
    sameBoundedUnit(total, done) && done.amount >= total.amount));
}

function taskIsComplete(params: {
  taskId: string;
  workloads: readonly WorkloadFactV5[];
  components: ReadonlyArray<WeeklyPlanningFactGraphV5['components'][number]>;
}): boolean {
  if (targetIsComplete({
    workloads: params.workloads,
    targetFactId: params.taskId,
    targetKind: 'task',
  })) return true;

  const taskComponents = params.components.filter((component) => component.taskId === params.taskId);
  if (taskComponents.length === 0) return false;
  const parentIds = new Set(
    taskComponents
      .map((component) => component.parentComponentId)
      .filter((componentId): componentId is string => Boolean(componentId)),
  );
  const leaves = taskComponents.filter((component) => !parentIds.has(component.id));
  return leaves.length > 0 && leaves.every((component) => targetIsComplete({
    workloads: params.workloads,
    targetFactId: component.id,
    targetKind: 'component',
  }));
}

function scopeTotalForTarget(params: {
  workloads: readonly WorkloadFactV5[];
  targetFactId: string;
  targetKind: 'task' | 'component';
}): WorkloadFactV5 | null {
  const candidates = params.workloads.filter((workload) =>
    workload.quantityRole === 'scope_total'
    && (params.targetKind === 'component'
      ? workload.componentId === params.targetFactId
      : workload.taskId === params.targetFactId && workload.componentId === null));
  return candidates.length === 1 ? candidates[0] : null;
}

function progressQuestion(params: {
  label: string;
  scopeTotal: WorkloadFactV5 | null;
  registeredMaterials: readonly WeeklyPlanningRegisteredMaterialSummaryV5[];
}): string {
  if (params.scopeTotal) {
    return `「${params.label}」は全${params.scopeTotal.amount}${params.scopeTotal.unitLabel}のうち、今どこまで終わっていますか？`;
  }
  const registeredQuestion = registeredMaterialProgressQuestionV5({
    label: params.label,
    materials: params.registeredMaterials,
  });
  if (registeredQuestion) return registeredQuestion;
  return `「${params.label}」は、大体何ページくらいありますか？ 問題集なら問題数でも大丈夫です。あわせて、今どこまで終わっているか教えてください。`;
}

export function stableV5MissingSchedulableWorkQuestion(
  graph: WeeklyPlanningFactGraphV5,
  ownerId?: string,
): {
  message: string;
  questionCode: 'missing_schedulable_work';
  taskTitles: string[];
  targetFactId: string | null;
  intent: WeeklyPlanningStableV5MissingWorkIntent;
} {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const registeredMaterials = ownerId
    ? getWeeklyPlanningRegisteredMaterialSummariesV5(ownerId)
    : [];
  const taskTitles = active.tasks.map((task) => task.title.trim()).filter(Boolean);
  const lifecycleByFactId = new Map(
    graph.factLifecycles.map((entry) => [entry.factId, entry] as const),
  );
  const resolvedBreakdownRevisionByTask = new Map<string, number>();
  graph.uncertainties.forEach((uncertainty) => {
    const lifecycle = lifecycleByFactId.get(uncertainty.id);
    if (
      uncertainty.field !== 'work_breakdown'
      || !uncertainty.targetFactId
      || !lifecycle
      || lifecycle.status === 'active'
    ) return;
    resolvedBreakdownRevisionByTask.set(
      uncertainty.targetFactId,
      Math.max(
        resolvedBreakdownRevisionByTask.get(uncertainty.targetFactId) ?? -1,
        uncertainty.createdRevision,
      ),
    );
  });

  const componentById = new Map(active.components.map((component) => [component.id, component]));
  const componentsCoveredByWorkload = new Set<string>();
  const markComponentAndAncestorsCovered = (initialComponentId: string | null): void => {
    let componentId = initialComponentId;
    while (componentId && !componentsCoveredByWorkload.has(componentId)) {
      componentsCoveredByWorkload.add(componentId);
      componentId = componentById.get(componentId)?.parentComponentId ?? null;
    }
  };
  active.workloads.filter(isSchedulableWorkload).forEach((workload) => {
    markComponentAndAncestorsCovered(workload.componentId);
  });
  active.components.forEach((component) => {
    if (targetIsComplete({
      workloads: active.workloads,
      targetFactId: component.id,
      targetKind: 'component',
    })) {
      markComponentAndAncestorsCovered(component.id);
    }
  });

  const parentComponentIds = new Set(
    active.components
      .map((component) => component.parentComponentId)
      .filter((componentId): componentId is string => Boolean(componentId)),
  );
  const rolePriority = new Map([
    'material', 'topic', 'chapter', 'section', 'skill', 'custom', 'subject', 'field',
  ].map((role, index) => [role, index]));
  const workloadlessComponents = active.components.filter((component) => {
    if (componentsCoveredByWorkload.has(component.id)) return false;
    const resolvedBreakdownRevision = resolvedBreakdownRevisionByTask.get(component.taskId);
    return resolvedBreakdownRevision === undefined
      || component.createdRevision > resolvedBreakdownRevision;
  });
  const leafComponents = workloadlessComponents.filter(
    (component) => !parentComponentIds.has(component.id),
  );
  const componentWithNoWorkload = (leafComponents.length > 0
    ? leafComponents
    : workloadlessComponents)
    .sort((left, right) =>
      right.createdRevision - left.createdRevision
      || (rolePriority.get(left.role) ?? 99) - (rolePriority.get(right.role) ?? 99))[0];
  if (componentWithNoWorkload) {
    return {
      message: progressQuestion({
        label: componentWithNoWorkload.label,
        scopeTotal: scopeTotalForTarget({
          workloads: active.workloads,
          targetFactId: componentWithNoWorkload.id,
          targetKind: 'component',
        }),
        registeredMaterials,
      }),
      questionCode: 'missing_schedulable_work',
      taskTitles,
      targetFactId: componentWithNoWorkload.id,
      intent: 'existing_target_progress',
    };
  }
  const taskWithNoWorkload = active.tasks.find(
    (task) => !active.workloads.some(
      (workload) => workload.taskId === task.id && isSchedulableWorkload(workload),
    ) && !taskIsComplete({
      taskId: task.id,
      workloads: active.workloads,
      components: active.components,
    }),
  );
  if (taskWithNoWorkload) {
    return {
      message: progressQuestion({
        label: taskWithNoWorkload.title,
        scopeTotal: scopeTotalForTarget({
          workloads: active.workloads,
          targetFactId: taskWithNoWorkload.id,
          targetKind: 'task',
        }),
        registeredMaterials,
      }),
      questionCode: 'missing_schedulable_work',
      taskTitles,
      targetFactId: taskWithNoWorkload.id,
      intent: 'existing_target_progress',
    };
  }

  const allRequestedWorkComplete = active.tasks.length > 0 && active.tasks.every((task) => taskIsComplete({
    taskId: task.id,
    workloads: active.workloads,
    components: active.components,
  }));
  if (allRequestedWorkComplete) {
    return {
      message: '指定された作業は完了済みです。予定に加えたい別の作業や、考慮したい予定・制約があれば教えてください。',
      questionCode: 'missing_schedulable_work',
      taskTitles,
      targetFactId: null,
      intent: 'all_requested_work_complete',
    };
  }

  return {
    message: '予定に入れる作業がまだありません。まず一つ、何を進めたいか教えてください。',
    questionCode: 'missing_schedulable_work',
    taskTitles,
    targetFactId: null,
    intent: 'missing_task_identity',
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
  ownerId?: string,
): string {
  const uncertainty = question.factId
    ? graph.uncertainties.find((fact) => fact.id === question.factId)
    : null;
  if (uncertainty?.field === 'work_breakdown' && uncertainty.targetFactId) {
    const task = graph.tasks.find((fact) => fact.id === uncertainty.targetFactId);
    const materialComponents = graph.components.filter((component) =>
      component.taskId === uncertainty.targetFactId && component.role === 'material');
    const label = materialComponents.length === 1
      ? materialComponents[0].label.trim()
      : task?.title?.trim() || 'この教材';
    const registeredQuestion = ownerId
      ? registeredMaterialProgressQuestionV5({
          label,
          materials: getWeeklyPlanningRegisteredMaterialSummariesV5(ownerId),
        })
      : null;
    if (registeredQuestion) return registeredQuestion;
    return `「${label}」は、大体何ページくらいありますか？ 問題集なら問題数でも大丈夫です。あわせて、今どこまで終わっているか教えてください。`;
  }
  const sourceText = uncertainty
    ? questionSourceExcerpt(uncertainty.source.sourceText)
    : '';
  if (!sourceText) {
    return '意味を一つに決められない条件があります。曖昧な部分だけ、もう少し具体的に教えてください。';
  }
  return `「${sourceText}」の意味を一つに決められませんでした。この部分だけ、もう少し具体的に教えてください。`;
}

function missingEffortQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
): string {
  const label = stableV5IssueTaskLabel(graph, question);
  const workload = question.factId
    ? graph.workloads.find((fact) => fact.id === question.factId) ?? null
    : null;

  if (question.effortMeasurement === 'session_duration') {
    return `${label}は、1回の学習を何分くらいにしますか？`;
  }
  if (question.effortMeasurement === 'duration_per_unit') {
    const unitLabel = workload?.unitLabel.trim();
    return unitLabel
      ? `${label}は1${unitLabel}あたりどれくらい時間がかかりますか？`
      : `${label}は1単位あたりどれくらい時間がかかりますか？`;
  }
  if (question.effortMeasurement === 'total_duration' && workload?.quantityRole === 'completed') {
    const unitLabel = workload.unitLabel.trim();
    const amountLabel = unitLabel
      ? `${workload.amount}${unitLabel}`
      : String(workload.amount);
    return `${label}の完了した${amountLabel}には、合計でどれくらい時間がかかりましたか？`;
  }
  return `${label}を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？`;
}

export function renderStableV5RuntimeQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
  ownerId?: string,
): string {
  const label = stableV5IssueTaskLabel(graph, question);
  switch (question.code) {
    case 'semantic_uncertainty':
      return semanticUncertaintyQuestion(graph, question, ownerId);
    case 'invalid_planning_horizon':
      return 'いつからいつまでの予定を作るか教えてください。例: 今日、今週、来週、7月25日から7月31日。';
    case 'ambiguous_planning_window':
      return '計画期間が複数あります。今回使う期間を一つ教えてください。';
    case 'quantity_role_unresolved':
      return `${label}の量は、今回進めたい量ですか、それとも残っている全体量ですか？`;
    case 'missing_effort_estimate':
      return missingEffortQuestion(graph, question);
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
