import { describe, expect, it, vi } from 'vitest';
import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';
import { beginClassAttendanceSave, getPendingClassAttendanceSaves } from './classAttendancePendingSaves';

function repository(): ClassAttendanceRepository {
  return { list: vi.fn(), save: vi.fn() };
}

describe('class attendance pending save ownership', () => {
  it('does not call persistence or retain completed saves', async () => {
    const repo = repository();
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toEqual([]);
    const finish = beginClassAttendanceSave(repo, 'owner', 'lesson');
    const pending = getPendingClassAttendanceSaves(repo, 'owner', 'lesson');
    expect(pending).toHaveLength(1);
    finish();
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toEqual([]);
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('partitions the exact repository identity and owner/lesson tuple', () => {
    const repo = repository();
    const other = repository();
    const finish = beginClassAttendanceSave(repo, 'a:b', 'c');
    expect(getPendingClassAttendanceSaves(other, 'a:b', 'c')).toEqual([]);
    expect(getPendingClassAttendanceSaves(repo, 'a', 'b:c')).toEqual([]);
    expect(getPendingClassAttendanceSaves(repo, 'other', 'c')).toEqual([]);
    expect(getPendingClassAttendanceSaves(repo, 'a:b', 'other')).toEqual([]);
    expect(getPendingClassAttendanceSaves(repo, 'a:b', 'c')).toHaveLength(1);
    finish();
  });

  it('retains remaining same-scope saves and independent scopes after settlement', async () => {
    const repo = repository();
    const first = beginClassAttendanceSave(repo, 'owner', 'lesson');
    const second = beginClassAttendanceSave(repo, 'owner', 'lesson');
    const independent = beginClassAttendanceSave(repo, 'owner', 'other');
    const batch = getPendingClassAttendanceSaves(repo, 'owner', 'lesson');
    first();
    await batch[0];
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toEqual([batch[1]]);
    second();
    await Promise.all(batch);
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toEqual([]);
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'other')).toHaveLength(1);
    independent();
  });

  it('exposes a fresh snapshot when another save is admitted during a wait', async () => {
    const repo = repository();
    const first = beginClassAttendanceSave(repo, 'owner', 'lesson');
    const batch = getPendingClassAttendanceSaves(repo, 'owner', 'lesson');
    const second = beginClassAttendanceSave(repo, 'owner', 'lesson');
    first();
    await Promise.all(batch);
    const remaining = getPendingClassAttendanceSaves(repo, 'owner', 'lesson');
    expect(batch).toHaveLength(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(batch[0]);
    second();
    await Promise.all(remaining);
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toEqual([]);
  });

  it('does not expose a mutable ownership collection to consumers', () => {
    const repo = repository();
    const finish = beginClassAttendanceSave(repo, 'owner', 'lesson');
    const snapshot = getPendingClassAttendanceSaves(repo, 'owner', 'lesson');
    (snapshot as Promise<void>[]).length = 0;
    expect(getPendingClassAttendanceSaves(repo, 'owner', 'lesson')).toHaveLength(1);
    finish();
  });
});
