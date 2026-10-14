import { describe, expect, it } from 'vitest';
import type { Actual, MonthEvent, Plan, ScheduleTemplate, TimetableTerm } from '../../../types/domain';
import { selectWeeklyPlanningDialogueReferenceContext } from './weeklyPlanningDialogueReferenceContext';

const DATE = '2026-10-15';
const OWNER = 'owner-1';
const UPDATED = '2026-10-14T12:00:00Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'plan-1', userId: OWNER, title: '数学の復習',
    subject: '数学', type: 'study', date: '2026-10-13',
    startTime: '17:00', endTime: '18:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
    memo: 'private note not for AI', createdAt: UPDATED, updatedAt: UPDATED,
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1', userId: OWNER, planId: 'plan-1', occurrenceDate: '2026-10-13',
    actualStartTime: '17:00', actualEndTime: '18:00',
    subject: '数学', note: 'confidential reflection not for AI',
    updatedAt: UPDATED,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'event-1', userId: OWNER, date: DATE, title: 'ゼミ',
    startTime: '13:00', endTime: '14:00',
    repeat: 'none', repeatUntil: null, excludedDates: [],
    memo: 'do not expose event memo', url: '', checklist: [], locationTags: [],
    createdAt: UPDATED, updatedAt: UPDATED,
    ...overrides,
  };
}

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'class-1', userId: OWNER, title: '情報学の講義',
    subject: '情報学', type: 'school-event', weekday: 'thu',
    startTime: '09:00', endTime: '10:30', termId: 'term-1',
    active: true, createdAt: UPDATED, updatedAt: UPDATED, memo: 'private classroom',
    ...overrides,
  };
}

const term: TimetableTerm = {
  id: 'term-1', userId: OWNER, year: 2026, kind: 'custom',
  label: '後期', isActive: true, startDate: '2026-10-01', endDate: '2026-11-30',
  createdAt: UPDATED, updatedAt: UPDATED,
};

describe('read-only owner evidence for conversational examples', () => {
  it('distinguishes completed work, historical plans and today\'s existing commitments', () => {
    const plans = [
      plan(),
      plan({ id: 'plan-2', title: '英語の復習', date: '2026-10-11' }),
      plan({ id: 'plan-3', title: 'バイト', date: DATE, type: 'other', startTime: '19:00', endTime: '21:00' }),
      plan({ id: 'private-plan', title: '他人の予定', userId: 'another-user' }),
    ];
    const actuals = [
      actual(),
      actual({ id: 'actual-2', planId: 'plan-2', occurrenceDate: '2026-10-12', title: '英語の単語練習' }),
      actual({ id: 'private-actual', title: '他人の実績', userId: 'another-user' }),
    ];
    const events = [monthEvent(), monthEvent({ id: 'private-event', title: '他人のイベント', userId: 'another-user' })];
    const before = structuredClone({ plans, actuals, events });
    const context = selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE,
      plans, actuals, monthEvents: events,
    });
    expect(context).toEqual({
      referenceDate: DATE,
      pastActivities: [
        { source: 'completed', label: '数学の復習', date: '2026-10-13' },
        { source: 'completed', label: '英語の単語練習', date: '2026-10-12' },
        { source: 'planned', label: '英語の復習', date: '2026-10-11' },
      ],
      targetDateCommitments: [
        { source: 'existing_commitment', label: 'ゼミ', category: 'other', startTime: '13:00', endTime: '14:00' },
        { source: 'existing_commitment', label: 'バイト', category: 'other', startTime: '19:00', endTime: '21:00' },
      ],
    });
    expect(JSON.stringify(context)).not.toMatch(/confidential|private note|他人|do not expose|private classroom/);
    expect({ plans, actuals, events }).toEqual(before);
  });

  it('uses the canonical timetable projection rather than inventing today\'s lesson from a template', () => {
    const context = selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE,
      plans: [], actuals: [], scheduleTemplates: [
        template(),
        template({ id: 'other-class', title: '他人の授業', userId: 'another-user' }),
      ],
      timetableTerm: term, timetableTermId: term.id, timetableTerms: [term],
    });
    expect(context?.pastActivities).toEqual([]);
    expect(context?.targetDateCommitments).toEqual([{
      source: 'existing_commitment', label: '情報学の講義', category: 'class',
      startTime: '09:00', endTime: '10:30',
    }]);
  });

  it('does not mistake a mere past plan for a completed activity or infer user intent', () => {
    const context = selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE,
      plans: [plan({ title: '研究', date: '2026-10-10' })],
    });
    expect(context?.pastActivities).toEqual([
      { source: 'planned', label: '研究', date: '2026-10-10' },
    ]);
    expect(context?.targetDateCommitments).toEqual([]);
    expect(context).not.toHaveProperty('requestedActivities');
  });

  it('does not leak other owners, future work, expired activities, private notes or unbounded labels', () => {
    const context = selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE,
      plans: [
        plan({ userId: 'other', title: '秘密' }),
        plan({ id: 'old', date: '2026-08-12', title: '期限外' }),
        plan({ id: 'tomorrow', date: '2026-10-16', title: '未来' }),
      ],
      actuals: [actual({ id: 'standalone', planId: null, occurrenceDate: '2026-10-14',
        title: '英語'.repeat(200), note: 'private actual details' })],
      monthEvents: [monthEvent({ title: '他人の予定', userId: 'other' })],
    });
    expect(context?.pastActivities).toHaveLength(1);
    expect(context?.pastActivities[0].label.length).toBeLessThanOrEqual(60);
    expect(JSON.stringify(context)).not.toMatch(/秘密|期限外|未来|他人の予定|private/);
  });

  it('returns no reference when evidence is absent or all from another owner', () => {
    expect(selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE, plans: [], actuals: [],
    })).toBeNull();
    expect(selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: DATE, plans: [plan({ userId: 'other' })],
    })).toBeNull();
    expect(selectWeeklyPlanningDialogueReferenceContext({
      ownerId: OWNER, referenceDate: 'invalid', plans: [plan()],
    })).toBeNull();
  });

  it('keeps results bounded and deterministic across many repeated records', () => {
    const manyActuals = Array.from({ length: 150 }, (_, n) =>
      actual({ id: 'actual-' + String(n), title: '研究' + String(n),
        planId: null, occurrenceDate: '2026-10-14' }));
    const manyPlans = Array.from({ length: 150 }, (_, n) =>
      plan({ id: 'plan-' + String(n), title: '数学' + String(n), date: '2026-10-13' }));
    const input = { ownerId: OWNER, referenceDate: DATE, plans: manyPlans, actuals: manyActuals };
    const selected = selectWeeklyPlanningDialogueReferenceContext(input);
    expect(selected?.pastActivities).toHaveLength(3);
    expect(selected?.pastActivities.filter(item => item.source === 'completed')).toHaveLength(2);
    expect(selected?.pastActivities.filter(item => item.source === 'planned')).toHaveLength(1);
    expect(selectWeeklyPlanningDialogueReferenceContext(input)).toEqual(selected);
  });
});
