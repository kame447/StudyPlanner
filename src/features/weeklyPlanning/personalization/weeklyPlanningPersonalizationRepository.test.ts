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
