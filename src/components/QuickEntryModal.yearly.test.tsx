import type { ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { buildMonthPanelProjection } from '../lib/monthViewProjection';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlanDraft } from '../types/domain';
import { QuickEntryModal } from './QuickEntryModal';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal('document', { body: { style: { overflow: '', overscrollBehavior: '' } } }));
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
function mount(props: Partial<ComponentProps<typeof QuickEntryModal>> = {}) {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => { renderer = create(<QuickEntryModal
    userId="annual-owner" selectedDate="2026-10-15" plans={[]} actuals={[]} materials={[]} subjects={[]}
    onClose={vi.fn()} onSaveTodo={save} onSavePlan={save} onSaveStandaloneActual={save} onSaveLinkedActual={save}
    {...props} />); });
}
function button(label: string) {
  return renderer!.root.findAllByType('button').find(node => node.children.join('') === label)!;
}

it.each([undefined, 'later', 'scheduled', 'repeat'] as const)('orders types without changing the %s initial selection', initialMode => {
  mount({ initialMode });
  const tabs = renderer!.root.findByProps({ className: 'segmented-control quick-entry-mode-tabs' }).findAllByType('button');
  expect(tabs.map(tab => tab.children.join(''))).toEqual(['時間指定', 'Todo', '繰り返し']);
  expect(tabs.filter(tab => tab.props.className.includes('active')).map(tab => tab.children.join('')))
    .toEqual([initialMode === 'scheduled' ? '時間指定' : initialMode === 'repeat' ? '繰り返し' : 'Todo']);
});

it.each(['study', 'other'] as const)('saves a yearly %s from the form and projects the same occurrence after repository reload', async type => {
  const storage = new MemoryStorage();
  const repository = createLocalPlannerRepository(storage);
  const save = vi.fn(async (draft: PlanDraft) => { await repository.upsertPlan(createPlanFromDraft(draft)); });
  mount({ onSavePlan: save });
  act(() => {
    renderer!.root.findByProps({ placeholder: '例: 英語課題 / 面接準備' }).props.onChange({ target: { value: '毎年の確認' } });
    button('繰り返し').props.onClick();
  });
  expect(button('毎年').props.disabled).toBe(false);
  act(() => {
    button('毎年').props.onClick();
    button('30分').props.onClick();
    renderer!.root.findAllByType('select').find(node => node.props.value === 'study')!.props.onChange({ target: { value: type } });
  });
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ repeat: 'yearly', recurrenceRules: [{ kind: 'yearly' }], type });
  const stored = JSON.parse(storage.getItem('studyplanner.scheduleEvents.v1')!);
  expect(stored).toHaveLength(1);
  expect(stored[0].recurrence).toMatchObject({ repeat: 'yearly', rules: [{ kind: 'yearly' }] });
  const restored = await createLocalPlannerRepository(storage).getPlans('annual-owner');
  expect(restored).toHaveLength(1);
  expect(restored[0].repeat).toBe('yearly');
  const project = (startDate: string, endDate: string) => createScheduleOccurrenceProjection({
    ownerId: 'annual-owner', plans: restored, startDate, endDate,
  });
  const day = project('2027-10-15', '2027-10-15');
  const week = project('2027-10-11', '2027-10-17');
  const month = project('2027-10-01', '2027-10-31');
  expect(day.issues).toEqual([]);
  expect(day.occurrences).toHaveLength(1);
  expect(week.occurrences).toEqual(day.occurrences);
  expect(month.occurrences).toEqual(day.occurrences);
  expect(day.occurrences[0]).toMatchObject({
    id: `plan:${restored[0].id}:2027-10-15`, title: '毎年の確認',
    start: { date: '2027-10-15', time: '19:00' }, end: { date: '2027-10-15', time: '19:30' },
  });
  expect(project('2027-10-16', '2027-10-16').occurrences).toEqual([]);
  const panel = buildMonthPanelProjection({
    userId: 'annual-owner', monthDate: '2027-10-01', plans: restored, actuals: [], monthEvents: [],
  });
  const cell = panel.cells.find(cell => cell.date === '2027-10-15')!;
  if (type === 'other') {
    expect(cell.monthEvents).toMatchObject([{ id: `plan:${restored[0].id}:2027-10-15`, title: '毎年の確認' }]);
  } else {
    expect(cell.targetMinutes).toBe(30);
  }
});
