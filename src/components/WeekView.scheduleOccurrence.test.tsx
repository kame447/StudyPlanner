import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { MonthEvent } from '../types/domain';
import { WeekView } from './WeekView';

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'appointment-1',
    userId: 'user-1',
    date: '2026-08-24',
    title: '美容院',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WeekView schedule occurrence projection', () => {
  it('shows same-day MonthEvent-only commitments on the hourly plan timeline', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <WeekView
          selectedDate="2026-08-24"
          plans={[]}
          actuals={[]}
          monthEvents={[monthEvent()]}
          onOpenDay={vi.fn()}
        />,
      );
    });

    const serialized = JSON.stringify(renderer.toJSON());
    expect(serialized).toContain('美容院');
    expect(serialized).toContain('18:00');
    expect(serialized).toContain('19:00');
    expect(
      renderer.root.findAll(
        (node) => node.props['data-schedule-week-spanning-events'] === 'true',
      ),
    ).toHaveLength(0);
  });

  it('moves multi-day MonthEvents into one spanning lane above the hourly grid', () => {
    let renderer!: ReactTestRenderer;
    const onMovePlan = vi.fn();

    act(() => {
      renderer = create(
        <WeekView
          selectedDate="2026-08-24"
          plans={[]}
          actuals={[]}
          monthEvents={[
            monthEvent({
              date: '2026-08-24',
              endDate: '2026-08-26',
              startTime: '18:00',
              endTime: '10:00',
            }),
          ]}
          onMovePlan={onMovePlan}
          onOpenDay={vi.fn()}
        />,
      );
    });

    const spanningLane = renderer.root.find(
      (node) => node.props['data-schedule-week-spanning-events'] === 'true',
    );
    const spanningEvent = renderer.root.find(
      (node) => node.props['data-week-spanning-event'] === 'true',
    );
    const occurrenceNodes = renderer.root.findAll(
      (node) => node.props['data-schedule-occurrence-id'] === 'month-event:appointment-1:2026-08-24',
    );

    expect(spanningLane).toBeTruthy();
    expect(spanningEvent.props.style.gridColumn).toBe('2 / 5');
    expect(occurrenceNodes).toHaveLength(1);
    expect(occurrenceNodes[0].props['data-week-spanning-event']).toBe('true');
    expect(onMovePlan).not.toHaveBeenCalled();
  });
});
