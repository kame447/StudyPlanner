import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DayCalendarDialog } from './DayCalendarDialog';

function renderedDayLabels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.props.className?.includes?.('mini-calendar-day'))
    .map((node) => node.children.join(''));
}

describe('DayCalendarDialog', () => {
  it('never renders NaN when it is mounted before a selected date is ready', () => {
    const onSelectDate = vi.fn();
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayCalendarDialog
          open={false}
          selectedDate=""
          onSelectDate={onSelectDate}
          onClose={onClose}
        />,
      );
    });

    act(() => {
      renderer.update(
        <DayCalendarDialog
          open
          selectedDate="2026-05-04"
          onSelectDate={onSelectDate}
          onClose={onClose}
        />,
      );
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('2026年5月');
    expect(text).not.toContain('NaN');
    expect(renderedDayLabels(renderer)).toHaveLength(42);
  });

  it('falls back to a valid calendar even when the supplied date is invalid', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayCalendarDialog
          open
          selectedDate="invalid-date"
          onSelectDate={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const labels = renderedDayLabels(renderer);
    expect(labels).toHaveLength(42);
    expect(labels.every((label) => /^\d{1,2}$/.test(label))).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('NaN');
  });
});
