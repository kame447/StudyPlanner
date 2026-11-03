// Study records (#973): what the user says they actually studied, kept apart from the plan facts.
// The model only reads meaning (a date, a subject, the minutes the user stated); code resolves
// identity, replacement, zero days, totals and wording. A record has no clock time and never becomes
// one (DESIGN_CONSTRAINT): only a date, a subject and a duration. Nothing here saves; saving is the
// confirmation UI's explicit action (DESIGN-DECISION 4).
import type { VNextTurnError } from './weeklyPlanningVNextTypes';
// The display format has one owner (fix-01 B); this file only phrases the conversation around it.
import { formatActualRecordRow, formatActualRecordsTotal, sumActualRecordMinutes } from '../application/weeklyPlanningActualRecords';

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
  | { status: 'applied' | 'noop'; records: VNextActualRecord[] }
  | { status: 'rejected'; errors: VNextTurnError[] };

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
}): VNextStudyRecordResult {
  const errors: VNextTurnError[] = [];
  const invalid = (index: number, field: string) =>
    errors.push({ code: 'invalid_value', path: `studyRecords[${index}].${field}`, localId: null, factId: null });
  const next = new Map(params.records.map(record => [record.id, record]));
  params.readings.forEach((reading, index) => {
    const subject = reading.subject.trim();
    if (!validDate(reading.dateExpression) || reading.dateExpression > params.acceptedDate) invalid(index, 'dateExpression');
    if (!subject || !vnextSubjectKey(subject)) invalid(index, 'subject');
    if (!Number.isInteger(reading.minutes) || reading.minutes < 0 || reading.minutes > MAX_RECORD_MINUTES) invalid(index, 'minutes');
    if (errors.length) return;
    const id = vnextActualRecordId(params.ownerId, reading.dateExpression, subject);
    if (reading.minutes === 0) { next.delete(id); return; }
    const existing = next.get(id);
    if (existing && existing.minutes === reading.minutes) return;
    next.set(id, { id, occurrenceDate: reading.dateExpression, subject, minutes: reading.minutes, status: 'pending' });
  });
  if (errors.length) return { status: 'rejected', errors };
  const records = sortRecords([...next.values()]);
  return { status: JSON.stringify(records) === JSON.stringify(sortRecords([...params.records])) ? 'noop' : 'applied', records };
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
  changed: readonly VNextActualRecord[];
  removedCount: number;
  all: readonly VNextActualRecord[];
  question: VNextStudyRecordQuestion | null;
}): string {
  const lines: string[] = [];
  if (params.changed.length) lines.push(`${VNEXT_STUDY_RECORD_PENDING_PREFIX}${params.changed.map(formatActualRecordRow).join('、')}。`);
  else if (params.removedCount) lines.push(VNEXT_STUDY_RECORD_REMOVED);
  else if (!params.question) lines.push(VNEXT_STUDY_RECORD_UNCHANGED);
  if (params.all.length) lines.push(`ここまでの合計は${formatActualRecordsTotal(sumActualRecordMinutes(params.all))}です。`);
  if (params.question) lines.push(vnextStudyRecordQuestionText(params.question));
  else if (params.all.length) lines.push(VNEXT_STUDY_RECORD_SAVE_GUIDE);
  return lines.join('');
}
