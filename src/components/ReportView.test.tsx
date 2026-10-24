import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ReportView } from './ReportView';
import type { Actual, MonthEvent } from '../types/domain';

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

it('keeps chart values separate from their proportional bar plot without changing values', () => {
  act(() => { renderer = create(<ReportView selectedDate="2026-08-24" plans={[]} actuals={[actual]} onBack={() => {}} />); });
  const root = renderer!.root;
  const populated = root.findAllByProps({ className: 'learning-report-chart-bar-area' })
    .find(area => area.findAllByProps({ className: 'learning-report-chart-value' }).length > 0)!;
  const value = populated.findByProps({ className: 'learning-report-chart-value' });
  const plot = populated.findByProps({ className: 'learning-report-chart-plot' });
  expect(value.children.join('')).toBe('1時間');
  expect(plot.findAllByProps({ className: 'learning-report-chart-value' })).toHaveLength(0);
  expect(plot.findByProps({ className: 'learning-report-chart-bar' }).props.style.height).toBe('100%');
  act(() => root.findAllByProps({ role: 'tab' })[2].props.onClick());
  expect(root.findAllByProps({ className: 'learning-report-chart-value' })).toHaveLength(0);
  expect(root.findAllByProps({ className: 'learning-report-chart-plot' })).toHaveLength(31);
});

it.each([
  [0, '2026-08-24', '31'],
  [4, '2026-04-24', '30'],
  [6, '2026-02-24', '28'],
] as const)('keeps monthly axis labels short and separated across month lengths (%s)', (steps, date, lastDay) => {
  act(() => { renderer = create(<ReportView selectedDate={date} plans={[]} actuals={[{ ...actual, occurrenceDate: date }]} onBack={() => {}} />); });
  const root = renderer!.root;
  act(() => root.findAllByProps({ role: 'tab' })[2].props.onClick());
  for (let step = 0; step < steps; step += 1) {
    act(() => root.findByProps({ 'aria-label': '前の期間を表示' }).props.onClick());
  }
  const labels = root.findAllByProps({ className: 'learning-report-chart-label' });
  expect(labels.map(label => label.findByType('strong').children.join(''))).toEqual(['1', '5', '10', '15', '20', '25', lastDay]);
  expect(labels.every(label => label.findAllByType('span').length === 0)).toBe(true);
  const items = root.findAllByProps({ role: 'listitem' });
  expect(items).toHaveLength(Number(lastDay));
  expect(items[0].props['aria-label']).toMatch(/\d+\/1 /);
});


it('omits a recorded major event from learning summaries and chart while retaining standalone study', () => {
  const event: MonthEvent = { id: 'job', userId: 'owner', date: '2026-08-24', title: '塾バイト',
    startTime: '17:00', endTime: '21:30', repeat: 'none', repeatUntil: null, excludedDates: [],
    url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const records = [actual, { ...actual, id: 'job-actual', planId: event.id,
    title: event.title, actualStartTime: '17:00', actualEndTime: '21:30' }];
  act(() => { renderer = create(<ReportView selectedDate={event.date} plans={[]} monthEvents={[event]} actuals={records} onBack={() => {}} />); });
  const root = renderer!.root;
  expect(root.findAllByProps({ className: 'learning-report-summary-card' }).map(card => card.props['aria-label']))
    .toEqual(['今日 1時間 予定なし', '今週 1時間 予定なし', '今月 1時間 予定なし', '累計 1時間 これまでの学習記録']);
  for (const tab of root.findAllByProps({ role: 'tab' })) {
    act(() => tab.props.onClick());
    expect(root.findByProps({ role: 'list' }).props['aria-label']).toContain('合計 1時間');
  }
  expect(records).toHaveLength(2);
});
