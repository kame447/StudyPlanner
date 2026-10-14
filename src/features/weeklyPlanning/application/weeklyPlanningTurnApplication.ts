import { projectSemanticCensusMetadata } from '../../../../shared/semanticTurnCensus';
import { createWeeklyPlanningCandidateChoiceOptions, type WeeklyPlanningCandidateChoiceServices } from './weeklyPlanningCandidateChoiceConnection';
import {
  isPlannerDataReadyForOwner,
  type PlannerDataAvailability,
} from '../../../domain/plannerDataReadAuthority';
import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
} from '../../../types/domain';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import type { WeeklyPlanningSelectedStarterTargetV5 } from '../semantic/weeklyPlanningTurnEvidenceV5';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type {
  WeeklyPlanningTurnSubmissionResult,
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutionTypes';
import {
  submitWeeklyPlanningControlledTurn,
  isSameWeeklyPlanningPendingTurn,
  type WeeklyPlanningControllerSession,
  type SubmitWeeklyPlanningControlledTurnParams,
} from '../weeklyPlanningTurnController';
import {
  weeklyPlanningTurnOutcomeLifecycle,
  type WeeklyPlanningTurnOutcomeLifecycle,
} from './weeklyPlanningTurnOutcomeLifecycle';
import {
  weeklyPlanningTurnRuntimeGateway,
  type WeeklyPlanningTurnRuntimeGateway,
  type ExecuteWeeklyPlanningTurnRuntimeParams,
} from './weeklyPlanningTurnRuntimeGateway';
import {
  weeklyPlanningTurnStagingLifecycle,
  type WeeklyPlanningTurnStagingLifecycle,
} from './weeklyPlanningTurnSideEffects';

export interface WeeklyPlanningTurnApplicationServices {
  candidateChoice?: WeeklyPlanningCandidateChoiceServices;
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
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  selectedDate: string;
  plans: Plan[];
  monthEvents?: MonthEvent[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  plannerDataAvailability: PlannerDataAvailability;
  /** Live lease captured with the request arrays; absent legacy callers cannot use Choice. */
  isPlannerDataSnapshotCurrent?: () => boolean;
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

  const runRuntime = (turn: Parameters<SubmitWeeklyPlanningControlledTurnParams['execute']>[0], selectedGraph?: Parameters<NonNullable<WeeklyPlanningTurnRuntimeGateway['continueSelectedTurn']>>[1]): Promise<WeeklyPlanningTurnExecutionResult> => {
    const { snapshot, pending, userText, supplementalContext, selectedStarterTarget } = turn;
    const input: ExecuteWeeklyPlanningTurnRuntimeParams = {
      ...(c5LocalSelection ? { semanticObservation: c5LocalSelection.semanticObservation } : {}),
      snapshot,
      pending,
      userText,
      supplementalContext,
      selectedStarterTarget,
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
      weekStartsOn: params.weekStartsOn,
      timeZone: params.timeZone,
      isCurrentTurn: () => params.session.ownerId === params.userId
        && params.session.conversationId === pending.conversationId
        && params.getState().weekStartDate === pending.weekStartDate
        && params.getState().revision === pending.baseRevision + 1
        && isSameWeeklyPlanningPendingTurn(params.getState().pendingTurn, pending),
    };
    return selectedGraph && services.runtimeGateway.continueSelectedTurn
      ? services.runtimeGateway.continueSelectedTurn(input, selectedGraph)
      : services.runtimeGateway.execute(input);
  };
  const c5LocalSelection: ReturnType<typeof createWeeklyPlanningCandidateChoiceOptions> = params.isPlannerDataSnapshotCurrent && services.runtimeGateway.continueSelectedTurn
    ? createWeeklyPlanningCandidateChoiceOptions({ services: services.candidateChoice,
        censusMetadata: projectSemanticCensusMetadata({
          questionCode: params.getState().intakeState?.lastQuestionContext?.targetSlot === 'stable_v5:ambiguous_effort_estimate'
            ? 'ambiguous_effort_estimate' : null,
          targetCount: params.getState().intakeState?.lastQuestionContext?.topicId ? 1 : null,
          binding: 'unknown', freshness: 'unknown',
        }),
        sourceAccess: () => params.session.ownerId === params.userId
          && isPlannerDataReadyForOwner(params.plannerDataAvailability, params.userId)
          && params.isPlannerDataSnapshotCurrent?.() === true ? 'allowed' : 'denied',
        continueSelectedTurn: ({ snapshot, pending, userText, graph }) => runRuntime({ snapshot, pending, userText }, graph),
      })
    : undefined;

  const submission = services.submitControlledTurn({
    session: params.session,
    ownerId: params.userId,
    userText: params.userText,
    supplementalContext: params.supplementalContext,
    selectedStarterTarget: params.selectedStarterTarget,
    getState: params.getState,
    dispatch: params.dispatch,
    now: params.now,
    c5LocalSelection,
    execute: runRuntime,
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
  return c5LocalSelection ? submission.then(
    result => { c5LocalSelection.finishCensus(result.recoveryRequired ? 'unknown' : result.accepted ? 'success' : 'failure'); return result; },
    error => { c5LocalSelection.finishCensus('failure'); throw error; },
  ) : submission;

}
