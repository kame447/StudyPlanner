import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyMonthEventDraft, createMonthEventDraftFromEvent } from '../domain/planner';
import { MonthEventDialog } from '../components/MonthEventDialog';
import { DayCalendarDialog } from '../components/DatePickerDialogs';
import { TimeWheelPicker } from '../components/TimeRangeFields';
import { validateMonthEventDraft } from '../lib/monthEventEditor';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { MonthEventDraft } from '../types/domain';
import { createMonthEventRecoveryRepository } from './monthEventRecovery.testUtils';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));

const DATE = '2026-10-14';
const notice = vi.fn();
const close = vi.fn();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer;
function Harness() {
  state = usePlannerDataState({ userId: 'owner', showNotice: notice });
  return <MonthEventDialog openDate={DATE} userId="owner" monthEvents={state.monthEvents}
    onSave={state.saveMonthEvent} onDelete={state.deleteMonthEvent} onClose={close} />;
}
function draft(overrides: Partial<MonthEventDraft> = {}): MonthEventDraft {
  return {
    ...createEmptyMonthEventDraft('owner', DATE),
    title: '翌朝までの予定', endDate: '2026-10-15', startTime: '18:00', endTime: '09:00',
    ...overrides,
  };
}
beforeEach(async () => {
  boundary.repository = createMonthEventRecoveryRepository('canonical').repository;
  notice.mockClear();
  close.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
});
afterEach(() => act(() => renderer.unmount()));

describe('MonthEvent save range through the canonical repository', () => {
  it.each([
    { endDate: '2026-10-15', endTime: '09:00' },
    { endDate: '2026-10-15', endTime: '18:00' },
    { endDate: '2026-10-17', endTime: '09:00' },
    { endDate: '2026-10-15', endTime: '00:00' },
    { endDate: DATE, endTime: '19:00' },
    { endDate: DATE, endTime: '24:00' },
    { endDate: undefined, endTime: '19:00' },
  ])('creates and reloads the valid range ending $endDate $endTime', async range => {
    const input = draft(range);
    expect(validateMonthEventDraft(input)).toBeNull();
    await act(async () => { await state.saveMonthEvent(input); });
    const [stored] = await boundary.repository.getMonthEvents('owner');
    expect(stored).toMatchObject({ ...input, endDate: input.endDate ?? input.date });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.monthEvents).toEqual([stored]);
  });

  it('edits an existing event to an overnight range without changing its identity', async () => {
    await act(async () => { await state.saveMonthEvent(draft({ endDate: DATE, endTime: '19:00' })); });
    const [original] = state.monthEvents;
    const input = { ...createMonthEventDraftFromEvent(original), endDate: '2026-10-15', endTime: '09:00' };
    await act(async () => { await state.saveMonthEvent(input, original.id); });
    const [stored] = await boundary.repository.getMonthEvents('owner');
    expect(stored).toMatchObject({ ...input, id: original.id });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.monthEvents).toEqual([stored]);
  });

  it.each([
    { endDate: DATE, endTime: '09:00' },
    { endDate: DATE, endTime: '18:00' },
    { endDate: '2026-10-13', endTime: '19:00' },
  ])('rejects the invalid range ending $endDate $endTime before persistence or navigation', async range => {
    const input = draft(range);
    expect(validateMonthEventDraft(input)).not.toBeNull();
    await act(async () => { state.openDay('2026-11-02'); });
    const before = state.selectedDate;
    const write = vi.spyOn(boundary.repository, 'upsertMonthEvent');
    await act(async () => { await expect(state.saveMonthEvent(input)).rejects.toBeInstanceOf(Error); });
    expect(write).not.toHaveBeenCalled();
    expect(state.monthEvents).toEqual([]);
    expect(await boundary.repository.getMonthEvents('owner')).toEqual([]);
    expect(state.selectedDate).toBe(before);
    expect(notice.mock.calls.some(call => call[1] === 'success')).toBe(false);
  });

  it.each(['', '   '])('rejects an empty title %j even for a valid multi-day range', async title => {
    const write = vi.spyOn(boundary.repository, 'upsertMonthEvent');
    await act(async () => { await expect(state.saveMonthEvent(draft({ title }))).rejects.toBeInstanceOf(Error); });
    expect(write).not.toHaveBeenCalled();
  });

  it('saves an overnight range entered in the real editor and reloads the exact persisted values', async () => {
    const root = renderer.root;
    await act(async () => { root.findByProps({ 'aria-label': 'タイトル' }).props.onChange({ target: { value: '翌朝までの予定' } }); });
    await act(async () => { root.findAllByType(TimeWheelPicker)[0].props.onChange('18:00'); });
    await act(async () => { root.findByProps({ 'aria-label': '終了日' }).props.onClick(); });
    await act(async () => { root.findByType(DayCalendarDialog).props.onSelectDate('2026-10-15'); });
    await act(async () => { root.findAllByType(TimeWheelPicker)[1].props.onChange('09:00'); });
    await act(async () => { root.findAllByType('button').find(button => button.children.includes('保存'))!.props.onClick(); });
    expect(root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(close).toHaveBeenCalledTimes(1);
    const [stored] = await boundary.repository.getMonthEvents('owner');
    expect(stored).toMatchObject(draft());
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.monthEvents).toEqual([stored]);
  });
});
