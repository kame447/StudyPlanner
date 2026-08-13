import {
  userPlanningContextPromptSummaryV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningMessage } from '../types';
import {
  createWeeklyPlanningLegacyRequestContext,
  type WeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';

export const STABLE_V5_RECENT_TURN_LIMIT = 8;

export function activeStableV5PlanningWindows(graph: WeeklyPlanningFactGraphV5) {
  if (graph.factLifecycles.length === 0) return [...graph.planningWindows];
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return graph.planningWindows.filter((window) => activeIds.has(window.id));
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

export function stableV5RequestContextForInput(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): {
  context: WeeklyPlanningTurnRequestContext;
  source: 'captured_request' | 'legacy_selected_date_fallback';
} {
  if (input.requestContext) {
    return { context: input.requestContext, source: 'captured_request' };
  }
  return {
    context: createWeeklyPlanningLegacyRequestContext({
      selectedDate: input.selectedDate,
      timeZone: systemTimeZone(),
      weekStartsOn: input.weekStartsOn ?? 'monday',
    }),
    source: 'legacy_selected_date_fallback',
  };
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

export function createStableV5SemanticPublicStateSummary(params: {
  graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[];
  previousState?: PlanningIntakeState;
  ownerId?: string;
  currentDate?: string;
}): Record<string, unknown> {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: params.graph.revision,
    previousCompatibilityStatus: params.previousState?.status ?? null,
    pendingQuestion: pendingQuestionFromState(params.previousState, params.graph.revision),
    groundingRecords: (params.previousState?.groundingRecords ?? [])
      .filter((record) => record.status !== 'rejected')
      .slice(-16)
      .map((record) => ({
        targetFactId: record.targetFactId,
        interpretationKind: record.interpretationKind,
        status: record.status,
        sourceExpression: record.sourceExpression,
        startDate: record.startDate,
        endDate: record.endDate,
      })),
    repairAgenda: (params.previousState?.repairAgenda ?? [])
      .filter((item) => item.status === 'open' || item.status === 'deferred')
      .slice(-16)
      .map((item) => ({
        issueFactId: item.issueFactId,
        targetFactId: item.targetFactId,
        domain: item.domain,
        code: item.code,
        impact: item.impact,
        status: item.status,
        reopenBefore: item.reopenBefore,
      })),
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
    userPlanningContext: params.ownerId && params.currentDate
      ? userPlanningContextPromptSummaryV1({
          ownerId: params.ownerId,
          currentDate: params.currentDate,
        })
      : [],
    lastAssistantMessage:
      [...params.messages].reverse().find((message) => message.role === 'assistant')?.content ?? null,
  };
}
