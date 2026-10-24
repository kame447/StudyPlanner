import { getRecurrenceWeekday } from '../lib/planRecurrence';
import { buildTimetableImportCandidates, createPlanDraftFromTimetableImportCandidate } from '../lib/timetableImport';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import type { PlanDraft, ScheduleTemplate, TimetableTerm } from '../types/domain';
import { resolveActiveTimetableTerm } from './timetableTerm';

// A requested import batch may outlive its dialog and its candidate snapshot.
// Resolve every undispatched item against the current owner/date before saving.
export function requireCurrentTimetableImportTemplates(
  ownerId: string,
  draft: PlanDraft,
  templates: readonly ScheduleTemplate[],
  terms: readonly TimetableTerm[],
): ScheduleTemplate[] {
  const ownedTerms = terms.filter(row => row.userId === ownerId);
  const preferred = resolveActiveTimetableTerm(ownedTerms);
  const term = resolveTimetableTermForDate(draft.date, ownedTerms, preferred.termId);
  const candidate = (term || ownedTerms.length === 0) && buildTimetableImportCandidates({
    templates: templates.filter(row => row.userId === ownerId), date: draft.date,
    weekday: getRecurrenceWeekday(draft.date), termId: term?.id ?? preferred.termId, term,
  }).find(row => row.sourceId === draft.sourceId);
  const expected = candidate && createPlanDraftFromTimetableImportCandidate(candidate, ownerId, draft.date);
  if (draft.userId !== ownerId || !candidate || !expected
    || (['title', 'subject', 'type', 'startTime', 'endTime', 'memo'] as const).some(key => draft[key] !== expected[key])) {
    throw new Error('時間割が更新されました。現在の予定を開き直してください。');
  }
  return candidate.templates;
}
