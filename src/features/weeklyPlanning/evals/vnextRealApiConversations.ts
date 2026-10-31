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
  kind: 'deadline' | 'earliest_start' | 'latest_end' | 'fixed_interval';
  dateExpression: string;
  time?: string;
  endTime?: string;
  level?: 'hard' | 'soft';
}

export interface RealApiFixedEventRegistrationOracle {
  /** Expected typed registration request in this turn's semantic reading. */
  requested: boolean;
  eventDate: string;
  startTime: string;
  endTime: string;
  /** Exact count of unsaved fixed-event candidates in the VNext preview. */
  candidateCount: 0 | 1;
}

export interface RealApiTurnOracle {
  /** false means this turn is deliberately excluded from VNext success counts. */
  inVNextScope: boolean;
  outOfScopeReason?: string;
  workloads: readonly RealApiWorkloadOracle[];
  /** Equivalent active fact sets accepted for provider-specific but semantically identical readings. */
  workloadAlternatives?: readonly (readonly RealApiWorkloadOracle[])[];
  efforts: readonly RealApiEffortOracle[];
  temporal: readonly RealApiTemporalOracle[];
  /** Stable machine question code after this turn; null means no open question. */
  questionCode: string | null;
  /** Work minutes from the typed projection, if ready. */
  projectedMinutes: number | null;
  /** True when a stated time estimate must be bound to future work, not observed pace. */
  requireFutureWorkEstimate?: boolean;
  /** If true, a non-answer must leave facts and the same blocking question intact. */
  preservePreviousTypedState?: boolean;
  /** Pairs of workload entries in oracle order that must belong to different task owners. */
  distinctWorkloadPairs?: readonly (readonly [number, number])[];
  /** Pairs of workload entries that must retain one shared task owner. */
  sameWorkloadPairs?: readonly (readonly [number, number])[];
  expectedTaskCount?: number;
  /** Derived VNext projection workload expectations; never treated as stored facts. */
  projectedWorkloads?: readonly RealApiWorkloadOracle[];
  /** A missing-estimate question asks about this work even before it is schedulable. */
  questionForWork?: RealApiWorkloadOracle;
  /** VNext may preserve an unanswered question as deferred while keeping its work unscheduled. */
  allowQuestionDeferral?: boolean;
  /** No active estimate applicable to this work should exist after an unanswered response. */
  expectNoApplicableEffort?: boolean;
  /** Some regression cases intentionally isolate a different semantic failure. */
  checkTemporal?: boolean;
  fixedEventRegistration?: RealApiFixedEventRegistrationOracle;
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
    id: 'fixed-event-register-calendar-add', source: '#926 fixed-event registration paraphrase',
    description: '明示的に予定表へ追加する依頼を、未保存の固定予定候補へ結び付ける。',
    turns: [{ userText: '11月3日16時から17時半までゼミがあります。予定表にも載せといて。', oracle: {
      ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
      fixedEventRegistration: { requested: true, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 1 },
    } }],
  },
  {
    id: 'fixed-event-register-calendar-question', source: '#926 fixed-event registration paraphrase',
    description: '同じ登録依頼を別の丁寧な表現で行う。',
    turns: [{ userText: '11月3日16時から17時半まではゼミです。カレンダーに入れてもらえる？', oracle: {
      ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
      fixedEventRegistration: { requested: true, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 1 },
    } }],
  },
  {
    id: 'fixed-event-busy-information-only', source: '#926 fixed-event registration negative control',
    description: '固定予定の共有だけで登録依頼はせず、学習配置を妨げる時間として保持する。',
    turns: [{ userText: '11月3日16時から17時半まではゼミなので、その間は勉強できません。', oracle: {
      ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
      fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0 },
    } }],
  },
  {
    id: 'fixed-event-registration-negated', source: '#926 fixed-event registration negative control',
    description: '明示的な登録拒否を尊重し、予定表には追加しない。',
    turns: [{ userText: '11月3日16時から17時半までゼミがありますが、予定表には入れなくていいです。', oracle: {
      ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
      fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0 },
    } }],
  },
  {
    id: 'fixed-event-yes-after-rendered-offer', source: '#926 fixed-event contextual acceptance',
    description: '固定予定を伝えた後、VNextの実際の返信が登録を申し出た場合に限り、その申し出への短い承諾を解釈する。',
    turns: [
      { userText: '11月3日16時から17時半までゼミがあります。', oracle: {
        ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0 },
      } },
      { userText: 'うん、お願い。', oracle: {
        ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
        fixedEventRegistration: { requested: true, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 1 },
      } },
    ],
  },
  {
    id: 'fixed-event-yes-without-registration-offer', source: '#926 fixed-event contextual acceptance negative control',
    description: '登録の申し出がない文脈での同じ短い相づちは登録依頼にしない。',
    turns: [
      { userText: '英語の音読を20分したいです。', oracle: ready(20,
        [workload('reading-aloud', 'target', 20, 'minute', '分')]) },
      { userText: '11月3日16時から17時半までゼミがあります。うん、お願い。', oracle: {
        ...ready(0, [], [], [{ task: 'seminar', kind: 'fixed_interval', dateExpression: '2026-11-03', time: '16:00', endTime: '17:30', level: 'hard' }], { projectedMinutes: null }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0 },
      } },
    ],
  },
  {
    id: 'simple-remaining-and-rate', source: 'implementation-contract.md §1, §5.3',
    description: '通常の残量と単位あたり時間から分数を計算する。',
    turns: [{ userText: '英単語の復習が残り10個です。1個あたり3分くらいです。', oracle: ready(30,
      [workload('vocabulary', 'remaining', 10, 'custom', '個')], [rate('vocabulary', 3, 'custom', '個')]) }],
  },
  {
    id: 'omitted-effort-answer', source: 'implementation-contract.md §5, §28省略回答',
    description: '作業量を今は答えられない場合、新事実を作らず質問を開いたままか保留する。',
    turns: [
      { userText: '数学の問題は残り8問です。', oracle: q('missing_effort_estimate', [workload('math', 'remaining', 8, 'custom', '問')]) },
      { userText: 'その時間は今は分かりません。', oracle: {
        ...q('missing_effort_estimate', [workload('math', 'remaining', 8, 'custom', '問')]),
        preservePreviousTypedState: true, allowQuestionDeferral: true, expectNoApplicableEffort: true,
        questionForWork: workload('math', 'remaining', 8, 'custom', '問'),
      } },
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
      [workload('reading-aloud', 'target', 30, 'minute', '分')]) }],
  },
  {
    id: 'separate-work-then-correction', source: 'implementation-contract.md §5.5, #905, #912',
    description: '別作業の確認後に一方だけ数量訂正しても、もう一方を落とさない。',
    turns: [
      { userText: 'スライドは残り10枚です。別作業でファイル整理が残り30分あります。', oracle: {
        ...q('missing_effort_estimate', [workload('slides', 'remaining', 10, 'custom', '枚'), workload('file-cleanup', 'remaining', 30, 'minute', '分')]),
        projectedMinutes: 30,
      } },
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
      { userText: '研究室のレポートを仕上げたいです', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null }),
        questionCode: 'missing_schedulable_work',
      } },
      { userText: '締切は明日の13時です', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null }),
        questionCode: 'missing_schedulable_work',
        expectedTaskCount: 1,
        temporal: [{ task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' }],
      } },
      { userText: '完成を100%とすると、今は50%くらいです', oracle: {
        ...ready(0, [workload('report', 'scope_total', 100, 'custom', '%'), workload('report', 'completed', 50, 'custom', '%')], [], [
          { task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' },
        ], { projectedMinutes: null }),
        questionCode: 'missing_effort_estimate',
        workloadAlternatives: [[workload('report', 'completed', 50, 'custom', '%')]],
      } },
      { userText: '残りは1時間半くらいです', oracle: ready(90,
        [workload('report', 'remaining', 90, 'minute', '分')], [],
        [{ task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' }], {
          workloadAlternatives: [
            [workload('report', 'scope_total', 100, 'custom', '%'), workload('report', 'completed', 50, 'custom', '%')],
            [workload('report', 'completed', 50, 'custom', '%')],
          ],
          requireFutureWorkEstimate: true,
        }) },
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
        questionForWork: workload('slides', 'remaining', 8, 'custom', '枚'),
      } },
      { userText: '1枚あたりだいたい8分くらいです', oracle: ready(64,
        [workload('slides', 'scope_total', 20, 'custom', '枚'), workload('slides', 'completed', 12, 'custom', '枚')],
        [rate('slides', 8, 'custom', '枚')], [], { checkTemporal: false, expectedTaskCount: 1, sameWorkloadPairs: [[0, 1]], projectedWorkloads: [workload('slides', 'remaining', 8, 'custom', '枚')] }) },
    ],
  },
  {
    id: 'yesterday-math-completed-30-minutes', source: 'real API run 41001146547 / scenario yesterday-completed',
    description: 'Measure whether yesterday activity is interpreted as completed work; its occurrence date is outside the VNext fact contract.',
    clock: { currentDate: '2026-10-30', weekStartDate: '2026-10-26', planningEndDate: '2026-11-01' },
    turns: [{ userText: '昨日は数学を30分勉強しました。', oracle: ready(0,
      [workload('math', 'completed', 30, 'minute', '分')], [], [], { projectedMinutes: null }) }],
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
