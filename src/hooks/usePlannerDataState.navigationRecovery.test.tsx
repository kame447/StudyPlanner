import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import { createEmptyPlanDraft, createEmptyMonthEventDraft } from '../domain/planner';
import type { TodoTask } from '../types/domain';
import { PlanEditorPanel } from '../components/PlanEditorPanel';
import { TodoView } from '../components/TodoView';
import { ScheduleToolbar } from '../components/ScheduleToolbar';

const repo = vi.hoisted(() => ({ upsertPlan: vi.fn(), scheduleTodoPlan: vi.fn(), upsertMonthEvent: vi.fn() }));
vi.mock('../repositories', () => ({ plannerRepository: repo }));
const PREVIOUS = '2026-09-15'; const SAVE = '2026-10-15'; const LATEST = '2026-11-15'; const AFTER = '2026-12-15';
const todo: TodoTask = { id: 'todo-a', userId: 'owner', title: 'Todo A', subject: '', type: 'study', estimatedMinutes: 30,
  dueDate: SAVE, memo: '', status: 'open', scheduledPlanId: null, createdAt: '', updatedAt: '' };
let state: UsePlannerDataStateResult; let renderer: ReactTestRenderer | undefined;
type Family = 'plan' | 'todo' | 'month';
function Harness({ ui, owner = 'owner' }: { owner?: string; ui?: 'plan' | 'todo' }) {
  state = usePlannerDataState({ userId: owner, showNotice: () => undefined });
  if (!ui) return null;
  return <>
    <ScheduleToolbar viewMode={state.viewMode} selectedDate={state.selectedDate} monthDate={state.monthDate}
      onChangeView={state.setViewMode} onChangeMonth={state.changeMonth} onChangeWeek={state.openWeek} onChangeDay={state.openDay} />
    {ui === 'plan' ? <PlanEditorPanel draft={state.editorDraft} submitLabel="Save" heading="Edit" onChange={state.setEditorDraft}
      onSubmit={() => state.savePlanDraft(state.editorDraft!)} onCancel={state.closePlanEditor} />
      : state.viewMode === 'todo' ? <TodoView userId="owner" selectedDate={state.selectedDate} todos={[todo]}
        onSaveTodo={state.saveTodo} onScheduleTodo={state.scheduleTodoAsPlan} onDeleteTodo={state.deleteTodo} /> : null}
  </>;
}
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const draft = (date: string, owner = 'owner') => ({ ...createEmptyPlanDraft(owner, date), title: 'Study', startTime: '09:00', endTime: '10:00' });
async function mount(ui?: 'plan' | 'todo') {
  await act(async () => { renderer = create(<Harness ui={ui} />); });
  await act(async () => { state.selectDate(PREVIOUS); });
}
function unmount() { act(() => renderer?.unmount()); renderer = undefined; }
const method = (family: Family) => family === 'plan' ? repo.upsertPlan : family === 'todo' ? repo.scheduleTodoPlan : repo.upsertMonthEvent;
async function begin(family: Family, date = SAVE, owner = 'owner') {
  const gate = deferred(); const persist = method(family); persist.mockReturnValueOnce(gate.promise);
  const before = persist.mock.calls.length;
  let done!: Promise<unknown>;
  await act(async () => {
    done = (family === 'plan' ? state.savePlanDraft(draft(date, owner))
      : family === 'todo' ? state.scheduleTodoAsPlan({ ...todo, id: `todo-${date}`, userId: owner }, draft(date, owner))
        : state.saveMonthEvent({ ...createEmptyMonthEventDraft(owner, date), title: 'Month event' })).catch(error => error);
  });
  expect(persist).toHaveBeenCalledTimes(before + 1);
  expect(state.selectedDate).toBe(date);
  return { gate, done, family };
}
async function finish(operation: Awaited<ReturnType<typeof begin>>, success: boolean) {
  const failure = new Error('offline');
  await act(async () => {
    if (success) operation.gate.resolve(); else operation.gate.reject(failure);
    const result = await operation.done;
    if (!success) expect(result).toBe(failure);
    else if (operation.family === 'todo') expect(result).toMatchObject({ sourceType: 'todo' });
    else expect(result).toBeUndefined();
  });
}
function selection() { return { date: state.selectedDate, month: state.monthDate, view: state.viewMode }; }
beforeEach(() => { for (const persist of Object.values(repo)) persist.mockReset().mockResolvedValue(undefined); });
afterEach(unmount);

