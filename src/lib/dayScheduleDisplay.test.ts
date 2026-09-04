import { describe, expect, it } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { projectReadOnlyTimetableOccurrencesForDay } from './dayScheduleDisplay';

function occurrence(
  overrides: Partial<ScheduleOccurrence> = {},
): ScheduleOccurrence {
  return {
    id: 'timetable:class-1:2026-09-07',
    ownerId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    category: 'class',
    busy: true,
    start: { date: '2026-09-07', time: '13:00' },
    end: { date: '2026-09-07', time: '14:30' },
    source: {
      kind: 'timetable',
      id: 'class-1',
      backingKind: 'timetable-template',
      backingId: 'class-1',
    },
    planSourceType: 'timetable',
    ...overrides,
  };
}

describe('day timetable occurrence display', () => {
  it('projects template-backed occurrences as display-only MonthEvent shapes', () => {
    const events = projectReadOnlyTimetableOccurrencesForDay(
      [occurrence()],
      '2026-09-07',
    );

    expect(events).toMatchObject([
      {
        id: 'timetable:class-1:2026-09-07',
        userId: 'user-1',
        date: '2026-09-07',
        endDate: '2026-09-07',
        title: '情報学演習',
        startTime: '13:00',
        endTime: '14:30',
        repeat: 'none',
      },
    ]);
  });

  it('does not convert timetable occurrences already backed by a persisted Plan', () => {
    const events = projectReadOnlyTimetableOccurrencesForDay(
      [
        occurrence({
          source: {
            kind: 'timetable',
            id: 'class-1',
            backingKind: 'plan',
            backingId: 'imported-plan-1',
          },
        }),
      ],
      '2026-09-07',
    );

    expect(events).toEqual([]);
  });
});
