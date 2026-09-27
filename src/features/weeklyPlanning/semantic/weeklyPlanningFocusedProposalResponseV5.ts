import {
  isProposalResponseDecisionContext,
  parseProposalResponseDecisionContent,
  type ProposalResponseDecisionContext,
} from '../../../../shared/proposalResponseDecision';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningSemanticNormalizerInputV5,
  WeeklyPlanningSemanticNormalizerResultV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

/**
 * Application-resolved eligibility for the bounded proposal-response decision.
 * The proposal ID stays on the client; only the typed projection is sent.
 */
export interface WeeklyPlanningProposalResponseCandidateV5 {
  proposalPublicId: string;
  /** PlanningState revision the presentation binding was committed at. */
  inputRevision: number;
  presentedAssistantText: string;
  proposal: ProposalResponseDecisionContext['state']['proposal'];
}

export function proposalResponseDecisionContextV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): ProposalResponseDecisionContext | undefined {
  const candidate = input.proposalResponseCandidate;
  if (!candidate || !input.traceRequestId) return undefined;
  if (input.supplementalContext?.trim() || input.selectedStarterTarget) return undefined;
  const context = {
    purpose: 'proposal_response' as const,
    requestId: input.traceRequestId,
    inputRevision: candidate.inputRevision,
    state: {
      currentUserText: input.userText.trim(),
      presentedAssistantText: candidate.presentedAssistantText,
      proposal: {
        kind: candidate.proposal.kind,
        taskTitle: candidate.proposal.taskTitle,
        sessionMinutes: { ...candidate.proposal.sessionMinutes },
      },
    },
  };
  return isProposalResponseDecisionContext(context) ? context : undefined;
}

/** The complete meaning of a pure rejection of the bound proposal. */
export function createProposalRejectDocumentV5(params: {
  proposalPublicId: string;
  userText: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [{
      localId: 'proposal-response-reject',
      target: {
        kind: 'proposal',
        publicId: params.proposalPublicId,
        localId: null,
        mention: null,
      },
      decision: 'reject',
      sourceText: params.userText.trim(),
    }],
  };
}

/**
 * Handles the response of an initial generic request that carried a proposal-response
 * context. Returns an accepted result only for a correlated closed decision whose
 * deterministic document passes the normal validator; otherwise null, and the
 * response is treated as the ordinary generic semantic document.
 */
export function acceptProposalResponseDecisionV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  context: ProposalResponseDecisionContext;
  response: string;
}): WeeklyPlanningSemanticNormalizerResultV5 | 'invalid_decision' | null {
  const { run, context, response } = params;
  const candidate = run.input.proposalResponseCandidate;
  const decision = parseProposalResponseDecisionContent(response, {
    requestId: context.requestId,
    inputRevision: context.inputRevision,
  });
  if (!decision || !candidate) return null;

  const document = createProposalRejectDocumentV5({
    proposalPublicId: candidate.proposalPublicId,
    userText: run.input.userText,
  });
  const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
    currentUserText: run.input.userText,
    supplementalContext: run.input.supplementalContext,
    selectedStarterTarget: run.input.selectedStarterTarget,
    recentConversation: run.input.recentConversation,
    publicStateSummary: run.input.publicStateSummary,
    committedGraph: run.input.committedGraph,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: run.input.traceRequestId,
    stage: 'semantic_proposal_response_result',
    data: {
      decision: decision.proposalResponse.decision,
      documentAccepted: validation.document !== null,
      validationErrors: validation.errors,
    },
  });
  if (!validation.document) return 'invalid_decision';

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: validation.document,
    diagnostics: run.diagnostics({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      providerError: null,
    }),
  };
  run.recordDecision(result, { route: 'proposal_response_reject' });
  return result;
}
