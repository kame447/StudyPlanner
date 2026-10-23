import { BrowserEventTarget } from '../lib/timelineDragInteractionLock.testUtils';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { ScheduleMoveModeBanner } from './ScheduleMoveModeBanner';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import type { Actual, Plan } from '../types/domain';

vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: ReactNode) => node }));
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null } }) }));
const noop = () => undefined;
const plan: Plan = { id: 'plan', seriesId: 'plan', userId: 'owner', title: '数学', subject: '数学', type: 'study', date: '2026-10-05',
  startTime: '11:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
  memo: '内容', materialId: 'm', materialName: '問題集', createdAt: '', updatedAt: '' };
const classes = new Set<string>();
const scroll = { scrollLeft: 0, scrollTop: 0, scrollWidth: 900, clientWidth: 300, getBoundingClientRect: () => ({ left: 0, right: 300 }) };
const column = { getBoundingClientRect: () => ({ width: 300, height: 1440 }) };
class FakeElement extends EventTarget {
  isConnected = true;
  dataset: { scheduleOccurrenceId?: string };
  style = {};
  focus = vi.fn(); blur = vi.fn(); setPointerCapture = vi.fn();
  constructor(id?: string, private menu = false) { super(); this.dataset = { scheduleOccurrenceId: id }; }
  closest(selector: string) {
    if (selector.includes('data-schedule-item-delete-action')) return this.menu ? this : null;
    if (selector.includes('data-schedule-occurrence-id')) return this.dataset.scheduleOccurrenceId ? this : null;
    if (selector.includes('scroll')) return scroll;
    return column;
  }
  getBoundingClientRect() { return { top: 270, left: 20, right: 280, bottom: 330, width: 260, height: 60 }; }
}
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Element', FakeElement);
  classes.clear();
  vi.stubGlobal('window', Object.assign(new BrowserEventTarget(), { setTimeout, clearTimeout, requestAnimationFrame: noop,
    innerWidth: 390, innerHeight: 844, getComputedStyle: () => ({}), matchMedia: () => ({ matches: true, addEventListener: noop, removeEventListener: noop }) }));
  vi.stubGlobal('document', Object.assign(new BrowserEventTarget(), { body: { style: {} }, visibilityState: 'visible',
    documentElement: { dataset: {}, style: {}, classList: { add: (x: string) => classes.add(x), remove: (x: string) => classes.delete(x), contains: (x: string) => classes.has(x) } } }));
  vi.stubGlobal('navigator', { vibrate: vi.fn() });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(kind: 'day' | 'week', actuals: Actual[] = [], extra: Partial<ComponentProps<typeof DayView>> = {}) {
  const callbacks = { onEditPlan: vi.fn(), onDuplicatePlan: vi.fn(), onMovePlan: vi.fn(async () => undefined),
    onDeletePlan: vi.fn(async () => undefined), onDeleteMonthEvent: vi.fn(async () => undefined),
    onSaveActual: vi.fn(async (_plan: Plan, _draft: unknown): Promise<void> => undefined), onSaveStandaloneActual: vi.fn(async () => undefined),
    onLinkStandaloneActualToPlan: vi.fn(async () => undefined), onDeleteActual: vi.fn(async () => undefined), onChangeDay: vi.fn(), onChangeWeek: vi.fn() };
  const dayProps: ComponentProps<typeof DayView> = { ...callbacks, selectedDate: plan.date, userId: plan.userId, plans: [plan], actuals, monthEvents: [],
    studySubjects: [], studyMaterials: [], scheduleTemplates: [], timetableTermId: '', onSavePlan: vi.fn(async () => undefined), onOpenBookshelf: noop, onOpenAddMaterial: noop, ...extra };
  const tree = () => kind === 'day' ? <DayView {...dayProps} /> : <WeekView {...dayProps} onChangeWeek={callbacks.onChangeWeek} onOpenDay={callbacks.onChangeDay} onOpenPlan={callbacks.onEditPlan} />;
  act(() => { renderer = create(tree(), { createNodeMock: node => new FakeElement(node.props['data-schedule-occurrence-id']) }); });
  function update(patch: Partial<ComponentProps<typeof DayView>>) {
    Object.assign(dayProps, patch);
    act(() => { renderer!.update(tree()); });
  }
  const occurrence = createScheduleOccurrenceProjection({ ownerId: plan.userId, plans: dayProps.plans, monthEvents: dayProps.monthEvents, scheduleTemplates: dayProps.scheduleTemplates, timetableTermId: dayProps.timetableTermId, startDate: plan.date, endDate: plan.date }).occurrences[0];
  const element = new FakeElement(occurrence.id);
  const section = () => renderer!.root.findAllByType('section').find(node => node.props.onTouchStartCapture)!;
  const event = (target = element) => ({ target, currentTarget: element, touches: [{ identifier: 1, clientX: 150, clientY: 300 }], changedTouches: [{ identifier: 1, clientX: 150, clientY: 300 }], preventDefault: vi.fn(), stopPropagation: vi.fn() });
  function open(mode: 'hold' | 'context' | 'keyboard' = 'context') {
    act(() => {
      if (mode === 'hold') { section().props.onTouchStartCapture(event()); vi.advanceTimersByTime(250); section().props.onTouchEndCapture(event()); }
      if (mode === 'context') section().props.onContextMenu(event());
      if (mode === 'keyboard') section().props.onKeyDown({ ...event(), key: 'F10', shiftKey: true });
    });
  }
  const select = async (label: string) => { await act(async () => { renderer!.root.findAllByProps({ role: 'menuitem' }).find(node => node.children.includes(label))!.props.onClick(); }); };
  return { callbacks, open, select, section, event, dayProps, occurrence, update };
}

