import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApproval';
import type {
  WeeklyDraftApprovalOperation,
  WeeklyPreviewMetadata,
} from '../planning/weeklyPlanningApprovalTypes';
import {
  createMemoryStorageHarness,
  createWeeklyPlanningTestDraftBlock,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  loadWeeklyPlanningApprovalOperations,
  saveWeeklyPlanningApprovalOperations,
} from './weeklyPlanningApprovalLedgerStorage';
import { serializeWeeklyApprovalLedger } from '../planning/weeklyPlanningApproval';

const LEGACY_KEY = 'studyplanner-weekly-approval-ledger-v1';

function userKey(userId: string): string {
  return `studyplanner-weekly-approval-ledger-v2.${encodeURIComponent(userId)}`;
}

function operation(userId: string, previewId: string): WeeklyDraftApprovalOperation {
  const metadata: WeeklyPreviewMetadata = {
    previewId,
    stateRevision: 0,
    assumptionDependencies: [],
    approvalEligibility: 'eligible',
    stale: false,
    authorizedUserId: userId,
  };
  const block = createWeeklyPlanningTestDraftBlock({
    id: `${previewId}-block`,
    userId,
    previewMetadata: metadata,
  });
  return createWeeklyDraftApprovalOperation({
    userId,
    metadata,
    blocks: [block],
    now: '2026-07-18T00:00:00.000Z',
  });
}

describe('weeklyPlanningApprovalLedgerStorage', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
  });

  afterEach(() => restoreWindow());

  it('stores and loads operations only from the requested user key', () => {
    const userAOperation = operation('user-a', 'preview-a');
    const userBOperation = operation('user-b', 'preview-b');

    saveWeeklyPlanningApprovalOperations('user-a', [userAOperation, userBOperation]);

    expect(loadWeeklyPlanningApprovalOperations('user-a')).toEqual([userAOperation]);
    expect(loadWeeklyPlanningApprovalOperations('user-b')).toEqual([]);
    expect(storageHarness.values.get(userKey('user-a'))).toContain('preview-a');
    expect(storageHarness.values.get(userKey('user-a'))).not.toContain('preview-b');
  });

  it('migrates only the current user operations from the legacy global ledger', () => {
    const userAOperation = operation('user-a', 'preview-a');
    const userBOperation = operation('user-b', 'preview-b');
    storageHarness.values.set(
      LEGACY_KEY,
      serializeWeeklyApprovalLedger([userAOperation, userBOperation]),
    );

    const loadedA = loadWeeklyPlanningApprovalOperations('user-a');

    expect(loadedA).toEqual([userAOperation]);
    expect(storageHarness.values.get(userKey('user-a'))).toContain('preview-a');
    expect(storageHarness.values.get(LEGACY_KEY)).toContain('preview-b');
    expect(storageHarness.values.get(LEGACY_KEY)).not.toContain('preview-a');

    const loadedB = loadWeeklyPlanningApprovalOperations('user-b');

    expect(loadedB).toEqual([userBOperation]);
    expect(storageHarness.values.get(userKey('user-b'))).toContain('preview-b');
    expect(storageHarness.values.has(LEGACY_KEY)).toBe(false);
  });

  it('removes an empty user ledger without affecting another user ledger', () => {
    const userBOperation = operation('user-b', 'preview-b');
    saveWeeklyPlanningApprovalOperations('user-b', [userBOperation]);

    saveWeeklyPlanningApprovalOperations('user-a', []);

    expect(storageHarness.values.has(userKey('user-a'))).toBe(false);
    expect(loadWeeklyPlanningApprovalOperations('user-b')).toEqual([userBOperation]);
  });

  it('returns no operations for anonymous or blank ownership', () => {
    storageHarness.values.set(
      LEGACY_KEY,
      serializeWeeklyApprovalLedger([operation('user-a', 'preview-a')]),
    );

    expect(loadWeeklyPlanningApprovalOperations('')).toEqual([]);
    expect(loadWeeklyPlanningApprovalOperations('   ')).toEqual([]);
  });
});

describe('weeklyPlanningApprovalLedgerStorage when storage fails (B5)', () => {
  // The real module over a storage double that throws; nothing else is mocked.
  const valid = () => serializeWeeklyApprovalLedger([operation('user-a', 'preview-a')]);
  const doubleStorage = (values: Map<string, string>, failing: { getItem?: boolean; removeItem?: boolean }) => ({
    getItem: (key: string) => { if (failing.getItem) throw new Error('storage read failed'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => { if (failing.removeItem) throw new Error('storage remove failed'); values.delete(key); },
  }) as unknown as Storage;
  let restore: (() => void) | undefined;
  afterEach(() => { restore?.(); restore = undefined; });

  it('returns no operations when storage is absent', () => {
    restore = installWeeklyPlanningTestStorage(undefined as unknown as Storage);
    expect(loadWeeklyPlanningApprovalOperations('user-a')).toEqual([]);
  });

  it('returns no operations without throwing when reading and removing both throw', () => {
    const values = new Map([[userKey('user-a'), valid()]]);
    restore = installWeeklyPlanningTestStorage(doubleStorage(values, { getItem: true, removeItem: true }));
    expect(loadWeeklyPlanningApprovalOperations('user-a')).toEqual([]);
    expect(values.get(userKey('user-a'))).toBe(valid());
  });

  it('does not delete a stored ledger because it could not be read', () => {
    const values = new Map([[userKey('user-a'), valid()]]);
    restore = installWeeklyPlanningTestStorage(doubleStorage(values, { getItem: true }));
    expect(loadWeeklyPlanningApprovalOperations('user-a')).toEqual([]);
    expect(values.get(userKey('user-a'))).toBe(valid());
  });

  it('still loads a valid ledger when only removal fails (negative control)', () => {
    const values = new Map([[userKey('user-a'), valid()]]);
    restore = installWeeklyPlanningTestStorage(doubleStorage(values, { removeItem: true }));
    expect(loadWeeklyPlanningApprovalOperations('user-a')).toEqual([operation('user-a', 'preview-a')]);
    expect(values.get(userKey('user-a'))).toBe(valid());
  });
});
