import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayTimetableImportDialog } from './DayTimetableImportDialog';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { TimetableImportCandidate } from '../lib/timetableImport';

const candidates: TimetableImportCandidate[] = ['one', 'two'].map((id, index) => ({
  id, sourceId: id, templates: [], title: id, subject: '', type: 'study', weekday: 'wed',
  termId: 'term', startTime: `${9 + index}:00`.padStart(5, '0'), endTime: `${10 + index}:00`,
  periodLabel: '', classroom: '', memo: '', isGrouped: false,
}));
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
function setup(overrides = {}) {
  let props = { open: true, dateLabel: 'October 7', selectedDate: '2026-10-07', userId: 'owner',
    candidates, importedSourceIds: new Set<string>(), onSavePlan: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), ...overrides };
  act(() => { renderer = create(<DayTimetableImportDialog {...props} />); });
  return { get props() { return props; }, update(next: Partial<typeof props>) {
    props = { ...props, ...next }; act(() => renderer.update(<DayTimetableImportDialog {...props} />));
  } };
}
const submit = () => renderer.root.findByProps({ className: 'primary-button' });
const inputs = () => renderer.root.findAllByType('input');
const close = () => renderer.root.findAllByType('button').find(button => button.children.includes('閉じる'))!;
async function flush() { await act(async () => { await Promise.resolve(); }); }

describe('timetable import lifetime', () => {
  it('admits once synchronously and retains the lock across close/reopen without closing the newer session', async () => {
    const gate = deferred(); const save = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
    const ui = setup({ onSavePlan: save });
    const retained = submit().props.onClick;
    act(() => { retained(); retained(); });
    expect(save).toHaveBeenCalledTimes(1);
    act(() => close().props.onClick()); ui.update({ open: false }); ui.update({ open: true });
    expect(submit().props.disabled).toBe(true);
    act(() => { submit().props.onClick(); retained(); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); });
    expect(save.mock.calls.map(([draft]) => draft.sourceId)).toEqual(['one', 'two']);
    expect(ui.props.onClose).toHaveBeenCalledTimes(1);
    expect(submit().props.disabled).toBe(true);
    expect(inputs().map(input => input.props.disabled)).toEqual([true, true]);
    // A retained callback after acknowledgment still cannot replay stale props.
    act(() => retained()); await flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('retains a partial failure across reopen and retries only the failed/unstarted sources', async () => {
    const gate = deferred(); const save = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
    const ui = setup({ onSavePlan: save });
    act(() => submit().props.onClick()); await flush();
    expect(save).toHaveBeenCalledTimes(2);
    ui.update({ open: false });
    await act(async () => gate.reject(new Error('offline')));
    ui.update({ open: true });
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
    expect(inputs().map(input => [input.props.checked, input.props.disabled])).toEqual([[false, true], [true, false]]);
    act(() => submit().props.onClick()); await flush();
    expect(save.mock.calls.map(([draft]) => draft.sourceId)).toEqual(['one', 'two', 'two']);
    expect(ui.props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'date', 'unmount'] as const)('stops undispatched rows after %s and fences old completion', async boundary => {
    const gate = deferred(); const save = vi.fn(() => gate.promise); const ui = setup({ onSavePlan: save });
    const retained = submit().props.onClick;
    act(() => retained());
    if (boundary === 'unmount') act(() => renderer.unmount());
    else ui.update(boundary === 'owner' ? { userId: 'other' } : { selectedDate: '2026-10-08' });
    act(() => retained());
    await act(async () => gate.resolve());
    expect(save).toHaveBeenCalledTimes(1);
    expect(ui.props.onClose).not.toHaveBeenCalled();
    if (boundary !== 'unmount') expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });

  it.each(['owner', 'date'] as const)('does not disclose a rejected old %s operation in the new context', async boundary => {
    const gate = deferred(); const ui = setup({ onSavePlan: vi.fn(() => gate.promise) });
    act(() => submit().props.onClick());
    ui.update(boundary === 'owner' ? { userId: 'other' } : { selectedDate: '2026-10-08' });
    await act(async () => gate.reject(new Error('old failure')));
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(submit().props.disabled).toBe(false);
  });

  it('does not reselect a user-excluded class when another class is published', async () => {
    const gate = deferred(); const ui = setup({ onSavePlan: vi.fn(() => gate.promise) });
    act(() => inputs()[1].props.onChange());
    act(() => submit().props.onClick());
    ui.update({ importedSourceIds: new Set(['one']) });
    expect(inputs()[1].props.checked).toBe(false);
    await act(async () => gate.resolve());
    expect(ui.props.onSavePlan).toHaveBeenCalledTimes(1);
  });

  it('allows import again after a published plan was subsequently deleted', async () => {
    const ui = setup();
    act(() => submit().props.onClick()); await flush();
    ui.update({ importedSourceIds: new Set(['one', 'two']), open: false });
    ui.update({ importedSourceIds: new Set(), open: true });
    expect(inputs().map(input => [input.props.checked, input.props.disabled])).toEqual([[true, false], [true, false]]);
    act(() => submit().props.onClick()); await flush();
    expect(ui.props.onSavePlan).toHaveBeenCalledTimes(4);
  });
});
