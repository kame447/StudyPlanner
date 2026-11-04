import { getEntryDurationMinutes, resolveEntryEndTime } from './entryTimeRange';
import type { ActualDraft, TimedActual } from '../types/domain';

export interface StandaloneActualEditValues {
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  note: string;
}

export function getStandaloneActualDurationMinutes(actual: TimedActual): number | null {
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
  actual: TimedActual,
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
  actual: TimedActual,
  values: StandaloneActualEditValues,
): TimedActual {
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
