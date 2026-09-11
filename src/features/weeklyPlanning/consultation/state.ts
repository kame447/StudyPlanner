import type {
  AdviceProposal,
  ConsultationSessionState,
  ContextFingerprint,
  MaterialBinding,
  PendingConsultationClarification,
  ProposalAnswer,
  ReviewDecision,
  ReviewTargetScope,
  TemporalResolution,
} from './contracts';

export function createConsultationSession(params: {
  consultationId: string;
  ownerId: string;
  conversationId: string;
}): ConsultationSessionState {
  return {
    consultationId: params.consultationId,
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    revision: 0,
    lifecycle: 'active',
    activeAdviceId: null,
    activeAdviceRevision: null,
    proposals: [],
    reviewDecisions: [],
    validityChecks: [],
    promotionOperations: [],
    promotionReceipts: [],
    pendingClarification: null,
  };
}

export type ConsultationTransitionResult =
  | { accepted: true; state: ConsultationSessionState }
  | { accepted: false; state: ConsultationSessionState; reason: string };

function activeProposal(state: ConsultationSessionState): AdviceProposal | null {
  if (!state.activeAdviceId || state.activeAdviceRevision === null) return null;
  return state.proposals.find(
    (proposal) => proposal.adviceId === state.activeAdviceId
      && proposal.revision === state.activeAdviceRevision,
  ) ?? null;
}

export function commitAdviceProposal(
  state: ConsultationSessionState,
  params: {
    adviceId: string;
    expectedConsultationRevision: number;
    sourceQuestionTurnId: string;
    answer: ProposalAnswer;
    contextFingerprint: ContextFingerprint;
    temporalResolutions?: readonly TemporalResolution[];
    materialBindings?: readonly MaterialBinding[];
    createdAt: string;
  },
): ConsultationTransitionResult {
  if (state.lifecycle !== 'active') return { accepted: false, state, reason: 'consultation_closed' };
  if (state.revision !== params.expectedConsultationRevision) {
    return { accepted: false, state, reason: 'stale_consultation_revision' };
  }
  if (state.proposals.some((proposal) => proposal.adviceId === params.adviceId)) {
    return { accepted: false, state, reason: 'duplicate_advice_id' };
  }

  const previous = activeProposal(state);
  const nextAdviceRevision = (previous?.revision ?? 0) + 1;
  const nextProposal: AdviceProposal = {
    adviceId: params.adviceId,
    consultationId: state.consultationId,
    revision: nextAdviceRevision,
    sourceQuestionTurnId: params.sourceQuestionTurnId,
    supersedes: previous?.adviceId ?? null,
    supersededBy: null,
    answer: params.answer,
    contextFingerprint: params.contextFingerprint,
    temporalResolutions: params.temporalResolutions ?? [],
    materialBindings: params.materialBindings ?? [],
    createdAt: params.createdAt,
  };

  const proposals = previous
    ? state.proposals.map((proposal) => (
        proposal.adviceId === previous.adviceId && proposal.revision === previous.revision
          ? { ...proposal, supersededBy: nextProposal.adviceId }
          : proposal
      ))
    : [...state.proposals];

  return {
    accepted: true,
    state: {
      ...state,
      revision: state.revision + 1,
      activeAdviceId: nextProposal.adviceId,
      activeAdviceRevision: nextProposal.revision,
      proposals: [...proposals, nextProposal],
      pendingClarification: null,
    },
  };
}

function scopeExists(proposal: AdviceProposal, scope: ReviewTargetScope): boolean {
  if (scope.kind === 'proposal') return true;
  return Number.isInteger(scope.optionIndex)
    && scope.optionIndex >= 0
    && scope.optionIndex < proposal.answer.options.length;
}

export function applyReviewDecision(
  state: ConsultationSessionState,
  params: {
    ownerId: string;
    conversationId: string;
    decision: ReviewDecision;
  },
): ConsultationTransitionResult {
  const { decision } = params;
  if (params.ownerId !== state.ownerId || params.conversationId !== state.conversationId) {
    return { accepted: false, state, reason: 'owner_or_conversation_mismatch' };
  }
  if (state.lifecycle !== 'active') return { accepted: false, state, reason: 'consultation_closed' };
  if (decision.consultationId !== state.consultationId) {
    return { accepted: false, state, reason: 'consultation_mismatch' };
  }
  if (state.reviewDecisions.some((candidate) => candidate.decisionId === decision.decisionId)) {
    return { accepted: false, state, reason: 'duplicate_decision' };
  }
  if (state.revision !== decision.expectedConsultationRevision) {
    return { accepted: false, state, reason: 'stale_consultation_revision' };
  }

  const proposal = activeProposal(state);
  if (!proposal
      || proposal.adviceId !== decision.targetAdviceId
      || proposal.revision !== decision.expectedAdviceRevision) {
    return { accepted: false, state, reason: 'not_active_advice_leaf' };
  }
  if (!scopeExists(proposal, decision.targetScope)) {
    return { accepted: false, state, reason: 'invalid_review_scope' };
  }
  if (state.reviewDecisions.some(
    (candidate) => candidate.targetAdviceId === proposal.adviceId
      && candidate.expectedAdviceRevision === proposal.revision,
  )) {
    return { accepted: false, state, reason: 'review_already_consumed' };
  }

  const nextLifecycle = decision.action === 'dismiss' ? 'closed' : state.lifecycle;
  return {
    accepted: true,
    state: {
      ...state,
      revision: state.revision + 1,
      lifecycle: nextLifecycle,
      activeAdviceId: nextLifecycle === 'closed' ? null : state.activeAdviceId,
      activeAdviceRevision: nextLifecycle === 'closed' ? null : state.activeAdviceRevision,
      reviewDecisions: [...state.reviewDecisions, decision],
      pendingClarification: null,
    },
  };
}

export function commitPendingClarification(
  state: ConsultationSessionState,
  params: {
    expectedConsultationRevision: number;
    clarification: PendingConsultationClarification;
  },
): ConsultationTransitionResult {
  if (state.lifecycle !== 'active') return { accepted: false, state, reason: 'consultation_closed' };
  if (state.revision !== params.expectedConsultationRevision) {
    return { accepted: false, state, reason: 'stale_consultation_revision' };
  }

  return {
    accepted: true,
    state: {
      ...state,
      revision: state.revision + 1,
      pendingClarification: params.clarification,
    },
  };
}

export function isAdviceReviewable(
  state: ConsultationSessionState,
  adviceId: string,
  adviceRevision: number,
): boolean {
  if (state.lifecycle !== 'active') return false;
  if (state.activeAdviceId !== adviceId || state.activeAdviceRevision !== adviceRevision) return false;
  return !state.reviewDecisions.some(
    (decision) => decision.targetAdviceId === adviceId
      && decision.expectedAdviceRevision === adviceRevision,
  );
}
