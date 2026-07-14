import fc from 'fast-check';
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
  type AssumptionProposalRecord,
  type AssumptionProposalSourceFact,
  type PendingAssumptionProposalDraft,
} from './weeklyPlanningAssumptionProposals';

const PROPERTY_SEED = 20260714;
const PROPERTY_RUNS = 60;

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

function publicSourceFact(factId: string): AssumptionProposalSourceFact {
  return {
    factId,
    userId: 'user-1',
    conversationId: 'conversation-1',
    stateRevision: 4,
    visibility: 'public',
  };
}

const factIdArbitrary = fc
  .array(fc.constantFrom('a', 'b', 'c', '1', '2'), { minLength: 1, maxLength: 6 })
  .map((parts) => `fact-${parts.join('')}`);

describe('weekly planning assumption proposal contract', () => {
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
      expect(validatePendingAssumptionProposalDraft({
        ...baseDraft,
        [property]: 'forbidden',
      })).toMatchObject({
        accepted: false,
        reason: 'unknown-draft-property',
      });
    }
  });

  it.each([
    ['NaN value', { proposedValue: Number.NaN }],
    ['infinite value', { proposedValue: Number.POSITIVE_INFINITY }],
    ['zero duration', { proposedValue: 0 }],
    ['negative duration', { proposedValue: -1 }],
    ['incompatible duration unit', { proposedUnit: 'pages' }],
    ['incompatible reason slot', { slot: 'priority', reasonCode: 'history_based_estimate' }],
    ['overlong target', { targetRef: 'x'.repeat(ASSUMPTION_PROPOSAL_LIMITS.targetRef + 1) }],
    ['overlong string value', { proposedValue: 'x'.repeat(ASSUMPTION_PROPOSAL_LIMITS.valueString + 1) }],
    ['too many source refs', {
      sourceFactRefs: Array.from(
        { length: ASSUMPTION_PROPOSAL_LIMITS.sourceFactRefs + 1 },
        (_, index) => `fact-${index}`,
      ),
    }],
  ])('rejects %s at the draft validation boundary', (_label, overrides) => {
    expect(validatePendingAssumptionProposalDraft({
      ...baseDraft,
      ...overrides,
    })).toMatchObject({ accepted: false });
  });

  it.each([
    ['private-source-fact', { visibility: 'private' }],
    ['cross-user-source-fact', { userId: 'other-user' }],
    ['cross-conversation-source-fact', { conversationId: 'other-conversation' }],
    ['stale-source-fact', { stateRevision: 3 }],
  ])('rejects source facts outside the current scope: %s', (reason, overrides) => {
    const fact = { ...publicSourceFact('fact-1'), ...overrides } as AssumptionProposalSourceFact;
    const result = canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-1'],
    }, context({ currentPublicSourceFacts: [fact] }));

    expect(result).toMatchObject({ accepted: false, reason });
  });

  it.each([
    ['cross-user target', { userId: 'other-user' }],
    ['cross-conversation target', { conversationId: 'other-conversation' }],
    ['stale target', { stateRevision: 3 }],
  ])('rejects target refs outside the current scope: %s', (_label, overrides) => {
    const target = {
      targetRef: 'task-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      stateRevision: 4,
      ...overrides,
    };
    const result = canonicalizeAssumptionProposalDraft(baseDraft, context({ validTargetRefs: [target] }));

    expect(result).toMatchObject({ accepted: false, reason: 'unknown-or-invalid-target-ref' });
  });

  it('accepts approved deterministic policy sources and rejects unknown source refs', () => {
    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'domain_default',
      sourceFactRefs: ['policy:duration-default'],
    }, context({ allowedPolicyIds: ['policy:duration-default'] }))).toMatchObject({
      accepted: true,
    });
    expect(canonicalizeAssumptionProposalDraft({
      ...baseDraft,
      reasonCode: 'history_based_estimate',
      sourceFactRefs: ['fact-unknown'],
    }, context())).toMatchObject({
      accepted: false,
      reason: 'unknown-source-fact',
    });
  });

  it('creates pending-only lifecycle metadata and exposes the proposal reference', () => {
    const result = canonicalizeAssumptionProposalDraft(baseDraft, context());

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.record).toMatchObject({
      status: 'pending',
      conversationId: 'conversation-1',
      createdAtTurnId: 'turn-1',
      createdFromStateRevision: 4,
    });
    expect(result.record.decidedAtTurnId).toBeUndefined();
    expect(result.record.decidedAtStateRevision).toBeUndefined();
    expect(result.record.resolvedBy).toBeUndefined();
    expect(getAssumptionProposalRef(result.record)).toBe(result.record.proposalId);
    expect(getPendingAssumptionProposals(
      createAssumptionProposalSessionState([result.record]),
    )).toEqual([result.record]);
  });
});

