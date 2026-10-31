import { afterEach, expect, it, vi } from 'vitest';
import { hasCompletedFirstRunTour, markFirstRunTourComplete } from './firstRunTour';

afterEach(() => vi.unstubAllGlobals());

it('stores completion per owner without marking another owner completed', () => {
  const records = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
  } });
  expect(hasCompletedFirstRunTour('new-user')).toBe(false);
  markFirstRunTourComplete('new-user');
  expect(hasCompletedFirstRunTour('new-user')).toBe(true);
  expect(hasCompletedFirstRunTour('other-user')).toBe(false);
  expect(hasCompletedFirstRunTour('')).toBe(false);
});

it('continues without crashing when browser storage is blocked', () => {
  vi.stubGlobal('window', { localStorage: {
    getItem: () => { throw new Error('storage denied'); },
    setItem: () => { throw new Error('storage denied'); },
  } });
  expect(hasCompletedFirstRunTour('owner')).toBe(false);
  expect(() => markFirstRunTourComplete('owner')).not.toThrow();
});
