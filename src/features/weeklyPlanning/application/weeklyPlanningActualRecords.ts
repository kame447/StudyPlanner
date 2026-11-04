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
export const UNKNOWN_ACTUAL_SAVE_RESULT_REPLY = '保存結果を確認できていません。記録は保存済みと扱わず、確認待ちです。再読み込みで保存の状態を確認できます。';
export const ACTUAL_SAVE_RETRY_SAVED_REPLY = '勉強記録を保存しました。';
export const ACTUAL_SAVE_RETRY_FAILED_REPLY = '勉強記録の保存処理が失敗しました。保存結果を確認できていません。';
export const ACTUAL_SAVE_RETRY_BLOCKED_REPLY = '保存状態が変わったため再送していません。再読み込みして確認してください。';

export function formatActualSaveReadbackReply(
  attempted: readonly PendingWeeklyPlanningActualRecord[],
  confirmedIds: readonly string[],
  conflictingIds: readonly string[],
): string {
  const confirmed = attempted.filter(record => confirmedIds.includes(record.id));
  const conflicting = attempted.filter(record => conflictingIds.includes(record.id));
  const missing = attempted.filter(record => !confirmedIds.includes(record.id) && !conflictingIds.includes(record.id));
  if (confirmed.length === attempted.length) return `保存を確認しました：${confirmed.map(formatActualRecordRow).join('、')}。`;
  if (confirmed.length === 0 && conflicting.length === 0 && missing.length === attempted.length) {
    return `サーバー上に保存されていません。記録は未保存のままです。保存する場合は確認画面の「${SAVE_ACTUAL_RECORDS_BUTTON_LABEL}」（エラー表示中は「${RETRY_ACTUAL_RECORDS_BUTTON_LABEL}」）を押してください。`;
  }
  return [confirmed.length ? `保存を確認した記録：${confirmed.map(formatActualRecordRow).join('、')}。` : '',
    missing.length ? `未保存の記録：${missing.map(formatActualRecordRow).join('、')}。` : '',
    conflicting.length ? `保存済みの値が異なる記録：${conflicting.map(formatActualRecordRow).join('、')}。自動では上書きしません。` : '']
    .filter(Boolean).join('');
}

export function formatUnknownActualSaveReadbackReply(reason: string): string {
  const cause = reason === 'auth_mismatch' ? '認証された利用者が一致しないため、'
    : reason === 'permission_denied' ? '読取権限がないため、'
      : reason === 'unavailable' ? 'サーバーに接続できないため、' : '';
  return `${cause}${UNKNOWN_ACTUAL_SAVE_RESULT_REPLY}`;
}

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
