import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanDraftFromPlan } from '../domain/planner';
import { createMonthEventOccurrenceDraft } from '../domain/recurringMonthEvent';
import { expandPlansForDate } from '../lib/planRecurrence';
import { doesMonthEventOccurOnDate } from '../lib/monthEvents';
import { MonthEventDialog } from '../components/MonthEventDialog';
import { DayCalendarDialog } from '../components/DatePickerDialogs';
import { PlanEditorPanel } from '../components/PlanEditorPanel';
import { RecurringPlanScopeDialog } from '../components/RecurringPlanScopeDialog';
import { createLocalFixture, deferred, microtasks, event, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const dates = ['2026-10-04', '2026-10-11', '2026-10-18'];
const source = plan({ repeat: 'weekly', repeatUntil: '2026-12-31' });
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ kind = 'plan', owner = 'owner' }: { kind?: 'plan' | 'month'; owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: () => undefined });
  return kind === 'month' ? <MonthEventDialog openDate={dates[1]} initialEventId="event" userId="owner" monthEvents={state.monthEvents}
    onSave={state.saveMonthEvent} onDelete={state.deleteMonthEvent} onClose={() => undefined} /> : <>
    <PlanEditorPanel draft={state.editorDraft} heading="Edit" submitLabel="Save" recurringEditMode={state.isRecurringPlanEdit}
      onChange={state.setEditorDraft} onSubmit={() => state.savePlanDraft(state.editorDraft!)} onCancel={state.closePlanEditor} />
    {state.pendingRecurringPlanAction && <RecurringPlanScopeDialog action="edit" plan={state.pendingRecurringPlanAction.plan}
      onSelect={state.confirmRecurringPlanScope} onClose={state.cancelRecurringPlanScope} />}
  </>;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

it.each(['single', 'future'] as const)('keeps Plan scope selection and preserves prior occurrences when selecting %s', async scope => {
  const fixture = createLocalFixture(); boundary.repository = fixture.repository;
  await fixture.repository.upsertPlan(source);
  const persist = vi.spyOn(fixture.repository, 'applyRecurringPlanMutation');
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const occurrence = expandPlansForDate(state.plans, dates[1])[0];
  await act(async () => { state.openEditPlan(occurrence); });
  await act(async () => { state.setEditorDraft({ ...createPlanDraftFromPlan(occurrence), title: 'Changed' }); });
  await act(async () => { await renderer!.root.findAllByType('button').find(b => b.children.includes('Save'))!.props.onClick(); });
  expect(renderer!.root.findAllByType(RecurringPlanScopeDialog)).toHaveLength(1);
  expect(persist).not.toHaveBeenCalled();
  await act(async () => { await state.confirmRecurringPlanScope(scope); });
  const saved = await fixture.repository.getPlans('owner');
  expect(dates.map(date => expandPlansForDate(saved, date)[0]?.title)).toEqual([
    source.title, 'Changed', scope === 'single' ? source.title : 'Changed',
  ]);
  expect(persist).toHaveBeenCalledOnce();
});

