import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useStudyStreak } from './useStudyStreak';
import { actual, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { addDays } from '../lib/date';
import type { StudyStreakHistory, StudyStreakRepository } from '../repositories/studyStreakRepository';

const history = (userId = 'owner'): StudyStreakHistory => ({ userId, plans: [], restDays: [], historyComplete: true,
  actuals: Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, userId, planId: null, occurrenceDate: addDays('2026-10-01', index) })) });
function repository(): StudyStreakRepository {
  return { canUseRestDays: true, read: vi.fn(async userId => history(userId)),
    useRestDay: vi.fn(async (source, date) => ({ ...source, restDays: [{ date }] })) };
}

describe('streak detail lifetime', () => {
  it('loads only when mounted, saves once under repeated clicks, and updates from the acknowledged record', async () => {
    const repo = repository(), pending = deferred<StudyStreakHistory>();
    vi.mocked(repo.useRestDay).mockReturnValueOnce(pending.promise);
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness() { state = useStudyStreak('owner', '2026-10-08', repo); return null; }
    expect(repo.read).not.toHaveBeenCalled();
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness />); });
    expect(state.model?.availableTickets).toBe(1);
    let first!: Promise<boolean>;
    await act(async () => { first = state.useRestDay('2026-10-08'); expect(await state.useRestDay('2026-10-08')).toBe(false); });
    expect(repo.useRestDay).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ ...history(), restDays: [{ date: '2026-10-08' }] }); expect(await first).toBe(true); });
    expect(state.model).toMatchObject({ availableTickets: 0, currentStreak: 7, protectedDates: ['2026-10-08'] });
    act(() => renderer.unmount());
  });

  it('rejects retained old-owner actions and late reads without exposing the previous account', async () => {
    const repo = repository(), delayed = deferred<StudyStreakHistory>();
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ owner }: { owner: string }) { state = useStudyStreak(owner, '2026-10-08', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness owner="owner" />); });
    const retained = state.useRestDay;
    vi.mocked(repo.read).mockReturnValueOnce(delayed.promise);
    await act(async () => { renderer.update(<Harness owner="other" />); });
    expect(state.model).toBeNull();
    expect(await retained('2026-10-08')).toBe(false);
    expect(repo.useRestDay).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<Harness owner="third" />); });
    await act(async () => { delayed.resolve({ ...history('other'), actuals: [] }); });
    expect(state.status).toBe('ready');
    expect(state.model?.availableTickets).toBe(1);
    const afterUnmount = state.useRestDay;
    act(() => renderer.unmount());
    expect(await afterUnmount('2026-10-08')).toBe(false);
    expect(repo.useRestDay).not.toHaveBeenCalled();
  });

  it('keeps failed reads unknown and failed saves retryable without optimistically spending', async () => {
    const repo = repository();
    vi.mocked(repo.read).mockRejectedValueOnce(new Error('permission-denied'));
    vi.mocked(repo.useRestDay).mockRejectedValueOnce(new Error('offline'));
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness() { state = useStudyStreak('owner', '2026-10-08', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness />); });
    expect(state).toMatchObject({ status: 'error', model: null, canUseRestDays: false, readError: 'permission-denied' });
    await act(async () => state.retry());
    await act(async () => { expect(await state.useRestDay('2026-10-08')).toBe(false); });
    expect(state.saveError).toBe('offline');
    expect(state.model?.availableTickets).toBe(1);
    await act(async () => { expect(await state.useRestDay('2026-10-08')).toBe(true); });
    expect(state.model?.availableTickets).toBe(0);
    act(() => renderer.unmount());
  });

  it('never binds an old ready result or late save to changed history inputs', async () => {
    const repo = repository(), reload = deferred<StudyStreakHistory>(), save = deferred<StudyStreakHistory>();
    let state!: ReturnType<typeof useStudyStreak>;
    const renders: Array<ReturnType<typeof useStudyStreak>['model']> = [];
    function Harness({ source }: { source: StudyStreakHistory }) {
      state = useStudyStreak('owner', '2026-10-08', repo, source); renders.push(state.model); return null;
    }
    let renderer!: ReturnType<typeof create>;
    const before = history();
    await act(async () => { renderer = create(<Harness source={before} />); });
    vi.mocked(repo.useRestDay).mockReturnValueOnce(save.promise);
    let pending!: Promise<boolean>;
    await act(async () => { pending = state.useRestDay('2026-10-08'); });
    vi.mocked(repo.read).mockReturnValueOnce(reload.promise);
    const changed = { ...history(), actuals: history().actuals.slice(1) };
    renders.length = 0;
    await act(async () => { renderer.update(<Harness source={changed} />); });
    expect(renders.every(model => model === null)).toBe(true);
    await act(async () => { save.resolve({ ...before, restDays: [{ date: '2026-10-08' }] }); expect(await pending).toBe(false); });
    expect(state.model).toBeNull();
    await act(async () => { reload.resolve({ ...changed, restDays: [{ date: '2026-10-08' }] }); });
    expect(state.model).toMatchObject({ currentStreak: 6, availableTickets: 0, protectedDates: [], unprotectedRestDates: ['2026-10-08'] });
    act(() => renderer.unmount());
  });
});
