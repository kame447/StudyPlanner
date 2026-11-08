// Synthetic inputs that measure how often the real provider reads a stated meaning in the way a low-priority backlog entry
// (#992) assumes. No user data. Every scenario is observation-only: the oracle result is recorded in the artifact's
// `failures`, and a mismatch does not fail the run (the artifact, not the exit code, is the measurement).
// Not part of VNEXT_PROVIDER_SCENARIOS: deterministic tests count and replay that list.
import type { VNextProviderScenario } from './weeklyPlanningVNextProviderScenarios';

type Role = { role: string; amount: number };
const one = (id: string, text: string, roles: Role[]): VNextProviderScenario => ({
  id, seed: [], observeOnly: true, turns: [{ text, expected: { roles, taskCount: 1 } }],
});

export const VNEXT_F_MEASURE_SCENARIOS: VNextProviderScenario[] = [
  // G1-13 root: a stated busy time with no request to register it must stay busy information (no task, no workload).
  ...([
    ['f-busy-seminar', '11月3日16時から17時半までゼミがあります。'],
    ['f-busy-interview', '11月4日の13時から14時は面談があります。'],
    ['f-busy-parttime', '11月5日の18時から20時はアルバイトです。'],
    ['f-busy-cram-school', '11月6日の午後3時から5時は塾があります。'],
  ] as const).map(([id, text]): VNextProviderScenario => ({
    id, seed: [], observeOnly: true, turns: [{ text, expected: { roles: [], taskCount: 0 } }],
  })),

  // SB3 quantity_role_unresolved is measured by QuietLovelace's weeklyPlanningVNextQuantityRole.realApi.observation.test.ts
  // (12 single-quantity utterances through the real session path); it is not repeated here.

  // SB2 duplicate_quantity: restating the same quantity must not add a second fact.
  { id: 'f-dup-total', seed: [], observeOnly: true, turns: [
    { text: '数学の問題集は全部で20ページです', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
    { text: '全部で20ページあります', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
  ] },
  { id: 'f-dup-remaining', seed: [], observeOnly: true, turns: [
    { text: '数学の問題集は残り8ページです', expected: { roles: [{ role: 'remaining', amount: 8 }], taskCount: 1 } },
    { text: '残りは8ページです', expected: { roles: [{ role: 'remaining', amount: 8 }], taskCount: 1 } },
  ] },

  // Stage B priority 6 (SturdyCopernicus's stageb-p6-early-preview.md): three stated works, none with an estimate, so the presented
  // question is one missing_effort_estimate. Observe the provider's `defer` entries (how many, their questionKey and allocation,
  // and `scope` once the all_pending patch is in) in `observations[].result`, and the questions left in `projection`. Run on main
  // for the baseline and again with the all_pending patch. p6-estimate-unknown-bare must stay a question (no defer).
  ...([
    ['p6-defer-all-phrase', 'どれも時間は分からないから、仮でいいから全部入れて'],
    ['p6-defer-one-phrase', '数学だけ仮でいいから先に入れて'],
    ['p6-estimate-unknown-bare', '時間は分からない'],
  ] as const).map(([id, text]): VNextProviderScenario => ({
    id, observeOnly: true,
    seed: ([['math', '数学', 20], ['english', '英語', 15], ['physics', '物理', 10]] as const).flatMap(([key, title, amount]) => [
      { kind: 'task', localId: key, title, category: 'study' },
      { kind: 'workload', localId: `${key}-work`, taskRef: { localId: key }, componentRef: null, amount, quantityRole: 'target',
        unitCode: 'custom', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ]) as unknown as VNextProviderScenario['seed'],
    turns: [{ text, expected: { roles: [{ role: 'target', amount: 20 }, { role: 'target', amount: 15 }, { role: 'target', amount: 10 }], taskCount: 3 } }],
  })),

  // Daily study limit (AshEdison's daily-cap-cases.md; cases and wording are AshEdison's). Does the provider state the limit as a hard
  // `capacity` availability_declaration with a scope; what happens to a softly worded one (rejected, then one repair) and to named
  // weekdays (`weekday:<name>` resolves, a plain `monday` passes the provider but blocks the preview). The expected roles are
  // placeholders: read the availability_declaration facts (kind, recurrenceKind, days, constraintLevel, capacityMinutes) and any repair
  // in `receipts`/`after`. cap-control has no limit and must emit no capacity declaration.
  ...([
    ['cap-daily-hard', '毎日の勉強は1時間までです。数学を今週7時間やりたいです。'],
    ['cap-daily-soft', '毎日の勉強は1時間くらいにしたいです。数学を今週7時間やりたいです。'],
    ['cap-weekdays', '平日の勉強は1時間までにします。数学を今週7時間やりたいです。'],
    ['cap-named-days', '月曜と水曜は勉強を30分までにしてください。数学を今週3時間やりたいです。'],
    ['cap-control', '数学を今週7時間やりたいです。'],
  ] as const).map(([id, text]) => one(id, text, [])),

  // Registration with only a part of the day (AshEdison's fixed-interval-repair.md). Without the repair the provider puts a named
  // time period on a fixed_interval with no times, the transaction rejects it and the repair repeats it (3/3 in run 42498006565).
  // Run on a branch that carries fixed-interval-repair.patch. Read `result` (status; interpreted vs rejected_after_repair), the repair
  // request/response in `receipts`, the facts kept in `after` (task, registration act, task_date_rule; no invented times), and the
  // projection's questions (the expected outcome is the start/end question, invalid_commitment_interval).
  ...([
    ['tp-afternoon', '明日の午後に面談があるので、予定に入れてください。'],
    ['tp-evening', '金曜の夕方にゼミがあります。予定に入れてください。'],
    ['tp-morning', '来週の月曜の朝に歯医者があるので、カレンダーに入れて。'],
  ] as const).map(([id, text]): VNextProviderScenario => ({
    id, seed: [], observeOnly: true, turns: [{ text, expected: { roles: [], taskCount: 1 } }],
  })),

  // Range amount (HazyGoodall's range-amount.md): `amount` is derived from the range ends (end - start + 1) for counted units. Run on a
  // branch that carries range-amount.patch. Read the final workload's amount and rangeStart/rangeEnd in `after`, and the question's
  // work amount in `projection`. range-chapters: non-numeric ends are not derived. range-subset: a partial amount inside a range
  // (a known limit; does the provider drop the range, or is the amount overwritten). range-correction: an explicit amount after a range.
  ...([
    ['range-pages', '数学を30ページから50ページまでやります'],
    ['range-problems', '英語の問題集の10問から25問までを解きます'],
    ['range-chapters', '世界史の第3章から第5章までを読みます'],
    ['range-subset', '数学の30ページから50ページのうち、今週は10ページだけやります'],
  ] as const).map(([id, text]): VNextProviderScenario => ({
    id, seed: [], observeOnly: true, turns: [{ text, expected: { roles: [], taskCount: 1 } }],
  })),
  { id: 'range-correction', seed: [], observeOnly: true, turns: [
    { text: '数学を30ページから50ページまでやります', expected: { roles: [], taskCount: 1 } },
    { text: 'やっぱり15ページだけにします', expected: { roles: [], taskCount: 1 } },
  ] },

  // Stage B priority 5 (HazyGoodall's sb-p5-question-order.md): how the provider reads several works in one utterance, which
  // decides the first question (the reordering patch changes the order, not the reading). Read the first question's code and task
  // in `projection`, and the workloads in `after`. The renderer's wording is not measured here (no renderer in this harness).
  one('p5-multi-missing-quantity', '数学の問題集を8ページ、英語もやりたい、物理は5ページ', []),
  one('p5-multi-all-quantities', '数学を8ページ、物理を5ページ', []),

  // SB2 (SturdyCopernicus's sb2-duplicate-quantity.md; measured on main, without their fix). sb2-restate-total: does the provider add a
  // second workload on the restatement. sb2-same-answer: after a duplicate question, does it answer `relate: same`, and does the
  // same question come back. sb2-different-answer: a different amount of the same role. Read `after` and the projection's questions.
  { id: 'sb2-restate-total', seed: [], observeOnly: true, turns: [
    { text: '数学の問題集を全部で20ページ、今週やりたい', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
    { text: '全部で20ページあるんだ', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
  ] },
  { id: 'sb2-same-answer', seed: [], observeOnly: true, turns: [
    { text: '数学の問題集を全部で20ページ、今週やりたい', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
    { text: '全部で20ページあるんだ', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
    { text: '同じものです', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
  ] },
  { id: 'sb2-different-answer', seed: [], observeOnly: true, turns: [
    { text: '数学の問題集を全部で20ページ、今週やりたい', expected: { roles: [{ role: 'scope_total', amount: 20 }], taskCount: 1 } },
    { text: '全部で30ページです', expected: { roles: [{ role: 'scope_total', amount: 30 }], taskCount: 1 } },
    { text: '別々のものです', expected: { roles: [{ role: 'scope_total', amount: 20 }, { role: 'scope_total', amount: 30 }], taskCount: 1 } },
  ] },

  // SB4 effort_inconsistent rounding (HazyGoodall's sb4-effort-rounding.md): one utterance gives both a per-unit rate and a total.
  // The measurement is how often both effort facts appear, how far rate x amount is from the total, their precision, and whether
  // effort_inconsistent is asked. Read the effort facts and the projection's questions in `after`. The last two are controls.
  one('sb4-rate-and-total-round', '数学プリントを残り7枚やります。1枚あたり約2分半で、全部で18分くらいです', [{ role: 'remaining', amount: 7 }]),
  one('sb4-rate-and-total-near', '英語の問題集を残り8枚やります。1枚3分です。全部で25分くらいかな', [{ role: 'remaining', amount: 8 }]),
  one('sb4-rate-and-total-equal', '数学プリントを残り7枚やります。1枚あたり5分で、全部で35分です', [{ role: 'remaining', amount: 7 }]),
  one('sb4-conflict', '数学プリントを残り8枚やります。1枚あたり5分ですが、全部で60分かかります', [{ role: 'remaining', amount: 8 }]),

  // SB5 completed_exceeds_total and SB6 invalid_commitment_interval (READY, not yet characterized by their owners): minimal
  // readings only. SB5: how the provider reads a completed amount that exceeds the stated total. SB6: how it reads a fixed event
  // whose time of day is only a named period. Expected values are placeholders; read `after` and the projection's questions.
  // SB5 utterances are QuietLovelace's (sb5-completed.md): over total (a question is right), done = total, hours vs minutes equal,
  // a percent with and without a total, and the reversed order that is fine. Watch whether scope_total and completed are swapped.
  ...([
    ['sb5-over-total', '数学プリントは全体10枚で12枚終わりました', [{ role: 'scope_total', amount: 10 }, { role: 'completed', amount: 12 }]],
    ['sb5-done-equals-total', '数学プリントは全体10枚で10枚終わりました', [{ role: 'scope_total', amount: 10 }, { role: 'completed', amount: 10 }]],
    ['sb5-hours-vs-minutes', '数学プリントは全体2時間のうち120分終わりました', [{ role: 'scope_total', amount: 120 }, { role: 'completed', amount: 120 }]],
    ['sb5-percent-30', '数学プリントは3割終わりました', []],
    ['sb5-percent-120', '数学プリントは全体の120%まで終わりました', []],
    ['sb5-reversed-order', '数学プリントは12枚終わりました。全体は20枚です', [{ role: 'scope_total', amount: 20 }, { role: 'completed', amount: 12 }]],
  ] as const).map(([id, text, roles]): VNextProviderScenario => ({
    id, seed: [], observeOnly: true, turns: [{ text, expected: { roles: [...roles], taskCount: 1 } }],
  })),
  ...([
    ['sb6-seminar-evening', '11月3日の夕方にゼミがあります。'],
    ['sb6-register-afternoon', '明日の午後に面談があるので、予定に入れてください。'],
  ] as const).map(([id, text]): VNextProviderScenario => ({
    id, seed: [], observeOnly: true, turns: [{ text, expected: { roles: [], taskCount: 0 } }],
  })),

  // SB1 quantity_basis_invalid (names from HazyGoodall's sb1-range-repair.md): what the provider emits for a range with one end,
  // and whether the repair that follows invents the missing end. The expected roles are a placeholder (the reading, not a
  // verdict, is the measurement): read the first request's response, the repair request/response in `receipts`, and the
  // workload's rangeStart/rangeEnd in `after`. sb1-both-ends is the control: both ends, no rejection and no repair.
  one('sb1-from-page', '数学を30ページからやります', []),
  one('sb1-until-page', '英語を50ページまでやりたい', []),
  one('sb1-chapter-to-end', '第3章から最後まで進めます', []),
  one('sb1-both-ends', '数学を30ページから50ページまでやります', []),

  // c-6: how the provider reads a stated number of sessions for memorization work (the stop at the strategy question is
  // deterministic downstream). Expected roles are placeholders; read the workload unit and role in `after`.
  one('f-session-count-a', '英単語の暗記を今週は5回やりたい', []),
  one('f-session-count-b', '社会の用語を覚える時間を今週は3回取りたい', []),
  one('f-session-count-c', '古文単語の暗記を、今週は4回に分けてやりたい', []),
];
