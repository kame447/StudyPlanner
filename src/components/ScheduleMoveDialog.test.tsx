import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleMoveDialog } from './ScheduleMoveDialog';
import type { Plan } from '../types/domain';
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null } }) }));
const plan: Plan = { id: 'p', seriesId: 'p', userId: 'u', title: '数学', subject: '数学', type: 'study', date: '2026-10-05',
  startTime: '11:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '' };
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
it.each([true, false])('isolates a replaced plan from an older move attempt, success=%s', async success => {
  const old = deferred(); const fresh = deferred(); const oldClose = vi.fn(); const freshClose = vi.fn();
  act(() => { renderer = create(<ScheduleMoveDialog plan={plan} onMove={() => old.promise} onClose={oldClose} />); });
  let oldSubmission!: Promise<void>; act(() => { oldSubmission = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  const next = { ...plan, id: 'next', date: '2026-10-06' };
  act(() => { renderer!.update(<ScheduleMoveDialog plan={next} onMove={() => fresh.promise} onClose={freshClose} />); });
  let freshSubmission!: Promise<void>; act(() => { freshSubmission = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await act(async () => { if (success) old.resolve(); else old.reject(Error('old failure')); await oldSubmission; });
  expect(oldClose).not.toHaveBeenCalled(); expect(freshClose).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByType('input').every(input => input.props.disabled)).toBe(true);
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(renderer!.root.findAllByType('input')[0].props.value).toBe(next.date);
  await act(async () => { fresh.resolve(); await freshSubmission; });
  expect(freshClose).toHaveBeenCalledOnce();
});
it('does not close after its pending attempt was unmounted', async () => {
  const gate = deferred(); const close = vi.fn();
  act(() => { renderer = create(<ScheduleMoveDialog plan={plan} onMove={() => gate.promise} onClose={close} />); });
  let done!: Promise<void>; act(() => { done = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  act(() => { renderer!.unmount(); renderer = undefined; });
  await act(async () => { gate.resolve(); await done; }); expect(close).not.toHaveBeenCalled();
});
