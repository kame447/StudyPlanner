import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { WeekPickerDialog } from './DatePickerDialogs';
import { MonthGridPanel } from './MonthGridPanel';

describe('calendar date labels', () => {
  it.each([['2026-01-15', '1月'], ['2026-10-15', '10月']])('selects the numeric month from %s', (selectedDate, expectedMonth) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<WeekPickerDialog open selectedDate={selectedDate} onSelectWeek={vi.fn()} onClose={vi.fn()} />);
    });
    try {
      const activeMonths = renderer.root.findAllByType('button').filter(button =>
        button.props.className?.split(' ').includes('active') && button.children.includes('月'));
      expect(activeMonths.map(button => button.children.join(''))).toEqual([expectedMonth]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('renders calendar days without leading zeroes', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MonthGridPanel monthDate="2026-10-01" isCurrent selectedDate="2026-10-01" todayDate="2026-10-01"
        userId="owner" plans={[]} actuals={[]} monthEvents={[]} scheduleTemplates={[]}
        registerCellRef={vi.fn()} onCellClick={vi.fn()} onMoveSelection={vi.fn()} onOpenMonthEventEditor={vi.fn()} />);
    });
    try {
      const labels = renderer.root.findAllByType('strong')
        .filter(node => node.props.className?.split(' ').includes('month-date-number'))
        .map(node => node.children.join(''));
      expect(labels).toEqual(expect.arrayContaining(['1', '9', '10', '31']));
      expect(labels.every(label => /^(?:[1-9]|[12]\d|3[01])$/.test(label))).toBe(true);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
