import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, microtasks } from '../../../repositories/localPersistenceConcurrency.testUtils';
import { createConfirmedWeekStartFact, createEmptyWeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';
import type { WeeklyPlanningPersonalizationRepository } from './weeklyPlanningPersonalizationRepository';
import { PERSONALIZATION_READ_TIMEOUT_MS, useWeeklyPlanningPersonalizationProfile, type WeeklyPlanningPersonalizationProfileState } from './useWeeklyPlanningPersonalizationProfile';

vi.mock('./weeklyPlanningPersonalizationRepository', () => ({
  getWeeklyPlanningPersonalizationRepository: () => null,
}));
const profile = {
  ...createEmptyWeeklyPlanningPersonalizationProfile(),
  weekStartsOn: createConfirmedWeekStartFact('sunday', '2026-10-09T00:00:00.000Z'),
};
let renderer: ReactTestRenderer | undefined;
let state: WeeklyPlanningPersonalizationProfileState;
let repository: WeeklyPlanningPersonalizationRepository;
function Probe({ owner = 'a', source = repository }) {
  state = useWeeklyPlanningPersonalizationProfile(owner, source);
  return null;
}
async function mount() { await act(async () => { renderer = create(<Probe />); await microtasks(); }); }
async function advance(ms = PERSONALIZATION_READ_TIMEOUT_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); await microtasks(); });
}
beforeEach(() => {
  vi.useFakeTimers();
  repository = { getProfile: vi.fn(async () => profile), setWeekStartsOn: vi.fn(async () => profile), resetProfile: vi.fn(async () => {}) };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('preference read recovery', () => {
  it.each(['resolve', 'reject'] as const)('times out and ignores late %s without accepting an empty profile or saving', async outcome => {
    const pending = deferred<typeof profile>();
    vi.mocked(repository.getProfile).mockReturnValueOnce(pending.promise);
    await mount();
    const save = state.setWeekStartsOn;
    expect(await save('monday')).toBe(false);
    await advance(PERSONALIZATION_READ_TIMEOUT_MS - 1);
    expect(state.loading).toBe(true);
    await advance(1);
    expect(state).toMatchObject({ loading: false, profile: null, readFailed: true });
    expect(state.error).toContain('時間がかかっています');
    expect(vi.getTimerCount()).toBe(0);
    expect(await save('monday')).toBe(false);
    expect(await state.resetProfile()).toBe(false);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve(profile);
      else pending.reject(new Error('late rejection'));
      await microtasks();
    });
    expect(state).toMatchObject({ loading: false, profile: null, readFailed: true });
    expect(repository.getProfile).toHaveBeenCalledOnce();
    expect(repository.setWeekStartsOn).not.toHaveBeenCalled();
    expect(repository.resetProfile).not.toHaveBeenCalled();
  });

  it.each([null, profile])('accepts successful read %s and permits explicit save without any eager write', async result => {
    vi.mocked(repository.getProfile).mockResolvedValueOnce(result);
    await mount();
    expect(state).toMatchObject({ loading: false, profile: result, error: '', readFailed: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(repository.setWeekStartsOn).not.toHaveBeenCalled();
    await act(async () => { expect(await state.setWeekStartsOn('sunday')).toBe(true); });
    expect(repository.setWeekStartsOn).toHaveBeenCalledExactlyOnceWith('a', 'sunday');
  });

  it('gives each manual retry a new deadline and only accepts its own response', async () => {
    const old = deferred<typeof profile>(), next = deferred<typeof profile>();
    vi.mocked(repository.getProfile).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount(); await advance();
    let retry!: Promise<void>;
    await act(async () => { retry = state.refresh(); await microtasks(); });
    expect(state).toMatchObject({ loading: true, profile: null, readFailed: false });
    await act(async () => { old.resolve(profile); await microtasks(); });
    expect(state.loading).toBe(true);
    await advance(PERSONALIZATION_READ_TIMEOUT_MS - 1);
    expect(state.loading).toBe(true);
    await advance(1); await retry;
    expect(state).toMatchObject({ loading: false, profile: null, readFailed: true });
    await act(async () => { await state.refresh(); });
    expect(state).toMatchObject({ loading: false, profile, readFailed: false });
    await act(async () => { next.reject(new Error('obsolete retry')); await microtasks(); });
    expect(state.error).toBe('');
    expect(repository.getProfile).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supersedes an in-flight retry and settles its caller without accepting the late result', async () => {
    const first = deferred<typeof profile>(), second = deferred<typeof profile>(), third = deferred<typeof profile>();
    vi.mocked(repository.getProfile).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    await mount();
    let superseded!: Promise<void>, latest!: Promise<void>;
    await act(async () => { superseded = state.refresh(); await microtasks(); });
    await act(async () => { latest = state.refresh(); await superseded; await microtasks(); });
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { first.resolve(profile); second.resolve(profile); await microtasks(); });
    expect(state.loading).toBe(true);
    await act(async () => { third.resolve(profile); await latest; });
    expect(state).toMatchObject({ loading: false, profile, error: '' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['owner', 'repository'] as const)('retires reads and old callbacks on %s replacement', async replacement => {
    const old = deferred<typeof profile>(), next = deferred<typeof profile>();
    vi.mocked(repository.getProfile).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount();
    const oldState = state;
    const otherRepository = { ...repository, getProfile: vi.fn(() => next.promise) };
    await act(async () => {
      renderer!.update(<Probe owner={replacement === 'owner' ? 'b' : 'a'} source={replacement === 'repository' ? otherRepository : repository} />);
      await microtasks();
    });
    expect(vi.getTimerCount()).toBe(1);
    await oldState.refresh();
    expect(await oldState.setWeekStartsOn('monday')).toBe(false);
    expect(await oldState.resetProfile()).toBe(false);
    await act(async () => { old.resolve(profile); await microtasks(); });
    expect(state).toMatchObject({ loading: true, profile: null });
    await act(async () => { next.resolve(profile); await microtasks(); });
    expect(state).toMatchObject({ loading: false, profile, readFailed: false });
    expect(repository.setWeekStartsOn).not.toHaveBeenCalled();
    expect(repository.resetProfile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the timer and settles an outstanding refresh on unmount', async () => {
    const old = deferred<typeof profile>();
    vi.mocked(repository.getProfile).mockReturnValue(old.promise);
    await mount();
    let pending!: Promise<void>;
    await act(async () => { pending = state.refresh(); await microtasks(); });
    const oldState = state;
    await act(async () => { renderer!.unmount(); renderer = undefined; await pending; });
    expect(vi.getTimerCount()).toBe(0);
    await oldState.refresh();
    expect(await oldState.setWeekStartsOn('sunday')).toBe(false);
    await act(async () => { old.reject(new Error('late unmount rejection')); await microtasks(); });
    expect(repository.getProfile).toHaveBeenCalledTimes(2);
    expect(repository.setWeekStartsOn).not.toHaveBeenCalled();
  });

  it('preserves retryable save failures after a confirmed read and serializes writes', async () => {
    const write = deferred<typeof profile>();
    vi.mocked(repository.setWeekStartsOn).mockReturnValueOnce(write.promise);
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => { pending = state.setWeekStartsOn('monday'); await microtasks(); });
    expect(await state.setWeekStartsOn('sunday')).toBe(false);
    expect(await state.resetProfile()).toBe(false);
    await state.refresh();
    expect(repository.getProfile).toHaveBeenCalledOnce();
    await act(async () => { write.reject(new Error('save unavailable')); expect(await pending).toBe(false); });
    expect(state).toMatchObject({ loading: false, profile, readFailed: false, error: 'save unavailable' });
    await act(async () => { expect(await state.setWeekStartsOn('sunday')).toBe(true); });
    expect(state.error).toBe('');
  });

  it.each(['resolve', 'reject'] as const)('ignores prior owner mutation %s after the new owner read succeeds', async outcome => {
    const write = deferred<typeof profile>();
    vi.mocked(repository.setWeekStartsOn).mockReturnValueOnce(write.promise);
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => { pending = state.setWeekStartsOn('monday'); await microtasks(); });
    vi.mocked(repository.getProfile).mockResolvedValueOnce(null);
    await act(async () => { renderer!.update(<Probe owner="b" />); await microtasks(); });
    await act(async () => {
      if (outcome === 'resolve') write.resolve(profile);
      else write.reject(new Error('retired write failure'));
      expect(await pending).toBe(false);
    });
    expect(state).toMatchObject({ loading: false, profile: null, error: '', readFailed: false });
  });

  it('resets only after a confirmed read, preserves failure, and allows an explicit retry', async () => {
    vi.mocked(repository.resetProfile).mockRejectedValueOnce(new Error('reset unavailable'));
    await mount();
    await act(async () => { expect(await state.resetProfile()).toBe(false); });
    expect(state).toMatchObject({ loading: false, profile, error: 'reset unavailable', readFailed: false });
    await act(async () => { expect(await state.resetProfile()).toBe(true); });
    expect(state).toMatchObject({ loading: false, profile: null, error: '', readFailed: false });
    expect(repository.resetProfile).toHaveBeenNthCalledWith(1, 'a');
    expect(repository.resetProfile).toHaveBeenNthCalledWith(2, 'a');
    await act(async () => { expect(await state.setWeekStartsOn('sunday')).toBe(true); });
    expect(repository.setWeekStartsOn).toHaveBeenCalledExactlyOnceWith('a', 'sunday');
  });

});
