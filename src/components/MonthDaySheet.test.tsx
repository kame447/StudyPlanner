import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../types/domain';
import { MonthDaySheet } from './MonthDaySheet';

const callbacks = {
  onCreate: vi.fn(),
  onEdit: vi.fn(),
  onOpenDay: vi.fn(),
  onClose: vi.fn(),
};

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '美容院',
    subject: '予定',
    date: '2026-08-22',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

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

  it('shows non-study Plan occurrences and routes them to the schedule detail view', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <MonthDaySheet
          openDate="2026-08-22"
          userId="user-1"
          plans={[
            plan(),
            plan({
              id: 'study-1',
              seriesId: 'study-1',
              title: '数学',
              subject: '数学',
              startTime: '20:00',
              endTime: '21:00',
              type: 'study',
            }),
          ]}
          monthEvents={[]}
          {...callbacks}
        />,
      );
    });

    const serialized = JSON.stringify(renderer.toJSON());
    expect(serialized).toContain('美容院');
    expect(serialized).not.toContain('数学');

    const eventButton = renderer.root.findAllByProps({
      className: 'month-day-sheet-event mint',
    })[0];
    expect(eventButton).toBeTruthy();

    act(() => {
      eventButton.props.onClick();
    });

    expect(callbacks.onOpenDay).toHaveBeenCalledWith('2026-08-22');
    expect(callbacks.onEdit).not.toHaveBeenCalled();
  });
});
