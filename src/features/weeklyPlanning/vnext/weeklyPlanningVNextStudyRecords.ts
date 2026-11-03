// Study records (#973): what the user says they actually studied, kept apart from the plan facts.
// The model only reads meaning (a date, a subject, the minutes the user stated); code resolves
// identity, replacement, zero days, totals and wording. A record has no clock time and never becomes
// one (DESIGN_CONSTRAINT): only a date, a subject and a duration. Nothing here saves; saving is the
// confirmation UI's explicit action (DESIGN-DECISION 4).
import type { VNextTurnError } from './weeklyPlanningVNextTypes';
// The display format has one owner (fix-01 B); this file only phrases the conversation around it.
import { formatActualRecordRow, formatActualRecordsTotal, formatAlreadySavedActualRecordsReply, formatRestDaysReply, formatSavingActualRecordsReply, sumActualRecordMinutes } from '../application/weeklyPlanningActualRecords';

/** One stated record as the model reads it: absolute date, subject as the user said it, stated minutes. */
export interface VNextStudyRecordReading {
  dateExpression: string;
  subject: string;
  minutes: number;
}

/** The single thing still unclear, in the user's own words (`label`), or null when nothing is unclear. */
export const VNEXT_STUDY_RECORD_QUESTION_REASONS = ['missing_minutes', 'missing_date', 'missing_subject', 'split_needed'] as const;
export interface VNextStudyRecordQuestion {
  reason: (typeof VNEXT_STUDY_RECORD_QUESTION_REASONS)[number];
  label: string | null;
}

export type VNextActualRecordStatus = 'pending' | 'saved';

/** A kept record: unique per (date × subject); `status` says whether the confirmation UI already saved it. */
export interface VNextActualRecord {
  id: string;
  occurrenceDate: string;
  subject: string;
  minutes: number;
  status: VNextActualRecordStatus;
}

const MAX_RECORD_MINUTES = 1439;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const validDate = (value: string): boolean => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

/** Same subject written with different spacing, width or case is one subject. */
export const vnextSubjectKey = (subject: string): string =>
  subject.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/\//gu, '_');

/**
 * Deterministic from the signed-in owner, the day and the subject, never from the conversation: the same day and subject
 * is one record however many chats or reloads state it, so a resend or another chat can only rewrite the same document.
 * `/` cannot appear in a document id.
 */
export const vnextActualRecordId = (ownerId: string, occurrenceDate: string, subject: string): string =>
  `wp-actual-${ownerId.replace(/\//gu, '_')}-${occurrenceDate}-${vnextSubjectKey(subject)}`;

export type VNextStudyRecordResult =
  | { status: 'applied' | 'noop'; records: VNextActualRecord[];
      /** Stated this turn and equal to what is already saved (same id, same minutes): kept as 'saved', never offered again. */
      alreadySaved: VNextActualRecord[];
      /** Stated this turn and not saved as stated (new, or other minutes than the saved ones): awaiting confirmation. */
      changed: VNextActualRecord[];
      /** Days the user said were rest days (valid, unique, ascending). */
      restDays: string[] }
  | { status: 'rejected'; errors: VNextTurnError[] };

/**
 * The minutes of the owner's study records that are already saved, by id, read from the actuals the application has loaded
 * (the same list the turn already carries). Only duration-only actuals made from a conversation (`wp-actual-<owner>-…`) count;
 * a record outside the loaded range is simply unknown and is confirmed as before.
 */
export function savedStudyRecordMinutes(
  actuals: readonly { id: string; userId?: string; actualDurationMinutes?: number }[], ownerId: string,
  savingIds: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const prefix = `wp-actual-${ownerId.replace(/\//gu, '_')}-`;
  return new Map(actuals.filter(actual => !savingIds.has(actual.id) && actual.id.startsWith(prefix) && (actual.userId === undefined || actual.userId === ownerId)
    && Number.isInteger(actual.actualDurationMinutes) && (actual.actualDurationMinutes as number) > 0)
    .map(actual => [actual.id, actual.actualDurationMinutes as number]));
}

