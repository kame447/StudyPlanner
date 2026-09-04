import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { Plan } from '../types/domain';
import { DayTimeline } from './DayTimeline';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'timed-plan',
    seriesId: 'timed-plan',
    userId: 'user-1',
    title: '通常予定',
    subject: '数学',
    date: '2026-08-25',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function occurrence(
  sourcePlan: Plan,
  endDate = sourcePlan.date,
  endTime = sourcePlan.endTime,
): ScheduleOccurrence {
  return {
    id: `plan:${sourcePlan.id}:${sourcePlan.date}`,
    ownerId: sourcePlan.userId,
    title: sourcePlan.title,
    subject: sourcePlan.subject,
    category: 'study',
    busy: true,
    start: { date: sourcePlan.date, time: sourcePlan.startTime },
    end: { date: endDate, time: endTime },
    source: {
      kind: 'plan',
      id: sourcePlan.id,
      backingKind: 'plan',
      backingId: sourcePlan.id,
    },
    planSourceType: sourcePlan.sourceType,
  };
}

describe('DayTimeline schedule occurrence presentation', () => {
  it('keeps timed plans in the hourly grid and moves all-day plans to the top strip', () => {
    const timedPlan = plan();
    const allDayPlan = plan({
      id: 'all-day-plan',
      seriesId: 'all-day-plan',
      title: '終日予定',
      startTime: '00:00',
      endTime: '24:00',
    });
    const onSelectEntry = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayTimeline
          dateLabel="2026年8月25日"
          plans={[timedPlan, allDayPlan]}
          monthEvents={[]}
          scheduleOccurrences={[
            occurrence(timedPlan),
            occurrence(allDayPlan, '2026-08-26', '00:00'),
          ]}
          actuals={[]}
          onSelectEntry={onSelectEntry}
          onPreviousDay={vi.fn()}
          onNextDay={vi.fn()}
          onPrint={vi.fn()}
        />,
      );
    });

    const topStrip = renderer.root.find(
      (node) => node.props['data-day-spanning-events'] === 'true',
    );
    const allDayButton = renderer.root.find(
      (node) => node.props['data-day-spanning-event'] === 'true',
    );
    const hourlyScheduleBlocks = renderer.root.findAll(
      (node) =>
        typeof node.props.className === 'string' &&
        node.props.className.split(' ').includes('timeline-plan-block') &&
        !node.props.className.includes('timeline-draft-block'),
    );

    expect(topStrip).toBeTruthy();
    expect(allDayButton.props['data-schedule-occurrence-id']).toBe(
      'plan:all-day-plan:2026-08-25',
    );
    expect(hourlyScheduleBlocks).toHaveLength(1);
    expect(
      hourlyScheduleBlocks[0].findByProps({ className: 'timeline-entry-title' }).children,
    ).toContain('通常予定');

    act(() => {
      allDayButton.props.onClick();
    });
    expect(onSelectEntry).toHaveBeenCalledWith({ kind: 'plan', id: 'all-day-plan' });
  });
});
