import { describe, expect, it } from 'vitest';
import type { ConsultationSessionState, ProposalAnswer } from './contracts';
import { projectAdviceView } from './adviceView';
import { CONSULTATION_NO_FRESHNESS_FINGERPRINT, CONSULTATION_WITHDRAWN_ANSWER } from './persistence';
import { applyReviewDecision, commitAdviceProposal, createConsultationSession, isAdviceReviewable } from './state';

const scope = { ownerId: 'owner-1', conversationId: 'conversation-1' };
const answer: ProposalAnswer = { schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: '助言', assumptions: [], overallUncertainty: 'low',
  options: [{ title: '案', strategySummary: '案', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method', rationale: '理由', assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' }] }] };
const at = '2026-11-08T09:00:00.000Z';
const propose = (state: ConsultationSessionState, id: string) => {
  const result = commitAdviceProposal(state, { adviceId: id, expectedConsultationRevision: state.revision, sourceQuestionTurnId: `t-${id}`, answer,
    contextFingerprint: CONSULTATION_NO_FRESHNESS_FINGERPRINT, createdAt: at });
  if (!result.accepted) throw new Error(result.reason);
  return result.state;
};
const review = (state: ConsultationSessionState, action: 'approve' | 'dismiss') => {
  const result = applyReviewDecision(state, { ...scope, decision: { decisionId: `d-${state.revision}`, consultationId: state.consultationId, targetAdviceId: state.activeAdviceId!,
    expectedAdviceRevision: state.activeAdviceRevision!, expectedConsultationRevision: state.revision, targetScope: { kind: 'proposal' }, action, feedback: null,
    sourceTurnId: 'ui', decidedAt: at } });
  if (!result.accepted) throw new Error(result.reason);
  return result.state;
};
const fresh = () => createConsultationSession({ consultationId: 'c-1', ...scope });

describe('the advice view (#246 slice 3)', () => {
  it('is reviewable exactly when the transitions say the active advice is reviewable', () => {
    const proposed = propose(fresh(), 'a1');
    const approved = review(proposed, 'approve');
    const superseded = propose(approved, 'a2');
    const withdrawn = { ...proposed, proposals: proposed.proposals.map(p => ({ ...p, answer: CONSULTATION_WITHDRAWN_ANSWER, withdrawnAt: at })) };
    for (const state of [fresh(), proposed, approved, superseded, review(proposed, 'dismiss'), withdrawn]) {
      const view = projectAdviceView(state);
      const reviewable = state.activeAdviceId !== null && isAdviceReviewable(state, state.activeAdviceId, state.activeAdviceRevision!);
      expect(view?.status === 'reviewable').toBe(reviewable);
    }
  });

  it('names the status, options and revisions the screen needs', () => {
    const proposed = propose(fresh(), 'a1');
    expect(projectAdviceView(proposed)).toEqual({ status: 'reviewable', adviceId: 'a1', adviceRevision: 1, consultationRevision: proposed.revision, optionTitles: ['案'] });
    expect(projectAdviceView(review(proposed, 'approve'))?.status).toBe('approved');
    expect(projectAdviceView(review(proposed, 'dismiss'))).toBeNull();
    expect(projectAdviceView(undefined)).toBeNull();
  });
});
