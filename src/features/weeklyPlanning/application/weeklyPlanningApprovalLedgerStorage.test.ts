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
