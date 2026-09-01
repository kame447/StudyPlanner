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
import {
  executeWeeklyPlanningTurn,
} from '../weeklyPlanningTurnExecutor';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutionTypes';
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
  snapshot: PlanningState;
  pending: WeeklyPlanningPendingTurn;
  userText: string;
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
}

export interface WeeklyPlanningTurnRuntimeGateway {
  execute(
    params: ExecuteWeeklyPlanningTurnRuntimeParams,
  ): Promise<WeeklyPlanningTurnExecutionResult>;
}

export function createWeeklyPlanningTurnRuntimeGateway(
  services: WeeklyPlanningTurnRuntimeGatewayServices = defaultServices,
): WeeklyPlanningTurnRuntimeGateway {
  return {
    async execute(params) {
      services.bindStableV5SessionScope({
        ownerId: params.userId,
        weekStartDate: params.snapshot.weekStartDate,
        conversationId: params.pending.conversationId,
      });
      const requestContext = createWeeklyPlanningTurnRequestContext({
        startedAtIso: params.pending.startedAt,
        timeZone: params.timeZone ?? resolvedTimeZone(),
        weekStartsOn: params.weekStartsOn ?? 'monday',
      });
      return services.executeTurn({
        previousState: params.snapshot.intakeState,
        messages: params.snapshot.messages,
        userText: params.userText,
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
      });
    },
  };
}

export const weeklyPlanningTurnRuntimeGateway = createWeeklyPlanningTurnRuntimeGateway();