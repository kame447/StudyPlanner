// The independent oracle of the examinee weekly-record gate (#973). Every expected value below comes from the fixed
// scenario in ARGON-FIRST.md (week 2026-10-26 Mon .. 2026-11-01 Sun, today 2026-11-03 Tue), written here by hand and
// never read from the product or from a model output. The display formats are re-implemented on purpose (not imported from
// weeklyPlanningActualRecords.ts): a wrong format in the product must fail this gate, not be copied by it.
// Checks return their violations (an empty list means the claim holds), like schedule-event-ledger.mjs.

/** The browser clock of the gate: Tuesday 2026-11-03, so "last week" is 10/26..11/01. */
export const EXAM_NOW = new Date('2026-11-03T10:00:00+09:00');

/** One record per studied day; Thursday 10/29 is a rest day and has none. */
export const WEEK = [
  { date: '2026-10-26', subject: '数学', minutes: 60 },
  { date: '2026-10-27', subject: '英語', minutes: 45 },
  { date: '2026-10-28', subject: '現代文', minutes: 30 },
  { date: '2026-10-30', subject: '英語', minutes: 50 },
  { date: '2026-10-31', subject: '数学', minutes: 120 },
  { date: '2026-11-01', subject: '化学', minutes: 90 },
];
export const REST_DAY = '2026-10-29';
export const WEEK_TOTAL = 395;
export const CORRECTED_TUESDAY = { date: '2026-10-27', subject: '英語', minutes: 50 };
export const CORRECTED_TOTAL = 400;

/** Words that say "already saved". Before the user's click on the confirmation's save button no reply may contain one. */
export const SAVED_WORDS = ['記録しました', '保存しました', '保存済み'];

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const hoursAndMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
};

/** 「60分（1時間）」, below an hour just 「45分」. */
export const minutesText = (minutes) => (minutes < 60 ? `${minutes}分` : `${minutes}分（${hoursAndMinutes(minutes)}）`);
/** 「6時間35分（395分）」. */
export const totalText = (minutes) => (minutes < 60 ? `${minutes}分` : `${hoursAndMinutes(minutes)}（${minutes}分）`);
/** 「月 10/26 数学 60分（1時間）」 */
export function rowText({ date, subject, minutes }) {
  const [year, month, day] = date.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${month}/${day} ${subject} ${minutesText(minutes)}`;
}
export const sumMinutes = (records) => records.reduce((sum, record) => sum + record.minutes, 0);
export const byDate = (records) => [...records].sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject, 'ja'));

/** The fixed reply of a records-only turn (the product owns the wording; the scenario fixes what it must say). */
export function pendingReply(changed, all) {
  return `確認用に整理しました（まだ保存していません）：${changed.map(rowText).join('、')}。`
    + `ここまでの合計は${totalText(sumMinutes(all))}です。`
    + 'ほかの日があれば続けて教えてください。そろったら、確認画面の「この内容で実績を保存」を押すと保存されます。';
}

export const savedWordsIn = (reply) => SAVED_WORDS.filter((word) => reply.includes(word));
export const questionMarksIn = (reply) => (reply.match(/[？?]/gu) ?? []).length;

const text = (field) => field?.stringValue ?? null;
const whole = (field) => (field?.integerValue === undefined ? null : Number(field.integerValue));

/** Firestore REST documents of `actuals` as plain records, with the field names that exist on the stored document. */
export function actualRecords(documents) {
  return documents.map(({ name = '', fields = {} }) => ({
    id: name.split('/').pop(), userId: text(fields.userId), date: text(fields.occurrenceDate), subject: text(fields.subject),
    minutes: whole(fields.actualDurationMinutes), fieldNames: Object.keys(fields).sort(), planId: fields.planId?.nullValue === undefined ? text(fields.planId) : null,
  }));
}

/** This account's actuals that were not there before the scenario began. */
export const addedBy = (documents, userId, knownIds) =>
  actualRecords(documents).filter((record) => record.userId === userId && !knownIds.has(record.id));

const normal = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '');

/** The saved records are exactly the expected ones: one document per (date, subject), with those minutes. */
export function savedExactly(records, expected) {
  const problems = [];
  const keyOf = (record) => `${record.date} ${normal(record.subject)}`;
  const got = new Map();
  for (const record of records) got.set(keyOf(record), [...(got.get(keyOf(record)) ?? []), record]);
  for (const want of expected) {
    const found = got.get(keyOf(want)) ?? [];
    if (found.length !== 1) problems.push(`${want.date} ${want.subject}: expected exactly 1 document, found ${found.length}`);
    else if (found[0].minutes !== want.minutes) problems.push(`${want.date} ${want.subject}: expected ${want.minutes} minutes, found ${found[0].minutes}`);
  }
  const wanted = new Set(expected.map(keyOf));
  for (const record of records) if (!wanted.has(keyOf(record))) problems.push(`unexpected document ${record.date} ${record.subject} ${record.minutes}`);
  return problems;
}

/** A study record has a date, a subject and minutes only: no clock time, no plan link, no other length. */
export function noClockTimes(records) {
  return records.flatMap((record) => [
    ...(record.fieldNames.some((name) => /^actual(Start|End)Time$/u.test(name)) ? [`${record.id}: stored a clock time (${record.fieldNames.join(',')})`] : []),
    ...(record.planId === null ? [] : [`${record.id}: linked to plan ${record.planId}`]),
  ]);
}

export const nothingOn = (records, date) => {
  const found = records.filter((record) => record.date === date);
  return found.length ? [`${date}: ${found.length} document(s) saved for a rest day (${found.map((record) => `${record.subject} ${record.minutes}`).join(', ')})`] : [];
};

export const noneSaved = (records) =>
  (records.length ? [`${records.length} actual document(s) saved before the confirmation click (${records.map((record) => record.id).join(', ')})`] : []);
