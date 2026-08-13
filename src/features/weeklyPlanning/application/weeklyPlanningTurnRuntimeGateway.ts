import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../types';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
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
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
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
        scheduleTemplates: params.scheduleTemplates,
        timetableTermId: params.timetableTermId,
        conversationId: params.pending.conversationId,
        traceRequestId: params.pending.requestId,
        weekStartsOn: requestContext.weekStartsOn,
        requestContext,
      });
    },
  };
}

export const weeklyPlanningTurnRuntimeGateway = createWeeklyPlanningTurnRuntimeGateway();
