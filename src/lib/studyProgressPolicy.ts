import { scheduleEventFromPlan } from '../domain/scheduleEvent';
import type { ScheduleOccurrenceSource } from '../domain/scheduleOccurrence';
import type { ActualProgressSource, Plan } from '../types/domain';

export interface StudyProgressPreferences {
  includeGeneralEvents: boolean;
  includeTimetable: boolean;
}

export const DEFAULT_STUDY_PROGRESS_PREFERENCES: StudyProgressPreferences = {
  includeGeneralEvents: false,
  includeTimetable: false,
};

// Read-only projection metadata; never written back to saved Plan data.
export type StudyProgressPlan = Plan & { scheduleSource?: ScheduleOccurrenceSource };

export function isIncludedInStudyProgress(
  plan: StudyProgressPlan,
  preferences: StudyProgressPreferences = DEFAULT_STUDY_PROGRESS_PREFERENCES,
): boolean {
  if (plan.scheduleSource?.kind === 'timetable' || plan.sourceType === 'timetable') {
    return preferences.includeTimetable;
  }
  if (plan.scheduleSource?.backingKind === 'month-event') {
    return preferences.includeGeneralEvents;
  }
  return scheduleEventFromPlan(plan).kind === 'study' || preferences.includeGeneralEvents;
}

export function canRecordProgressActual(plan: StudyProgressPlan): boolean {
  return !plan.scheduleSource || plan.scheduleSource.backingKind === 'plan';
}

export function isActualProgressSourceIncluded(
  source: ActualProgressSource | undefined,
  preferences: StudyProgressPreferences = DEFAULT_STUDY_PROGRESS_PREFERENCES,
): boolean {
  if (source?.kind === 'general-event') return preferences.includeGeneralEvents;
  if (source?.kind === 'timetable') return preferences.includeTimetable;
  return true;
}
