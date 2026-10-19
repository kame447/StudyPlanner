import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, useAppAppearance } from './AppearanceProvider';

const css = vi.hoisted(() => ({ loads: vi.fn() }));
vi.mock('../styles/appearance-pixel.css', () => { css.loads(); return {}; });
let renderer: ReactTestRenderer;
let rootPreference: ReturnType<typeof useAppAppearance>;
let appPreference: ReturnType<typeof useAppAppearance>;
let values: Map<string, string>;
const getItem = vi.fn((key: string) => values.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
const dataset: Record<string, string> = {};
function Probe({ nested = false }: { nested?: boolean }) {
  const preference = useAppAppearance();
  if (nested) appPreference = preference;
  else rootPreference = preference;
  return <span>{preference.appearance}</span>;
}
function Startup({ owner = 'first', stage = 'consent' }: { owner?: string; stage?: string }) {
  return <AppearanceProvider>
    <Probe />
    <span>{owner}:{stage}</span>
    {stage === 'app' ? <AppearanceProvider><Probe nested /></AppearanceProvider> : null}
  </AppearanceProvider>;
}
beforeEach(() => {
  values = new Map(); vi.clearAllMocks();
  setItem.mockImplementation((key, value) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  vi.stubGlobal('document', { documentElement: { dataset } });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

describe('shared browser appearance boundary', () => {
  it('applies the saved cold-start choice before App and reuses one owner through startup stages and owner changes', async () => {
    values.set('study-planner-appearance', 'pixel');
    await act(async () => { renderer = create(<Startup />); await vi.dynamicImportSettled(); });
    expect(dataset.appearance).toBe('pixel');
    expect(getItem).toHaveBeenCalledTimes(1); expect(getItem).toHaveBeenCalledWith('study-planner-appearance');
    expect(setItem).not.toHaveBeenCalled(); expect(css.loads).toHaveBeenCalledTimes(1);
    for (const stage of ['week-start', 'app']) act(() => renderer.update(<Startup stage={stage} />));
    expect(rootPreference).toBe(appPreference);
    act(() => appPreference.setAppearance('standard'));
    expect(rootPreference.appearance).toBe('standard'); expect(appPreference.appearance).toBe('standard');
    act(() => renderer.update(<Startup owner="second" stage="consent" />));
    act(() => renderer.update(<Startup owner="second" stage="app" />));
    expect(rootPreference).toBe(appPreference);
    expect(getItem).toHaveBeenCalledTimes(1); expect(css.loads).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('study-planner-appearance', 'standard');
  });

  it('keeps standard startup and nested entry free of optional stylesheet loads or preference writes', () => {
    act(() => { renderer = create(<Startup stage="app" />); });
    expect(rootPreference.appearance).toBe('standard'); expect(rootPreference).toBe(appPreference);
    expect(dataset.appearance).toBe('standard'); expect(getItem).toHaveBeenCalledTimes(1);
    expect(css.loads).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });

  it('shares save failure and the unchanged selection with every nested entry', () => {
    act(() => { renderer = create(<Startup stage="app" />); });
    setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    act(() => appPreference.setAppearance('pixel'));
    expect(rootPreference).toBe(appPreference);
    expect(rootPreference.error).toContain('テーマを保存できませんでした');
    expect(rootPreference.appearance).toBe('standard'); expect(dataset.appearance).toBe('standard');
  });
});
