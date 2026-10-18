import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { DayTimeline } from './DayTimeline';
import { DayDetailModal } from './DayDetailModal';
import { ScheduleMoveDialog } from './ScheduleMoveDialog';
import { ScheduleMoveModeBanner } from './ScheduleMoveModeBanner';
const openMoveDialog = () => act(() => { renderer!.root.findByType(ScheduleMoveModeBanner).props.onOpenDialog(); });
import { ScheduleItemRadialMenu, type ScheduleItemRadialMenuProps } from './ScheduleItemRadialMenu';
import { DragUndoRedoControls } from './DragUndoRedoControls';
import { createScheduleOccurrenceProjection, type ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { createCompletionDraft } from '../lib/scheduleItemActions';
import type { Actual, Plan } from '../types/domain';

vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: ReactNode) => node }));
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null } }) }));
// Presentation geometry and motion have independent tests. Keep its public contract here.
vi.mock('./ScheduleItemRadialMenu', () => ({ ScheduleItemRadialMenu: (props: ScheduleItemRadialMenuProps<ScheduleOccurrence>) =>
  props.action ? <div role="menu" data-schedule-item-delete-action="true" aria-label={`${props.action.title}の操作`}>
    {props.actions.map(action => <button key={action.id} role="menuitem" aria-disabled={Boolean(action.disabledReason)}
      onClick={() => { if (!action.disabledReason && props.action) { const item = props.action.item; props.onDismiss(); void props.onSelect(action.id, item); } }}>{action.label}</button>)}
  </div> : null }));
const noop = () => undefined;
const plan: Plan = { id: 'plan', seriesId: 'plan', userId: 'owner', title: '数学', subject: '数学', type: 'study', date: '2026-10-05',
  startTime: '11:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
  memo: '内容', materialId: 'm', materialName: '問題集', createdAt: '', updatedAt: '' };
