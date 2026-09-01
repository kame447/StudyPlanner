import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  ContextSourceEnvelope,
  DeterministicSignal,
  RequestTemporalContext,
} from './contracts';
import {
  assessRequiredContextReadiness,
  buildContextFingerprint,
  sameContextFingerprint,
  validateContextSourceEnvelope,
} from './context';
import { evaluatePromotionCoverage } from './promotion';
import { resolveTemporalCandidate } from './temporal';

const temporalContext: RequestTemporalContext = {
  currentDate: '2026-09-02',
  currentDateTime: '2026-09-02T01:00:00+09:00',
  timezone: 'Asia/Tokyo',
  weekStartsOn: 1,
  authoritativeDates: {
    'exam:common-test': '2027-01-16',
  },
};

function source(overrides: Partial<ContextSourceEnvelope> = {}): ContextSourceEnvelope {
  return {
    sourceDomain: 'bookshelf',
    sourceIdentity: 'bookshelf:user-1',
    requirement: 'required',
    status: 'available',
    sourceBasis: 'revision-7',
    semanticDigest: 'bookshelf-digest-7',
    observedAt: '2026-09-02T00:59:00.000Z',
    authority: 'bookshelf_repository',
    items: [{ materialId: 'material-1' }],
    ...overrides,
  };
}

const signal: DeterministicSignal = {
  signalId: 'remaining-work',
  kind: 'remaining_workload',
  value: 800,
  unit: 'words',
  basisRefs: ['bookshelf:user-1'],
  calculationVersion: 'remaining-v1',
};

describe('learning consultation context and freshness foundation', () => {
  it('distinguishes successful empty from unavailable and stale reads', () => {
    expect(validateContextSourceEnvelope(source({ status: 'empty', items: [], semanticDigest: 'empty-digest' })).valid).toBe(true);
    expect(validateContextSourceEnvelope(source({ status: 'unavailable', items: [], semanticDigest: null })).valid).toBe(true);
    expect(validateContextSourceEnvelope(source({ status: 'stale', items: [{ materialId: 'material-old' }] })).valid).toBe(true);

    expect(validateContextSourceEnvelope(source({ status: 'empty', items: [{ materialId: 'impossible' }] })).valid).toBe(false);
    expect(validateContextSourceEnvelope(source({ status: 'available', items: [] })).valid).toBe(false);
  });

  it('fails closed when a required source is unavailable, omitted, or stale', () => {
    expect(assessRequiredContextReadiness([
      source({ status: 'empty', items: [], semanticDigest: 'empty-digest' }),
    ])).toEqual({ ready: true, blockedSources: [] });

    expect(assessRequiredContextReadiness([
      source({ status: 'stale' }),
      source({
        sourceDomain: 'goals',
        sourceIdentity: 'goals:user-1',
        status: 'unavailable',
        items: [],
        semanticDigest: null,
      }),
    ])).toEqual({
      ready: false,
      blockedSources: ['bookshelf:user-1', 'goals:user-1'],
    });
  });

  it('fingerprints owner digests and bases instead of prompt text or array order', () => {
    const first = buildContextFingerprint({
      requestTemporalContext: temporalContext,
      sources: [source(), source({
        sourceDomain: 'goals',
        sourceIdentity: 'goals:user-1',
        sourceBasis: 'revision-2',
        semanticDigest: 'goal-digest-2',
        items: [{ goal: '75点' }],
      })],
      deterministicSignals: [signal],
      evidenceDigests: ['evidence-b', 'evidence-a'],
      materialBindingBasis: ['material:b', 'material:a'],
    });

    const reordered = buildContextFingerprint({
      requestTemporalContext: temporalContext,
      sources: [
        source({
          sourceDomain: 'goals',
          sourceIdentity: 'goals:user-1',
          sourceBasis: 'revision-2',
          semanticDigest: 'goal-digest-2',
          items: [{ completelyDifferentPromptProjection: true }],
        }),
        source({ items: [{ anotherPromptProjection: true }] }),
      ],
      deterministicSignals: [signal],
      evidenceDigests: ['evidence-a', 'evidence-b'],
      materialBindingBasis: ['material:a', 'material:b'],
    });

    expect(sameContextFingerprint(first, reordered)).toBe(true);

    const changedOwnerDigest = buildContextFingerprint({
      requestTemporalContext: temporalContext,
      sources: [source({ semanticDigest: 'bookshelf-digest-8' })],
      deterministicSignals: [signal],
      evidenceDigests: [],
      materialBindingBasis: [],
    });
    const original = buildContextFingerprint({
      requestTemporalContext: temporalContext,
      sources: [source()],
      deterministicSignals: [signal],
      evidenceDigests: [],
      materialBindingBasis: [],
    });
    expect(sameContextFingerprint(original, changedOwnerDigest)).toBe(false);
  });

  it('keeps fingerprint stable under arbitrary dependency ordering', () => {
    fc.assert(fc.property(fc.shuffledSubarray(['a', 'b', 'c'], { minLength: 3, maxLength: 3 }), (order) => {
      const inputs = order.map((identity) => source({
        sourceIdentity: `source:${identity}`,
        semanticDigest: `digest:${identity}`,
        items: [{ identity }],
      }));
      const baseline = buildContextFingerprint({
        requestTemporalContext: temporalContext,
        sources: [
          source({ sourceIdentity: 'source:a', semanticDigest: 'digest:a', items: [{ identity: 'a' }] }),
          source({ sourceIdentity: 'source:b', semanticDigest: 'digest:b', items: [{ identity: 'b' }] }),
          source({ sourceIdentity: 'source:c', semanticDigest: 'digest:c', items: [{ identity: 'c' }] }),
        ],
        deterministicSignals: [],
        evidenceDigests: [],
        materialBindingBasis: [],
      });
      const candidate = buildContextFingerprint({
        requestTemporalContext: temporalContext,
        sources: inputs,
        deterministicSignals: [],
        evidenceDigests: [],
        materialBindingBasis: [],
      });
      return sameContextFingerprint(baseline, candidate);
    }));
  });
});

