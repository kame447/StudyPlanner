import { HomeDisplayClockProvider } from './home/HomeDisplayClockContext';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScheduleView } from './HomeScheduleView';
import { HomeTopbar } from './HomeTopbar';
import { HomeView } from './HomeView';
import { HomeSceneAtmosphereProvider } from './home/HomeSceneAtmosphereContext';
import { addDays } from '../lib/date';
import * as scheduleProjection from '../lib/homeScheduleAugmentation';
import type { Actual, MonthEvent, Plan, ScheduleTemplate, TimetableTerm, User } from '../types/domain';

const noop = () => {};
const empty: [] = [];
const ref = { current: null };
const user: User = { id: 'clock-user', email: 'clock@example.test', username: 'Clock', avatar: '', createdAt: '' };
const opened = vi.fn();
function plan(id: string, date: string, startTime: string, endTime: string, overrides: Partial<Plan> = {}): Plan {
  return { id, seriesId: id, userId: user.id, title: id, date, startTime, endTime, subject: 'Math', type: 'study',
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '', ...overrides };
}
interface Fixture {
  plans: Plan[];
  actuals?: Actual[];
  monthEvents?: MonthEvent[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTerms?: TimetableTerm[];
}
let renderer: ReactTestRenderer | undefined;
let browserWindow: EventTarget;
let browserDocument: EventTarget & { visibilityState: string };
function home(fixture: Fixture, showHome = true) {
  return <StrictMode><HomeDisplayClockProvider><HomeSceneAtmosphereProvider>
    <HomeTopbar user={user} plans={fixture.plans} actuals={fixture.actuals ?? empty} todos={empty} onOpenProfile={noop} onOpenSettings={noop} />
    {showHome ? <HomeScheduleView userId={user.id} homeScenePreferences={{ style: 'pixel', animated: false }}
      plans={fixture.plans} actuals={fixture.actuals ?? empty} todos={empty} studyMaterials={empty}
      monthEvents={fixture.monthEvents ?? empty} scheduleTemplates={fixture.scheduleTemplates ?? empty}
      timetableTermId="term" timetableTerm={fixture.timetableTerms?.[0]} timetableTerms={fixture.timetableTerms ?? empty}
      primaryHeaderRef={ref} primaryBottomNavRef={ref} onOpenAiPlanning={noop} onOpenSchedule={noop}
      onAddEntry={noop} onOpenDay={opened} onOpenTodo={noop} onOpenBookshelf={noop} onOpenReport={noop} /> : null}
  </HomeSceneAtmosphereProvider></HomeDisplayClockProvider></StrictMode>;
}
function state() {
  const root = renderer!.root;
  const today = root.findByProps({ 'data-home-section': 'today-schedule' });
  return {
    date: root.findByProps({ className: 'home-date-display' }).props.dateTime,
    rows: today.findAllByProps({ className: 'home-schedule-row' }).map(row => row.findByType('strong').children.join('')),
    next: root.findByProps({ 'data-home-section': 'next-plan' }).findByType('h1').children.join(''),
    sky: root.findByProps({ className: 'home-study-scene' }).props['data-scene-period'],
  };
}
function openAllToday() {
  const section = renderer!.root.findByProps({ 'data-home-section': 'today-schedule' });
  const button = section.findAllByType('button').find(node => node.children.includes('すべて見る '))!;
  act(() => button.props.onClick());
  return opened.mock.calls[opened.mock.calls.length - 1]?.[0];
}
function mount(fixture: Fixture) { act(() => { renderer = create(home(fixture)); }); }
function midnightFixture(date = '2026-10-07'): Fixture {
  return { plans: [plan('yesterday-last', date, '23:00', '24:00'), plan('today-first', addDays(date, 1), '08:00', '09:00')] };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T23:59:30'));
  opened.mockClear();
  browserWindow = Object.assign(new EventTarget(), { requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, setInterval, clearInterval });
  browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible', fonts: { ready: Promise.resolve() } });
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', browserDocument);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('live Home display with stable input arrays', () => {
  it.each(['2026-10-07', '2026-10-11', '2026-10-31', '2026-12-31'])(
    'moves header, today rows, next plan and day navigation together after %s', date => {
      vi.setSystemTime(new Date(`${date}T23:59:30`));
      const fixture = midnightFixture(date);
      const original = JSON.stringify(fixture);
      mount(fixture);
      expect(state()).toEqual({ date, rows: ['yesterday-last'], next: 'yesterday-last', sky: 'night' });
      expect(openAllToday()).toBe(date);
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(state()).toEqual({ date: addDays(date, 1), rows: ['today-first'], next: 'today-first', sky: 'night' });
      expect(openAllToday()).toBe(addDays(date, 1));
      expect(JSON.stringify(fixture)).toBe(original);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it('advances the next plan at its same-day end without rebuilding the date projection', () => {
    vi.setSystemTime(new Date('2026-10-07T16:59:30'));
    const fixture = { plans: [plan('ends-at-17', '2026-10-07', '16:00', '17:00'), plan('next-at-18', '2026-10-07', '18:00', '19:00')] };
    const projection = vi.spyOn(scheduleProjection, 'augmentHomePlansWithScheduleOccurrences');
    mount(fixture);
    const projectedPlans = renderer!.root.findByType(HomeView).props.plans;
    expect(state().next).toBe('ends-at-17');
    projection.mockClear();
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(state().next).toBe('ends-at-17');
    act(() => { vi.advanceTimersByTime(1); });
    expect(state()).toEqual({ date: '2026-10-07', rows: ['ends-at-17', 'next-at-18'], next: 'next-at-18', sky: 'sunset' });
    expect(projection).not.toHaveBeenCalled();
    expect(renderer!.root.findByType(HomeView).props.plans).toBe(projectedPlans);
    expect(openAllToday()).toBe('2026-10-07');
  });

  it.each(['visibilitychange', 'focus', 'pageshow'])('refreshes an overnight hidden page on %s without duplicate timers', event => {
    mount(midnightFixture());
    browserDocument.visibilityState = 'hidden';
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(8 * 3_600_000 + 30_000); });
    expect(state().date).toBe('2026-10-07');
    browserDocument.visibilityState = 'visible';
    const target = event === 'visibilitychange' ? browserDocument : browserWindow;
    for (let index = 0; index < 3; index += 1) {
      act(() => { target.dispatchEvent(new Event(event)); });
      expect(state()).toEqual({ date: '2026-10-08', rows: ['today-first'], next: 'today-first', sky: 'day' });
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(openAllToday()).toBe('2026-10-08');
  });

  it('keeps the persistent header current while Home is unmounted, then returns consistently', () => {
    const fixture = midnightFixture();
    mount(fixture);
    act(() => renderer!.update(home(fixture, false)));
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(renderer!.root.findByProps({ className: 'home-date-display' }).props.dateTime).toBe('2026-10-08');
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer!.update(home(fixture)));
    expect(state()).toEqual({ date: '2026-10-08', rows: ['today-first'], next: 'today-first', sky: 'night' });
    expect(openAllToday()).toBe('2026-10-08');
    act(() => renderer!.unmount()); renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date('2026-10-08T08:00:00'));
    mount(fixture);
    expect(state()).toEqual({ date: '2026-10-08', rows: ['today-first'], next: 'today-first', sky: 'day' });
    expect(vi.getTimerCount()).toBe(1);
  });


