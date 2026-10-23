import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { actual as makeActual, plan as makePlan } from '../repositories/localPersistenceConcurrency.testUtils';
import { DayView } from './DayView';
import { DayDetailModal } from './DayDetailModal';
import { WeekView } from './WeekView';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import { ActualEditorCard } from './ActualEditorCard';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import { TimeRangeFields, TimeWheelPicker } from './TimeRangeFields';
import { createPlanDraftFromPlan } from '../domain/planner';
import type { Actual, Plan } from '../types/domain';

const DATE = '2026-12-31'; const NEXT = '2027-01-01';
const plan = makePlan({ date: DATE, startTime: '23:30', endTime: '00:30', repeat: 'daily' });
const actual = makeActual({ occurrenceDate: DATE, actualStartTime: '23:30', actualEndTime: '00:30' });
const noop = () => undefined; const noopAsync = async () => undefined;
let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }) }));
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
function Day({ date, actuals, plans = [plan] }: { date: string; actuals: Actual[]; plans?: Plan[] }) {
  return <DayView userId="owner" selectedDate={date} plans={plans} actuals={actuals} monthEvents={[]}
    studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop}
    onMovePlan={noopAsync} onDeletePlan={noopAsync} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} onSaveActual={noopAsync}
    onSaveStandaloneActual={noopAsync} onLinkStandaloneActualToPlan={noopAsync} onDeleteActual={noopAsync} onOpenBookshelf={noop} onOpenAddMaterial={noop} />;
}
function recordButtons() { return renderer!.root.findAllByType('button').filter(node => node.props.className?.split(' ').includes('timeline-actual-block')); }

it.each([true, false])('clips both days and retains original Actual identity when linked=%s', linked => {
  const row = { ...actual, planId: linked ? plan.id : null };
  act(() => { renderer = create(<Day date={DATE} actuals={[row]} />); });
  expect(recordButtons()).toHaveLength(1);
  expect(recordButtons()[0].props['aria-label']).toContain('23:30から24:00');
  act(() => renderer!.update(<Day date={NEXT} actuals={[row]} />));
  expect(recordButtons()).toHaveLength(1);
  expect(recordButtons()[0].props['aria-label']).toContain('00:00から00:30');
  expect(recordButtons()[0].props.style.top).toBe('calc(0 * var(--timeline-hour-height) / 60)');
  act(() => recordButtons()[0].props.onClick());
  const modal = renderer!.root.findByType(DayDetailModal);
  if (linked) {
    expect(modal.props.detailPlan).toMatchObject({ id: plan.id, date: DATE, startTime: '23:30', endTime: '00:30' });
    expect(modal.props.detailActual).toEqual(row);
  } else expect(modal.props.standaloneActual).toEqual(row);
});

it('distinguishes the previous tail from tonight for two occurrences of one recurring plan', () => {
  const tonight = { ...actual, id: 'tonight', occurrenceDate: NEXT, title: 'Tonight' };
  act(() => { renderer = create(<Day date={NEXT} actuals={[actual, tonight]} />); });
  expect(recordButtons()).toHaveLength(2);
  act(() => recordButtons().find(node => node.props['aria-label'].includes('00:00から00:30'))!.props.onClick());
  expect(renderer!.root.findByType(DayDetailModal).props.detailActual).toEqual(actual);
  expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.date).toBe(DATE);
  act(() => renderer!.root.findByType(DayDetailModal).props.onClose());
  act(() => recordButtons().find(node => node.props['aria-label'].includes('23:30から24:00'))!.props.onClick());
  expect(renderer!.root.findByType(DayDetailModal).props.detailActual).toEqual(tonight);
  expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.date).toBe(NEXT);
});

it.each(['00:00', '24:00'])('does not draw a next-day tail for an exact %s end', endTime => {
  act(() => { renderer = create(<Day date={NEXT} actuals={[{ ...actual, actualEndTime: endTime }]} />); });
  expect(recordButtons()).toHaveLength(0);
});

it('draws week Actual blocks on both calendar days with clipped clocks', () => {
  act(() => { renderer = create(<WeekView userId="owner" selectedDate={DATE} plans={[plan]} actuals={[actual]} onOpenDay={noop} />); });
  const toggle = renderer!.root.findAllByType('button').find(node => node.children.includes('記録'))!;
  act(() => toggle.props.onClick());
  const blocks = renderer!.root.findAll(node => typeof node.props.title === 'string' && node.props.title.startsWith(actual.title + ' / '));
  expect(blocks.map(node => node.props.title)).toEqual([actual.title + ' / 23:30-24:00', actual.title + ' / 00:00-00:30']);
});

it('retains 60 minutes when reopening and saving the standalone editor', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => { renderer = create(<StandaloneActualEditorCard actual={{ ...actual, planId: null }} plans={[]} actuals={[]}
    onSaveStandaloneActual={save} onLinkStandaloneActualToPlan={noopAsync} onDeleteActual={noopAsync} onClose={noop} />); });
  const saveButton = renderer!.root.findAllByType('button').find(node => node.children.includes('保存'))!;
  await act(async () => { await saveButton.props.onClick(); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ occurrenceDate: DATE, actualStartTime: '23:30', actualEndTime: '00:30' }), actual.id);
});

it('retains the original overnight clocks in the linked editor', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => { renderer = create(<ActualEditorCard plan={plan} plans={[plan]} actuals={[actual]} actual={actual} onSaveActual={save} onEditPlan={noop}
    onDeletePlan={noopAsync} onDeleteActual={noopAsync} onClose={noop} forceOpen hideToggleButton hidePlanActions />); });
  const saveButton = renderer!.root.findAllByType('button').find(node => node.children.includes('記録保存'))!;
  await act(async () => { await saveButton.props.onClick(); });
  expect(save).toHaveBeenCalledWith(plan, expect.objectContaining({ occurrenceDate: DATE, actualStartTime: '23:30', actualEndTime: '00:30' }), actual.id);
});

