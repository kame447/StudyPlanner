import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_SCOPE_REPAIR_CASES,
  validateTemporalScopeRepairCorpus,
} from './temporalScopeRepairCorpus';

describe('sealed temporal-scope repair corpus', () => {
  it('keeps conversation groups in exactly one split', () => {
    expect(() => validateTemporalScopeRepairCorpus()).not.toThrow();
    const splitsByGroup = new Map<string, Set<string>>();
    for (const item of TEMPORAL_SCOPE_REPAIR_CASES) {
      const splits = splitsByGroup.get(item.group) ?? new Set<string>();
      splits.add(item.split);
      splitsByGroup.set(item.group, splits);
    }
    expect([...splitsByGroup.values()].every((splits) => splits.size === 1)).toBe(true);
  });

  it.each(['tuning', 'holdout'] as const)(
    'has independent case and group denominators for every %s class',
    (split) => {
      for (const caseClass of ['plan_unavailable', 'uncertain', 'security'] as const) {
        const matching = TEMPORAL_SCOPE_REPAIR_CASES.filter((item) =>
          item.split === split && item.caseClass === caseClass);
        expect(matching).toHaveLength(16);
        expect(new Set(matching.map((item) => item.group)).size).toBe(8);
      }
    },
  );

  it('labels security cases safe-uncertain and preserves typed time evidence', () => {
    const security = TEMPORAL_SCOPE_REPAIR_CASES.filter((item) => item.caseClass === 'security');
    expect(security).toHaveLength(32);
    expect(security.every((item) => item.expected === 'uncertain')).toBe(true);
    expect(TEMPORAL_SCOPE_REPAIR_CASES.every((item) =>
      typeof item.state.interpretedTime.dateExpression === 'string'
      && (item.state.interpretedTime.startTime !== null
        || item.state.interpretedTime.endTime !== null))).toBe(true);
  });
});
