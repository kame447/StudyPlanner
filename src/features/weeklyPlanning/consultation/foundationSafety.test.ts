import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEARNING_CONSULTATION_ANSWER_VERSION,
  LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  applyReviewDecision,
  buildContextFingerprint,
  commitAdviceProposal,
  createConsultationSession,
  isAdviceReviewable,
  isTemporalCandidate,
  resolveTemporalCandidate,
  sameContextFingerprint,
  type ContextFingerprint,
  type ProposalAnswer,
  type ReviewDecision,
} from './index';

const answer: ProposalAnswer = {
  schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION,
  kind: 'proposal',
  userFacingAnswer: '案です。',
  options: [{
    title: '案',
    strategySummary: '戦略',
    recommendations: [{ recommendationKind: 'study_method', rationale: '理由', assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' }],
    tradeoffs: [],
  }],
  assumptions: [],
  overallUncertainty: 'low',
};

const fingerprint: ContextFingerprint = {
  version: LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  digest: 'fixture',
  canonicalBasis: 'fixture-basis',
};

function review(action: ReviewDecision['action'], revision: number, id: string): ReviewDecision {
  return {
    decisionId: id,
    consultationId: 'consultation-1',
    targetAdviceId: 'advice-1',
    expectedAdviceRevision: 1,
    expectedConsultationRevision: revision,
    targetScope: { kind: 'proposal' },
    action,
    feedback: null,
    sourceTurnId: `turn-${id}`,
    decidedAt: '2026-09-02T01:00:00+09:00',
  };
}

function proposalState() {
  const initial = createConsultationSession({ consultationId: 'consultation-1', ownerId: 'owner-1', conversationId: 'conversation-1' });
  const result = commitAdviceProposal(initial, {
    adviceId: 'advice-1',
    expectedConsultationRevision: 0,
    sourceQuestionTurnId: 'turn-1',
    answer,
    contextFingerprint: fingerprint,
    createdAt: '2026-09-02T01:00:00+09:00',
  });
  if (!result.accepted) throw new Error('fixture failed');
  return result.state;
}

describe('learning consultation foundation hardening', () => {
  it.each(['request_revision', 'request_alternative'] as const)(
    'consumes the old reviewable leaf after %s',
    (action) => {
      const state = proposalState();
      const first = applyReviewDecision(state, {
        ownerId: 'owner-1',
        conversationId: 'conversation-1',
        decision: review(action, state.revision, 'first'),
      });
      expect(first.accepted).toBe(true);
      if (!first.accepted) return;
      expect(isAdviceReviewable(first.state, 'advice-1', 1)).toBe(false);
      const approve = applyReviewDecision(first.state, {
        ownerId: 'owner-1',
        conversationId: 'conversation-1',
        decision: review('approve', first.state.revision, 'approve'),
      });
      expect(approve).toMatchObject({ accepted: false, reason: 'review_already_consumed' });
    },
  );

  it('uses exact canonical basis rather than the short display digest as freshness authority', () => {
    const left = { version: LEARNING_CONSULTATION_FINGERPRINT_VERSION, digest: 'same-short-hash', canonicalBasis: 'basis-a' };
    const right = { version: LEARNING_CONSULTATION_FINGERPRINT_VERSION, digest: 'same-short-hash', canonicalBasis: 'basis-b' };
    expect(sameContextFingerprint(left, right)).toBe(false);

    const built = buildContextFingerprint({
      requestTemporalContext: { currentDate: '2026-09-02', currentDateTime: '2026-09-02T01:00:00+09:00', timezone: 'Asia/Tokyo', weekStartsOn: 1, authoritativeDates: {} },
      sources: [], deterministicSignals: [], evidenceDigests: [], materialBindingBasis: [],
    });
    expect(built.canonicalBasis.length).toBeGreaterThan(0);
  });

  it('rejects temporal values that cannot fit the canonical four-digit date contract', () => {
    expect(isTemporalCandidate({ kind: 'month_end', year: 10000, month: 1 })).toBe(false);
    expect(resolveTemporalCandidate(
      { kind: 'relative_to_exam', examRef: 'exam', offsetDays: Number.MAX_SAFE_INTEGER },
      { currentDate: '2026-09-02', currentDateTime: '2026-09-02T01:00:00+09:00', timezone: 'Asia/Tokyo', weekStartsOn: 1, authoritativeDates: { exam: '2027-01-16' } },
    )).toMatchObject({ resolved: false, reason: 'resolved_date_out_of_range' });
  });

  it('remains a dormant pure foundation with no production-runtime imports', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const name of files) {
      const source = readFileSync(join(directory, name), 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      expect(imports.every((specifier) => specifier.startsWith('./'))).toBe(true);
      expect(source).not.toContain('weeklyPlanningTurnController');
      expect(source).not.toContain('useWeeklyPlanningApplication');
      expect(source).not.toContain('firebase');
      expect(source).not.toContain('OpenAI');
    }
  });
});
