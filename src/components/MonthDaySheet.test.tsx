import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthDaySheet } from './MonthDaySheet';

const callbacks = {
  onCreate: vi.fn(),
  onEdit: vi.fn(),
  onClose: vi.fn(),
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('MonthDaySheet', () => {
  it('keeps the sheet mounted while the closing animation finishes', () => {
    vi.useFakeTimers();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <MonthDaySheet
          openDate="2026-08-22"
          monthEvents={[]}
          {...callbacks}
        />,
      );
    });

    expect(renderer.root.findByProps({ 'data-state': 'open' })).toBeTruthy();

    act(() => {
      renderer.update(
        <MonthDaySheet
          openDate={null}
          monthEvents={[]}
          {...callbacks}
        />,
      );
    });

    expect(renderer.root.findByProps({ 'data-state': 'closing' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(280);
    });

    expect(renderer.toJSON()).toBeNull();
  });
});