const button = (label: string) => renderer!.root.findAllByType('button').find(b => b.children.includes(label))!;
const click = async (label: string) => { await act(async () => { button(label).props.onClick(); await microtasks(); }); };
async function mountMonth() {
  const fixture = createLocalFixture(); boundary.repository = fixture.repository;
  await fixture.repository.upsertMonthEvent(event({ repeat: 'weekly', repeatUntil: '2026-12-31' }));
  await act(async () => { renderer = create(<Harness kind="month" />); });
  await act(async () => { await state.loadPlannerData('owner'); state.selectDate(dates[1]); });
  await act(async () => { renderer!.root.findByProps({ 'aria-label': 'タイトル' }).props.onChange({ target: { value: 'Changed' } }); });
  return fixture;
}
const titles = (rows: ReturnType<typeof event>[]) => dates.map(date => rows.filter(row => doesMonthEventOccurOnDate(row, date)).map(row => row.title));
it.each(['single', 'future'] as const)('asks before saving general events and preserves past dates for %s', async scope => {
  const fixture = await mountMonth();
  const single = vi.spyOn(fixture.repository, 'upsertMonthEvent');
  const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation');
  await click('保存');
  expect(persist).not.toHaveBeenCalled(); expect(single).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ 'aria-label': '繰り返し予定の更新範囲' })).toBeDefined();
  expect(renderer!.root.findByProps({ 'aria-label': '開始日' }).children.join('')).toContain('2026年10月11日');
  await click(scope === 'single' ? 'この予定だけ変更' : 'これ以降も全部変更');
  expect(persist).toHaveBeenCalledOnce(); expect(single).not.toHaveBeenCalled();
  expect(titles(await fixture.repository.getMonthEvents('owner'))).toEqual([
    ['Original event'], ['Changed'], [scope === 'single' ? 'Original event' : 'Changed'],
  ]);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(titles(state.monthEvents)).toEqual(titles(await fixture.repository.getMonthEvents('owner')));
});
it('cancels scope without writing and keeps typed input for a later save', async () => {
  const fixture = await mountMonth(); const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation');
  await click('保存'); await click('キャンセル');
  expect(persist).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ 'aria-label': 'タイトル' }).props.value).toBe('Changed');
  expect(titles(await fixture.repository.getMonthEvents('owner'))).toEqual(dates.map(() => ['Original event']));
  await click('保存'); await click('この予定だけ変更'); expect(persist).toHaveBeenCalledOnce();
});
it('retains a failed scope and draft, prevents double submits, and retries without partial changes', async () => {
  const fixture = await mountMonth(); const gate = deferred();
  const original = fixture.repository.applyRecurringMonthEventMutation;
  const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation').mockImplementationOnce(() => gate.promise);
  await click('保存'); await click('これ以降も全部変更'); await click('これ以降も全部変更');
  expect(persist).toHaveBeenCalledOnce();
  await act(async () => { gate.reject(new Error('offline')); await microtasks(); });
  expect(titles(await fixture.repository.getMonthEvents('owner'))).toEqual(dates.map(() => ['Original event']));
  expect(titles(state.monthEvents)).toEqual(dates.map(() => ['Original event']));
  expect(renderer!.root.findByProps({ 'aria-label': 'タイトル' }).props.value).toBe('Changed');
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度保存');
  persist.mockImplementation(original);
  await click('これ以降も全部変更'); expect(persist).toHaveBeenCalledTimes(2);
  expect(titles(await fixture.repository.getMonthEvents('owner'))).toEqual([['Original event'], ['Changed'], ['Changed']]);
});
it.each(['changed', 'deleted', 'owner'] as const)('rejects a %s source while scope selection is open', async reason => {
  const fixture = await mountMonth(); const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation');
  await click('保存');
  const source = state.monthEvents[0];
  if (reason === 'owner') await act(async () => { renderer!.update(<Harness kind="month" owner="other" />); await state.loadPlannerData('other'); });
  else {
    if (reason === 'changed') await fixture.repository.upsertMonthEvent({ ...source, title: 'Other device' });
    else await fixture.repository.deleteMonthEvent('owner', source.id);
    await act(async () => { await state.loadPlannerData('owner'); });
  }
  await click('これ以降も全部変更'); expect(persist).not.toHaveBeenCalled();
});
it('repairs the projection after a reload crosses a pending atomic save without changing newer navigation', async () => {
  const fixture = await mountMonth(); const gate = deferred();
  const original = fixture.repository.applyRecurringMonthEventMutation;
  vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation').mockImplementation(async (...args) => { await gate.promise; await original(...args); });
  await click('保存'); await click('これ以降も全部変更');
  await act(async () => { await state.loadPlannerData('owner'); state.changeMonth('2026-12-01'); });
  await act(async () => { gate.resolve(); await microtasks(); });
  expect(titles(state.monthEvents)).toEqual([['Original event'], ['Changed'], ['Changed']]);
  expect(state.monthDate).toBe('2026-12-01');
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['2026-10-03', '2027-01-03'])('keeps a future move to %s unsaved and offers single-occurrence editing', async date => {
  const fixture = await mountMonth(); const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation');
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '開始日' }).props.onClick(); });
  await act(async () => { renderer!.root.findByType(DayCalendarDialog).props.onSelectDate(date); });
  await click('保存'); await click('これ以降も全部変更');
  expect(persist).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('この予定だけ変更');
  await click('この予定だけ変更'); expect(persist).toHaveBeenCalledOnce();
  expect((await fixture.repository.getMonthEvents('owner')).find(row => row.title === 'Changed')).toMatchObject({ date, repeat: 'none' });
});

it('reconciles a committed write with a lost acknowledgement before allowing another scope attempt', async () => {
  const fixture = await mountMonth(); const original = fixture.repository.applyRecurringMonthEventMutation;
  const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation').mockImplementationOnce(async (...args) => {
    await original(...args); throw new Error('response lost');
  });
  await click('保存'); await click('これ以降も全部変更');
  expect(titles(state.monthEvents)).toEqual([['Original event'], ['Changed'], ['Changed']]);
  await click('これ以降も全部変更'); expect(persist).toHaveBeenCalledOnce();
  expect(await fixture.repository.getMonthEvents('owner')).toHaveLength(2);
});

it('blocks ordinary edits and deletes of both rows while the scoped save is pending', async () => {
  const fixture = await mountMonth(); const gate = deferred();
  const original = fixture.repository.applyRecurringMonthEventMutation;
  vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation').mockImplementation(async (...args) => { await gate.promise; await original(...args); });
  const ordinary = vi.spyOn(fixture.repository, 'upsertMonthEvent'); const remove = vi.spyOn(fixture.repository, 'deleteMonthEvent');
  await click('保存'); await click('これ以降も全部変更');
  const rows = [...state.monthEvents]; expect(rows).toHaveLength(2);
  for (const row of rows) {
    await act(async () => {
      await expect(state.saveMonthEvent(createMonthEventOccurrenceDraft(row, row.date), row.id)).rejects.toThrow('保存中');
      await expect(state.deleteMonthEvent(row)).rejects.toThrow('保存中');
    });
  }
  expect(ordinary).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  await act(async () => { gate.resolve(); await microtasks(); });
});

it('accepts an unchanged reload while the scope prompt is open', async () => {
  const fixture = await mountMonth(); const persist = vi.spyOn(fixture.repository, 'applyRecurringMonthEventMutation');
  await click('保存'); await act(async () => { await state.loadPlannerData('owner'); });
  await click('これ以降も全部変更'); expect(persist).toHaveBeenCalledOnce();
});
