import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanDraft } from '../types/domain';
import { PlanFieldsEditor } from './PlanFieldsEditor';

const MARKERS = '[weekly-source:block-1] / [weekly-approval:op-1]';
const draft = (memo: string): PlanDraft => ({ userId: 'owner', title: '数学', subject: '数学', date: '2026-11-03', startTime: '18:00', endTime: '19:00',
  repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo, sourceType: 'weekly-planning',
  sourceId: 'v1:op-1:block-1', materialId: null, materialName: '' });
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function mount(memo: string) {
  const onChange = vi.fn();
  act(() => { renderer = create(<PlanFieldsEditor draft={draft(memo)} onChange={onChange} />); });
  return { textarea: renderer!.root.findByType('textarea'), onChange };
}

it('does not show the weekly planning bookkeeping in the memo field', () => {
  expect(mount(`Stable V5 preview / graphRevision: 2 / workItemKey: wpwi_x / ${MARKERS}`).textarea.props.value).toBe('');
  expect(mount(`図書館で / ${MARKERS}`).textarea.props.value).toBe('図書館で');
});

it('saves the user\'s edit with the original markers kept, so the older approval lookup still finds the plan', () => {
  const stored = `図書館で / ${MARKERS}`;
  const { textarea, onChange } = mount(stored);
  act(() => textarea.props.onChange({ target: { value: '自習室で' } }));
  expect(onChange).toHaveBeenCalledTimes(1);
  const saved = onChange.mock.calls[0][0] as PlanDraft;
  expect(saved.memo).toBe(`自習室で / ${MARKERS}`);
  expect(saved.memo.includes('[weekly-source:block-1]')).toBe(true);
  expect(saved.sourceType).toBe('weekly-planning');
  expect(saved.sourceId).toBe('v1:op-1:block-1');
});

it('leaves an ordinary memo untouched', () => {
  const { textarea, onChange } = mount('普通のメモ');
  expect(textarea.props.value).toBe('普通のメモ');
  act(() => textarea.props.onChange({ target: { value: '普通のメモを直した' } }));
  expect((onChange.mock.calls[0][0] as PlanDraft).memo).toBe('普通のメモを直した');
});