  it('preserves recurrence exclusions and occurrence-specific actuals without borrowing future rows', () => {
    const recurring = plan('daily-study', '2026-10-07', '08:00', '09:00', { repeat: 'daily', repeatUntil: '2026-10-12' });
    const excluded = plan('excluded-today', '2026-10-07', '10:00', '11:00', { repeat: 'daily', excludedDates: ['2026-10-08'] });
    const actual: Actual = { id: 'yesterday-actual', userId: user.id, planId: recurring.id, occurrenceDate: '2026-10-07',
      actualStartTime: '08:00', actualEndTime: '09:00', title: recurring.title, subject: recurring.subject, note: '', updatedAt: '' };
    const fixture = { plans: [recurring, excluded, plan('future-only', '2026-10-10', '12:00', '13:00')], actuals: [actual] };
    const original = JSON.stringify(fixture);
    mount(fixture);
    const today = () => renderer!.root.findByProps({ 'data-home-section': 'today-schedule' });
    expect(today().findAllByProps({ className: 'home-time-dot completed' })).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(state().rows).toEqual(['daily-study']);
    expect(state().next).toBe('daily-study');
    expect(today().findAllByProps({ className: 'home-time-dot completed' })).toHaveLength(0);
    expect(openAllToday()).toBe('2026-10-08');
    expect(JSON.stringify(fixture)).toBe(original);
  });

  it('rebuilds timetable and month-event projection after an absence beyond the old range', () => {
    vi.setSystemTime(new Date('2026-10-01T08:00:00'));
    const timetableTerm: TimetableTerm = { id: 'term', userId: user.id, year: 2026, kind: 'custom', label: 'Term',
      startDate: '2026-10-01', endDate: '2026-10-31', isActive: true, createdAt: '', updatedAt: '' };
    const template: ScheduleTemplate = { id: 'class', userId: user.id, title: 'Thursday class', subject: 'Math', type: 'school-event', weekday: 'thu',
      startTime: '10:00', endTime: '11:00', termId: 'term', periodNumber: 1, classroom: '', memo: '', active: true, createdAt: '', updatedAt: '' };
    const event: MonthEvent = { id: 'meeting', userId: user.id, date: '2026-10-15', title: 'October meeting', startTime: '12:00', endTime: '13:00',
      repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
    const fixture = { plans: empty, scheduleTemplates: [template], timetableTerms: [timetableTerm], monthEvents: [event] };
    mount(fixture);
    expect(state().rows).toEqual(['Thursday class']);
    browserDocument.visibilityState = 'hidden';
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    vi.setSystemTime(new Date('2026-10-15T08:00:00'));
    browserDocument.visibilityState = 'visible';
    act(() => { browserWindow.dispatchEvent(new Event('pageshow')); });
    expect(state().rows).toEqual(['Thursday class', 'October meeting']);
    expect(state().next).toBe('Thursday class');
    expect(openAllToday()).toBe('2026-10-15');
  });
});
