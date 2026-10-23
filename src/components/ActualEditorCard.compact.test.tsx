import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { Plan } from '../types/domain';
import { ActualEditorCard } from './ActualEditorCard';

const plan: Plan = {
  id: 'plan', seriesId: 'plan', userId: 'owner', title: '塾バイト', subject: '主要予定',
  date: '2026-10-15', startTime: '17:00', endTime: '21:30', repeat: 'none', repeatUntil: null,
  excludedDates: [], recurrenceRules: [], type: 'other', memo: '予定の大切な補足',
  createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
};
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

function mount() {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => { renderer = create(<ActualEditorCard plan={plan} plans={[plan]} actuals={[]}
    onEditPlan={vi.fn()} onDeletePlan={vi.fn()} onSaveActual={save} onDeleteActual={vi.fn()}
    forceOpen hideToggleButton hidePlanActions />); });
  const root = renderer!.root;
  return { root, save, button: (text: string) => root.findAllByType('button').find(node => node.children.includes(text))! };
}

it('keeps one plan summary and save action with a labelled, pressed-state content choice', () => {
  const { root, button } = mount();
  expect(root.findAllByType('strong').filter(node => node.children.includes(plan.title))).toHaveLength(1);
  expect(root.findAllByType('button').filter(node => node.children.includes('記録保存'))).toHaveLength(1);
  expect(root.findAllByType('p').some(node => node.children.includes(plan.memo))).toBe(true);
  expect(root.findAllByProps({ className: 'assistant-feedback-card actual-editor-summary-card' })).toHaveLength(0);
  const group = root.findByProps({ role: 'group' });
  expect(root.findByProps({ id: group.props['aria-labelledby'] }).children).toEqual(['予定との対応']);
  expect(button('予定通り').props['aria-pressed']).toBe(true);
  expect(button('違う内容').props['aria-pressed']).toBe(false);
  expect(root.findByProps({ type: 'date' }).props.value).toBe(plan.date);
  const times = root.findByProps({ className: 'actual-time-field-pair' });
  expect(times.findAllByProps({ type: 'time' }).map(node => node.props.value)).toEqual(['17:00', '21:30']);
  expect(root.findAllByProps({ className: 'actual-tracking-details' })).toHaveLength(0);
  expect(root.findAllByProps({ className: 'tracking-display' })).toHaveLength(0);
});

it('preserves alternate-content validation, data and the return to planned content', async () => {
  const { root, save, button } = mount();
  act(() => button('違う内容').props.onClick());
  expect(button('違う内容').props['aria-pressed']).toBe(true);
  const title = root.findByProps({ placeholder: '例: 重要問題集 力学' });
  act(() => title.props.onChange({ target: { value: '' } }));
  await act(async () => button('記録保存').props.onClick());
  expect(save).not.toHaveBeenCalled();
  expect(root.findByProps({ role: 'alert' }).children.join('')).toContain('実際にやった内容');
  act(() => title.props.onChange({ target: { value: '自習に変更' } }));
  act(() => root.findByType('textarea').props.onChange({ target: { value: '保持するメモ' } }));
  act(() => button('予定通り').props.onClick());
  expect(root.findAllByProps({ placeholder: '例: 重要問題集 力学' })).toHaveLength(0);
  expect(root.findByType('textarea').props.value).toBe('保持するメモ');
  await act(async () => button('記録保存').props.onClick());
  expect(save).toHaveBeenCalledWith(plan, expect.objectContaining({
    isAlignedToPlan: true, title: plan.title, subject: plan.subject, note: '保持するメモ',
    occurrenceDate: plan.date, actualStartTime: plan.startTime, actualEndTime: plan.endTime,
  }), undefined);
});
