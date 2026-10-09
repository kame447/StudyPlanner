import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppearancePreference } from './useAppearancePreference';
import type { Appearance } from '../lib/appearance';

let current: ReturnType<typeof useAppearancePreference>;
let renderer: ReactTestRenderer;
function Probe({ owner }: { owner?: string }) { current = useAppearancePreference(); return <span>{owner}</span>; }
function mount(owner = 'first') { act(() => { renderer = create(<Probe owner={owner} />); }); }
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

function storage(values = new Map<string, string>()) {
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const dataset: Record<string, string> = {};
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  vi.stubGlobal('document', { documentElement: { dataset } });
  return { values, getItem, setItem, dataset };
}

describe('optional browser appearance', () => {
  it('defaults to standard without writing storage or selecting the dot font', () => {
    const { setItem, dataset } = storage(); mount();
    expect(current.appearance).toBe('standard');
    expect(dataset.appearance).toBe('standard');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('persists repeated choices, survives remount and remains browser-wide after owner changes', () => {
    const { values, dataset } = storage(new Map([
      ['study-planner-theme-mode', 'dark'], ['study-planner-theme-palette', 'sakura'],
      ['study-planner-home-scene-style', 'minimal'], ['study-planner-home-scene-motion', 'true'],
    ])); mount();
    for (const value of ['pixel', 'standard', 'pixel', 'pixel'] as const) {
      act(() => current.setAppearance(value));
      expect(current.appearance).toBe(value); expect(dataset.appearance).toBe(value);
    }
    act(() => renderer.update(<Probe owner="second" />));
    expect(current.appearance).toBe('pixel');
    act(() => renderer.unmount()); mount('second');
    expect(current.appearance).toBe('pixel');
    act(() => current.setAppearance('standard'));
    expect(values).toEqual(new Map([
      ['study-planner-theme-mode', 'dark'], ['study-planner-theme-palette', 'sakura'],
      ['study-planner-home-scene-style', 'minimal'], ['study-planner-home-scene-motion', 'true'],
      ['study-planner-appearance', 'standard'],
    ]));
  });

  it.each(['', 'null', 'future', '{"appearance":"pixel"}'])('uses standard for invalid stored %s without overwriting it', value => {
    const { values, setItem } = storage(new Map([['study-planner-appearance', value]])); mount();
    expect(current.appearance).toBe('standard'); expect(setItem).not.toHaveBeenCalled();
    expect(values.get('study-planner-appearance')).toBe(value);
  });

  it('does not accept an invalid runtime choice', () => {
    const { setItem } = storage(); mount();
    act(() => current.setAppearance('future' as Appearance));
    expect(current.appearance).toBe('standard'); expect(setItem).not.toHaveBeenCalled();
  });

  it('retains the saved choice and visible theme on failed writes, then recovers', () => {
    const { setItem, dataset, values } = storage(); mount();
    act(() => current.setAppearance('pixel'));
    setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    act(() => current.setAppearance('standard'));
    expect(current.appearance).toBe('pixel'); expect(dataset.appearance).toBe('pixel');
    expect(current.error).toContain('テーマを保存できませんでした');
    expect(values.get('study-planner-appearance')).toBe('pixel');
    setItem.mockImplementation((key, value) => { values.set(key, value); });
    act(() => current.setAppearance('standard'));
    expect(current.appearance).toBe('standard'); expect(current.error).toBeNull();
  });

  it('survives a denied storage getter and never silently overwrites an unreadable choice on mount', () => {
    storage();
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError'); } });
    mount(); expect(current.appearance).toBe('standard');
    act(() => current.setAppearance('pixel'));
    expect(current.appearance).toBe('standard'); expect(current.error).toContain('テーマを保存できませんでした');
  });

  it('renders safely without browser globals', () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined);
    mount(); expect(current.appearance).toBe('standard');
  });
});
