import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type {
  WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutionTypes';
import {
  submitWeeklyPlanningControlledTurn,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import { refreshWeeklyPlanningRegisteredMaterialsV5 } from './weeklyPlanningRegisteredMaterialLookupV5';
import {
  weeklyPlanningTurnOutcomeLifecycle,
  type WeeklyPlanningTurnOutcomeLifecycle,
} from './weeklyPlanningTurnOutcomeLifecycle';
import {
  weeklyPlanningTurnRuntimeGateway,
  type WeeklyPlanningTurnRuntimeGateway,
} from './weeklyPlanningTurnRuntimeGateway';
import {
  weeklyPlanningTurnStagingLifecycle,
  type WeeklyPlanningTurnStagingLifecycle,
} from './weeklyPlanningTurnSideEffects';

export interface WeeklyPlanningTurnApplicationServices {
  submitControlledTurn: typeof submitWeeklyPlanningControlledTurn;
  runtimeGateway: WeeklyPlanningTurnRuntimeGateway;
  stagingLifecycle: WeeklyPlanningTurnStagingLifecycle;
  outcomeLifecycle: WeeklyPlanningTurnOutcomeLifecycle;
  refreshRegisteredMaterials?: (ownerId: string) => Promise<unknown>;
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  submitControlledTurn: submitWeeklyPlanningControlledTurn,
  runtimeGateway: weeklyPlanningTurnRuntimeGateway,
  stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
  outcomeLifecycle: weeklyPlanningTurnOutcomeLifecycle,
  refreshRegisteredMaterials: refreshWeeklyPlanningRegisteredMaterialsV5,
};

export interface SubmitWeeklyPlanningApplicationTurnParams {
  session: WeeklyPlanningControllerSession;
  userId: string;
  ownerId: string;
  userText: string;
  supplementalContext?: string;
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

export async function submitWeeklyPlanningApplicationTurn(
  params: SubmitWeeklyPlanningApplicationTurnParams,
  services: WeeklyPlanningTurnApplicationServices = defaultServices,
): Promise<WeeklyPlanningTurnSubmissionResult> {
  await services.refreshRegisteredMaterials?.(params.userId);

  return services.submitControlledTurn({
    session: params.session,
    ownerId: params.userId,
    userText: params.userText,
    supplementalContext: params.supplementalContext,
    getState: params.getState,
    dispatch: params.dispatch,
    now: params.now,
    execute({ snapshot, pending, userText }) {
      return services.runtimeGateway.execute({
        snapshot,
        pending,
        userText,
        selectedDate: params.selectedDate,
        userId: params.userId,
        plans: params.plans,
        scheduleTemplates: params.scheduleTemplates,
        timetableTermId: params.timetableTermId,
        weekStartsOn: params.weekStartsOn,
        timeZone: params.timeZone,
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
