import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import type { Plan } from '../types/domain';
import { useScheduleOccurrenceActions } from './useScheduleOccurrenceActions';
const plan: Plan = { id: 'p', seriesId: 'p', userId: 'u', title: '数学', subject: '数学', type: 'study', date: '2026-10-05',
  startTime: '11:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: '', updatedAt: '' };
const occurrences = createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: plan.date, plans: [plan] }).occurrences;
let state: ReturnType<typeof useScheduleOccurrenceActions>;
let renderer: ReactTestRenderer | undefined;
const save = vi.fn(async () => undefined);
function Harness({ source = plan }: { source?: Plan }) {
  const currentOccurrences = createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: plan.date, plans: [source] }).occurrences;
  state = useScheduleOccurrenceActions({ contextKey: 'same-context', viewedDate: plan.date, plans: [source], monthEvents: [], actuals: [], occurrences: currentOccurrences, onSaveActual: save,
    onDismissMenu() {}, canMove: true, canDelete: () => true, onDelete: async () => undefined, onOpenDetail() {}, onOpenPreparedRecord() {} });
  return null;
}
beforeEach(() => { vi.stubGlobal('window', { setTimeout, clearTimeout }); save.mockClear(); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it('a retained close callback cannot clear a newer move session in the same context', async () => {
  act(() => { renderer = create(<Harness />); });
  await act(async () => { await state.select('move', occurrences[0]); });
  const oldClose = state.closeMove;
  const first = state.movingPlan;
  await act(async () => { await state.select('move', occurrences[0]); });
  const next = state.movingPlan;
  expect(next).not.toBe(first);
  act(() => { oldClose(); });
  expect(state.movingPlan).toBe(next);
  act(() => { state.closeMove(); });
  expect(state.movingPlan).toBeNull();
});

it('disables every action for a missing current occurrence and rechecks a retained handler', async () => {
  act(() => { renderer = create(<Harness />); });
  const oldSelect = state.select;
  act(() => { renderer!.update(<Harness source={{ ...plan, excludedDates: [plan.date] }} />); });
  const actions = state.actionsFor(occurrences[0]);
  expect(actions).toHaveLength(6);
  expect(actions.every(action => action.disabledReason?.includes('予定が変更されました'))).toBe(true);
  await act(async () => { await oldSelect('complete', occurrences[0]); });
  expect(save).not.toHaveBeenCalled();
});
