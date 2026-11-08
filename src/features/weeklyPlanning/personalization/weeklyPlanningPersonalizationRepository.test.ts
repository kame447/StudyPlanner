import { describe, expect, it } from 'vitest';
import { createLocalWeeklyPlanningPersonalizationRepository } from './weeklyPlanningPersonalizationRepository';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe('weekly planning personalization repository', () => {
  it('stores a confirmed week start and restores it for the same account', async () => {
    const repository = createLocalWeeklyPlanningPersonalizationRepository(memoryStorage());

    const saved = await repository.setWeekStartsOn('user-1', 'sunday');
    const restored = await repository.getProfile('user-1');

    expect(saved.weekStartsOn).toMatchObject({
      value: 'sunday',
      origin: 'user_confirmed',
      confidence: 'confirmed',
      scope: { kind: 'global' },
    });
    expect(restored).toEqual(saved);
  });

  it('stores the default study mode with the pomodoro length, keeps the week start, and restores both', async () => {
    const repository = createLocalWeeklyPlanningPersonalizationRepository(memoryStorage());
    await repository.setWeekStartsOn('user-1', 'sunday');
    expect((await repository.getProfile('user-1'))?.defaultStudyMode).toBeUndefined();

    const mode = { mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 40, customBreakMinutes: 8 } } as const;
    const saved = await repository.setDefaultStudyMode('user-1', mode);
    const restored = await repository.getProfile('user-1');

    expect(saved.defaultStudyMode).toMatchObject({ value: mode, origin: 'user_confirmed', scope: { kind: 'global' } });
    expect(restored).toEqual(saved);
    expect(restored?.weekStartsOn?.value).toBe('sunday');
    expect((await repository.setWeekStartsOn('user-1', 'monday')).defaultStudyMode?.value).toEqual(mode);
  });

  it('drops a stored default study mode that is invalid, keeping the rest of the profile', async () => {
    const storage = memoryStorage();
    const repository = createLocalWeeklyPlanningPersonalizationRepository(storage);
    const good = await repository.setDefaultStudyMode('user-1', { mode: 'pomodoro', pomodoro: { preset: '25-5' } });
    const corrupt = (value: unknown) => storage.setItem('studyplanner-weekly-personalization-v1:user-1', JSON.stringify({
      ...good, defaultStudyMode: { ...good.defaultStudyMode, value },
    }));

    for (const value of [
      { mode: 'timer', pomodoro: { preset: '25-5' } },
      { mode: 'pomodoro', pomodoro: { preset: '30-6' } },
      { mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 0, customBreakMinutes: 5 } },
      { mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 25 } },
      { mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 25, customBreakMinutes: 1441 } },
      { mode: 'pomodoro' },
    ]) {
      corrupt(value);
      const restored = await repository.getProfile('user-1');
      expect(restored, JSON.stringify(value)).not.toBeNull();
      expect(restored?.defaultStudyMode, JSON.stringify(value)).toBeUndefined();
    }
  });

  it('isolates accounts and removes the entire profile on reset', async () => {
    const repository = createLocalWeeklyPlanningPersonalizationRepository(memoryStorage());
    await repository.setWeekStartsOn('user-1', 'monday');
    await repository.setWeekStartsOn('user-2', 'sunday');

    await repository.resetProfile('user-1');

    expect(await repository.getProfile('user-1')).toBeNull();
    expect(await repository.getProfile('user-2')).toMatchObject({
      weekStartsOn: { value: 'sunday' },
    });
  });
});
