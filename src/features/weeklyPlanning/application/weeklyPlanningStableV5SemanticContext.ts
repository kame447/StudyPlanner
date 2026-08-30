import {
  userPlanningContextPromptSelectionV2,
} from '../../userPlanningContext/userPlanningContextPromptSelectionV2';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  decodeWeeklyPlanningStableV5QuestionSlot,
} from '../intake/weeklyPlanningStableV5QuestionSlot';
import {
  getWeeklyPlanningRegisteredMaterialContextV5,
} from '../personalization/weeklyPlanningRegisteredMaterialRuntimeV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';

export const STABLE_V5_RECENT_TURN_LIMIT = 4;

export function activeStableV5PlanningWindows(graph: WeeklyPlanningFactGraphV5) {
  if (graph.factLifecycles.length === 0) return [...graph.planningWindows];
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return graph.planningWindows.filter((window) => activeIds.has(window.id));
}

export function stableV5RequestContextForInput(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): {
  context: WeeklyPlanningTurnRequestContext;
  source: 'captured_request';
} {
  return { context: input.requestContext, source: 'captured_request' };
}

function effortMeasurementFromState(
  state: PlanningIntakeState | undefined,
): 'total_duration' | 'duration_per_unit' | 'session_duration' | null {
  const intent = state?.lastQuestionContext?.intent;
  return intent === 'total_duration'
    || intent === 'duration_per_unit'
    || intent === 'session_duration'
    ? intent
    : null;
}

function pendingQuestionFromState(
  state: PlanningIntakeState | undefined,
  graphRevision: number,
): Record<string, unknown> | null {
  const context = state?.lastQuestionContext;
  const questionCode = decodeWeeklyPlanningStableV5QuestionSlot(context?.targetSlot);
  if (!questionCode) return null;
  return {
    actionId: context?.actionId ?? null,
    questionCode,
    targetFactId: context?.topicId ?? null,
    graphRevision,
    effortMeasurement: effortMeasurementFromState(state),
    estimateForWorkloadFactId: context?.estimateForWorkloadFactId ?? null,
    questionBasis: context?.questionBasis ?? null,
  };
}

function learningStrategyProposalsFromState(
  state: PlanningIntakeState | undefined,
): Array<Record<string, unknown>> {
  return (state?.learningStrategyProposalRecords ?? [])
    .slice(-16)
    .map((record) => ({
      publicId: record.id,
      kind: record.kind,
      taskPublicId: record.taskId,
      workloadPublicId: record.workloadFactId,
      scope: record.scope,
      status: record.status,
      suggestedSessionMinutes: record.suggestedSessionMinutes,
    }));
}

function userPlanningContextRelevantScopeKeys(
  active: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>,
): string[] {
  return [
    ...active.tasks.flatMap((task) => [task.title, task.category]),
    ...active.components.flatMap((component) => [component.label, component.role]),
    ...active.workloads.flatMap((workload) => [workload.unitCode, workload.unitLabel]),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function createStableV5SemanticPublicStateSummary(params: {
  graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[];
  previousState?: PlanningIntakeState;
  ownerId?: string;
  currentDate?: string;
  userText?: string;
}): Record<string, unknown> {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: params.graph.revision,
    previousCompatibilityStatus: params.previousState?.status ?? null,
    pendingQuestion: pendingQuestionFromState(params.previousState, params.graph.revision),
    learningStrategyProposals: learningStrategyProposalsFromState(params.previousState),
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
      rangeStart: workload.rangeStart,
      rangeEnd: workload.rangeEnd,
      perOccurrence: workload.perOccurrence,
      periodExpression: workload.periodExpression,
    })),
    uncertainties: active.uncertainties.map((uncertainty) => ({
      publicId: uncertainty.id,
      targetPublicId: uncertainty.targetFactId,
      field: uncertainty.field,
      reason: uncertainty.reason,
      sourceText: uncertainty.source.sourceText,
    })),
    registeredMaterials: params.ownerId
      ? getWeeklyPlanningRegisteredMaterialContextV5({
          ownerId: params.ownerId,
          userText: params.userText,
        })
      : [],
    userPlanningContext: params.ownerId && params.currentDate
      ? userPlanningContextPromptSelectionV2({
          ownerId: params.ownerId,
          currentDate: params.currentDate,
          relevantScopeKeys: userPlanningContextRelevantScopeKeys(active),
        }).map(({ scope: _scope, relevanceTier: _relevanceTier, ...record }) => record)
      : [],
    lastAssistantMessage:
      [...params.messages].reverse().find((message) => message.role === 'assistant')?.content ?? null,
  };
}
