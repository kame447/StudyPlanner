/**
 * Synthetic conversations shared by the V5 and VNext real-provider observation
 * harness. Oracles describe typed persisted meaning and projected work, never
 * assistant wording. Setup or unsupported turns are labelled and excluded from
 * the semantic-success denominator.
 */
import type { RealApiDateMeaningOracle } from './vnextRealApiDateOracle';

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
  /** Require the interval to be unavailable in V5's compiled scheduler input. */
  requireBusyInterval?: boolean;
}

export interface RealApiOptionalInvitationOracle {
  question: 'optional' | 'required' | 'none';
  conversationActKinds: readonly string[];
  statusReason: string | null;
  closed: boolean;
  candidateCount?: number;
  saveWritesBeforeApproval: number;
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
  /**
   * Duration-only study records the turn must read (#973): a past, dated study report is a record, never a workload.
   * When present the VNext reading's studyRecords must equal this set exactly (date, subject, minutes); when absent
   * nothing is checked about records. V5 has no study records, so a turn that sets this stays a V5 difference.
   */
  studyRecords?: readonly { date: string; subject: string; minutes: number }[];
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
  /** Compare resolved meaning when the domain accepts equivalent date representations. */
  dateMeaning?: RealApiDateMeaningOracle;
  fixedEventRegistration?: RealApiFixedEventRegistrationOracle;
  /** Same typed interaction outcome is asserted by the V5 and VNext runners. */
  optionalInvitation?: RealApiOptionalInvitationOracle;
  /**
   * A reply that must not become the answer to the asked estimate in a forbidden way (the live "D5 negatives", #926).
   * Judges state and question only: the facts are the oracle's workloads, the asked task never gets a forbidden effort,
   * the asked question stays (shown, or kept deferred) unless the reply was genuinely accepted as an answer, nothing is
   * saved, and a part for another work lands on that work only. A correct acceptance is not penalised.
   */
  answerGuard?: RealApiAnswerGuardOracle;
}

