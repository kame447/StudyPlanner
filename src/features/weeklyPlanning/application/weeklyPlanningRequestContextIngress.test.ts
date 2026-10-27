import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWeeklyPlanningRequestContextAtIngress } from './weeklyPlanningRequestContextIngress';

afterEach(() => vi.restoreAllMocks());

describe('weekly planning request-context ingress', () => {
  it('passes a captured request context through unchanged', () => {
    const ambientTimeZone = vi.spyOn(Intl, 'DateTimeFormat');
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
    expect(ambientTimeZone).not.toHaveBeenCalled();
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

  it.each(['America/Los_Angeles', ''])('uses the legacy ambient timezone or Tokyo fallback: %s', (timeZone) => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone }),
    } as Intl.DateTimeFormat);

    const result = resolveWeeklyPlanningRequestContextAtIngress({ selectedDate: '2026-08-11' });

    expect(result.source).toBe('legacy_direct_caller');
    expect(result.context.timeZone).toBe(timeZone || 'Asia/Tokyo');
    expect(result.context.weekStartsOn).toBe('monday');
    expect(Intl.DateTimeFormat).toHaveBeenCalledTimes(1);
  });
});
