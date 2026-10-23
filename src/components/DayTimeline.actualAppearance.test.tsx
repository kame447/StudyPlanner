import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import { DayTimeline } from './DayTimeline';

it.each(['plan', 'month-event', 'standalone-actual'] as const)(
  'renders %s records without a thick inset stripe and preserves selection',
  kind => {
    const date = '2026-10-14';
    const actual: Actual = {
      id: 'record', userId: 'owner', planId: kind === 'standalone-actual' ? null : 'source',
      occurrenceDate: date, title: '記録のタイトル', subject: 'その他',
      actualStartTime: '15:00', actualEndTime: '15:30', note: '', updatedAt: '',
    };
    const source = {
      id: 'source', userId: 'owner', date, title: '予定のタイトル', startTime: '15:00', endTime: '16:30',
      repeat: 'none' as const, repeatUntil: null, excludedDates: [], memo: '', createdAt: '', updatedAt: '',
    };
    const plan: Plan = { ...source, seriesId: source.id, subject: 'その他', type: 'other', recurrenceRules: [] };
    const event: MonthEvent = { ...source, url: '', checklist: [], locationTags: [] };
    const onSelectEntry = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<DayTimeline dateLabel={date} plans={kind === 'plan' ? [plan] : []}
        monthEvents={kind === 'month-event' ? [event] : []} scheduleOccurrences={[]}
        actuals={[actual]} onSelectEntry={onSelectEntry} onPreviousDay={vi.fn()}
        onNextDay={vi.fn()} onPrint={vi.fn()} />);
    });
    try {
      const records = renderer.root.findAllByType('button').filter(node =>
        node.props.className?.split(' ').includes('timeline-actual-block'));
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.props.style.boxShadow).toBeUndefined();
      expect(record.props.style.backgroundColor).toBeTruthy();
      expect(record.props.style.borderColor).toBeTruthy();
      expect(record.findByProps({ className: 'timeline-entry-title' }).children).toEqual([actual.title]);
      expect(record.findByProps({ className: 'timeline-entry-time' }).children.join('')).toBe('15:00-15:30');
      act(() => record.props.onClick());
      expect(onSelectEntry).toHaveBeenCalledExactlyOnceWith({ kind, id: kind === 'standalone-actual' ? actual.id : source.id, ...(kind === 'standalone-actual' ? {} : { actualId: actual.id }) });
    } finally {
      act(() => renderer.unmount());
    }
  },
);


it('only displays a major event in the actual column when a saved record exists', () => {
  const event: MonthEvent = { id: 'job', userId: 'owner', date: '2026-10-14', title: '塾バイト',
    startTime: '17:00', endTime: '21:30', repeat: 'none', repeatUntil: null, excludedDates: [],
    url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const actual: Actual = { id: 'job-record', userId: event.userId, planId: event.id,
    occurrenceDate: event.date, title: event.title, subject: '主要予定',
    actualStartTime: event.startTime, actualEndTime: event.endTime, note: '', updatedAt: '' };
  const onSelectEntry = vi.fn();
  const timeline = (actuals: Actual[]) => <DayTimeline dateLabel={event.date} plans={[]} monthEvents={[event]}
    scheduleOccurrences={[]} actuals={actuals} onSelectEntry={onSelectEntry}
    onPreviousDay={vi.fn()} onNextDay={vi.fn()} onPrint={vi.fn()} />;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(timeline([])); });
  try {
    const blocks = (kind: 'plan' | 'actual') => renderer.root.findAllByType('button')
      .filter(node => node.props.className?.split(' ').includes(`timeline-${kind}-block`));
    expect(blocks('plan')).toHaveLength(1);
    expect(blocks('actual')).toHaveLength(0);
    act(() => renderer.update(timeline([actual])));
    expect(blocks('plan')).toHaveLength(1);
    expect(blocks('actual')).toHaveLength(1);
    act(() => blocks('actual')[0].props.onClick());
    expect(onSelectEntry).toHaveBeenCalledExactlyOnceWith({ kind: 'month-event', id: event.id, actualId: actual.id });
  } finally {
    act(() => renderer.unmount());
  }
});