const sortRecords = (records: VNextActualRecord[]): VNextActualRecord[] =>
  [...records].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.id.localeCompare(b.id));

/**
 * Applies this turn's readings to the kept records. A date × subject appears once: a later statement replaces
 * the earlier one (a correction is a replacement, never an addition) and returns it to 'pending'; restating the
 * same minutes changes nothing; 0 minutes removes the record (a rest day makes none). A date after
 * `acceptedDate` is not something already done and rejects the whole turn, as does any invalid value.
 */
export function applyVNextStudyRecords(params: {
  records: readonly VNextActualRecord[];
  readings: readonly VNextStudyRecordReading[];
  acceptedDate: string;
  /** The signed-in owner, from the caller; never read from the model. */
  ownerId: string;
  /** Minutes already saved, by record id (see savedStudyRecordMinutes); absent means none known. */
  saved?: ReadonlyMap<string, number>;
  /** Absolute dates the user says they did not study. A rest day makes no record and takes the day's unsaved records off the list (saved ones stay). */
  restDays?: readonly string[];
}): VNextStudyRecordResult {
  const errors: VNextTurnError[] = [];
  const invalid = (index: number, field: string) =>
    errors.push({ code: 'invalid_value', path: `studyRecords[${index}].${field}`, localId: null, factId: null });
  const next = new Map(params.records.map(record => [record.id, record]));
  const stated = new Set<string>();
  params.readings.forEach((reading, index) => {
    const subject = reading.subject.trim();
    if (!validDate(reading.dateExpression) || reading.dateExpression > params.acceptedDate) invalid(index, 'dateExpression');
    if (!subject || !vnextSubjectKey(subject)) invalid(index, 'subject');
    if (!Number.isInteger(reading.minutes) || reading.minutes < 0 || reading.minutes > MAX_RECORD_MINUTES) invalid(index, 'minutes');
    if (errors.length) return;
    const id = vnextActualRecordId(params.ownerId, reading.dateExpression, subject);
    if (reading.minutes === 0) { next.delete(id); stated.delete(id); return; }
    stated.add(id);
    // The saved document, when the application knows it, decides: same minutes is saved already, other minutes a replacement
    // still to confirm. Without it (outside the loaded range) the record keeps the status this conversation gave it.
    const existing = next.get(id);
    const known = params.saved?.get(id);
    const status = known === undefined ? (existing?.minutes === reading.minutes ? existing.status : 'pending')
      : known === reading.minutes ? 'saved' as const : 'pending' as const;
    if (existing && existing.minutes === reading.minutes && existing.status === status) return;
    next.set(id, { id, occurrenceDate: reading.dateExpression, subject, minutes: reading.minutes, status });
  });
  const rest = [...new Set(params.restDays ?? [])].sort();
  rest.forEach((day, index) => {
    if (!validDate(day) || day > params.acceptedDate) errors.push({ code: 'invalid_value', path: `studyRestDays[${index}]`, localId: null, factId: null });
  });
  if (errors.length) return { status: 'rejected', errors };
  // The user's own statement for the day wins: an unsaved record on a rest day is dropped, a saved one is never touched here.
  for (const [id, record] of next) if (rest.includes(record.occurrenceDate) && record.status !== 'saved') { next.delete(id); stated.delete(id); }
  const records = sortRecords([...next.values()]);
  const before = new Map(params.records.map(record => [record.id, record]));
  const statedRecords = records.filter(record => stated.has(record.id));
  return { status: JSON.stringify(records) === JSON.stringify(sortRecords([...params.records])) ? 'noop' : 'applied', records,
    alreadySaved: statedRecords.filter(record => record.status === 'saved'),
    changed: statedRecords.filter(record => record.status === 'pending' && before.get(record.id)?.minutes !== record.minutes), restDays: rest };
}

