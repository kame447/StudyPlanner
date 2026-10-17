import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClassAttendanceDraft } from '../domain/classAttendance';
import { createLocalClassAttendanceRepository, type ClassAttendanceRepository } from '../repositories/classAttendanceRepository';
import { deferred, MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import type { ScheduleTemplate } from '../types/domain';
import { TimetableClassDetail } from './TimetableClassDetail';

const template: ScheduleTemplate = { id: 'class', userId: 'owner', title: '数理論理', subject: '数学', type: 'school-event', weekday: 'mon', startTime: '09:00', endTime: '10:00', memo: '', active: true, createdAt: 'created', updatedAt: 'updated' };
let ui: ReactTestRenderer;
afterEach(() => { act(() => ui?.unmount()); vi.restoreAllMocks(); });
const button = (text: string) => ui.root.findAllByType('button').find(node => node.children.includes(text))!;
const counts = () => ui.root.findAllByType('dd').map(node => node.children.join(''));
function Host({ repository, target = template }: { repository: ClassAttendanceRepository; target?: ScheduleTemplate }) {
  const [open, setOpen] = useState(true);
  return open ? <TimetableClassDetail key={`${target.userId}:${target.id}`} template={target} plans={[]}
    attendanceRepository={repository} onEdit={() => setOpen(false)} onClose={() => setOpen(false)} />
    : <button onClick={() => setOpen(true)}>授業を開く</button>;
}

it('reopening a class waits for its already-admitted save before accepting history', async () => {
  const storage = new MemoryStorage();
  const local = createLocalClassAttendanceRepository(storage, { getScheduleTemplates: async () => [template] });
  const gate = deferred();
  const list = vi.fn(local.list);
  const save = vi.fn(async (draft: ClassAttendanceDraft) => { await gate.promise; return local.save(draft); });
  const repository = { list, save };
  await act(async () => { ui = create(<Host repository={repository} />); });
  expect(counts()).toEqual(['0', '0', '0']);
  act(() => button('記録').props.onClick());
  act(() => button('出席').props.onClick());
  let pending!: Promise<void>;
  await act(async () => { pending = ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  act(() => button('閉じる').props.onClick());
  await act(async () => { button('授業を開く').props.onClick(); });
  const readsBeforeSettlement = list.mock.calls.length;
  await act(async () => { gate.resolve(); await pending; });
  const persisted = await local.list(template.userId, template.id);
  console.log('ATTENDANCE_PENDING_SAVE_COUNTS', JSON.stringify({ readsBeforeSettlement, readsAfterSettlement: list.mock.calls.length, saves: save.mock.calls.length, persisted: persisted.length, displayed: counts() }));
  expect(persisted).toHaveLength(1);
  expect(counts()).toEqual(['1', '0', '0']);
  expect(list).toHaveBeenCalledTimes(2);
});

async function pendingFixture(outcome: 'success' | 'reject-before' | 'reject-after' | 'sync-throw' = 'success') {
  const storage = new MemoryStorage();
  const local = createLocalClassAttendanceRepository(storage, { getScheduleTemplates: async () => [template] });
  const gate = deferred();
  const list = vi.fn(local.list);
  const save = vi.fn(async (draft: ClassAttendanceDraft) => {
    await gate.promise;
    if (outcome === 'reject-before') throw Error('write failed');
    const record = await local.save(draft);
    if (outcome === 'reject-after') throw Error('acknowledgement failed');
    return record;
  });
  if (outcome === 'sync-throw') save.mockImplementation(() => { throw Error('synchronous write failure'); });
  const repository = { list, save };
  await act(async () => { ui = create(<Host repository={repository} />); });
  act(() => button('記録').props.onClick());
  act(() => button('出席').props.onClick());
  let pending!: Promise<void>;
  await act(async () => { pending = ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  return { local, gate, list, save, repository, pending };
}
async function closeAndReopen() {
  act(() => button('閉じる').props.onClick());
  await act(async () => { button('授業を開く').props.onClick(); });
}

it.each(['reject-before', 'reject-after'] as const)('reads actual persisted history after a retired save %s', async outcome => {
  const f = await pendingFixture(outcome);
  await closeAndReopen();
  expect(f.list).toHaveBeenCalledOnce();
  expect(counts()).toEqual([]);
  expect(button('記録').props.disabled).toBe(true);
  await act(async () => { f.gate.resolve(); await f.pending; });
  const expected = outcome === 'reject-after' ? '1' : '0';
  expect(counts()).toEqual([expected, '0', '0']);
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(button('記録').props.disabled).toBe(false);
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('releases the barrier even for a synchronously throwing repository and allows a fresh save', async () => {
  const f = await pendingFixture('sync-throw');
  expect(ui.root.findByProps({ role: 'alert' }).children).toContain('synchronous write failure');
  await closeAndReopen();
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(counts()).toEqual(['0', '0', '0']);
  f.save.mockImplementation(f.local.save);
  act(() => button('記録').props.onClick());
  act(() => button('欠席').props.onClick());
  await act(async () => { await ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(counts()).toEqual(['0', '1', '0']);
});

it.each(['owner', 'lesson'] as const)('does not delay a different %s or leak the old row/error', async dimension => {
  const f = await pendingFixture('reject-after');
  const target = { ...template, ...(dimension === 'owner' ? { userId: 'other-owner' } : { id: 'other-class' }) };
  await act(async () => { ui.update(<Host repository={f.repository} target={target} />); });
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(f.list).toHaveBeenLastCalledWith(target.userId, target.id);
  expect(counts()).toEqual(['0', '0', '0']);
  await act(async () => { f.gate.resolve(); await f.pending; });
  expect(counts()).toEqual(['0', '0', '0']);
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('does not block a different repository instance with the same owner and lesson', async () => {
  const f = await pendingFixture();
  act(() => ui.unmount());
  const separate = createLocalClassAttendanceRepository(new MemoryStorage(), { getScheduleTemplates: async () => [template] });
  const list = vi.fn(separate.list);
  await act(async () => { ui = create(<Host repository={{ ...separate, list }} />); });
  expect(list).toHaveBeenCalledOnce();
  expect(counts()).toEqual(['0', '0', '0']);
  await act(async () => { f.gate.resolve(); await f.pending; });
  expect(counts()).toEqual(['0', '0', '0']);
  expect(list).toHaveBeenCalledOnce();
});

it('abandons a closed waiting detail without dispatching its delayed list', async () => {
  const f = await pendingFixture();
  await closeAndReopen();
  expect(f.list).toHaveBeenCalledOnce();
  act(() => button('閉じる').props.onClick());
  await act(async () => { f.gate.resolve(); await f.pending; });
  expect(f.list).toHaveBeenCalledOnce();
  await act(async () => { button('授業を開く').props.onClick(); });
  expect(counts()).toEqual(['1', '0', '0']);
  expect(f.list).toHaveBeenCalledTimes(2);
});

it('only the latest repeated reopen reads after the save settles', async () => {
  const f = await pendingFixture();
  await closeAndReopen();
  await closeAndReopen();
  await closeAndReopen();
  expect(f.list).toHaveBeenCalledOnce();
  await act(async () => { f.gate.resolve(); await f.pending; });
  expect(counts()).toEqual(['1', '0', '0']);
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledOnce();
});

it('keeps a post-save list failure unread and supports an explicit retry', async () => {
  const f = await pendingFixture();
  f.list.mockRejectedValueOnce(Error('server unavailable'));
  await closeAndReopen();
  await act(async () => { f.gate.resolve(); await f.pending; });
  expect(counts()).toEqual([]);
  expect(button('記録').props.disabled).toBe(true);
  expect(ui.root.findByProps({ role: 'alert' }).children).toContain('出欠を読み込めませんでした。');
  await act(async () => { button('再読み込み').props.onClick(); });
  expect(counts()).toEqual(['1', '0', '0']);
  expect(f.list).toHaveBeenCalledTimes(3);
  expect(f.save).toHaveBeenCalledOnce();
});

it('preserves every historical record while accepting a correction after reopen', async () => {
  const local = createLocalClassAttendanceRepository(new MemoryStorage(), { getScheduleTemplates: async () => [template] });
  for (let index = 0; index < 120; index += 1) {
    const date = new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
    await local.save({ userId: template.userId, templateId: template.id, date, status: 'present' });
  }
  const gate = deferred();
  const list = vi.fn(local.list);
  const save = vi.fn(async (draft: ClassAttendanceDraft) => { await gate.promise; return local.save(draft); });
  await act(async () => { ui = create(<Host repository={{ list, save }} />); });
  act(() => ui.root.findByProps({ 'aria-label': '2020-01-01 出席を訂正' }).props.onClick());
  act(() => button('欠席').props.onClick());
  let pending!: Promise<void>;
  await act(async () => { pending = ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await closeAndReopen();
  await act(async () => { gate.resolve(); await pending; });
  expect(counts()).toEqual(['119', '1', '0']);
  expect(ui.root.findAllByType('time')).toHaveLength(120);
  expect(list).toHaveBeenCalledTimes(2);
});

it('waits for every admitted same-scope writer rather than the first settlement', async () => {
  const local = createLocalClassAttendanceRepository(new MemoryStorage(), { getScheduleTemplates: async () => [template] });
  const gates = [deferred(), deferred()];
  const list = vi.fn(local.list);
  let index = 0;
  const save = vi.fn(async (draft: ClassAttendanceDraft) => { const gate = gates[index++]; await gate.promise; return local.save(draft); });
  const repository = { list, save };
  await act(async () => { ui = create(<><Host repository={repository} /><Host repository={repository} /></>); });
  const submissions: Promise<void>[] = [];
  for (let owner = 0; owner < 2; owner += 1) {
    const detail = () => ui.root.findAllByType(TimetableClassDetail)[owner];
    const click = (text: string) => detail().findAllByType('button').find(node => node.children.includes(text))!.props.onClick();
    act(() => click('記録'));
    act(() => detail().findByType('input').props.onChange({ target: { value: `2020-01-0${owner + 1}` } }));
    act(() => click('出席'));
    await act(async () => { submissions.push(detail().findByType('form').props.onSubmit({ preventDefault() {} })); });
  }
  act(() => ui.unmount());
  await act(async () => { ui = create(<Host repository={repository} />); });
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => { gates[0].resolve(); await submissions[0]; });
  expect(list).toHaveBeenCalledTimes(2);
  expect(counts()).toEqual([]);
  await act(async () => { gates[1].resolve(); await submissions[1]; });
  expect(list).toHaveBeenCalledTimes(3);
  expect(counts()).toEqual(['2', '0', '0']);
});

it('retires a waiting read at the unmount commit before passive cleanup runs', async () => {
  const f = await pendingFixture();
  await closeAndReopen();
  expect(f.list).toHaveBeenCalledOnce();
  // Deliberately do not flush passive effects with act here: a fulfilled write
  // can queue its continuation between the unmount commit and passive cleanup.
  ui.unmount();
  f.gate.resolve();
  await f.pending;
  await Promise.resolve();
  await Promise.resolve();
  expect(f.list).toHaveBeenCalledOnce();
});
