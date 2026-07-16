import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { fallbackQuestionForSlot } from '../intake/weeklyPlanningQuestionSlots';
import {
  createKnownFixedEventOccurrences,
  createKnownFixedEventSummaries,
} from './weeklyPlanningKnownFixedEvents';

function plan(id: string, date: string, startTime: string, endTime: string, title: string): Plan {
  return {
    id,
    seriesId: id,
    userId: 'user',
    date,
    startTime,
    endTime,
    title,
    subject: '',
    type: 'other',
    memo: '',
    repeat: 'none',
    repeatUntil: null,
    recurrenceRules: [],
    excludedDates: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  } as Plan;
}

const range = {
  confidence: 'explicit' as const,
  startDateTime: '2026-07-16T12:00:00',
  endDateTime: '2026-07-19T18:00:00',
};

describe('known fixed event occurrences', () => {
  it('uses exact datetime overlap instead of date-only inclusion', () => {
    const occurrences = createKnownFixedEventOccurrences([
      plan('before', '2026-07-16', '09:00', '10:00', '開始前'),
      plan('overlap-start', '2026-07-16', '11:30', '12:30', '開始境界と重なる'),
      plan('inside', '2026-07-17', '10:00', '11:00', '範囲内'),
      plan('overlap-end', '2026-07-19', '17:30', '18:30', '終了境界と重なる'),
      plan('after', '2026-07-19', '18:00', '19:00', '終了後'),
    ], range);

    expect(occurrences.map((item) => item.id)).toEqual(['overlap-start', 'inside', 'overlap-end']);
  });

  it('expands weekly recurring plans into the planning range', () => {
    const recurring = {
      ...plan('weekly', '2026-07-09', '14:00', '15:00', '毎週の授業'),
      repeat: 'weekly' as const,
      repeatUntil: '2026-08-31',
    };
    const summaries = createKnownFixedEventSummaries([recurring], range);
    expect(summaries).toEqual(['7/16 14:00〜15:00「毎週の授業」']);
  });

  it('uses only registered occurrences inside the planning range', () => {
    const summaries = createKnownFixedEventSummaries([
      plan('1', '2026-07-16', '13:00', '14:00', '授業'),
      plan('2', '2026-07-20', '12:00', '13:00', '範囲外'),
    ], range);
    expect(summaries).toEqual(['7/16 13:00〜14:00「授業」']);
  });

  it('asks only for additional events and does not use personal examples', () => {
    const question = fallbackQuestionForSlot('fixed_events', {
      knownFixedEventSummaries: ['7/16 13:00〜14:00「授業」'],
    });
    expect(question).toContain('登録済みの予定は');
    expect(question).toContain('これ以外に');
    expect(question).not.toContain('通院');
  });
});
