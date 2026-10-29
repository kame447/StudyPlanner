import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsGeneral, type AppSettingsGeneralProps } from './AppSettingsGeneral';

const fontLoads = vi.hoisted(() => ({ loadAll: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/fontPreset', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/fontPreset')>(),
  loadAllWebFontStylesheets: fontLoads.loadAll,
}));
vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({
  useWeeklyPlanningPersonalization: () => ({ weekStartsOn: 'monday', setWeekStartsOn: vi.fn(), resetProfile: vi.fn() }),
}));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); fontLoads.loadAll.mockReset(); fontLoads.loadAll.mockImplementation(() => Promise.resolve()); });
const props = (): AppSettingsGeneralProps => ({
  themeMode: 'light', themePalette: 'forest', onChangeTheme: vi.fn(), onChangeThemePalette: vi.fn(),
  appearance: 'standard', onChangeAppearance: vi.fn(), fontPreset: 'system', onChangeFontPreset: vi.fn(),
});
const disclosure = () => renderer.root.findByProps({ 'aria-controls': 'settings-font-options' });
const options = () => renderer.root.findByProps({ id: 'settings-font-options' }).findAllByType('button');
const optionLabel = (node: ReturnType<typeof options>[number]) => node.findByType('strong').children.join('');

describe('font preset settings', () => {
  it('stays collapsed with the selected label and requests no web font until opened', () => {
    act(() => { renderer = create(<AppSettingsGeneral {...props()} fontPreset="biz-udpgothic" />); });
    expect(disclosure().props['aria-expanded']).toBe(false);
    expect(disclosure().findByProps({ className: 'settings-row-value' }).children).toContain('BIZ UDPゴシック');
    expect(renderer.root.findAllByProps({ id: 'settings-font-options' })).toHaveLength(0);
    expect(fontLoads.loadAll).not.toHaveBeenCalled();
  });

  it('opens four labelled options with real Japanese samples rendered in each preset', () => {
    const current = props();
    act(() => { renderer = create(<AppSettingsGeneral {...current} />); });
    act(() => disclosure().props.onClick());
    expect(fontLoads.loadAll).toHaveBeenCalledTimes(1);
    expect(options().map(optionLabel)).toEqual(['標準', 'Noto Sans JP', 'BIZ UDPゴシック', 'M PLUS Rounded 1c']);
    expect(options().map(button => button.props['aria-pressed'])).toEqual([true, false, false, false]);
    const samples = renderer.root.findAll(node => node.props.className === 'font-preset-sample');
    expect(samples.map(sample => sample.props['data-font-sample'])).toEqual(['system', 'noto-sans-jp', 'biz-udpgothic', 'm-plus-rounded-1c']);
    for (const sample of samples) expect(sample.children.join('')).toMatch(/今日の学習/);
    act(() => options()[3].props.onClick());
    expect(current.onChangeFontPreset).toHaveBeenCalledWith('m-plus-rounded-1c');
    expect(current.onChangeThemePalette).not.toHaveBeenCalled();
    expect(current.onChangeTheme).not.toHaveBeenCalled();
    expect(current.onChangeAppearance).not.toHaveBeenCalled();
  });

  it('explains the dot appearance and a failed comparison download without blocking selection', async () => {
    fontLoads.loadAll.mockImplementation(() => Promise.reject(new Error('offline')));
    act(() => { renderer = create(<AppSettingsGeneral {...props()} appearance="pixel" />); });
    await act(async () => { disclosure().props.onClick(); });
    const notes = renderer.root.findAll(node => node.props.className === 'font-preset-note').map(node => node.children.join(''));
    expect(notes).toEqual(['ドットテーマ中はドット書体で表示されます。', '一部のフォントを読み込めませんでした。端末の書体で表示しています。']);
    expect(options()).toHaveLength(4);
  });

  it('shows the preference error outside the collapsed picker', () => {
    act(() => { renderer = create(<AppSettingsGeneral {...props()} fontError="フォントを読み込めませんでした。" />); });
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('フォントを読み込めませんでした');
  });

  it('omits the font row when no preference owner is connected', () => {
    const { onChangeFontPreset: _omit, ...withoutFont } = props();
    act(() => { renderer = create(<AppSettingsGeneral {...withoutFont} />); });
    expect(renderer.root.findAllByProps({ 'aria-controls': 'settings-font-options' })).toHaveLength(0);
  });
});