class FakeElement {
  dataset: { scheduleOccurrenceId?: string };
  constructor(id?: string, private menu = false) { this.dataset = { scheduleOccurrenceId: id }; }
  closest(selector: string) { return selector.includes('data-schedule-item-delete-action') ? this.menu ? this : null
    : selector.includes('data-schedule-occurrence-id') ? this.dataset.scheduleOccurrenceId ? this : null : null; }
  getBoundingClientRect() { return { top: 20, left: 20, right: 120, bottom: 80, width: 100, height: 60 }; }
}
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: noop, removeEventListener: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('document', { body: {}, addEventListener: noop, removeEventListener: noop });
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
  act(() => { renderer = create(tree()); });
  function update(patch: Partial<ComponentProps<typeof DayView>>) {
    Object.assign(dayProps, patch);
    act(() => { renderer!.update(tree()); });
  }
  const occurrence = createScheduleOccurrenceProjection({ ownerId: plan.userId, plans: dayProps.plans, monthEvents: dayProps.monthEvents, scheduleTemplates: dayProps.scheduleTemplates, timetableTermId: dayProps.timetableTermId, startDate: plan.date, endDate: plan.date }).occurrences[0];
  const element = new FakeElement(occurrence.id);
  const section = () => renderer!.root.findAllByType('section').find(node => node.props.onTouchStartCapture)!;
  const event = (target = element) => ({ target, currentTarget: element, touches: [{ clientX: 50, clientY: 50 }], preventDefault: vi.fn(), stopPropagation: vi.fn() });
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
describe.each(['day', 'week'] as const)('%s radial wiring', kind => {
  it.each(['hold', 'context', 'keyboard'] as const)('%s opens exactly six actions in order', mode => {
    const ui = setup(kind); ui.open(mode);
    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).map(node => node.children.join(''))).toEqual(['完了', '編集', '複製', '削除', '実績', '移動']);
    expect(renderer!.root.findByProps({ role: 'menu' }).props['aria-label']).toBe('数学の操作');
  });
  it('routes edit, duplicate and delete to existing callbacks', async () => {
    const ui = setup(kind);
    ui.open(); await ui.select('編集'); expect(ui.callbacks.onEditPlan).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id, date: plan.date }));
    ui.open(); await ui.select('複製'); expect(ui.callbacks.onDuplicatePlan).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }));
    ui.open(); await ui.select('削除'); expect(ui.callbacks.onDeletePlan).toHaveBeenCalledOnce();
    expect(ui.callbacks.onDeleteMonthEvent).not.toHaveBeenCalled();
  });
  it('records completion once across in-flight presses and delayed actual projection, retaining the plan', async () => {
    const ui = setup(kind); const before = structuredClone(plan);
    let resolve!: () => void;
    ui.callbacks.onSaveActual.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    ui.open(); await ui.select('完了');
    ui.open(); await ui.select('完了'); expect(ui.callbacks.onSaveActual).toHaveBeenCalledTimes(1);
    expect(ui.callbacks.onSaveActual).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }), createCompletionDraft(plan));
    await act(async () => { resolve(); });
    ui.open(); await ui.select('完了'); expect(ui.callbacks.onSaveActual).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('記録済み');
    expect(plan).toEqual(before); expect(ui.callbacks.onEditPlan).not.toHaveBeenCalled();
  });
  it('does not overwrite an existing actual or open another editor', async () => {
    const actual = { ...createCompletionDraft(plan), id: 'a', updatedAt: '' };
    const ui = setup(kind, [actual]); ui.open(); await ui.select('完了');
    expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('記録済み');
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  });
  it('opens the shared actual editor with the original plan', async () => {
    const ui = setup(kind); ui.open(); await ui.select('実績');
    const modal = renderer!.root.findByType(DayDetailModal);
    expect(modal.props.openRecordInitially).toBe(true); expect(modal.props.detailPlan.id).toBe(plan.id);
    expect(JSON.stringify(renderer!.toJSON())).toContain('記録を保存'); expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
  });
  it('移動 lifts the event into drag mode instead of opening the dialog; 終了 leaves it', async () => {
    const ui = setup(kind); ui.open(); await ui.select('移動');
    expect(renderer!.root.findAllByType(ScheduleMoveDialog)).toHaveLength(0);
    expect(renderer!.root.findByType(ScheduleMoveModeBanner).props.title).toBe('数学');
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('is-move-armed'), { deep: true }).length).toBeGreaterThan(0);
    act(() => { renderer!.root.findByType(ScheduleMoveModeBanner).props.onCancel(); });
    expect(renderer!.root.findAllByType(ScheduleMoveModeBanner)).toHaveLength(0);
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('is-move-armed'))).toHaveLength(0);
    expect(ui.callbacks.onMovePlan).not.toHaveBeenCalled();
  });
  it('moves with preserved duration and shares drag undo/redo history', async () => {
    const ui = setup(kind); ui.open(); await ui.select('移動'); openMoveDialog();
    const dialog = renderer!.root.findByType(ScheduleMoveDialog);
    act(() => dialog.findAllByType('input')[1].props.onChange({ target: { value: '13:30' } }));
    await act(async () => { await dialog.findByType('form').props.onSubmit({ preventDefault: noop }); });
    expect(ui.callbacks.onMovePlan).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }), { date: plan.date, startTime: '13:30', endTime: '14:30' });
    const history = () => renderer!.root.findAllByType(DragUndoRedoControls).find(node => node.props.canUndo || node.props.canRedo)!;
    expect(history().props.canUndo).toBe(true);
    await act(async () => { history().props.onUndo(); });
    expect(ui.callbacks.onMovePlan).toHaveBeenLastCalledWith(expect.objectContaining({ id: plan.id }), { date: plan.date, startTime: '11:00', endTime: '12:00' });
    await act(async () => { history().props.onRedo(); });
    expect(ui.callbacks.onMovePlan).toHaveBeenLastCalledWith(expect.objectContaining({ id: plan.id }), { date: plan.date, startTime: '13:30', endTime: '14:30' });
  });
  it('ignores portal events in swipe and long-press capture handlers', async () => {
    const ui = setup(kind); ui.open('hold');
    const menuTarget = new FakeElement(undefined, true);
    const event = ui.event(menuTarget);
    act(() => {
      const handlers = ui.section().props;
      handlers.onTouchStartCapture(event); handlers.onTouchStart(event);
      handlers.onTouchMoveCapture({ ...event, touches: [{ clientX: 250, clientY: 50 }] });
      handlers.onTouchMove({ ...event, touches: [{ clientX: 250, clientY: 50 }] });
      handlers.onTouchEndCapture(event); handlers.onTouchEnd(event); handlers.onClickCapture(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
    await ui.select('複製');
    expect(ui.callbacks.onDuplicatePlan).toHaveBeenCalledOnce();
    expect(ui.callbacks.onChangeDay).not.toHaveBeenCalled(); expect(ui.callbacks.onChangeWeek).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    expect(renderer!.root.findByType(ScheduleItemRadialMenu).props.action).toBeNull();
  });
  it('keeps blocked actual actions visible and cannot bypass admission via selection', async () => {
    const ui = setup(kind, [], { getActualActionBlockReason: () => '実績を再読み込みしてください' }); ui.open();
    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).filter(node => node.props['aria-disabled']).map(node => node.children.join(''))).toEqual(['完了', '実績']);
    await act(async () => { await renderer!.root.findByType(ScheduleItemRadialMenu).props.onSelect('complete', ui.occurrence); });
    expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
  });
  it('allows completion retry after a rejected save', async () => {
    const ui = setup(kind); ui.callbacks.onSaveActual.mockRejectedValueOnce(Error('保存失敗'));
    ui.open(); await ui.select('完了');
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('保存失敗');
    ui.open(); await ui.select('完了'); expect(ui.callbacks.onSaveActual).toHaveBeenCalledTimes(2);
    // Success is confirmed by the app-wide save toast; the stale failure message is cleared.
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  });
  it('passes the existing actual into the shared editor without writing it', async () => {
    const actual = { ...createCompletionDraft(plan), id: 'a', actualStartTime: '12:30', updatedAt: '' };
    const ui = setup(kind, [actual]); ui.open(); await ui.select('実績');
    expect(renderer!.root.findByType(DayDetailModal).props.detailActual).toEqual(actual);
    expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
  });
  it('prepares timetable actuals explicitly but never completes them by changing the plan', async () => {
    const saved = { ...plan, id: 'imported', title: '授業', sourceType: 'timetable' as const, sourceId: 't' };
    const prepare = vi.fn(async () => saved);
    const ui = setup(kind, [], { plans: [], scheduleTemplates: [{ id: 't', userId: 'owner', title: '授業', subject: '数学', type: 'school-event', termId: 'term', weekday: 'mon',
      startTime: '09:00', endTime: '10:00', active: true, periodNumber: 1, classroom: '', memo: '', createdAt: '', updatedAt: '' }], timetableTermId: 'term', onPrepareTimetableRecord: prepare });
    ui.open();
    const menu = renderer!.root.findByType(ScheduleItemRadialMenu);
    expect(menu.props.actions.find((action: { id: string }) => action.id === 'complete').disabledReason).toContain('時間割');
    await act(async () => { await menu.props.onSelect('complete', ui.occurrence); });
    expect(prepare).not.toHaveBeenCalled(); expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
    await ui.select('実績'); expect(prepare).toHaveBeenCalledExactlyOnceWith(ui.occurrence);
    expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.id).toBe(saved.id);
    expect(renderer!.root.findByType(DayDetailModal).props.openRecordInitially).toBe(true);
  });
  it('completes a month event through its synthetic actual plan without changing the event', async () => {
    const event = { id: 'e', userId: 'owner', date: plan.date, title: '行事', startTime: '12:00', endTime: '13:00', repeat: 'none' as const,
      repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
    const before = structuredClone(event);
    const ui = setup(kind, [], { plans: [], monthEvents: [event] }); ui.open(); await ui.select('完了');
    expect(ui.callbacks.onSaveActual).toHaveBeenCalledWith(expect.objectContaining({ id: 'e', date: plan.date }), expect.objectContaining({ planId: 'e', occurrenceDate: plan.date, title: '行事', actualStartTime: '12:00', actualEndTime: '13:00', isAlignedToPlan: true }));
    expect(event).toEqual(before);
  });
  it('clears transient completion feedback after four seconds', async () => {
    const actual = { ...createCompletionDraft(plan), id: 'a', updatedAt: '' };
    const ui = setup(kind, [actual]); ui.open(); await ui.select('完了');
    expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
    const status = renderer!.root.findByProps({ role: 'status' });
    expect(status.children.join('')).toContain('記録済み');
    expect(status.props.className).toContain('app-toast');
    act(() => { vi.advanceTimersByTime(3999); });
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  });
  it.each(['moved', 'excluded', 'time-changed'] as const)('dismisses a %s stale menu and rejects even a retained selection callback', async change => {
    const ui = setup(kind); ui.open();
    const retainedSelect = renderer!.root.findByType(ScheduleItemRadialMenu).props.onSelect;
    const changed = { ...plan, ...(change === 'moved' ? { date: '2026-10-06' }
      : change === 'excluded' ? { excludedDates: [plan.date] } : { startTime: '10:30' }) };
    ui.update({ plans: [changed] });
    expect(renderer!.root.findByType(ScheduleItemRadialMenu).props.action).toBeNull();
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('予定が変更されました');
    for (const id of ['complete', 'actual', 'duplicate', 'edit', 'move', 'delete']) {
      await act(async () => { await retainedSelect(id, ui.occurrence); });
    }
    for (const callback of [ui.callbacks.onSaveActual, ui.callbacks.onDeletePlan, ui.callbacks.onEditPlan, ui.callbacks.onDuplicatePlan, ui.callbacks.onMovePlan]) {
      expect(callback).not.toHaveBeenCalled();
    }
    expect(renderer!.root.findAllByType(ScheduleMoveDialog)).toHaveLength(0);
  });
  it('disables month-event edit with the existing month-view route and rejects stale month times', async () => {
    const event = { id: 'e', userId: 'owner', date: plan.date, title: '行事', startTime: '12:00', endTime: '13:00', repeat: 'none' as const,
      repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
    const ui = setup(kind, [], { plans: [], monthEvents: [event] }); ui.open();
    const menu = renderer!.root.findByType(ScheduleItemRadialMenu);
    expect(menu.props.actions.find((action: { id: string }) => action.id === 'edit').disabledReason).toBe('主要予定は月表示から編集してください');
    await act(async () => { await menu.props.onSelect('edit', ui.occurrence); });
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    const retainedSelect = menu.props.onSelect;
    ui.update({ monthEvents: [{ ...event, startTime: '15:00', endTime: '16:00' }] });
    expect(renderer!.root.findByType(ScheduleItemRadialMenu).props.action).toBeNull();
    await act(async () => { await retainedSelect('complete', ui.occurrence); });
    expect(ui.callbacks.onSaveActual).not.toHaveBeenCalled();
    ui.open(); await ui.select('完了');
    expect(ui.callbacks.onSaveActual).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actualStartTime: '15:00', actualEndTime: '16:00' }));
  });
  it.each([true, false])('an old pending move cannot close or alter a newer dialog after context change (success=%s)', async success => {
    const ui = setup(kind); ui.open(); await ui.select('移動'); openMoveDialog();
    let resolveOld!: () => void; let rejectOld!: (error: Error) => void;
    ui.callbacks.onMovePlan.mockImplementationOnce(() => new Promise<undefined>((resolve, reject) => { resolveOld = () => resolve(undefined); rejectOld = reject; }));
    const oldDialog = renderer!.root.findByType(ScheduleMoveDialog);
    const oldClose = oldDialog.props.onClose;
    let oldMove!: Promise<void>;
    act(() => { oldMove = oldDialog.findByType('form').props.onSubmit({ preventDefault: noop }); });
    const next = { ...plan, id: 'next', seriesId: 'next', date: '2026-10-06' };
    ui.update({ selectedDate: next.date, plans: [next] });
    const occurrence = createScheduleOccurrenceProjection({ ownerId: plan.userId, startDate: next.date, endDate: next.date, plans: [next] }).occurrences[0];
    await act(async () => { await renderer!.root.findByType(ScheduleItemRadialMenu).props.onSelect('move', occurrence); });
    openMoveDialog();
    const newer = renderer!.root.findByType(ScheduleMoveDialog);
    expect(newer.props.plan.id).toBe('next');
    act(() => { oldClose(); });
    expect(renderer!.root.findByType(ScheduleMoveDialog).props.plan.id).toBe('next');
    await act(async () => { if (success) resolveOld(); else rejectOld(Error('old failure')); await oldMove; });
    expect(renderer!.root.findByType(ScheduleMoveDialog).props.plan.id).toBe('next');
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(renderer!.root.findByType(ScheduleMoveDialog).findAllByType('input').some(input => input.props.disabled)).toBe(false);
  });
  it('preserves tap behavior'  , () => {
    const ui = setup(kind);
    if (kind === 'day') act(() => renderer!.root.findByType(DayTimeline).props.onSelectEntry({ kind: 'plan', id: plan.id }));
    else act(() => renderer!.root.findAllByType('button').find(node => node.props.className?.includes('schedule-week-plan-button'))!.props.onClick(ui.event()));
    if (kind === 'day') expect(renderer!.root.findByType(DayDetailModal).props.detailPlan.id).toBe(plan.id);
    else expect(ui.callbacks.onEditPlan).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }));
  });
});
