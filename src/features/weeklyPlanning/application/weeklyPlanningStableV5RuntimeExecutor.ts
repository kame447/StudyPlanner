import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
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
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

const RECENT_TURN_LIMIT = 8;
const DEFAULT_PLANNING_DAY_COUNT = 7;

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

function publicStateSummary(
  graph: WeeklyPlanningFactGraphV5,
  messages: readonly WeeklyPlanningMessage[],
): Record<string, unknown> {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: graph.revision,
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
    lastAssistantMessage:
      [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? null,
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

function renderQuestion(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
): string {
  const label = issueTaskLabel(graph, question);
  switch (question.code) {
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

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  if (aiConfig.provider === 'rules' || configError) {
    throw new Error(configError ?? 'Stable V5にはAI structured output接続が必要です。');
  }

  const runtimeSession = getOrCreateWeeklyPlanningStableV5RuntimeSession({
    ownerId: input.userId,
    conversationId: input.conversationId,
  });
  const fallbackHorizon = resolvePlanningHorizon({
    graph: runtimeSession.graph,
    selectedDate: input.selectedDate,
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
    recentConversation: input.messages.slice(-RECENT_TURN_LIMIT).map(({ role, content }) => ({
      role,
      content,
    })),
    publicStateSummary: publicStateSummary(runtimeSession.graph, input.messages),
    schedulerContext: schedulerContext({
      ownerId: input.userId,
      selectedDate: input.selectedDate,
      horizon: fallbackHorizon,
    }),
  });

  if (semantic.status === 'provider_failure') {
    const message = 'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。';
    return {
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
  }
  if (semantic.status === 'normalization_rejected') {
    const message = 'AIの構造化結果を安全に採用できませんでした。内容を少し言い換えて、もう一度送ってください。';
    return {
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
  }
  if (semantic.status === 'canonicalization_rejected') {
    const message = '直前の会話状態とAIの構造化結果が一致しなかったため、変更を反映していません。もう一度送ってください。';
    return {
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
  }

  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: input.userId,
    conversationId: input.conversationId,
    graph: semantic.graph,
  });
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
  const compilation = compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(semantic.graph),
    context,
    externalSources: sources,
  });
  const dialogue = decideWeeklyPlanningStableDialogueV5(compilation);
  const authorized = semantic.normalization.document?.planningIntent === 'create_plan';

  if (dialogue.status === 'ask_question') {
    const message = renderQuestion(semantic.graph, dialogue.question);
    return {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        questionCode: dialogue.question.code,
        authorized,
      }),
      message,
      draftCandidates: [],
    };
  }
  if (dialogue.status === 'nothing_to_schedule' || !compilation.input) {
    const message = '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。';
    return {
      state: compatibilityState({
        previousState: input.previousState,
        userText: input.userText,
        message,
        draftCandidates: [],
        authorized,
      }),
      message,
      draftCandidates: [],
    };
  }
  if (!authorized) {
    const message = '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。';
    return {
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
  }

  const preview = scheduleWeeklyPlanningStableV5Preview({
    input: compilation.input,
    graph: semantic.graph,
    plans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
  });
  if (preview.status === 'insufficient_capacity') {
    const message = '指定された期間と空き時間には、すべての作業を安全に配置できませんでした。期間を広げるか、作業量または利用できる時間を調整してください。';
    return {
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
  }
  if (preview.status === 'empty') {
    const message = '固定予定は把握しましたが、新しく配置する作業がありません。予定に入れたい作業を教えてください。';
    return {
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
  return {
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
}

export function getWeeklyPlanningStableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return blockingQuestionCode(compilation);
}
