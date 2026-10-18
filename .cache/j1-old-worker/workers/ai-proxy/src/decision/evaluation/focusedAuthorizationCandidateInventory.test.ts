import { describe, expect, it } from 'vitest';
import { inventoryFocusedAuthorizationCandidates } from './focusedAuthorizationCandidateInventory';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  type FocusedAuthorizationSyntheticCandidate,
} from './focusedAuthorizationSyntheticCandidates';

describe('focused authorization candidate inventory', () => {
  it('pins the current 51 candidate distribution', () => {
    const inventory = inventoryFocusedAuthorizationCandidates(
      FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
    );

    expect(inventory.totalCandidateCount).toBe(51);
    expect(inventory.countsBySplitExpected).toEqual({
      tuning: { create_plan: 11, fallback: 18 },
      holdout: { create_plan: 6, fallback: 16 },
    });
    expect(inventory.countsByLayerSplitExpected).toEqual({
      plain_authorization: {
        tuning: { create_plan: 3, fallback: 0 },
        holdout: { create_plan: 2, fallback: 0 },
      },
      short_approval: {
        tuning: { create_plan: 3, fallback: 0 },
        holdout: { create_plan: 3, fallback: 1 },
      },
      negation: {
        tuning: { create_plan: 0, fallback: 3 },
        holdout: { create_plan: 0, fallback: 2 },
      },
      correction: {
        tuning: { create_plan: 0, fallback: 3 },
        holdout: { create_plan: 0, fallback: 2 },
      },
      conditional_approval: {
        tuning: { create_plan: 0, fallback: 5 },
        holdout: { create_plan: 0, fallback: 2 },
      },
      mixed_turn: {
        tuning: { create_plan: 0, fallback: 3 },
        holdout: { create_plan: 0, fallback: 2 },
      },
      stored_indirect_injection: {
        tuning: { create_plan: 2, fallback: 1 },
        holdout: { create_plan: 1, fallback: 3 },
      },
      unicode_oddities: {
        tuning: { create_plan: 3, fallback: 0 },
        holdout: { create_plan: 0, fallback: 2 },
      },
      abnormal_values: {
        tuning: { create_plan: 0, fallback: 3 },
        holdout: { create_plan: 0, fallback: 2 },
      },
    });
    expect(inventory.conversationGroupsBySplit).toMatchObject({
      tuning: { count: 19 },
      holdout: { count: 13 },
    });
    expect(inventory.duplicateCurrentUserTexts).toEqual([
      {
        currentUserText: 'はい',
        candidateIds: ['short-approval-01', 'short-approval-06', 'abnormal-value-04'],
        splits: ['tuning', 'holdout'],
        crossesSplits: true,
      },
      {
        currentUserText: 'お願いします',
        candidateIds: ['short-approval-04', 'short-approval-07'],
        splits: ['holdout'],
        crossesSplits: false,
      },
    ]);
    expect(inventory.reviewStatusDistribution).toEqual({ synthetic_unreviewed: 51 });

    if (process.env.PRINT_FOCUSED_AUTHORIZATION_CANDIDATE_INVENTORY === '1') {
      console.log(JSON.stringify({
        event: 'focused_authorization_candidate_inventory',
        fixtureStatus: 'synthetic_unreviewed',
        inventory,
      }, null, 2));
    }
  });

  it('detects duplicate currentUserText by exact equality only', () => {
    const base = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES[0];
    const candidates: FocusedAuthorizationSyntheticCandidate[] = [
      { ...base, id: 'exact-a', conversationGroupId: 'exact-a', currentUserText: 'はい' },
      { ...base, id: 'exact-b', conversationGroupId: 'exact-b', currentUserText: 'はい' },
      { ...base, id: 'space', conversationGroupId: 'space', currentUserText: 'はい ' },
    ];

    expect(inventoryFocusedAuthorizationCandidates(candidates).duplicateCurrentUserTexts)
      .toEqual([{
        currentUserText: 'はい', candidateIds: ['exact-a', 'exact-b'], splits: ['tuning'], crossesSplits: false,
      }]);
  });
});
