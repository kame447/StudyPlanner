// Synthetic observation inputs and typed oracles. No actual user conversation data.
import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpretationClock } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextQuestionCode, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';

interface Expected {
  amounts?: number[];
  minutes?: (number | null)[];
  questions?: VNextQuestionCode[];
  roles?: { role: string; amount: number }[];
  taskCount?: number;
  unitLabel?: string;
  date?: string;
  category?: string;
  unchanged?: boolean;
  answerKind?: 'option' | 'estimate_minutes' | null;
  answerMinutes?: number;
  answerOptionIndex?: number;
  efforts?: { kind: string; minutes: number }[];
  temporal?: { kind: string; dateExpression: string; startTime: string | null; endTime: string | null };
}
export interface VNextProviderScenario {
  id: string;
  seed: VNextAddFact[];
  clock?: WeeklyPlanningVNextInterpretationClock;
  turns: { text: string; expected: Expected }[];
}
const task: VNextAddFact = { kind: 'task', localId: 'task', title: '数学プリント', category: 'study' };
const work = (localId: string, amount: number, quantityRole: 'scope_total' | 'completed' | 'remaining' | 'target' = 'remaining'): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null, amount, quantityRole,
  unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
const total = (minutes: number): VNextAddFact => ({ kind: 'effort_estimate', localId: 'effort', taskRef: { localId: 'task' },
  targetRef: { localId: 'remaining' }, effortKind: 'total_duration', minutes, unitCode: null, unitLabel: null, precision: 'exact' });
const rate: VNextAddFact = { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'task' },
  targetRef: { localId: 'task' }, effortKind: 'duration_per_unit', minutes: 5, unitCode: 'custom', unitLabel: '枚', precision: 'exact' };
const remainingSeed = [task, work('remaining', 7), total(45)];

