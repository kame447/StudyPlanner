import { expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';

const sdk = vi.hoisted(() => ({ commit: vi.fn(), set: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  writeBatch: () => ({ set: sdk.set, commit: sdk.commit }),
}));

it('preserves the permission-denied code from a duration batch refusal without copying backend metadata', async () => {
  const denial = Object.assign(new Error('private backend detail'), {
    code: 'permission-denied', customData: { token: 'private-token' },
  });
  sdk.commit.mockRejectedValueOnce(denial);
  const repository = createFirebasePlannerRepository({} as Firestore);
  const caught = await repository.saveDurationActualsBatch('owner', [
    { id: 'record-1', occurrenceDate: '2026-10-30', subject: '数学', minutes: 30 },
  ]).catch(error => error);

  expect(sdk.commit).toHaveBeenCalledOnce();
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBe(denial);
  expect(caught).toHaveProperty('code', 'permission-denied');
  // This is internal diagnostics; usePlannerDataState owns the safe user-facing message.
  expect(caught.message).toBe('permission-denied: private backend detail');
  expect(caught).not.toHaveProperty('customData');
  expect(caught).not.toHaveProperty('cause');
  expect(denial.customData.token).toBe('private-token');
});