describe('learning consultation temporal normalization', () => {
  it('resolves month end once from the structured candidate', () => {
    expect(resolveTemporalCandidate({ kind: 'month_end', year: 2026, month: 11 }, temporalContext)).toMatchObject({
      resolved: true,
      value: {
        canonicalStartDate: '2026-11-30',
        canonicalEndDate: '2026-11-30',
      },
    });
  });

  it('uses an authoritative exam date for relative targets', () => {
    expect(resolveTemporalCandidate({
      kind: 'relative_to_exam',
      examRef: 'exam:common-test',
      offsetDays: -14,
    }, temporalContext)).toMatchObject({
      resolved: true,
      value: {
        canonicalStartDate: '2027-01-02',
        canonicalEndDate: '2027-01-02',
      },
    });
  });

  it('fails closed when the authoritative exam date is missing', () => {
    expect(resolveTemporalCandidate({
      kind: 'relative_to_exam',
      examRef: 'exam:unknown',
      offsetDays: -14,
    }, temporalContext)).toEqual({
      resolved: false,
      reason: 'missing_authoritative_exam_date',
    });
  });
});

describe('learning consultation promotion coverage', () => {
  const recommendations = [
    { recommendationKey: 'option-0:recommendation-0', planningRelevant: true },
    { recommendationKey: 'option-0:recommendation-1', planningRelevant: false },
  ] as const;

  it('requires every recommendation to be explicitly accounted for', () => {
    expect(evaluatePromotionCoverage(recommendations, [
      { recommendationKey: 'option-0:recommendation-0', disposition: 'mapped', reason: null },
    ])).toMatchObject({ promotable: false, reason: 'incomplete_promotion_coverage' });
  });

  it('blocks silent partial promotion of planning-relevant content', () => {
    expect(evaluatePromotionCoverage(recommendations, [
      { recommendationKey: 'option-0:recommendation-0', disposition: 'blocked', reason: 'unresolved material' },
      { recommendationKey: 'option-0:recommendation-1', disposition: 'advisory_only', reason: null },
    ])).toMatchObject({
      promotable: false,
      reason: 'planning_relevant_recommendation_blocked',
    });
  });

  it('allows promotion only after complete non-blocking accounting', () => {
    expect(evaluatePromotionCoverage(recommendations, [
      { recommendationKey: 'option-0:recommendation-0', disposition: 'mapped', reason: null },
      { recommendationKey: 'option-0:recommendation-1', disposition: 'advisory_only', reason: null },
    ])).toMatchObject({ promotable: true });
  });
});
