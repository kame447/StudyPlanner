import { describe, expect, it, vi } from 'vitest';
import { deferred } from './localPersistenceConcurrency.testUtils';
import { runRecoverableMutation } from './runRecoverableMutation';

describe('recoverable mutation settlement', () => {
  it('starts apply synchronously and never compensates a successful operation', async () => {
    const gate = deferred();
    const apply = vi.fn(() => gate.promise);
    const rollback = vi.fn(async () => {});
    const result = runRecoverableMutation(apply, rollback, '保存');
    expect(apply).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    gate.resolve();
    await expect(result).resolves.toBeUndefined();
    expect(rollback).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)('preserves the exact original failure after apply %s and successful compensation', async failure => {
    const original = { code: 'STORAGE_FAILURE' };
    const apply = () => { if (failure === 'throw') throw original; return Promise.reject(original); };
    const rollback = vi.fn(async () => {});
    await expect(runRecoverableMutation(apply, rollback, '保存')).rejects.toBe(original);
    expect(rollback).toHaveBeenCalledOnce();
  });

  it('does not settle or begin rollback before apply rejects, or settle before rollback completes', async () => {
    const applyGate = deferred();
    const rollbackGate = deferred();
    const enteredRollback = deferred();
    const original = Error('apply failed');
    const rollback = vi.fn(() => { enteredRollback.resolve(); return rollbackGate.promise; });
    let settled = false;
    const result = runRecoverableMutation(() => applyGate.promise, rollback, '保存').catch(error => {
      settled = true;
      return error;
    });
    await Promise.resolve();
    expect(rollback).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    applyGate.reject(original);
    await enteredRollback.promise;
    expect(settled).toBe(false);
    rollbackGate.resolve();
    expect(await result).toBe(original);
    expect(rollback).toHaveBeenCalledOnce();
  });

  it.each(['throw', 'reject'] as const)('reports compensation %s over the original failure with the original message contract', async failure => {
    const rollbackError = failure === 'throw' ? Error('rollback failed') : 'storage unavailable';
    const rollback = () => { if (failure === 'throw') throw rollbackError; return Promise.reject(rollbackError); };
    await expect(runRecoverableMutation(() => Promise.reject(Error('original')), rollback, '予定復元'))
      .rejects.toThrow(`予定復元に失敗し、ロールバックにも失敗しました: ${failure === 'throw' ? 'rollback failed' : 'storage unavailable'}`);
  });
});
