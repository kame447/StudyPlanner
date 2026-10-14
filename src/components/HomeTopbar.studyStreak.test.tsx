import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeTopbar } from './HomeTopbar';
vi.mock('./AnnouncementsButton', () => ({ AnnouncementsButton: () => null }));

let renderer: ReactTestRenderer | undefined;
afterEach(() => act(() => renderer?.unmount()));
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
    const plans: [] = []; const actuals: [] = [];
    const summary = { userId: user.id, today: '2026-10-14', plans, actuals, currentStreak: 7, bestStreak: 7 };
    const render = (streakSummary: typeof summary) => <HomeTopbar user={user} plans={plans} actuals={actuals}
      todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()} streakSummary={streakSummary} />;
    act(() => { renderer = create(render(summary)); });
    expect(renderer!.root.findByProps({ className: 'home-streak-card' }).props['aria-label']).toContain('連続学習 7日');
    for (const invalid of [{ ...summary, userId: 'other' }, { ...summary, today: '2026-10-13' },
      { ...summary, plans: [] as [] }, { ...summary, actuals: [] as [] }]) {
      act(() => renderer!.update(render(invalid)));
      expect(renderer!.root.findByProps({ className: 'home-streak-card' }).props['aria-label']).toContain('連続学習 未確認');
    }
  } finally { vi.useRealTimers(); }
});
