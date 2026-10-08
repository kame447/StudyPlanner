import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayView } from './DayView';
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
