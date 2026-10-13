import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThemePreference } from './useThemePreference';
import type { ThemePalette } from '../lib/themePalette';

const MODE_KEY = 'study-planner-theme-mode';
const PALETTE_KEY = 'study-planner-theme-palette';
const PALETTES: Array<{ id: ThemePalette; light: string; dark: string }> = [
  { id: 'forest', light: '#176d66', dark: '#59b7ab' },
  { id: 'ocean', light: '#2f6fc2', dark: '#6fb2ff' },
  { id: 'sakura', light: '#c75a86', dark: '#ef94ba' },
  { id: 'amber', light: '#bf7c24', dark: '#efb45a' },
  { id: 'violet', light: '#6a56b7', dark: '#ab9af2' },
];

let current: ReturnType<typeof useThemePreference>;
let renderer: ReactTestRenderer | undefined;
function Probe() { current = useThemePreference(); return null; }
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
