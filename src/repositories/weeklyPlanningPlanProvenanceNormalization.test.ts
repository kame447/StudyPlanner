import { describe, expect, it } from 'vitest';
import type { Plan } from '../types/domain';
import { normalizePlanRecord } from './repositoryUtils';

function plan(sourceType: unknown, sourceId: unknown): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '英語',
    subject: '英語',
    date: '2026-07-20',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    sourceType: sourceType as Plan['sourceType'],
    sourceId: sourceId as Plan['sourceId'],
  };
}

describe('weekly planning Plan provenance normalization', () => {
  it('preserves the structured weekly-planning source', () => {
    const normalized = normalizePlanRecord(plan('weekly-planning', 'v1:operation:block'));

    expect(normalized.sourceType).toBe('weekly-planning');
    expect(normalized.sourceId).toBe('v1:operation:block');
  });

  it('continues to discard unknown source types', () => {
    const normalized = normalizePlanRecord(plan('unknown-source', 'source-1'));

    expect(normalized.sourceType).toBeUndefined();
    expect(normalized.sourceId).toBe('source-1');
  });
});
