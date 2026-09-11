import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LEARNING_CONSULTATION_ANSWER_VERSION,
  LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  type ContextFingerprint,
  type ProposalAnswer,
  type ReviewDecision,
} from './contracts';
import { projectActiveInteraction } from './activeInteraction';
import {
  applyReviewDecision,
  commitAdviceProposal,
  createConsultationSession,
  isAdviceReviewable,
} from './state';

const fingerprint: ContextFingerprint = {
  version: LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  digest: 'abc12345',
  canonicalBasis: 'fixture-basis',
};

function answer(title: string): ProposalAnswer {
  return {
    schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION,
    kind: 'proposal',
    userFacingAnswer: `${title}です`,
    options: [
      {
        title,
        strategySummary: `${title}の概要`,
        recommendations: [
          {
            recommendationKind: 'study_method',
            rationale: '根拠',
            assumptionRefs: [],
            evidenceRefs: [],
            uncertainty: 'low',
          },
        ],
        tradeoffs: [],
      },
    ],
    assumptions: [],
    overallUncertainty: 'low',
  };
}

function decision(params: {
  decisionId: string;
  targetAdviceId: string;
  adviceRevision: number;
  consultationRevision: number;
  action?: ReviewDecision['action'];
  optionIndex?: number;
}): ReviewDecision {
  return {
    decisionId: params.decisionId,
    consultationId: 'consultation-1',
    targetAdviceId: params.targetAdviceId,
    expectedAdviceRevision: params.adviceRevision,
    expectedConsultationRevision: params.consultationRevision,
    targetScope: params.optionIndex === undefined
      ? { kind: 'proposal' }
      : { kind: 'option', optionIndex: params.optionIndex },
    action: params.action ?? 'approve',
    feedback: null,
    sourceTurnId: `turn-${params.decisionId}`,
    decidedAt: '2026-09-01T16:20:00.000Z',
  };
}