function native(type: string, points: { identifier: number; clientX: number; clientY: number }[]) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : points }, changedTouches: { value: points } });
  act(() => { window.dispatchEvent(event); });
  return event;
}
describe.each(['day', 'week'] as const)('%s real hold ring integration', kind => {
  it('owns the original touch, selects edit, and executes once on up without moving the plan', async () => {
    const ui = setup(kind);
    const card = () => renderer!.root.findAll(node => node.props['data-schedule-occurrence-id'] === ui.occurrence.id && node.props.onTouchStart)[0];
    act(() => { ui.section().props.onTouchStartCapture(ui.event()); card().props.onTouchStart(ui.event()); });
    act(() => { vi.advanceTimersByTime(170); });
    expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(6);
    expect(classes.has('is-timeline-drag-interaction-locked')).toBe(true);
    const edit = { identifier: 1, clientX: 220, clientY: 260 };
    expect(native('touchmove', [edit]).defaultPrevented).toBe(true);
    expect(renderer!.root.findByProps({ 'data-action': 'edit' }).props['data-gesture-selected']).toBe(true);
    expect(ui.callbacks.onEditPlan).not.toHaveBeenCalled();
    expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
    native('touchend', [edit]);
    act(() => { ui.section().props.onTouchEndCapture(ui.event()); });
    expect(ui.callbacks.onEditPlan).toHaveBeenCalledOnce();
    expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
    expect(classes.has('is-timeline-drag-interaction-locked')).toBe(false);
    const click = { ...ui.event() };
    act(() => ui.section().props.onClickCapture(click));
    expect(click.preventDefault).toHaveBeenCalled();
  });
  it('selecting Move arms only; the next original touch drags immediately and saves once', async () => {
    const ui = setup(kind);
    const card = () => renderer!.root.findAll(node => node.props['data-schedule-occurrence-id'] === ui.occurrence.id && node.props.onTouchStart)[0];
    act(() => { ui.section().props.onTouchStartCapture(ui.event()); card().props.onTouchStart(ui.event()); });
    act(() => { vi.advanceTimersByTime(170); });
    const move = { identifier: 1, clientX: 80, clientY: 260 };
    native('touchmove', [move]); native('touchend', [move]);
    expect(renderer!.root.findAllByType(ScheduleMoveModeBanner)).toHaveLength(1);
    expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
    act(() => { ui.section().props.onTouchStartCapture(ui.event()); card().props.onTouchStart(ui.event()); });
    const moved = { ...ui.event(), touches: [{ identifier: 1, clientX: 150, clientY: 360 }] };
    act(() => { ui.section().props.onTouchMoveCapture(moved); card().props.onTouchMove(moved); });
    expect(renderer!.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    await act(async () => { ui.section().props.onTouchEndCapture(moved); card().props.onTouchEnd(moved); });
    expect(ui.callbacks.onMovePlan).toHaveBeenCalledOnce();
    expect(ui.callbacks.onMovePlan).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }), expect.objectContaining({ startTime: '12:00', endTime: '13:00' }));
    expect(classes.has('is-timeline-drag-interaction-locked')).toBe(false);
  });
});

it.each(['day', 'week'] as const)('%s cancel releases both ring and pending drag without saving', kind => {
  const ui = setup(kind);
  const card = renderer!.root.findAll(node => node.props['data-schedule-occurrence-id'] === ui.occurrence.id && node.props.onTouchStart)[0];
  act(() => { ui.section().props.onTouchStartCapture(ui.event()); card.props.onTouchStart(ui.event()); });
  act(() => { vi.advanceTimersByTime(170); });
  native('touchmove', [{ identifier: 1, clientX: 220, clientY: 260 }]);
  native('touchcancel', [{ identifier: 1, clientX: 220, clientY: 260 }]);
  expect(renderer!.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
  expect(classes.has('is-timeline-drag-interaction-locked')).toBe(false);
  expect(ui.callbacks.onEditPlan).not.toHaveBeenCalled();
  expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
  expect(native('touchmove', [{ identifier: 2, clientX: 100, clientY: 100 }]).defaultPrevented).toBe(false);
});

it.each(['day', 'week'] as const)('%s React capture ignores an unrelated pointer release during a held touch', kind => {
  const ui = setup(kind);
  act(() => { ui.section().props.onTouchStartCapture(ui.event()); vi.advanceTimersByTime(170); });
  const foreign = { ...ui.event(), pointerType: 'mouse', pointerId: 22, clientX: 220, clientY: 260 };
  act(() => { ui.section().props.onPointerMoveCapture(foreign); ui.section().props.onPointerUpCapture(foreign); });
  expect(renderer!.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ 'data-gesture-selected': true })).toHaveLength(0);
  expect(ui.callbacks.onEditPlan).not.toHaveBeenCalled();
  const edit = { identifier: 1, clientX: 220, clientY: 260 };
  native('touchmove', [edit]); native('touchend', [edit]);
  expect(ui.callbacks.onEditPlan).toHaveBeenCalledOnce();
});


