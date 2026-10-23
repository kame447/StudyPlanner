import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimetableOcrImportDialog } from './TimetableOcrImportDialog';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { TimetableOcrResult } from '../lib/timetableOcrImport';
import type { TimetablePeriod, TimetablePeriodDraft } from '../types/domain';

const result: TimetableOcrResult = {
  periods: [{ periodNumber: 1, startTime: '09:00', endTime: '10:00' }],
  items: [{ weekday: 'mon', periodNumber: 1, startTime: '09:00', endTime: '10:00',
    title: '数学', subject: 'Math', classroom: '101', memo: 'Bring a book' }],
};
const savedPeriod = (draft: TimetablePeriodDraft): TimetablePeriod => ({ ...draft, id: 'saved-period',
  createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' });
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });
function setup(overrides = {}) {
  let props = { userId: 'owner', termId: 'term', fileName: 'timetable.png', result,
    existingPeriods: [], existingTemplates: [], onClose: vi.fn(),
    onSaveTimetablePeriod: vi.fn(async (draft: TimetablePeriodDraft) => savedPeriod(draft)),
    onSaveScheduleTemplate: vi.fn().mockResolvedValue(undefined), ...overrides };
  act(() => { renderer = create(<TimetableOcrImportDialog {...props} />); });
  return { get props() { return props; }, update(next: Partial<typeof props>) {
    props = { ...props, ...next }; act(() => renderer.update(<TimetableOcrImportDialog {...props} />));
  } };
}
const submit = () => renderer.root.findByProps({ className: 'primary-button timetable-ocr-save' });
const titleInput = () => renderer.root.findByProps({ placeholder: '授業名' });
const close = () => renderer.root.findAllByType('button').find(button => button.children.includes('閉じる'))!;
const backdrop = () => renderer.root.findByProps({ className: 'overlay modal-overlay timetable-ocr-overlay' });
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe('OCR timetable submitted draft ownership', () => {
  it('admits a batch only once before React publishes pending state', async () => {
    const gate = deferred<TimetablePeriod>();
    const savePeriod = vi.fn((_draft: TimetablePeriodDraft) => gate.promise);
    const ui = setup({ onSaveTimetablePeriod: savePeriod });
    const retained = submit().props.onClick;
    act(() => { retained(); retained(); });
    expect(savePeriod).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve(savedPeriod(savePeriod.mock.calls[0][0])));
    expect(ui.props.onSaveScheduleTemplate).toHaveBeenCalledTimes(1);
    expect(ui.props.onClose).toHaveBeenCalledTimes(1);
  });

  it('locks only the submitted draft and makes backdrop dismissal match the disabled Close button', async () => {
    const gate = deferred<TimetablePeriod>();
    const ui = setup({ onSaveTimetablePeriod: vi.fn(() => gate.promise) });
    const oldBackdropClick = backdrop().props.onClick;
    const oldTitleChange = titleInput().props.onChange;
    const oldAdd = renderer.root.findAllByType('button').find(button => button.children.includes('候補を追加'))!.props.onClick;
    const oldDelete = renderer.root.findByProps({ className: 'ghost-button timetable-delete-button' }).props.onClick;
    act(() => { submit().props.onClick(); oldBackdropClick(); oldTitleChange({ target: { value: 'Unsaved replacement' } }); oldAdd(); oldDelete(); });
    expect(ui.props.onClose).not.toHaveBeenCalled();
    expect(titleInput().props.value).toBe('数学');
    expect(renderer.root.findAllByProps({ className: 'timetable-ocr-item' })).toHaveLength(1);
    for (const control of [...renderer.root.findAllByType('input'), ...renderer.root.findAllByType('select'), ...renderer.root.findAllByType('button')]) {
      expect(control.props.disabled).toBe(true);
    }
    await act(async () => gate.resolve(savedPeriod({ userId: 'owner', termId: 'term', periodNumber: 1, label: '1', startTime: '09:00', endTime: '10:00' })));
    expect(ui.props.onSaveScheduleTemplate.mock.calls[0][0].title).toBe('数学');
    expect(ui.props.onClose).toHaveBeenCalledOnce();
  });

  it('preserves the edited draft after a failed save and accepts an explicit retry', async () => {
    const gate = deferred<TimetablePeriod>();
    const save = vi.fn().mockImplementationOnce(() => gate.promise).mockImplementation(async (draft: TimetablePeriodDraft) => savedPeriod(draft));
    const ui = setup({ onSaveTimetablePeriod: save });
    act(() => titleInput().props.onChange({ target: { value: 'Corrected Math' } }));
    act(() => submit().props.onClick());
    await act(async () => gate.reject(new Error('controlled write failure')));
    expect(titleInput().props.value).toBe('Corrected Math');
    expect(Boolean(titleInput().props.disabled)).toBe(false);
    expect(submit().props.disabled).toBe(false);
    expect(renderer.root.findByProps({ className: 'inline-error' }).children).toEqual(['controlled write failure']);
    expect(ui.props.onClose).not.toHaveBeenCalled();
    act(() => submit().props.onClick()); await settle();
    expect(ui.props.onSaveScheduleTemplate.mock.calls[0][0].title).toBe('Corrected Math');
    expect(ui.props.onClose).toHaveBeenCalledOnce();
  });

  it.each(['owner', 'term', 'file', 'unmount'] as const)('stops undispatched rows and old callbacks after %s changes', async boundary => {
    const gate = deferred<TimetablePeriod>();
    const ui = setup({ onSaveTimetablePeriod: vi.fn(() => gate.promise) });
    const retained = submit().props.onClick;
    act(() => { titleInput().props.onChange({ target: { value: 'Old draft' } }); });
    act(() => submit().props.onClick());
    if (boundary === 'unmount') act(() => renderer.unmount());
    else ui.update(boundary === 'owner' ? { userId: 'other' } : boundary === 'term' ? { termId: 'other-term' } : { fileName: 'new-timetable.png' });
    act(() => retained());
    await act(async () => gate.resolve(savedPeriod({ userId: 'owner', termId: 'term', periodNumber: 1, label: '1', startTime: '09:00', endTime: '10:00' })));
    expect(ui.props.onSaveTimetablePeriod).toHaveBeenCalledOnce();
    expect(ui.props.onSaveScheduleTemplate).not.toHaveBeenCalled();
    expect(ui.props.onClose).not.toHaveBeenCalled();
    if (boundary !== 'unmount') {
      expect(titleInput().props.value).toBe('数学');
      expect(submit().props.disabled).toBe(false);
    }
  });

  it.each(['owner', 'term'] as const)('does not display a rejected old %s save in the current draft', async boundary => {
    const gate = deferred<TimetablePeriod>();
    const ui = setup({ onSaveTimetablePeriod: vi.fn(() => gate.promise) });
    act(() => submit().props.onClick());
    ui.update(boundary === 'owner' ? { userId: 'other' } : { termId: 'other-term' });
    act(() => titleInput().props.onChange({ target: { value: 'Current draft' } }));
    await act(async () => gate.reject(new Error('private old failure')));
    expect(renderer.root.findAllByProps({ className: 'inline-error' })).toHaveLength(0);
    expect(titleInput().props.value).toBe('Current draft');
    expect(submit().props.disabled).toBe(false);
    expect(ui.props.onClose).not.toHaveBeenCalled();
  });

  it('keeps ordinary edits, add/remove and idle dismissal available', () => {
    const ui = setup();
    act(() => renderer.root.findAllByType('button').find(button => button.children.includes('候補を追加'))!.props.onClick());
    expect(renderer.root.findAllByProps({ className: 'timetable-ocr-item' })).toHaveLength(2);
    act(() => renderer.root.findAllByProps({ className: 'ghost-button timetable-delete-button' })[1].props.onClick());
    expect(renderer.root.findAllByProps({ className: 'timetable-ocr-item' })).toHaveLength(1);
    act(() => close().props.onClick());
    expect(ui.props.onClose).toHaveBeenCalledOnce();
  });
});
