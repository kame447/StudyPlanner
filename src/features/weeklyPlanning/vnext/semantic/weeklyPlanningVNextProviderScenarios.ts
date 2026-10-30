// Synthetic observation inputs and typed oracles. No actual user conversation data.
import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpretationClock } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextQuestionCode, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { computeVNextWorkUnits, createVNextLineageResolver, vnextQuantityBasisKey, vnextUnitIdentity } from '../weeklyPlanningVNextWorkIdentity';

type ExpectedEffort =
  | { kind: 'total_duration'; minutes: number; about: 'future_work' | 'observed_pace'; boundAmount: number }
  | { kind: 'duration_per_unit' | 'session_duration'; minutes: number; about: 'work' | 'owner' };

interface Expected {
  amounts?: number[];
  minutes?: (number | null)[];
  questions?: VNextQuestionCode[];
  /** Complete active workload role/amount multiset, including facts that are not schedulable. */
  roles: { role: string; amount: number }[];
  taskCount?: number;
  workloadLabels?: { role: string; label: string; changesUnit?: boolean }[];
  category?: string;
  title?: string;
  unchanged?: boolean;
  answerKind?: 'option' | 'estimate_minutes' | null;
  answerMinutes?: number;
  answerPer?: 'whole_work' | 'unit';
  /** Complete effort set when estimates are stated/changed; otherwise all before-efforts must be preserved. */
  efforts?: ExpectedEffort[];
  temporal?: { kind: string; constraintLevel: string; dateExpression: string; startTime: string | null; endTime: string | null };
  questionWork?: { amount: number; unitLabel: string };
  ownerWork?: { owner: 'existing' | 'new'; amount: number; minutes: number; dimension: 'time' | 'quantity' }[];
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
    { text: '数学プリントを残り7枚やりたいです。1枚あたり5分かかります。', expected: { roles: [{ role: 'remaining', amount: 7 }], amounts: [7], minutes: [35], questions: [], taskCount: 1, efforts: [{ kind: 'duration_per_unit', minutes: 5, about: 'work' }] } },
    { text: '数学プリントの残りを8枚に訂正してください。', expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [40], questions: [], taskCount: 1 } },
    { text: '1枚あたり5分ではなく6分に訂正してください。', expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [48], questions: [], taskCount: 1, efforts: [{ kind: 'duration_per_unit', minutes: 6, about: 'work' }] } },
  ] },
  { id: 'native-add-rate', seed: [], turns: [{ text: '数学プリントを残り7枚やりたいです。1枚あたり5分かかります。',
    expected: { roles: [{ role: 'remaining', amount: 7 }], amounts: [7], minutes: [35], questions: [], taskCount: 1, efforts: [{ kind: 'duration_per_unit', minutes: 5, about: 'work' }] } }] },
  { id: '882-c12-derived-r8', seed: [task, work('total', 20, 'scope_total'), work('completed', 10, 'completed'), rate],
    turns: [{ text: '数学プリントの完了数だけ12枚に訂正してください。', expected: { amounts: [8], minutes: [40], questions: [],
      roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }] } }] },
  { id: '882-iter4-explicit-r8', seed: [task, work('total', 20, 'scope_total'), work('completed', 12, 'completed'), work('remaining', 7), rate],
    turns: [{ text: '数学プリントの残りだけ8枚に訂正します。', expected: { roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }, { role: 'remaining', amount: 8 }], amounts: [8], minutes: [40], questions: [] } }] },
  { id: 'explicit-r7-retained', seed: [task, work('total', 20, 'scope_total'), work('completed', 13, 'completed'), work('remaining', 7), rate],
    turns: [{ text: '完了数を12枚に直してください。残り7枚という発言はそのまま残してください。',
      expected: { questions: ['remaining_inconsistent'], roles: [{ role: 'scope_total', amount: 20 }, { role: 'remaining', amount: 7 }, { role: 'completed', amount: 12 }] } }] },
  ...['残り8枚に訂正します。その残り全体の所要時間も60分に訂正します。',
    '残り全体の所要時間を60分に訂正します。残りの枚数も8枚に訂正します。'].map((text, index): VNextProviderScenario => ({
      id: `compound-r8-e60-${index + 1}`, seed: remainingSeed, turns: [{ text, expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [60], questions: [], efforts: [{ kind: 'total_duration', minutes: 60, about: 'future_work', boundAmount: 8 }] } }],
    })),
  { id: 'rate-total-conflict', seed: [task, work('remaining', 8), rate], turns: [{ text: 'この残り8枚の全体には60分かかります。',
    expected: { roles: [{ role: 'remaining', amount: 8 }], questions: ['effort_inconsistent'], efforts: [{ kind: 'duration_per_unit', minutes: 5, about: 'owner' }, { kind: 'total_duration', minutes: 60, about: 'future_work', boundAmount: 8 }] } }] },
  { id: 'independent-scope', seed: remainingSeed, turns: [{ text: '数学プリントとは別の作業で、英語の音読を45分やりたいです。',
    expected: { roles: [{ role: 'remaining', amount: 7 }, { role: 'target', amount: 45 }], minutes: [45, 45], taskCount: 2, questions: [],
      ownerWork: [{ owner: 'existing', amount: 7, minutes: 45, dimension: 'quantity' }, { owner: 'new', amount: 45, minutes: 45, dimension: 'time' }] } }] },
  { id: 'yesterday-completed', seed: [task, work('total', 20, 'scope_total'), rate], turns: [{ text: '数学プリントは昨日までに12枚終わっています。',
    expected: { amounts: [8], minutes: [40], questions: [], roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }] } }] },
  { id: 'custom-unit-change', seed: [task, work('remaining', 7), rate], turns: [{ text: '残りの単位を枚からセットに訂正します。数は7のままです。',
    expected: { roles: [{ role: 'remaining', amount: 7 }], workloadLabels: [{ role: 'remaining', label: 'セット', changesUnit: true }], questions: ['missing_effort_estimate'], questionWork: { amount: 7, unitLabel: 'セット' } } }] },
  { id: 'custom-page-preservation', seed: [task, { ...work('remaining', 7), unitLabel: 'ページ' } as VNextAddFact,
    { ...rate, unitLabel: 'ページ' } as VNextAddFact], turns: [{ text: '数学プリントの残りを8ページに訂正してください。単位の設定は今のままです。',
    expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [40], questions: [], workloadLabels: [{ role: 'remaining', label: 'ページ' }] } }] },
  { id: 'observed-pace', seed: [task, work('total', 20, 'scope_total')], turns: [{ text: '数学プリントは昨日までに12枚終えました。その12枚を終えるのに60分かかりました。',
    expected: { amounts: [8], minutes: [40], questions: [], roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }], efforts: [{ kind: 'total_duration', minutes: 60, about: 'observed_pace', boundAmount: 12 }], answerKind: null } }] },
  { id: 'native-45-minute', seed: [], turns: [{ text: '明日に向けて英語の音読を45分やりたいです。',
    expected: { roles: [{ role: 'target', amount: 45 }], minutes: [45], taskCount: 1, questions: [] } }] },
  { id: 'session-one-to-thirty', seed: [task, { ...work('remaining', 4), unitCode: 'session', unitLabel: '回' } as VNextAddFact, { kind: 'effort_estimate', localId: 'session',
    taskRef: { localId: 'task' }, targetRef: { localId: 'task' }, effortKind: 'session_duration', minutes: 1,
    unitCode: null, unitLabel: null, precision: 'exact' }], turns: [{ text: '数学プリントの1回の時間を1分から30分に訂正してください。',
    expected: { amounts: [4], minutes: [120], roles: [{ role: 'remaining', amount: 4 }], questions: [], efforts: [{ kind: 'session_duration', minutes: 30, about: 'work' }] } }] },
  { id: 'explicit-date', seed: remainingSeed, turns: [{ text: '数学プリントの締め切りは2026年11月3日です。',
    expected: { roles: [{ role: 'remaining', amount: 7 }], minutes: [45], questions: [],
      temporal: { kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-03', startTime: null, endTime: null } } }] },
  { id: 'deadline-tomorrow-1300', seed: remainingSeed,
    clock: { defaultPlanningHorizon: { startDate: '2026-08-24', endDate: '2026-08-30' }, weekStartsOn: 'monday', currentDate: '2026-08-26', planningStartDate: '2026-08-24', planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' },
    turns: [{ text: '締切は明日の13時です。', expected: { roles: [{ role: 'remaining', amount: 7 }], minutes: [45], questions: [],
      // Stored as the date of the accepting turn's clock (2026-08-26 + 1), never the symbolic word.
      temporal: { kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-08-27', startTime: null, endTime: '13:00' } } }] },
  { id: 'note-and-new-task', seed: remainingSeed, turns: [{ text: 'メモですが、ペンの補充は済んでいるので予定に入れないでください。別件で英語の音読を30分やりたいです。',
    expected: { roles: [{ role: 'remaining', amount: 7 }, { role: 'target', amount: 30 }], minutes: [30, 45], taskCount: 2, questions: [],
      ownerWork: [{ owner: 'existing', amount: 7, minutes: 45, dimension: 'quantity' }, { owner: 'new', amount: 30, minutes: 30, dimension: 'time' }] } }] },
  { id: 'wait', seed: remainingSeed, turns: [{ text: '待って。いったん何も変更しないで。', expected: { roles: [{ role: 'remaining', amount: 7 }], unchanged: true, answerKind: null } }] },
  { id: 'yes-no-without-question', seed: remainingSeed, turns: [
    { text: 'はい。', expected: { roles: [{ role: 'remaining', amount: 7 }], unchanged: true, answerKind: null } },
    { text: 'いいえ。', expected: { roles: [{ role: 'remaining', amount: 7 }], unchanged: true, answerKind: null } },
  ] },
  { id: 'category-title-correction', seed: remainingSeed, turns: [{ text: '数学プリントという予定は実は勉強ではなく、書類のコピーです。タイトルを「書類のコピー」に変え、学習以外の分類に訂正してください。作業量と見積もりはそのままです。',
    expected: { roles: [{ role: 'remaining', amount: 7 }], category: 'non_study', title: '書類のコピー', taskCount: 1, minutes: [45], questions: [] } }] },
  { id: 'estimate-answer', seed: [task, work('remaining', 8)], turns: [{ text: '残り全体で60分です。',
    expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [60], questions: [], answerKind: 'estimate_minutes', answerMinutes: 60, answerPer: 'whole_work', efforts: [{ kind: 'total_duration', minutes: 60, about: 'future_work', boundAmount: 8 }] } }] },
  { id: 'per-unit-estimate-answer', seed: [task, work('remaining', 8)], turns: [{ text: '1枚あたり8分です。',
    expected: { roles: [{ role: 'remaining', amount: 8 }], amounts: [8], minutes: [64], questions: [], answerKind: 'estimate_minutes', answerMinutes: 8, answerPer: 'unit', efforts: [{ kind: 'duration_per_unit', minutes: 8, about: 'work' }] } }] },
  { id: 'option-answer', seed: [task, work('total', 20, 'scope_total'), work('completed', 12, 'completed'), work('remaining', 7)],
    turns: [{ text: '1つ目の選択肢でお願いします。', expected: { questions: ['missing_effort_estimate'],
      roles: [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }, { role: 'remaining', amount: 8 }], questionWork: { amount: 8, unitLabel: '枚' }, answerKind: 'option' } }] },
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
  const beforeActive = new Set(before.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  const resolver = createVNextLineageResolver(after.graph);
  const oldResolver = createVNextLineageResolver(before.graph);
  const oldTasks = before.graph.tasks.filter(fact => beforeActive.has(fact.id));
  const oldWorkloads = before.graph.workloads.filter(fact => beforeActive.has(fact.id));
  const oldEfforts = before.graph.effortEstimates.filter(fact => beforeActive.has(fact.id));
  const tasks = after.graph.tasks.filter(fact => active.has(fact.id));
  const workloads = after.graph.workloads.filter(fact => active.has(fact.id));
  const efforts = after.graph.effortEstimates.filter(fact => active.has(fact.id));
  const works = projection.owners.flatMap(owner => owner.work);
  const sort = (values: (number | null)[]) => [...values].sort((a, b) => (a ?? -1) - (b ?? -1));
  const multiset = (values: unknown[]) => values.map(value => JSON.stringify(value)).sort();
  const quantity = (fact: { amount: number; unitCode: string }) => fact.unitCode === 'hour' ? fact.amount * 60 : fact.amount;
  if (expected.amounts) check('amounts', sort(works.map(work => work.amount)), sort(expected.amounts));
  if (expected.minutes) check('minutes', sort(works.map(work => work.minutes)), sort(expected.minutes));
  if (expected.questions) check('questions', projection.questions.map(question => question.code).sort(), [...expected.questions].sort());
  check('tasks', tasks.length, expected.taskCount ?? oldTasks.length);
  check('workload roles/cardinality', multiset(workloads.map(fact => ({ role: fact.quantityRole, amount: quantity(fact) }))), multiset(expected.roles));
  for (const prior of oldTasks) {
    const current = tasks.find(fact => resolver.lineageOf(fact.id) === oldResolver.lineageOf(prior.id));
    if (!current) { failures.push('missing preserved task lineage'); continue; }
    check('task category', current.category, expected.category ?? prior.category);
    check('task title', current.title, expected.title ?? prior.title);
  }
  for (const prior of oldWorkloads) {
    const current = workloads.find(fact => resolver.lineageOf(fact.id) === oldResolver.lineageOf(prior.id));
    if (!current) { failures.push('missing preserved workload lineage'); continue; }
    check('workload owner', [resolver.lineageOf(current.taskId), current.componentId && resolver.lineageOf(current.componentId)],
      [oldResolver.lineageOf(prior.taskId), prior.componentId && oldResolver.lineageOf(prior.componentId)]);
    const changesUnit = expected.workloadLabels?.some(rule => rule.role === prior.quantityRole && rule.changesUnit);
    for (const key of ['unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression'] as const) {
      if (changesUnit && (key === 'unitCode' || key === 'unitLabel')) continue;
      check(`preserved workload ${key}`, current[key], prior[key]);
    }
  }
  for (const label of expected.workloadLabels ?? []) {
    const targets = workloads.filter(fact => fact.quantityRole === label.role);
    if (!targets.length || targets.some(fact => fact.unitLabel !== label.label)) failures.push(`workload label ${JSON.stringify(label)}`);
  }
  if (expected.ownerWork) {
    check('owner-linked work cardinality', works.length, expected.ownerWork.length);
    const oldOwners = new Set(oldTasks.map(task => oldResolver.lineageOf(task.id)));
    const unmatched = [...works];
    for (const wanted of expected.ownerWork) {
      const index = unmatched.findIndex(work => (oldOwners.has(resolver.lineageOf(work.taskId)) ? 'existing' : 'new') === wanted.owner
        && quantity(work) === wanted.amount && work.minutes === wanted.minutes
        && (['minute', 'hour'].includes(work.unitCode) ? 'time' : 'quantity') === wanted.dimension);
      if (index < 0) failures.push(`missing owner-linked work ${JSON.stringify(wanted)}`);
      else unmatched.splice(index, 1);
    }
  }
  if (expected.unchanged) check('unchanged', after, before);
  if (expected.answerKind !== undefined) check('answer', result.status === 'interpreted' ? result.answer?.kind ?? null : 'failed', expected.answerKind);
  if (expected.answerMinutes !== undefined) check('answer minutes', result.status === 'interpreted' && result.answer?.kind === 'estimate_minutes' ? result.answer.minutes : null, expected.answerMinutes);
  if (expected.answerPer !== undefined) check('answer per', result.status === 'interpreted' && result.answer?.kind === 'estimate_minutes' ? result.answer.per : null, expected.answerPer);
  type Effort = (typeof efforts)[number];
  const effortView = (effort: Effort, lineage: typeof resolver) => ({ kind: effort.kind, minutes: effort.minutes,
    owner: lineage.lineageOf(effort.taskId), target: lineage.lineageOf(effort.targetFactId),
    unitCode: effort.unitCode, unitLabel: effort.unitLabel, precision: effort.precision,
    binding: effort.workBinding && { kind: effort.workBinding.kind, lineage: effort.workBinding.workLineageId,
      amount: effort.workBinding.boundAmount, basis: effort.workBinding.boundBasisKey } });
  if (!expected.efforts) {
    check('preserved effort facts/bindings', multiset(efforts.map(effort => effortView(effort, resolver))),
      multiset(oldEfforts.map(effort => effortView(effort, oldResolver))));
  } else {
    check('effort cardinality', efforts.length, expected.efforts.length);
    const units = computeVNextWorkUnits(after.graph).flatMap(owner => owner.units);
    const matches = (effort: Effort, wanted: ExpectedEffort) => {
      if (effort.kind !== wanted.kind || effort.minutes !== wanted.minutes) return false;
      const target = resolver.lineageOf(effort.targetFactId);
      if (wanted.kind === 'total_duration') {
        const binding = effort.workBinding;
        const measured = workloads.find(fact => resolver.lineageOf(fact.id) === binding?.workLineageId);
        if (!binding || !measured || binding.kind !== wanted.about || binding.boundAmount !== wanted.boundAmount
          || target !== binding.workLineageId || binding.boundBasisKey !== vnextQuantityBasisKey(measured)) return false;
        return wanted.about === 'observed_pace' ? measured.quantityRole === 'completed'
          : units.some(unit => unit.workLineageId === binding.workLineageId && unit.amount === wanted.boundAmount);
      }
      if (effort.workBinding !== null) return false;
      const ownerTarget = tasks.some(task => resolver.lineageOf(task.id) === target)
        || after.graph.components.some(component => active.has(component.id) && resolver.lineageOf(component.id) === target);
      if (wanted.about === 'owner' && !ownerTarget) return false;
      return units.some(unit => resolver.lineageOf(unit.workload.taskId) === resolver.lineageOf(effort.taskId)
        && (unit.workLineageId === target || ownerTarget)
        && (wanted.kind === 'session_duration' ? unit.workload.unitCode === 'session' : vnextUnitIdentity(effort) === vnextUnitIdentity(unit.workload)));
    };
    const unmatched = [...efforts];
    for (const wanted of expected.efforts) {
      const index = unmatched.findIndex(effort => matches(effort, wanted));
      if (index < 0) failures.push(`missing effort meaning/binding ${JSON.stringify(wanted)}`);
      else unmatched.splice(index, 1);
    }
  }
  if (expected.temporal && !after.graph.temporalConstraints.some(fact => active.has(fact.id)
    && Object.entries(expected.temporal!).every(([key, value]) => fact[key as keyof typeof fact] === value))) failures.push(`missing temporal bound ${JSON.stringify(expected.temporal)}`);
  if (expected.questionWork) {
    const matches = projection.questions.some(question => {
      const work = question.forWork;
      const defining = work && workloads.find(fact => fact.id === resolver.leafOf(work.definingFactId));
      return work?.amount === expected.questionWork!.amount && defining?.unitLabel === expected.questionWork!.unitLabel;
    });
    if (!matches) failures.push(`missing question work ${JSON.stringify(expected.questionWork)}`);
  }
  return failures;
}
