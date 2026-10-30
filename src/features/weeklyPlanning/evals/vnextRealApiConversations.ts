/**
 * Synthetic conversations shared by the V5 and VNext real-provider observation
 * harness. Oracles describe typed persisted meaning and projected work, never
 * assistant wording. Setup or unsupported turns are labelled and excluded from
 * the semantic-success denominator.
 */

export type RealApiWorkUnit = 'custom' | 'page' | 'minute' | 'hour' | 'chapter' | 'session' | 'problem' | 'word' | 'lesson' | 'section' | 'exam_year' | 'mock_exam';
export type RealApiWorkRole = 'scope_total' | 'completed' | 'remaining' | 'target' | 'declared' | 'unknown';
export type RealApiEffortKind = 'duration_per_unit' | 'total_duration' | 'session_duration';

export interface RealApiWorkloadOracle {
  task: string;
  role: RealApiWorkRole;
  amount: number;
  unitCode: RealApiWorkUnit;
  unitLabel: string;
  perOccurrence?: boolean;
  periodExpression?: string | null;
}

export interface RealApiEffortOracle {
  task: string;
  kind: RealApiEffortKind;
  minutes: number;
  /** Unit identity for duration_per_unit; null for total/session durations. */
  unitCode: RealApiWorkUnit | null;
  unitLabel: string | null;
  /** Stated fact the estimate measures: a workload role or owner-wide task. */
  forRole: RealApiWorkRole | 'task';
}

export interface RealApiTemporalOracle {
  task: string;
  kind: 'deadline' | 'earliest_start' | 'latest_end';
  dateExpression: string;
  time?: string;
  level?: 'hard' | 'soft';
}

export interface RealApiTurnOracle {
  /** false means this turn is deliberately excluded from VNext success counts. */
  inVNextScope: boolean;
  outOfScopeReason?: string;
  workloads: readonly RealApiWorkloadOracle[];
  efforts: readonly RealApiEffortOracle[];
  temporal: readonly RealApiTemporalOracle[];
  /** Stable machine question code after this turn; null means no open question. */
  questionCode: string | null;
  /** Work minutes from the typed projection, if ready. */
  projectedMinutes: number | null;
  /** If true, a non-answer must leave facts and the same blocking question intact. */
  preservePreviousTypedState?: boolean;
  /** Pairs of workload entries in oracle order that must belong to different task owners. */
  distinctWorkloadPairs?: readonly (readonly [number, number])[];
  /** Pairs of workload entries that must retain one shared task owner. */
  sameWorkloadPairs?: readonly (readonly [number, number])[];
  expectedTaskCount?: number;
  /** Derived VNext projection workload expectations; never treated as stored facts. */
  projectedWorkloads?: readonly RealApiWorkloadOracle[];
  /** Some regression cases intentionally isolate a different semantic failure. */
  checkTemporal?: boolean;
}

export interface RealApiConversationTurn {
  userText: string;
  oracle: RealApiTurnOracle;
}

export interface RealApiConversation {
  id: string;
  source: string;
  description: string;
  clock?: { currentDate: string; weekStartDate: string; planningEndDate: string };
  turns: readonly RealApiConversationTurn[];
}

const workload = (
  task: string,
  role: RealApiWorkRole,
  amount: number,
  unitCode: RealApiWorkUnit,
  unitLabel: string,
  extra: Partial<RealApiWorkloadOracle> = {},
): RealApiWorkloadOracle => ({ task, role, amount, unitCode, unitLabel, ...extra });

const rate = (task: string, minutes: number, unitCode: RealApiWorkUnit, unitLabel: string, forRole: RealApiWorkRole = 'remaining'): RealApiEffortOracle => ({
  task, kind: 'duration_per_unit', minutes, unitCode, unitLabel, forRole,
});

const total = (task: string, minutes: number, forRole: RealApiEffortOracle['forRole'] = 'remaining'): RealApiEffortOracle => ({
  task, kind: 'total_duration', minutes, unitCode: null, unitLabel: null, forRole,
});

const q = (code: string, workloads: readonly RealApiWorkloadOracle[], efforts: readonly RealApiEffortOracle[] = [], temporal: readonly RealApiTemporalOracle[] = []): RealApiTurnOracle => ({
  inVNextScope: true, workloads, efforts, temporal, questionCode: code, projectedMinutes: null,
});

const ready = (minutes: number, workloads: readonly RealApiWorkloadOracle[], efforts: readonly RealApiEffortOracle[] = [], temporal: readonly RealApiTemporalOracle[] = [], extra: Partial<RealApiTurnOracle> = {}): RealApiTurnOracle => ({
  inVNextScope: true, workloads, efforts, temporal, questionCode: null, projectedMinutes: minutes, ...extra,
});

