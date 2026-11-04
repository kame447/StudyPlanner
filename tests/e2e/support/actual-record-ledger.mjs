// The independent oracle of the examinee weekly-record gate (#973). Every expected value below comes from the fixed
// scenario in ARGON-FIRST.md (example week 2026-10-26 Mon .. 2026-11-01 Sun, today 2026-11-03 Tue; the live gate derives the week from the real clock), written here by hand and
// never read from the product or from a model output. The display formats are re-implemented on purpose (not imported from
// weeklyPlanningActualRecords.ts): a wrong format in the product must fail this gate, not be copied by it.
// Checks return their violations (an empty list means the claim holds), like schedule-event-ledger.mjs.

/** Today in Japan (the browser runs in Asia/Tokyo) as an ISO date. The gate runs on the real clock: the durable Worker rejects a turn that does not start about now. */
export const todayInJapan = (now = Date.now()) => new Date(now + 9 * 60 * 60_000).toISOString().slice(0, 10);

const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * "Last week" of a run: the Monday..Sunday before the week that contains `todayIso` (weeks start on Monday). The scenario is the
 * one of ARGON-FIRST (月数学60 火英語45 水現代文30 木休み 金英語50 土数学120 日化学90 = 395) with the dates the real clock gives.
 * One record per studied day; Thursday is a rest day and has none.
 */
export function examWeekOf(todayIso) {
  const dayOfWeek = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
  const lastMonday = addDays(todayIso, -((dayOfWeek + 6) % 7) - 7);
  const day = (offset) => addDays(lastMonday, offset);
  return {
    week: [
      { date: day(0), subject: '数学', minutes: 60 },
      { date: day(1), subject: '英語', minutes: 45 },
      { date: day(2), subject: '現代文', minutes: 30 },
      { date: day(4), subject: '英語', minutes: 50 },
      { date: day(5), subject: '数学', minutes: 120 },
      { date: day(6), subject: '化学', minutes: 90 },
    ],
    restDay: day(3),
    correctedTuesday: { date: day(1), subject: '英語', minutes: 50 },
    total: 395,
    correctedTotal: 400,
  };
}

/** The example week of the scenario (today Tuesday 2026-11-03 → 10/26..11/01), for the oracle's own controls. */
export const { week: WEEK, restDay: REST_DAY, correctedTuesday: CORRECTED_TUESDAY, total: WEEK_TOTAL, correctedTotal: CORRECTED_TOTAL } = examWeekOf('2026-11-03');

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

/** 「10/29（木）」 */
export function dayText(date) {
  const [year, month, day] = date.split('-').map(Number);
  return `${month}/${day}（${WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}）`;
}

/** Reply to a rest day stated alone (fix-04): one flat sentence, then the total and the save guidance when records are waiting. No advice, no suggestion, no question. */
export function restDayReply(restDate, waiting) {
  return `${dayText(restDate)}はお休みですね。${waiting.length
    ? `ここまでの合計は${totalText(sumMinutes(waiting))}です。ほかの日があれば続けて教えてください。そろったら、確認画面の「この内容で実績を保存」を押すと保存されます。` : ''}`;
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

/**
 * The ids of a conversation's study records are owner x date x subject (fix-02): the same day and subject is the same document in
 * every chat, so scenarios cannot be told apart by "new ids". A scenario starts by clearing the account's study records.
 */
export const studyRecordIdPrefix = (userId) => `wp-actual-${userId}-`;

/** This account's study-record documents (ids made from a conversation's records), nothing else the account may hold. */
export const studyRecordsOf = (documents, userId) =>
  actualRecords(documents).filter((record) => record.userId === userId && record.id?.startsWith(studyRecordIdPrefix(userId)));

/** Reply when everything stated is already saved (the owner's wording, fix-03): that sentence alone, no total, no save guidance. */
export const savedReply = (records) => `その内容はすでに保存されています：${records.map(rowText).join('、')}。`;

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
