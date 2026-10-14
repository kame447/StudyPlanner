import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyStreakPage } from './StudyStreakPage';
import { StudyStreakProvider } from './StudyStreakContext';
import { StudyStreakView } from './StudyStreakView';
import type { Actual, Plan } from '../types/domain';
import type { StudyStreakHistory } from '../repositories/studyStreakRepository';

const repository = vi.hoisted(() => ({ canUseRestDays: true, read: vi.fn(), useRestDay: vi.fn() }));
vi.mock('../repositories', () => ({ studyStreakRepository: repository }));
const actuals: Actual[] = Array.from({ length: 7 }, (_, index) => ({ id: `study-${index}`, userId: 'owner', planId: null,
  occurrenceDate: `2026-08-${11 + index}`, actualStartTime: '09:00', actualEndTime: '09:30', title: 'English', subject: '英語', note: '', updatedAt: '' }));
const plans: Plan[] = [];
const history: StudyStreakHistory = { userId: 'owner', plans, actuals, restDays: [], historyComplete: true };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T10:00:00'));
  repository.canUseRestDays = true;
  repository.read.mockReset().mockResolvedValue(history);
  repository.useRestDay.mockReset().mockImplementation(async (current: StudyStreakHistory, date: string) => ({ ...current, restDays: [...current.restDays, { date }] }));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!;
const screen = (open = true) => <StudyStreakProvider userId="owner" plans={plans} actuals={actuals}>{open && <StudyStreakPage onClose={vi.fn()} />}</StudyStreakProvider>;

it('automatically protects yesterday on Home and reuses the same reader when detail opens again', async () => {
  await act(async () => { renderer = create(screen(false)); });
  expect(repository.read).toHaveBeenCalledTimes(1);
  expect(repository.useRestDay).toHaveBeenCalledWith(history, '2026-08-18', '2026-08-19', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await act(async () => renderer!.update(screen()));
  expect(renderer!.root.findByType(StudyStreakView).props.model).toMatchObject({ availableTickets: 0, currentStreak: 7, protectedDates: ['2026-08-18'] });
  await act(async () => renderer!.update(screen(false)));
  await act(async () => renderer!.update(screen()));
  expect(repository.read).toHaveBeenCalledTimes(1);
  expect(repository.useRestDay).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findAllByType('input')).toHaveLength(0);
});

it('keeps unknown history distinct from zero and retries without exposing manual actions', async () => {
  repository.read.mockRejectedValue(new Error('学習履歴を読み込めませんでした。'));
  await act(async () => { renderer = create(screen()); });
  const view = renderer!.root.findByType(StudyStreakView);
  expect(view.props.model.currentStreak).toBeNull();
  expect(view.props.error).toBe('学習履歴を読み込めませんでした。');
  expect(repository.useRestDay).not.toHaveBeenCalled();
  repository.read.mockResolvedValueOnce(history);
  await act(async () => button('再読み込み').props.onClick());
  expect(renderer!.root.findByType(StudyStreakView).props.model.availableTickets).toBe(0);
});

it('retains acknowledged history and the selected month when automatic saving fails', async () => {
  repository.useRestDay.mockRejectedValue(new Error('保存できませんでした。'));
  await act(async () => { renderer = create(screen()); });
  const view = renderer!.root.findByType(StudyStreakView);
  expect(view.props.model).toMatchObject({ availableTickets: 1, protectedDates: [] });
  expect(view.props.error).toBe('保存できませんでした。');
  const previous = renderer!.root.findByProps({ 'aria-label': '前の月' });
  act(() => previous.props.onClick());
  repository.useRestDay.mockImplementation(async (current: StudyStreakHistory, date: string) => ({ ...current, restDays: [{ date }] }));
  await act(async () => button('再読み込み').props.onClick());
  expect(renderer!.root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年7月']);
  expect(renderer!.root.findByType(StudyStreakView).props.model.availableTickets).toBe(0);
});

it('waits for the initial planner snapshot and offers planner recovery without a duplicate history read', async () => {
  const recover = vi.fn();
  const render = (active: boolean, blockedError: string | null = null) => <StudyStreakProvider userId="owner" plans={plans} actuals={actuals}
    active={active} blockedError={blockedError} onRetryBlocked={recover}><StudyStreakPage onClose={vi.fn()} /></StudyStreakProvider>;
  await act(async () => { renderer = create(render(false)); });
  expect(repository.read).not.toHaveBeenCalled();
  expect(renderer!.root.findByType(StudyStreakView).props.pending).toBe(true);
  await act(async () => renderer!.update(render(false, '学習履歴を読み込めませんでした。')));
  expect(renderer!.root.findByType(StudyStreakView).props.pending).toBe(false);
  act(() => button('再読み込み').props.onClick());
  expect(recover).toHaveBeenCalledTimes(1);
  expect(repository.read).not.toHaveBeenCalled();
  await act(async () => renderer!.update(render(true)));
  expect(repository.read).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByType(StudyStreakView).props.model.currentStreak).toBe(7);
});