export const vnextRealApiConversations: readonly RealApiConversation[] = [
  {
    id: 'simple-remaining-and-rate', source: 'implementation-contract.md §1, §5.3',
    description: '通常の残量と単位あたり時間から分数を計算する。',
    turns: [{ userText: '英単語の復習が残り10個です。1個あたり3分くらいです。', oracle: ready(30,
      [workload('vocabulary', 'remaining', 10, 'custom', '個')], [rate('vocabulary', 3, 'custom', '個')]) }],
  },
  {
    id: 'omitted-effort-answer', source: 'implementation-contract.md §5, §28省略回答',
    description: '作業量の質問への保留回答は新事実を作らず、確認を維持する。',
    turns: [
      { userText: '数学の問題は残り8問です。', oracle: q('missing_effort_estimate', [workload('math', 'remaining', 8, 'custom', '問')]) },
      { userText: 'その時間は今は分かりません。', oracle: { ...q('missing_effort_estimate', [workload('math', 'remaining', 8, 'custom', '問')]), preservePreviousTypedState: true } },
    ],
  },
  {
    id: 'paraphrase-restatement-no-duplicate', source: 'implementation-contract.md §1, §28言い換え',
    description: '同じ量と見積もりの言い換えを重複作業にしない。',
    turns: [
      { userText: '読書は残り10ページで、1ページ5分くらいです。', oracle: ready(50,
        [workload('reading', 'remaining', 10, 'page', 'ページ')], [rate('reading', 5, 'page', 'ページ')]) },
      { userText: '本はあと10ページです。1ページに5分ほどかかります。', oracle: ready(50,
        [workload('reading', 'remaining', 10, 'page', 'ページ')], [rate('reading', 5, 'page', 'ページ')]) },
    ],
  },
  {
    id: 'quantity-and-deadline-correction', source: 'implementation-contract.md §1, §5, #882',
    description: '一ターンの数量と期限訂正を両方保持する。',
    turns: [
      { userText: '資料は残り12ページで、1ページ5分です。期限は2026年11月8日です。', oracle: ready(60,
        [workload('handout', 'remaining', 12, 'page', 'ページ')], [rate('handout', 5, 'page', 'ページ')],
        [{ task: 'handout', kind: 'deadline', dateExpression: '2026-11-08' }]) },
      { userText: '残りを8ページに、期限は2026年11月7日に訂正します。', oracle: ready(40,
        [workload('handout', 'remaining', 8, 'page', 'ページ')], [rate('handout', 5, 'page', 'ページ')],
        [{ task: 'handout', kind: 'deadline', dateExpression: '2026-11-07' }]) },
    ],
  },
  {
    id: 'quantity-and-total-duration-correction', source: 'implementation-contract.md §5.3, Astra A03, #882 R8+E60',
    description: '同一ターンの数量と総時間訂正を最終数量へ結び直す。',
    turns: [
      { userText: '問題は残り10問で、全体で80分です。', oracle: ready(80,
        [workload('questions', 'remaining', 10, 'custom', '問')], [total('questions', 80)]) },
      { userText: '残り8問、全体で60分に訂正します。', oracle: ready(60,
        [workload('questions', 'remaining', 8, 'custom', '問')], [total('questions', 60)]) },
    ],
  },
  {
    id: 'custom-unit-change-invalidates-rate', source: 'implementation-contract.md §5.3, §28単位変更',
    description: 'custom単位内でも「枚」から「セット」への変更は旧rateを無効化する。',
    turns: [
      { userText: 'カードは残り10枚で、1枚8分です。', oracle: ready(80,
        [workload('cards', 'remaining', 10, 'custom', '枚')], [rate('cards', 8, 'custom', '枚')]) },
      { userText: '単位はセットでした。残り2セットです。', oracle: q('missing_effort_estimate',
        [workload('cards', 'remaining', 2, 'custom', 'セット')]) },
      { userText: '1セットあたり20分です。', oracle: ready(40,
        [workload('cards', 'remaining', 2, 'custom', 'セット')], [rate('cards', 20, 'custom', 'セット')]) },
    ],
  },
  {
    id: 'past-progress-observed-pace', source: 'implementation-contract.md §5.3, Astra A09',
    description: '完了済み作業にかかった時間を進捗量だけの観測ペースとして適用する。',
    turns: [{ userText: '10ページ終わり、そこまでに80分かかりました。残りは5ページです。', oracle: ready(40,
      [workload('report', 'completed', 10, 'page', 'ページ'), workload('report', 'remaining', 5, 'page', 'ページ')],
      [total('report', 80, 'completed')]) }],
  },
  {
    id: 'independent-explicit-remaining', source: 'implementation-contract.md §1, #919明示remaining',
    description: 'scope-totalから計算せず明示された残量を維持して見積もる。',
    turns: [{ userText: 'レポートは残り8ページです。1ページ5分です。', oracle: ready(40,
      [workload('report', 'remaining', 8, 'page', 'ページ')], [rate('report', 5, 'page', 'ページ')]) }],
  },
  {
    id: 'timebox-only-work', source: 'implementation-contract.md §5.3時間単位workload',
    description: '分で明示されたworkloadをそのまま作業時間として扱い、追加rateを掛けない。',
    turns: [{ userText: '英語の音読を30分だけします。', oracle: ready(30,
      [workload('reading-aloud', 'remaining', 30, 'minute', '分')]) }],
  },
  {
    id: 'separate-work-then-correction', source: 'implementation-contract.md §5.5, #905, #912',
    description: '別作業の確認後に一方だけ数量訂正しても、もう一方を落とさない。',
    turns: [
      { userText: 'スライドは残り10枚です。別作業でファイル整理が残り30分あります。', oracle: q('same_or_distinct_work',
        [workload('slides', 'remaining', 10, 'custom', '枚'), workload('file-cleanup', 'remaining', 30, 'minute', '分')]) },
      { userText: 'それは別の仕事です。スライドは残り8枚に訂正し、1枚6分です。', oracle: ready(78,
        [workload('slides', 'remaining', 8, 'custom', '枚'), workload('file-cleanup', 'remaining', 30, 'minute', '分')],
        [rate('slides', 6, 'custom', '枚')], [], { distinctWorkloadPairs: [[0, 1]] }) },
    ],
  },
  {
    id: 'issue881-final-b-deadline-at-13', source: 'FinalConversation B / issue #881 / real API run 40999309402',
    description: 'A single stated deadline at 13:00 is a hard deadline, not a fixed time interval requiring a start-time question.',
    clock: { currentDate: '2026-08-26', weekStartDate: '2026-08-24', planningEndDate: '2026-08-30' },
    turns: [
      { userText: '明日の予定を立てたいです', oracle: {
        inVNextScope: false, outOfScopeReason: 'planning-window selection is not represented by the VNext fact contract',
        workloads: [], efforts: [], temporal: [], questionCode: null, projectedMinutes: null,
      } },
      { userText: '研究室のレポートを仕上げたいです', oracle: ready(0, [], [], [], { projectedMinutes: null }) },
      { userText: '締切は明日の13時です', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null }),
        expectedTaskCount: 1,
        temporal: [{ task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' }],
      } },
      { userText: '完成を100%とすると、今は50%くらいです', oracle: ready(0, [], [], [
        { task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' },
      ], { projectedMinutes: null }) },
      { userText: '残りは1時間半くらいです', oracle: ready(90,
        [workload('report', 'remaining', 90, 'minute', '分')], [],
        [{ task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' }]) },
    ],
  },
  {
    id: 'issue881-final-c-corrected-completion', source: 'FinalConversation C / issue #881 / real API run 40999309402',
    description: 'After correcting completed work from 10 to 12 of 20 pages, the projection has exactly 8 pages remaining.',
    clock: { currentDate: '2026-08-26', weekStartDate: '2026-08-24', planningEndDate: '2026-08-30' },
    turns: [
      { userText: '明日の予定を立てたいです', oracle: {
        inVNextScope: false, outOfScopeReason: 'planning-window selection is not represented by the VNext fact contract',
        workloads: [], efforts: [], temporal: [], questionCode: null, projectedMinutes: null,
      } },
      { userText: '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです', oracle: {
        ...q('missing_effort_estimate', [
        workload('slides', 'scope_total', 20, 'custom', '枚'),
        workload('slides', 'completed', 10, 'custom', '枚'),
        ]), checkTemporal: false, expectedTaskCount: 1, sameWorkloadPairs: [[0, 1]],
      } },
      { userText: '訂正です、今は12枚までできています', oracle: {
        ...q('missing_effort_estimate', [
          workload('slides', 'scope_total', 20, 'custom', '枚'),
          workload('slides', 'completed', 12, 'custom', '枚'),
        ]),
        checkTemporal: false,
        expectedTaskCount: 1,
        sameWorkloadPairs: [[0, 1]],
        projectedWorkloads: [workload('slides', 'remaining', 8, 'custom', '枚')],
      } },
      { userText: '1枚あたりだいたい8分くらいです', oracle: ready(64,
        [workload('slides', 'scope_total', 20, 'custom', '枚'), workload('slides', 'completed', 12, 'custom', '枚')],
        [rate('slides', 8, 'custom', '枚')], [], { checkTemporal: false, expectedTaskCount: 1, sameWorkloadPairs: [[0, 1]], projectedWorkloads: [workload('slides', 'remaining', 8, 'custom', '枚')] }) },
    ],
  },
  {
    id: 'recurrence-out-of-vnext-scope', source: 'implementation-contract.md VNext supported facts',
    description: '繰り返し規則はVNextのtask/component/workload/effort/temporal範囲外。成功扱いしない。',
    turns: [{ userText: '来週から毎週月曜日に英語を勉強する予定にしてください。', oracle: {
      inVNextScope: false, outOfScopeReason: 'recurrence is not represented in the VNext fact contract',
      workloads: [], efforts: [], temporal: [], questionCode: null, projectedMinutes: null,
    } }],
  },
];

export const vnextRealApiInScopeConversations = vnextRealApiConversations.filter((conversation) =>
  conversation.turns.some((turn) => turn.oracle.inVNextScope));

export const vnextRealApiOutOfScopeConversationIds = vnextRealApiConversations.flatMap((conversation) =>
  conversation.turns.some((turn) => !turn.oracle.inVNextScope) ? [conversation.id] : []);
