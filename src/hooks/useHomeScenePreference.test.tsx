import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeScenePreference } from './useHomeScenePreference';

let current: ReturnType<typeof useHomeScenePreference>;
let renderer: ReactTestRenderer;
function Probe() { current = useHomeScenePreference(); return null; }
function mount() { act(() => { renderer = create(<Probe />); }); }
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

function storage(values = new Map<string, string>()) {
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  return { values, getItem, setItem };
}

describe('home scene browser preferences', () => {
  it('starts with a still pixel scene and does not overwrite storage on mount', () => {
    const { setItem } = storage(); mount();
    expect(current.preferences).toEqual({ style: 'pixel', animated: false });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('persists each style and repeated motion changes independently, then reloads both', () => {
    const { values } = storage(); mount();
    for (const style of ['cozy', 'minimal', 'pixel', 'pixel-cat', 'pixel-turtle', 'cozy'] as const) {
      act(() => current.setStyle(style));
      expect(current.preferences.style).toBe(style);
      expect(current.preferences.animated).toBe(false);
    }
    act(() => { current.setAnimated(true); current.setStyle('minimal'); });
    expect(current.preferences).toEqual({ style: 'minimal', animated: true });
    act(() => current.setAnimated(false));
    act(() => current.setAnimated(true));
    expect(values).toEqual(new Map([
      ['study-planner-home-scene-style', 'minimal'],
      ['study-planner-home-scene-motion', 'true'],
    ]));
    act(() => renderer.unmount()); mount();
    expect(current.preferences).toEqual({ style: 'minimal', animated: true });
  });

  it.each(['pixel-cat', 'pixel-turtle'] as const)('saves and restores %s without changing the chosen motion setting', style => {
    const { values } = storage(); mount();
    act(() => current.setAnimated(true));
    act(() => current.setStyle(style));
    expect(values.get('study-planner-home-scene-style')).toBe(style);
    expect(current.preferences).toEqual({ style, animated: true });
    act(() => renderer.unmount()); mount();
    expect(current.preferences).toEqual({ style, animated: true });
    act(() => current.setAnimated(false));
    act(() => renderer.unmount()); mount();
    expect(current.preferences).toEqual({ style, animated: false });
  });

  it.each(['invalid', 'null', '', '{"style":"cozy"}'])('falls back safely for invalid storage %s', invalid => {
    storage(new Map([['study-planner-home-scene-style', invalid], ['study-planner-home-scene-motion', invalid]]));
    mount(); expect(current.preferences).toEqual({ style: 'pixel', animated: false });
  });

  it('keeps the last saved values when writes fail and clears the error on recovery', () => {
    const { setItem } = storage(); mount();
    act(() => current.setStyle('cozy'));
    setItem.mockImplementation(() => { throw new Error('storage blocked'); });
    act(() => current.setStyle('minimal'));
    act(() => current.setAnimated(true));
    expect(current.preferences).toEqual({ style: 'cozy', animated: false });
    expect(current.error).toContain('設定を保存できませんでした');
    setItem.mockImplementation(() => undefined);
    act(() => current.setStyle('pixel'));
    expect(current.error).toBeNull();
    expect(current.preferences.style).toBe('pixel');
  });

  it('survives blocked access to storage itself', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    mount(); expect(current.preferences).toEqual({ style: 'pixel', animated: false });
    act(() => current.setAnimated(true));
    expect(current.preferences.animated).toBe(false);
    expect(current.error).toContain('設定を保存できませんでした');
  });

  it('renders defaults without a browser', () => {
    vi.stubGlobal('window', undefined); mount();
    expect(current.preferences).toEqual({ style: 'pixel', animated: false });
  });
});
