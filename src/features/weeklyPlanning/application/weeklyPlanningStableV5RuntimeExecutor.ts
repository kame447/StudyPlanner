import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
import {
  stageUserPlanningContextFactsV1,
  userPlanningContextPromptSummaryV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  collectUserPlanningContextFactsV5,
} from '../semantic/weeklyPlanningDurableContextSignalsV5';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type {
  ExternalConstraintSourceSnapshot,
} from '../semantic/weeklyPlanningAvailabilityResolver';
import {
  addCalendarDays,
  isValidCalendarDate,
  listCalendarDatesInclusive,
  resolveCanonicalDateExpression,
} from '../semantic/weeklyPlanningCalendarResolver';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
  type GenericSchedulerInputContext,
  type GenericSchedulerInputIssue,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from '../semantic/weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from '../semantic/weeklyPlanningSemanticPipelineV5';
import {
  decideWeeklyPlanningStableDialogueV5,
  type WeeklyPlanningStableQuestionV5,
} from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import {
  scheduleWeeklyPlanningStableV5Preview,
  WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

const RECENT_TURN_LIMIT = 8;
const DEFAULT_PLANNING_DAY_COUNT = 7;
const QUESTION_SOURCE_EXCERPT_LIMIT = 80;

export interface ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  conversationId: string;
  traceRequestId: string;
}

function emptyCompatibilityState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function compatibilityState(params: {
  previousState?: PlanningIntakeState;
  userText: string;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  questionCode?: string;
  questionFactId?: string;
  authorized: boolean;
}): PlanningIntakeState {
  const previous = params.previousState ?? emptyCompatibilityState();
  const hasDraft = params.draftCandidates.length > 0;
  return {
    ...previous,
    status: hasDraft
      ? 'draft_ready'
      : params.questionCode
        ? 'revision_pending'
        : 'needs_scope',
    intent: 'weekly_study_planning',
    missing: [],
    questions: params.questionCode ? [params.message] : [],
    lastQuestionContext: params.questionCode
      ? {
          kind: 'missing',
          targetSlot: `stable_v5:${params.questionCode}`,
          intent: params.questionCode,
          topicId: params.questionFactId,
        }
      : undefined,
    shouldCreateDraft: hasDraft,
    shouldSavePlan: false,
    draftGenerationIntent: params.authorized ? 'user_authorized' : 'not_requested',
    sourceTurns: [...previous.sourceTurns, params.userText].slice(-32),
  };
}

function activePlanningWindows(graph: WeeklyPlanningFactGraphV5) {
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return graph.planningWindows.filter((window) => activeIds.has(window.id));
}

function resolvePlanningHorizon(params: {
  graph: WeeklyPlanningFactGraphV5;
  selectedDate: string;
}): { startDate: string; endDate: string } | null {
  const windows = activePlanningWindows(params.graph);
  if (windows.length > 1) return null;
  if (windows.length === 0) {
    const endDate = addCalendarDays(params.selectedDate, DEFAULT_PLANNING_DAY_COUNT - 1);
    return endDate ? { startDate: params.selectedDate, endDate } : null;
  }

  const window = windows[0];
  if (window.start && window.end) {
    if (
      isValidCalendarDate(window.start)
      && isValidCalendarDate(window.end)
      && window.start <= window.end
    ) {
      return { startDate: window.start, endDate: window.end };
    }
    return null;
  }

  const expression = window.value.trim();
  const resolution = resolveCanonicalDateExpression({
    expression,
    currentDate: params.selectedDate,
  });
  return resolution.status === 'resolved'
    ? { startDate: resolution.range.start, endDate: resolution.range.end }
    : null;
}

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

function schedulerContext(params: {
  ownerId: string;
  selectedDate: string;
  horizon: { startDate: string; endDate: string } | null;
}): GenericSchedulerInputContext {
  return {
    ownerId: params.ownerId,
    currentDate: params.selectedDate,
    planningStartDate: params.horizon?.startDate ?? '',
    planningEndDate: params.horizon?.endDate ?? '',
    timeZone: timeZone(),
    namedTimePeriods: {
      morning: { startTime: '06:00', endTime: '12:00' },
      afternoon: { startTime: '12:00', endTime: '17:00' },
      evening: { startTime: '17:00', endTime: '21:00' },
      night: { startTime: '21:00', endTime: '24:00' },
      before_sleep: { startTime: '21:00', endTime: '24:00' },
    },
  };
}

