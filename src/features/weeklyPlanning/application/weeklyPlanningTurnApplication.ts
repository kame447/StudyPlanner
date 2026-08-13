import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  submitWeeklyPlanningControlledTurn,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import { bindWeeklyPlanningStableV5RuntimeSessionScope } from './weeklyPlanningStableV5RuntimeSession';
import {
  createWeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';
import {
  weeklyPlanningTurnOutcomeLifecycle,
  type WeeklyPlanningTurnOutcomeLifecycle,
} from './weeklyPlanningTurnOutcomeLifecycle';
import {
  weeklyPlanningTurnStagingLifecycle,
  type WeeklyPlanningTurnStagingLifecycle,
} from './weeklyPlanningTurnSideEffects';

export interface WeeklyPlanningTurnApplicationServices {
  submitControlledTurn: typeof submitWeeklyPlanningControlledTurn;
  executeTurn: typeof executeWeeklyPlanningTurn;
  bindStableV5SessionScope: typeof bindWeeklyPlanningStableV5RuntimeSessionScope;
  stagingLifecycle: WeeklyPlanningTurnStagingLifecycle;
  outcomeLifecycle: WeeklyPlanningTurnOutcomeLifecycle;
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  submitControlledTurn: submitWeeklyPlanningControlledTurn,
  executeTurn: executeWeeklyPlanningTurn,
  bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
  stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
  outcomeLifecycle: weeklyPlanningTurnOutcomeLifecycle,
};

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

export interface SubmitWeeklyPlanningApplicationTurnParams {
  session: WeeklyPlanningControllerSession;
  userId: string;
  ownerId: string;
  userText: string;
  selectedDate: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  timeZone?: string;
  now?: () => string;
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
}

export function submitWeeklyPlanningApplicationTurn(
  params: SubmitWeeklyPlanningApplicationTurnParams,
  services: WeeklyPlanningTurnApplicationServices = defaultServices,
): Promise<WeeklyPlanningTurnSubmissionResult> {
  return services.submitControlledTurn({
    session: params.session,
    ownerId: params.userId,
    userText: params.userText,
    getState: params.getState,
    dispatch: params.dispatch,
    now: params.now,
    async execute({ snapshot, pending, userText }) {
      services.bindStableV5SessionScope({
        ownerId: params.userId,
        weekStartDate: snapshot.weekStartDate,
        conversationId: pending.conversationId,
      });
      const requestContext = createWeeklyPlanningTurnRequestContext({
        startedAtIso: pending.startedAt,
        timeZone: params.timeZone ?? resolvedTimeZone(),
        weekStartsOn: params.weekStartsOn ?? 'monday',
      });
      return services.executeTurn({
        previousState: snapshot.intakeState,
        messages: snapshot.messages,
        userText,
        selectedDate: params.selectedDate,
        userId: params.userId,
        plans: params.plans,
        scheduleTemplates: params.scheduleTemplates,
        timetableTermId: params.timetableTermId,
        conversationId: pending.conversationId,
        traceRequestId: pending.requestId,
        weekStartsOn: requestContext.weekStartsOn,
        requestContext,
      });
    },
    commitExecutionResult({ pending }) {
      services.stagingLifecycle.finalize({ ownerId: params.userId, pending });
    },
    discardExecutionResult({ pending, userText, result, reason }) {
      services.stagingLifecycle.discard(pending);
      services.outcomeLifecycle.discarded({
        ownerId: params.ownerId,
        pending,
        userText,
        result,
        reason,
      });
    },
    onCommittedTurn({ pending, userText, result, committed }) {
      services.outcomeLifecycle.committed({
        ownerId: params.ownerId,
        pending,
        userText,
        result,
        committed,
      });
    },
    onFailedTurn({ pending, userText, error, failedState, assistantMessage }) {
      services.stagingLifecycle.discard(pending);
      services.outcomeLifecycle.failed({
        ownerId: params.ownerId,
        pending,
        userText,
        error,
        failedState,
        assistantMessage,
      });
    },
  });
}