describe('learning consultation state foundation', () => {
  it('fails closed when more than one formal interaction claims a short reply', () => {
    const projection = projectActiveInteraction([
      { kind: 'planning_clarification', targetId: 'question-1', expectedRevision: 3 },
      { kind: 'consultation_review', targetId: 'advice-1', expectedRevision: 1 },
    ]);

    expect(projection.kind).toBe('conflict');
  });

  it('deduplicates the same formal claim without inventing a second authority', () => {
    const projection = projectActiveInteraction([
      { kind: 'consultation_review', targetId: 'advice-1', expectedRevision: 1 },
      { kind: 'consultation_review', targetId: 'advice-1', expectedRevision: 1 },
    ]);

    expect(projection).toEqual({
      kind: 'consultation_review',
      targetId: 'advice-1',
      expectedRevision: 1,
    });
  });

  it('makes a new proposal the only reviewable leaf', () => {
    const initial = createConsultationSession({
      consultationId: 'consultation-1',
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    const first = commitAdviceProposal(initial, {
      adviceId: 'advice-1',
      expectedConsultationRevision: 0,
      sourceQuestionTurnId: 'turn-1',
      answer: answer('案1'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:00:00.000Z',
    });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;

    const second = commitAdviceProposal(first.state, {
      adviceId: 'advice-2',
      expectedConsultationRevision: 1,
      sourceQuestionTurnId: 'turn-2',
      answer: answer('案2'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:10:00.000Z',
    });
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;

    expect(isAdviceReviewable(second.state, 'advice-1', 1)).toBe(false);
    expect(isAdviceReviewable(second.state, 'advice-2', 2)).toBe(true);
    expect(second.state.proposals[0]).toMatchObject({
      adviceId: 'advice-1',
      supersededBy: 'advice-2',
    });
    expect(second.state.proposals[1]).toMatchObject({
      adviceId: 'advice-2',
      supersedes: 'advice-1',
    });
  });

  it('rejects a delayed command for a superseded proposal revision', () => {
    const initial = createConsultationSession({
      consultationId: 'consultation-1',
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    const first = commitAdviceProposal(initial, {
      adviceId: 'advice-1',
      expectedConsultationRevision: 0,
      sourceQuestionTurnId: 'turn-1',
      answer: answer('案1'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:00:00.000Z',
    });
    if (!first.accepted) throw new Error('fixture failed');
    const second = commitAdviceProposal(first.state, {
      adviceId: 'advice-2',
      expectedConsultationRevision: 1,
      sourceQuestionTurnId: 'turn-2',
      answer: answer('案2'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:10:00.000Z',
    });
    if (!second.accepted) throw new Error('fixture failed');

    const result = applyReviewDecision(second.state, {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      decision: decision({
        decisionId: 'decision-old',
        targetAdviceId: 'advice-1',
        adviceRevision: 1,
        consultationRevision: 2,
      }),
    });

    expect(result).toMatchObject({ accepted: false, reason: 'not_active_advice_leaf' });
  });

  it('allows one successful adoption per advice revision', () => {
    const initial = createConsultationSession({
      consultationId: 'consultation-1',
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    const proposal = commitAdviceProposal(initial, {
      adviceId: 'advice-1',
      expectedConsultationRevision: 0,
      sourceQuestionTurnId: 'turn-1',
      answer: answer('案1'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:00:00.000Z',
    });
    if (!proposal.accepted) throw new Error('fixture failed');

    const approved = applyReviewDecision(proposal.state, {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      decision: decision({
        decisionId: 'decision-1',
        targetAdviceId: 'advice-1',
        adviceRevision: 1,
        consultationRevision: 1,
      }),
    });
    expect(approved.accepted).toBe(true);
    if (!approved.accepted) return;

    const secondApprove = applyReviewDecision(approved.state, {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      decision: decision({
        decisionId: 'decision-2',
        targetAdviceId: 'advice-1',
        adviceRevision: 1,
        consultationRevision: 2,
      }),
    });
    expect(secondApprove).toMatchObject({ accepted: false, reason: 'review_already_consumed' });
  });

  it('never accepts more than one approve in an arbitrary retry sequence', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), (attempts) => {
      const initial = createConsultationSession({
        consultationId: 'consultation-1',
        ownerId: 'owner-1',
        conversationId: 'conversation-1',
      });
      const proposal = commitAdviceProposal(initial, {
        adviceId: 'advice-1',
        expectedConsultationRevision: 0,
        sourceQuestionTurnId: 'turn-1',
        answer: answer('案1'),
        contextFingerprint: fingerprint,
        createdAt: '2026-09-01T16:00:00.000Z',
      });
      if (!proposal.accepted) return false;

      let state = proposal.state;
      let acceptedCount = 0;
      for (let index = 0; index < attempts; index += 1) {
        const result = applyReviewDecision(state, {
          ownerId: 'owner-1',
          conversationId: 'conversation-1',
          decision: decision({
            decisionId: `decision-${index}`,
            targetAdviceId: 'advice-1',
            adviceRevision: 1,
            consultationRevision: state.revision,
          }),
        });
        if (result.accepted) {
          acceptedCount += 1;
          state = result.state;
        }
      }
      return acceptedCount === 1;
    }));
  });

  it('rejects owner mismatch and out-of-range option scope', () => {
    const initial = createConsultationSession({
      consultationId: 'consultation-1',
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    const proposal = commitAdviceProposal(initial, {
      adviceId: 'advice-1',
      expectedConsultationRevision: 0,
      sourceQuestionTurnId: 'turn-1',
      answer: answer('案1'),
      contextFingerprint: fingerprint,
      createdAt: '2026-09-01T16:00:00.000Z',
    });
    if (!proposal.accepted) throw new Error('fixture failed');

    expect(applyReviewDecision(proposal.state, {
      ownerId: 'owner-2',
      conversationId: 'conversation-1',
      decision: decision({
        decisionId: 'wrong-owner',
        targetAdviceId: 'advice-1',
        adviceRevision: 1,
        consultationRevision: 1,
      }),
    })).toMatchObject({ accepted: false, reason: 'owner_or_conversation_mismatch' });

    expect(applyReviewDecision(proposal.state, {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      decision: decision({
        decisionId: 'bad-option',
        targetAdviceId: 'advice-1',
        adviceRevision: 1,
        consultationRevision: 1,
        optionIndex: 4,
      }),
    })).toMatchObject({ accepted: false, reason: 'invalid_review_scope' });
  });
});