it.each(['plan', 'todo', 'month'] as const)('%s failure respects explicit navigation, including equal values', async family => {
  for (const intent of ['selectDate', 'changeMonth', 'openDay', 'openWeek', 'same-date', 'same-month', 'none'] as const) {
    await mount(); const initial = selection(); const pending = await begin(family);
    await act(async () => {
      if (intent === 'same-date') state.selectDate(SAVE);
      else if (intent === 'same-month') state.changeMonth('2026-10-01');
      else if (intent !== 'none') state[intent](LATEST);
    });
    const intended = intent === 'none' ? initial : selection();
    await finish(pending, false);
    expect(selection(), `${family}/${intent}`).toEqual(intended);
    unmount();
  }
});

const pairs = (['plan', 'todo', 'month'] as const).flatMap(first => (['plan', 'todo', 'month'] as const).map(second => ({ first, second })));
it.each(pairs)('$first then $second preserves the latest surviving selection intent', async ({ first, second }) => {
  for (const aSuccess of [false, true]) for (const bSuccess of [false, true]) {
    for (const olderFirst of [false, true]) for (const navigateBetween of [false, true]) {
      await mount(); const a = await begin(first);
      if (navigateBetween) await act(async () => { state.openDay(LATEST); });
      const secondDate = navigateBetween ? AFTER : LATEST;
      const b = await begin(second, secondDate);
      if (olderFirst) {
        await finish(a, aSuccess); expect(state.selectedDate).toBe(secondDate);
        await finish(b, bSuccess);
      } else {
        await finish(b, bSuccess); expect(state.selectedDate).toBe(bSuccess ? secondDate : navigateBetween ? LATEST : SAVE);
        await finish(a, aSuccess);
      }
      const expected = bSuccess ? secondDate : navigateBetween ? LATEST : aSuccess ? SAVE : PREVIOUS;
      expect(selection(), JSON.stringify({ first, second, aSuccess, bSuccess, olderFirst, navigateBetween })).toEqual({
        date: expected, month: `${expected.slice(0, 7)}-01`, view: navigateBetween ? 'day' : 'month',
      });
      unmount();
    }
  }
});

it('drops old selection operations on owner/reset/unmount while preserving the visible calendar position', async () => {
  for (const boundary of ['owner', 'reset', 'unmount'] as const) {
    await mount(); const old = await begin('plan');
    const owner = boundary === 'owner' ? 'new-owner' : 'owner';
    await act(async () => {
      if (boundary === 'owner') renderer!.update(<Harness owner={owner} />);
      else if (boundary === 'reset') state.resetPlannerData();
      else { renderer!.unmount(); renderer = create(<Harness />); }
    });
    if (boundary !== 'unmount') expect(state.selectedDate).toBe(SAVE);
    await act(async () => { state.openDay(LATEST); });
    const newer = await begin('plan', AFTER, owner);
    await finish(newer, false);
    await act(async () => { old.gate.reject(new Error('old scope')); await old.done; });
    expect(selection()).toEqual({ date: LATEST, month: '2026-11-01', view: 'day' });
    unmount();
  }
});

it.each(['plan', 'todo'] as const)('preserves toolbar navigation after the actual %s editor closes while saving', async ui => {
  await mount(ui);
  const gate = deferred(); let submit: Promise<void> | undefined;
  if (ui === 'plan') {
    await act(async () => { state.setEditorDraft(draft(SAVE)); });
    repo.upsertPlan.mockReturnValueOnce(gate.promise);
    await act(async () => { submit = renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Save')!.props.onClick(); });
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  } else {
    await act(async () => { state.setViewMode('todo'); });
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '予定にする' }).props.onClick(); });
    repo.scheduleTodoPlan.mockReturnValueOnce(gate.promise);
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(renderer!.root.findAllByType('form')).toHaveLength(0);
    expect(repo.scheduleTodoPlan).toHaveBeenCalledTimes(1);
    await act(async () => { renderer!.root.findAllByProps({ role: 'tab' }).find(tab => tab.children.join('') === '月')!.props.onClick(); });
  }
  expect(state.selectedDate).toBe(SAVE);
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '次の期間へ' }).props.onClick(); });
  expect(state.selectedDate).toBe('2026-11-01');
  await act(async () => { gate.reject(new Error('offline')); await submit; });
  expect(state.selectedDate).toBe('2026-11-01');
  expect(state.monthDate).toBe('2026-11-01');
});
