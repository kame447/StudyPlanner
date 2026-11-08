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