/** Marks exactly the named records saved; values, dates and subjects never change. */
export function markVNextActualRecordsSaved(records: readonly VNextActualRecord[], ids: readonly string[]): VNextActualRecord[] {
  const saved = new Set(ids);
  return records.map(record => (saved.has(record.id) ? { ...record, status: 'saved' as const } : record));
}

/** One short question for the one unclear thing, naming it in the user's own words. */
export function vnextStudyRecordQuestionText(question: VNextStudyRecordQuestion): string {
  const label = question.label?.trim() ? question.label.trim() : null;
  switch (question.reason) {
    case 'missing_minutes': return label ? `${label}は何分くらい勉強しましたか？` : '何分くらい勉強しましたか？';
    case 'missing_date': return label ? `${label}はいつの勉強ですか？` : 'いつの勉強ですか？';
    case 'missing_subject': return label ? `${label}は何の科目ですか？` : '何の科目ですか？';
    case 'split_needed': return label ? `${label}は、日ごとに何分ずつでしたか？` : '日ごとに何分ずつでしたか？';
  }
}

/**
 * Replies for a turn that only changed records. The records are an unsaved list for confirmation: nothing is
 * saved until the user presses the confirmation screen's save button, so no wording here may say "recorded".
 */
export const VNEXT_STUDY_RECORD_PENDING_PREFIX = '確認用に整理しました（まだ保存していません）：';
export const VNEXT_STUDY_RECORD_UNCHANGED = 'その内容はすでに確認リストにあります。';
export const VNEXT_STUDY_RECORD_REMOVED = 'その日を確認リストから外しました。';
export const VNEXT_STUDY_RECORD_SAVE_GUIDE = 'ほかの日があれば続けて教えてください。そろったら、確認画面の「この内容で実績を保存」を押すと保存されます。';

export function vnextStudyRecordReply(params: {
  /** Stated this turn and already saved as stated. */
  alreadySaved?: readonly VNextActualRecord[];
  /** Stated again while the matching batch has not resolved. */
  saving?: readonly VNextActualRecord[];
  changed: readonly VNextActualRecord[];
  removedCount: number;
  all: readonly VNextActualRecord[];
  question: VNextStudyRecordQuestion | null;
  /** Rest days stated this turn. Said (plainly) only when the turn states nothing else; otherwise they only take effect. */
  restDays?: readonly string[];
}): string {
  const saved = params.alreadySaved ?? [];
  const saving = params.saving ?? [];
  const lines: string[] = [];
  const restOnly = (params.restDays?.length ?? 0) > 0 && !saved.length && !params.changed.length && !params.question;
  if (restOnly) lines.push(formatRestDaysReply(params.restDays!));
  if (saved.length) lines.push(formatAlreadySavedActualRecordsReply(saved));
  if (saving.length) lines.push(formatSavingActualRecordsReply(saving));
  if (params.changed.length) lines.push(`${VNEXT_STUDY_RECORD_PENDING_PREFIX}${params.changed.map(formatActualRecordRow).join('、')}。`);
  else if (restOnly) { /* said above */ }
  else if (params.removedCount) lines.push(VNEXT_STUDY_RECORD_REMOVED);
  else if (!params.question && !saved.length && !saving.length) lines.push(VNEXT_STUDY_RECORD_UNCHANGED);
  const waiting = params.all.filter(record => record.status !== 'saved');
  // Only saved records were stated: nothing is waiting, so no total and no "press save" guidance.
  if (waiting.length || params.changed.length) lines.push(`ここまでの合計は${formatActualRecordsTotal(sumActualRecordMinutes(params.all))}です。`);
  if (params.question) lines.push(vnextStudyRecordQuestionText(params.question));
  else if (waiting.some(record => !saving.some(item => item.id === record.id))) lines.push(VNEXT_STUDY_RECORD_SAVE_GUIDE);
  return lines.join('');
}
