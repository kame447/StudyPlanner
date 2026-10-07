import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekView } from './WeekView';

describe('WeekView date labels', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
  });

  it.each([
    {
      selectedDate: '2026-10-07',
      dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
      labels: ['5（月）', '6（火）', '7（水）', '8（木）', '9（金）', '10（土）', '11（日）'],
      fullLabels: ['2026年10月5日（月）', '2026年10月6日（火）', '2026年10月7日（水）', '2026年10月8日（木）', '2026年10月9日（金）', '2026年10月10日（土）', '2026年10月11日（日）'],
    },
    {
      selectedDate: '2026-09-30',
      dates: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
      labels: ['28（月）', '29（火）', '30（水）', '1（木）', '2（金）', '3（土）', '4（日）'],
      fullLabels: ['2026年9月28日（月）', '2026年9月29日（火）', '2026年9月30日（水）', '2026年10月1日（木）', '2026年10月2日（金）', '2026年10月3日（土）', '2026年10月4日（日）'],
    },
    {
      selectedDate: '2026-12-31',
      dates: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
      labels: ['28（月）', '29（火）', '30（水）', '31（木）', '1（金）', '2（土）', '3（日）'],
      fullLabels: ['2026年12月28日（月）', '2026年12月29日（火）', '2026年12月30日（水）', '2026年12月31日（木）', '2027年1月1日（金）', '2027年1月2日（土）', '2027年1月3日（日）'],
    },
  ])('keeps compact labels, full accessible dates, and exact navigation for $selectedDate', ({ selectedDate, dates, labels, fullLabels }) => {
    const onOpenDay = vi.fn();
    act(() => {
      renderer = create(<WeekView selectedDate={selectedDate} plans={[]} actuals={[]} onOpenDay={onOpenDay} />);
    });

    const headers = renderer!.root.findAllByProps({ className: 'weekly-draft-preview-date' });
    expect(headers.map((header) => header.findByType('strong').children.join(''))).toEqual(labels);
    expect(headers.map((header) => header.props['aria-label'])).toEqual(fullLabels);
    expect(renderer!.root.findAllByProps({ role: 'group' }).map((column) => column.props['aria-label'])).toEqual(fullLabels.map((label) => `${label}の予定`));

    act(() => headers.forEach((header) => header.props.onClick()));
    expect(onOpenDay.mock.calls).toEqual(dates.map((date) => [date]));

    const actualMode = renderer!.root.findAllByType('button').find((button) => button.children.join('') === '記録');
    act(() => actualMode!.props.onClick());
    expect(renderer!.root.findAllByProps({ role: 'group' }).map((column) => column.props['aria-label'])).toEqual(fullLabels.map((label) => `${label}の記録`));
    expect(renderer!.root.findAllByProps({ className: 'weekly-draft-preview-date' }).map((header) => header.findByType('strong').children.join(''))).toEqual(labels);
  });
});
