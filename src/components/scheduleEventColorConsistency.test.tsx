import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { augmentHomePlansWithScheduleOccurrences } from '../lib/homeScheduleAugmentation';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import { getSubjectTheme } from '../lib/subjectTheme';
import type { MonthEvent, Plan, ScheduleTemplate } from '../types/domain';
import { MonthGridPanel } from './MonthGridPanel';
import { MonthDaySheet } from './MonthDaySheet';
import { MonthEventDialog } from './MonthEventDialog';
import { WeekView } from './WeekView';
import { DayTimeline } from './DayTimeline';
import { TodayScheduleSection } from './home/HomeSections';

const DATE = '2026-10-15';
const renderers: ReactTestRenderer[] = [];
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); vi.unstubAllGlobals(); });
function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  renderers.push(renderer);
  return renderer;
}
function event(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return { id: 'shift-1', userId: 'owner', date: DATE, endDate: DATE, title: '塾バイト', startTime: '17:00', endTime: '21:30',
    repeat: 'weekly', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
    createdAt: '', updatedAt: '', ...overrides };
}
function nodeWithClass(root: ReactTestInstance, className: string, title: string) {
  return root.findAll(node => typeof node.type === 'string' && node.props.className?.split(' ').includes(className))
    .find(node => JSON.stringify(node.findAllByType('strong').flatMap(child => child.children)).includes(title)
      || node.props.title?.includes(title)
      || node.findAll(child => child.type === 'span' && child.children.includes(title)).length > 0)!;
}
function colors(monthEvents: MonthEvent[], date = DATE, plans: Plan[] = [], scheduleTemplates: ScheduleTemplate[] = []) {
  vi.unstubAllGlobals();
  const grid = render(<MonthGridPanel monthDate={date.slice(0, 7) + '-01'} isCurrent selectedDate={date} todayDate={date}
    userId="owner" plans={plans} actuals={[]} monthEvents={monthEvents} scheduleTemplates={scheduleTemplates} registerCellRef={vi.fn()} onCellClick={vi.fn()}
    onMoveSelection={vi.fn()} onOpenMonthEventEditor={vi.fn()} />);
  const sheet = render(<MonthDaySheet openDate={date} userId="owner" plans={plans} monthEvents={monthEvents}
    scheduleTemplates={scheduleTemplates} onCreate={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />);
  const editor = render(<MonthEventDialog openDate={date} initialEventId="shift-1" userId="owner" monthEvents={monthEvents}
    onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
  const week = render(<WeekView selectedDate={date} userId="owner" plans={plans} actuals={[]} monthEvents={monthEvents} scheduleTemplates={scheduleTemplates} onOpenDay={vi.fn()} />);
  const occurrences = createScheduleOccurrenceProjection({ ownerId: 'owner', startDate: date, endDate: date, plans, monthEvents, scheduleTemplates }).occurrences;
  const day = render(<DayTimeline dateLabel={date} plans={plans} monthEvents={monthEvents} scheduleOccurrences={occurrences} actuals={[]}
    onSelectEntry={vi.fn()} onPreviousDay={vi.fn()} onNextDay={vi.fn()} onPrint={vi.fn()} />);
  const homePlans = augmentHomePlansWithScheduleOccurrences({ ownerId: 'owner', plans, monthEvents, scheduleTemplates, startDate: date });
  const dashboard = buildHomeDashboardModel({ plans: homePlans, actuals: [], todos: [], now: new Date(date + 'T12:00:00') });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const home = render(<TodayScheduleSection dashboard={dashboard} studyMaterials={[]} onOpenDay={vi.fn()} onAddEntry={vi.fn()} />);
  return (title: string) => {
    const nodes = [
      nodeWithClass(grid.root, 'month-major-event-pill', title) ?? nodeWithClass(grid.root, 'month-range-segment', title),
      nodeWithClass(sheet.root, 'month-day-sheet-event', title),
      ...(monthEvents.some(item => item.title === title) ? [nodeWithClass(editor.root, 'month-event-timeline-item', title)] : []),
      nodeWithClass(week.root, 'schedule-week-block', title) ?? week.root.findAll(node => node.props['data-week-spanning-event'] === 'true' && node.props.title?.startsWith(title))[0],
      nodeWithClass(day.root, 'timeline-plan-block', title) ?? day.root.findAll(node => node.props['data-day-spanning-event'] === 'true' && node.props.title?.startsWith(title))[0],
      nodeWithClass(home.root, 'home-schedule-row', title),
    ];
    return nodes.map(node => { expect(node, `${title} is present on every surface`).toBeTruthy(); return node.props.style?.['--schedule-event-color']; });
  };
}

describe('saved event color consistency', () => {
  it('uses one nonempty accent across month, sheet, editor, week, day and home', () => {
    const values = colors([event(), event({ id: 'appointment', title: '先の予定', startTime: '15:00', endTime: '16:30' })])('塾バイト');
    expect(values[0]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(values).size).toBe(1);
  });
  it('keeps the same series accent when titles, neighbors, date and order change', () => {
    const original = colors([event()])('塾バイト')[0];
    const changed = colors([event({ title: '変更した予定', startTime: '08:00' }), event({ id: 'another', title: '別の予定', startTime: '06:00' })], '2026-10-22')('変更した予定');
    expect(original).toMatch(/^#/);
    expect(changed.every(value => value === original)).toBe(true);
  });
  it('keeps recurring multi-day bars on the same color authority', () => {
    const values = colors([event({ endDate: '2026-10-17' })], '2026-10-22')('塾バイト');
    expect(values[0]).toMatch(/^#/);
    expect(new Set(values).size).toBe(1);
  });
  it('uses the existing semantic subject color for plan-backed appointments', () => {
    const plan: Plan = { id: 'exam', seriesId: 'exam', userId: 'owner', date: DATE, title: '模試予定', subject: '模試',
      startTime: '08:00', endTime: '09:00', type: 'mock-exam', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '' };
    const values = colors([], DATE, [plan])('模試予定');
    expect(values).toEqual(Array(5).fill(getSubjectTheme('模試', 'mock-exam').fill));
  });
  it.each(['template', 'imported'] as const)('preserves the timetable semantic accent for %s classes', (backing) => {
    const template: ScheduleTemplate = {
      id: 'class-1', userId: 'owner', title: '情報学の授業', subject: '情報', type: 'school-event',
      weekday: 'thu', startTime: '08:00', endTime: '09:00', memo: '', active: true, createdAt: '', updatedAt: '',
    };
    const plan: Plan = {
      id: 'imported-class', seriesId: 'imported-class', userId: 'owner', date: DATE,
      title: template.title, subject: template.subject, type: 'school-event', startTime: '08:00', endTime: '09:00',
      repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '',
      sourceType: 'timetable', sourceId: template.id, sourceDate: DATE,
    };
    const values = colors([], DATE, backing === 'imported' ? [plan] : [], [template])(template.title);
    expect(values).toEqual(Array(5).fill(getSubjectTheme('情報', 'school-event', 'timetable').fill));
  });
});
