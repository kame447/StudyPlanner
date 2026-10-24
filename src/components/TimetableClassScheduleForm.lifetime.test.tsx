import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { TimetableClassDetail } from './TimetableClassDetail';
import { TimetableClassScheduleForm } from './TimetableClassScheduleForm';
import type { ScheduleTemplate } from '../types/domain';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';

const template: ScheduleTemplate = {
  id: 'class', userId: 'owner', title: 'Lesson', subject: 'Math', type: 'school-event',
  weekday: 'mon', periodNumber: 1, startTime: '09:00', endTime: '10:00',
  classroom: '', memo: '', active: true, createdAt: 'created', updatedAt: 'updated',
};
let ui: ReactTestRenderer | undefined;
afterEach(() => { act(() => ui?.unmount()); ui = undefined; });

it('retires an admitted save at unmount commit before passive cleanup runs', async () => {
  const gate = deferred();
  const close = vi.fn();
  await act(async () => { ui = create(<TimetableClassScheduleForm template={template} onSave={() => gate.promise} onClose={close} />); });
  act(() => ui!.root.findByProps({ placeholder: 'レポート提出、中間試験など' }).props.onChange({ target: { value: 'Draft' } }));
  let pending!: Promise<void>;
  await act(async () => { pending = ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  // Do not wrap this commit in act: that would flush passive cleanup and hide
  // the real promise-continuation window between commit and passive effects.
  ui!.unmount();
  gate.resolve(undefined);
  await pending;
  expect(close).not.toHaveBeenCalled();
});

it('preserves duplicate admission, failed-save draft and successful retry dismissal', async () => {
  const gate = deferred();
  const save = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
  const close = vi.fn();
  await act(async () => { ui = create(<TimetableClassScheduleForm template={template} onSave={save} onClose={close} />); });
  act(() => ui!.root.findByProps({ placeholder: 'レポート提出、中間試験など' }).props.onChange({ target: { value: 'Retry draft' } }));
  const submit = ui!.root.findByType('form').props.onSubmit;
  let pending!: Promise<void>;
  act(() => { pending = submit({ preventDefault() {} }); void submit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  await act(async () => { gate.reject(new Error('offline')); await pending; });
  expect(close).not.toHaveBeenCalled();
  expect(ui!.root.findByProps({ placeholder: 'レポート提出、中間試験など' }).props.value).toBe('Retry draft');
  expect(ui!.root.findByProps({ role: 'alert' }).children.join('')).toContain('予定を保存できませんでした');
  await act(async () => { await submit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'owner', classTemplateId: 'class', title: 'Retry draft' }));
});


it('does not dismiss the replacement attendance panel when an old schedule save settles after commit', async () => {
  const gate = deferred();
  const repository = { list: vi.fn(async () => []), save: vi.fn() };
  await act(async () => { ui = create(<TimetableClassDetail template={template} plans={[]} attendanceRepository={repository}
    onSavePlan={() => gate.promise} onEdit={() => {}} onClose={() => {}} />); });
  const button = (text: string) => ui!.root.findAllByType('button').find(node => node.children.includes(text))!;
  act(() => button('追加').props.onClick());
  act(() => ui!.root.findByProps({ placeholder: 'レポート提出、中間試験など' }).props.onChange({ target: { value: 'Schedule draft' } }));
  let pending!: Promise<void>;
  await act(async () => { pending = ui!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(button('記録').props.disabled).toBe(false);
  // This enabled UI action commits the replacement; act would also flush the
  // retired schedule form's passive effects and erase the continuation window.
  button('記録').props.onClick();
  expect(ui!.root.findByType('form').props['aria-label']).toBe('出欠を記録');
  gate.resolve(undefined);
  await pending;
  expect(ui!.root.findAllByType('form').map(node => node.props['aria-label'])).toEqual(['出欠を記録']);
  expect(repository.save).not.toHaveBeenCalled();
});
