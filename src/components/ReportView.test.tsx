import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ReportView } from './ReportView';
import type { Actual } from '../types/domain';

vi.mock('../lib/date', async (original) => ({
  ...await original<typeof import('../lib/date')>(),
  todayIsoDate: () => '2026-08-24',
}));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
const actual: Actual = {
  id: 'record', userId: 'owner', planId: null, occurrenceDate: '2026-08-24',
  actualStartTime: '09:00', actualEndTime: '10:00', title: '学習', subject: '数学',
  isAlignedToPlan: false, note: '', updatedAt: '2026-08-24T12:00:00Z',
};

it('keeps summary totals and chart outside a closed native detail disclosure', () => {
  act(() => { renderer = create(<ReportView selectedDate="2026-08-24" plans={[]} actuals={[actual]} onBack={() => {}} />); });
  const root = renderer!.root;
  const details = root.findByType('details');
  expect(details.props.open).toBeUndefined();
  expect(details.findByType('summary').children.join('')).toContain('内訳');
  expect(details.findAllByProps({ className: 'learning-report-summary-card' })).toHaveLength(0);
  expect(root.findAllByProps({ className: 'learning-report-summary-card' }).map(card => card.props['aria-label']))
    .toEqual(['今日 1時間 予定なし', '今週 1時間 予定なし', '今月 1時間 予定なし', '累計 1時間 これまでの学習記録']);
  expect(details.findAllByProps({ role: 'list' })).toHaveLength(0);
  expect(root.findByProps({ role: 'list' }).props['aria-label']).toContain('合計 1時間');
  expect(details.findAllByProps({ className: 'learning-report-breakdown-item' })).toHaveLength(1);
  const before = root.findAllByProps({ className: 'learning-report-summary-card' }).map(card => card.props['aria-label']);
  act(() => root.findAllByProps({ role: 'tab' })[2].props.onClick());
  expect(root.findAllByProps({ className: 'learning-report-summary-card' }).map(card => card.props['aria-label'])).toEqual(before);
  expect(root.findByProps({ role: 'list' }).props['aria-label']).toContain('合計 1時間');
});

it('retains controls and plan supplements even in an empty period', () => {
  const onBack = vi.fn();
  act(() => { renderer = create(<ReportView selectedDate="2026-08-24" plans={[]} actuals={[]} onBack={onBack} />); });
  const root = renderer!.root;
  expect(root.findByProps({ className: 'learning-report-controls' }).findAllByProps({ role: 'tab' })).toHaveLength(3);
  expect(root.findByProps({ className: 'learning-report-controls' }).findAllByType('select')).toHaveLength(1);
  expect(root.findByType('details').findAllByType('dd').map(node => node.children.join(''))).toEqual(['0分', '0分', '0分']);
  expect(root.findByProps({ className: 'learning-report-empty' })).toBeTruthy();
  act(() => root.findByProps({ 'aria-label': 'ホームに戻る' }).props.onClick());
  expect(onBack).toHaveBeenCalledOnce();
});
