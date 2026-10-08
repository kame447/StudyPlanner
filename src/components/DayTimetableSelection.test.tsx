import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayView } from './DayView';
import { DayTimeline } from './DayTimeline';
import type { ComponentProps, ReactNode } from 'react';
import type { Plan, ScheduleTemplate, TimetableTerm } from '../types/domain';

vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children,
}));
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null }, initialFocusRef: { current: null } }) }));
const noop = () => undefined;
const stamp = '2026-10-01T00:00:00Z';
const term: TimetableTerm = { id: 'term', userId: 'owner', year: 2026, kind: 'custom', label: '秋',
  startDate: '2026-10-01', endDate: '2026-10-31', isActive: true, createdAt: stamp, updatedAt: stamp };
const template: ScheduleTemplate = { id: 'class', userId: 'owner', title: '未取込の授業', subject: '数学', type: 'school-event',
  termId: 'term', weekday: 'mon', startTime: '09:00', endTime: '10:00', active: true, periodNumber: 1,
  classroom: 'A室', memo: '', createdAt: stamp, updatedAt: stamp };
const plan: Plan = { id: 'plan', seriesId: 'plan', userId: 'owner', title: '保存済みの予定', subject: '英語', type: 'study',
  date: '2026-10-05', startTime: '11:00', endTime: '12:00', repeat: 'none', repeatUntil: null, excludedDates: [],
  recurrenceRules: [], memo: '', createdAt: stamp, updatedAt: stamp };
let renderer: ReactTestRenderer | undefined;
let props: ComponentProps<typeof DayView>;
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout,
    matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { body: {} }));
  props = { selectedDate: '2026-10-05', userId: 'owner', plans: [plan], actuals: [], monthEvents: [],
    studySubjects: [], studyMaterials: [], scheduleTemplates: [template], timetableTermId: term.id, timetableTerm: term, timetableTerms: [term],
    onChangeDay: vi.fn(), onEditPlan: vi.fn(), onMovePlan: vi.fn(async () => undefined), onDeletePlan: vi.fn(async () => undefined),
    onDeleteMonthEvent: vi.fn(async () => undefined), onSavePlan: vi.fn(async () => undefined), onSaveActual: vi.fn(async () => undefined),
    onSaveStandaloneActual: vi.fn(async () => undefined), onLinkStandaloneActualToPlan: vi.fn(async () => undefined),
    onDeleteActual: vi.fn(async () => undefined), onOpenBookshelf: vi.fn(), onOpenAddMaterial: vi.fn() };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
function mount() { act(() => { renderer = create(<DayView {...props} />); }); }
function clickCard(title: string) {
  const button = renderer!.root.findAllByType('button').find(node => node.props.className?.includes('timeline-plan-block')
    && node.findAllByProps({ className: 'timeline-entry-title' }).some(label => label.children.join('') === title));
  expect(button).toBeDefined();
  act(() => button!.props.onClick({ preventDefault: noop, stopPropagation: noop }));
}
const dialogs = () => renderer!.root.findAllByProps({ role: 'dialog' });
it('opens the real unimported timetable card without exposing saved-plan mutations', () => {
  mount();
  expect(renderer!.root.findAllByType('button').filter(node => node.props.className?.includes('timeline-actual-block'))).toHaveLength(0);
  clickCard(template.title);
  expect(dialogs()).toHaveLength(1);
  expect(dialogs()[0].props['aria-label']).toBe('未取込の授業の詳細');
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).not.toContain('記録を保存');
  expect(dialogs()[0].findAllByType('button').filter(button => button.props['aria-label'] === '閉じる')).toHaveLength(1);
  act(() => dialogs()[0].findByProps({ 'aria-label': '閉じる' }).props.onClick());
  expect(dialogs()).toHaveLength(0);
  for (const key of ['onSavePlan', 'onSaveActual', 'onDeletePlan', 'onDeleteMonthEvent'] as const) expect(props[key]).not.toHaveBeenCalled();
  clickCard(plan.title);
  expect(dialogs()[0].props['aria-label']).toBe('保存済みの予定の操作');
});
it('drops template details when the visible date, owner or source changes', () => {
  for (const replacement of ['date', 'owner', 'removed'] as const) {
    mount(); clickCard(template.title); expect(dialogs()).toHaveLength(1);
    const next = replacement === 'date' ? { ...props, selectedDate: '2026-10-06' }
      : replacement === 'owner' ? { ...props, userId: 'different-owner' } : { ...props, scheduleTemplates: [] };
    act(() => renderer!.update(<DayView {...next} />));
    expect(dialogs()).toHaveLength(0);
    act(() => renderer!.unmount()); renderer = undefined;
  }
});

it('filters only projected timetable entries and closes an open hidden detail', () => {
  const imported: Plan = { ...plan, id: 'imported', title: '取り込み済み授業', sourceType: 'timetable', sourceId: 'saved-class' };
  props = { ...props, plans: [plan, imported], scheduleTemplates: [template, { ...template, id: 'saved-class' }],
    actuals: [{ id: 'actual', userId: 'owner', planId: imported.id, occurrenceDate: props.selectedDate,
      actualStartTime: '11:00', actualEndTime: '12:00', subject: '英語', note: '', updatedAt: stamp }] };
  mount(); clickCard(template.title);
  for (const showTimetable of [false, true, false]) {
    act(() => renderer!.update(<DayView {...props} showTimetable={showTimetable} />));
    const text = JSON.stringify(renderer!.toJSON());
    expect(text.includes(template.title)).toBe(showTimetable);
    expect(text).toContain(imported.title);
    expect(renderer!.root.findAllByType('button').filter(node => node.props.className?.includes('timeline-actual-block'))).toHaveLength(1);
    expect(dialogs()).toHaveLength(0);
  }
});

