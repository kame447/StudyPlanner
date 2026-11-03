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

export type PendingWeeklyPlanningActualRecord = Pick<WeeklyPlanningActualRecord, 'id' | 'occurrenceDate' | 'subject' | 'minutes'>;

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
export function formatActualRecordRow(record: PendingWeeklyPlanningActualRecord): string {
  const [year, month, day] = record.occurrenceDate.split('-').map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${month}/${day} ${record.subject} ${formatActualRecordMinutes(record.minutes)}`;
}
