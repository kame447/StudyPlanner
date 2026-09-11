import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { createStableV5ExternalConstraintSources } from './weeklyPlanningStableV5ExternalSources';

const CREATED_AT = '2026-09-03T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '既存予定',
    subject: '',
    date: '2026-09-03',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('Stable V5 canonical busy compatibility', () => {
  it('shows a busy=false deadline in the occurrence model without blocking AI scheduling', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [
        plan({
          id: 'deadline-1',
          seriesId: 'deadline-1',
          title: '申込締切',
          type: 'deadline',
          busy: false,
        }),
        plan({
          id: 'busy-1',
          seriesId: 'busy-1',
          title: '面談',
          busy: true,
        }),
      ],
      templates: [],
      horizon: { startDate: '2026-09-03', endDate: '2026-09-03' },
      timeZone: 'Asia/Tokyo',
    });
    const existing = sources.find((source) => source.kind === 'existing_plans');

    expect(existing?.status).toBe('success');
    if (!existing || existing.status !== 'success') {
      throw new Error('expected a successful existing-plan source');
    }

    expect(existing.events.map((event) => event.eventId)).toEqual(['busy-1']);
  });
});