it('preserves duration while moving the start in a Plan editor without changing generic time fields', () => {
  const change = vi.fn();
  act(() => { renderer = create(<PlanFieldsEditor draft={createPlanDraftFromPlan(plan)} onChange={change} timeRangeMode="edit" />); });
  expect(renderer!.root.findByType(TimeRangeFields).props.allowOvernight).toBe(true);
  const pickers = renderer!.root.findAllByType(TimeWheelPicker);
  expect(pickers[1].props.minMinutes).toBeUndefined();
  act(() => pickers[0].props.onChange('23:45'));
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ startTime: '23:45', endTime: '00:45' }));
});

it('keeps a recurring Plan prior-day tail tied to its original start day', () => {
  act(() => { renderer = create(<Day date={NEXT} actuals={[]} />); });
  const spans = renderer!.root.findAll(node => node.props['data-day-spanning-event'] === 'true');
  expect(spans).toHaveLength(2);
  const previous = spans.find(node => node.props.title.includes(`${DATE} 23:30`))!;
  act(() => previous.props.onClick());
  expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.date).toBe(DATE);
});

it('deletes the matching recurring occurrence when the tonight Actual is selected', async () => {
  const tonight = { ...actual, id: 'tonight', occurrenceDate: NEXT, title: 'Tonight' };
  const remove = vi.fn().mockResolvedValue(undefined);
  const props = Day({date: NEXT, actuals: [actual, tonight]}).props;
  act(() => { renderer = create(<DayView {...props} onDeleteOccurrence={remove} />); });
  act(() => recordButtons().find(node => node.props['aria-label'].includes('23:30から24:00'))!.props.onClick());
  const modal = renderer!.root.findByType(DayDetailModal);
  expect(modal.props.detailPlan.date).toBe(NEXT);
  await act(async () => { await modal.props.onDeleteOccurrence(); });
  expect(remove.mock.calls[0][0].start.date).toBe(NEXT);
});
it('treats an excluded previous occurrence as history when its Actual tail is opened next day', () => {
  const cancelled = { ...plan, excludedDates: [DATE] };
  act(() => { renderer = create(<Day date={NEXT} actuals={[actual]} plans={[cancelled]} />); });
  act(() => recordButtons()[0].props.onClick());
  const modal = renderer!.root.findByType(DayDetailModal);
  expect(modal.props.detailPlan.date).toBe(DATE);
  expect(modal.props.historyOnly).toBe(true);
  expect(modal.props.onDeleteOccurrence).toBeUndefined();
});

it('keeps the viewed-day record date for a multiday MonthEvent chip', () => {
  const monthEvent = { id: 'event', userId: 'owner', date: DATE, endDate: NEXT, title: 'Two-day event', startTime: '09:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const props = Day({date: NEXT, actuals: [], plans: []}).props;
  act(() => { renderer = create(<DayView {...props} monthEvents={[monthEvent]} />); });
  const chip = renderer!.root.find(node => node.props['data-day-spanning-event'] === 'true');
  act(() => chip.props.onClick());
  expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.date).toBe(NEXT);
});

it('retains occurrence deletion for a record on the second day of a multiday MonthEvent', async () => {
  const monthEvent = { id: 'event', userId: 'owner', date: DATE, endDate: NEXT, title: 'Two-day event', startTime: '09:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const row = { ...actual, planId: 'event', occurrenceDate: NEXT, actualStartTime: '09:00', actualEndTime: '10:00' };
  const remove = vi.fn().mockResolvedValue(undefined);
  const props = Day({date: NEXT, actuals: [row], plans: []}).props;
  act(() => { renderer = create(<DayView {...props} monthEvents={[monthEvent]} onDeleteOccurrence={remove} />); });
  act(() => recordButtons()[0].props.onClick());
  const modal = renderer!.root.findByType(DayDetailModal);
  expect(modal.props.detailPlan.date).toBe(NEXT);
  expect(modal.props.onDeleteOccurrence).toBeTypeOf('function');
  await act(async () => { await modal.props.onDeleteOccurrence(); });
  expect(remove.mock.calls[0][0].start.date).toBe(DATE);
});
it('does not retain the selected overnight Actual after switching owners', () => {
  const props = Day({date: NEXT, actuals: [actual]}).props;
  act(() => { renderer = create(<DayView {...props} />); });
  act(() => recordButtons()[0].props.onClick());
  expect(renderer!.root.findByType(DayDetailModal).props.detailActual.id).toBe(actual.id);
  act(() => { renderer!.update(<DayView {...props} userId="other-owner" />); });
  expect(recordButtons()).toHaveLength(0);
  const modal = renderer!.root.findByType(DayDetailModal);
  expect(modal.props.detailActual).toBeUndefined();
  expect(modal.props.detailPlan).toBeNull();
});


it('rejects equal clocks with a warning that does not prohibit valid overnight records', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const invalidActual = { ...actual, actualStartTime: '12:30', actualEndTime: '12:30' };
  act(() => { renderer = create(<ActualEditorCard plan={plan} plans={[plan]} actuals={[invalidActual]} actual={invalidActual} onSaveActual={save} onEditPlan={noop}
    onDeletePlan={noopAsync} onDeleteActual={noopAsync} onClose={noop} forceOpen hideToggleButton hidePlanActions />); });
  const saveButton = renderer!.root.findAllByType('button').find(node => node.children.includes('記録保存'))!;
  await act(async () => { await saveButton.props.onClick(); });
  expect(save).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ className: 'inline-error' }).map(node => node.children.join('')))
    .toContain('有効な開始時刻と終了時刻を入力してください。');
});
