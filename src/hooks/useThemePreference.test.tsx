import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThemePreference } from './useThemePreference';
import type { ThemePalette } from '../lib/themePalette';

const fontLoads = vi.hoisted(() => ({ load: vi.fn((_preset: string) => Promise.resolve()) }));
vi.mock('../lib/fontPreset', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/fontPreset')>(),
  loadWebFontStylesheet: fontLoads.load,
}));

const MODE_KEY = 'study-planner-theme-mode';
const PALETTE_KEY = 'study-planner-theme-palette';
const FONT_KEY = 'study-planner-font-preset';
const PALETTES: Array<{ id: ThemePalette; light: string; dark: string }> = [
  { id: 'forest', light: '#176d66', dark: '#59b7ab' },
  { id: 'ocean', light: '#2f6fc2', dark: '#6fb2ff' },
  { id: 'sakura', light: '#c75a86', dark: '#ef94ba' },
  { id: 'amber', light: '#bf7c24', dark: '#efb45a' },
  { id: 'violet', light: '#6a56b7', dark: '#ab9af2' },
];

let current: ReturnType<typeof useThemePreference>;
let renderer: ReactTestRenderer | undefined;
function Probe() { current = useThemePreference(); return <span>app content</span>; }
function mount() { act(() => { renderer = create(<Probe />); }); }

function browser(palette: string | null = null, mode: string | null = null) {
  const values = new Map<string, string>([
    ['study-planner-appearance', 'pixel'],
    ['study-planner-home-scene-style', 'pixel-turtle'],
  ]);
  if (palette !== null) values.set(PALETTE_KEY, palette);
  if (mode !== null) values.set(MODE_KEY, mode);
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const css = new Map<string, string>();
  const setProperty = vi.fn((key: string, value: string) => { css.set(key, value); });
  const dataset = { appearance: 'pixel', theme: '' };
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  vi.stubGlobal('document', { documentElement: { dataset, style: { setProperty } } });
  return { values, getItem, setItem, css, setProperty, dataset };
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fontLoads.load.mockReset();
  fontLoads.load.mockImplementation(() => Promise.resolve());
});

