import { getRecurrenceWeekday } from '../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import type { MonthEvent, Plan, ScheduleTemplate, TimetableTerm } from '../types/domain';
import { applyRecurringPlanDeleteScope, supportsScopedRecurringPlanEdits } from './recurringPlan';
import { createScheduleOccurrenceProjection, type ScheduleOccurrence } from './scheduleOccurrence';

export type DayOccurrenceCancellation =
  | { kind: 'plan'; before: Plan; after: Plan }
  | { kind: 'month-event'; before: MonthEvent; after: MonthEvent }
  | { kind: 'timetable'; before: ScheduleTemplate[]; after: ScheduleTemplate[] };

export interface DayOccurrenceCancellationInput {
  ownerId: string;
  occurrence: ScheduleOccurrence;
  plans: Plan[];
  monthEvents: MonthEvent[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTerms: TimetableTerm[];
  timetableTermId?: string;
}

// Cancel the selected occurrence, retaining the source and every linked Actual.
// This is deliberately separate from series/Plan deletion, which owns dependents.
export function buildDayOccurrenceCancellation(input: DayOccurrenceCancellationInput): DayOccurrenceCancellation {
  const { occurrence, ownerId } = input;
  if (occurrence.ownerId !== ownerId) throw new Error('この予定を変更できません。');
  const date = occurrence.start.date;
  const projected = createScheduleOccurrenceProjection({ ...input, startDate: date, endDate: date });
  const current = projected.occurrences.find(row => row.id === occurrence.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(occurrence)) {
    throw new Error('予定が更新されました。現在の予定を開き直してください。');
  }
  const updatedAt = new Date().toISOString();
  const exclude = (dates: readonly string[] = []) => [...new Set([...dates, date])].sort();
  if (occurrence.source.backingKind === 'plan') {
    const before = input.plans.find(row => row.id === occurrence.source.backingId && row.userId === ownerId)!;
    const changed = supportsScopedRecurringPlanEdits(before)
      ? applyRecurringPlanDeleteScope(before, date, 'single') ?? before : before;
    // Preserve date-rule metadata for linked history, even when the existing
    // single-delete helper removes that rule or normalizes its final occurrence.
    return { kind: 'plan', before, after: { ...before, excludedDates: exclude(changed.excludedDates), updatedAt } };
  }
  if (occurrence.source.backingKind === 'month-event') {
    const before = input.monthEvents.find(row => row.id === occurrence.source.backingId && row.userId === ownerId)!;
    return { kind: 'month-event', before, after: { ...before, excludedDates: exclude(before.excludedDates), updatedAt } };
  }
  const term = resolveTimetableTermForDate(date, input.timetableTerms, input.timetableTermId);
  const candidate = buildTimetableImportCandidates({ templates: input.scheduleTemplates.filter(row => row.userId === ownerId),
    date, weekday: getRecurrenceWeekday(date), termId: term?.id ?? input.timetableTermId ?? 'default', term,
  }).find(row => row.sourceId === occurrence.source.backingId);
  if (!candidate) throw new Error('時間割が更新されました。現在の予定を開き直してください。');
  return { kind: 'timetable', before: candidate.templates,
    after: candidate.templates.map(row => ({ ...row, excludedDates: exclude(row.excludedDates), updatedAt })) };
}
