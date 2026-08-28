import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate, TimetableTerm } from '../../../types/domain';
import { createStableV5ExternalConstraintSources } from './weeklyPlanningStableV5ExternalSources';

const TERM: TimetableTerm = {
  id: 'term-spring',
  userId: 'user-1',
  year: 2026,
  kind: 'custom',
  label: '2026年前期',
  startDate: '2026-04-06',
  endDate: '2026-04-26',
  usesAlternatingWeeks: true,
  alternatingWeekAnchorDate: '2026-04-06',
  isActive: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

function template(
  id: string,
  startTime: string,
  endTime: string,
  overrides: Partial<ScheduleTemplate> = {},
): ScheduleTemplate {
  return {
    id,
    userId: 'user-1',
    title: id,
    subject: '授業',
    type: 'school-event',
    weekday: 'mon',
    startTime,
    endTime,
    termId: TERM.id,
    periodNumber: Number(id.slice(-1)),
    classroom: '',
    memo: '',
    active: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Stable V5 timetable external constraints', () => {
  it('uses term bounds, A/B weeks, and class-level biweekly recurrence before blocking time', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [],
      templates: [
        template('class-1', '09:00', '10:00', { alternatingWeek: 'a' }),
        template('class-2', '10:00', '11:00', { alternatingWeek: 'b' }),
        template('class-3', '11:00', '12:00', {
          alternatingWeek: 'both',
          weekInterval: 2,
          weekIntervalAnchorDate: '2026-04-06',
        }),
      ],
      timetableTermId: TERM.id,
      timetableTerm: TERM,
      horizon: { startDate: '2026-04-06', endDate: '2026-04-27' },
      timeZone: 'Asia/Tokyo',
    });
    const timetable = sources.find((source) => source.kind === 'timetable');

    expect(timetable?.status).toBe('success');
    if (!timetable || timetable.status !== 'success') {
      throw new Error('expected a successful timetable source');
    }

    expect(
      timetable.events.map((event) => [event.eventId, event.start.date]),
    ).toEqual([
      ['class-1', '2026-04-06'],
      ['class-3', '2026-04-06'],
      ['class-2', '2026-04-13'],
      ['class-1', '2026-04-20'],
      ['class-3', '2026-04-20'],
    ]);
  });
});