describe('weekly planning assumption proposal properties', () => {
  it('normalization is idempotent and does not mutate draft input', () => {
    fc.assert(fc.property(
      fc.array(factIdArbitrary, { minLength: 1, maxLength: 4 }),
      (refs) => {
        const draft = {
          ...baseDraft,
          reasonCode: 'history_based_estimate' as const,
          sourceFactRefs: refs.flatMap((ref) => [` ${ref} `, ref]),
        };
        const original = structuredClone(draft);
        const first = validatePendingAssumptionProposalDraft(draft);

        expect(first.accepted).toBe(true);
        if (!first.accepted) return;
        const second = validatePendingAssumptionProposalDraft(first.draft);

        expect(second).toEqual(first);
        expect(draft).toEqual(original);
      },
    ), { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS });
  });

  it('canonicalization is independent of sourceFactRefs order and does not mutate context', () => {
    fc.assert(fc.property(
      fc.uniqueArray(factIdArbitrary, { minLength: 1, maxLength: 5 }),
      fc.integer({ min: 1, max: 600 }),
      (refs, duration) => {
        const currentPublicSourceFacts = refs.map(publicSourceFact);
        const canonicalContext = context({ currentPublicSourceFacts });
        const originalContext = structuredClone(canonicalContext);
        const forward = {
          ...baseDraft,
          proposedValue: duration,
          reasonCode: 'history_based_estimate' as const,
          sourceFactRefs: refs,
        };
        const reverse = { ...forward, sourceFactRefs: [...refs].reverse() };
        const first = canonicalizeAssumptionProposalDraft(forward, canonicalContext);
        const second = canonicalizeAssumptionProposalDraft(reverse, canonicalContext);

        expect(first).toEqual(second);
        expect(canonicalContext).toEqual(originalContext);
      },
    ), { seed: PROPERTY_SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('reapplying the same draft does not create another record or reference', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 600 }),
      fc.integer({ min: 1, max: 8 }),
      (duration, repetitions) => {
        const draft = { ...baseDraft, proposedValue: duration };
        const result = canonicalizeAssumptionProposalDrafts(
          Array.from({ length: repetitions }, () => structuredClone(draft)),
          context(),
        );

        expect(result.state.records).toHaveLength(1);
        expect(result.accepted).toHaveLength(1);
        expect(result.assumptionProposalRefs).toHaveLength(1);
        expect(result.rejected).toEqual([]);
      },
    ), { seed: PROPERTY_SEED + 2, numRuns: PROPERTY_RUNS });
  });

  it('keeps a valid draft when an invalid draft appears in either order', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 600 }),
      fc.boolean(),
      (duration, invalidFirst) => {
        const valid = { ...baseDraft, proposedValue: duration };
        const invalid = { ...baseDraft, unexpected: true };
        const drafts = invalidFirst ? [invalid, valid] : [valid, invalid];
        const result = canonicalizeAssumptionProposalDrafts(drafts, context());

        expect(result.state.records).toHaveLength(1);
        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].proposedValue).toBe(duration);
        expect(result.rejected).toEqual([
          expect.objectContaining({ reason: 'unknown-draft-property' }),
        ]);
      },
    ), { seed: PROPERTY_SEED + 3, numRuns: PROPERTY_RUNS });
  });

  it('rejects a pending conflict independently of unrelated record order', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 600 }),
      fc.integer({ min: 1, max: 600 }).filter((value) => value !== 30),
      fc.boolean(),
      (unrelatedValue, conflictingValue, reverseRecords) => {
        const existing = canonicalizeAssumptionProposalDraft(baseDraft, context());
        expect(existing.accepted).toBe(true);
        if (!existing.accepted) return;
        const unrelated: AssumptionProposalRecord = {
          ...existing.record,
          proposalId: `unrelated:${unrelatedValue}`,
          targetRef: `other-task-${unrelatedValue}`,
          proposedValue: unrelatedValue,
        };
        const records = reverseRecords
          ? [unrelated, existing.record]
          : [existing.record, unrelated];
        const result = canonicalizeAssumptionProposalDraft({
          ...baseDraft,
          proposedValue: conflictingValue,
        }, context({ existingProposalRecords: records }));

        expect(result).toEqual({
          accepted: false,
          reason: 'pending-proposal-conflict',
        });
      },
    ), { seed: PROPERTY_SEED + 4, numRuns: PROPERTY_RUNS });
  });

  it('produces the same deterministic ID for an already canonical draft', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 600 }),
      (duration) => {
        const draft = { ...baseDraft, proposedValue: duration };
        const result = canonicalizeAssumptionProposalDraft(draft, context());

        expect(result.accepted).toBe(true);
        if (!result.accepted) return;
        expect(createDeterministicAssumptionProposalId(context(), draft)).toBe(
          result.record.proposalId,
        );
      },
    ), { seed: PROPERTY_SEED + 5, numRuns: PROPERTY_RUNS });
  });
});
