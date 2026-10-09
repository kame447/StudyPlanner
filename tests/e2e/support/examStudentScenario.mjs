import fixture from './examStudentFixture.mjs';

// Synthetic exam-student persona (Issue #488). Scripted provider documents are a DECLARED
// LIMITATION: they exercise the application (validated Fact Graph -> scheduler -> preview ->
// approval -> saved plans -> views), never a model's understanding of the Japanese prompt.
export { fixture };
export const OWNER_ID = 'exam-student-owner';
export const FOREIGN_OWNER_ID = 'exam-student-foreign-owner';
export const CLOCK = '2026-10-09T18:00:00+09:00';
export const [BULK_PROMPT, CORRECTION_PROMPT, LESSON_PROMPT] = fixture.prompts;
export const OVERLOAD_PROMPT = '物理をさらに120問（1問6分）増やす。来週中に全部やりたい。';
export const AMBIGUOUS_PROMPT = '来週は受験勉強いっぱいやりたい。数学と英語を中心に、空いてるところにうまく入れて';

const PLAN_TYPE = {
  school_day: 'school-event', club: 'school-event', remedial_class: 'school-event', counseling: 'school-event',
  review_meeting: 'school-event', cram_school: 'cram-school', mock_exam: 'mock-exam', family: 'other',
};
const STAMP = '2026-10-01T00:00:00.000Z';

/** Typed product rows for the persona's existing events (legacy Plan rows, the product's own shape). */
export function seedPlans(userId = OWNER_ID) {
  return fixture.existingEvents.map(event => ({
    id: event.id, seriesId: event.id, userId, title: event.title, subject: '', date: event.date,
    startTime: event.startTime, endTime: event.endTime, repeat: 'none', repeatUntil: null, excludedDates: [],
    recurrenceRules: [], type: PLAN_TYPE[event.kind], memo: '', createdAt: STAMP, updatedAt: STAMP,
  }));
}
/**
 * The product has no distinct life/travel-buffer type. A hard buffer is therefore represented as an
 * ordinary busy Plan of type 'other' (a MonthEvent is NOT honored by the planner: see the RED spec).
 */
export function seedBufferPlans(userId = OWNER_ID) {
  return fixture.lifeBuffers.map((buffer, index) => ({
    id: `exam-buffer-${String(index + 1).padStart(2, '0')}`, seriesId: `exam-buffer-${String(index + 1).padStart(2, '0')}`, userId,
    title: buffer.reason, subject: '', date: buffer.date, startTime: buffer.startTime, endTime: buffer.endTime, repeat: 'none',
    repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '', createdAt: STAMP, updatedAt: STAMP,
  }));
}
/** The same buffers as MonthEvents (used only by the RED test that exposes their being ignored). */
export function seedBufferMonthEvents(userId = OWNER_ID) {
  return seedBufferPlans(userId).map(({ id, userId: owner, title, date, startTime, endTime }) => ({
    id, userId: owner, date, title, startTime, endTime, repeat: 'none', repeatUntil: null, excludedDates: [],
    url: '', memo: '', checklist: [], locationTags: [], createdAt: STAMP, updatedAt: STAMP,
  }));
}
export const SEED_IDS = new Set([...fixture.existingEvents.map(event => event.id), ...fixture.lifeBuffers.map((_, index) => `exam-buffer-${String(index + 1).padStart(2, '0')}`)]);

