import { addDays } from '../../../lib/date';
import { createScheduleOccurrenceProjection } from '../../../domain/scheduleOccurrence';
import type {
  Actual, MonthEvent, Plan, ScheduleTemplate, TimetableTerm,
} from '../../../types/domain';

export interface WeeklyPlanningDialogueReferenceActivity {
  /** A completed study record is distinct from a plan that might never have happened. */
  source: 'completed' | 'planned';
  label: string;
  date: string;
}

export interface WeeklyPlanningDialogueReferenceCommitment {
  source: 'existing_commitment';
  label: string;
  category: 'class' | 'exam' | 'school' | 'cram-school' | 'deadline' | 'other';
  startTime: string;
  endTime: string;
}

export interface WeeklyPlanningDialogueReferenceContext {
  /** Lookback boundary; this is the current request date, not always the target day. */
  referenceDate: string;
  /** Omitted when equal to referenceDate; null means the target spans multiple days. */
  targetDate?: string | null;
  pastActivities: WeeklyPlanningDialogueReferenceActivity[];
  targetDateCommitments: WeeklyPlanningDialogueReferenceCommitment[];
}

const HISTORY_DAYS = 30;
const MAX_COMPLETED = 2;
const MAX_PLANNED = 1;
const MAX_COMMITMENTS = 2;
const MAX_LABEL_LENGTH = 60;
const STUDY_TYPES = new Set<Plan['type']>(['study', 'mock-exam']);

function normalizedLabel(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  // Never pass a full memo, private note, or uncontrolled amount of user data
  // into the renderer prompt (and consequently the diagnostic trace).
  const label = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, MAX_LABEL_LENGTH) : null;
}

function uniqueActivityKey(label: string): string {
  return label.normalize('NFKC').toLocaleLowerCase('ja-JP');
}

function withinRange(date: string, start: string, end: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date < end;
}

/**
 * Select only owner-scoped, previously loaded evidence for conversation
 * *examples*. No Firestore reads, semantic changes, or schedule mutations.
 * This is invoked only for an unspecific request for activities.
 */
export function selectWeeklyPlanningDialogueReferenceContext(params: {
  ownerId: string;
  referenceDate: string;
  /** Null omits day-specific commitments for a multi-day planning window. */
  targetDate?: string | null;
  plans: readonly Plan[];
  actuals?: readonly Actual[];
  monthEvents?: readonly MonthEvent[];
  scheduleTemplates?: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
}): WeeklyPlanningDialogueReferenceContext | null {
  const { ownerId, referenceDate } = params;
  if (!ownerId || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
  const targetDate = params.targetDate === undefined ? referenceDate : params.targetDate;
  if (targetDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const earliestDate = addDays(referenceDate, -HISTORY_DAYS);
  const ownedPlans = params.plans.filter(plan => plan.userId === ownerId);
  const plansById = new Map(ownedPlans.map(plan => [plan.id, plan]));
  const used = new Set<string>();
  const completed: WeeklyPlanningDialogueReferenceActivity[] = [];
  const actuals = (params.actuals ?? [])
    .filter(actual => actual.userId === ownerId
      && withinRange(actual.occurrenceDate, earliestDate, addDays(referenceDate, 1)))
    .sort((left, right) =>
      right.occurrenceDate.localeCompare(left.occurrenceDate)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id));
  for (const actual of actuals) {
    const linked = actual.planId ? plansById.get(actual.planId) : undefined;
    if (linked && !STUDY_TYPES.has(linked.type)) continue;
    const label = normalizedLabel(actual.title || linked?.title || actual.subject);
    if (!label) continue;
    const key = uniqueActivityKey(label);
    if (used.has(key)) continue;
    used.add(key);
    completed.push({ source: 'completed', label, date: actual.occurrenceDate });
    if (completed.length === MAX_COMPLETED) break;
  }

  const planned: WeeklyPlanningDialogueReferenceActivity[] = [];
  const candidates = ownedPlans
    .filter(plan => STUDY_TYPES.has(plan.type)
      && withinRange(plan.date, earliestDate, referenceDate))
    .sort((left, right) =>
      right.date.localeCompare(left.date)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id));
  for (const plan of candidates) {
    const label = normalizedLabel(plan.title);
    if (!label) continue;
    const key = uniqueActivityKey(label);
    if (used.has(key)) continue;
    used.add(key);
    planned.push({ source: 'planned', label, date: plan.date });
    if (planned.length === MAX_PLANNED) break;
  }

  // Use the same canonical occurrence expansion as the Day/Week planner:
  // recurring lessons and date-specific overrides must not be guessed from
  // raw plan templates.
  const projection = targetDate === null ? { occurrences: [] } : createScheduleOccurrenceProjection({
    ownerId,
    startDate: targetDate,
    endDate: targetDate,
    plans: ownedPlans,
    monthEvents: params.monthEvents,
    scheduleTemplates: params.scheduleTemplates,
    timetableTermId: params.timetableTermId,
    timetableTerm: params.timetableTerm,
    timetableTerms: params.timetableTerms,
  });
  const targetDateCommitments: WeeklyPlanningDialogueReferenceCommitment[] = [];
  for (const occurrence of projection.occurrences) {
    if (!occurrence.busy || occurrence.category === 'study') continue;
    if (targetDate === null || occurrence.start.date > targetDate
      || occurrence.end.date < targetDate) continue;
    const label = normalizedLabel(occurrence.title);
    if (!label) continue;
    const category = occurrence.category;
    targetDateCommitments.push({
      source: 'existing_commitment',
      label,
      category: category === 'class' || category === 'exam'
        || category === 'school' || category === 'cram-school'
        || category === 'deadline' ? category : 'other',
      // Canonical occurrences may span midnight; state only the interval
      // actually occupied on this target day, not yesterday's starting hour.
      startTime: occurrence.start.date < targetDate ? '00:00' : occurrence.start.time,
      endTime: occurrence.end.date > targetDate ? '24:00' : occurrence.end.time,
    });
    if (targetDateCommitments.length === MAX_COMMITMENTS) break;
  }
  if (completed.length === 0 && planned.length === 0 && targetDateCommitments.length === 0) {
    return null;
  }
  return {
    referenceDate,
    ...(targetDate !== referenceDate ? { targetDate } : {}),
    pastActivities: [...completed, ...planned],
    targetDateCommitments,
  };
}
