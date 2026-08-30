import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningRequestContextAtIngress } from './weeklyPlanningRequestContextIngress';

describe('weekly planning request-context ingress', () => {
  it('passes a captured request context through unchanged', () => {
    const requestContext = {
      startedAtIso: '2026-08-30T12:34:56.000Z',
      timeZone: 'America/Los_Angeles',
      currentDate: '2026-08-30',
      currentTime: '05:34',
      notBeforeDate: '2026-08-30',
      notBeforeTime: '05:35',
      weekStartsOn: 'sunday' as const,
    };

    const result = resolveWeeklyPlanningRequestContextAtIngress({
      requestContext,
      selectedDate: '2030-01-01',
      weekStartsOn: 'monday',
    });

    expect(result).toEqual({
      context: requestContext,
      source: 'captured_request',
    });
    expect(result.context).toBe(requestContext);
  });

  it('upgrades a legacy direct caller once at ingress', () => {
    const result = resolveWeeklyPlanningRequestContextAtIngress({
      selectedDate: '2026-08-11',
      weekStartsOn: 'sunday',
    });

    expect(result.source).toBe('legacy_direct_caller');
    expect(result.context).toEqual(expect.objectContaining({
      currentDate: '2026-08-11',
      notBeforeDate: '2026-08-11',
      currentTime: '00:00',
      notBeforeTime: '00:00',
      weekStartsOn: 'sunday',
    }));
  });
});
