import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStudyProgressPreference } from './useStudyProgressPreference';
import { AppSettingsGeneral } from '../components/AppSettingsGeneral';
vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({
  useWeeklyPlanningPersonalization: () => ({ weekStartsOn: 'monday', setWeekStartsOn: vi.fn(), resetProfile: vi.fn() }),
}));
let current: ReturnType<typeof useStudyProgressPreference>;
let renderer: ReactTestRenderer;
function Probe({ owner }: { owner?: string }) {
  current = useStudyProgressPreference(owner);
  return <AppSettingsGeneral themeMode="light" themePalette="forest" onChangeTheme={vi.fn()} onChangeThemePalette={vi.fn()}
    progressPreferences={current.preferences} onChangeProgressPreferences={current.setPreferences} progressPreferencesError={current.error} />;
}
function mount(owner?: string) { act(() => { renderer = create(<Probe owner={owner} />); }); }
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

describe('Home progress preferences', () => {
  it('defaults OFF, toggles independently in settings, persists and reloads per owner', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } });
    mount('a');
    expect(current.preferences).toEqual({ includeGeneralEvents: false, includeTimetable: false });
    const inputs = () => renderer.root.findAllByType('input');
    act(() => inputs().find(item => item.props['aria-label'] === '月の主要予定を進捗に含める')!.props.onChange({ target: { checked: true } }));
    expect(current.preferences).toEqual({ includeGeneralEvents: true, includeTimetable: false });
    act(() => inputs().find(item => item.props['aria-label'] === '時間割を進捗に含める')!.props.onChange({ target: { checked: true } }));
    expect(current.preferences.includeTimetable).toBe(true);
    act(() => renderer.update(<Probe owner="b" />));
    expect(current.preferences).toEqual({ includeGeneralEvents: false, includeTimetable: false });
    act(() => renderer.update(<Probe owner="a" />));
    expect(current.preferences).toEqual({ includeGeneralEvents: true, includeTimetable: true });
    act(() => renderer.unmount()); mount('a');
    expect(inputs().every(item => item.props.checked)).toBe(true);
  });

  it('fails closed for malformed storage and failed writes, without claiming persistence', () => {
    const getItem = vi.fn(() => '{broken');
    vi.stubGlobal('window', { localStorage: { getItem, setItem: () => { throw new Error('blocked'); } } });
    mount('a');
    expect(current.preferences).toEqual({ includeGeneralEvents: false, includeTimetable: false });
    act(() => current.setPreferences({ includeGeneralEvents: true, includeTimetable: true }));
    expect(current.preferences.includeGeneralEvents).toBe(false);
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('設定を保存できませんでした');
    getItem.mockReturnValue('{"includeGeneralEvents":"true","includeTimetable":1}');
    act(() => renderer.update(<Probe owner="b" />));
    expect(current.preferences).toEqual({ includeGeneralEvents: false, includeTimetable: false });
  });

  it('revokes callbacks across owner changes, logout, remount and return to the same owner', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } });
    mount('a');
    const old = current.setPreferences;
    act(() => renderer.update(<Probe owner="b" />));
    act(() => old({ includeGeneralEvents: true, includeTimetable: true }));
    act(() => renderer.update(<Probe owner="a" />));
    act(() => old({ includeGeneralEvents: true, includeTimetable: true }));
    act(() => renderer.update(<Probe />));
    act(() => current.setPreferences({ includeGeneralEvents: true, includeTimetable: true }));
    expect(setItem).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    act(() => old({ includeGeneralEvents: true, includeTimetable: true }));
    expect(setItem).not.toHaveBeenCalled();
  });
});
