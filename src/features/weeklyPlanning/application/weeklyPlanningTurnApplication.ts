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
import { isWeeklyPlanningStableV5RuntimeEnabled } from './weeklyPlanningRuntimeMode';
import { bindWeeklyPlanningStableV5RuntimeSessionScope } from './weeklyPlanningStableV5RuntimeSession';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
  recordCommittedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
} from './weeklyPlanningTurnSideEffects';

export interface WeeklyPlanningTurnApplicationServices {
  submitControlledTurn: typeof submitWeeklyPlanningControlledTurn;
  executeTurn: typeof executeWeeklyPlanningTurn;
  isStableV5Enabled: typeof isWeeklyPlanningStableV5RuntimeEnabled;
  bindStableV5SessionScope: typeof bindWeeklyPlanningStableV5RuntimeSessionScope;
  saveOwnedState: typeof saveOwnedWeeklyPlanningState;
  finalizeTurn: typeof finalizeWeeklyPlanningApplicationTurn;
  discardTurn: typeof discardWeeklyPlanningApplicationTurn;
  recordCommittedTurn: typeof recordCommittedWeeklyPlanningApplicationTurn;
  recordFailedTurn: typeof recordFailedWeeklyPlanningApplicationTurn;
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  submitControlledTurn: submitWeeklyPlanningControlledTurn,
  executeTurn: executeWeeklyPlanningTurn,
  isStableV5Enabled: isWeeklyPlanningStableV5RuntimeEnabled,
  bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
  saveOwnedState: saveOwnedWeeklyPlanningState,
  finalizeTurn: finalizeWeeklyPlanningApplicationTurn,
  discardTurn: discardWeeklyPlanningApplicationTurn,
  recordCommittedTurn: recordCommittedWeeklyPlanningApplicationTurn,
  recordFailedTurn: recordFailedWeeklyPlanningApplicationTurn,
};

export interface SubmitWeeklyPlanningApplicationTurnParams {
  session: WeeklyPlanningControllerSession;
  ownerId: string;
  userText: string;
  selectedDate: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
}

export function submitWeeklyPlanningApplicationTurn(
  params: SubmitWeeklyPlanningApplicationTurnParams,
  services: WeeklyPlanningTurnApplicationServices = defaultServices,
): Promise<WeeklyPlanningTurnSubmissionResult> {
  return services.submitControlledTurn({
    session: params.session,
    ownerId: params.ownerId,
    userText: params.userText,
    getState: params.getState,
    dispatch: params.dispatch,
    async execute({ snapshot, pending, userText }) {
      if (services.isStableV5Enabled()) {
        services.bindStableV5SessionScope({
          ownerId: params.ownerId,
          weekStartDate: snapshot.weekStartDate,
          conversationId: pending.conversationId,
        });
      }
      return services.executeTurn({
        previousState: snapshot.intakeState,
        messages: snapshot.messages,
        userText,
        selectedDate: params.selectedDate,
        userId: params.ownerId,
        plans: params.plans,
        scheduleTemplates: params.scheduleTemplates,
        timetableTermId: params.timetableTermId,
        conversationId: pending.conversationId,
        traceRequestId: pending.requestId,
        weekStartsOn: params.weekStartsOn,
      });
    },
    commitExecutionResult({ pending }) {
      services.finalizeTurn({ ownerId: params.ownerId, pending });
    },
    discardExecutionResult({ pending }) {
      services.discardTurn(pending);
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
