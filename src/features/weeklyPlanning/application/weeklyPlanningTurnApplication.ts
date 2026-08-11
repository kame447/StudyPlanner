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
import { saveOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
import { bindWeeklyPlanningStableV5RuntimeSessionScope } from './weeklyPlanningStableV5RuntimeSession';
import {
  createWeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
} from './weeklyPlanningTurnSideEffects';

export interface WeeklyPlanningTurnApplicationServices {
  submitControlledTurn: typeof submitWeeklyPlanningControlledTurn;
  executeTurn: typeof executeWeeklyPlanningTurn;
  bindStableV5SessionScope: typeof bindWeeklyPlanningStableV5RuntimeSessionScope;
  saveOwnedState: typeof saveOwnedWeeklyPlanningState;
  finalizeTurn: typeof finalizeWeeklyPlanningApplicationTurn;
  discardTurn: typeof discardWeeklyPlanningApplicationTurn;
  recordCommittedTurn: typeof recordCommittedWeeklyPlanningApplicationTurn;
  recordDiscardedTurn: typeof recordDiscardedWeeklyPlanningApplicationTurn;
  recordFailedTurn: typeof recordFailedWeeklyPlanningApplicationTurn;
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  submitControlledTurn: submitWeeklyPlanningControlledTurn,
  executeTurn: executeWeeklyPlanningTurn,
  bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
  saveOwnedState: saveOwnedWeeklyPlanningState,
  finalizeTurn: finalizeWeeklyPlanningApplicationTurn,
  discardTurn: discardWeeklyPlanningApplicationTurn,
  recordCommittedTurn: recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedTurn: recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedTurn: recordFailedWeeklyPlanningApplicationTurn,
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
      services.finalizeTurn({ ownerId: params.userId, pending });
    },
    discardExecutionResult({ pending, userText, result, reason }) {
      services.discardTurn(pending);
      if (reason === 'failed') return;
      const traceWrite = services.recordDiscardedTurn({
        ownerId: params.ownerId,
        pending,
        userText,
        result,
        reason,
      });
      if (traceWrite) void traceWrite;
    },
    onCommittedTurn({ pending, userText, result, committed }) {
      services.saveOwnedState(params.ownerId, committed);
      const traceWrite = services.recordCommittedTurn({
        ownerId: params.ownerId,
        pending,
        userText,
        result,
      });
      if (traceWrite) void traceWrite;
    },
    onFailedTurn({ pending, userText, error, failedState, assistantMessage }) {
      services.discardTurn(pending);
      services.saveOwnedState(params.ownerId, failedState);
      const traceWrite = services.recordFailedTurn({
        ownerId: params.ownerId,
        pending,
        userText,
        error,
        assistantMessage,
      });
      if (traceWrite) void traceWrite;
    },
  });
}
