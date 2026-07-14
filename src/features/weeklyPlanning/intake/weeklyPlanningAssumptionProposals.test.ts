import { describe, expect, it } from 'vitest';
import {
  ASSUMPTION_PROPOSAL_LIMITS,
  canonicalizeAssumptionProposalDraft,
  canonicalizeAssumptionProposalDrafts,
  createAssumptionProposalSessionState,
  createDeterministicAssumptionProposalId,
  getAssumptionProposalRef,
  getPendingAssumptionProposals,
  validatePendingAssumptionProposalDraft,
  type AssumptionProposalCanonicalizationContext,
  type PendingAssumptionProposalDraft,
} from './weeklyPlanningAssumptionProposals';

const baseDraft: PendingAssumptionProposalDraft = {
  slot: 'duration',
  targetRef: 'task-1',
  proposedValue: 30,
  proposedUnit: 'minutes',
  reasonCode: 'missing_duration',
  sourceFactRefs: [],
};

function context(
  overrides: Partial<AssumptionProposalCanonicalizationContext> = {},
): AssumptionProposalCanonicalizationContext {
  return {
    authorization: { userId: 'user-1' },
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    stateRevision: 4,
    validTargetRefs: ['task-1'],
    currentPublicSourceFacts: [],
    allowedPolicyIds: [],
    existingProposalRecords: [],
    ...overrides,
  };
}

describe('weekly planning assumption proposal drafts', () => {
  it('accepts a safe draft and rejects lifecycle or unknown properties', () => {
    expect(validatePendingAssumptionProposalDraft(baseDraft)).toEqual({
      accepted: true,
      draft: baseDraft,
    });

    for (const property of [
      'proposalId',
      'conversationId',
      'turnId',
      'stateRevision',
      'status',
      'createdAtTurnId',
      'createdFromStateRevision',
      'decidedAtTurnId',
      'decidedAtStateRevision',
      'resolvedBy',
      'reasonText',
    ]) {
      expect(validatePendingAssumptionProposalDraft({ ...baseDraft, [property]: 'forbidden' })).toMatchObject({
        accepted: false,
        reason: 'unknown-draft-property',
      });
    }
  });

  it('enforces runtime value, unit, reason, and bounded string validation', () => {
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, proposedValue: Number.NaN })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, proposedValue: Number.POSITIVE_INFINITY })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, proposedValue: 0 })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, proposedValue: -1 })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, proposedUnit: 'pages' })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, slot: 'priority', reasonCode: 'history_based_estimate', sourceFactRefs: [] })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({ ...baseDraft, sourceFactRefs: ['fact-1'], reasonCode: 'domain_default' })).toMatchObject({ accepted: true });
    expect(validatePendingAssumptionProposalDraft({
      ...baseDraft,
      targetRef: 'x'.repeat(ASSUMPTION_PROPOSAL_LIMITS.targetRef + 1),
    })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({
      ...baseDraft,
      proposedValue: 'x'.repeat(ASSUMPTION_PROPOSAL_LIMITS.valueString + 1),
    })).toMatchObject({ accepted: false });
    expect(validatePendingAssumptionProposalDraft({
      ...baseDraft,
      sourceFactRefs: Array.from({ length: ASSUMPTION_PROPOSAL_LIMITS.sourceFactRefs + 1 }, (_, index) => `fact-${index}`),
    })).toMatchObject({ accepted: false });
  });

  it('normalizes duplicate source references deterministically', () => {
    expect(validatePendingAssumptionProposalDraft({
      ...baseDraft,
      sourceFactRefs: [' fact-b ', 'fact-a', 'fact-b'],
      reasonCode: 'history_based_estimate',
    })).toEqual({
      accepted: true,
      draft: {
        ...baseDraft,
        reasonCode: 'history_based_estimate',
        sourceFactRefs: ['fact-a', 'fact-b'],
      },
    });
  });

  it('accepts only current public same-scope source facts and approved policies', () => {
    const sourceFact = {
      factId: 'fact-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      stateRevision: 4,
      visibility: 'public' as const,
    };
    const valid = canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-1'],
    }, context({ currentPublicSourceFacts: [sourceFact] }));
    expect(valid.accepted).toBe(true);

    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-private'],
    }, context({ currentPublicSourceFacts: [{ ...sourceFact, factId: 'fact-private', visibility: 'private' }] }))).toMatchObject({ accepted: false, reason: 'private-source-fact' });
    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-cross-user'],
    }, context({ currentPublicSourceFacts: [{ ...sourceFact, factId: 'fact-cross-user', userId: 'other-user' }] }))).toMatchObject({ accepted: false, reason: 'cross-user-source-fact' });
    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-stale'],
    }, context({ currentPublicSourceFacts: [{ ...sourceFact, factId: 'fact-stale', stateRevision: 3 }] }))).toMatchObject({ accepted: false, reason: 'stale-source-fact' });
    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'domain_default',
      sourceFactRefs: ['policy:duration-default'],
    }, context({ allowedPolicyIds: ['policy:duration-default'] }))).toMatchObject({ accepted: true });
  });

  it('creates deterministic pending records, refs, duplicates, and conflicts', () => {
    const first = canonicalizeAssumptionProposalDraft(baseDraft, context());
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.record.status).toBe('pending');
    expect(first.record.decidedAtTurnId).toBeUndefined();
    expect(first.record.resolvedBy).toBeUndefined();
    expect(getAssumptionProposalRef(first.record)).toBe(first.record.proposalId);
    expect(createDeterministicAssumptionProposalId(context(), baseDraft)).toBe(first.record.proposalId);

    const duplicate = canonicalizeAssumptionProposalDraft(baseDraft, context({ existingProposalRecords: [first.record] }));
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true, assumptionProposalRef: first.record.proposalId });

    const conflicting = canonicalizeAssumptionProposalDraft({ ...baseDraft, proposedValue: 45 }, context({ existingProposalRecords: [first.record] }));
    expect(conflicting).toMatchObject({ accepted: false, reason: 'pending-proposal-conflict' });

    const batch = canonicalizeAssumptionProposalDrafts([baseDraft, baseDraft], context());
    expect(batch.state.records).toHaveLength(1);
    expect(batch.accepted).toHaveLength(1);
    expect(batch.assumptionProposalRefs).toEqual([first.record.proposalId]);
    expect(getPendingAssumptionProposals(createAssumptionProposalSessionState(batch.state.records))).toHaveLength(1);
  });
});