describe('theme preference stored-value contract', () => {
  for (const mode of ['light', 'dark'] as const) {
    it.each(PALETTES)(`restores $id in ${mode} without changing other appearance choices`, palette => {
      const { values, css, dataset } = browser(palette.id, mode);
      mount();
      expect(current.themePalette).toBe(palette.id);
      expect(current.themeMode).toBe(mode);
      expect(css.get('--accent')).toBe(palette[mode]);
      expect(dataset).toEqual({ appearance: 'pixel', theme: mode });
      expect([...values]).toEqual([
        ['study-planner-appearance', 'pixel'],
        ['study-planner-home-scene-style', 'pixel-turtle'],
        [PALETTE_KEY, palette.id],
        [MODE_KEY, mode],
      ]);
    });
  }

  it.each([null, '', 'blue', 'sepia', 'FOREST', ' ocean ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '{"id":"ocean"}'])(
    'restores and persists forest for unsupported stored value %j', stored => {
      const { values, css } = browser(stored);
      mount();
      expect(current.themePalette).toBe('forest');
      expect(current.themeMode).toBe('light');
      expect(values.get(PALETTE_KEY)).toBe('forest');
      expect(values.get(MODE_KEY)).toBe('light');
      expect(css.get('--accent')).toBe('#176d66');
    },
  );

  it('keeps palette changes, mode changes and functional setters across remounts', () => {
    const { values, css, dataset, setItem } = browser('ocean', 'dark');
    mount();
    expect(setItem.mock.calls).toEqual([[MODE_KEY, 'dark'], [PALETTE_KEY, 'ocean']]);
    setItem.mockClear();
    act(() => current.setThemePalette('sakura'));
    expect(setItem.mock.calls).toEqual([[PALETTE_KEY, 'sakura']]);
    expect(current.themeMode).toBe('dark');
    expect(css.get('--accent')).toBe('#ef94ba');
    setItem.mockClear();
    act(() => current.setThemeMode(previous => previous === 'dark' ? 'light' : 'dark'));
    expect(setItem.mock.calls).toEqual([[MODE_KEY, 'light'], [PALETTE_KEY, 'sakura']]);
    expect(current.themePalette).toBe('sakura');
    expect(css.get('--accent')).toBe('#c75a86');
    act(() => current.setThemePalette(previous => previous === 'sakura' ? 'violet' : 'sakura'));
    act(() => renderer?.unmount());
    mount();
    expect(current.themePalette).toBe('violet');
    expect(current.themeMode).toBe('light');
    expect(css.get('--accent')).toBe('#6a56b7');
    expect(values.get(PALETTE_KEY)).toBe('violet');
    expect(dataset.appearance).toBe('pixel');
  });

  it.each(['', 'system', 'DARK', ' dark '])('preserves light fallback for unsupported mode %j', mode => {
    const { dataset, values } = browser('ocean', mode);
    mount();
    expect(current.themeMode).toBe('light');
    expect(dataset.theme).toBe('light');
    expect(values.get(MODE_KEY)).toBe('light');
  });
});


describe('theme preference storage failure containment', () => {
  it.each([MODE_KEY, PALETTE_KEY])('uses a safe default only for the denied read of %s', deniedKey => {
    const { values, getItem, dataset, css } = browser('ocean', 'dark');
    getItem.mockImplementation(key => {
      if (key === deniedKey) throw new DOMException('Access denied', 'SecurityError');
      return values.get(key) ?? null;
    });
    mount();
    expect(renderer?.toJSON()).not.toBeNull();
    expect(current.themeMode).toBe(deniedKey === MODE_KEY ? 'light' : 'dark');
    expect(current.themePalette).toBe(deniedKey === PALETTE_KEY ? 'forest' : 'ocean');
    expect(dataset.theme).toBe(current.themeMode);
    expect(css.get('--accent')).toBe(deniedKey === MODE_KEY ? '#2f6fc2' : '#59b7ab');
    expect(current.error).toContain('読み込めませんでした');
    expect(values.get(deniedKey)).toBe(deniedKey === MODE_KEY ? 'dark' : 'ocean');
    // Changing the other preference must not overwrite the unread saved value.
    if (deniedKey === MODE_KEY) act(() => current.setThemePalette('sakura'));
    else act(() => current.setThemeMode('light'));
    expect(values.get(deniedKey)).toBe(deniedKey === MODE_KEY ? 'dark' : 'ocean');
    // Choosing even the current fallback explicitly permits persistence.
    if (deniedKey === MODE_KEY) act(() => current.setThemeMode('light'));
    else act(() => current.setThemePalette('forest'));
    expect(values.get(deniedKey)).toBe(deniedKey === MODE_KEY ? 'light' : 'forest');
    expect(current.error).toBeNull();
  });

  it('keeps the app usable when access to localStorage itself is denied', () => {
    const { dataset, css } = browser();
    vi.stubGlobal('window', { get localStorage() { throw new DOMException('Access denied', 'SecurityError'); } });
    mount();
    expect(current.themeMode).toBe('light');
    expect(current.themePalette).toBe('forest');
    expect(current.error).toContain('読み込めませんでした');
    act(() => current.setThemeMode(mode => mode === 'light' ? 'dark' : 'light'));
    act(() => current.setThemePalette(palette => palette === 'forest' ? 'ocean' : 'forest'));
    expect(renderer?.toJSON()).not.toBeNull();
    expect(dataset.theme).toBe('dark');
    expect(css.get('--accent')).toBe('#6fb2ff');
    expect(current.error).toContain('保存できませんでした');
  });

  it.each([MODE_KEY, PALETTE_KEY])('contains a mount write failure for %s without losing the saved choice', deniedKey => {
    const { values, setItem, dataset, css } = browser('ocean', 'dark');
    setItem.mockImplementation((key, value) => {
      if (key === deniedKey) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    });
    mount();
    expect(renderer?.toJSON()).not.toBeNull();
    expect(current.themeMode).toBe('dark');
    expect(current.themePalette).toBe('ocean');
    expect(dataset.theme).toBe('dark');
    expect(css.get('--accent')).toBe('#6fb2ff');
    expect(current.error).toContain('保存できませんでした');
  });

  it.each([MODE_KEY, PALETTE_KEY])('keeps the failed %s change local and reports it until that key is saved', deniedKey => {
    const { values, setItem, dataset, css } = browser('forest', 'light');
    mount();
    let failing = true;
    setItem.mockImplementation((key, value) => {
      if (failing && key === deniedKey) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    });
    act(() => current.setThemeMode(mode => mode === 'light' ? 'dark' : 'light'));
    act(() => current.setThemePalette(palette => palette === 'forest' ? 'ocean' : 'forest'));
    expect(renderer?.toJSON()).not.toBeNull();
    expect(dataset.theme).toBe('dark');
    expect(css.get('--accent')).toBe('#6fb2ff');
    expect(values.get(deniedKey)).toBe(deniedKey === MODE_KEY ? 'light' : 'forest');
    expect(current.error).toContain('保存できませんでした');
    failing = false;
    // A palette-only save cannot clear a still-unsaved mode.
    act(() => current.setThemePalette('sakura'));
    expect(current.error === null).toBe(deniedKey === PALETTE_KEY);
    act(() => current.setThemeMode('light'));
    act(() => current.setThemeMode('dark'));
    expect(current.error).toBeNull();
    expect(values.get(MODE_KEY)).toBe('dark');
    expect(values.get(PALETTE_KEY)).toBe('sakura');
    act(() => renderer?.unmount());
    mount();
    expect(current.themeMode).toBe('dark');
    expect(current.themePalette).toBe('sakura');
    expect(current.error).toBeNull();
  });

  it('does not clear the alert when only one of two failing keys recovers', () => {
    const { values, setItem } = browser();
    let deniedKeys = new Set([MODE_KEY, PALETTE_KEY]);
    setItem.mockImplementation((key, value) => {
      if (deniedKeys.has(key)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    });
    mount();
    expect(current.error).toContain('保存できませんでした');
    deniedKeys = new Set([MODE_KEY]);
    act(() => current.setThemePalette('ocean'));
    expect(current.error).toContain('保存できませんでした');
    deniedKeys.clear();
    act(() => current.setThemeMode('dark'));
    expect(current.error).toBeNull();
  });
});


it('retries an unsuccessful save when the same value is explicitly selected again', () => {
  const { values, setItem } = browser('forest', 'light');
  mount();
  setItem.mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
  act(() => current.setThemeMode('dark'));
  act(() => current.setThemePalette('ocean'));
  expect(current.error).toContain('保存できませんでした');
  setItem.mockImplementation((key, value) => { values.set(key, value); });
  act(() => current.setThemePalette('ocean'));
  expect(current.error).toContain('保存できませんでした');
  act(() => current.setThemeMode('dark'));
  expect(current.error).toBeNull();
  expect(values.get(MODE_KEY)).toBe('dark');
  expect(values.get(PALETTE_KEY)).toBe('ocean');
});


describe('font preset preference', () => {
  it('keeps existing users on the system font without writing a key, an attribute or a font request', () => {
    const { values, setItem, dataset } = browser('ocean', 'dark');
    mount();
    expect(current.fontPreset).toBe('system');
    expect(current.fontError).toBeNull();
    expect('fontPreset' in dataset).toBe(false);
    expect(values.has(FONT_KEY)).toBe(false);
    expect(setItem.mock.calls.map(([key]) => key)).not.toContain(FONT_KEY);
    expect(fontLoads.load).not.toHaveBeenCalled();
  });

  it.each(['noto-sans-jp', 'biz-udpgothic', 'm-plus-rounded-1c'] as const)('restores %s after restart and requests only that font', preset => {
    const { values, dataset } = browser('ocean', 'dark');
    values.set(FONT_KEY, preset);
    mount();
    expect(current.fontPreset).toBe(preset);
    expect(dataset).toMatchObject({ fontPreset: preset, theme: 'dark', appearance: 'pixel' });
    expect(current.themePalette).toBe('ocean');
    expect(fontLoads.load.mock.calls).toEqual([[preset]]);
  });

  it.each(['', 'SYSTEM', 'Noto Sans JP', ' biz-udpgothic', '__proto__', 'toString', '{"id":"noto-sans-jp"}'])(
    'falls back to system for corrupt %j without overwriting it', stored => {
      const { values, dataset } = browser();
      values.set(FONT_KEY, stored);
      mount();
      expect(current.fontPreset).toBe('system');
      expect('fontPreset' in dataset).toBe(false);
      expect(values.get(FONT_KEY)).toBe(stored);
      expect(fontLoads.load).not.toHaveBeenCalled();
    },
  );

  it('applies a choice immediately, persists it and leaves mode, palette and appearance untouched', () => {
    const { values, dataset, css } = browser('sakura', 'dark');
    mount();
    act(() => current.setFontPreset('m-plus-rounded-1c'));
    expect(dataset).toEqual({ appearance: 'pixel', theme: 'dark', fontPreset: 'm-plus-rounded-1c' });
    expect(values.get(FONT_KEY)).toBe('m-plus-rounded-1c');
    expect(values.get(MODE_KEY)).toBe('dark');
    expect(values.get(PALETTE_KEY)).toBe('sakura');
    expect(css.get('--accent')).toBe('#ef94ba');
    act(() => current.setFontPreset('system'));
    expect(dataset).toEqual({ appearance: 'pixel', theme: 'dark' });
    expect(values.get(FONT_KEY)).toBe('system');
    act(() => current.setThemeMode('light'));
    act(() => current.setThemePalette('violet'));
    expect(values.get(FONT_KEY)).toBe('system');
    expect(fontLoads.load.mock.calls).toEqual([['m-plus-rounded-1c']]);
  });

  it('reports a font download failure while keeping the choice and clears it on another choice', async () => {
    const { values } = browser();
    fontLoads.load.mockImplementation(() => Promise.reject(new Error('offline')));
    mount();
    await act(async () => { current.setFontPreset('noto-sans-jp'); });
    expect(current.fontPreset).toBe('noto-sans-jp');
    expect(values.get(FONT_KEY)).toBe('noto-sans-jp');
    expect(current.fontError).toContain('フォントを読み込めませんでした');
    expect(current.error).toBeNull();
    await act(async () => { current.setFontPreset('system'); });
    expect(current.fontError).toBeNull();
  });

  it('reports a font save failure separately and retries on the same explicit choice', () => {
    const { values, setItem } = browser();
    mount();
    let failing = true;
    setItem.mockImplementation((key, value) => {
      if (failing && key === FONT_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    });
    act(() => current.setFontPreset('biz-udpgothic'));
    expect(current.fontPreset).toBe('biz-udpgothic');
    expect(current.fontError).toContain('フォント設定を保存できませんでした');
    expect(current.error).toBeNull();
    failing = false;
    act(() => current.setFontPreset('biz-udpgothic'));
    expect(values.get(FONT_KEY)).toBe('biz-udpgothic');
    expect(current.fontError).toBeNull();
  });

  it('ignores an unsupported runtime value', () => {
    const { values } = browser();
    mount();
    act(() => current.setFontPreset('comic-sans' as never));
    expect(current.fontPreset).toBe('system');
    expect(values.has(FONT_KEY)).toBe(false);
  });
});
