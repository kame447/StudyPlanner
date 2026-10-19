import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsGeneral, type AppSettingsGeneralProps } from './AppSettingsGeneral';

vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({
  useWeeklyPlanningPersonalization: () => ({ weekStartsOn: 'monday', setWeekStartsOn: vi.fn(), resetProfile: vi.fn() }),
}));
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
const props: AppSettingsGeneralProps = {
  themeMode: 'dark', themePalette: 'ocean', onChangeTheme: vi.fn(), onChangeThemePalette: vi.fn(),
  appearance: 'standard', onChangeAppearance: vi.fn(),
};
const button = (text: string) => renderer.root.findAllByType('button').find(node => node.children.includes(text))!;

describe('appearance settings', () => {
  it('uses named native buttons with correct pressed state and independent callbacks', () => {
    act(() => { renderer = create(<AppSettingsGeneral {...props} />); });
    const group = renderer.root.findByProps({ 'aria-labelledby': 'settings-appearance-label' });
    expect(group.props.role).toBe('group');
    expect(button('標準').props['aria-pressed']).toBe(true);
    expect(button('ドット').props['aria-pressed']).toBe(false);
    expect(button('ドット').props.type).toBe('button');
    act(() => button('ドット').props.onClick());
    expect(props.onChangeAppearance).toHaveBeenCalledWith('pixel');
    expect(props.onChangeTheme).not.toHaveBeenCalled(); expect(props.onChangeThemePalette).not.toHaveBeenCalled();
    act(() => renderer.update(<AppSettingsGeneral {...props} appearance="pixel" />));
    expect(button('ドット').props['aria-pressed']).toBe(true);
    expect(button('標準').props['aria-pressed']).toBe(false);
    expect(button('ダーク').props['aria-pressed']).toBe(true);
  });

  it('announces a failed save without falsely selecting the requested appearance', () => {
    act(() => { renderer = create(<AppSettingsGeneral {...props} appearanceError="テーマを保存できませんでした。" />); });
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('テーマを保存できませんでした。');
    expect(button('標準').props['aria-pressed']).toBe(true);
  });
});
