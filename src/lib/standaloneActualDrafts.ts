import { getEntryDurationMinutes, resolveEntryEndTime } from './entryTimeRange';
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
  const minutes = getEntryDurationMinutes(actual.actualStartTime, actual.actualEndTime);
  return minutes > 0 ? minutes : null;
}

export function resolveStandaloneActualEndTime(
  startTime: string,
  durationMinutes: number | null,
): string | null {
  return durationMinutes === null ? null : resolveEntryEndTime(startTime, durationMinutes);
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
  values: StandaloneActualEditValues,
): Actual {
  return {
    ...actual,
    planId: null,
    occurrenceDate: values.occurrenceDate,
    actualStartTime: values.startTime,
    actualEndTime: values.endTime,
    title: values.title,
    subject: values.subject,
    isAlignedToPlan: false,
    note: values.note,
  };
}
