import {
  isPlannerDataReadyForOwner,
  type PlannerDataAvailability,
} from '../../../domain/plannerDataReadAuthority';
import type { Actual, Plan, ScheduleTemplate, StudyMaterial, TimetableTerm } from '../../../types/domain';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type {
  WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutionTypes';
import {
  submitWeeklyPlanningControlledTurn,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
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
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  submitControlledTurn: submitWeeklyPlanningControlledTurn,
  runtimeGateway: weeklyPlanningTurnRuntimeGateway,
  stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
  outcomeLifecycle: weeklyPlanningTurnOutcomeLifecycle,
};

export interface SubmitWeeklyPlanningApplicationTurnParams {
  session: WeeklyPlanningControllerSession;
  userId: string;
  ownerId: string;
  userText: string;
  supplementalContext?: string;
  selectedDate: string;
  plans: Plan[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  plannerDataAvailability: PlannerDataAvailability;
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
  if (!isPlannerDataReadyForOwner(params.plannerDataAvailability, params.userId)) {
    return Promise.resolve({ accepted: false, draftCandidates: [] });
  }

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
        actuals: params.actuals,
        studyMaterials: params.studyMaterials,
        scheduleTemplates: params.scheduleTemplates,
        timetableTermId: params.timetableTermId,
        timetableTerm: params.timetableTerm,
        timetableTerms: params.timetableTerms,
        weekStartsOn: params.weekStartsOn,
        timeZone: params.timeZone,
      });
    },
    onStartedTurn({ pending }) {
      services.outcomeLifecycle.started?.({
        ownerId: params.ownerId,
        pending,
      });
    },
    prepareExecutionCommit({ pending }) {
      return services.stagingLifecycle.prepare({ ownerId: params.userId, pending });
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
    onFailedTurn({ pending, userText, result, error, failedState, assistantMessage }) {
      services.stagingLifecycle.discard(pending);
      services.outcomeLifecycle.failed({
        ownerId: params.ownerId,
        pending,
        userText,
        result,
        error,
        failedState,
        assistantMessage,
      });
    },
  });
}
