import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { durableReceiptKey, readDurableWeeklyTurnReceipt, saveDurableWeeklyTurnReceipt,
  type DurableWeeklyTurnReceipt } from '../../application/weeklyPlanningDurableTurnClient';
import { durableReceipt } from '../../application/weeklyPlanningDurableTurn.testUtils';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { removeForgottenRecordFromVNextDurableReceipt, readWeeklyPlanningVNextDurableReceipt } from './weeklyPlanningVNextRuntimeGateway';
import type { VNextConfirmedUserContextRecord } from '../weeklyPlanningVNextConfirmedUserContext';
import type { WeeklyPlanningVNextDurableTurnInput } from './weeklyPlanningVNextDurableTurn';

vi.mock('../../../../lib/firebaseClient', () => ({ getFirebaseAuth: () => null }));

const memoryRecord = (id: string, label: string, value: string): VNextConfirmedUserContextRecord => ({
  id, ownerId: 'alice', kind: 'concern', label, value, dateExpression: null,
  scope: { type: 'global', key: null } as VNextConfirmedUserContextRecord['scope'], origin: 'user_confirmed',
  observedDate: '2026-11-01', recordedAt: '2026-11-01T09:00:00.000Z', sourceConversationId: 'c', sourceTurnId: 't',
});

function vnextReceipt(records: VNextConfirmedUserContextRecord[]): DurableWeeklyTurnReceipt<WeeklyPlanningVNextDurableTurnInput> {
  const base = durableReceipt();
  return { ...base, payload: { core: 'vnext', input: base.payload.input as WeeklyPlanningVNextDurableTurnInput['input'],
    weekStartDate: '2026-10-12', checkpoint: null, legacyV5Checkpoint: null,
    ...(records.length ? { confirmedUserContext: { records } } : {}) } };
}

let restore: () => void;
let memory: ReturnType<typeof createMemoryStorageHarness>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-13T20:05:00.000Z'));
  memory = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(memory.storage);
});
afterEach(() => { restore(); vi.useRealTimers(); });

describe('a forgotten memory in the saved VNext turn receipt', () => {
  it('is removed from the receipt, while the other memory and the turn identity stay', () => {
    const receipt = vnextReceipt([memoryRecord('secret', '進路', 'ひみつの志望校'), memoryRecord('keep', '数学', '苦手')]);
    saveDurableWeeklyTurnReceipt(receipt);

    expect(removeForgottenRecordFromVNextDurableReceipt('alice', 'secret')).toBe(true);

    const raw = memory.storage.getItem(durableReceiptKey('alice', 'vnext'))!;
    expect(raw).not.toContain('ひみつの志望校');
    const after = readWeeklyPlanningVNextDurableReceipt('alice')!;
    expect(after.payload.confirmedUserContext?.records.map(record => record.id)).toEqual(['keep']);
    expect(after.pending).toEqual(receipt.pending);
    expect(after.payload.input).toEqual(receipt.payload.input);
  });

  it('leaves no memory member once its last record is forgotten', () => {
    saveDurableWeeklyTurnReceipt(vnextReceipt([memoryRecord('secret', '進路', 'ひみつの志望校')]));

    expect(removeForgottenRecordFromVNextDurableReceipt('alice', 'secret')).toBe(true);

    const raw = memory.storage.getItem(durableReceiptKey('alice', 'vnext'))!;
    expect(raw).not.toContain('confirmedUserContext');
    expect(raw).not.toContain('ひみつの志望校');
    expect(readDurableWeeklyTurnReceipt('alice', 'vnext')?.pending.requestId).toBe('chat:request:1');
  });

  it('changes nothing when the receipt does not hold that record, holds no memory, or is absent', () => {
    expect(removeForgottenRecordFromVNextDurableReceipt('alice', 'secret')).toBe(false);
    saveDurableWeeklyTurnReceipt(vnextReceipt([]));
    const before = memory.storage.getItem(durableReceiptKey('alice', 'vnext'));
    expect(removeForgottenRecordFromVNextDurableReceipt('alice', 'secret')).toBe(false);
    saveDurableWeeklyTurnReceipt(vnextReceipt([memoryRecord('keep', '数学', '苦手')]));
    const withMemory = memory.storage.getItem(durableReceiptKey('alice', 'vnext'));
    expect(removeForgottenRecordFromVNextDurableReceipt('alice', 'other')).toBe(false);
    expect(memory.storage.getItem(durableReceiptKey('alice', 'vnext'))).toBe(withMemory);
    expect(before).not.toBe(withMemory);
  });

  it('keeps a requested cancellation on the receipt', () => {
    saveDurableWeeklyTurnReceipt({ ...vnextReceipt([memoryRecord('secret', '進路', 'ひみつ')]), cancelRequested: true });
    removeForgottenRecordFromVNextDurableReceipt('alice', 'secret');
    expect(readWeeklyPlanningVNextDurableReceipt('alice')?.cancelRequested).toBe(true);
  });
});
