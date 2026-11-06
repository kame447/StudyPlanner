// Scripted VNext readings for the examinee's study-record conversation (#973, ARGON-FIRST.md fixed scenarios S1/S2/N1-N4).
// Pure (no browser import), like vnext-scripted-readings.mjs, so the unit suite can run them through the real VNext session.
// The readings are written from the scenario, never from what the application produced: the days, subjects and minutes below
// are exactly what the student says, and nothing is filled in for what the student did not say.
//
// Provider shape (I2, GustyPasteur's confirmed message): `studyRecords: [{ dateExpression: 'YYYY-MM-DD', subject, minutes }]` is a
// root field beside planningIntent / conversationActs / delta / answer (never inside delta.add, never mixed with plan facts).
// A plan turn has `studyRecords: []`; a rest day is not a record: its date goes in the root `studyRestDays` (fix-04). A correction is another entry for the same (date, subject):
// the application replaces it. An ambiguous statement emits no record and `studyRecordQuestion: { reason, label }` (one per turn).
// Source: evidence/I2-provider-shape.md.
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (planningIntent, delta = {}, conversationActs = [], studyRecords = [], studyRecordQuestion = null, studyRestDays = []) => ({
  planningIntent, conversationActs, answer: null, delta: { ...EMPTY, ...delta }, studyRecords, studyRecordQuestion, studyRestDays });

export const WEEK_RECORDS = [
  { day: 0, subject: '数学', minutes: 60 },   // Mon
  { day: 1, subject: '英語', minutes: 45 },   // Tue
  { day: 2, subject: '現代文', minutes: 30 }, // Wed
  // day 3 (Thu): rest, no record, 0 minutes
  { day: 4, subject: '英語', minutes: 50 },   // Fri
  { day: 5, subject: '数学', minutes: 120 },  // Sat
  { day: 6, subject: '化学', minutes: 90 },   // Sun
];
// Turns whose reply is the application's fixed text (a recording turn, a question): no renderer call follows the reading
// (evidence/I2-provider-shape.md section 2). Every other kind goes on to the renderer like any plan turn.
export const RECORD_ONLY_KINDS = ['actual_thu_rest', 'actual_week', 'actual_mon', 'actual_tue_wed', 'actual_fri_sun', 'actual_tue_fix', 'actual_vague_math', 'actual_vague_weekend'];
export const WEEK_TOTAL_MINUTES = 395;
export const WEEK_TOTAL_AFTER_TUESDAY_FIX = 400;

const record = (date, { subject, minutes }) => ({ dateExpression: date, subject, minutes });

/**
 * @param kind
 *   actual_week          S1: the whole week in one utterance (6 records, no Thursday)
 *   actual_mon           S2 turn 1: Monday only
 *   actual_tue_wed       S2 turn 2: Tuesday and Wednesday
 *   actual_thu_rest      S2 turn 3 / N1: Thursday was a rest day (nothing to record)
 *   actual_fri_sun       S2 turn 4: Friday, Saturday and Sunday
 *   actual_tue_fix       S2 turn 5: Tuesday was 50 minutes, not 45 (same date and subject again)

 *   actual_vague_math    N4: 「数学ちょっと」 → no record, question missing_minutes (label 数学)
 *   actual_vague_weekend N4: 「土日で化学3時間」 → no record, question split_needed (label 土日の化学)
 * @param week the seven absolute dates of the recorded week, Monday first
 */
export function scriptedActualReading(kind, { week }) {
  const records = indexes => indexes.map(day => ({ day, ...WEEK_RECORDS.find(entry => entry.day === day) }));
  const on = days => reading('discuss', {}, [], records(days).map(entry => record(week[entry.day], entry)));
  switch (kind) {
    case 'actual_week': return on([0, 1, 2, 4, 5, 6]);
    case 'actual_mon': return on([0]);
    case 'actual_tue_wed': return on([1, 2]);
    // A rest day is a statement of its own (fix-04): its absolute date in studyRestDays, no record, no minutes.
    case 'actual_thu_rest': return reading('discuss', {}, [], [], null, [week[3]]);
    case 'actual_fri_sun': return on([4, 5, 6]);
    case 'actual_tue_fix': return reading('discuss', {}, [], [record(week[1], { subject: '英語', minutes: 50 })]);
    case 'actual_vague_math': return reading('discuss', {}, [], [], { reason: 'missing_minutes', label: '数学' });
    case 'actual_vague_weekend': return reading('discuss', {}, [], [], { reason: 'split_needed', label: '土日の化学' });
    default: throw new Error(`Unknown scripted actual turn kind: ${kind}`);
  }
}
