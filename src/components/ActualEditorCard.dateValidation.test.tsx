import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { Actual, Plan } from '../types/domain';
import { ActualEditorCard } from './ActualEditorCard';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';

const DATE = '2026-10-14';
const plan: Plan = {
  id: 'plan', seriesId: 'plan', userId: 'owner', title: '英語', subject: '英語',
  date: DATE, startTime: '18:00', endTime: '18:30', repeat: 'none', repeatUntil: null,
  excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
};
const actual: Actual = {
  id: 'actual', userId: 'owner', planId: plan.id, occurrenceDate: DATE,
  actualStartTime: '18:00', actualEndTime: '18:30', title: '英語', subject: '英語',
  note: '', updatedAt: plan.updatedAt,
};
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

type EditorKind = 'linked-new' | 'linked-existing' | 'standalone';
function mount(kind: EditorKind) {
  const save = vi.fn().mockResolvedValue(undefined);
  const link = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const pending = vi.fn();
  act(() => {
    renderer = create(kind === 'standalone' ? <StandaloneActualEditorCard
      actual={{ ...actual, planId: null }} plans={[plan]} actuals={[{ ...actual, planId: null }]}
      onSaveStandaloneActual={save} onLinkStandaloneActualToPlan={link} onDeleteActual={vi.fn()}
      onClose={close} onPendingChange={pending} /> : <ActualEditorCard
      plan={plan} plans={[plan]} actuals={kind === 'linked-new' ? [] : [actual]}
      actual={kind === 'linked-new' ? undefined : actual}
      onEditPlan={vi.fn()} onDeletePlan={vi.fn()} onSaveActual={save} onDeleteActual={vi.fn()}
      onClose={close} onPendingChange={pending} forceOpen hideToggleButton hidePlanActions />);
  });
  const root = renderer!.root;
  const date = () => root.findByProps({ type: 'date' });
  const memo = () => root.findByType('textarea');
  const button = (label: string) => root.findAllByType('button').find(node => node.children.includes(label))!;
  return { root, save, link, close, pending, date, memo, button };
}

for (const kind of ['linked-new', 'linked-existing', 'standalone'] as const) {
  it.each(['', '2026-02-30', '2026-13-01', '2026-2-03', 'not-a-date'])(
    `${kind} rejects invalid date %j without submitting or losing edits, then saves a corrected leap date`, async invalidDate => {
      const { root, save, link, close, pending, date, memo, button } = mount(kind);
      act(() => { memo().props.onChange({ target: { value: '保持するメモ' } }); });
      act(() => { date().props.onChange({ target: { value: invalidDate } }); });
      const label = kind === 'standalone' ? '保存' : '記録保存';
      await act(async () => { button(label).props.onClick(); });
      expect(save).not.toHaveBeenCalled();
      expect(link).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalledWith(true);
      expect(root.findByProps({ role: 'alert' }).children.join('')).toContain('有効な日付');
      expect(date().props.value).toBe(invalidDate);
      expect(memo().props.value).toBe('保持するメモ');
      act(() => { date().props.onChange({ target: { value: '2028-02-29' } }); });
      await act(async () => { button(label).props.onClick(); });
      expect(save).toHaveBeenCalledTimes(1);
      const savedDraft = save.mock.calls[0][kind === 'standalone' ? 0 : 1];
      expect(savedDraft).toMatchObject({ occurrenceDate: '2028-02-29', note: '保持するメモ',
        actualStartTime: '18:00', actualEndTime: '18:30' });
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
}

it('allows linking a standalone record after correcting an invalid date without losing the draft', async () => {
  const { save, link, close, date, memo, button } = mount('standalone');
  act(() => {
    memo().props.onChange({ target: { value: '紐づけまで保持するメモ' } });
    date().props.onChange({ target: { value: '' } });
  });
  await act(async () => { button('保存').props.onClick(); });
  expect(save).not.toHaveBeenCalled();
  act(() => { date().props.onChange({ target: { value: DATE } }); });
  await act(async () => { button('この予定に紐づける').props.onClick(); });
  expect(link).toHaveBeenCalledWith(expect.objectContaining({ id: actual.id,
    occurrenceDate: DATE, note: '紐づけまで保持するメモ' }), {
    ...plan, occurrenceDate: DATE, occurrenceKey: `${plan.id}::${DATE}`, sourceDate: DATE,
  });
  expect(close).toHaveBeenCalledTimes(1);
});