// Deliver the actual ancestor capture handlers before the rendered button's
// callback; calling only onClick would miss a calendar-level click interception.
function clickRenderedButton(button: ReactTestInstance) {
  const event = { target: new FakeElement(), preventDefault: vi.fn(), stopPropagation: vi.fn() };
  const ancestors: ReactTestInstance[] = [];
  for (let node = button.parent; node; node = node.parent) ancestors.unshift(node);
  act(() => {
    for (const node of ancestors) {
      if (typeof node.type === 'string') node.props.onClickCapture?.(event);
      if (event.stopPropagation.mock.calls.length) return;
    }
    button.props.onClick(event);
  });
  return event;
}
function flick(ui: ReturnType<typeof setup>, x: number, y: number) {
  act(() => { ui.section().props.onTouchStartCapture(ui.event()); vi.advanceTimersByTime(170); });
  const point = { identifier: 1, clientX: x, clientY: y };
  native('touchmove', [point]); native('touchend', [point]);
}
it('day Move can end immediately without losing the original card click guard', () => {
  const ui = setup('day');
  flick(ui, 80, 260);
  const end = renderer!.root.findAllByType('button').find(node => node.children.includes('終了'))!;
  expect(clickRenderedButton(end).preventDefault).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByType(ScheduleMoveModeBanner)).toHaveLength(0);
  expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
  const cardClick = ui.event();
  act(() => ui.section().props.onClickCapture(cardClick));
  expect(cardClick.preventDefault).toHaveBeenCalledOnce();
});
it('day Move opens the date dialog and cancels immediately through real capture', () => {
  const ui = setup('day');
  flick(ui, 80, 260);
  const specify = renderer!.root.findAllByType('button').find(node => node.children.includes('日時で指定'))!;
  expect(clickRenderedButton(specify).preventDefault).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'dialog', 'aria-label': '数学を移動' })).toHaveLength(1);
  const cancel = renderer!.root.findAllByType('button').find(node => node.children.includes('キャンセル'))!;
  expect(clickRenderedButton(cancel).preventDefault).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'dialog', 'aria-label': '数学を移動' })).toHaveLength(0);
  expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
});
it('day record sheet closes immediately after its flick without a save', () => {
  const ui = setup('day');
  flick(ui, 80, 340);
  expect(renderer!.root.findAll(node => typeof node.type === 'string' && node.props.className?.includes('schedule-record-sheet'))).toHaveLength(1);
  const close = renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === '閉じる')!;
  expect(clickRenderedButton(close).preventDefault).not.toHaveBeenCalled();
  expect(renderer!.root.findAll(node => typeof node.type === 'string' && node.props.className?.includes('schedule-record-sheet'))).toHaveLength(0);
  expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
});
it('week toolbar can change mode immediately after cancelling a held ring', () => {
  const ui = setup('week');
  act(() => { ui.section().props.onTouchStartCapture(ui.event()); vi.advanceTimersByTime(170); });
  native('touchcancel', [{ identifier: 1, clientX: 150, clientY: 300 }]);
  const records = renderer!.root.findAllByType('button').find(node => node.children.includes('記録'))!;
  expect(clickRenderedButton(records).preventDefault).not.toHaveBeenCalled();
  expect(records.props.className).toBe('segment active');
  expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
  expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
});
it('day moved plan can be undone immediately through calendar capture', async () => {
  const ui = setup('day');
  flick(ui, 80, 260);
  const card = () => renderer!.root.findAll(node => node.props['data-schedule-occurrence-id'] === ui.occurrence.id && node.props.onTouchStart)[0];
  act(() => { ui.section().props.onTouchStartCapture(ui.event()); card().props.onTouchStart(ui.event()); });
  const moved = { ...ui.event(), touches: [{ identifier: 1, clientX: 150, clientY: 360 }] };
  act(() => { ui.section().props.onTouchMoveCapture(moved); card().props.onTouchMove(moved); });
  await act(async () => { ui.section().props.onTouchEndCapture(moved); card().props.onTouchEnd(moved); });
  expect(ui.callbacks.onMovePlan).toHaveBeenCalledOnce();
  const undo = renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === '変更を元に戻す')!;
  await act(async () => { expect(clickRenderedButton(undo).preventDefault).not.toHaveBeenCalled(); });
  expect(ui.callbacks.onMovePlan).toHaveBeenCalledTimes(2);
  expect(ui.callbacks.onMovePlan).toHaveBeenLastCalledWith(expect.objectContaining({ id: plan.id }),
    expect.objectContaining({ startTime: '11:00', endTime: '12:00' }));
});
