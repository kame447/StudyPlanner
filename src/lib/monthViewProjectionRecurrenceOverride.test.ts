import { describe, expect, it } from 'vitest';
import type { Plan } from '../types/domain';
import { buildMonthPanelProjection } from './monthViewProjection';

const BASE_PLAN: Plan = {
  id: 'appointment-override',
  seriesId: 'appointment-override',
  userId: 'user-1',
  title: '元の予定',
  subject: '予定',
  date: '2026-08-14',
  startTime: '18:00',
  endTime: '19:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [
    {
      id: 'override-1',
      kind: 'date',
      startDate: '2026-08-14',
      until: null,
      dates: ['2026-08-14'],
      weekdays: [],
      dayType: null,
      startTime: '20:00',
      endTime: '21:30',
      title: '変更後の予定',
      subject: '予定',
      type: 'other',
      memo: '',
      isOverride: true,
    },
  ],
  type: 'other',
  memo: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('month view recurrence occurrence projection', () => {
  it('renders resolved occurrence values instead of the stored Plan defaults', () => {
    const projection = buildMonthPanelProjection({
      monthDate: '2026-08-01',
      userId: 'user-1',
      plans: [BASE_PLAN],
      actuals: [],
      monthEvents: [],
    });
    const targetCell = projection.cells.find((cell) => cell.date === '2026-08-14');

    expect(targetCell?.monthEvents).toMatchObject([
      {
        id: 'plan:appointment-override:2026-08-14',
        title: '変更後の予定',
        startTime: '20:00',
        endTime: '21:30',
      },
    ]);
  });
});