const SESSION_TEXT = '1回30〜60分';
const week = { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
function workload(id, amount, unitCode, unitLabel, sourceText) {
  return { localId: `${id}-amount`, quantityRole: 'target', amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, sourceText };
}
function effort(id, kind, minutes, unitCode, sourceText) {
  return { localId: `${id}-${kind}`, targetLocalId: id, kind, minutes, unitCode, precision: 'approximate', sourceText };
}
function deadline(id, date, sourceText) {
  return { localId: `${id}-deadline`, targetLocalId: id, kind: 'deadline', constraintLevel: 'hard', dateExpression: date,
    namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText };
}
function task({ id, title, kind, purpose = 'exam', workloads, efforts = [], deadlines, sourceText }) {
  return { localId: id, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
    study: { purpose, activityKind: kind, contextLabel: null, components: [] }, workloads, effortEstimates: efforts,
    temporalConstraints: deadlines, recurrence: [], durableContextSignals: [], sourceText };
}

// Declared representation choice: each reading passage / chapter / essay is one atomic unit, so its
// per-unit minutes is also the session length (the product splits multi-unit work only on such typed input).
const perUnitSession = (id, minutes, text) => [effort(id, 'session_duration', minutes, 'session', text)];

/** One authored semantic document for all 9 study items of the bulk request. */
export function bulkDocument({ mathProblems = 30 } = {}) {
  const sun = d => [deadline(d, '2026-10-18', 'それ以外は日曜まで')];
  const splittable = d => effort(d, 'session_duration', 60, 'session', SESSION_TEXT);
  const tasks = [
    task({ id: 'math-calculus', title: '数学・微積', kind: 'problem_solving', sourceText: '数学は微積の問題を30問（1問6分くらい）',
      workloads: [workload('math-calculus', mathProblems, 'problem', '問', '30問')],
      efforts: [effort('math-calculus', 'duration_per_unit', 6, 'problem', '1問6分くらい'), splittable('math-calculus')],
      deadlines: [deadline('math-calculus', '2026-10-16', '数学は金曜まで')] }),
    task({ id: 'english-reading', title: '英語・長文', kind: 'reading', sourceText: '英語は長文を4本（1本35分）',
      workloads: [workload('english-reading', 4, 'custom', '本', '4本')],
      efforts: [effort('english-reading', 'duration_per_unit', 35, 'custom', '1本35分'), ...perUnitSession('english-reading', 35, '1本35分')], deadlines: sun('english-reading') }),
    task({ id: 'english-vocab', title: '英単語', kind: 'memorization_retrieval', sourceText: '英単語を140個（25個で30分くらい）',
      workloads: [workload('english-vocab', 140, 'word', '個', '140個')],
      efforts: [effort('english-vocab', 'duration_per_unit', 1.2, 'word', '25個で30分くらい'), splittable('english-vocab')],
      deadlines: sun('english-vocab') }),
    task({ id: 'physics', title: '物理・力学', kind: 'problem_solving', sourceText: '物理の力学を20問（1問6分）',
      workloads: [workload('physics', 20, 'problem', '問', '20問')],
      efforts: [effort('physics', 'duration_per_unit', 6, 'problem', '1問6分'), splittable('physics')], deadlines: sun('physics') }),
    task({ id: 'chemistry', title: '化学・有機', kind: 'reading', sourceText: '化学の有機を2章（1章60分）',
      workloads: [workload('chemistry', 2, 'chapter', '章', '2章')],
      efforts: [effort('chemistry', 'duration_per_unit', 60, 'chapter', '1章60分'), ...perUnitSession('chemistry', 60, '1章60分')], deadlines: sun('chemistry') }),
    task({ id: 'japanese-reading', title: '現代文・記述', kind: 'writing', sourceText: '現代文の記述を3題（1題40分）',
      workloads: [workload('japanese-reading', 3, 'custom', '題', '3題')],
      efforts: [effort('japanese-reading', 'duration_per_unit', 40, 'custom', '1題40分'), ...perUnitSession('japanese-reading', 40, '1題40分')], deadlines: sun('japanese-reading') }),
    task({ id: 'japanese-classics', title: '古文・敬語', kind: 'reading', sourceText: '古文の敬語を60分',
      workloads: [workload('japanese-classics', 60, 'minute', '分', '60分')], deadlines: sun('japanese-classics') }),
    task({ id: 'japanese-history', title: '日本史・文化史', kind: 'memorization_retrieval', sourceText: '日本史の文化史を90分',
      workloads: [workload('japanese-history', 90, 'minute', '分', '90分')], efforts: [splittable('japanese-history')],
      deadlines: sun('japanese-history') }),
    task({ id: 'essay', title: '小論文', kind: 'writing', sourceText: '小論文を1本90分',
      workloads: [workload('essay', 1, 'custom', '本', '1本')],
      efforts: [effort('essay', 'duration_per_unit', 90, 'custom', '1本90分')], deadlines: sun('essay') }),
  ];
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: week, tasks, relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [],
    decisions: [], conversationActs: [] };
}