function existingPlanSource(params: {
  ownerId: string;
  plans: readonly Plan[];
  horizon: { startDate: string; endDate: string } | null;
}): ExternalConstraintSourceSnapshot {
  const dates = params.horizon
    ? new Set(listCalendarDatesInclusive(params.horizon.startDate, params.horizon.endDate) ?? [])
    : new Set<string>();
  return {
    kind: 'existing_plans',
    status: 'success',
    ownerId: params.ownerId,
    activeSourceId: 'studyplanner-existing-plans',
    attemptCount: 1,
    events: params.plans
      .filter((plan) => dates.has(plan.date))
      .map((plan) => ({
        eventId: plan.id,
        ownerId: params.ownerId,
        start: { date: plan.date, time: plan.startTime },
        end: { date: plan.date, time: plan.endTime },
        timeZone: timeZone(),
        constraintLevel: 'hard' as const,
      })),
  };
}

function timetableSource(params: {
  ownerId: string;
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  horizon: { startDate: string; endDate: string } | null;
}): ExternalConstraintSourceSnapshot {
  const termId = params.timetableTermId ?? 'default';
  const dates = params.horizon
    ? listCalendarDatesInclusive(params.horizon.startDate, params.horizon.endDate) ?? []
    : [];
  const templates = params.templates.filter(
    (template) => (template.termId || 'default') === termId,
  );
  return {
    kind: 'timetable',
    status: 'success',
    ownerId: params.ownerId,
    activeSourceId: `studyplanner-timetable:${termId}`,
    attemptCount: 1,
    events: dates.flatMap((date) =>
      buildTimetableImportCandidates({
        templates,
        date,
        weekday: getRecurrenceWeekday(date),
        termId,
      }).map((candidate) => ({
        eventId: candidate.sourceId,
        ownerId: params.ownerId,
        start: { date, time: candidate.startTime },
        end: { date, time: candidate.endTime },
        timeZone: timeZone(),
        constraintLevel: 'hard' as const,
      }))),
  };
}

function externalSources(params: {
  ownerId: string;
  plans: readonly Plan[];
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  horizon: { startDate: string; endDate: string } | null;
}): ExternalConstraintSourceSnapshot[] {
  return [
    existingPlanSource({
      ownerId: params.ownerId,
      plans: params.plans,
      horizon: params.horizon,
    }),
    timetableSource({
      ownerId: params.ownerId,
      templates: params.templates,
      timetableTermId: params.timetableTermId,
      horizon: params.horizon,
    }),
    {
      kind: 'calendar',
      status: 'failure',
      ownerId: params.ownerId,
      activeSourceId: null,
      failureKind: 'source_not_configured',
      attemptCount: 1,
    },
  ];
}

function pendingQuestionFromState(
  state: PlanningIntakeState | undefined,
  graphRevision: number,
): Record<string, unknown> | null {
  const context = state?.lastQuestionContext;
  const targetSlot = context?.targetSlot;
  if (!targetSlot?.startsWith('stable_v5:')) return null;
  const questionCode = targetSlot.slice('stable_v5:'.length).trim();
  if (!questionCode) return null;
  return {
    actionId: context?.actionId ?? null,
    questionCode,
    targetFactId: context?.topicId ?? null,
    graphRevision,
  };
}

function publicStateSummary(
  graph: WeeklyPlanningFactGraphV5,
  messages: readonly WeeklyPlanningMessage[],
  previousState?: PlanningIntakeState,
  ownerId?: string,
  currentDate?: string,
): Record<string, unknown> {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: graph.revision,
    pendingQuestion: pendingQuestionFromState(previousState, graph.revision),
    planningWindows: active.planningWindows.map((fact) => ({
      publicId: fact.id,
      kind: fact.kind,
      value: fact.value,
      start: fact.start,
      end: fact.end,
    })),
    tasks: active.tasks.map((task) => ({
      publicId: task.id,
      category: task.category,
      title: task.title,
    })),
    components: active.components.map((component) => ({
      publicId: component.id,
      taskPublicId: component.taskId,
      label: component.label,
      role: component.role,
    })),
    workloads: active.workloads.map((workload) => ({
      publicId: workload.id,
      taskPublicId: workload.taskId,
      componentPublicId: workload.componentId,
      quantityRole: workload.quantityRole,
      amount: workload.amount,
      unitCode: workload.unitCode,
      unitLabel: workload.unitLabel,
    })),
    uncertainties: active.uncertainties.map((uncertainty) => ({
      publicId: uncertainty.id,
      targetPublicId: uncertainty.targetFactId,
      field: uncertainty.field,
      reason: uncertainty.reason,
      sourceText: uncertainty.source.sourceText,
    })),
    userPlanningContext: ownerId && currentDate
      ? userPlanningContextPromptSummaryV1({ ownerId, currentDate })
      : [],
    lastAssistantMessage:
      [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? null,
  };
}

