import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScheduleTemplate, TimetableTerm } from '../types/domain';
import { deferred, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import { TimetableView } from './TimetableView';
const term: TimetableTerm = { id: 'term', userId: 'owner', year: 2026, kind: 'custom', label: 'Term', isActive: true, createdAt: STAMP, updatedAt: STAMP };
const classes: ScheduleTemplate[] = ['A', 'B'].map((title, index) => ({ id: title, userId: 'owner', title, subject: 'Math', type: 'study', weekday: index === 0 ? 'mon' : 'tue', startTime: '12:00', endTime: '13:00', termId: 'term', periodNumber: 1, memo: '', active: true, createdAt: STAMP, updatedAt: STAMP }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
function mount(termOverrides: Partial<TimetableTerm> = {}) { const activeTerm = { ...term, ...termOverrides }; const gate = deferred(); const save = vi.fn(() => gate.promise); const remove = vi.fn(() => gate.promise); act(() => { renderer = create(<TimetableView userId="owner" activeTerm={activeTerm} timetableTerms={[activeTerm]} timetablePeriods={[{ id: 'period', userId: 'owner', termId: 'term', periodNumber: 1, label: '1', startTime: '12:00', endTime: '13:00', createdAt: STAMP, updatedAt: STAMP }]} scheduleTemplates={classes} onActivateTerm={async () => term} onDeleteTerm={async () => { }} onClearTermData={async () => { }} onSaveTimetablePeriod={vi.fn()} onDeleteTimetablePeriod={async () => { }} onSaveScheduleTemplate={save} onDeleteScheduleTemplate={remove}/>); }); return { gate, save, remove }; }
function open(title: string) { act(() => renderer.root.findByProps({ 'aria-label': `${title === 'A' ? '月' : '火'}曜 1限 ${title}を編集` }).props.onClick({ detail: 0 })); }
function titleInput() { return renderer.root.findAllByType('input').find(node => node.props.autoComplete === 'off')!; }
it('an earlier save cannot dismiss the newer editor draft', async () => { const { gate } = mount(); open('A'); let saving!: Promise<void>; await act(async () => { saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); }); act(() => renderer.root.findAllByType('button').find(node => node.children.includes('閉じる'))!.props.onClick()); open('B'); act(() => titleInput().props.onChange({ target: { value: 'New unsaved B' } })); await act(async () => { gate.resolve(); await saving; }); expect(renderer.root.findAllByType('form')).toHaveLength(1); expect(titleInput().props.value).toBe('New unsaved B'); });
it.each(['A', 'B'])('late save keeps a reopened %s editor, including the same target', async (target) => {
    const { gate, save } = mount();
    open('A');
    let saving!: Promise<void>;
    await act(async () => { saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'A' }), 'A');
    act(() => renderer.root.findByProps({ className: 'overlay modal-overlay timetable-modal-overlay' }).props.onClick());
    open(target);
    if (target === 'B') act(() => titleInput().props.onChange({ target: { value: 'New draft' } }));
    await act(async () => { gate.resolve(); await saving; });
    expect(titleInput().props.value).toBe(target === 'B' ? 'New draft' : 'A');
});
it('late deletion keeps the newer editor draft', async () => {
    const { gate, remove } = mount();
    open('A');
    act(() => renderer.root.findAllByType('button').find(node => node.children.includes('授業を削除'))!.props.onClick());
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'A' }));
    act(() => renderer.root.findAllByType('button').find(node => node.children.includes('閉じる'))!.props.onClick());
    open('B');
    act(() => titleInput().props.onChange({ target: { value: 'New B' } }));
    await act(async () => { gate.resolve(); });
    expect(titleInput().props.value).toBe('New B');
});
it('successful save closes its unchanged editor and duplicate submit is not dispatched', async () => {
    const { gate, save } = mount();
    open('A');
    const submit = renderer.root.findByType('form').props.onSubmit;
    let first!: Promise<void>;
    await act(async () => { first = submit({ preventDefault: vi.fn() }); await submit({ preventDefault: vi.fn() }); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await first; });
    expect(renderer.root.findAllByType('form')).toEqual([]);
});
it('failed save retains its draft and unlocks saving', async () => {
    const { gate } = mount();
    open('A');
    let saving!: Promise<unknown>;
    await act(async () => { saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }).catch((error: unknown) => error); });
    await act(async () => { gate.reject(Error('save failed')); expect(await saving).toBeInstanceOf(Error); });
    expect(titleInput().props.value).toBe('A');
    expect(renderer.root.findByProps({ className: 'primary-button timetable-editor-save' }).props.disabled).toBe(false);
});

it('new-class success still dismisses its editor without a second create', async () => {
  const { gate, save } = mount();
  act(() => renderer.root.findByProps({ 'aria-label': '水曜 1限 授業を追加' }).props.onClick({ detail: 0 }));
  act(() => titleInput().props.onChange({ target: { value: 'New class' } }));
  let saving!: Promise<void>;
  await act(async () => { saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'New class' }), undefined);
  await act(async () => { gate.resolve(); await saving; });
  expect(renderer.root.findAllByType('form')).toEqual([]);
  expect(save).toHaveBeenCalledTimes(1);
});

