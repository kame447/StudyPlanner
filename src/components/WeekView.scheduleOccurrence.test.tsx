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

function findTimedBlock(renderer: ReactTestRenderer, title: string) {
  return renderer.root.find(
    (node) =>
      typeof node.props.title === 'string' &&
      node.props.title.startsWith(`${title} / `) &&
      node.props['data-week-spanning-event'] !== 'true',
  );
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

  it('limits width splitting to the actual overlap cluster within a day', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <WeekView
          selectedDate="2026-08-24"
          plans={[]}
          actuals={[]}
          monthEvents={[
            monthEvent({ id: 'overlap-a', title: '重複A', startTime: '08:00', endTime: '10:00' }),
            monthEvent({ id: 'overlap-b', title: '重複B', startTime: '09:00', endTime: '11:00' }),
            monthEvent({ id: 'independent', title: '独立予定', startTime: '13:00', endTime: '14:00' }),
            monthEvent({ id: 'touching', title: '境界予定', startTime: '14:00', endTime: '15:00' }),
          ]}
          onOpenDay={vi.fn()}
        />,
      );
    });

    expect(findTimedBlock(renderer, '重複A').props.style.width).toBe('calc(50% - 4px)');
    expect(findTimedBlock(renderer, '重複B').props.style.width).toBe('calc(50% - 4px)');
    expect(findTimedBlock(renderer, '独立予定').props.style.width).toBe('calc(100% - 4px)');
    expect(findTimedBlock(renderer, '境界予定').props.style.width).toBe('calc(100% - 4px)');
  });

  it('uses the normal timed-card title typography and compact horizontal inset in the spanning lane', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <WeekView
          selectedDate="2026-08-24"
          plans={[]}
          actuals={[]}
          monthEvents={[
            monthEvent({
              id: 'all-day-readable',
              date: '2026-08-28',
              endDate: '2026-08-29',
              title: '旅行計画表',
              startTime: '00:00',
              endTime: '00:00',
            }),
          ]}
          onOpenDay={vi.fn()}
        />,
      );
    });

    const spanningEvent = renderer.root.find(
      (node) => node.props['data-week-spanning-event'] === 'true',
    );

    expect(spanningEvent.props.children).toBe('旅行計画表');
    expect(spanningEvent.props.style.fontSize).toBe('0.5rem');
    expect(spanningEvent.props.style.fontWeight).toBe(850);
    expect(spanningEvent.props.style.margin).toBe('2px 1px');
    expect(spanningEvent.props.style.padding).toBe('2px 2px');
  });
});
