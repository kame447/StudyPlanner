import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { fallbackQuestionForSlot } from '../intake/weeklyPlanningQuestionSlots';
import { createKnownFixedEventSummaries } from './weeklyPlanningKnownFixedEvents';

function plan(id: string, date: string, startTime: string, endTime: string, title: string): Plan {
  return {
    id,
    userId: 'user',
    date,
    startTime,
    endTime,
    title,
    subject: '',
    type: 'other',
    memo: '',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  } as Plan;
}

describe('known fixed event summaries', () => {
  it('uses only registered plans inside the planning range', () => {
    const summaries = createKnownFixedEventSummaries([
      plan('1', '2026-07-16', '10:00', '11:00', '授業'),
      plan('2', '2026-07-20', '12:00', '13:00', '範囲外'),
    ], {
      confidence: 'explicit',
      startDateTime: '2026-07-16T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
    });

    expect(summaries).toEqual(['7/16 10:00〜11:00「授業」']);
  });

  it('asks only for additional events and does not use personal examples', () => {
    const question = fallbackQuestionForSlot('fixed_events', {
      knownFixedEventSummaries: ['7/16 10:00〜11:00「授業」'],
    });
    expect(question).toContain('登録済みの予定は');
    expect(question).toContain('これ以外に');
    expect(question).not.toContain('通院');
  });
});
