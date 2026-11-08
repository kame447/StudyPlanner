import { describe, expect, it } from 'vitest';
import type { ConsultationSessionState, ProposalAnswer } from './contracts';
import { CONSULTATION_MAX_PROPOSALS, CONSULTATION_WITHDRAWN_ANSWER, validateConsultationSessionState } from './persistence';
import { applyReviewDecision } from './state';
import { closeConsultation, commitStoredAdvice, trimConsultationHistory, withdrawProposalsDerivedFrom } from './storage';

const scope = { ownerId: 'owner-1', conversationId: 'conversation-1' };
const answer = (text: string): ProposalAnswer => ({ schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: text, assumptions: [],
  overallUncertainty: 'low', options: [{ title: '案', strategySummary: '案', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method', rationale: '理由',
    assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' }] }] });
const at = (second: number) => new Date(Date.UTC(2026, 10, 8, 9, 0, second)).toISOString();
const commit = (prior: ConsultationSessionState | undefined, second: number, derived: string[] = []) =>
  commitStoredAdvice(prior, { ...scope, answer: answer(`助言${second}`), derivedFromRecordIds: derived, now: at(second) })!;
const valid = (state: ConsultationSessionState) => validateConsultationSessionState(state, scope).ok;

describe('stored advice transitions (#246 slice 3)', () => {
  it('drops the oldest proposal and the reviews pointing at it when the fifth is written, leaving a root (F2)', () => {
    let state = commit(undefined, 1);
    const reviewed = applyReviewDecision(state, { ...scope, decision: { decisionId: 'd1', consultationId: state.consultationId, targetAdviceId: state.activeAdviceId!,
      expectedAdviceRevision: 1, expectedConsultationRevision: state.revision, targetScope: { kind: 'proposal' }, action: 'approve', feedback: null,
      sourceTurnId: 'ui', decidedAt: at(2) } });
    if (!reviewed.accepted) throw new Error(reviewed.reason);
    state = reviewed.state;
    for (let second = 3; second <= 3 + CONSULTATION_MAX_PROPOSALS - 1; second += 1) state = commit(state, second);
    expect(state.proposals).toHaveLength(CONSULTATION_MAX_PROPOSALS);
    expect(state.proposals.map(proposal => proposal.answer.userFacingAnswer)).not.toContain('助言1');
    expect(state.proposals[0].supersedes).toBeNull();
    expect(state.reviewDecisions).toEqual([]);
    expect(valid(state)).toBe(true);
  });

  it('trimming leaves a state within the bound unchanged', () => {
    const state = commit(commit(undefined, 1), 2);
    expect(trimConsultationHistory(state)).toBe(state);
  });

  it('refuses to store a proposal over the size bound, and a closed consultation starts a fresh one', () => {
    expect(commitStoredAdvice(undefined, { ...scope, answer: answer('あ'.repeat(4096)), derivedFromRecordIds: [], now: at(1) })).toBeNull();
    const first = commit(undefined, 1);
    const closed = closeConsultation(first);
    expect(closed).toMatchObject({ lifecycle: 'closed', activeAdviceId: null });
    expect(valid(closed)).toBe(true);
    const next = commit(closed, 2);
    expect(next.consultationId).not.toBe(first.consultationId);
    expect(next.proposals).toHaveLength(1);
  });

  it('withdraws only proposals written from the forgotten record, to the fixed placeholder', () => {
    const state = commit(commit(undefined, 1, ['goal-1']), 2, ['goal-2']);
    const result = withdrawProposalsDerivedFrom(state, new Set(['goal-1']), at(9));
    expect(result.changed).toBe(true);
    expect(result.state.proposals[0]).toMatchObject({ answer: CONSULTATION_WITHDRAWN_ANSWER, withdrawnAt: at(9), derivedFromRecordIds: ['goal-1'] });
    expect(result.state.proposals[1]).toEqual(state.proposals[1]);
    expect(valid(result.state)).toBe(true);
    expect(withdrawProposalsDerivedFrom(result.state, new Set(['goal-1']), at(10)).changed).toBe(false);
    expect(withdrawProposalsDerivedFrom(state, new Set(['other']), at(10))).toEqual({ state, changed: false });
  });
});
