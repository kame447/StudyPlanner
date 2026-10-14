import { beforeEach, expect, it, vi } from 'vitest';
import type { StudyStreakHistory, StudyStreakRepository } from './studyStreakRepository';

const lazy = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./firebaseStudyStreakRepository', () => ({ createFirebaseStudyStreakRepository: lazy.create }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({}), getFirestoreDb: () => ({}) }));
vi.mock('./firebaseAuthRepository', () => ({ createFirebaseAuthRepository: () => ({}) }));
vi.mock('./observedPlannerRepository', () => ({ createObservedPlannerRepository: (repository: unknown) => repository }));
import { createFirebaseRepositories } from './firebaseRepositories';

const history = (userId: string): StudyStreakHistory => ({ userId, plans: [], actuals: [], restDays: [], historyComplete: true });
let implementation: StudyStreakRepository;
beforeEach(() => {
  implementation = { canUseRestDays: true, peek: vi.fn(() => null), read: vi.fn(async owner => history(owner)),
    useRestDay: vi.fn(async current => current) };
  lazy.create.mockReset().mockReturnValue(implementation);
});

it('creates no reader at startup, shares one lazy instance, and forwards each owner and save scope unchanged', async () => {
  const repository = createFirebaseRepositories().studyStreakRepository;
  expect(lazy.create).not.toHaveBeenCalled();
  expect(repository.peek?.('owner')).toBeNull();
  const options = { today: '2026-10-09', hint: { plans: [], actuals: [] } };
  const [first, second] = await Promise.all([repository.read('owner', options), repository.read('other', options)]);
  expect(lazy.create).toHaveBeenCalledTimes(1);
  expect(first.userId).toBe('owner'); expect(second.userId).toBe('other');
  const signal = new AbortController().signal;
  await repository.useRestDay(first, '2026-10-08', '2026-10-09', { signal });
  expect(implementation.useRestDay).toHaveBeenCalledExactlyOnceWith(first, '2026-10-08', '2026-10-09', { signal });
  repository.peek?.('other', options.hint);
  expect(implementation.peek).toHaveBeenLastCalledWith('other', options.hint);
});

it('does not cache a failed loader promise or replace its error with empty history', async () => {
  lazy.create.mockImplementationOnce(() => { throw new Error('load failed'); });
  const repository = createFirebaseRepositories().studyStreakRepository;
  await expect(repository.read('owner')).rejects.toThrow('load failed');
  expect(repository.peek?.('owner')).toBeNull();
  expect(implementation.read).not.toHaveBeenCalled();
  expect(await repository.read('owner')).toMatchObject({ userId: 'owner', historyComplete: true });
  expect(lazy.create).toHaveBeenCalledTimes(2);
});
