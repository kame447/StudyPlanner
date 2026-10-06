import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import { retireStartupPreviewCache } from './retiredStartupPreviewCache';
afterEach(() => vi.unstubAllGlobals());
it('removes only retired copy keys and preserves all canonical and unrelated data', () => {
  const storage = new MemoryStorage(); vi.stubGlobal('window', { localStorage: storage });
  for (const key of ['studyplanner.startup-schedule.v1:a', 'studyplanner.startup-schedule.v1:b', 'studyplanner.startup-schedule.disabled', 'studyplanner.plans', 'studyplanner.session', 'unrelated']) storage.setItem(key, 'value');
  retireStartupPreviewCache();
  expect(storage.length).toBe(3); expect(storage.getItem('studyplanner.plans')).toBe('value');
  expect(storage.getItem('studyplanner.session')).toBe('value'); expect(storage.getItem('unrelated')).toBe('value');
});
it('continues after an individual deletion fails and tolerates inaccessible storage', () => {
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.startup-schedule.v1:a', 'old'); storage.setItem('studyplanner.startup-schedule.v1:b', 'old');
  const remove = storage.removeItem.bind(storage);
  storage.removeItem = key => { if (key.endsWith(':a')) throw new Error('denied'); remove(key); };
  vi.stubGlobal('window', { localStorage: storage });
  expect(() => retireStartupPreviewCache()).not.toThrow(); expect(storage.getItem('studyplanner.startup-schedule.v1:b')).toBeNull();
  vi.stubGlobal('window', { get localStorage() { throw new Error('denied'); } });
  expect(() => retireStartupPreviewCache()).not.toThrow();
});