export interface RealApiAnswerGuardOracle {
  /** The task whose estimate the open question asks. */
  askedTask: string;
  /** Efforts this reply must not leave active on the asked task. `precision: 'exact'` forbids only an exact one. */
  forbiddenEfforts: readonly { kind: RealApiEffortKind; minutes: number; precision?: 'exact' }[];
  /** A fact the reply states about another task: it must exist there and never on the asked task. */
  requiredTemporal?: { task: string; kind: RealApiTemporalOracle['kind']; dateExpression: string };
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

const D5_CLOCK = { currentDate: '2026-11-02', weekStartDate: '2026-11-02', planningEndDate: '2026-11-08' } as const;
const D5_SETUP_TEXT = '今週、数学20問と英語15ページを進めたい。英語15ページは全部で45分。';
const D5_MATH = workload('math', 'target', 20, 'problem', '問');
// The model may read the English pages as a target or as what remains; both are the same stated work.
const d5Workloads = (english: RealApiWorkRole) => [D5_MATH, workload('english', english, 15, 'page', 'ページ')];
const d5SetupOracle = (): RealApiTurnOracle => ({
  ...q('missing_effort_estimate', d5Workloads('target')),
  workloadAlternatives: [d5Workloads('remaining'), d5Workloads('declared')],
  questionForWork: D5_MATH, projectedMinutes: 45, expectedTaskCount: 2, checkTemporal: false,
});

/**
 * The Stable V5 "D5 live negative" replies (tests/e2e/ai-planning-jev-first-authority.spec.mjs) as product invariants
 * both engines are observed on, with no live bridge: after 数学20問 asks for its minutes, a reply that is not a plain
 * per-unit answer for 数学 must not become one, the question stays, and nothing is saved.
 */
function d5NegativeConversations(): RealApiConversation[] {
  const guarded = (id: string, userText: string, guard: RealApiAnswerGuardOracle, description: string): RealApiConversation => ({
    id, source: '#926 D5 live negatives as VNext product invariants (spec "D5 live negative 1280")', description, clock: D5_CLOCK,
    turns: [
      { userText: D5_SETUP_TEXT, oracle: d5SetupOracle() },
      { userText, oracle: { ...d5SetupOracle(), answerGuard: guard, allowQuestionDeferral: true, preservePreviousTypedState: true } },
    ],
  });
  const noRate = (precision?: 'exact'): RealApiAnswerGuardOracle => ({ askedTask: 'math',
    forbiddenEfforts: [{ kind: 'duration_per_unit', minutes: 15, ...(precision ? { precision } : {}) }] });
  return [
    guarded('d5-negative-pages-only', '15ページ', noRate(), '単位だけの返答は数学の1問あたり15分にならない。'),
    guarded('d5-negative-english-minutes', '英語は15分', noRate(), '英語に向けた分数は数学の1問あたりにならない。'),
    guarded('d5-negative-total-minutes', '全部で15分', noRate(), '総時間の返答は1問あたり15分にならない（総時間として答えと受け取るのは可）。'),
    guarded('d5-negative-approximate-rate', '15分くらい', noRate('exact'), '「くらい」は正確な1問あたり15分にならない（おおよその見積もりとして受け取るのは可）。'),
    guarded('d5-negative-compound', '15分。あと英語の締切を金曜にして', { askedTask: 'math', forbiddenEfforts: [], requiredTemporal: { task: 'english', kind: 'deadline', dateExpression: '2026-11-06' } },
      '複合の返答は、数学の答えは受け取るか確認のまま保ち、英語の締切は英語にだけ付ける。'),
    {
      id: 'd5-positive-per-unit-rate', source: '#926 D5 live negatives as VNext product invariants: positive control', clock: D5_CLOCK,
      description: '同じ質問への明確な1問あたりの返答は数学にだけ付き、英語の45分は変わらない。',
      turns: [
        { userText: D5_SETUP_TEXT, oracle: d5SetupOracle() },
        { userText: '1問あたり15分です', oracle: { ...ready(345, d5Workloads('target'), [rate('math', 15, 'problem', '問', 'target')], [], {
          workloadAlternatives: [d5Workloads('remaining'), d5Workloads('declared')], expectedTaskCount: 2, checkTemporal: false }) } },
      ],
    },
  ];
}

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
    description: '固定予定の共有だけで登録依頼はせず、学習配置を妨げる時間として保持する。Stable V5と同じく、動かせる作業がまだ無いので任意の追加作業の確認を出す（V5 HumanScale「busy-only evidence without registration is an optional invitation」）。',
    turns: [{ userText: '11月3日16時から17時半まではゼミなので、その間は勉強できません。', oracle: {
      ...ready(0, [], [], [], { projectedMinutes: null, checkTemporal: false, questionCode: 'missing_schedulable_work' }),
      fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'optional', conversationActKinds: [], statusReason: null, closed: false, candidateCount: 0, saveWritesBeforeApproval: 0 },
    } }],
  },
  {
    id: 'fixed-event-registration-negated', source: '#926 fixed-event registration negative control',
    description: '明示的な登録拒否を尊重し、予定表には追加しない。動かせる作業がまだ無いので、Stable V5と同じ任意の追加作業の確認を出す。',
    turns: [{ userText: '11月3日16時から17時半までゼミがありますが、予定表には入れなくていいです。', oracle: {
      ...ready(0, [], [], [], { projectedMinutes: null, checkTemporal: false, questionCode: 'missing_schedulable_work' }),
      fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'optional', conversationActKinds: [], statusReason: null, closed: false, candidateCount: 0, saveWritesBeforeApproval: 0 },
    } }],
  },
  {
    id: 'fixed-event-yes-after-rendered-offer',
    source: '#978: no registration offer exists in V5/VNext; user decision 2026-11-01',
    description: '登録の申し出が無い文脈の相づちは登録依頼にしない。固定予定はbusyとして保持し、保存しない。',
    turns: [
      { userText: '11月3日16時から17時半までゼミがあります。', oracle: {
        ...q('missing_schedulable_work', []), checkTemporal: false,
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
      } },
      { userText: 'うん、お願い。', oracle: {
        ...q('missing_schedulable_work', []), checkTemporal: false,
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
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
        ...ready(20, [workload('reading-aloud', 'target', 20, 'minute', '分')], [], [], {
          projectedMinutes: 20,
          checkTemporal: false,
        }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
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
        ...q('missing_schedulable_work', []),
        dateMeaning: { planningWindow: { startDate: '2026-08-27', endDate: '2026-08-27' } },
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
        ...q('missing_schedulable_work', []),
        dateMeaning: { planningWindow: { startDate: '2026-08-27', endDate: '2026-08-27' } },
      } },
      { userText: '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです', oracle: {
        ...q('missing_effort_estimate', [
        workload('slides', 'scope_total', 20, 'custom', '枚'),
        workload('slides', 'completed', 10, 'custom', '枚'),
        ]), checkTemporal: false, dateMeaning: { workDate: { task: 'slides', date: '2026-08-27' } }, expectedTaskCount: 1, sameWorkloadPairs: [[0, 1]],
      } },
      { userText: '訂正です、今は12枚までできています', oracle: {
        ...q('missing_effort_estimate', [
          workload('slides', 'scope_total', 20, 'custom', '枚'),
          workload('slides', 'completed', 12, 'custom', '枚'),
        ]),
        checkTemporal: false,
        dateMeaning: { workDate: { task: 'slides', date: '2026-08-27' } },
        expectedTaskCount: 1,
        sameWorkloadPairs: [[0, 1]],
        questionForWork: workload('slides', 'remaining', 8, 'custom', '枚'),
      } },
      { userText: '1枚あたりだいたい8分くらいです', oracle: ready(64,
        [workload('slides', 'scope_total', 20, 'custom', '枚'), workload('slides', 'completed', 12, 'custom', '枚')],
        [rate('slides', 8, 'custom', '枚')], [], { checkTemporal: false, dateMeaning: { workDate: { task: 'slides', date: '2026-08-27' } }, expectedTaskCount: 1, sameWorkloadPairs: [[0, 1]], projectedWorkloads: [workload('slides', 'remaining', 8, 'custom', '枚')] }) },
    ],
  },
  {
    id: 'optional-invitation-busy-decline-reopen', source: 'V5 HumanScale decline controls / #926 optional-invitation parity',
    description: 'Busy-only information opens an optional invitation; typed decline closes it; new work reopens planning.',
    turns: [
      { userText: '11月2日から8日の予定です。11月3日16時から17時半は勉強できません。', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null, checkTemporal: false }),
        questionCode: 'missing_schedulable_work',
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'optional', conversationActKinds: [], statusReason: null, closed: false, candidateCount: 0, saveWritesBeforeApproval: 0 },
      } },
      { userText: 'ほかの作業は追加しません。', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null, checkTemporal: false }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'none', conversationActKinds: ['decline_additional_work'], statusReason: 'no_additional_work', closed: true, candidateCount: 0, saveWritesBeforeApproval: 0 },
      } },
      { userText: 'わかりました。', oracle: {
        ...ready(0, [], [], [], { projectedMinutes: null, checkTemporal: false }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'none', conversationActKinds: [], statusReason: 'no_additional_work', closed: true, candidateCount: 0, saveWritesBeforeApproval: 0 },
      } },
      { userText: 'やっぱり英単語を20語、1語2分で勉強する計画をお願いします。', oracle: {
        ...ready(40, [workload('vocabulary', 'target', 20, 'word', '語')],
          [rate('vocabulary', 2, 'word', '語', 'target')], [], { expectedTaskCount: 1 }),
        fixedEventRegistration: { requested: false, eventDate: '2026-11-03', startTime: '16:00', endTime: '17:30', candidateCount: 0, requireBusyInterval: true },
        optionalInvitation: { question: 'none', conversationActKinds: [], statusReason: null, closed: false, saveWritesBeforeApproval: 0 },
      } },
    ],
  },
  {
    id: 'optional-decline-does-not-close-required-effort', source: 'V5 HumanScale decline-vs-required-question negative control / #926',
    description: 'The model must read the decline-like turn as decline_additional_work while preserving the required effort question; omitting that act fails the oracle.',
    turns: [
      { userText: '数学の問題を10問やりたいです。', oracle: {
        ...q('missing_effort_estimate', [workload('math', 'target', 10, 'problem', '問')]),
        questionForWork: workload('math', 'target', 10, 'problem', '問'),
        optionalInvitation: { question: 'required', conversationActKinds: [], statusReason: null, closed: false, candidateCount: 0, saveWritesBeforeApproval: 0 },
      } },
      { userText: 'ほかの作業は追加しません。', oracle: {
        ...q('missing_effort_estimate', [workload('math', 'target', 10, 'problem', '問')]),
        questionForWork: workload('math', 'target', 10, 'problem', '問'),
        optionalInvitation: { question: 'required', conversationActKinds: ['decline_additional_work'], statusReason: null, closed: false, candidateCount: 0, saveWritesBeforeApproval: 0 },
      } },
    ],
  },
  {
    id: 'yesterday-math-completed-30-minutes', source: 'real API run 41001146547 / scenario yesterday-completed; oracle corrected by CONTRACT-CORRECTION-R2-yesterday.md (/Users/Shogo/.agentstack/reviews/20261103-examinee-weekly-actual-e2e/CONTRACT-CORRECTION-R2-yesterday.md, decided by PurplePasteur 2026-11-03 under USER-PRIORITIES-20261103.md)',
    description: 'A past, dated study report is a study record, not a workload: yesterday (2026-10-29) math 30 minutes is read as one studyRecords entry, with no completed workload, no question and nothing saved. Previous oracle: ready(0, [completed 30 minute workload]) because "its occurrence date is outside the VNext fact contract" (bc73796c, #928 c4b0dfa8); that premise ended with #973 (VNext holds dated actuals), and run 41634010795 read studyRecords [{2026-10-29, 数学, 30}] with no workload (previous result d4c4a087: VNext pass on the old oracle). A completed workload here would double-count the same minutes and pull a record-only turn into planning.',
    clock: { currentDate: '2026-10-30', weekStartDate: '2026-10-26', planningEndDate: '2026-11-01' },
    turns: [{ userText: '昨日は数学を30分勉強しました。', oracle: ready(0, [], [], [], {
      projectedMinutes: null, studyRecords: [{ date: '2026-10-29', subject: '数学', minutes: 30 }],
    }) }],
  },
  {
    id: 'recurrence-out-of-vnext-scope', source: '#978 recurrence and accepted start boundary (historical ID retained)',
    description: '来週から毎週月曜という繰返しと開始境界を保持し、量・所要時間の無い作業を予定化しない。',
    turns: [{ userText: '来週から毎週月曜日に英語を勉強する予定にしてください。', oracle: {
      ...q('missing_schedulable_work', []), checkTemporal: false, expectedTaskCount: 1,
      dateMeaning: { recurrence: { kind: 'weekly', days: ['weekday:monday'], startDate: '2026-11-09' } },
    } }],
  },
  ...d5NegativeConversations(),
];

export const vnextRealApiInScopeConversations = vnextRealApiConversations.filter((conversation) =>
  conversation.turns.some((turn) => turn.oracle.inVNextScope));

export const vnextRealApiOutOfScopeConversationIds = vnextRealApiConversations.flatMap((conversation) =>
  conversation.turns.some((turn) => !turn.oracle.inVNextScope) ? [conversation.id] : []);
