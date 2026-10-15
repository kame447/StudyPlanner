import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_STORAGE_KEY } from '../lib/motionPreference';
import { installFakeMotionEnvironment } from '../lib/motionPreference.testUtils';
import { AppSettingsGeneral, type AppSettingsGeneralProps } from './AppSettingsGeneral';

vi.mock('../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext', () => ({
  useWeeklyPlanningPersonalization: () => ({ weekStartsOn: 'monday', setWeekStartsOn: vi.fn(), resetProfile: vi.fn() }),
}));

let renderer: ReactTestRenderer | undefined;
let env: ReturnType<typeof installFakeMotionEnvironment>;
const props: AppSettingsGeneralProps = {
  themeMode: 'light', themePalette: 'ocean', onChangeTheme: vi.fn(), onChangeThemePalette: vi.fn(),
  homeScenePreferences: { style: 'pixel', animated: true },
  onChangeHomeSceneStyle: vi.fn(), onChangeHomeSceneMotion: vi.fn(),
};

beforeEach(() => { env = installFakeMotionEnvironment(); });

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  env.restore();
});

const mount = () => act(() => { renderer = create(<AppSettingsGeneral {...props} />); });
const motionGroup = () => renderer!.root.findByProps({ 'aria-labelledby': 'settings-motion-label' });
const motionButton = (label: string) => motionGroup().findAllByType('button').find(node => node.children.includes(label))!;
const pressed = () => motionGroup().findAllByType('button').filter(node => node.props['aria-pressed']).map(node => node.children.join(''));
const sceneMotion = (): ReactTestInstance => renderer!.root.findByProps({ 'aria-label': 'イラストをゆっくり動かす' });
const setSystemReduced = (matches: boolean) => act(() => env.setSystemReduced(matches));

describe('animation setting', () => {
  it('offers standard, reduced and off as one named group with standard selected first', () => {
    mount();
    expect(motionGroup().props.role).toBe('group');
    expect(motionGroup().findAllByType('button').map(node => [node.children.join(''), node.props.type]))
      .toEqual([['標準', 'button'], ['控えめ', 'button'], ['オフ', 'button']]);
    expect(pressed()).toEqual(['標準']);
  });

  it('applies and stores a choice immediately', () => {
    mount();
    act(() => motionButton('オフ').props.onClick());
    expect(pressed()).toEqual(['オフ']);
    expect(env.storage.getItem(MOTION_STORAGE_KEY)).toBe('off');
    expect(env.root.dataset.motion).toBe('off');
    expect(sceneMotion().props.disabled).toBeFalsy();

    act(() => motionButton('標準').props.onClick());
    expect(env.root.dataset.motion).toBe('standard');
    expect(sceneMotion().props.disabled).toBeFalsy();
  });

  it('restores the stored choice on the next visit', () => {
    env.storage.setItem(MOTION_STORAGE_KEY, 'reduced');
    mount();
    expect(pressed()).toEqual(['控えめ']);
  });

  it('keeps the choice but explains when the device lowers standard to reduced', () => {
    mount();
    expect(renderer!.root.findAllByProps({ id: 'settings-motion-description' })).toHaveLength(0);
    setSystemReduced(true);
    expect(pressed()).toEqual(['標準']);
    expect(motionGroup().props['aria-describedby']).toBe('settings-motion-description');
    expect(renderer!.root.findByProps({ id: 'settings-motion-description' }).children.join('')).toContain('控えめ');
    expect(sceneMotion().props.disabled).toBeFalsy();
    // The illustration choice stays editable and stored; the level only pauses it.
    expect(sceneMotion().props.checked).toBe(true);

    setSystemReduced(false);
    expect(renderer!.root.findAllByProps({ id: 'settings-motion-description' })).toHaveLength(0);
    expect(sceneMotion().props.disabled).toBeFalsy();
  });

  it('announces a refused save and keeps the previous choice selected', () => {
    mount();
    env.storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    act(() => motionButton('控えめ').props.onClick());
    expect(pressed()).toEqual(['標準']);
    expect(renderer!.root.findAllByProps({ role: 'alert' }).map(node => node.children.join('')).join(''))
      .toContain('アニメーションの設定を保存できませんでした');
  });
});
