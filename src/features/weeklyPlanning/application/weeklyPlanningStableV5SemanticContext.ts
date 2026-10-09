import {
  userPlanningContextPromptSelectionV2,
} from '../../userPlanningContext/userPlanningContextPromptSelectionV2';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  resolveWeeklyPlanningQuestionPresentationFreshness,
  type WeeklyPlanningQuestionPresentationFreshness,
} from '../intake/weeklyPlanningQuestionPresentation';
import {
  decodeWeeklyPlanningStableV5QuestionSlot,
} from '../intake/weeklyPlanningStableV5QuestionSlot';
import type { StudyMaterial } from '../../../types/domain';
import {
  createWeeklyPlanningRegisteredMaterialContextV5,
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

/**
 * Freshness of the pending question's presentation at turn start. It is computed once
 * per turn from machine state only (planning-state revision, latest committed message,
 * graph revision) and every consumer in the turn reads this same value.
 */
export function resolveStableV5PendingQuestionPresentation(params: {
  previousState: PlanningIntakeState | undefined;
  inputStateRevision: number | undefined;
  messages: ExecuteWeeklyPlanningStableV5RuntimeTurnInput['messages'];
  graphRevision: number;
}): WeeklyPlanningQuestionPresentationFreshness {
  return resolveWeeklyPlanningQuestionPresentationFreshness(params);
}

function effortMeasurementFromIntent(
  intent: string | undefined,
): 'total_duration' | 'duration_per_unit' | 'session_duration' | null {
  return intent === 'total_duration'
    || intent === 'duration_per_unit'
    || intent === 'session_duration'
    ? intent
    : null;
}

/**
 * Legacy architecture (verbatim pre-#488 behaviour): the previous machine question is
 * offered as-is and stamped with the CURRENT graph revision. Nothing checks whether the
 * user was shown it or whether it is still the latest message.
 */
function pendingQuestionFromRawState(
  state: PlanningIntakeState | undefined,
  graphRevision: number,
): Record<string, unknown> | null {
  const context = state?.lastQuestionContext;
  const questionCode = decodeWeeklyPlanningStableV5QuestionSlot(context?.targetSlot);
  if (!context || !questionCode) return null;
  return {
    actionId: context.actionId ?? null,
    questionCode,
    targetFactId: context.topicId ?? null,
    graphRevision,
    effortMeasurement: effortMeasurementFromIntent(context.intent),
    estimateForWorkloadFactId: context.estimateForWorkloadFactId ?? null,
    questionBasis: context.questionBasis ?? null,
  };
}

/**
 * Only a question whose presentation is still the latest committed message may be
 * offered as the question the user is answering. Stale, unbound and malformed
 * presentations fail closed: the semantic model then interprets the turn without a
 * machine pending question and no short-answer shortcut can bind it. The revision is
 * the one committed with the presenting message, not the current graph.
 */
function pendingQuestionFromPresentation(
  presentation: WeeklyPlanningQuestionPresentationFreshness,
): Record<string, unknown> | null {
  if (presentation.status !== 'fresh') return null;
  const context = presentation.questionContext;
  const questionCode = decodeWeeklyPlanningStableV5QuestionSlot(context.targetSlot);
  if (!questionCode) return null;
  return {
    actionId: context.actionId ?? null,
    questionCode,
    targetFactId: context.topicId ?? null,
    graphRevision: presentation.presentation.graphRevision,
    effortMeasurement: effortMeasurementFromIntent(context.intent),
    estimateForWorkloadFactId: context.estimateForWorkloadFactId ?? null,
    questionBasis: context.questionBasis ?? null,
  };
}

function learningStrategyProposalsFromState(
  state: PlanningIntakeState | undefined,
): Array<Record<string, unknown>> {
  return (state?.learningStrategyProposalRecords ?? [])
    .filter((record) => !(record.status === 'pending' && record.decidedAtTurnId !== null))
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
  pendingQuestionPresentation: WeeklyPlanningQuestionPresentationFreshness;
  /**
   * `true` (interaction architecture): only a fresh presentation is offered as the pending
   * question. `false` (legacy architecture): the raw previous machine question is offered.
   */
  freshPendingQuestionBinding?: boolean;
  ownerId?: string;
  currentDate?: string;
  userText?: string;
  studyMaterials?: readonly StudyMaterial[];
}): Record<string, unknown> {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: params.graph.revision,
    previousCompatibilityStatus: params.previousState?.status ?? null,
    pendingQuestion: params.freshPendingQuestionBinding === false
      ? pendingQuestionFromRawState(params.previousState, params.graph.revision)
      : pendingQuestionFromPresentation(params.pendingQuestionPresentation),
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
    relations: active.relations.map((relation) => ({
      publicId: relation.id,
      kind: relation.kind,
      fromTaskPublicId: relation.fromTaskId,
      toTaskPublicId: relation.toTaskId,
    })),
    uncertainties: active.uncertainties.map((uncertainty) => ({
      publicId: uncertainty.id,
      targetPublicId: uncertainty.targetFactId,
      field: uncertainty.field,
      reason: uncertainty.reason,
      sourceText: uncertainty.source.sourceText,
    })),
    registeredMaterials: params.ownerId
      ? createWeeklyPlanningRegisteredMaterialContextV5({
          ownerId: params.ownerId,
          materials: params.studyMaterials ?? [],
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
