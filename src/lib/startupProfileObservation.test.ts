import { afterEach, expect, it, vi } from 'vitest';
import { resolveStartupProfileObservation } from './startupProfileObservation';
afterEach(() => { vi.unstubAllGlobals(); });
it('defaults off and requires an unambiguous explicit diagnostic observation choice', () => {
  for (const query of ['', '?startupProfile=observe', '?startupTiming=0&startupProfile=observe',
    '?startupTiming=1', '?startupTiming=1&startupProfile=other', '?startupTiming=1&startupProfile=OBSERVE',
    '?startupTiming=1&startupProfile=observe&startupProfile=observe', '?startupTiming=1&startupTiming=1&startupProfile=observe']) {
    expect(resolveStartupProfileObservation(query), query).toBe('off');
  }
  expect(resolveStartupProfileObservation('?startupTiming=1&startupProfile=observe')).toBe('observe');
});
it('keeps the diagnostic choice fixed for this document', async () => {
  vi.resetModules(); const browser = { location: { search: '?startupTiming=1&startupProfile=observe' } };
  vi.stubGlobal('window', browser); const mode = await import('./startupProfileObservation');
  browser.location.search = ''; expect(mode.startupProfileObservation).toBe('observe');
});
