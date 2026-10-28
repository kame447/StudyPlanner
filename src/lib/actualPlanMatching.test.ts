import { describe, expect, it } from 'vitest';
import { buildActualPlanLinkCandidates, type ActualPlanMatchInput } from './actualPlanMatching';
import type { Actual, Plan } from '../types/domain';

const input: ActualPlanMatchInput = { occurrenceDate: '2026-10-27', actualStartTime: '09:00', actualEndTime: '10:00', subject: '' };
function plan(overrides: Partial<Plan> = {}): Plan {
  return { id: 'p', seriesId: 'p', userId: 'u', title: '', subject: '', date: input.occurrenceDate,
    startTime: '09:00', endTime: '10:00', type: 'other', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '', ...overrides };
}

describe('actual plan matching score leaves', () => {
  it.each([['10:15', 85], ['10:30', 78], ['10:31', 70]] as const)(
    'preserves the duration score at %s', (endTime, score) => {
      const [result] = buildActualPlanLinkCandidates(input, [plan({ endTime })], []);
      expect(result.score).toBe(score);
      expect(result.reasons.includes('所要時間が近いです')).toBe(endTime === '10:15');
    });
  it.each(['study', 'mock-exam', 'cram-school'] as const)('adds the same study-kind weight for %s', type => {
    const baseline = buildActualPlanLinkCandidates(input, [plan()], [])[0];
    expect(buildActualPlanLinkCandidates(input, [plan({ type })], [])[0].score).toBe(baseline.score + 8);
  });
  it.each([['ab', 'タイトルの主要語が近いです'], ['abc', '教材名が近いです']] as const)(
    'preserves the common title token threshold for %s', (token, reason) => {
      const [result] = buildActualPlanLinkCandidates({ ...input, title: `${token} first` }, [plan({ title: `${token} second` })], []);
      expect(result.reasons).toContain(reason);
    });
  it('keeps date filtering, unrecorded-first stable ordering and the top-three limit', () => {
    const plans = ['p0', 'p1', 'p2', 'p3', 'p4'].map(id => plan({ id }));
    const recorded: Actual = { id: 'record', userId: 'u', planId: 'p0', occurrenceDate: input.occurrenceDate,
      actualStartTime: '09:00', actualEndTime: '10:00', subject: '', note: '', updatedAt: '' };
    const result = buildActualPlanLinkCandidates(input, [...plans, plan({ id: 'outside', date: '2026-10-28' })], [recorded]);
    expect(result.map(row => row.plan.id)).toEqual(['p1', 'p2', 'p3']);
    expect(result.every(row => !row.isRecorded)).toBe(true);
  });
});