export const STRATEGY_DECLINE_PROMPT = '英単語は暗記向きの提案はいらないです。そのまま予定を作ってください';
export const ENGLISH_WEEKEND_PROMPT = '英語長文は土日にまとめたい。ほかの科目はそのままで。';
export const MATH_DOWN_PROMPT = '数学は20問に減らして。ほかの科目はそのままで。';
export const OVERLOAD_FOLLOWUP = '物理の追加はやっぱりやめて、ほかはそのままでお願い';

function emptyDocument(overrides = {}) {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [],
    decisions: [], conversationActs: [], ...overrides };
}
const summary = (payload, key) => payload.publicStateSummary?.[key] ?? [];
const taskByTitle = (payload, title) => {
  const found = summary(payload, 'tasks').find(item => item.title === title);
  if (!found) throw new Error(`task not in public state: ${title}`);
  return found;
};
const workloadOf = (payload, title) => {
  const task = taskByTitle(payload, title);
  const found = summary(payload, 'workloads').find(item => item.taskPublicId === task.publicId);
  if (!found) throw new Error(`workload not in public state: ${title}`);
  return found;
};
/** A follow-up task entry bound to an existing task (no replay of the accepted workloads). */
function followTask(payload, title, extra = {}) {
  const bound = taskByTitle(payload, title);
  return { localId: `follow-${bound.publicId}`, existingPublicId: bound.publicId, decompositionStatus: 'atomic', category: 'study', title,
    study: null, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
    sourceText: title, ...extra };
}

function strategyDeclineDocument(payload) {
  const proposal = summary(payload, 'learningStrategyProposals').find(item => item.status === 'pending');
  if (!proposal) throw new Error('no pending strategy proposal to decline');
  return emptyDocument({ decisions: [{ localId: 'decline', target: { kind: 'proposal', publicId: proposal.publicId,
    localId: null, mention: null }, decision: 'reject', sourceText: '提案はいらない' }] });
}
/** 水曜(10/14)に17:30-19:30の補講: a new hard unavailable window, nothing else. */
function lessonDocument() {
  return emptyDocument({ planningIntent: 'update_plan', availabilityDeclarations: [{ localId: 'extra-lesson', kind: 'unavailable',
    dateExpression: '2026-10-14', namedTimePeriod: null, startTime: '17:30', endTime: '19:30', recurrenceKind: null, days: [],
    constraintLevel: 'hard', capacityMinutes: null, sourceText: '水曜日に急な補講が17時30分から19時30分まで' }] });
}
function mathDownTask(payload) {
  return followTask(payload, '数学・微積', { workloads: [workload('math-new', 20, 'problem', '問', '20問に減らして')], sourceText: '数学は20問に減らして' });
}
const mathDownCorrection = payload => ({ localId: 'math-down', target: { kind: 'workload', publicId: workloadOf(payload, '数学・微積').publicId, localId: null,
  mention: null }, operation: 'replace', replacementLocalId: 'math-new-amount', sourceText: '数学は20問に減らして' });
