import { afterEach, expect, it, vi } from 'vitest';
import { isDevTestLoginEnabled } from './devAuthShortcut';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([
  [' true ', 'localhost', true], ['TrUe', '192.168.1.2', true],
  ['true', '10.1.2.3', true], ['true', '172.16.1.2', true],
  ['false', 'localhost', false], ['', 'localhost', false],
  [undefined, 'localhost', false], ['true', 'example.com', false],
  ['true', '172.32.1.2', false],
] as const)('preserves flag %j on host %s', (flag, hostname, expected) => {
  vi.stubEnv('VITE_ENABLE_DEV_TEST_LOGIN', flag);
  vi.stubGlobal('window', { location: { hostname } });
  expect(isDevTestLoginEnabled()).toBe(expected);
});
it('does not enable browser login during SSR', () => {
  vi.stubEnv('VITE_ENABLE_DEV_TEST_LOGIN', 'true');
  vi.stubGlobal('window', undefined);
  expect(isDevTestLoginEnabled()).toBe(false);
});
