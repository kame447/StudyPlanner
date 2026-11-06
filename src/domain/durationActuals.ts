import { isValidActualDurationMinutes } from '../lib/actualDuration';
import { isValidQuickEntryDate } from '../lib/quickEntryDrafts';
import type { DurationActual } from '../types/domain';

/** One day's length of study on one subject. `id` is deterministic (decided by the caller from the confirmation, date and subject),
 *  so saving the same confirmation again rewrites the same documents instead of adding more. */
export interface DurationActualInput {
  id: string;
  occurrenceDate: string;
  subject: string;
  /** Defaults to the subject. */
  title?: string;
  minutes: number;
}

export const MAX_DURATION_ACTUAL_BATCH = 100;

/**
 * Builds the records of one batch, or throws before anything is written: the whole batch is valid or none of it is saved.
 * The documents carry no clock times and no plan link; `userId` is the signed-in owner passed by the caller, never taken from input.
 */
export function buildDurationActuals(userId: string, records: readonly DurationActualInput[], now: string): DurationActual[] {
  if (!userId.trim()) throw new Error('ログイン状態を確認できませんでした。');
  if (records.length === 0) throw new Error('保存する記録がありません。');
  if (records.length > MAX_DURATION_ACTUAL_BATCH) throw new Error('一度に保存できる記録の数を超えています。');
  const ids = new Set<string>();
  return records.map((record) => {
    if (!record.id.trim() || /[/]/.test(record.id)) throw new Error('記録のIDが正しくありません。');
    if (ids.has(record.id)) throw new Error('同じIDの記録が重複しています。');
    ids.add(record.id);
    if (!isValidQuickEntryDate(record.occurrenceDate)) throw new Error('記録の日付が正しくありません。');
    if (!isValidActualDurationMinutes(record.minutes)) throw new Error('記録の時間は1〜1439分の整数にしてください。');
    if (!record.subject.trim()) throw new Error('記録の科目がありません。');
    return {
      id: record.id,
      userId,
      planId: null,
      occurrenceDate: record.occurrenceDate,
      actualDurationMinutes: record.minutes,
      title: record.title?.trim() || record.subject.trim(),
      subject: record.subject.trim(),
      isAlignedToPlan: false,
      note: '',
      updatedAt: now,
      materialId: null,
      materialName: '',
    };
  });
}