/** 英語長文は土日: restrict English reading to the weekend dates (hard allowed dates). */
function englishWeekendTask(payload) {
  const localId = `follow-${taskByTitle(payload, '英語・長文').publicId}`;
  return followTask(payload, '英語・長文', { temporalConstraints: [{ localId: 'english-weekend', targetLocalId: localId, kind: 'allowed_date',
    constraintLevel: 'hard', dateExpression: '2026-10-17/2026-10-18', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact',
    sourceText: '英語長文は土日にまとめたい' }], sourceText: '英語長文は土日にまとめたい' });
}
const mathDownDocument = payload => emptyDocument({ planningIntent: 'update_plan', tasks: [mathDownTask(payload)], corrections: [mathDownCorrection(payload)] });
const englishWeekendDocument = payload => emptyDocument({ planningIntent: 'update_plan', tasks: [englishWeekendTask(payload)] });
/** The fixture's combined utterance: math 30 -> 20 and English reading to the weekend. */
const correctionDocument = payload => emptyDocument({ planningIntent: 'update_plan', tasks: [mathDownTask(payload), englishWeekendTask(payload)],
  corrections: [mathDownCorrection(payload)] });
/** +120問 of physics (1,808 min minimum in total): an ADDITIONAL workload on the existing task. */
function overloadDocument(payload) {
  return emptyDocument({ planningIntent: 'update_plan', tasks: [followTask(payload, '物理・力学', {
    workloads: [workload('physics-extra', 120, 'problem', '問', '120問増やす')], sourceText: '物理をさらに120問増やす' })] });
}
/** Overload resolution: the user withdraws the additional 120 problems; everything else stays. */
function overloadWithdrawDocument(payload) {
  const physics = taskByTitle(payload, '物理・力学');
  const added = summary(payload, 'workloads').find(item => item.taskPublicId === physics.publicId && item.amount === 120);
  if (!added) throw new Error('no additional physics workload to withdraw');
  return emptyDocument({ planningIntent: 'update_plan', tasks: [followTask(payload, '物理・力学')], corrections: [{ localId: 'withdraw-extra',
    target: { kind: 'workload', publicId: added.publicId, localId: null, mention: null }, operation: 'remove', replacementLocalId: null,
    sourceText: '物理の追加はやっぱりやめて' }] });
}

/** An under-specified request: the workloads are unknown, so the application must ask. */
function ambiguousDocument() {
  const entry = (id, title, sourceText) => ({ localId: id, existingPublicId: null, decompositionStatus: 'needs_breakdown', category: 'study', title,
    study: { purpose: 'exam', activityKind: 'mixed', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [],
    recurrence: [], durableContextSignals: [], sourceText });
  return emptyDocument({ planningIntent: 'create_plan', planningWindow: week, tasks: [entry('math', '数学', '数学'), entry('english', '英語', '英語')],
    uncertainties: ['math', 'english'].map(id => ({ localId: `unknown-${id}`, targetLocalId: id, field: 'work_breakdown',
      reason: 'task constituents are not yet identified for planning', sourceText: '数学と英語を中心に' })) });
}

/** Scripted semantic reply, keyed by the exact user utterance (an explicit test script, never interpretation). */
export function providerDocument(payload, options = {}) {
  const text = String(payload.userText);
  if (text === BULK_PROMPT) return bulkDocument(options);
  if (text === ENGLISH_WEEKEND_PROMPT) return englishWeekendDocument(payload);
  if (text === MATH_DOWN_PROMPT) return mathDownDocument(payload);
  if (text === STRATEGY_DECLINE_PROMPT) return strategyDeclineDocument(payload);
  if (text === LESSON_PROMPT) return lessonDocument();
  if (text === CORRECTION_PROMPT) return correctionDocument(payload);
  if (text === OVERLOAD_PROMPT) return overloadDocument(payload);
  if (text === OVERLOAD_FOLLOWUP) return overloadWithdrawDocument(payload);
  if (text === AMBIGUOUS_PROMPT) return ambiguousDocument();
  throw new Error(`Unscripted exam-student turn: ${text}`);
}