it('retains a timetable deletion menu on failure, blocks duplicate/close, and retries', async () => {
  let fail!: (reason: Error) => void;
  const pending = new Promise<void>((_, reject) => { fail = reject; });
  const remove = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  props = { ...props, onDeleteOccurrence: remove };
  mount(); clickCard(template.title);
  const button = () => dialogs()[0].findAllByType('button').find(node => node.children.includes('この日だけ削除') || node.children.includes('削除中…'))!;
  expect(button().props.className.split(/\s+/)).toEqual(expect.arrayContaining(['ghost-button', 'danger-button', 'day-timetable-delete-button']));
  const click = button().props.onClick;
  await act(async () => { click(); click(); });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls[0][0]).toMatchObject({ ownerId: 'owner', start: { date: props.selectedDate }, source: { backingKind: 'timetable-template', backingId: template.id } });
  act(() => dialogs()[0].findByProps({ 'aria-label': '閉じる' }).props.onClick());
  expect(dialogs()).toHaveLength(1); expect(button().props.disabled).toBe(true);
  await act(async () => { fail(Error('offline')); });
  expect(dialogs()[0].findByProps({ role: 'alert' }).children.join('')).toContain('offline');
  expect(button().props.disabled).toBe(false);
  await act(async () => { button().props.onClick(); });
  expect(remove).toHaveBeenCalledTimes(2); expect(dialogs()).toHaveLength(0);
});

it('routes recurring Plan and MonthEvent details through the exact selected date only', async () => {
  const onDeleteOccurrence = vi.fn(async () => undefined);
  props = { ...props, onDeleteOccurrence, selectedDate: '2026-10-12', plans: [{ ...plan, repeat: 'weekly' }], monthEvents: [{
    id: 'event', userId: 'owner', date: '2026-10-05', title: '繰り返し主要予定', startTime: '12:00', endTime: '13:00',
    repeat: 'weekly', repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: stamp, updatedAt: stamp,
  }] };
  mount();
  for (const title of [plan.title, '繰り返し主要予定']) {
    clickCard(title);
    const remove = dialogs()[0].findAllByType('button').find(node => node.findAllByType('strong').some(label => label.children.join('') === 'この日だけ削除'))!;
    await act(async () => { remove.props.onClick(); });
  }
  expect(onDeleteOccurrence.mock.calls).toHaveLength(2);
  for (const [occurrence] of onDeleteOccurrence.mock.calls as unknown as [{ start: { date: string } }][]) expect(occurrence.start.date).toBe('2026-10-12');
  expect(props.onDeletePlan).not.toHaveBeenCalled(); expect(props.onDeleteMonthEvent).not.toHaveBeenCalled();
});

it('shows canceled Plan and MonthEvent actuals once and keeps them available for record editing', () => {
  const event = { id: 'event', userId: 'owner', date: props.selectedDate, title: '主要予定の記録', startTime: '12:00', endTime: '13:00',
    repeat: 'weekly' as const, repeatUntil: null, excludedDates: [props.selectedDate], memo: '', url: '', checklist: [], locationTags: [], createdAt: stamp, updatedAt: stamp };
  const actual = { id: 'plan-actual', userId: 'owner', planId: plan.id, occurrenceDate: props.selectedDate,
    actualStartTime: '11:00', actualEndTime: '12:00', subject: '英語', note: '', updatedAt: stamp };
  props = { ...props, plans: [{ ...plan, repeat: 'weekly', excludedDates: [props.selectedDate] }], monthEvents: [event],
    actuals: [actual, { ...actual, id: 'event-actual', planId: event.id, actualStartTime: '12:00', actualEndTime: '13:00' }] };
  mount();
  const records = renderer!.root.findAllByType('button').filter(node => node.props.className?.includes('timeline-actual-block'));
  expect(records).toHaveLength(2);
  for (const record of records) {
    act(() => record.props.onClick());
    expect(JSON.stringify(renderer!.toJSON())).toContain('記録は残っています');
    const buttons = dialogs()[0].findAllByType('button');
    expect(buttons.some(node => node.findAllByType('strong').some(label => label.children.join('') === '記録を編集'))).toBe(true);
    expect(buttons.some(node => node.findAllByType('strong').some(label => label.children.join('') === '削除'))).toBe(false);
    act(() => dialogs()[0].findByProps({ 'aria-label': '閉じる' }).props.onClick());
  }
});

it('describes an overnight occurrence before removing the whole selected instance', async () => {
  const remove = vi.fn(async () => undefined);
  props = { ...props, selectedDate: '2026-10-06', onDeleteOccurrence: remove,
    plans: [{ ...plan, date: '2026-10-05', startTime: '23:00', endTime: '01:00' }] };
  mount();
  act(() => renderer!.root.findByType(DayTimeline).props.onSelectEntry({ kind: 'plan', id: plan.id }));
  const dialog = dialogs()[0];
  const button = dialog.findAllByType('button').find(node => node.findAllByType('strong').some(label => label.children.join('') === 'この回だけ削除'))!;
  expect(button.findAllByType('span').some(node => node.children.some(child => typeof child === 'string' && child.includes('この回全体')))).toBe(true);
  await act(async () => { button.props.onClick(); });
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ start: { date: '2026-10-05', time: '23:00' } }));
});
