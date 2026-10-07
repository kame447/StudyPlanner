import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { Plan } from '../../types/domain';
import { buildHomeDashboardModel } from '../../lib/homeDashboard';
import { TodayScheduleSection } from './HomeSections';

it('offers an accessible plus without the empty explanation and separates viewing from adding', () => {
  const onAddEntry = vi.fn(); const onOpenDay = vi.fn();
  const dashboard = buildHomeDashboardModel({ plans: [], actuals: [], todos: [] });
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<TodayScheduleSection dashboard={dashboard} studyMaterials={[]}
    onAddEntry={onAddEntry} onOpenDay={onOpenDay} />); });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('今日の予定はまだありません');
  const add = renderer.root.findByProps({ 'aria-label': '今日の予定に追加' });
  act(() => add.props.onClick());
  expect(onAddEntry).toHaveBeenCalledOnce(); expect(onOpenDay).not.toHaveBeenCalled();
  const all = renderer.root.findAllByType('button').find(button => button !== add)!;
  act(() => all.props.onClick()); expect(onOpenDay).toHaveBeenCalledWith(dashboard.today);
  act(() => renderer.unmount());
});

function plan(id: string, date: string, overrides: Partial<Plan> = {}): Plan {
  return {
    id, seriesId: id, userId: 'today-user', title: id, subject: '数学', date,
    startTime: '10:20', endTime: '11:50', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

it.each([0, 1, 2, 3, 4, 5])('renders only today with %i current-day plans, without filling from future dates', (count) => {
  const today = '2026-10-08';
  const current = Array.from({ length: count }, (_, index) => plan(`today-${index}`, today));
  const plans = [
    plan('previous-day', '2026-10-07'), ...current,
    plan('next-day', '2026-10-09'),
    plan('将来の授業A', '2026-10-12', { startTime: '08:40', endTime: '11:50', type: 'school-event' }),
    plan('将来の授業B', '2026-10-12', { startTime: '12:45', endTime: '14:15', type: 'school-event' }),
  ];
  const original = JSON.stringify(plans);
  const dashboard = buildHomeDashboardModel({ plans, actuals: [], todos: [], now: new Date(2026, 9, 8, 1, 7) });
  const onOpenDay = vi.fn(); const onAddEntry = vi.fn();
  // This is a renderer boundary regression: the domain collection is already correct.
  expect(dashboard.today).toBe(today);
  expect(dashboard.todayPlans.map(item => item.id)).toEqual(current.map(item => item.id));
  expect(dashboard.upcomingPlans.length).toBeGreaterThan(0);
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<TodayScheduleSection dashboard={dashboard} studyMaterials={[]}
    onOpenDay={onOpenDay} onAddEntry={onAddEntry} />); });
  try {
    const rows = renderer.root.findAllByType('button').filter(button => button.props.className?.split(' ').includes('home-schedule-row'));
    expect(rows.map(row => row.findByType('strong').children.join(''))).toEqual(current.map(item => item.id));
    for (const row of rows) act(() => row.props.onClick());
    expect(onOpenDay.mock.calls).toEqual(current.map(() => [today]));
    const add = renderer.root.findByProps({ 'aria-label': '今日の予定に追加' });
    act(() => add.props.onClick());
    expect(onAddEntry).toHaveBeenCalledOnce();
    const all = renderer.root.findAllByType('button').find(button => button.children.includes('すべて見る '))!;
    act(() => all.props.onClick());
    expect(onOpenDay).toHaveBeenLastCalledWith(today);
    expect(renderer.root.findAllByProps({ className: 'home-scroll-hint' })).toHaveLength(count > 4 ? 1 : 0);
    expect(JSON.stringify(plans)).toBe(original);
  } finally {
    act(() => renderer.unmount());
  }
});

it('keeps only today’s recurring occurrence and its matching completion mark', () => {
  const today = '2026-10-08';
  const dashboard = buildHomeDashboardModel({
    plans: [
      plan('daily', '2026-10-01', { repeat: 'daily', repeatUntil: '2026-10-12' }),
      plan('excluded', '2026-10-01', { repeat: 'daily', excludedDates: [today] }),
      plan('weekly-other-day', '2026-10-05', { repeat: 'weekly' }),
    ],
    actuals: [{
      id: 'actual-today', userId: 'today-user', planId: 'daily', occurrenceDate: today,
      actualStartTime: '10:20', actualEndTime: '11:50', subject: '数学', note: '',
      updatedAt: '2026-10-08T03:00:00.000Z',
    }],
    todos: [], now: new Date(2026, 9, 8, 13),
  });
  expect(dashboard.todayPlans.map(item => [item.id, item.date])).toEqual([['daily', today]]);
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<TodayScheduleSection dashboard={dashboard} studyMaterials={[]}
    onOpenDay={vi.fn()} onAddEntry={vi.fn()} />); });
  try {
    const rows = renderer.root.findAllByType('button').filter(button => button.props.className?.split(' ').includes('home-schedule-row'));
    expect(rows).toHaveLength(1);
    expect(rows[0].findByType('strong').children).toEqual(['daily']);
    expect(rows[0].findAllByProps({ className: 'home-time-dot completed' })).toHaveLength(1);
  } finally {
    act(() => renderer.unmount());
  }
});

it('uses local occurrence dates before and after midnight without carrying other days into the list', () => {
  const plans = [
    plan('October 7', '2026-10-07'),
    plan('October 8', '2026-10-08'),
    plan('October 12', '2026-10-12'),
  ];
  const before = buildHomeDashboardModel({ plans, actuals: [], todos: [], now: new Date(2026, 9, 7, 23, 59) });
  const after = buildHomeDashboardModel({ plans, actuals: [], todos: [], now: new Date(2026, 9, 8, 0, 1) });
  const render = (dashboard: typeof before) => <TodayScheduleSection dashboard={dashboard} studyMaterials={[]}
    onOpenDay={vi.fn()} onAddEntry={vi.fn()} />;
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(render(before)); });
  try {
    const titles = () => renderer.root.findAllByType('strong').map(item => item.children.join(''));
    expect(before.today).toBe('2026-10-07');
    expect(titles()).toEqual(['October 7']);
    act(() => renderer.update(render(after)));
    expect(after.today).toBe('2026-10-08');
    expect(titles()).toEqual(['October 8']);
  } finally {
    act(() => renderer.unmount());
  }
});
