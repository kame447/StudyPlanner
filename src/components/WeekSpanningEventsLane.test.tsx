import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { Plan } from '../types/domain';
import { WeekSpanningEventsLane } from './WeekSpanningEventsLane';

let renderer: ReactTestRenderer | undefined;
afterEach(() => act(() => renderer?.unmount()));
const base: ScheduleOccurrence = {
  id: 'event', ownerId: 'owner', title: '終日予定', subject: '', category: 'other', busy: true,
  start: { date: '2026-10-05', time: '00:00' }, end: { date: '2026-10-05', time: '24:00' },
  source: { kind: 'month-event', id: 'event', backingKind: 'month-event', backingId: 'event' },
};

function render(occurrence: ScheduleOccurrence, plans: Plan[] = []) {
  const onOpenPlan = vi.fn();
  const onOpenOccurrence = vi.fn();
  act(() => {
    renderer = create(<WeekSpanningEventsLane
      layout={{ laneCount: 1, items: [{ occurrence, startColumn: 0, endColumn: 1, lane: 0 }] }}
      plans={plans} onOpenPlan={onOpenPlan} onOpenOccurrence={onOpenOccurrence}
    />);
  });
  return { card: renderer!.root.findByProps({ 'data-week-spanning-event': 'true' }), onOpenPlan, onOpenOccurrence };
}

describe('spanning lane action ownership', () => {
  it('keeps read-only timetable occurrences out of the focus/action path', () => {
    const ui = render({ ...base, source: { kind: 'timetable', id: 't', backingKind: 'timetable-template', backingId: 't' } });
    expect(ui.card.type).toBe('span');
    expect(ui.card.props['aria-label']).toBe('終日予定。終日または日を跨ぐ時間割');
    for (const prop of ['tabIndex', 'onClick', 'onKeyDown', 'onContextMenu', 'data-schedule-occurrence-id']) {
      expect(ui.card.props[prop]).toBeUndefined();
    }
    expect(ui.onOpenOccurrence).not.toHaveBeenCalled();
  });

  it('preserves study-plan tap editing rather than opening the major-event menu', () => {
    const plan: Plan = { id: 'p', seriesId: 'p', userId: 'owner', title: base.title, subject: '数学', type: 'study', date: base.start.date,
      startTime: '00:00', endTime: '24:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      memo: '', createdAt: '', updatedAt: '' };
    const ui = render({ ...base, source: { kind: 'plan', id: 'p', backingKind: 'plan', backingId: 'p' } }, [plan]);
    expect(ui.card.type).toBe('button');
    expect(ui.card.props.type).toBe('button');
    act(() => ui.card.props.onClick());
    expect(ui.onOpenPlan).toHaveBeenCalledExactlyOnceWith(plan);
    expect(ui.onOpenOccurrence).not.toHaveBeenCalled();
  });
});
