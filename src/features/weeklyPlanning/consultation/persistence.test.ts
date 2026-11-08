import { describe, expect, it } from 'vitest';
import type { ConsultationSessionState, ProposalAnswer, ReviewDecision } from './contracts';
import {
  CONSULTATION_MAX_PROPOSALS, CONSULTATION_MAX_PROPOSAL_BYTES, CONSULTATION_NO_FRESHNESS_FINGERPRINT, CONSULTATION_WITHDRAWN_ANSWER,
  validateConsultationSessionState,
} from './persistence';
import { applyReviewDecision, commitAdviceProposal, createConsultationSession } from './state';

const scope = { ownerId: 'owner-1', conversationId: 'conversation-1' };
const answer = (text = '基礎問題集を毎日1ページずつ進めましょう。'): ProposalAnswer => ({
  schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: text,
  options: [{ title: '毎日少しずつ', strategySummary: '短い時間を毎日', tradeoffs: ['進みは遅い'], recommendations: [{
    recommendationKind: 'study_method', rationale: '続けやすい', assumptionRefs: [], evidenceRefs: [], uncertainty: 'medium' }] }],
  assumptions: ['時間は毎日取れる'], overallUncertainty: 'medium',
});
const NOW = '2026-11-08T09:00:00.000Z';
const propose = (state: ConsultationSessionState, id: string, extra: Partial<ConsultationSessionState['proposals'][number]> = {}) => {
  const result = commitAdviceProposal(state, { adviceId: id, expectedConsultationRevision: state.revision, sourceQuestionTurnId: `turn-${id}`,
    answer: answer(), contextFingerprint: CONSULTATION_NO_FRESHNESS_FINGERPRINT, createdAt: NOW });
  if (!result.accepted) throw new Error(result.reason);
  return { ...result.state, proposals: result.state.proposals.map(proposal => proposal.adviceId === id ? { ...proposal, ...extra } : proposal) };
};
const decision = (state: ConsultationSessionState, action: ReviewDecision['action'] = 'approve'): ReviewDecision => ({
  decisionId: 'decision-1', consultationId: state.consultationId, targetAdviceId: state.activeAdviceId!, expectedAdviceRevision: state.activeAdviceRevision!,
  expectedConsultationRevision: state.revision, targetScope: { kind: 'proposal' }, action, feedback: null, sourceTurnId: 'turn-review', decidedAt: NOW });
const fresh = () => createConsultationSession({ consultationId: 'consultation-1', ...scope });
const check = (value: unknown) => validateConsultationSessionState(value, scope);
const reviewed = () => {
  const state = propose(fresh(), 'advice-1');
  const result = applyReviewDecision(state, { ...scope, decision: decision(state) });
  if (!result.accepted) throw new Error(result.reason);
  return result.state;
};

