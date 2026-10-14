import type { ControlledCandidateSemanticContribution } from './weeklyPlanningControlledCandidateDomains';
import type { ControlledCandidateDomainHost } from './weeklyPlanningControlledCandidateChoice';
import { controlledCandidateQuestionCode, type ControlledCandidateRegistry } from './weeklyPlanningControlledCandidateRegistry';
import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensus';
import { weeklyPlanningRegisteredCandidateDomains } from './weeklyPlanningRegisteredCandidateDomains';
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
  candidateDomains?: (host: ControlledCandidateDomainHost) => ControlledCandidateRegistry;
  submitControlledTurn: typeof submitWeeklyPlanningControlledTurn;
  runtimeGateway: WeeklyPlanningTurnRuntimeGateway;
  stagingLifecycle: WeeklyPlanningTurnStagingLifecycle;
  outcomeLifecycle: WeeklyPlanningTurnOutcomeLifecycle;
}

const defaultServices: WeeklyPlanningTurnApplicationServices = {
  candidateDomains: weeklyPlanningRegisteredCandidateDomains,
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

  let semanticObservation: WeeklyPlanningSemanticTurnObservation | undefined;
  const runtimeInput = (turn: Parameters<SubmitWeeklyPlanningControlledTurnParams['execute']>[0], ): ExecuteWeeklyPlanningTurnRuntimeParams => {
    const { snapshot, pending, userText, supplementalContext, selectedStarterTarget } = turn;
    const input: ExecuteWeeklyPlanningTurnRuntimeParams = {
      ...(semanticObservation ? { semanticObservation } : {}),
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
    return input;
  };
  const runRuntime = (turn: Parameters<SubmitWeeklyPlanningControlledTurnParams['execute']>[0], selectedGraph?: Parameters<NonNullable<WeeklyPlanningTurnRuntimeGateway['continueSelectedTurn']>>[1], contribution?: ControlledCandidateSemanticContribution): Promise<WeeklyPlanningTurnExecutionResult> => {
    const input = runtimeInput(turn);
    return selectedGraph && services.runtimeGateway.continueSelectedTurn
      ? services.runtimeGateway.continueSelectedTurn(input, selectedGraph, contribution)
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

  semanticObservation = c5LocalSelection?.semanticObservation;
  const liveSourceAccess: ControlledCandidateDomainHost['sourceAccess'] = () => params.session.ownerId === params.userId
    && isPlannerDataReadyForOwner(params.plannerDataAvailability, params.userId)
    && params.isPlannerDataSnapshotCurrent?.() === true ? 'allowed' : 'denied';
  const candidateDomains = params.isPlannerDataSnapshotCurrent && services.runtimeGateway.continueSelectedTurn && services.runtimeGateway.prepareCandidateInput && services.runtimeGateway.candidateRequestContext
    ? services.candidateDomains?.({
        sourceAccess: liveSourceAccess, choiceServices: services.candidateChoice,
        censusMetadata: projectSemanticCensusMetadata({ questionCode: controlledCandidateQuestionCode(params.getState().intakeState),
          targetCount: params.getState().intakeState?.lastQuestionContext?.topicId ? 1 : null, binding: 'unknown', freshness: 'unknown' }),
        inputForTurn: turn => services.runtimeGateway.prepareCandidateInput!(runtimeInput(turn)).normalizerInput,
        requestContextForTurn: pending => services.runtimeGateway.candidateRequestContext!(pending, { timeZone: params.timeZone, weekStartsOn: params.weekStartsOn }),
        continueSelectedTurn: turn => runRuntime(turn, turn.graph, turn.semanticContribution),
        semanticObservation: () => semanticObservation,
        bindSemanticObservation: observation => { semanticObservation ??= observation; },
      }) : undefined;

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
    candidateDomains,
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
  return semanticObservation ? submission.then(
    result => { semanticObservation!.finish(result.recoveryRequired ? 'unknown' : result.accepted ? 'success' : 'failure'); return result; },
    error => { semanticObservation!.finish('failure'); throw error; },
  ) : submission;

}
