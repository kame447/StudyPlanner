// Producer-side helpers for the consultation stored in a VNext checkpoint (#246 slice 3): commit one advice, bound the
// history, close a consultation, and withdraw what a forgotten memory fed. Pure; the stored shape is persistence.ts's.
import type { ConsultationSessionState, ProposalAnswer } from './contracts';
import {
  CONSULTATION_MAX_PROPOSALS, CONSULTATION_MAX_PROPOSAL_BYTES, CONSULTATION_NO_FRESHNESS_FINGERPRINT, CONSULTATION_WITHDRAWN_ANSWER,
  validateConsultationSessionState,
} from './persistence';
import { commitAdviceProposal, createConsultationSession } from './state';

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 40);

/** Keeps the newest proposals and the reviews of those; the oldest kept proposal becomes a root. */
export function trimConsultationHistory(state: ConsultationSessionState): ConsultationSessionState {
  if (state.proposals.length <= CONSULTATION_MAX_PROPOSALS) return state;
  const kept = state.proposals.slice(-CONSULTATION_MAX_PROPOSALS);
  const ids = new Set(kept.map(proposal => proposal.adviceId));
  return {
    ...state,
    proposals: kept.map(proposal => proposal.supersedes !== null && !ids.has(proposal.supersedes) ? { ...proposal, supersedes: null } : proposal),
    reviewDecisions: state.reviewDecisions.filter(decision => ids.has(decision.targetAdviceId)),
  };
}

/** Ends a consultation without a decision (a newer advice was shown that could not be stored). */
export function closeConsultation(state: ConsultationSessionState): ConsultationSessionState {
  return state.lifecycle === 'closed' ? state
    : { ...state, revision: state.revision + 1, lifecycle: 'closed', activeAdviceId: null, activeAdviceRevision: null };
}

/**
 * The consultation after a proposal was shown: a new proposal on the active consultation, or on a fresh one when the
 * last was closed. Null when the proposal cannot be stored (over the size bound) or the result would not read back.
 */
export function commitStoredAdvice(prior: ConsultationSessionState | undefined, params: {
  ownerId: string; conversationId: string; answer: ProposalAnswer; derivedFromRecordIds: readonly string[]; now: string;
}): ConsultationSessionState | null {
  const base = prior && prior.lifecycle === 'active' ? prior : createConsultationSession({
    consultationId: `consultation-${digits(params.now)}`, ownerId: params.ownerId, conversationId: params.conversationId });
  const result = commitAdviceProposal(base, { adviceId: `advice-${digits(params.now)}-${base.revision}`, expectedConsultationRevision: base.revision,
    sourceQuestionTurnId: `turn-${digits(params.now)}`, answer: params.answer, contextFingerprint: CONSULTATION_NO_FRESHNESS_FINGERPRINT,
    createdAt: params.now });
  if (!result.accepted) return null;
  const derived = [...new Set(params.derivedFromRecordIds)].slice(0, 30);
  const leafId = result.state.activeAdviceId;
  const state = trimConsultationHistory({ ...result.state, proposals: result.state.proposals.map(proposal =>
    proposal.adviceId === leafId && derived.length ? { ...proposal, derivedFromRecordIds: derived } : proposal) });
  const leaf = state.proposals.find(proposal => proposal.adviceId === leafId);
  if (!leaf || new TextEncoder().encode(JSON.stringify(leaf)).byteLength > CONSULTATION_MAX_PROPOSAL_BYTES) return null;
  return validateConsultationSessionState(state, { ownerId: params.ownerId, conversationId: params.conversationId }).ok ? state : null;
}

/** Proposals written from a forgotten record keep none of their words; reviews already decided stay as history. */
export function withdrawProposalsDerivedFrom(state: ConsultationSessionState, recordIds: ReadonlySet<string>, at: string):
  { state: ConsultationSessionState; changed: boolean } {
  const affected = (proposal: ConsultationSessionState['proposals'][number]) => !proposal.withdrawnAt
    && (proposal.derivedFromRecordIds ?? []).some(id => recordIds.has(id));
  if (!state.proposals.some(affected)) return { state, changed: false };
  return { changed: true, state: { ...state, revision: state.revision + 1, proposals: state.proposals.map(proposal =>
    affected(proposal) ? { ...proposal, answer: CONSULTATION_WITHDRAWN_ANSWER, withdrawnAt: at } : proposal) } };
}