export const VNEXT_PROVIDER_SCENARIOS: VNextProviderScenario[] = [
  { id: 'native-multiturn-rate', seed: [], turns: [
    { text: '数学プリントを残り7枚やりたいです。1枚あたり5分かかります。', expected: { amounts: [7], minutes: [35], questions: [], taskCount: 1 } },
    { text: '数学プリントの残りを8枚に訂正してください。', expected: { amounts: [8], minutes: [40], questions: [], taskCount: 1 } },
    { text: '1枚あたり5分ではなく6分に訂正してください。', expected: { amounts: [8], minutes: [48], questions: [], taskCount: 1 } },
  ] },
  { id: 'native-add-rate', seed: [], turns: [{ text: '数学プリントを残り7枚やりたいです。1枚あたり5分かかります。',
    expected: { amounts: [7], minutes: [35], questions: [], taskCount: 1, efforts: [{ kind: 'duration_per_unit', minutes: 5 }] } }] },
  { id: '882-c12-derived-r8', seed: [task, work('total', 20, 'scope_total'), work('completed', 10, 'completed'), rate],
    turns: [{ text: '数学プリントの完了数だけ12枚に訂正してください。', expected: { amounts: [8], minutes: [40], questions: [],
      roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }] } }] },
  { id: '882-iter4-explicit-r8', seed: [task, work('total', 20, 'scope_total'), work('completed', 12, 'completed'), work('remaining', 7), rate],
    turns: [{ text: '数学プリントの残りだけ8枚に訂正します。', expected: { amounts: [8], minutes: [40], questions: [] } }] },
  { id: 'explicit-r7-retained', seed: [task, work('total', 20, 'scope_total'), work('completed', 13, 'completed'), work('remaining', 7), rate],
    turns: [{ text: '完了数を12枚に直してください。残り7枚という発言はそのまま残してください。',
      expected: { questions: ['remaining_inconsistent'], roles: [{ role: 'remaining', amount: 7 }, { role: 'completed', amount: 12 }] } }] },
  ...['残り8枚に訂正します。その残り全体の所要時間も60分に訂正します。',
    '残り全体の所要時間を60分に訂正します。残りの枚数も8枚に訂正します。'].map((text, index): VNextProviderScenario => ({
      id: `compound-r8-e60-${index + 1}`, seed: remainingSeed, turns: [{ text, expected: { amounts: [8], minutes: [60], questions: [] } }],
    })),
  { id: 'rate-total-conflict', seed: [task, work('remaining', 8), rate], turns: [{ text: 'この残り8枚の全体には60分かかります。',
    expected: { questions: ['effort_inconsistent'] } }] },
  { id: 'independent-scope', seed: remainingSeed, turns: [{ text: '数学プリントとは別の作業で、英語の音読を45分やりたいです。',
    expected: { minutes: [45, 45], taskCount: 2, questions: [] } }] },
  { id: 'yesterday-completed', seed: [task, work('total', 20, 'scope_total'), rate], turns: [{ text: '数学プリントは昨日までに12枚終わっています。',
    expected: { amounts: [8], minutes: [40], questions: [], roles: [{ role: 'completed', amount: 12 }] } }] },
  { id: 'custom-unit-change', seed: [task, work('remaining', 7), rate], turns: [{ text: '残りの単位を枚からセットに訂正します。数は7のままです。',
    expected: { amounts: [7], questions: ['missing_effort_estimate'], unitLabel: 'セット' } }] },
  { id: 'custom-page-preservation', seed: [task, { ...work('remaining', 7), unitLabel: 'ページ' } as VNextAddFact,
    { ...rate, unitLabel: 'ページ' } as VNextAddFact], turns: [{ text: '数学プリントの残りを8ページに訂正してください。単位の設定は今のままです。',
    expected: { amounts: [8], minutes: [40], questions: [], unitLabel: 'ページ' } }] },
  { id: 'observed-pace', seed: [task, work('total', 20, 'scope_total')], turns: [{ text: '数学プリントは昨日までに12枚終えました。その12枚を終えるのに60分かかりました。',
    expected: { amounts: [8], minutes: [40], questions: [], roles: [{ role: 'completed', amount: 12 }], efforts: [{ kind: 'total_duration', minutes: 60 }] } }] },
  { id: 'native-45-minute', seed: [], turns: [{ text: '明日に向けて英語の音読を45分やりたいです。',
    expected: { minutes: [45], taskCount: 1, questions: [] } }] },
  { id: 'session-one-to-thirty', seed: [task, { ...work('remaining', 4), unitCode: 'session', unitLabel: '回' } as VNextAddFact, { kind: 'effort_estimate', localId: 'session',
    taskRef: { localId: 'task' }, targetRef: { localId: 'task' }, effortKind: 'session_duration', minutes: 1,
    unitCode: null, unitLabel: null, precision: 'exact' }], turns: [{ text: '数学プリントの1回の時間を1分から30分に訂正してください。',
    expected: { amounts: [4], minutes: [120], roles: [{ role: 'remaining', amount: 4 }], questions: [], efforts: [{ kind: 'session_duration', minutes: 30 }] } }] },
  { id: 'explicit-date', seed: remainingSeed, turns: [{ text: '数学プリントの締め切りは2026年11月3日です。',
    expected: { date: '2026-11-03', minutes: [45], questions: [] } }] },
  { id: 'deadline-tomorrow-1300', seed: remainingSeed,
    clock: { currentDate: '2026-08-26', planningStartDate: '2026-08-24', planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' },
    turns: [{ text: '締切は明日の13時です。', expected: { minutes: [45], questions: [],
      temporal: { kind: 'deadline', dateExpression: 'tomorrow', startTime: null, endTime: '13:00' } } }] },
  { id: 'note-and-new-task', seed: remainingSeed, turns: [{ text: 'メモですが、ペンの補充は済んでいるので予定に入れないでください。別件で英語の音読を30分やりたいです。',
    expected: { minutes: [30, 45], taskCount: 2, questions: [] } }] },
  { id: 'wait', seed: remainingSeed, turns: [{ text: '待って。いったん何も変更しないで。', expected: { unchanged: true, answerKind: null } }] },
  { id: 'yes-no-without-question', seed: remainingSeed, turns: [
    { text: 'はい。', expected: { unchanged: true, answerKind: null } },
    { text: 'いいえ。', expected: { unchanged: true, answerKind: null } },
  ] },
  { id: 'category-title-correction', seed: remainingSeed, turns: [{ text: '数学プリントという予定は実は勉強ではなく、書類のコピーです。タイトルを「書類のコピー」に変え、学習以外の分類に訂正してください。作業量と見積もりはそのままです。',
    expected: { category: 'non_study', taskCount: 1, minutes: [45], questions: [] } }] },
  { id: 'estimate-answer', seed: [task, work('remaining', 8)], turns: [{ text: '残り全体で60分です。',
    expected: { unchanged: true, answerKind: 'estimate_minutes', answerMinutes: 60 } }] },
  { id: 'option-answer', seed: [task, work('total', 20, 'scope_total'), work('completed', 12, 'completed'), work('remaining', 7)],
    turns: [{ text: '1つ目の選択肢でお願いします。', expected: { unchanged: true, answerKind: 'option', answerOptionIndex: 0 } }] },
];

