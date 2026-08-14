import {
  formatMinutesToTime,
  minutesBetween,
  parseTimeToMinutes,
} from './date';
import type { Actual, ActualDraft } from '../types/domain';

export interface StandaloneActualEditValues {
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  note: string;
}

export function getStandaloneActualDurationMinutes(actual: Actual): number | null {
  const minutes = minutesBetween(actual.actualStartTime, actual.actualEndTime);
  return minutes > 0 ? minutes : null;
}

export function resolveStandaloneActualEndTime(
  startTime: string,
  durationMinutes: number | null,
): string | null {
  if (durationMinutes === null || durationMinutes <= 0 || durationMinutes >= 24 * 60) {
    return null;
  }

  const endMinutes = Math.min(
    parseTimeToMinutes(startTime, 'start') + durationMinutes,
    24 * 60,
  );

  return formatMinutesToTime(endMinutes, 'end');
}

export function createStandaloneActualDraft(
  actual: Actual,
  values: StandaloneActualEditValues,
): ActualDraft {
  return {
    userId: actual.userId,
    planId: null,
    occurrenceDate: values.occurrenceDate,
    actualStartTime: values.startTime,
    actualEndTime: values.endTime,
    title: values.title.trim(),
    subject: values.subject.trim(),
    isAlignedToPlan: false,
    note: values.note.trim(),
    materialId: actual.materialId ?? null,
    materialName: actual.materialName ?? '',
    materialProgressUpdates: actual.materialProgressUpdates,
  };
}

export function createStandaloneActualCandidate(
  actual: Actual,
  draft: ActualDraft,
): Actual {
  return {
    ...actual,
    planId: null,
    occurrenceDate: draft.occurrenceDate,
    actualStartTime: draft.actualStartTime,
    actualEndTime: draft.actualEndTime,
    title: draft.title,
    subject: draft.subject,
    isAlignedToPlan: false,
    note: draft.note,
  };
}
