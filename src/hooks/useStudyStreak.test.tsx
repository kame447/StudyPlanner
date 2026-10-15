import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useStudyStreak } from './useStudyStreak';
import { actual, deferred, event } from '../repositories/localPersistenceConcurrency.testUtils';
import { addDays } from '../lib/date';
import type { StudyStreakHistory, StudyStreakRepository } from '../repositories/studyStreakRepository';

const history = (userId = 'owner'): StudyStreakHistory => ({ userId, plans: [], monthEvents: [], restDays: [], historyComplete: true,
  actuals: Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, userId, planId: null, occurrenceDate: addDays('2026-10-01', index) })) });
function repository(): StudyStreakRepository {
  return { canUseRestDays: true, read: vi.fn(async userId => history(userId)),
    useRestDay: vi.fn(async (source, date) => ({ ...source, restDays: [...source.restDays, { date }] })) };
}

describe('automatic streak protection and display lifetime', () => {
  it('waits for the owner full-planner-read boundary before any request and disables resume when inactive', async () => {
    const repo = repository();
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ active }: { active: boolean }) { state = useStudyStreak('owner', '2026-10-09', repo, undefined, active); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness active={false} />); });
    expect(repo.read).not.toHaveBeenCalled();
    expect(repo.useRestDay).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<Harness active />); });
    expect(repo.read).toHaveBeenCalledTimes(1);
    expect(state.model?.currentStreak).toBe(7);
    await act(async () => { renderer.update(<Harness active={false} />); state.retry(); });
    expect(repo.read).toHaveBeenCalledTimes(1);
    expect(state.model?.currentStreak).toBe(7);
    act(() => renderer.unmount());
  });

  it('leaves today open, then automatically acknowledges yesterday at the local day boundary', async () => {
    const repo = repository(), pending = deferred<StudyStreakHistory>();
    vi.mocked(repo.useRestDay).mockReturnValueOnce(pending.promise);
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ today }: { today: string }) { state = useStudyStreak('owner', today, repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness today="2026-10-08" />); });
    expect(state.model?.availableTickets).toBe(1);
    expect(repo.useRestDay).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<Harness today="2026-10-09" />); });
    expect(repo.useRestDay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.useRestDay).mock.calls[0].slice(1, 3)).toEqual(['2026-10-08', '2026-10-09']);
    expect(state.saving).toBe(true);
    expect(state.model?.availableTickets).toBe(1);
    await act(async () => pending.resolve({ ...history(), restDays: [{ date: '2026-10-08' }] }));
    expect(state.model).toMatchObject({ availableTickets: 0, currentStreak: 7, protectedDates: ['2026-10-08'] });
    expect(state.refreshing).toBe(false);
    act(() => renderer.unmount());
  });

  it('does not spend from late old-owner reads or after unmount', async () => {
    const repo = repository(), delayed = deferred<StudyStreakHistory>();
    vi.mocked(repo.read).mockReturnValueOnce(delayed.promise);
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ owner }: { owner: string }) { state = useStudyStreak(owner, '2026-10-09', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness owner="owner" />); });
    await act(async () => { renderer.update(<Harness owner="other" />); });
    await act(async () => delayed.resolve(history()));
    expect(repo.useRestDay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.useRestDay).mock.calls[0][0].userId).toBe('other');
    const afterUnmount = deferred<StudyStreakHistory>();
    vi.mocked(repo.read).mockReturnValueOnce(afterUnmount.promise);
    await act(async () => state.retry());
    act(() => renderer.unmount());
    await act(async () => afterUnmount.resolve(history('other')));
    expect(repo.useRestDay).toHaveBeenCalledTimes(1);
  });

  it('keeps failed reads unknown and failed saves visible and retryable without optimistic spending', async () => {
    const repo = repository();
    vi.mocked(repo.read).mockRejectedValueOnce(new Error('permission-denied'));
    vi.mocked(repo.useRestDay).mockRejectedValueOnce(new Error('offline'));
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness() { state = useStudyStreak('owner', '2026-10-09', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness />); });
    expect(state).toMatchObject({ status: 'error', model: null, readError: 'permission-denied' });
    expect(repo.useRestDay).not.toHaveBeenCalled();
    await act(async () => state.retry());
    expect(state.saveError).toBe('offline');
    expect(state.model?.availableTickets).toBe(1);
    await act(async () => state.retry());
    expect(state.model?.availableTickets).toBe(0);
    act(() => renderer.unmount());
  });

  it('explains an unsupported safe-write capability instead of silently skipping an eligible gap', async () => {
    const repo = { ...repository(), canUseRestDays: false };
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness() { state = useStudyStreak('owner', '2026-10-09', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness />); });
    expect(state.model?.availableTickets).toBe(1);
    expect(state.saveError).toContain('安全に保存できません');
    expect(repo.useRestDay).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('shows a confirmed cache immediately and preserves it when background refresh fails', async () => {
    const repo = repository(), cached = { ...history(), restDays: [{ date: '2026-10-08' }] };
    repo.peek = () => cached;
    const refresh = deferred<StudyStreakHistory>(); vi.mocked(repo.read).mockReturnValue(refresh.promise);
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness() { state = useStudyStreak('owner', '2026-10-09', repo); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness />); });
    expect(state).toMatchObject({ status: 'ready', refreshing: true });
    expect(state.model?.currentStreak).toBe(7);
    await act(async () => refresh.reject(new Error('offline')));
    expect(state).toMatchObject({ status: 'ready', refreshing: false, readError: 'offline' });
    expect(state.model?.currentStreak).toBe(7);
    expect(repo.useRestDay).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('aborts in-flight automatic use when inputs change and never binds its result to the replacement', async () => {
    const repo = repository(), reload = deferred<StudyStreakHistory>(), save = deferred<StudyStreakHistory>();
    vi.mocked(repo.useRestDay).mockReturnValueOnce(save.promise);
    let state!: ReturnType<typeof useStudyStreak>;
    const renders: Array<ReturnType<typeof useStudyStreak>['model']> = [];
    function Harness({ source }: { source: StudyStreakHistory }) {
      state = useStudyStreak('owner', '2026-10-09', repo, source); renders.push(state.model); return null;
    }
    let renderer!: ReturnType<typeof create>;
    const before = history();
    await act(async () => { renderer = create(<Harness source={before} />); });
    const signal = vi.mocked(repo.useRestDay).mock.calls[0][3]?.signal;
    vi.mocked(repo.read).mockReturnValueOnce(reload.promise);
    const changed = { ...history(), actuals: history().actuals.slice(1) };
    renders.length = 0;
    await act(async () => { renderer.update(<Harness source={changed} />); });
    expect(renders.every(model => model === null)).toBe(true);
    expect(signal?.aborted).toBe(true);
    await act(async () => save.resolve({ ...before, restDays: [{ date: '2026-10-08' }] }));
    expect(state.model).toBeNull();
    await act(async () => reload.resolve({ ...changed, restDays: [{ date: '2026-10-08' }] }));
    expect(state.model).toMatchObject({ currentStreak: 0, availableTickets: 0, protectedDates: [], unprotectedRestDates: ['2026-10-08'] });
    expect(repo.useRestDay).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});

it('aborts an in-flight automatic spend when only authoritative major-event sources change', async () => {
  const repo = repository(), reload = deferred<StudyStreakHistory>(), save = deferred<StudyStreakHistory>();
  const source = history();
  source.actuals[6] = { ...source.actuals[6], planId: 'job' };
  vi.mocked(repo.read).mockResolvedValueOnce(source);
  vi.mocked(repo.useRestDay).mockReturnValueOnce(save.promise);
  let state!: ReturnType<typeof useStudyStreak>;
  function Harness({ current }: { current: StudyStreakHistory }) {
    state = useStudyStreak('owner', '2026-10-09', repo, current); return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness current={source} />); });
  const signal = vi.mocked(repo.useRestDay).mock.calls[0][3]?.signal;
  const changed = { ...source, monthEvents: [event({ id: 'job' })] };
  vi.mocked(repo.read).mockReturnValueOnce(reload.promise);
  await act(async () => renderer.update(<Harness current={changed} />));
  expect(signal?.aborted).toBe(true);
  expect(state.model).toBeNull();
  await act(async () => save.resolve({ ...source, restDays: [{ date: '2026-10-08' }] }));
  expect(state.model).toBeNull();
  await act(async () => reload.resolve(changed));
  expect(state.model).toMatchObject({ earnedTickets: 0, bestStreak: 6, protectedDates: [] });
  expect(repo.useRestDay).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it('does not accept a complete marker without the major-event source slice', async () => {
  const repo = repository();
  const incomplete = { ...history(), monthEvents: undefined } as unknown as StudyStreakHistory;
  vi.mocked(repo.read).mockResolvedValue(incomplete);
  let state!: ReturnType<typeof useStudyStreak>;
  function Harness() { state = useStudyStreak('owner', '2026-10-09', repo); return null; }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  expect(state).toMatchObject({ status: 'error', model: null });
  expect(repo.useRestDay).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it('automatically saves a newly eligible rest day after a non-study correction, without altering Actuals', async () => {
  const repo = repository();
  const source = { ...history(), monthEvents: [event({ id: 'job' })] };
  source.actuals = [...source.actuals, actual({ id: 'job-actual', planId: 'job', occurrenceDate: '2026-10-08' })];
  const original = JSON.stringify(source.actuals);
  vi.mocked(repo.read).mockResolvedValue(source);
  let state!: ReturnType<typeof useStudyStreak>;
  function Harness() { state = useStudyStreak('owner', '2026-10-09', repo, source); return null; }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  expect(repo.useRestDay).toHaveBeenCalledExactlyOnceWith(source, '2026-10-08', '2026-10-09', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(state.model).toMatchObject({ currentStreak: 7, earnedTickets: 1, usedTickets: 1, protectedDates: ['2026-10-08'] });
  expect(JSON.stringify(source.actuals)).toBe(original);
  act(() => renderer.unmount());
});
