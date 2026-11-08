import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { WeeklyPlanningPersonalizationProvider } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import {
  createConfirmedDefaultStudyModeFact, createConfirmedWeekStartFact, createEmptyWeeklyPlanningPersonalizationProfile,
  type DefaultStudyMode,
} from '../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationTypes';
import { DefaultStudyModeSetting } from './DefaultStudyModeSetting';

const STAMP = '2026-11-08T00:00:00.000Z';
let renderer: ReactTestRenderer | undefined;
const setDefaultStudyMode = vi.fn(async (_value: DefaultStudyMode) => true);

function show(saved?: DefaultStudyMode) {
  setDefaultStudyMode.mockClear();
  const profile = {
    ...createEmptyWeeklyPlanningPersonalizationProfile(STAMP),
    weekStartsOn: createConfirmedWeekStartFact('monday', STAMP),
    ...(saved ? { defaultStudyMode: createConfirmedDefaultStudyModeFact(saved, STAMP) } : {}),
  };
  act(() => {
    renderer = create(
      <WeeklyPlanningPersonalizationProvider profile={profile} setWeekStartsOn={async () => true}
        setDefaultStudyMode={setDefaultStudyMode} resetProfile={async () => true}>
        <DefaultStudyModeSetting />
      </WeeklyPlanningPersonalizationProvider>,
    );
  });
}
const button = (text: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(text));
const click = (text: string) => act(() => { button(text)!.props.onClick(); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it('shows the normal timer as selected when nothing is saved, and hides the pomodoro length', () => {
  show();
  expect(button('通常タイマー')!.props['aria-pressed']).toBe(true);
  expect(button('ポモドーロ')!.props['aria-pressed']).toBe(false);
  expect(button('25分 / 5分')).toBeUndefined();
});

it('saves the pomodoro as the default, keeping the saved length', () => {
  show({ mode: 'normal', pomodoro: { preset: '50-10' } });
  click('ポモドーロ');
  expect(setDefaultStudyMode).toHaveBeenCalledExactlyOnceWith({ mode: 'pomodoro', pomodoro: { preset: '50-10' } });
});

it('saves a preset length and returns to the normal timer', () => {
  show({ mode: 'pomodoro', pomodoro: { preset: '25-5' } });
  click('50分 / 10分');
  expect(setDefaultStudyMode).toHaveBeenLastCalledWith({ mode: 'pomodoro', pomodoro: { preset: '50-10' } });
  click('通常タイマー');
  expect(setDefaultStudyMode).toHaveBeenLastCalledWith({ mode: 'normal', pomodoro: { preset: '25-5' } });
});

it('saves a custom length only when both minutes are whole numbers from 1 to 1440', () => {
  show({ mode: 'pomodoro', pomodoro: { preset: '25-5' } });
  click('カスタム');
  const input = (label: string) => renderer!.root.findByProps({ 'aria-label': label, type: 'number' });
  act(() => { input('集中（分）').props.onChange({ target: { value: '40' } }); });
  act(() => { input('休憩（分）').props.onChange({ target: { value: '0' } }); });
  expect(button('保存')!.props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ role: 'alert' })).toBeDefined();
  act(() => { input('休憩（分）').props.onChange({ target: { value: '8' } }); });
  click('保存');
  expect(setDefaultStudyMode).toHaveBeenCalledExactlyOnceWith({
    mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 40, customBreakMinutes: 8 },
  });
});
