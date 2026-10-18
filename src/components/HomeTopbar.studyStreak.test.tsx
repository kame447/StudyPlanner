import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeTopbar } from './HomeTopbar';
import { actual, event } from '../repositories/localPersistenceConcurrency.testUtils';
import type { useSharedStudyStreak } from './StudyStreakContext';
vi.mock('./AnnouncementsButton', () => ({ AnnouncementsButton: () => null }));
const shared = vi.hoisted(() => ({ value: null as ReturnType<typeof useSharedStudyStreak> }));
vi.mock('./StudyStreakContext', () => ({ useSharedStudyStreak: () => shared.value }));

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); shared.value = null; });
it('opens learning records from a semantic button and focuses the origin before navigation', () => {
  const actions: string[] = [];
  act(() => { renderer = create(<HomeTopbar user={{ id: 'owner', username: 'User', email: '', avatar: '', createdAt: '' }}
    plans={[]} actuals={[]} todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()}
    onOpenStudyStreak={() => actions.push('open')} />); });
  const button = renderer!.root.findByProps({ className: 'home-streak-card' });
  expect(button.type).toBe('button');
  expect(button.props['aria-label']).toBe('連続学習 未確認、学習記録を開く');
  act(() => button.props.onClick({ currentTarget: { focus: () => actions.push('focus') } }));
  expect(actions).toEqual(['focus', 'open']);
});

it('only displays a verified rest-day summary for the same owner, day and record inputs', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00'));
  try {
    const user = { id: 'owner', username: 'User', email: '', avatar: '', createdAt: '' };
    const plans: [] = []; const actuals: [] = []; const monthEvents: [] = [];
    const model = { today: '2026-10-14', historyComplete: true, currentStreak: 7, bestStreak: 7, studyDates: [], protectedDates: [], unprotectedRestDates: [], earnedTicketDates: [], earnedTickets: 1, usedTickets: 1, availableTickets: 0, studyDaysTowardNextTicket: 0 };
    const summary = { userId: user.id, today: '2026-10-14', plans, actuals, monthEvents, displayModel: model,
      controller: { status: 'ready' as const, model, refreshing: false, saving: false, readError: null, saveError: null, retry: vi.fn() } };
    const render = (value: typeof summary) => {
      shared.value = value;
      return <HomeTopbar user={user} plans={plans} actuals={actuals} monthEvents={monthEvents}
        todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()} />;
    };
    act(() => { renderer = create(render(summary)); });
    expect(renderer!.root.findByProps({ className: 'home-streak-card' }).props['aria-label']).toContain('連続学習 7日');
    for (const invalid of [{ ...summary, userId: 'other' }, { ...summary, today: '2026-10-13' },
      { ...summary, plans: [] as [] }, { ...summary, actuals: [] as [] }, { ...summary, monthEvents: [] as [] },
      { ...summary, controller: { ...summary.controller, model: { ...model, today: '2026-10-13' } } }]) {
      act(() => renderer!.update(render(invalid)));
      expect(renderer!.root.findByProps({ className: 'home-streak-card' }).props['aria-label']).toContain('連続学習 未確認');
    }
  } finally { vi.useRealTimers(); }
});

it('animates only qualifying real study today and follows owner, correction and date changes', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00'));
  try {
    const user = { id: 'owner', username: 'User', email: '', avatar: '', createdAt: '' };
    const actual = { id: 'today', userId: 'owner', planId: null, occurrenceDate: '2026-10-14',
      actualStartTime: '09:00', actualEndTime: '09:30', title: 'Study', subject: '', note: '', updatedAt: '' };
    const render = (actuals = [actual]) => <HomeTopbar user={user} plans={[]} actuals={actuals}
      todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()} />;
    const moving = () => renderer!.root.findAllByType('svg').find(node => node.props.className.includes('home-streak-flame'))!.props.className.includes('is-studied-today');
    act(() => { renderer = create(render()); });
    expect(moving()).toBe(true);
    for (const invalid of [{ ...actual, actualEndTime: '09:00' }, { ...actual, userId: 'other' },
      { ...actual, occurrenceDate: '2026-10-15' }]) {
      act(() => renderer!.update(render([invalid])));
      expect(moving()).toBe(false);
    }
    act(() => renderer!.update(render()));
    expect(moving()).toBe(true);
    vi.setSystemTime(new Date('2026-10-15T00:01:00'));
    act(() => renderer!.update(render()));
    expect(moving()).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('keeps the fallback today flame off for a major-event Actual while preserving actual study', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T22:00:00'));
  try {
    const user = { id: 'owner', username: 'User', email: '', avatar: '', createdAt: '' };
    const monthEvents = [event({ id: 'job' })];
    const jobActual = actual({ planId: 'job', occurrenceDate: '2026-10-14' });
    const render = (actuals = [jobActual]) => <HomeTopbar user={user} plans={[]} actuals={actuals} monthEvents={monthEvents}
      todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()} />;
    const moving = () => renderer!.root.findAllByType('svg').find(node => node.props.className.includes('home-streak-flame'))!.props.className.includes('is-studied-today');
    act(() => { renderer = create(render()); });
    expect(moving()).toBe(false);
    act(() => renderer!.update(render([jobActual, actual({ id: 'real', planId: null, occurrenceDate: '2026-10-14' })])));
    expect(moving()).toBe(true);
  } finally { vi.useRealTimers(); }
});
