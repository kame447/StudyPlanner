/**
 * Offline semantic inputs and independent outcome oracles for the VNext
 * comparison. These fixtures describe expected behavior, not current V5 output.
 * Keep the adapter between this format and either implementation in eval code.
 */

export type WorkUnit = 'page' | 'custom_page' | 'custom_page_set' | 'minute' | 'hour' | 'chapter';
export type QuantityRole = 'scope_total' | 'completed' | 'remaining' | 'target' | 'declared';

export type WorkloadInput = {
  kind: 'workload';
  task: string;
  component?: string;
  role: QuantityRole;
  amount: number;
  unit: WorkUnit;
  unitLabel?: string;
  range?: readonly [number, number];
  perOccurrence?: boolean;
  period?: string;
};

export type EffortInput = {
  kind: 'effort';
  task: string;
  measure: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unit?: WorkUnit;
  for?: string;
};

export type TemporalInput = {
  kind: 'temporal';
  task: string;
  constraint: 'deadline' | 'earliest_start' | 'latest_end';
  dateExpression: string;
};

export type TaskInput = {
  kind: 'task';
  task: string;
  category: 'study' | 'non_study' | 'unknown';
  title: string;
};

export type FactInput = WorkloadInput | EffortInput | TemporalInput | TaskInput;

export type FixtureTurn = {
  /** User text retained for conversation replay and traceability. */
  utterance: string;
  /** Typed semantic result, recorded offline; no provider call is made. */
  facts?: readonly FactInput[];
  patch?: readonly {
    target: string;
    changes: Readonly<Record<string, string | number | boolean>>;
  }[];
  relation?: { left: string; right: string; value: 'same' | 'distinct' };
  answer?: { question: string; value: string };
  retract?: readonly string[];
  expectedTransaction?: 'applied' | 'rejected' | 'noop';
};

export type FixtureOracle = {
  outcome: 'ready' | 'question' | 'nothing_to_schedule';
  minutes?: number;
  question?: string;
  /** Assertions on user-owned facts; derived values are never treated as input. */
  preserved?: readonly string[];
  absent?: readonly string[];
  notes?: readonly string[];
};

export type ComparisonFixture = {
  id: string;
  name: string;
  provenance: string;
  category: 'prototype' | 'recorded-replay' | 'contract-regression';
  turns: readonly FixtureTurn[];
  checkpoint?: { version: string; graphRevision: number; data: Readonly<Record<string, unknown>> };
  v5: 'unreachable' | { graph?: import('../semantic/weeklyPlanningFactGraphV5').WeeklyPlanningFactGraphV5 };
  oracle: FixtureOracle;
  /** Known baseline bugs are observations, not accepted outcomes. */
  knownV5Defects?: readonly string[];
  v5KnownDefect?: { issue: string; expectedV5Behaviour: string };
};

type FixtureWithoutV5 = Omit<ComparisonFixture, 'v5'>;
const markV5Unreachable = (fixtures: readonly FixtureWithoutV5[]): ComparisonFixture[] =>
  fixtures.map((fixture) => ({ ...fixture, v5: 'unreachable' }));

const workload = (role: QuantityRole, amount: number, unit: WorkUnit = 'custom_page', extra: Partial<WorkloadInput> = {}): WorkloadInput => ({
  kind: 'workload', task: 'slides', role, amount, unit, ...extra,
});
const rate = (minutes: number, unit: WorkUnit = 'custom_page'): EffortInput => ({
  kind: 'effort', task: 'slides', measure: 'duration_per_unit', minutes, unit,
});
const total = (minutes: number, forFact: string): EffortInput => ({
  kind: 'effort', task: 'slides', measure: 'total_duration', minutes, for: forFact,
});

