import { addDays } from '../lib/date';
import { getMonthEventOccurrenceStartDate, getMonthEventSpanDays, getPreviousMonthEventOccurrenceDate } from '../lib/monthEvents';
import { sanitizeMonthEventDraft, validateMonthEventDraft } from '../lib/monthEventEditor';
import { createMonthEventDraftFromEvent, createMonthEventFromDraft } from './planner';
import type { MonthEvent, MonthEventDraft } from '../types/domain';

export type MonthEventEditScope = 'single' | 'future';
export class MonthEventEditValidationError extends Error {}
export interface MonthEventEditRequest {
  source: MonthEvent;
  occurrenceDate: string;
  scope: MonthEventEditScope;
}

export function createMonthEventOccurrenceDraft(event: MonthEvent, date: string): MonthEventDraft {
  const start = getMonthEventOccurrenceStartDate(event, date) ?? event.date;
  return { ...createMonthEventDraftFromEvent(event), date: start, endDate: addDays(start, getMonthEventSpanDays(event)) };
}

/** The original occurrence is the split boundary, even if its edited date moves. */
export function buildRecurringMonthEventEdit(
  source: MonthEvent,
  draft: MonthEventDraft,
  occurrenceDate: string,
  scope: MonthEventEditScope,
): { monthEvents: MonthEvent[]; editedEvent: MonthEvent } {
  const start = getMonthEventOccurrenceStartDate(source, occurrenceDate);
  if (source.repeat === 'none' || !start || source.userId !== draft.userId) {
    throw new Error('予定が更新されました。現在の予定を開き直してください。');
  }
  if (scope === 'future' && draft.date < start) {
    throw new MonthEventEditValidationError('これ以降の予定は、選んだ回より前の日へ変更できません。この予定だけ変更するか、開始日を戻してください。');
  }
  if (scope === 'future' && draft.repeat !== 'none' && source.repeatUntil && draft.date > source.repeatUntil) {
    throw new MonthEventEditValidationError('開始日が繰り返しの終了日を過ぎています。この予定だけ変更するか、開始日を戻してください。');
  }
  const nextDraft = sanitizeMonthEventDraft(scope === 'single'
    ? { ...draft, repeat: 'none', repeatUntil: null, excludedDates: [] }
    : { ...draft, repeatUntil: source.repeatUntil, excludedDates: source.excludedDates.filter(date => date >= start) });
  const error = validateMonthEventDraft(nextDraft);
  if (error) throw new Error(error);
  const previous = getPreviousMonthEventOccurrenceDate(source, start);
  if (scope === 'future' && !previous) {
    const editedEvent = createMonthEventFromDraft(nextDraft, source);
    return { monthEvents: [editedEvent], editedEvent };
  }
  const originalDraft = createMonthEventDraftFromEvent(source);
  const retained = createMonthEventFromDraft(scope === 'single'
    ? { ...originalDraft, excludedDates: [...new Set([...source.excludedDates, start])].sort() }
    : { ...originalDraft, repeatUntil: previous, excludedDates: source.excludedDates.filter(date => date < start) }, source);
  const editedEvent = { ...createMonthEventFromDraft(nextDraft), ...(source.busy === undefined ? {} : { busy: source.busy }) };
  return { monthEvents: [retained, editedEvent], editedEvent };
}
