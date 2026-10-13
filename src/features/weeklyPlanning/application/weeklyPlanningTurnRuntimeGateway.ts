import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensus';
import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
} from '../../../types/domain';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../types';
import type { WeeklyPlanningSelectedStarterTargetV5 } from '../semantic/weeklyPlanningTurnEvidenceV5';
import {
  executeWeeklyPlanningTurn,
} from '../weeklyPlanningTurnExecutor';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { bindWeeklyPlanningStableV5RuntimeSessionScope } from './weeklyPlanningStableV5RuntimeSession';
import {
  createWeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';

export interface WeeklyPlanningTurnRuntimeGatewayServices {
  executeTurn: typeof executeWeeklyPlanningTurn;
  bindStableV5SessionScope: typeof bindWeeklyPlanningStableV5RuntimeSessionScope;
}

const defaultServices: WeeklyPlanningTurnRuntimeGatewayServices = {
  executeTurn: executeWeeklyPlanningTurn,
  bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
};

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

export interface ExecuteWeeklyPlanningTurnRuntimeParams {
  /** Invocation-local Choice/Luna observer; internal only, never serialized or persisted. */
  semanticObservation?: WeeklyPlanningSemanticTurnObservation;
  snapshot: PlanningState;
  pending: WeeklyPlanningPendingTurn;
  userText: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  monthEvents?: MonthEvent[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  timeZone?: string;
  isCurrentTurn?: () => boolean;
}

export interface WeeklyPlanningTurnRuntimeGateway {
  continueSelectedTurn?(params: ExecuteWeeklyPlanningTurnRuntimeParams, graph: WeeklyPlanningFactGraphV5): Promise<WeeklyPlanningTurnExecutionResult>;
  execute(
    params: ExecuteWeeklyPlanningTurnRuntimeParams,
  ): Promise<WeeklyPlanningTurnExecutionResult>;
}

function executionInput(params: ExecuteWeeklyPlanningTurnRuntimeParams, bindScope: WeeklyPlanningTurnRuntimeGatewayServices['bindStableV5SessionScope']) {
  bindScope({
    ownerId: params.userId,
    weekStartDate: params.snapshot.weekStartDate,
    conversationId: params.pending.conversationId,
  });
  const requestContext = createWeeklyPlanningTurnRequestContext({
    startedAtIso: params.pending.startedAt,
    timeZone: params.timeZone ?? resolvedTimeZone(),
    weekStartsOn: params.weekStartsOn ?? 'monday',
  });
  return {
    ...(params.semanticObservation ? { semanticObservation: params.semanticObservation } : {}),
    previousState: params.snapshot.intakeState,
    messages: params.snapshot.messages,
    userText: params.userText,
    supplementalContext: params.supplementalContext,
    selectedStarterTarget: params.selectedStarterTarget,
    selectedDate: params.selectedDate,
    userId: params.userId,
    plans: params.plans,
    monthEvents: params.monthEvents,
    actuals: params.actuals,
    studyMaterials: params.studyMaterials,
    scheduleTemplates: params.scheduleTemplates,
    timetableTermId: params.timetableTermId,
    timetableTerm: params.timetableTerm,
    timetableTerms: params.timetableTerms,
    conversationId: params.pending.conversationId,
    traceRequestId: params.pending.requestId,
    weekStartsOn: requestContext.weekStartsOn,
    requestContext,
    inputStateRevision: params.pending.baseRevision,
    isCurrentTurn: params.isCurrentTurn,
    retainedPreviewCount: params.snapshot.previewCandidates?.length ?? 0,
  };
}

export function createWeeklyPlanningTurnRuntimeGateway(
  services: WeeklyPlanningTurnRuntimeGatewayServices = defaultServices,
): WeeklyPlanningTurnRuntimeGateway {
  return {
    async continueSelectedTurn(params, graph) {
      const { continueWeeklyPlanningSelectedCandidateTurn } = await import('./weeklyPlanningStableV5CandidateContinuation');
      return continueWeeklyPlanningSelectedCandidateTurn(executionInput(params, services.bindStableV5SessionScope), graph);
    },
    async execute(params) {
      return services.executeTurn(executionInput(params, services.bindStableV5SessionScope));
    },
  };
}

export const weeklyPlanningTurnRuntimeGateway = createWeeklyPlanningTurnRuntimeGateway();