it('successful deletion closes its unchanged editor and blocks duplicate dispatch', async () => {
  const { gate, remove } = mount();
  open('A');
  const click = renderer.root.findAllByType('button').find(node => node.children.includes('授業を削除'))!.props.onClick;
  act(() => { click(); click(); });
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => { gate.resolve(); });
  expect(renderer.root.findAllByType('form')).toEqual([]);
});


function editorControls() {
  return renderer.root.findByType('form').findAll(node =>
    ['input', 'select', 'textarea'].includes(String(node.type)) ||
    (node.type === 'button' && node.props.className?.startsWith('segment')),
  );
}

it.each(['existing', 'new'])('locks every editable control in the submitting %s class session', async (mode) => {
  const { gate, save } = mount({ usesAlternatingWeeks: true });
  if (mode === 'existing') open('A');
  else act(() => renderer.root.findByProps({ 'aria-label': '水曜 1限 授業を追加' }).props.onClick({ detail: 0 }));
  act(() => titleInput().props.onChange({ target: { value: 'Submitted class' } }));
  act(() => renderer.root.findAllByType('button').find(node => node.children.includes('隔週'))!.props.onClick());
  const before = editorControls().map(node => ({ value: node.props.value, className: node.props.className }));
  expect(editorControls()).toHaveLength(12);
  const submit = renderer.root.findByType('form').props.onSubmit;
  const changeTitle = titleInput().props.onChange;
  let saving!: Promise<void>;
  await act(async () => {
    saving = submit({ preventDefault: vi.fn() });
    // A callback already queued before the pending-state render must be blocked too.
    changeTitle({ target: { value: 'Too late in the same tick' } });
  });
  expect(editorControls().every(node => node.props.disabled === true)).toBe(true);
  expect(titleInput().props.value).toBe('Submitted class');
  act(() => {
    for (const node of editorControls()) {
      if (node.type === 'button') node.props.onClick();
      else node.props.onChange({ target: { value: node.type === 'select' ? '2' : 'Later draft' } });
    }
  });
  expect(editorControls().map(node => ({ value: node.props.value, className: node.props.className }))).toEqual(before);
  expect(renderer.root.findAllByType('button').find(node => node.children.includes('閉じる'))!.props.disabled).not.toBe(true);
  await act(async () => { await submit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Submitted class', weekInterval: 2 }), mode === 'existing' ? 'A' : undefined);
  await act(async () => { gate.resolve(); await saving; });
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
  expect(save).toHaveBeenCalledTimes(1);
});

it.each(['existing', 'new'])('unlocks the failed %s class draft for editing and retry', async (mode) => {
  const { gate, save } = mount();
  if (mode === 'existing') open('A');
  else act(() => renderer.root.findByProps({ 'aria-label': '水曜 1限 授業を追加' }).props.onClick({ detail: 0 }));
  act(() => titleInput().props.onChange({ target: { value: 'Submitted class' } }));
  let saving!: Promise<unknown>;
  await act(async () => {
    saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }).catch((error: unknown) => error);
  });
  await act(async () => { gate.reject(Error('save failed')); expect(await saving).toBeInstanceOf(Error); });
  expect(editorControls().every(node => node.props.disabled !== true)).toBe(true);
  expect(titleInput().props.value).toBe('Submitted class');
  act(() => titleInput().props.onChange({ target: { value: 'Corrected class' } }));
  save.mockResolvedValueOnce(undefined);
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Corrected class' }), mode === 'existing' ? 'A' : undefined);
  expect(save).toHaveBeenCalledTimes(2);
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
});

it.each(['A', 'B'])('keeps reopened %s editable while a prior session save is pending or fails', async (target) => {
  const { gate, save } = mount();
  open('A');
  let saving!: Promise<unknown>;
  await act(async () => {
    saving = renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }).catch((error: unknown) => error);
  });
  act(() => renderer.root.findAllByType('button').find(node => node.children.includes('閉じる'))!.props.onClick());
  open(target);
  expect(editorControls().every(node => node.props.disabled !== true)).toBe(true);
  act(() => titleInput().props.onChange({ target: { value: 'Reopened draft' } }));
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ className: 'primary-button timetable-editor-save' }).props.disabled).toBe(true);
  await act(async () => { gate.reject(Error('old save failed')); expect(await saving).toBeInstanceOf(Error); });
  expect(titleInput().props.value).toBe('Reopened draft');
  expect(editorControls().every(node => node.props.disabled !== true)).toBe(true);
  expect(renderer.root.findByProps({ className: 'primary-button timetable-editor-save' }).props.disabled).toBe(false);
});

it('locks the deleting session without locking a reopened draft', async () => {
  const { gate, remove } = mount();
  open('A');
  const changeTitle = titleInput().props.onChange;
  act(() => {
    renderer.root.findAllByType('button').find(node => node.children.includes('授業を削除'))!.props.onClick();
    changeTitle({ target: { value: 'Cannot save this edit' } });
  });
  expect(editorControls().every(node => node.props.disabled === true)).toBe(true);
  expect(titleInput().props.value).toBe('A');
  act(() => renderer.root.findByProps({ className: 'overlay modal-overlay timetable-modal-overlay' }).props.onClick());
  open('B');
  expect(editorControls().every(node => node.props.disabled !== true)).toBe(true);
  act(() => titleInput().props.onChange({ target: { value: 'Reopened B' } }));
  await act(async () => { gate.resolve(); });
  expect(titleInput().props.value).toBe('Reopened B');
  expect(remove).toHaveBeenCalledTimes(1);
});