/** The 21 revised-design prototype scenarios, transcribed as typed fixtures. */
const prototypeFixtureSource: readonly FixtureWithoutV5[] = [
  { id: 'proto-c1', name: 'derived remainder asks for effort', provenance: '03-proto/cases.mjs C1', category: 'prototype', turns: [{ utterance: '全部20枚、今10枚できています。', facts: [workload('scope_total', 20), workload('completed', 10)] }], oracle: { outcome: 'question', question: 'missing_effort_estimate' } },
  { id: 'proto-c2', name: 'value correction does not reuse stale total', provenance: '03-proto/cases.mjs C2', category: 'prototype', turns: [{ utterance: '全部20枚、今10枚できています。', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: '進捗を12枚に訂正します。', patch: [{ target: 'completed', changes: { amount: 12 } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['completed.unit'] } },
  { id: 'proto-c3', name: 'rate follows value patch and delta is arithmetic', provenance: '03-proto/cases.mjs C3', category: 'prototype', turns: [{ utterance: '全部20枚、今10枚できていて1枚8分です。', facts: [workload('scope_total', 20), workload('completed', 10), rate(8)] }, { utterance: '進捗を2枚増やします。', patch: [{ target: 'completed', changes: { amountDelta: 2 } }] }], oracle: { outcome: 'ready', minutes: 64 } },
  { id: 'proto-c4', name: 'progress and deadline changes are atomic', provenance: '03-proto/cases.mjs C4', category: 'prototype', turns: [{ utterance: '全部20枚、今10枚です。期限は11月6日です。', facts: [workload('scope_total', 20), workload('completed', 10), { kind: 'temporal', task: 'slides', constraint: 'deadline', dateExpression: '2026-11-06' }] }, { utterance: '進捗12枚と不正な期限を同時に訂正。', patch: [{ target: 'completed', changes: { amount: 12 } }, { target: 'invalid-deadline', changes: { dateExpression: 'x' } }], expectedTransaction: 'rejected' }, { utterance: '進捗12枚、期限11月5日に訂正。', patch: [{ target: 'completed', changes: { amount: 12 } }, { target: 'deadline', changes: { dateExpression: '2026-11-05' } }], expectedTransaction: 'applied' }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['scope_total', 'completed=12', 'deadline=2026-11-05'] } },
  { id: 'proto-c5', name: 'true unit change invalidates old rate', provenance: '03-proto/cases.mjs C5', category: 'prototype', turns: [{ utterance: '残り10枚、1枚8分です。', facts: [workload('remaining', 10), rate(8)] }, { utterance: '残り2章に変更します。', patch: [{ target: 'remaining', changes: { amount: 2, unit: 'chapter' } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate' } },
  { id: 'proto-c6', name: 'independent stated remaining can schedule', provenance: '03-proto/cases.mjs C6', category: 'prototype', turns: [{ utterance: '残り8枚、1枚5分です。', facts: [workload('remaining', 8), rate(5)] }], oracle: { outcome: 'ready', minutes: 40 } },
  { id: 'proto-c7', name: 'inconsistent explicit remaining asks once and resolves', provenance: '03-proto/cases.mjs C7', category: 'prototype', turns: [{ utterance: '全部20枚、完了10枚、残り10枚、1枚8分です。', facts: [workload('scope_total', 20), workload('completed', 10), workload('remaining', 10), rate(8)] }, { utterance: '完了を12枚に訂正。', patch: [{ target: 'completed', changes: { amount: 12 } }] }, { utterance: '計算された残りを採用します。', answer: { question: 'remaining_inconsistent', value: 'derived_remaining' } }], oracle: { outcome: 'ready', minutes: 64 } },
  { id: 'proto-c8', name: '45 minutes is distinct work unless user relates it', provenance: '03-proto/cases.mjs C8', category: 'prototype', turns: [{ utterance: 'スライドは残り10枚です。別に残り45分の作業があります。', facts: [workload('scope_total', 20), workload('completed', 10), workload('remaining', 45, 'minute'), rate(8)] }, { utterance: 'それぞれ別の作業です。', relation: { left: 'page_work', right: 'minute_work', value: 'distinct' } }], oracle: { outcome: 'ready', minutes: 125 } },
  { id: 'proto-c9', name: 'different unit basis is never silently omitted or doubled', provenance: '03-proto/cases.mjs C9', category: 'prototype', turns: [{ utterance: '残り5ページを対象にします。', facts: [workload('scope_total', 20), workload('completed', 10), workload('target', 5, 'page'), rate(8, 'page')] }, { utterance: '対象は同じ作業です。', relation: { left: 'target', right: 'page_work', value: 'same' } }], oracle: { outcome: 'ready', minutes: 40 } },
  { id: 'proto-c10', name: 'conflicting rate and total are surfaced', provenance: '03-proto/cases.mjs C10', category: 'prototype', turns: [{ utterance: '残り10枚、1枚8分、全体60分です。', facts: [workload('remaining', 10), rate(8), total(60, 'remaining')] }], oracle: { outcome: 'question', question: 'effort_inconsistent' } },
  { id: 'proto-c11', name: 'deferral hides only the exact question', provenance: '03-proto/cases.mjs C11', category: 'prototype', turns: [{ utterance: '全部20枚、完了10枚です。', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: 'この確認は後にします。', answer: { question: 'missing_effort_estimate', value: 'defer' } }, { utterance: '別に残り3問あります。', facts: [workload('remaining', 3, 'custom_page', { unitLabel: '問' })] }], oracle: { outcome: 'question', question: 'same_or_distinct_work' } },
  { id: 'proto-c12', name: 'identity fields and stale revisions reject', provenance: '03-proto/cases.mjs C12', category: 'prototype', turns: [{ utterance: '残り10枚です。', facts: [workload('remaining', 10)] }, { utterance: '別タスクに付け替え、古いrevisionで訂正します。', patch: [{ target: 'remaining', changes: { task: 'other' } }], expectedTransaction: 'rejected' }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['remaining=10'] } },
  { id: 'proto-a01-p1', name: 'explicitly distinct work survives target', provenance: '03-proto/cases.mjs A01/P1', category: 'prototype', turns: [{ utterance: '対象5枚と別に45分の作業。', facts: [workload('target', 5), workload('remaining', 45, 'minute'), rate(8)] }, { utterance: '別作業です。', relation: { left: 'target', right: 'remaining', value: 'distinct' } }], oracle: { outcome: 'ready', minutes: 85 } },
  { id: 'proto-a01-p4', name: 'distinct relation follows lineage after patch', provenance: '03-proto/cases.mjs A01/P4', category: 'prototype', turns: [{ utterance: '残り10枚と残り45分。', facts: [workload('remaining', 10), workload('remaining', 45, 'minute'), rate(8)] }, { utterance: '別作業です。', relation: { left: 'page_remaining', right: 'minute_remaining', value: 'distinct' } }, { utterance: 'ページ残りを8枚に訂正。', patch: [{ target: 'page_remaining', changes: { amount: 8 } }] }], oracle: { outcome: 'ready', minutes: 109 } },
  { id: 'proto-a01-p5', name: 'one distinct pair does not cover a third work', provenance: '03-proto/cases.mjs A01/P5', category: 'prototype', turns: [{ utterance: '残り10枚、45分、1時間の仕事があります。', facts: [workload('remaining', 10), workload('remaining', 45, 'minute'), workload('remaining', 1, 'hour'), rate(8)] }, { utterance: '最初の二つは別作業です。', relation: { left: 'page_remaining', right: 'minute_remaining', value: 'distinct' } }], oracle: { outcome: 'question', question: 'same_or_distinct_work' } },
  { id: 'proto-a01-p6', name: 'retracted work takes its total with it', provenance: '03-proto/cases.mjs A01/P6', category: 'prototype', turns: [{ utterance: '残り10枚です。', facts: [workload('remaining', 10)] }, { utterance: '全体80分です。', facts: [total(80, 'remaining')] }, { utterance: 'その作業は取り消します。', retract: ['remaining'] }, { utterance: '残り10枚の別作業を追加します。', facts: [workload('remaining', 10)] }], oracle: { outcome: 'question', question: 'missing_effort_estimate' } },
  { id: 'proto-a01-p7', name: 'completed-work total informs observed pace', provenance: '03-proto/cases.mjs A01/P7', category: 'prototype', turns: [{ utterance: '10ページ完了、残り5ページ。完了分に80分かかりました。', facts: [workload('completed', 10, 'page'), workload('remaining', 5, 'page'), total(80, 'completed')] }], oracle: { outcome: 'ready', minutes: 40 } },
  { id: 'proto-a02-p2', name: 'custom label changes unit identity', provenance: '03-proto/cases.mjs A02/P2', category: 'prototype', turns: [{ utterance: '残り10枚、1枚8分です。', facts: [workload('remaining', 10), rate(8)] }, { utterance: '残り2セットに訂正します。', patch: [{ target: 'remaining', changes: { amount: 2, unit: 'custom_page_set' } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate' } },
  ...([false, true] as const).map((effortFirst): FixtureWithoutV5 => ({ id: `proto-a03-p3-${effortFirst ? 'effort-first' : 'quantity-first'}`, name: 'compound quantity and effort correction is order independent', provenance: `03-proto/cases.mjs A03/P3 ${effortFirst ? 'effort first' : 'quantity first'}`, category: 'prototype', turns: [{ utterance: '残り10枚、全体80分。', facts: [workload('remaining', 10), total(80, 'remaining')] }, { utterance: '残り8枚、全体で60分に訂正します。', patch: effortFirst ? [{ target: 'effort', changes: { minutes: 60 } }, { target: 'remaining', changes: { amount: 8 } }] : [{ target: 'remaining', changes: { amount: 8 } }, { target: 'effort', changes: { minutes: 60 } }] }], oracle: { outcome: 'ready', minutes: 60 } })),
  { id: 'proto-a03-quantity-only', name: 'quantity-only correction does not keep old total', provenance: '03-proto/cases.mjs A03', category: 'prototype', turns: [{ utterance: '残り10枚、全体80分。', facts: [workload('remaining', 10), total(80, 'remaining')] }, { utterance: '残りを8枚に訂正。', patch: [{ target: 'remaining', changes: { amount: 8 } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate' } },
];
export const prototypeFixtures: readonly ComparisonFixture[] = markV5Unreachable(prototypeFixtureSource);

/** A small contract slice explicitly called out by the implementation brief. */
const regressionFixtureSource: readonly FixtureWithoutV5[] = [
  { id: 'replay-882-iter1', name: '#882 real-API iteration 1 custom-to-page correction', provenance: 'state-audit run 40713796128, iter1; recorded typed replay', category: 'recorded-replay', turns: [{ utterance: '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: '訂正です、今は12枚までできています', patch: [{ target: 'completed', changes: { amount: 12, unit: 'page' } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['scope_total=20', 'completed=12', 'deadline'] }, knownV5Defects: ['historical correction changed custom to page and left the old derived remaining active; this is recorded baseline behavior, not the expected result'], v5KnownDefect: { issue: '#882', expectedV5Behaviour: 'The custom-to-page replacement can leave the old derived remainder active.' } },
  { id: 'replay-882-iter4', name: '#882 real-API iteration 4 explicit remaining correction', provenance: 'state-audit run 40713796128, iter4; recorded typed replay', category: 'recorded-replay', turns: [{ utterance: '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: '訂正です、今は12枚までできています', patch: [{ target: 'completed', changes: { amount: 12, unit: 'custom_page' } }, { target: 'remaining', changes: { amount: 8 } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['scope_total=20', 'completed=12', 'remaining=8', 'deadline'] }, knownV5Defects: ['historical replay represented the recalculated remainder as an explicit user fact; after the correction this could prompt an extra confirmation'], v5KnownDefect: { issue: '#882', expectedV5Behaviour: 'The replay may expose the recalculated remainder as an explicit fact and ask an extra confirmation.' } },
  { id: 'contract-919-explicit-remaining', name: '#919 explicit remaining is preserved after progress correction', provenance: 'implementation-contract.md and design §2 known defect', category: 'contract-regression', turns: [{ utterance: '全体20枚、完了10枚、残り7枚です。', facts: [workload('scope_total', 20), workload('completed', 10), workload('remaining', 7)] }, { utterance: '完了を12枚に訂正します。', patch: [{ target: 'completed', changes: { amount: 12 } }] }], oracle: { outcome: 'question', question: 'remaining_inconsistent', preserved: ['remaining=7'] }, knownV5Defects: ['current V5 progress-correction reconciliation can rewrite an explicit remaining value; #919 tracks the contract violation'], v5KnownDefect: { issue: '#919', expectedV5Behaviour: 'The current progress-correction path may overwrite the explicit remaining value.' } },
  { id: 'issue-905-45-minute-work', name: '#905 45 minutes is an amount of work, not a duration estimate', provenance: 'implementation-contract.md §1 and 03-opus-final.md §11', category: 'contract-regression', turns: [{ utterance: '残り10ページです。別に残り45分の作業もあります。', facts: [workload('remaining', 10, 'page'), workload('remaining', 45, 'minute')] }, { utterance: '別の作業です。', relation: { left: 'pages', right: 'minutes', value: 'distinct' } }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['page_work', 'minute_work'], notes: ['The 45-minute work item is already a duration quantity; do not multiply it by a rate.'] } },
  { id: 'issue-906-derived-question-answer', name: '#906 a computed blocking question accepts its bound answer', provenance: '03-opus-final.md §5.4 and §11', category: 'contract-regression', turns: [{ utterance: '全部20枚、完了10枚、残り7枚、1枚8分です。', facts: [workload('scope_total', 20), workload('completed', 10), workload('remaining', 7), rate(8)] }, { utterance: '計算された残りを使ってください。', answer: { question: 'remaining_inconsistent', value: 'derived_remaining' } }], oracle: { outcome: 'ready', minutes: 80, notes: ['Answer is applied to the exact current projection question and then reprojected.'] } },
  { id: 'issue-907-same-or-distinct-closes', name: '#907 same/distinct answer closes the relation question', provenance: '04-review-dispositions.md §P1 and 03-opus-final.md §5.5', category: 'contract-regression', turns: [{ utterance: '残り10ページと、対象5ページがあります。', facts: [workload('remaining', 10, 'page'), workload('target', 5, 'page')] }, { utterance: '同じ作業です。', relation: { left: 'target', right: 'remaining', value: 'same' } }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['target=5', 'remaining=10'], notes: ['The target represents the same work; no double scheduling.'] } },
  { id: 'issue-911-rate-total-conflict', name: '#911 conflicting total and rate remain visible', provenance: '03-opus-final.md §5.5 and 03-proto/cases.mjs C10', category: 'contract-regression', turns: [{ utterance: '残り10ページで、1ページ8分、全体60分です。', facts: [workload('remaining', 10, 'page'), rate(8, 'page'), total(60, 'remaining')] }], oracle: { outcome: 'question', question: 'effort_inconsistent', preserved: ['rate=8', 'total=60'] } },
  { id: 'issue-912-target-other-scope', name: '#912 target asks before excluding or adding other-scope work', provenance: '04-review-dispositions.md §P1 and 03-proto/cases.mjs C9', category: 'contract-regression', turns: [{ utterance: '全部20ページのうち10ページ完了。対象は別範囲の5章です。', facts: [workload('scope_total', 20, 'page'), workload('completed', 10, 'page'), workload('target', 5, 'chapter'), rate(8, 'page')] }], oracle: { outcome: 'question', question: 'same_or_distinct_work', preserved: ['target=5 chapter', 'remaining=10 page'] } },
  { id: 'issue-913-range-per-occurrence', name: '#913 scope, range, period, and per-occurrence basis remain distinct', provenance: '03-opus-final.md §11; contract scope/range/perOccurrence contrast', category: 'contract-regression', turns: [{ utterance: '1〜10ページを対象にし、各回5ページずつ進めます。', facts: [workload('scope_total', 10, 'page', { range: [1, 10] }), workload('target', 5, 'page', { range: [1, 10], perOccurrence: true, period: 'each_session' }), rate(8, 'page')] }], oracle: { outcome: 'question', question: 'same_or_distinct_work', preserved: ['scope_total.range=1..10', 'target.range=1..10', 'target.perOccurrence=true', 'target.period=each_session'], notes: ['A period or range mismatch cannot be erased by matching labels.'] } },
  { id: 'issue-916-consent-no-new-number', name: '#916 yes/no consent does not invent a numeric fact', provenance: '03-opus-final.md §5.4 and §11', category: 'contract-regression', turns: [{ utterance: '作業量を特定できません。', facts: [workload('declared', 0)] }, { utterance: 'はい。', answer: { question: 'quantity_role_unresolved', value: 'yes' } }], oracle: { outcome: 'question', question: 'quantity_role_unresolved', preserved: ['declared workload remains unresolved'], absent: ['new numeric workload'], notes: ['Consent can authorize an action but does not supply an amount.'] } },
  { id: 'compound-progress-and-effort', name: 'compound correction keeps both changed values atomically', provenance: 'implementation-contract.md §1 and §28; #882 compound-correction obligation', category: 'contract-regression', turns: [{ utterance: '残り10ページ、全体80分です。', facts: [workload('remaining', 10, 'page'), total(80, 'remaining')] }, { utterance: '残り8ページ、全体で60分に訂正します。', patch: [{ target: 'remaining', changes: { amount: 8 } }, { target: 'effort', changes: { minutes: 60 } }] }], oracle: { outcome: 'ready', minutes: 60, preserved: ['remaining=8', 'total_duration=60'] } },
  { id: 'old-checkpoint-explicit-date', name: 'old checkpoint preserves explicit date and asks about unsupported ambiguity', provenance: '03-opus-final.md §9.1 and implementation-contract.md §28', category: 'contract-regression', turns: [{ utterance: '11月6日の予定を再開します。', facts: [{ kind: 'workload', task: 'slides', role: 'remaining', amount: 8, unit: 'page' }] }, { utterance: '前のチェックポイントから続けます。', answer: { question: 'checkpoint_migration', value: 'resume' } }], oracle: { outcome: 'question', question: 'checkpoint_migration', preserved: ['explicit date=2026-11-06'], notes: ['Do not silently infer fields absent from the old checkpoint.'] } },
  { id: 'category-and-identity-not-guessed', name: 'category and task identity remain semantic inputs', provenance: '03-opus-final.md §5.1 and §8', category: 'contract-regression', turns: [{ utterance: '夏合宿のスライド作成を追加します。', facts: [workload('remaining', 8, 'page', { task: 'camp slides' })] }, { utterance: 'それは勉強ではなくイベント準備です。', patch: [{ target: 'task-category', changes: { category: 'non_study' } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['task identity=camp slides', 'category=non_study'] } },
  { id: 'contract-882-explicit-r7', name: '#882 explicit R7 remains user-owned through progress correction', provenance: 'final-consensus.md §5 U2 and #919 follow-up contract', category: 'contract-regression', turns: [{ utterance: '全体20枚、完了10枚、明示した残り7枚です。', facts: [workload('scope_total', 20), workload('completed', 10), workload('remaining', 7)] }, { utterance: '完了数を12枚に直します。', patch: [{ target: 'completed', changes: { amount: 12 } }] }], oracle: { outcome: 'question', question: 'remaining_inconsistent', preserved: ['remaining=7'] }, knownV5Defects: ['V5 #919 may rewrite the explicit remaining while reconciling progress.'], v5KnownDefect: { issue: '#919', expectedV5Behaviour: 'The current path may replace the explicit R7 fact during progress correction.' } },
  { id: 'contract-882-r8-e60-order-a', name: '#882 R8 plus E60 correction in quantity-first order', provenance: 'implementation-contract.md §28 and #882 compound-correction replay', category: 'contract-regression', turns: [{ utterance: '残り10枚です。', facts: [workload('remaining', 10)] }, { utterance: '残り8枚、全体で60分に訂正します。', patch: [{ target: 'remaining', changes: { amount: 8 } }, { target: 'effort', changes: { minutes: 60 } }] }], oracle: { outcome: 'ready', minutes: 60, preserved: ['remaining=8', 'effort=60'] } },
  { id: 'contract-882-r8-e60-order-b', name: '#882 R8 plus E60 correction in effort-first order', provenance: 'implementation-contract.md §28 and #882 compound-correction replay', category: 'contract-regression', turns: [{ utterance: '残り10枚です。', facts: [workload('remaining', 10)] }, { utterance: '全体で60分、残り8枚に訂正します。', patch: [{ target: 'effort', changes: { minutes: 60 } }, { target: 'remaining', changes: { amount: 8 } }] }], oracle: { outcome: 'ready', minutes: 60, preserved: ['remaining=8', 'effort=60'] } },
  { id: 'contract-yesterday-progress', name: 'yesterday progress remains attached to its accepted date', provenance: 'implementation-contract.md §28 and #918 date-acceptance contract', category: 'contract-regression', turns: [{ utterance: '昨日は数学を30分勉強しました。', facts: [{ kind: 'temporal', task: 'math', constraint: 'deadline', dateExpression: '2026-10-28' }, { kind: 'effort', task: 'math', measure: 'session_duration', minutes: 30 }] }], oracle: { outcome: 'nothing_to_schedule', preserved: ['date=2026-10-28', 'session_duration=30'] } },
  { id: 'contract-custom-page-unit-change', name: 'custom page to chapter changes measurement identity', provenance: 'implementation-contract.md §28 and #882 iter1/iter4', category: 'contract-regression', turns: [{ utterance: '残り10枚、1枚8分です。', facts: [workload('remaining', 10), rate(8)] }, { utterance: '残り2章に単位を変更します。', patch: [{ target: 'remaining', changes: { amount: 2, unit: 'chapter' } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['remaining.unit=chapter'] } },
  { id: 'contract-repair-no-data-loss', name: 'failed formal repair leaves the original facts intact', provenance: 'implementation-contract.md §28 and 03-opus-final.md §5.6', category: 'contract-regression', turns: [{ utterance: '全体20枚、完了10枚です。', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: '形式が不正な完了数の修正を返す。', patch: [{ target: 'completed', changes: { amount: -1 } }] }, { utterance: '完了を12枚に修復します。', patch: [{ target: 'completed', changes: { amount: 12 } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['scope_total=20', 'completed=12'], notes: ['The rejected transaction must not partially apply.'] } },
  { id: 'contract-one-to-thirty-minute-correction', name: 'one minute estimate can be corrected to thirty minutes', provenance: 'implementation-contract.md §28 and recorded conversation regression', category: 'contract-regression', turns: [{ utterance: '残り1回、1回1分です。', facts: [workload('remaining', 1, 'custom_page', { perOccurrence: true, period: 'each_session' }), { kind: 'effort', task: 'slides', measure: 'session_duration', minutes: 1 }] }, { utterance: '1回あたり30分に訂正します。', patch: [{ target: 'effort', changes: { minutes: 30 } }] }], oracle: { outcome: 'ready', minutes: 30, preserved: ['effort=30', 'workload.perOccurrence=true'] } },
  { id: 'contract-explicit-date', name: 'explicit date survives later correction', provenance: '03-opus-final.md §5.8 and implementation-contract.md §28', category: 'contract-regression', turns: [{ utterance: '11月6日にスライド作成をします。', facts: [{ kind: 'task', task: 'slides', category: 'non_study', title: 'スライド作成' }, { kind: 'temporal', task: 'slides', constraint: 'deadline', dateExpression: '2026-11-06' }, workload('remaining', 8, 'page')] }, { utterance: '残りを9ページに訂正します。', patch: [{ target: 'remaining', changes: { amount: 9 } }] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['explicit date=2026-11-06', 'remaining=9'] } },
  { id: 'contract-note-plus-new-task', name: 'a note does not suppress a newly stated task', provenance: 'implementation-contract.md §28 regression list', category: 'contract-regression', turns: [{ utterance: '今日は部活で疲れました。数学の問題を5問解きます。', facts: [workload('target', 5, 'page', { task: 'math problems' })] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', preserved: ['task=math problems', 'target=5'] } },
  { id: 'contract-wait-deferral', name: 'wait defers only the displayed question', provenance: '03-opus-final.md §5.4 and 03-proto/cases.mjs C11', category: 'contract-regression', turns: [{ utterance: '全部20枚、完了10枚です。', facts: [workload('scope_total', 20), workload('completed', 10)] }, { utterance: 'その確認は後で答えます。', answer: { question: 'missing_effort_estimate', value: 'defer' } }, { utterance: '別に残り3問あります。', facts: [workload('remaining', 3, 'page', { task: 'math problems' })] }], oracle: { outcome: 'question', question: 'missing_effort_estimate', notes: ['The new work has its own open question; the old deferral does not hide it.'] } },
  { id: 'contract-denial-does-not-authorize-save', name: 'denial keeps a pending proposal unapplied', provenance: 'implementation-contract.md §28 yes/no and approval regression', category: 'contract-regression', turns: [{ utterance: 'この予定を保存しますか。', facts: [] }, { utterance: 'いいえ。', answer: { question: 'save_confirmation', value: 'no' } }], oracle: { outcome: 'nothing_to_schedule', absent: ['saved plan', 'approval'] } },
  { id: 'contract-checkpoint-reload-approve', name: 'legacy checkpoint reload and approval retain recorded work', provenance: 'implementation-contract.md §28 and existing resumable-checkpoint eval', category: 'contract-regression', turns: [{ utterance: '以前のチェックポイントを再開します。', facts: [workload('remaining', 8, 'page'), rate(5, 'page')] }, { utterance: '確認して保存します。', answer: { question: 'preview_approval', value: 'yes' } }], checkpoint: { version: 'weekly-planning-resumable-conversation-v1', graphRevision: 3, data: { hasEvaluationMetadata: false, savedAt: '2026-10-29T00:00:00.000Z' } }, oracle: { outcome: 'ready', minutes: 40, preserved: ['checkpoint graph revision=3'], notes: ['Checkpoint restore is evaluated offline; no persistence write is performed.'] } },
 ];
export const regressionFixtures: readonly ComparisonFixture[] = markV5Unreachable(regressionFixtureSource);

export const allVNextComparisonFixtures = [...prototypeFixtures, ...regressionFixtures] as const;
