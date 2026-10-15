import { vi } from 'vitest';
import { resetMotionPreferenceForTests } from './motionPreference';

/**
 * A minimal browser for the motion policy under the node test environment:
 * storage, the device reduced-motion query, `storage` events and `<html>`.
 */
export function installFakeMotionEnvironment() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, String(value)); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => values.clear()),
  };
  const systemReduced = Object.assign(new EventTarget(), { matches: false });
  const target = new EventTarget();
  const root = { dataset: {} as Record<string, string | undefined> };
  vi.stubGlobal('window', {
    localStorage: storage,
    matchMedia: vi.fn(() => systemReduced),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  });
  vi.stubGlobal('document', { documentElement: root });
  resetMotionPreferenceForTests();

  return {
    storage,
    root,
    setSystemReduced(matches: boolean) {
      systemReduced.matches = matches;
      systemReduced.dispatchEvent(new Event('change'));
    },
    /** Another tab of this browser stored a new choice. */
    storeFromAnotherTab(key: string, value: string) {
      values.set(key, value);
      target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: value }));
    },
    restore() {
      resetMotionPreferenceForTests();
      vi.unstubAllGlobals();
    },
  };
}
