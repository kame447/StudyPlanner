import { afterEach, expect, it, vi } from 'vitest';
import { resolveStartupMarkerObservation } from './startupMarkerObservation';
afterEach(() => vi.unstubAllGlobals());
it('defaults OFF and requires one exact diagnostic and marker choice', () => {
  for (const query of ['', '?startupMarker=observe', '?startupTiming=0&startupMarker=observe',
    '?startupTiming=1&startupMarker=other', '?startupTiming=1&startupMarker=OBSERVE',
    '?startupTiming=1&startupTiming=1&startupMarker=observe',
    '?startupTiming=1&startupMarker=observe&startupMarker=observe']) {
    expect(resolveStartupMarkerObservation(query)).toBe('off');
  }
  expect(resolveStartupMarkerObservation('?startupTiming=1&startupMarker=observe')).toBe('observe');
});
it('fixes the marker choice for the current document without persistence', async () => {
  vi.resetModules(); const browser = { location: { search: '?startupTiming=1&startupMarker=observe' } };
  vi.stubGlobal('window', browser); const choice = await import('./startupMarkerObservation');
  browser.location.search = ''; expect(choice.startupMarkerObservation).toBe('observe');
});
