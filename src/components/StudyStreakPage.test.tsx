import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyStreakPage } from './StudyStreakPage';
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
  repository.useRestDay.mockReset().mockImplementation(async (current: StudyStreakHistory, date: string) => ({ ...current, restDays: [{ date }] }));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!;

it('connects complete history and manual use, then publishes a verified summary for the matching input', async () => {
  const onSummaryChange = vi.fn();
  await act(async () => { renderer = create(<StudyStreakPage userId="owner" plans={plans} actuals={actuals}
    onClose={vi.fn()} onSummaryChange={onSummaryChange} />); });
  expect(repository.read).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByType(StudyStreakView).props.model.availableTickets).toBe(1);
  expect(onSummaryChange).toHaveBeenLastCalledWith({ userId: 'owner', today: '2026-08-19', plans, actuals, currentStreak: 0, bestStreak: 7 });
  await act(async () => { await button('チケットを使う').props.onClick(); });
  expect(repository.useRestDay).toHaveBeenCalledWith(history, '2026-08-18', '2026-08-19');
  expect(renderer!.root.findByType(StudyStreakView).props.model.protectedDates).toEqual(['2026-08-18']);
  expect(onSummaryChange).toHaveBeenLastCalledWith(expect.objectContaining({ currentStreak: 7, bestStreak: 7 }));
});

it('invalidates a header summary and never offers manual use when history cannot be read', async () => {
  repository.read.mockRejectedValue(new Error('学習履歴を読み込めませんでした。'));
  const onSummaryChange = vi.fn();
  await act(async () => { renderer = create(<StudyStreakPage userId="owner" plans={plans} actuals={actuals}
    onClose={vi.fn()} onSummaryChange={onSummaryChange} />); });
  const view = renderer!.root.findByType(StudyStreakView);
  expect(view.props.model.currentStreak).toBeNull();
  expect(view.props.restDayActions).toBeUndefined();
  expect(view.props.error).toBe('学習履歴を読み込めませんでした。');
  expect(onSummaryChange).toHaveBeenLastCalledWith(null);
  repository.read.mockResolvedValueOnce(history);
  await act(async () => button('再読み込み').props.onClick());
  expect(renderer!.root.findByType(StudyStreakView).props.model.availableTickets).toBe(1);
});

it('shows read-only history on a repository without safe manual-use support', async () => {
  repository.canUseRestDays = false;
  await act(async () => { renderer = create(<StudyStreakPage userId="owner" plans={plans} actuals={actuals} onClose={vi.fn()} />); });
  expect(renderer!.root.findByType(StudyStreakView).props.model.historyComplete).toBe(true);
  expect(renderer!.root.findByType(StudyStreakView).props.restDayActions).toBeUndefined();
  expect(renderer!.root.findAllByProps({ type: 'date' })).toHaveLength(0);
});
