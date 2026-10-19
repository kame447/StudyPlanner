import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowsSpatialMotion,
  getMotionLevel,
  getMotionPreference,
  installMotionPreference,
  MOTION_STORAGE_KEY,
  REDUCED_FADE_MS,
  resolveExitDurationMs,
  resolveMotionLevel,
  setMotionPreference,
  STANDARD_EXIT_MS,
  subscribeMotion,
} from './motionPreference';
import { installFakeMotionEnvironment } from './motionPreference.testUtils';

let env: ReturnType<typeof installFakeMotionEnvironment>;
beforeEach(() => { env = installFakeMotionEnvironment(); });
afterEach(() => env.restore());
const setSystemReduced = (matches: boolean) => env.setSystemReduced(matches);
const html = () => env.root.dataset;

describe('effective motion level', () => {
  it('lets the device lower standard to reduced but never raises an explicit choice', () => {
    expect(resolveMotionLevel('standard', false)).toBe('standard');
    expect(resolveMotionLevel('standard', true)).toBe('reduced');
    expect(resolveMotionLevel('reduced', false)).toBe('reduced');
    expect(resolveMotionLevel('reduced', true)).toBe('reduced');
    expect(resolveMotionLevel('off', false)).toBe('off');
    expect(resolveMotionLevel('off', true)).toBe('off');
  });

  it('only waits for an exit animation at the standard level', () => {
    expect(resolveExitDurationMs('standard', STANDARD_EXIT_MS)).toBe(STANDARD_EXIT_MS);
    expect(resolveExitDurationMs('reduced', STANDARD_EXIT_MS)).toBe(0);
    expect(resolveExitDurationMs('off', STANDARD_EXIT_MS)).toBe(0);
    expect(resolveExitDurationMs('standard', 0)).toBe(0);
  });

  it('keeps the JS exit waits equal to the CSS tokens that animate them', () => {
    const css = readFileSync(new URL('../styles/motion.css', import.meta.url), 'utf8');
    expect(css).toContain(`--motion-duration-exit: ${STANDARD_EXIT_MS}ms;`);
    expect(css).toContain(`--motion-duration-fade: ${REDUCED_FADE_MS}ms;`);
    expect(css).toMatch(/:root\[data-motion='reduced'\] \{[^}]*--motion-duration-exit: 0ms;/);
    expect(css).toMatch(/:root\[data-motion='off'\] \{[^}]*--motion-duration-exit: 0ms;/);
  });
});

describe('stored preference', () => {
  it('defaults to standard and ignores unknown stored values', () => {
    expect(getMotionPreference()).toBe('standard');
    env.restore();
    env = installFakeMotionEnvironment();
    env.storage.setItem(MOTION_STORAGE_KEY, 'dramatic');
    expect(getMotionPreference()).toBe('standard');
  });

  it('survives a reload', () => {
    expect(setMotionPreference('off')).toBe(true);
    const stored = env.storage.getItem(MOTION_STORAGE_KEY)!;
    env.restore();
    env = installFakeMotionEnvironment();
    env.storage.setItem(MOTION_STORAGE_KEY, stored);
    expect(getMotionPreference()).toBe('off');
    expect(getMotionLevel()).toBe('off');
  });

  it('does not pretend a refused save succeeded', () => {
    installMotionPreference();
    env.storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    const listener = vi.fn();
    subscribeMotion(listener);
    expect(setMotionPreference('off')).toBe(false);
    expect(getMotionLevel()).toBe('standard');
    expect(html().motion).toBe('standard');
    expect(listener).not.toHaveBeenCalled();
  });

  it('falls back to standard when storage cannot be read', () => {
    env.storage.getItem.mockImplementation(() => { throw new Error('blocked'); });
    expect(getMotionLevel()).toBe('standard');
  });
});

describe('published level', () => {
  it('writes <html data-motion> before render and follows choice and device changes', () => {
    setSystemReduced(true);
    installMotionPreference();
    expect(html().motion).toBe('reduced');

    setSystemReduced(false);
    expect(html().motion).toBe('standard');
    expect(allowsSpatialMotion()).toBe(true);

    setMotionPreference('reduced');
    expect(html().motion).toBe('reduced');
    expect(allowsSpatialMotion()).toBe(false);

    setMotionPreference('off');
    setSystemReduced(true);
    expect(html().motion).toBe('off');
  });

  it('notifies subscribers of device changes and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMotion(listener);
    setSystemReduced(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setSystemReduced(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('adopts a choice saved in another tab', () => {
    installMotionPreference();
    env.storeFromAnotherTab(MOTION_STORAGE_KEY, 'reduced');
    expect(getMotionPreference()).toBe('reduced');
    expect(html().motion).toBe('reduced');
  });

  it('falls back to standard when another tab clears all storage', () => {
    installMotionPreference();
    setMotionPreference('off');
    env.clearFromAnotherTab();
    expect(getMotionPreference()).toBe('standard');
    expect(html().motion).toBe('standard');
  });
});

describe('single owner', () => {
  it('is the only production source that reads the device reduced-motion setting', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const srcRoot = new URL('..', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(css|tsx?)$/.test(name) || /\.test(Utils)?\.|\.testUtils\./.test(name)) continue;
        if (readFileSync(path, 'utf8').includes('prefers-reduced-motion')) offenders.push(relative(srcRoot, path));
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual(['lib/motionPreference.ts']);
  });

  it('lets hover lifts and press scales move only at standard', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const srcRoot = new URL('..', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!name.endsWith('.css')) continue;
        const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          if (!/:(hover|active)/.test(selector) || selector.includes('data-motion')) continue;
          const transform = /(?<![-\w])transform:\s*([^;]+)/.exec(body)?.[1].trim();
          if (!transform || transform === 'none' || transform.includes('var(--motion')) continue;
          if (/translate[XY3d]*\((?!0\)|0,\s*0)|scale\((?!1\))/.test(transform)) {
            offenders.push(`${relative(srcRoot, path)}: ${selector.trim().split('\n').pop()}`);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });

  it('never lets a near-zero !important duration outrank the off guarantee', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const srcRoot = new URL('..', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!name.endsWith('.css')) continue;
        // A more specific `1ms !important` beats `:root[data-motion='off'] *`
        // and leaves real (if tiny) motion and timing under off.
        if (/(?<![\d.])(?:0?\.\d+|[1-9]\d*)ms\s*!important/.test(readFileSync(path, 'utf8'))) offenders.push(relative(srcRoot, path));
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
