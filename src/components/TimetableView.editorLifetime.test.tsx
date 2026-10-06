import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScheduleTemplate, TimetableTerm } from '../types/domain';
import { deferred, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import { TimetableView } from './TimetableView';
const term: TimetableTerm = { id: 'term', userId: 'owner', year: 2026, kind: 'custom', label: 'Term', isActive: true, createdAt: STAMP, updatedAt: STAMP };
const classes: ScheduleTemplate[] = ['A', 'B'].map((title, index) => ({ id: title, userId: 'owner', title, subject: 'Math', type: 'study', weekday: index === 0 ? 'mon' : 'tue', startTime: '12:00', endTime: '13:00', termId: 'term', periodNumber: 1, memo: '', active: true, createdAt: STAMP, updatedAt: STAMP }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
function mount() { const gate = deferred(); const save = vi.fn(() => gate.promise); const remove = vi.fn(() => gate.promise); act(() => { renderer = create(<TimetableView userId="owner" activeTerm={term} timetableTerms={[term]} timetablePeriods={[{ id: 'period', userId: 'owner', termId: 'term', periodNumber: 1, label: '1', startTime: '12:00', endTime: '13:00', createdAt: STAMP, updatedAt: STAMP }]} scheduleTemplates={classes} onActivateTerm={async () => term} onDeleteTerm={async () => { }} onClearTermData={async () => { }} onSaveTimetablePeriod={vi.fn()} onDeleteTimetablePeriod={async () => { }} onSaveScheduleTemplate={save} onDeleteScheduleTemplate={remove}/>); }); return { gate, save, remove }; }
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
