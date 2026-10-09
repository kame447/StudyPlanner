import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { AppSettingsDialog } from './AppSettingsDialog';

it('wires independent accessible day and month settings through the settings dialog', () => {
  const day = vi.fn(); const month = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AppSettingsDialog open themeMode="light" themePalette="forest"
    onChangeTheme={vi.fn()} onChangeThemePalette={vi.fn()} onClose={vi.fn()}
    showDayTimetable={false} onChangeDayTimetable={day} dayTimetableError="保存失敗"
    showMonthTimetable onChangeMonthTimetable={month} />); });
  const group = (id: string) => renderer.root.findByProps({ role: 'group', 'aria-labelledby': id });
  const dayButtons = group('day-timetable-label').findAllByType('button');
  expect(dayButtons.map(button => button.props['aria-pressed'])).toEqual([false, true]);
  expect(group('month-timetable-label').findAllByType('button').map(button => button.props['aria-pressed'])).toEqual([true, false]);
  act(() => dayButtons[0].props.onClick());
  expect(day).toHaveBeenCalledWith(true); expect(month).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['保存失敗']);
  act(() => renderer.unmount());
});


it('keeps Day and Month choices independent from the combined appearance controls', () => {
  const day = vi.fn(); const month = vi.fn(); const appearance = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AppSettingsDialog open themeMode="light" themePalette="forest"
    onChangeTheme={vi.fn()} onChangeThemePalette={vi.fn()} onClose={vi.fn()}
    showDayTimetable={false} onChangeDayTimetable={day} showMonthTimetable onChangeMonthTimetable={month}
    appearance="pixel" onChangeAppearance={appearance} />); });
  try {
    const group = (id: string) => renderer.root.findByProps({ role: 'group', 'aria-labelledby': id }).findAllByType('button');
    expect(group('settings-appearance-label').map(button => button.props['aria-pressed'])).toEqual([false, true]);
    act(() => group('settings-appearance-label')[0].props.onClick());
    expect(appearance).toHaveBeenCalledWith('standard');
    expect(day).not.toHaveBeenCalled(); expect(month).not.toHaveBeenCalled();
    expect(group('day-timetable-label').map(button => button.props['aria-pressed'])).toEqual([false, true]);
    expect(group('month-timetable-label').map(button => button.props['aria-pressed'])).toEqual([true, false]);
    act(() => group('day-timetable-label')[0].props.onClick());
    expect(day).toHaveBeenCalledWith(true); expect(month).not.toHaveBeenCalled();
    expect(appearance).toHaveBeenCalledTimes(1);
  } finally { act(() => renderer.unmount()); }
});
