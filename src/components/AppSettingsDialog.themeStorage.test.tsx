import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useThemePreference } from '../hooks/useThemePreference';
import { AppSettingsDialog } from './AppSettingsDialog';

vi.mock('../features/userPlanningContext/UserPlanningContextContext', () => ({ useOptionalUserPlanningContextV1: () => null }));
vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({
  useWeeklyPlanningPersonalization: () => ({ weekStartsOn: 'monday', setWeekStartsOn: vi.fn(), resetProfile: vi.fn() }),
}));

const MODE_KEY = 'study-planner-theme-mode';
const PALETTE_KEY = 'study-planner-theme-palette';
let renderer: ReactTestRenderer;
function Settings({ open = true }: { open?: boolean }) {
  const { themeMode, themePalette, setThemeMode, setThemePalette, error } = useThemePreference();
  return <AppSettingsDialog open={open} onClose={() => undefined} themeMode={themeMode} themePalette={themePalette}
    onChangeTheme={setThemeMode} onChangeThemePalette={setThemePalette} themeError={error} />;
}
function browser() {
  const values = new Map([[MODE_KEY, 'light'], [PALETTE_KEY, 'forest']]);
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  vi.stubGlobal('document', { documentElement: { dataset: {}, style: { setProperty: vi.fn() } } });
  return { values, getItem, setItem };
}
const modeButton = (label: string) => renderer.root.findAllByType('button').find(button => button.children.includes(label))!;
const alertText = () => renderer.root.findByProps({ role: 'alert' }).children.join('');
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('shows a failed mode save through settings close/reopen and clears only after a successful retry', () => {
  const { setItem, values } = browser();
  act(() => { renderer = create(<Settings />); });
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  let blocked = true;
  setItem.mockImplementation((key, value) => {
    if (blocked && key === MODE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    values.set(key, value);
  });
  act(() => modeButton('ダーク').props.onClick());
  expect(modeButton('ダーク').props['aria-pressed']).toBe(true);
  expect(values.get(MODE_KEY)).toBe('light');
  expect(alertText()).toContain('保存できませんでした');
  expect(alertText()).toContain('再読み込みで元に戻る場合があります');
  act(() => renderer.update(<Settings open={false} />));
  act(() => renderer.update(<Settings />));
  expect(alertText()).toContain('保存できませんでした');
  blocked = false;
  act(() => modeButton('ダーク').props.onClick());
  expect(values.get(MODE_KEY)).toBe('dark');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('keeps a palette save warning visible after the palette picker is collapsed', () => {
  const { setItem, values } = browser();
  act(() => { renderer = create(<Settings />); });
  setItem.mockImplementation((key, value) => {
    if (key === PALETTE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    values.set(key, value);
  });
  const togglePalette = () => renderer.root.findByProps({ 'aria-controls': 'settings-palette-options' }).props.onClick();
  act(togglePalette);
  const ocean = () => renderer.root.findAllByType('button').find(button =>
    button.props.className?.includes('theme-palette-button') && button.findByType('strong').children.includes('オーシャン'))!;
  act(() => ocean().props.onClick());
  expect(ocean().props['aria-pressed']).toBe(true);
  expect(values.get(PALETTE_KEY)).toBe('forest');
  act(togglePalette);
  expect(renderer.root.findAllByProps({ id: 'settings-palette-options' })).toHaveLength(0);
  expect(alertText()).toContain('保存できませんでした');
  act(() => modeButton('ダーク').props.onClick());
  expect(values.get(MODE_KEY)).toBe('dark');
  expect(alertText()).toContain('保存できませんでした');
});

it('explains an unread fallback and leaves the saved value untouched until an explicit choice', () => {
  const { getItem, values } = browser();
  values.set(MODE_KEY, 'dark');
  getItem.mockImplementation(key => {
    if (key === MODE_KEY) throw new DOMException('Access denied', 'SecurityError');
    return values.get(key) ?? null;
  });
  act(() => { renderer = create(<Settings />); });
  expect(modeButton('ライト').props['aria-pressed']).toBe(true);
  expect(values.get(MODE_KEY)).toBe('dark');
  expect(alertText()).toContain('読み込めませんでした');
  act(() => modeButton('ライト').props.onClick());
  expect(values.get(MODE_KEY)).toBe('light');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});
