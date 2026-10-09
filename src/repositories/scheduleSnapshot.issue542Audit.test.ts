import { describe, expect, it, vi } from 'vitest';
import type { ProductActivityAction } from '../../shared/productObservabilityContract';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { createObservedPlannerRepository } from './observedPlannerRepository';
import { createUnavailablePlannerRepository } from './unavailableRepositories';
import { MemoryStorage, event, plan } from './localPersistenceConcurrency.testUtils';

describe('Issue 542 independent combined-snapshot audit', () => {
  it('preserves startup app activity through the real observed facade without duplicate narrow-read activity', async () => {
    const base = createLocalPlannerRepository(new MemoryStorage());
    const actions: ProductActivityAction[] = [];
    const repository = createObservedPlannerRepository(base, {
      recordActivity: input => { actions.push(input.action); },
    });
    await repository.getScheduleSnapshot('owner');
    expect(actions).toEqual(['app_active']);
    await repository.getScheduleSnapshot('owner');
    await repository.getPlans('owner');
    expect(actions).toEqual(['app_active']);
    await repository.getScheduleSnapshot('other');
    expect(actions).toEqual(['app_active', 'app_active']);
  });

  it('counts only successful snapshot reads and leaves persistence success independent of telemetry', async () => {
    const base = createLocalPlannerRepository(new MemoryStorage());
    const read = vi.spyOn(base, 'getScheduleSnapshot');
    read.mockRejectedValueOnce(new Error('schedule unavailable'));
    const recordActivity = vi.fn();
    const repository = createObservedPlannerRepository(base, { recordActivity });
    await expect(repository.getScheduleSnapshot('owner')).rejects.toThrow('schedule unavailable');
    expect(recordActivity).not.toHaveBeenCalled();
    recordActivity.mockImplementation(() => { throw new Error('telemetry unavailable'); });
    await expect(repository.getScheduleSnapshot('owner')).resolves.toEqual({ plans: [], monthEvents: [] });
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it('retains old and future rows, recurrence, multi-day spans, exclusions, and owner isolation through actual migration and canonical reads', async () => {
    const storage = new MemoryStorage();
    const oldPlan = plan({ id: 'history', seriesId: 'history', date: '2020-01-01' });
    const repeatingPlan = plan({ id: 'recurring', seriesId: 'recurring', date: '2030-01-01',
      repeat: 'weekly', repeatUntil: '2031-01-01', excludedDates: ['2030-01-08'], busy: false,
      recurrenceRules: [{ id: 'rule', kind: 'weekday', startDate: '2030-01-01', until: '2031-01-01',
        dates: [], weekdays: ['tue'], dayType: null, startTime: '23:00', endTime: '24:00', isOverride: false }],
    });
    const multiDay = event({ id: 'multi', date: '2025-01-01', endDate: '2025-01-04',
      repeat: 'yearly', repeatUntil: '2031-01-01', excludedDates: ['2026-01-01'], busy: false,
      url: 'https://example.com/event', locationTags: ['School'], memo: 'Preserve metadata',
      checklist: [{ id: 'check', text: 'Prepare', checked: true }],
    });
    storage.setItem('studyplanner.plans', JSON.stringify([oldPlan, repeatingPlan, plan({ id: 'foreign', userId: 'other' })]));
    storage.setItem('studyplanner.monthEvents', JSON.stringify([multiDay, event({ id: 'foreign', userId: 'other' })]));
    const repository = createLocalPlannerRepository(storage);
    const combined = await repository.getScheduleSnapshot('owner');
    expect(combined).toEqual({ plans: await repository.getPlans('owner'), monthEvents: await repository.getMonthEvents('owner') });
    expect(combined.plans.map(row => row.id)).toEqual(['history', 'recurring']);
    expect(combined.plans[1]).toMatchObject(repeatingPlan);
    expect(combined.monthEvents).toEqual([expect.objectContaining(multiDay)]);
    await repository.upsertPlan({ ...combined.plans[0], title: 'Fresh canonical edit' });
    expect((await repository.getScheduleSnapshot('owner')).plans[0].title).toBe('Fresh canonical edit');
    expect((await repository.getScheduleSnapshot('other')).plans.map(row => row.id)).toEqual(['foreign']);
  });

  it('exposes the mandatory snapshot method on the unavailable implementation too', async () => {
    await expect(createUnavailablePlannerRepository().getScheduleSnapshot('owner')).resolves.toEqual({ plans: [], monthEvents: [] });
  });
});
