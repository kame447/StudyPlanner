import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_DATE_RANGE_ERROR_MESSAGE,
  isValidAdminDate,
  useAdminDateRange,
} from './adminDateRange';

function FetchProbe({ onFetch }: { onFetch: (fromDate: string, toDate: string) => void }) {
  const range = useAdminDateRange({
    defaultFromDate: '2026-09-19',
    defaultToDate: '2026-09-25',
  });

  useEffect(() => {
    onFetch(range.appliedFromDate, range.appliedToDate);
  }, [onFetch, range.appliedFromDate, range.appliedToDate]);

  return (
    <>
      <input value={range.fromDate} onChange={(event) => range.setFromDate(event.target.value)} />
      <input value={range.toDate} onChange={(event) => range.setToDate(event.target.value)} />
      <span>{range.errorMessage}</span>
    </>
  );
}

describe('useAdminDateRange', () => {
  it.each([
    ['年の入力途中', '0002-09-19'],
    ['空文字', ''],
    ['開始日が終了日より後', '2026-09-26'],
    ['94日以上', '2026-06-24'],
  ])('does not fetch while %s is invalid and fetches once when it becomes valid', (_label, invalidFromDate) => {
    const onFetch = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<FetchProbe onFetch={onFetch} />);
    });
    expect(onFetch).toHaveBeenCalledTimes(1);

    const [fromInput] = renderer.root.findAllByType('input');
    act(() => {
      fromInput.props.onChange({ target: { value: invalidFromDate } });
    });
    expect(onFetch).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType('span').children).toEqual([ADMIN_DATE_RANGE_ERROR_MESSAGE]);

    act(() => {
      fromInput.props.onChange({ target: { value: '2026-09-20' } });
    });
    expect(onFetch).toHaveBeenCalledTimes(2);
    expect(onFetch).toHaveBeenLastCalledWith('2026-09-20', '2026-09-25');

    act(() => {
      fromInput.props.onChange({ target: { value: '2026-09-20' } });
    });
    expect(onFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects impossible calendar dates and incomplete years', () => {
    expect(isValidAdminDate('2026-02-30')).toBe(false);
    expect(isValidAdminDate('0002-09-19')).toBe(false);
    expect(isValidAdminDate('2026-02-28')).toBe(true);
  });
});
