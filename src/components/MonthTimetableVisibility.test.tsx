import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { AppSettingsDialog } from './AppSettingsDialog';
import { MonthDaySheet } from './MonthDaySheet';
import type { Plan, ScheduleTemplate, TimetableTerm } from '../types/domain';

it('connects the accessible setting to its boolean callback', () => {
  const onChange = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AppSettingsDialog open themeMode="light" themePalette="forest"
    onChangeTheme={vi.fn()} onChangeThemePalette={vi.fn()} onClose={vi.fn()}
    showMonthTimetable={false} onChangeMonthTimetable={onChange} />); });
  const show = renderer.root.findAllByType('button').find(button => button.children.includes('表示する'))!;
  expect(show.props['aria-pressed']).toBe(false);
  act(() => show.props.onClick());
  expect(onChange).toHaveBeenCalledWith(true);
  act(() => renderer.unmount());
});

it('updates an open month day sheet while retaining saved timetable plans', () => {
  const base = { userId: 'owner', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
  const term: TimetableTerm = { ...base, id: 'term', year: 2026, kind: 'custom', label: '学期',
    startDate: '2026-10-01', endDate: '2026-10-31', isActive: true };
  const template: ScheduleTemplate = { ...base, id: 'auto', title: '取り込み済み授業', subject: '授業', type: 'school-event',
    weekday: 'mon', startTime: '10:00', endTime: '11:00', termId: term.id, periodNumber: 1,
    classroom: '', memo: '', active: true };
  const saved: Plan = { ...base, id: 'saved', seriesId: 'saved', title: '保存済み授業', subject: '授業',
    type: 'school-event', date: '2026-10-05', startTime: '14:00', endTime: '15:00', repeat: 'none',
    repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', sourceType: 'timetable', sourceId: 'auto' };
  const props = { openDate: '2026-10-05', userId: 'owner', plans: [saved], monthEvents: [],
    scheduleTemplates: [template, { ...template, id: 'unimported', title: '自動授業' }], timetableTerm: term, timetableTermId: term.id, timetableTerms: [term],
    onCreate: vi.fn(), onEdit: vi.fn(), onOpenDay: vi.fn(), onClose: vi.fn() };
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<MonthDaySheet {...props} />); });
  expect(JSON.stringify(renderer.toJSON())).toContain('自動授業');
  for (const showTimetable of [false, true, false]) {
    act(() => renderer.update(<MonthDaySheet {...props} showTimetable={showTimetable} />));
    const json = JSON.stringify(renderer.toJSON());
    expect(json.includes('自動授業')).toBe(showTimetable);
    expect(json).toContain('保存済み授業');
    expect(json).not.toContain('取り込み済み授業');
  }
  act(() => renderer.unmount());
});

it('keeps the day and month settings independently accessible', () => {
  const onDay = vi.fn(), onMonth = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AppSettingsDialog open themeMode="light" themePalette="forest"
    onChangeTheme={vi.fn()} onChangeThemePalette={vi.fn()} onClose={vi.fn()}
    showMonthTimetable showDayTimetable={false} onChangeMonthTimetable={onMonth} onChangeDayTimetable={onDay} />); });
  const day = renderer.root.findByProps({ role: 'group', 'aria-labelledby': 'day-timetable-label' });
  const month = renderer.root.findByProps({ role: 'group', 'aria-labelledby': 'month-timetable-label' });
  expect(day.findAllByType('button')[0].props['aria-pressed']).toBe(false);
  expect(month.findAllByType('button')[0].props['aria-pressed']).toBe(true);
  act(() => day.findAllByType('button')[0].props.onClick());
  expect(onDay).toHaveBeenCalledWith(true); expect(onMonth).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});
