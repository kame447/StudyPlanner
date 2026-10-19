import type { ControlledCandidateSemanticContribution } from './weeklyPlanningControlledCandidateDomains';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { createStableV5SemanticPublicStateSummary, STABLE_V5_RECENT_TURN_LIMIT } from './weeklyPlanningStableV5SemanticContext';
import { readC5RuntimeGraph } from './c5LocalSelection/controlledCommit';
import { durableWeeklyPlanningEnabled, executeDurableWeeklyTurn, readDurableWeeklyTurnReceipt, saveDurableWeeklyTurnReceipt } from './weeklyPlanningDurableTurnClient';
import { getOrCreateWeeklyPlanningStableV5RuntimeSession, commitWeeklyPlanningStableV5RuntimeGraph } from './weeklyPlanningStableV5RuntimeSession';
import { loadUserPlanningContextSnapshotV1, stageUserPlanningContextFactsV1 } from '../../userPlanningContext/userPlanningContextSpace';
import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensusTypes';
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
import type { WeeklyPlanningMachineBoundEffortAnswerV5 } from '../semantic/weeklyPlanningMachineBoundAnswerV5';
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
  machineBoundAnswer?: WeeklyPlanningMachineBoundEffortAnswerV5;
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
  resumeDurable?: boolean;
}

export interface WeeklyPlanningTurnRuntimeGateway {
  continueSelectedTurn?(params: ExecuteWeeklyPlanningTurnRuntimeParams, graph: WeeklyPlanningFactGraphV5, semanticContribution?: ControlledCandidateSemanticContribution): Promise<WeeklyPlanningTurnExecutionResult>;
  candidateRequestContext?(pending: WeeklyPlanningPendingTurn, options: Pick<ExecuteWeeklyPlanningTurnRuntimeParams, 'timeZone' | 'weekStartsOn'>): ReturnType<typeof createWeeklyPlanningTurnRequestContext>;
  prepareCandidateInput?(params: ExecuteWeeklyPlanningTurnRuntimeParams): { normalizerInput: WeeklyPlanningSemanticNormalizerInputV5; requestContext: ReturnType<typeof createWeeklyPlanningTurnRequestContext> };
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
    ...(params.machineBoundAnswer ? { machineBoundAnswer: params.machineBoundAnswer } : {}),
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
    async continueSelectedTurn(params, graph, semanticContribution) {
      const { continueWeeklyPlanningSelectedCandidateTurn } = await import('./weeklyPlanningStableV5CandidateContinuation');
      return continueWeeklyPlanningSelectedCandidateTurn(executionInput(params, services.bindStableV5SessionScope), graph, semanticContribution);
    },
    candidateRequestContext(pending, options) {
      return createWeeklyPlanningTurnRequestContext({ startedAtIso: pending.startedAt,
        timeZone: options.timeZone ?? resolvedTimeZone(), weekStartsOn: options.weekStartsOn ?? 'monday' });
    },
    prepareCandidateInput(params) {
      const input = executionInput(params, services.bindStableV5SessionScope);
      const graph = readC5RuntimeGraph(input.userId, input.conversationId);
      return { requestContext: input.requestContext, normalizerInput: {
        userText: input.userText, supplementalContext: input.supplementalContext, selectedStarterTarget: input.selectedStarterTarget,
        traceRequestId: input.traceRequestId, committedGraph: structuredClone(graph),
        recentConversation: input.messages.slice(-STABLE_V5_RECENT_TURN_LIMIT).map(({ role, content }) => ({ role, content })),
        publicStateSummary: createStableV5SemanticPublicStateSummary({ graph, messages: input.messages,
          previousState: input.previousState, inputStateRevision: input.inputStateRevision, ownerId: input.userId,
          currentDate: input.requestContext.currentDate, userText: input.userText, studyMaterials: input.studyMaterials ?? [] }),
      } };
    },
    async execute(params) {
      const input = executionInput(params, services.bindStableV5SessionScope);
      const { requestContext } = input;
      if (!durableWeeklyPlanningEnabled()) return services.executeTurn(input);
      const session = getOrCreateWeeklyPlanningStableV5RuntimeSession({ ownerId: params.userId,
        conversationId: params.pending.conversationId });
      const { isCurrentTurn: _guard, semanticObservation: _observation, ...serializableInput } = input;
      const existing = readDurableWeeklyTurnReceipt(params.userId);
      const receipt = params.resumeDurable ? existing : {
        version: 1 as const, ownerId: params.userId, snapshot: params.snapshot, pending: params.pending,
        payload: { input: serializableInput, graph: session.graph, weekStartDate: params.snapshot.weekStartDate,
          userContextRecords: loadUserPlanningContextSnapshotV1({ ownerId: params.userId,
            currentDate: requestContext.currentDate }).records },
      };
      if (!receipt || receipt.pending.requestId !== params.pending.requestId
        || receipt.pending.conversationId !== params.pending.conversationId) throw new Error('会話の復帰情報が一致しません。');
      if (!params.resumeDurable) saveDurableWeeklyTurnReceipt(receipt);
      const completed = await executeDurableWeeklyTurn(receipt, {
        resumeOnly: params.resumeDurable, isCurrent: params.isCurrentTurn,
      });
      if (params.isCurrentTurn?.() === false) throw new Error('会話の所有者が変わりました。');
      if (!completed.result.failure && completed.result.stableV5Graph) {
        commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: params.userId,
          conversationId: params.pending.conversationId, graph: completed.result.stableV5Graph });
        stageUserPlanningContextFactsV1({ ownerId: params.userId, conversationId: params.pending.conversationId,
          requestId: params.pending.requestId, observedDate: completed.observedDate, facts: completed.stagedContextFacts });
      }
      return completed.result;
    },
  };
}

export const weeklyPlanningTurnRuntimeGateway = createWeeklyPlanningTurnRuntimeGateway();