describe('consultation persistence reader (#246 slice 3)', () => {
  it('accepts the states the existing transitions produce: empty, proposed, approved, superseded, dismissed', () => {
    expect(check(fresh()).ok).toBe(true);
    expect(check(propose(fresh(), 'advice-1')).ok).toBe(true);
    expect(check(reviewed()).ok).toBe(true);
    expect(check(propose(reviewed(), 'advice-2')).ok).toBe(true);
    const proposed = propose(fresh(), 'advice-1');
    const dismissed = applyReviewDecision(proposed, { ...scope, decision: decision(proposed, 'dismiss') });
    expect(dismissed.accepted && check(dismissed.state).ok).toBe(true);
  });

  it('accepts a proposal that records the memory ids it came from, and a withdrawn proposal that keeps none of the words', () => {
    expect(check(propose(fresh(), 'advice-1', { derivedFromRecordIds: ['record-a', 'record-b'] })).ok).toBe(true);
    const withdrawn = propose(fresh(), 'advice-1', { derivedFromRecordIds: ['record-a'], answer: CONSULTATION_WITHDRAWN_ANSWER, withdrawnAt: NOW });
    expect(check(withdrawn).ok).toBe(true);
  });

  it('refuses a withdrawn proposal that still holds an answer, and duplicate or malformed derived ids', () => {
    expect(check(propose(fresh(), 'advice-1', { withdrawnAt: NOW })).ok).toBe(false);
    expect(check(propose(fresh(), 'advice-1', { derivedFromRecordIds: ['a', 'a'] })).ok).toBe(false);
    expect(check(propose(fresh(), 'advice-1', { derivedFromRecordIds: [''] })).ok).toBe(false);
  });

  it.each([
    ['another owner', (s: ConsultationSessionState) => ({ ...s, ownerId: 'someone-else' })],
    ['another conversation', (s: ConsultationSessionState) => ({ ...s, conversationId: 'other' })],
    ['an unknown key', (s: ConsultationSessionState) => ({ ...s, extra: 1 })],
    ['a negative revision', (s: ConsultationSessionState) => ({ ...s, revision: -1 })],
    ['a revision below the stored items', (s: ConsultationSessionState) => ({ ...s, revision: 0 })],
    ['a stored freshness check', (s: ConsultationSessionState) => ({ ...s, validityChecks: [{}] })],
    ['a stored promotion', (s: ConsultationSessionState) => ({ ...s, promotionOperations: [{}] })],
    ['a stored clarification', (s: ConsultationSessionState) => ({ ...s, pendingClarification: { clarificationId: 'c', sourceTurnId: 't', requestedMeaning: 'm', createdAt: NOW } })],
    ['an active leaf that does not exist', (s: ConsultationSessionState) => ({ ...s, activeAdviceId: 'missing' })],
    ['a closed consultation with an active leaf', (s: ConsultationSessionState) => ({ ...s, lifecycle: 'closed' as const })],
    ['a wrong fingerprint', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p, contextFingerprint: { ...p.contextFingerprint, digest: 'x' } })) })],
    ['a resolved date', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p, temporalResolutions: [{}] })) })],
    ['an evidence reference the model was never given', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p,
      answer: { ...p.answer, options: [{ ...p.answer.options[0], recommendations: [{ ...p.answer.options[0].recommendations[0], evidenceRefs: ['source-1'] }] }] } })) })],
    ['a clarification stored as a proposal', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p,
      answer: { schemaVersion: 'learning-consultation-answer.v1', kind: 'clarification', userFacingAnswer: 'q', requestedMeaning: 'm', whyItMatters: 'w', allowedUnknown: true } })) })],
    ['a proposal of another consultation', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p, consultationId: 'other' })) })],
    ['an oversized proposal', (s: ConsultationSessionState) => ({ ...s, proposals: s.proposals.map(p => ({ ...p,
      answer: answer('あ'.repeat(CONSULTATION_MAX_PROPOSAL_BYTES)) })) })],
  ])('fails closed for %s', (_name, damage) => {
    expect(check(damage(propose(fresh(), 'advice-1'))).ok).toBe(false);
  });

  it('fails closed for broken lineage, a second leaf, too many proposals and broken reviews', () => {
    const two = propose(propose(fresh(), 'advice-1'), 'advice-2');
    expect(check(two).ok).toBe(true);
    expect(check({ ...two, proposals: two.proposals.map(p => p.adviceId === 'advice-2' ? { ...p, supersedes: 'missing' } : p) }).ok).toBe(false);
    expect(check({ ...two, proposals: two.proposals.map(p => p.adviceId === 'advice-1' ? { ...p, supersededBy: null } : p) }).ok).toBe(false);
    expect(check({ ...two, proposals: two.proposals.map(p => p.adviceId === 'advice-2' ? { ...p, supersedes: 'advice-2' } : p) }).ok).toBe(false);
    expect(check({ ...two, proposals: [two.proposals[0], { ...two.proposals[0], adviceId: 'advice-1' }] }).ok).toBe(false);
    let many = fresh();
    for (let index = 0; index <= CONSULTATION_MAX_PROPOSALS; index += 1) many = propose(many, `advice-${index}`);
    expect(check(many).ok).toBe(false);
    const approved = reviewed();
    expect(check({ ...approved, reviewDecisions: [{ ...approved.reviewDecisions[0], targetAdviceId: 'missing' }] }).ok).toBe(false);
    expect(check({ ...approved, reviewDecisions: [{ ...approved.reviewDecisions[0], targetScope: { kind: 'option', optionIndex: 5 } }] }).ok).toBe(false);
    expect(check({ ...approved, reviewDecisions: [{ ...approved.reviewDecisions[0], action: 'adopt' }] }).ok).toBe(false);
    expect(check({ ...approved, reviewDecisions: [{ ...approved.reviewDecisions[0], expectedConsultationRevision: approved.revision }] }).ok).toBe(false);
    expect(check({ ...approved, reviewDecisions: [approved.reviewDecisions[0], approved.reviewDecisions[0]] }).ok).toBe(false);
  });

  it('accepts the shape a trimmed history leaves: the oldest kept proposal is a root and no review points at a dropped one (F2)', () => {
    let state = fresh();
    for (let index = 1; index <= 4; index += 1) state = propose(state, `advice-${index}`);
    const approved = applyReviewDecision(state, { ...scope, decision: { ...decision(state), decisionId: 'decision-kept' } });
    if (!approved.accepted) throw new Error(approved.reason);
    const [, second, third, fourth] = approved.state.proposals;
    const trimmed = { ...approved.state, proposals: [{ ...second, supersedes: null }, third, fourth] };
    expect(check(trimmed).ok).toBe(true);
    // The same drop without clearing the link, or with a review that still points at the dropped proposal, is refused.
    expect(check({ ...approved.state, proposals: [second, third, fourth] }).ok).toBe(false);
    const dangling = { ...trimmed, reviewDecisions: [...trimmed.reviewDecisions, { ...approved.state.reviewDecisions[0], decisionId: 'decision-dropped', targetAdviceId: 'advice-1' }] };
    expect(check(dangling).ok).toBe(false);
  });

  it('keeps a typical two-option proposal inside the size bound', () => {
    const typical: ProposalAnswer = { ...answer('あ'.repeat(400)), options: [0, 1].map(index => ({ title: `案${index}の名前`, strategySummary: 'い'.repeat(60), tradeoffs: ['う'.repeat(30)],
      recommendations: [0, 1].map(() => ({ recommendationKind: 'study_method', method: 'え'.repeat(30), rationale: 'お'.repeat(40), assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' as const })) })) };
    const state = commitAdviceProposal(fresh(), { adviceId: 'advice-1', expectedConsultationRevision: 0, sourceQuestionTurnId: 't', answer: typical,
      contextFingerprint: CONSULTATION_NO_FRESHNESS_FINGERPRINT, createdAt: NOW });
    expect(state.accepted && check(state.state).ok).toBe(true);
  });
});
