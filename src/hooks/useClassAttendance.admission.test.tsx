import { UserFacingError } from '../lib/userFacingError';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useClassAttendance } from './useClassAttendance';
import { createLocalClassAttendanceRepository } from '../repositories/classAttendanceRepository';
import type { ClassAttendanceDraft } from '../domain/classAttendance';
import type { ScheduleTemplate } from '../types/domain';

it('rejects a retained save after unmount before persistence', async () => {
  const values = new Map<string, string>();
  const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); }, clear: () => values.clear() };
  const repo = createLocalClassAttendanceRepository(storage, { getScheduleTemplates: vi.fn(async () => [{ id: 'class', userId: 'owner' } as ScheduleTemplate]) });
  let current!: ReturnType<typeof useClassAttendance>;
  function Harness() { current = useClassAttendance('owner', 'class', repo); return null; }
  let ui!: ReactTestRenderer;
  await act(async () => { ui = create(<Harness />); });
  expect(current.kind).toBe('ready');
  const retained = current.save;
  act(() => ui.unmount());
  let admitted!: boolean;
  await act(async () => { admitted = await retained('2026-10-20', 'present'); });
  expect({ admitted, persisted: await repo.list('owner', 'class') }).toEqual({ admitted: false, persisted: [] });
});

it.each(['owner', 'lesson', 'repository', 'retry'] as const)('rejects a retained ready callback after %s changes, including while loading', async change => {
  let current!: ReturnType<typeof useClassAttendance>;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = vi.fn(async (draft: ClassAttendanceDraft) => ({ ...draft, schemaVersion: 1 as const, createdAt: 'created', updatedAt: 'updated' }));
  const list = vi.fn(async () => []);
  const repo = { list, save };
  const other = { list: vi.fn(async () => { await gate; return []; }), save };
  function Harness({ owner = 'owner', lesson = 'class', repository = repo }) {
    current = useClassAttendance(owner, lesson, repository);
    return null;
  }
  let ui!: ReactTestRenderer;
  await act(async () => { ui = create(<Harness />); });
  const retained = current.save;
  list.mockImplementation(async () => { await gate; return []; });
  await act(async () => {
    if (change === 'retry') current.retry();
    else ui.update(<Harness owner={change === 'owner' ? 'other' : 'owner'} lesson={change === 'lesson' ? 'other' : 'class'} repository={change === 'repository' ? other : repo} />);
  });
  expect(current.kind).toBe('loading');
  await act(async () => {
    expect(await retained('2026-10-20', 'present')).toBe(false);
    expect(await current.save('2026-10-20', 'present')).toBe(false);
  });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { release(); });
  expect(current.kind).toBe('ready');
  await act(async () => { expect(await retained('2026-10-20', 'present')).toBe(false); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { expect(await current.save('2026-10-20', 'present')).toBe(true); });
  expect(save).toHaveBeenCalledOnce();
  if (change !== 'retry') {
    await act(async () => { ui.update(<Harness />); });
    expect(current.kind).toBe('ready');
    await act(async () => { expect(await retained('2026-10-21', 'present')).toBe(false); });
    expect(save).toHaveBeenCalledOnce();
  }
  act(() => ui.unmount());
});

it('keeps a same-scope ready callback valid across benign renders and successful saves', async () => {
  let current!: ReturnType<typeof useClassAttendance>;
  const repo = { list: vi.fn(async () => []), save: vi.fn(async (draft: ClassAttendanceDraft) => ({ ...draft, schemaVersion: 1 as const, createdAt: 'created', updatedAt: 'updated' })) };
  function Harness() { current = useClassAttendance('owner', 'class', repo); return null; }
  let ui!: ReactTestRenderer;
  await act(async () => { ui = create(<Harness />); });
  const retained = current.save;
  await act(async () => { ui.update(<Harness />); });
  await act(async () => { expect(await retained('2026-10-20', 'present')).toBe(true); });
  await act(async () => { expect(await retained('2026-10-21', 'present')).toBe(true); });
  expect(repo.save).toHaveBeenCalledTimes(2);
  act(() => ui.unmount());
});


it.each([
  [new Error('Firebase: permission-denied private-project'), '出欠の保存結果を確認できませんでした。再読み込みして記録を確認してください。'],
  [new UserFacingError('この授業は削除されたか、利用できなくなりました。'), 'この授業は削除されたか、利用できなくなりました。'],
])('keeps authored attendance guidance but hides unknown repository errors', async (error, message) => {
  const repo = { list: vi.fn(async () => []), save: vi.fn(async () => { throw error; }) };
  let state!: ReturnType<typeof useClassAttendance>;
  function Harness() { state = useClassAttendance('owner', 'class', repo); return null; }
  let ui!: ReactTestRenderer;
  await act(async () => { ui = create(<Harness />); });
  await act(async () => { expect(await state.save('2026-10-20', 'present')).toBe(false); });
  expect(state.saveError).toBe(message);
  expect(repo.save).toHaveBeenCalledOnce();
  expect(repo.list).toHaveBeenCalledOnce();
  act(() => ui.unmount());
});
