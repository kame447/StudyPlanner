import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuickEntryModal } from './QuickEntryModal';
import { deferred, microtasks, plan } from '../repositories/localPersistenceConcurrency.testUtils';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.stubGlobal('document', { body: { style: { overflow: '', overscrollBehavior: '' } } }); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
function setup(save: () => Promise<void>, plans = [] as ReturnType<typeof plan>[]) {
  function Harness({ owner = 'a' }: { owner?: string }) {
    const [open, setOpen] = useState(true);
    return <><button id="reopen" onClick={() => setOpen(true)}>再入場</button>{open ? <QuickEntryModal
      userId={owner} selectedDate="2026-10-07" plans={plans} actuals={[]} materials={[]} subjects={[]}
      onClose={() => setOpen(false)} onSaveTodo={save} onSavePlan={save}
      onSaveStandaloneActual={save} onSaveLinkedActual={save} /> : null}</>;
  }
  act(() => { renderer = create(<Harness />); });
  return Harness;
}
function button(text: string) { return renderer!.root.findAllByType('button').find(node => node.children.join('') === text)!; }
function titleInput() { return renderer!.root.findByProps({ placeholder: '例: 英語課題 / 面接準備' }); }
function fillTitle(value: string) { act(() => titleInput().props.onChange({ target: { value } })); }

it.each(['todo', 'plan', 'actual', 'linked'])('an old %s completion cannot close a newer entry', async kind => {
  const gate = deferred(); const save = vi.fn(() => gate.promise); setup(save, kind === 'linked' ? [plan({ userId: 'a', date: '2026-10-07', startTime: '19:00', endTime: '19:30', title: '前の記録' })] : []);
  if (kind === 'plan') act(() => button('時間指定').props.onClick());
  if (kind === 'actual' || kind === 'linked') act(() => button('記録').props.onClick());
  if (kind === 'actual' || kind === 'linked') act(() => renderer!.root.findByProps({ placeholder: '例: 英語の復習' }).props.onChange({ target: { value: '前の記録' } }));
  else fillTitle('前の入力');
  if (kind !== 'todo') act(() => button('30分').props.onClick());
  let submitted!: Promise<void>;
  act(() => {
    if (kind === 'linked') { button('この予定に紐づけて保存').props.onClick(); submitted = gate.promise; }
    else submitted = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} });
  });
  expect(save).toHaveBeenCalledOnce();
  act(() => button('閉じる').props.onClick());
  act(() => renderer!.root.findByProps({ id: 'reopen' }).props.onClick());
  fillTitle('新しい未保存の入力');
  await act(async () => { gate.resolve(undefined); await submitted; await microtasks(); });
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(1);
  expect(titleInput().props.value).toBe('新しい未保存の入力');
});

it('owner replacement clears the draft and rejects the old owner completion', async () => {
  const gate = deferred(); const save = vi.fn(() => gate.promise); const Harness = setup(save);
  fillTitle('Aの入力'); let submitted!: Promise<void>;
  act(() => { submitted = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  act(() => { renderer!.update(<Harness owner="b" />); });
  expect(titleInput().props.value).toBe('');
  fillTitle('Bの入力');
  await act(async () => { gate.resolve(undefined); await submitted; });
  expect(titleInput().props.value).toBe('Bの入力');
});

it('a failed current save preserves the draft and allows a successful retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined); setup(save);
  fillTitle('再試行する入力');
  await act(async () => { await expect(renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} })).rejects.toThrow('save failed'); });
  expect(titleInput().props.value).toBe('再試行する入力');
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
});
