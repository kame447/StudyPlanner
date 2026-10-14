import { createEmptyPlanDraft, createPlanFromDraft } from '../../src/domain/planner';
import { createTimetableTermId } from '../../src/domain/timetableDataNormalization';
import { scheduleEventFromMonthEvent, scheduleEventFromPlan } from '../../src/domain/scheduleEvent';
import { addDays } from '../../src/lib/date';
import type { MonthEvent, Plan } from '../../src/types/domain';

export const OWNER = 'read-load-owner';
export const NOW = '2026-10-08T12:00:00.000Z';
export const SIZES = { small: 1, medium: 10, large: 100 } as const;
export const APPROVAL_COUNT = 5;

export function fixtures(scale: number) {
  const plans: Plan[] = Array.from({ length: 24 * scale }, (_, i) => ({
    ...createPlanFromDraft({ ...createEmptyPlanDraft(OWNER, addDays('2024-01-01', i % 1100)),
      title: `Historical plan ${i}`, subject: 'Math', startTime: '09:00', endTime: '10:00' }),
    id: `plan-${i}`, seriesId: `plan-${i}`,
  }));
  // A historical recurring series must remain visible now, including its exclusion.
  plans[0] = { ...plans[0], date: '2024-01-01', repeat: 'daily', repeatUntil: '2027-12-31', excludedDates: ['2026-10-09'],
    recurrenceRules: [{ id: 'daily-rule', kind: 'daily', startDate: '2024-01-01', until: '2027-12-31',
      dates: [], weekdays: [], dayType: null, startTime: '09:00', endTime: '10:00', isOverride: false }] };
  const events: MonthEvent[] = Array.from({ length: 8 * scale }, (_, i) => ({
    id: `event-${i}`, userId: OWNER, title: `Multi-day event ${i}`, date: addDays('2024-01-01', i % 1000),
    endDate: addDays('2024-01-01', i % 1000 + 3), startTime: '08:00', endTime: '18:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
    createdAt: NOW, updatedAt: NOW,
  }));
  events[0] = { ...events[0], date: '2026-09-30', endDate: '2026-10-10' };
  events[1] = { ...events[1], date: '2024-10-01', endDate: '2024-10-03', repeat: 'yearly', repeatUntil: '2028-01-01' };
  const termId = createTimetableTermId(OWNER, 2026, 'fullYear', NOW);
  const stamp = { userId: OWNER, createdAt: NOW, updatedAt: NOW };
  const documents: Record<string, Array<Record<string, unknown>>> = {
    schedule_events: [...plans.map(plan => ({ ...scheduleEventFromPlan(plan) })), ...events.map(event => ({ ...scheduleEventFromMonthEvent(event) }))],
    schedule_event_migrations: [{ id: OWNER, userId: OWNER, schemaVersion: 1, migrationVersion: 1, status: 'completed',
      sourcePlanCount: plans.length, sourceMonthEventCount: events.length, eventCount: plans.length + events.length, completedAt: NOW }],
    actuals: Array.from({ length: 12 * scale }, (_, i) => ({ id: `actual-${i}`, userId: OWNER, planId: `plan-${i}`,
      occurrenceDate: plans[i].date, actualStartTime: '09:05', actualEndTime: '10:00', subject: 'Math', note: '', updatedAt: NOW })),
    day_notes: Array.from({ length: 4 * scale }, (_, i) => ({ id: `note-${i}`, userId: OWNER, date: addDays('2024-01-01', i),
      quickMemo: 'fixture', reflection: '', nextFocus: '', checkedPlan: false, checkedRecord: false, checkedReady: false, updatedAt: NOW })),
    todos: Array.from({ length: 3 * scale }, (_, i) => ({ ...stamp, id: `todo-${i}`, title: `Todo ${i}`, subject: 'Math',
      type: 'study', estimatedMinutes: 30, dueDate: null, memo: '', status: 'open', scheduledPlanId: null })),
    study_subjects: [{ ...stamp, id: 'subject', name: 'Math', color: '#112233' }],
    study_materials: Array.from({ length: 4 * scale }, (_, i) => ({ ...stamp, id: `material-${i}`, name: `Book ${i}`,
      subjectId: 'subject', subjectName: 'Math', status: i % 2 ? 'archived' : 'active' })),
    schedule_templates: Array.from({ length: 3 }, (_, i) => ({ ...stamp, id: `template-${i}`, title: `Class ${i}`, subject: 'Math',
      type: 'study', weekday: 'mon', startTime: '11:00', endTime: '12:00', termId, periodNumber: i + 1,
      alternatingWeek: 'both', weekInterval: 1, weekIntervalAnchorDate: null, memo: '', active: true })),
    timetable_terms: [{ ...stamp, id: termId, year: 2026, kind: 'fullYear', label: '2026年 通年', isActive: true }],
    timetable_periods: Array.from({ length: 3 }, (_, i) => ({ ...stamp, id: `period-${i}`, termId, periodNumber: i + 1,
      label: `${i + 1}限`, startTime: '11:00', endTime: '12:00' })),
  };
  // Query filtering is observable: another owner's rows must not be returned.
  documents.schedule_events.push({ ...documents.schedule_events[0], id: 'other-owner-plan', userId: 'other-owner' });
  return { documents, plans, events };
}