function missingSchedulableWorkQuestion(
  graph: WeeklyPlanningFactGraphV5,
): { message: string; questionCode?: string; taskTitles: string[] } {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const taskTitles = active.tasks.map((task) => task.title.trim()).filter(Boolean);
  const componentWithNoWorkload = active.components.find(
    (component) => !active.workloads.some((workload) => workload.componentId === component.id),
  );
  if (componentWithNoWorkload) {
    return {
      message: `「${componentWithNoWorkload.label}」は、どこまで進めたいですか？ページ数・問題数・範囲など、分かる形で教えてください。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  const taskWithNoWorkload = active.tasks.find(
    (task) => !active.workloads.some((workload) => workload.taskId === task.id),
  );
  if (taskWithNoWorkload) {
    return {
      message: `「${taskWithNoWorkload.title}」は、どこまで進めたいですか？量や範囲が分かれば教えてください。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  return {
    message: '予定に入れる作業量がまだありません。まず一つ、どこまで進めたいか教えてください。',
    questionCode: 'missing_schedulable_work',
    taskTitles,
  };
}

function issueTaskLabel(
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

function renderQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
): string {
  const label = issueTaskLabel(graph, question);
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

function blockingQuestionCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return compilation.issues.find((issue: GenericSchedulerInputIssue) => issue.blocking)?.code;
}

function traceBranch(params: {
  requestId: string;
  branch: string;
  basis: unknown;
  output: unknown;
  severity?: 'debug' | 'info' | 'warn' | 'error';
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.requestId,
    stage: 'runtime_branch_selected',
    severity: params.severity ?? 'info',
    data: {
      branch: params.branch,
      basis: params.basis,
      output: params.output,
    },
  });
}

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_configuration_evaluated',
    severity: aiConfig.provider === 'rules' || configError ? 'error' : 'info',
    data: {
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      configError,
      criteria: {
        rulesProviderRejected: true,
        validConfigurationRequired: true,
      },
    },
  });
  if (aiConfig.provider === 'rules' || configError) {
    throw new Error(configError ?? 'Stable V5にはAI structured output接続が必要です。');
  }

  const runtimeSession = getOrCreateWeeklyPlanningStableV5RuntimeSession({
    ownerId: input.userId,
    conversationId: input.conversationId,
  });
  const activeWindowsBefore = activePlanningWindows(runtimeSession.graph);
  const fallbackHorizon = resolvePlanningHorizon({
    graph: runtimeSession.graph,
    selectedDate: input.selectedDate,
  });
  const recentConversation = input.messages
    .slice(-RECENT_TURN_LIMIT)
    .map(({ role, content }) => ({ role, content }));
  const stateSummary = publicStateSummary(
    runtimeSession.graph,
    input.messages,
    input.previousState,
    input.userId,
    input.selectedDate,
  );
  const initialSchedulerContext = schedulerContext({
    ownerId: input.userId,
    selectedDate: input.selectedDate,
    horizon: fallbackHorizon,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_session_context_prepared',
    data: {
      runtimeSession,
      graphRevision: runtimeSession.graph.revision,
      activePlanningWindows: activeWindowsBefore,
      selectedDate: input.selectedDate,
      fallbackHorizon,
      horizonCriteria: {
        moreThanOneActiveWindow: 'return null',
        noActiveWindow: `selectedDate plus ${DEFAULT_PLANNING_DAY_COUNT - 1} days`,
        explicitStartEnd: 'valid dates and start <= end',
        otherwise: 'resolveCanonicalDateExpression(window.value, selectedDate)',
      },
      recentTurnLimit: RECENT_TURN_LIMIT,
      recentConversation,
      publicStateSummary: stateSummary,
      schedulerContext: initialSchedulerContext,
    },
  });

  const normalizer = createWeeklyPlanningSemanticNormalizerV5(
    createOpenAiCompatibleClient(aiConfig),
  );
  const pipeline = createWeeklyPlanningSemanticPipelineV5(normalizer);
  const semantic = await pipeline.run({
    graph: runtimeSession.graph,
    conversationId: input.conversationId,
    turnId: input.traceRequestId,
    expectedRevision: runtimeSession.graph.revision,
    userText: input.userText,
    recentConversation,
    publicStateSummary: stateSummary,
    schedulerContext: initialSchedulerContext,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_semantic_result_received',
    severity: semantic.status === 'normalization_rejected'
      || semantic.status === 'provider_failure'
      || semantic.status === 'canonicalization_rejected'
      ? 'error'
      : 'info',
    data: semantic,
  });

  if (semantic.status === 'provider_failure') {
    const message = 'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized: false,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'provider_failure',
      basis: { semanticStatus: semantic.status },
      output,
      severity: 'error',
    });
    return output;
  }
  if (semantic.status === 'normalization_rejected') {
    const message = 'こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized: false,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'normalization_rejected',
      basis: { semanticStatus: semantic.status, normalization: semantic.normalization },
      output,
      severity: 'error',
    });
    return output;
  }
  if (semantic.status === 'canonicalization_rejected') {
    const message = '直前の会話状態と構造化結果が一致しなかったため、変更は反映していません。直前に確認していた項目だけ、短く一つ教えてください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized: false,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'canonicalization_rejected',
      basis: {
        semanticStatus: semantic.status,
        expectedRevision: runtimeSession.graph.revision,
        actualInputGraphRevision: runtimeSession.graph.revision,
        canonicalization: semantic.canonicalization,
      },
      output,
      severity: 'error',
    });
    return output;
  }

  const userContextFacts = semantic.normalization.document
    ? collectUserPlanningContextFactsV5(semantic.normalization.document)
    : [];
  stageUserPlanningContextFactsV1({
    ownerId: input.userId,
    conversationId: input.conversationId,
    requestId: input.traceRequestId,
    observedDate: input.selectedDate,
    facts: userContextFacts,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_user_context_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      userContextFacts,
    },
  });

  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: input.userId,
    conversationId: input.conversationId,
    graph: semantic.graph,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_graph_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      previousGraphRevision: runtimeSession.graph.revision,
      stagedGraph: semantic.graph,
      canonicalization: semantic.canonicalization,
    },
  });

  const activeWindowsAfter = activePlanningWindows(semantic.graph);
  const horizon = resolvePlanningHorizon({
    graph: semantic.graph,
    selectedDate: input.selectedDate,
  });
  const context = schedulerContext({
    ownerId: input.userId,
    selectedDate: input.selectedDate,
    horizon,
  });
  const sources = externalSources({
    ownerId: input.userId,
    plans: input.plans,
    templates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    horizon,
  });
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(semantic.graph);
  const compilation = compileGenericSchedulerInput({
    graph: activeGraph,
    context,
    externalSources: sources,
  });
  const dialogue = decideWeeklyPlanningStableDialogueV5(compilation);
  const authorized = semantic.normalization.document?.planningIntent === 'create_plan';
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_scheduler_dialogue_evaluated',
    severity: dialogue.status === 'ask_question' ? 'warn' : 'info',
    data: {
      activePlanningWindows: activeWindowsAfter,
      resolvedHorizon: horizon,
      horizonCriteria: {
        moreThanOneActiveWindow: 'return null',
        noActiveWindow: `selectedDate plus ${DEFAULT_PLANNING_DAY_COUNT - 1} days`,
        explicitStartEnd: 'valid dates and start <= end',
        otherwise: 'resolveCanonicalDateExpression(window.value, selectedDate)',
      },
      schedulerInput: {
        graph: activeGraph,
        context,
        externalSources: sources,
      },
      compilation,
      dialogue,
      dialoguePolicyCriteria: {
        blockingIssuesFirst: true,
        domainPriority: [
          'semantic_uncertainty',
          'planning_horizon',
          'availability',
          'commitment',
          'task_date_rule',
          'work_item',
          'relation',
          'deduplication',
        ],
        blockingIssueSortKey: 'domainPriority|domain|code|factId',
        readyForPreview: 'no blocking issue and compilation.status === ready and compilation.input exists',
        otherwise: 'nothing_to_schedule',
      },
      firstBlockingIssueCodeInCompilationOrder: blockingQuestionCode(compilation) ?? null,
      selectedQuestion: dialogue.status === 'ask_question' ? dialogue.question : null,
      authorization: {
        planningIntent: semantic.normalization.document?.planningIntent ?? null,
        criterion: 'planningIntent === create_plan',
        authorized,
      },
    },
  });

  if (dialogue.status === 'ask_question') {
    const message = renderQuestion(semantic.graph, dialogue.question);
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        questionCode: dialogue.question.code,
        questionFactId: dialogue.question.factId ?? undefined,
        authorized,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'ask_question',
      basis: {
        dialogue,
        renderedQuestion: message,
        issueLabel: issueTaskLabel(semantic.graph, dialogue.question),
      },
      output,
      severity: 'warn',
    });
    return output;
  }
  if (dialogue.status === 'nothing_to_schedule' || !compilation.input) {
    const missingWork = missingSchedulableWorkQuestion(semantic.graph);
    const message = missingWork.message;
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        questionCode: missingWork.questionCode,
        authorized,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'nothing_to_schedule',
      basis: {
        dialogueStatus: dialogue.status,
        compilationStatus: compilation.status,
        compilationInputExists: Boolean(compilation.input),
        recognizedTaskTitles: missingWork.taskTitles,
        questionCode: missingWork.questionCode ?? null,
      },
      output,
      severity: 'warn',
    });
    return output;
  }
  if (!authorized) {
    const message = '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized: false,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'authorization_required',
      basis: {
        planningIntent: semantic.normalization.document?.planningIntent ?? null,
        criterion: 'planningIntent !== create_plan',
      },
      output,
    });
    return output;
  }

  const previewInput = {
    input: compilation.input,
    graph: semantic.graph,
    plans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
  };
  const preview = scheduleWeeklyPlanningStableV5Preview(previewInput);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_preview_scheduler_evaluated',
    severity: preview.status === 'ready' ? 'info' : 'warn',
    data: {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      input: previewInput,
      defaultsAndCriteria: {
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 10,
        defaultSessionMinutes: 60,
        existingPlanBufferMinutes: 10,
        splittableThresholdMinutes: 120,
        allOrNothing: 'any unscheduled work item returns insufficient_capacity with no partial candidates',
      },
      result: preview,
    },
  });
  if (preview.status === 'insufficient_capacity') {
    const message = '指定された期間と空き時間には、すべての作業を安全に配置できませんでした。期間を広げるか、作業量または利用できる時間を調整してください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        questionCode: 'insufficient_capacity',
        authorized: true,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'preview_insufficient_capacity',
      basis: preview,
      output,
      severity: 'warn',
    });
    return output;
  }
  if (preview.status === 'empty') {
    const message = '固定予定は把握しましたが、新しく配置する作業がありません。予定に入れたい作業を教えてください。';
    const output = {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized: true,
      }),
      message,
      draftCandidates: [],
    };
    traceBranch({
      requestId: input.traceRequestId,
      branch: 'preview_empty',
      basis: preview,
      output,
      severity: 'warn',
    });
    return output;
  }

  console.info('[WeeklyPlanning Stable V5] turn completed', {
    schemaVersion: semantic.normalization.diagnostics.schemaVersion,
    graphRevision: semantic.graph.revision,
    normalizerAttempts: semantic.normalization.diagnostics.attemptCount,
    repairAttempted: semantic.normalization.diagnostics.repairAttempted,
    schedulerStatus: compilation.status,
    candidateCount: preview.candidates.length,
  });
  const message = `${preview.candidates.length}件の仮予定候補を作りました。内容を確認して、問題なければ仮予定へ追加してください。`;
  const output = {
    state: compatibilityState({
      previousState: input.previousState,
      userText: input.userText,
      message,
      draftCandidates: preview.candidates,
      authorized: true,
    }),
    message,
    draftCandidates: preview.candidates,
  };
  traceBranch({
    requestId: input.traceRequestId,
    branch: 'preview_ready',
    basis: {
      compilationStatus: compilation.status,
      dialogueStatus: dialogue.status,
      authorized,
      preview,
    },
    output,
  });
  return output;
}

export function getWeeklyPlanningStableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return blockingQuestionCode(compilation);
}