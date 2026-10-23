import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClassAttendance } from '../domain/classAttendance';
import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';
import type { ScheduleTemplate } from '../types/domain';
import { deferred, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { TimetableClassDetail } from './TimetableClassDetail';
import { TimetableClassScheduleForm } from './TimetableClassScheduleForm';

const template: ScheduleTemplate = { id: 'class', userId: 'owner', title: '数理論理', subject: '数学', type: 'school-event', weekday: 'mon', periodNumber: 1, startTime: '09:00', endTime: '10:00', classroom: '101', memo: '配布資料', active: true, createdAt: 'created', updatedAt: 'updated' };
const attendance: ClassAttendance = { schemaVersion: 1, userId: 'owner', templateId: 'class', date: '2026-10-13', status: 'present', createdAt: 'created', updatedAt: 'updated' };
let ui: ReactTestRenderer;
afterEach(() => { act(() => ui?.unmount()); vi.restoreAllMocks(); });
async function mount(repository: ClassAttendanceRepository = { list: vi.fn(async () => [attendance]), save: vi.fn(async draft => ({ ...attendance, ...draft })) }) {
  const savePlan = vi.fn(async () => {}), edit = vi.fn(), close = vi.fn();
  await act(async () => { ui = create(<TimetableClassDetail template={template} plans={[
    plan({ id: 'linked', classTemplateId: 'class', title: 'レポート提出', date: '2099-10-15' }),
    plan({ id: 'other', classTemplateId: 'other', title: '別の授業' }),
    plan({ id: 'foreign', userId: 'other-owner', classTemplateId: 'class', title: '別ユーザー' }),
  ]} attendanceRepository={repository} onEdit={edit} onClose={close} onSavePlan={savePlan} />); });
  return { repository, savePlan, edit, close };
}
const button = (text: string) => ui.root.findAllByType('button').find(node => node.children.includes(text))!;

it('starts with concise detail and correct counts, hiding forms and filtering related schedules by owner/class', async () => {
  const f = await mount();
  expect(ui.root.findAllByType('form')).toHaveLength(0);
  expect(ui.root.findAllByType('dd').map(node => node.children.join(''))).toEqual(['1', '0', '0']);
  expect(JSON.stringify(ui.toJSON())).toContain('レポート提出');
  expect(JSON.stringify(ui.toJSON())).not.toContain('別の授業');
  expect(JSON.stringify(ui.toJSON())).not.toContain('別ユーザー');
  act(() => button('編集').props.onClick()); expect(f.edit).toHaveBeenCalledOnce();
  expect(f.repository.list).toHaveBeenCalledWith('owner', 'class');
});

it('corrects a historical date, blocks repeat submits and updates counts once', async () => {
  const gate = deferred<ClassAttendance>();
  const save = vi.fn(() => gate.promise);
  await mount({ list: vi.fn(async () => [attendance]), save });
  act(() => ui.root.findByProps({ 'aria-label': '2026-10-13 出席を訂正' }).props.onClick());
  expect(ui.root.findByType('input').props.value).toBe('2026-10-13');
  act(() => button('欠席').props.onClick());
  const submit = ui.root.findByType('form').props.onSubmit;
  let first!: Promise<void>;
  await act(async () => { first = submit({ preventDefault() {} }); await submit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith({ userId: 'owner', templateId: 'class', date: '2026-10-13', status: 'absent' });
  await act(async () => { gate.resolve({ ...attendance, status: 'absent' }); await first; });
  expect(ui.root.findAllByType('form')).toHaveLength(0);
  expect(ui.root.findAllByType('dd').map(node => node.children.join(''))).toEqual(['0', '1', '0']);
});

it('keeps a failed record editable and retry succeeds without inventing a count', async () => {
  const save = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ ...attendance, status: 'late-or-left' });
  await mount({ list: vi.fn(async () => []), save });
  act(() => button('記録').props.onClick()); act(() => button('遅刻・早退').props.onClick());
  await act(async () => { await ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(ui.root.findByProps({ role: 'alert' }).children).toContain('offline');
  expect(ui.root.findAllByType('dd').map(node => node.children.join(''))).toEqual(['0', '0', '0']);
  expect(button('保存').props.disabled).toBe(false);
  await act(async () => { await ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(ui.root.findAllByType('dd').map(node => node.children.join(''))).toEqual(['0', '0', '1']);
});

it('does not display zero counts or accept writes after a failed load; explicit retry reads again', async () => {
  const list = vi.fn().mockRejectedValueOnce(Error('permission-denied')).mockResolvedValueOnce([attendance]);
  const save = vi.fn(); await mount({ list, save });
  expect(ui.root.findAllByType('dd')).toHaveLength(0); expect(button('記録').props.disabled).toBe(true);
  await act(async () => { button('再読み込み').props.onClick(); });
  expect(list).toHaveBeenCalledTimes(2); expect(button('記録').props.disabled).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it('adds a schedule only after explicit action, using the existing plan callback with a distinct class reference', async () => {
  const f = await mount(); act(() => button('追加').props.onClick());
  expect(ui.root.findByType(TimetableClassScheduleForm)).toBeDefined();
  expect(f.savePlan).not.toHaveBeenCalled();
  expect(ui.root.findAllByType('form')).toHaveLength(1);
});

it('schedule input preserves values on failure, blocks duplicate submission and dismisses only after success', async () => {
  const gate = deferred(); const save = vi.fn(() => gate.promise); const close = vi.fn();
  await act(async () => { ui = create(<TimetableClassScheduleForm template={template} onSave={save} onClose={close} />); });
  act(() => ui.root.findAllByType('input').find(node => node.props.placeholder)?.props.onChange({ target: { value: '中間試験' } }));
  const submit = ui.root.findByType('form').props.onSubmit;
  let pending!: Promise<void>;
  await act(async () => { pending = submit({ preventDefault() {} }); await submit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', classTemplateId: 'class', sourceType: 'manual', title: '中間試験', repeat: 'none' }));
  await act(async () => { gate.reject(Error('offline')); await pending; });
  expect(close).not.toHaveBeenCalled(); expect(ui.root.findAllByType('input').find(node => node.props.placeholder)?.props.value).toBe('中間試験');
  save.mockResolvedValueOnce(undefined);
  await act(async () => { await ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(close).toHaveBeenCalledOnce();
});

it('a dismissed schedule form cannot close a replacement when an old save returns', async () => {
  const gate = deferred(); const oldClose = vi.fn(), newClose = vi.fn();
  await act(async () => { ui = create(<TimetableClassScheduleForm key="old" template={template} onSave={() => gate.promise} onClose={oldClose} />); });
  act(() => ui.root.findAllByType('input').find(node => node.props.placeholder)?.props.onChange({ target: { value: 'Old draft' } }));
  let pending!: Promise<void>; await act(async () => { pending = ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await act(async () => { ui.update(<TimetableClassScheduleForm key="new" template={template} onSave={vi.fn()} onClose={newClose} />); });
  await act(async () => { gate.resolve(); await pending; });
  expect(oldClose).not.toHaveBeenCalled(); expect(newClose).not.toHaveBeenCalled();
});