/** Typed-state oracle: no free-text matching, renderer wording or model self-report. */
export function checkVNextProviderScenario(expected: Expected, before: WeeklyPlanningVNextState,
  after: WeeklyPlanningVNextState, result: WeeklyPlanningVNextInterpretation): string[] {
  const failures: string[] = [];
  const check = (label: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) failures.push(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  };
  const projection = projectWeeklyPlanningVNext(after);
  const active = new Set(after.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  const tasks = after.graph.tasks.filter(fact => active.has(fact.id));
  const workloads = after.graph.workloads.filter(fact => active.has(fact.id));
  const works = projection.owners.flatMap(owner => owner.work);
  const sort = (values: (number | null)[]) => [...values].sort((a, b) => (a ?? -1) - (b ?? -1));
  if (expected.amounts) check('amounts', sort(works.map(work => work.amount)), sort(expected.amounts));
  if (expected.minutes) check('minutes', sort(works.map(work => work.minutes)), sort(expected.minutes));
  if (expected.questions) check('questions', projection.questions.map(question => question.code).sort(), [...expected.questions].sort());
  if (expected.taskCount !== undefined) check('tasks', tasks.length, expected.taskCount);
  if (expected.roles) for (const role of expected.roles) {
    if (!workloads.some(workload => workload.quantityRole === role.role && workload.amount === role.amount)) failures.push(`missing stated role ${JSON.stringify(role)}`);
  }
  if (expected.unitLabel) check('unitLabel', workloads[0]?.unitLabel, expected.unitLabel);
  if (expected.category) check('category', tasks[0]?.category, expected.category);
  if (expected.date && !after.graph.temporalConstraints.some(fact => active.has(fact.id) && fact.dateExpression === expected.date)) failures.push('missing explicit date');
  if (expected.unchanged) check('unchanged', after, before);
  if (expected.answerKind !== undefined) check('answer', result.status === 'interpreted' ? result.answer?.kind ?? null : 'failed', expected.answerKind);
  if (expected.answerMinutes !== undefined) check('answer minutes', result.status === 'interpreted' && result.answer?.kind === 'estimate_minutes' ? result.answer.minutes : null, expected.answerMinutes);
  if (expected.answerOptionIndex !== undefined) check('answer option', result.status === 'interpreted' && result.answer?.kind === 'option' ? result.answer.optionId : null,
    projectWeeklyPlanningVNext(before).questions[0]?.options[expected.answerOptionIndex]?.optionId);
  if (expected.efforts) for (const effort of expected.efforts) {
    if (!after.graph.effortEstimates.some(fact => active.has(fact.id) && fact.kind === effort.kind && fact.minutes === effort.minutes)) failures.push(`missing effort ${JSON.stringify(effort)}`);
  }
  if (expected.temporal && !after.graph.temporalConstraints.some(fact => active.has(fact.id)
    && Object.entries(expected.temporal!).every(([key, value]) => fact[key as keyof typeof fact] === value))) failures.push(`missing temporal bound ${JSON.stringify(expected.temporal)}`);
  return failures;
}
