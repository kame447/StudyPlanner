/**
 * Presentation helpers for the duration-only study records a weekly conversation proposes (#973).
 * The wording and arithmetic live here, in code: nothing is computed or phrased by the model, and no
 * clock time is ever produced for a record that has only a date, a subject and minutes.
 */

/** Agreed with the conversation layer (I2): one record per date and subject. */
export interface WeeklyPlanningActualRecord {
  id: string;
  /** YYYY-MM-DD */
  occurrenceDate: string;
  subject: string;
  /** A positive integer the user stated; rest days have no record. */
  minutes: number;
  /** Absent means pending. A saved record is never offered for confirmation again. */
  status?: 'pending' | 'saved';
}

export interface PendingWeeklyPlanningActualRecord extends Pick<WeeklyPlanningActualRecord, 'id' | 'occurrenceDate' | 'subject' | 'minutes'> {
  /** Minutes already saved under this record's id with a different value: saving replaces them, and the user is told. */
  replacesMinutes?: number;
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function isSavableActualRecord(record: PendingWeeklyPlanningActualRecord): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(record.occurrenceDate) && record.subject.trim().length > 0
    && Number.isInteger(record.minutes) && record.minutes >= 1 && record.minutes <= 1439;
}

/** Records still waiting for the user's explicit confirmation, in date then subject order. */
export function selectPendingActualRecords(records: readonly WeeklyPlanningActualRecord[] | undefined): PendingWeeklyPlanningActualRecord[] {
  return (records ?? [])
    .filter(record => record.status !== 'saved' && isSavableActualRecord(record))
    .map(({ id, occurrenceDate, subject, minutes }) => ({ id, occurrenceDate, subject, minutes }))
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.subject.localeCompare(b.subject, 'ja'));
}

/**
 * Sets the pending records against what is already saved (by document id). Same minutes: already saved, nothing to
 * confirm. Different minutes: kept, marked as a replacement so the confirmation says so instead of overwriting silently.
 */
export function resolvePendingActualRecordsAgainstSaved(
  pending: readonly PendingWeeklyPlanningActualRecord[],
  savedMinutesById: ReadonlyMap<string, number>,
): PendingWeeklyPlanningActualRecord[] {
  return pending.flatMap(record => {
    const saved = savedMinutesById.get(record.id);
    if (saved === undefined) return [{ id: record.id, occurrenceDate: record.occurrenceDate, subject: record.subject, minutes: record.minutes }];
    if (saved === record.minutes) return [];
    return [{ id: record.id, occurrenceDate: record.occurrenceDate, subject: record.subject, minutes: record.minutes, replacesMinutes: saved }];
  });
}

/** The fields the save port receives: never the display-only replacement note. */
export function toActualRecordsToSave(records: readonly PendingWeeklyPlanningActualRecord[]): PendingWeeklyPlanningActualRecord[] {
  return records.map(({ id, occurrenceDate, subject, minutes }) => ({ id, occurrenceDate, subject, minutes }));
}

function hoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/** 「60分（1時間）」。1時間未満は分だけ。 */
export function formatActualRecordMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes}分` : `${minutes}分（${hoursAndMinutes(minutes)}）`;
}

/** 「6時間35分（395分）」。1時間未満は分だけ。 */
export function formatActualRecordsTotal(minutes: number): string {
  return minutes < 60 ? `${minutes}分` : `${hoursAndMinutes(minutes)}（${minutes}分）`;
}

export function sumActualRecordMinutes(records: readonly PendingWeeklyPlanningActualRecord[]): number {
  return records.reduce((sum, record) => sum + record.minutes, 0);
}

/** 「月 10/26 数学 60分（1時間）」 */
export function formatActualRecordRow(record: PendingWeeklyPlanningActualRecord & { previousMinutes?: number }): string {
  const [year, month, day] = record.occurrenceDate.split('-').map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const minutes = record.previousMinutes === undefined ? formatActualRecordMinutes(record.minutes)
    : `${formatActualRecordMinutes(record.previousMinutes)}→${formatActualRecordMinutes(record.minutes)}`;
  const row = `${weekday} ${month}/${day} ${record.subject} ${minutes}`;
  return record.replacesMinutes === undefined ? row : `${row} ※保存済みの${record.replacesMinutes}分を置き換えます`;
}

/** What the chat says about a restated record that is already saved with the same minutes (never "not saved yet"). */
export const ALREADY_SAVED_ACTUAL_RECORDS_PREFIX = 'その内容はすでに保存されています：';
export const PROVISIONAL_ACTUAL_RECORDS_LABEL = '仮実績';
export const PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL = '仮実績の確認';
export const REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL = '仮実績を確認';
export const ACTUAL_RECORDS_REFLECTION_QUESTION = 'この内容を学習実績に反映してよいですか？';
export const SAVE_ACTUAL_RECORDS_BUTTON_LABEL = 'この内容で実績を保存';
export const RETRY_ACTUAL_RECORDS_BUTTON_LABEL = '実績の保存を再試行';
export const SAVING_ACTUAL_RECORDS_LABEL = '保存中（まだ確定していません）';

/** 「その内容はすでに保存されています：月 10/26 数学 60分（1時間）、…。」 */
export function formatAlreadySavedActualRecordsReply(records: readonly PendingWeeklyPlanningActualRecord[]): string {
  return `${ALREADY_SAVED_ACTUAL_RECORDS_PREFIX}${records.map(formatActualRecordRow).join('、')}。`;
}

/** 「10/29（木）」 */
export function formatActualRecordDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${month}/${day}（${WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}）`;
}

/** The chat takes a rest day plainly: no advice, no suggestion, no question (#973 fix-04). 「10/29（木）はお休みですね。」 */
export function formatRestDaysReply(dates: readonly string[]): string {
  return `${[...dates].sort().map(formatActualRecordDay).join('、')}はお休みですね。`;
}
