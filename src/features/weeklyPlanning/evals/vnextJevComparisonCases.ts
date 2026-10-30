import type { VNextAddFact, VNextQuestionCode } from '../vnext/weeklyPlanningVNextTypes';

export type VNextJevComparisonSplit = 'dev' | 'holdout';
export type VNextJevComparisonRoute = 'option_choice' | 'full_reading';
export type VNextJevMenuShape = 'remaining_conflict' | 'one_target_same_or_distinct' | 'two_work_keep_or_distinct';

export interface VNextJevWorkOracle {
  taskTitle: string;
  /** Semantically equivalent short titles when the user's task phrase can be represented in several ways. */
  taskTitleAliases?: string[];
  quantityRole: 'target' | 'remaining' | 'completed' | 'scope_total';
  amount: number;
  unitCode: string;
  unitLabel: string;
}

/** Semantic oracle fields are user-meaning level, independent of fact IDs and model JSON shape. */
export interface VNextJevFinalStateOracle {
  activeWork: VNextJevWorkOracle[];
  relations: Array<{ kind: 'same' | 'distinct'; leftTaskTitle: string; rightTaskTitle: string }>;
  hardDeadlines: Array<{ taskTitle: string; date: string }>;
  openQuestionCodes: VNextQuestionCode[];
  deferredQuestionCodes: VNextQuestionCode[];
  /** Equivalent question outcomes when the user's words allow either preserving an open question or deferring it. */
  questionStateAlternatives?: Array<{ openQuestionCodes: VNextQuestionCode[]; deferredQuestionCodes: VNextQuestionCode[] }>;
  scheduledWorkMinutes: number[];
  savedPlanCount: 0;
}

export interface VNextJevComparisonCase {
  id: string;
  split: VNextJevComparisonSplit;
  menuShape: VNextJevMenuShape;
  purpose: string;
  reachablePath: string;
  responsibility: 'Jev_closed_choice' | 'Luna_full_semantic_reading';
  seed: { taskTitle: string; facts: VNextAddFact[]; acceptedDate: string };
  userText: string;
  expectedRoute: VNextJevComparisonRoute;
  /** Fixed option ID, or a semantic selector for lineage-dependent `keep:*` IDs. */
  expectedChoice: string | { keep: VNextJevWorkOracle } | null;
  finalState: VNextJevFinalStateOracle;
  /** Short explanation of a corrected oracle against frozen user text; utterances remain unchanged. */
  oracleCorrectionReason?: string;
}

const acceptedDate = '2026-11-02';
const baseOracle = (overrides: Partial<VNextJevFinalStateOracle> = {}): VNextJevFinalStateOracle => ({
  activeWork: [], relations: [], hardDeadlines: [], openQuestionCodes: [], deferredQuestionCodes: [],
  scheduledWorkMinutes: [], savedPlanCount: 0, ...overrides,
});

const workload = (localId: string, quantityRole: 'target' | 'remaining' | 'completed' | 'scope_total',
  amount: number, unitCode: 'page' | 'minute', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null, quantityRole, amount, unitCode,
  unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

function remainingConflictSeed(): { taskTitle: string; facts: VNextAddFact[]; acceptedDate: string } {
  return { taskTitle: '数学プリント', acceptedDate, facts: [
    workload('total', 'scope_total', 20, 'page', '枚'),
    workload('completed', 'completed', 12, 'page', '枚'),
    workload('remaining', 'remaining', 7, 'page', '枚'),
  ] };
}

function oneTargetSeed(): { taskTitle: string; facts: VNextAddFact[]; acceptedDate: string } {
  return { taskTitle: '英語', acceptedDate, facts: [
    workload('target-pages', 'target', 10, 'page', 'ページ'),
    workload('other-time', 'remaining', 30, 'minute', '分'),
    { kind: 'effort_estimate', localId: 'page-rate', taskRef: { localId: 'task' }, targetRef: { localId: 'target-pages' },
      effortKind: 'duration_per_unit', minutes: 4, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' },
  ] };
}

function oneTargetCorrectionSeed(): { taskTitle: string; facts: VNextAddFact[]; acceptedDate: string } {
  const seed = oneTargetSeed();
  return { ...seed, facts: seed.facts.map((fact) => fact.kind === 'workload' && fact.localId === 'other-time'
    ? { ...fact, amount: 35 } : fact) };
}

function twoWorkSeed(): { taskTitle: string; facts: VNextAddFact[]; acceptedDate: string } {
  return { taskTitle: '英語', acceptedDate, facts: [
    workload('pages', 'remaining', 10, 'page', 'ページ'),
    workload('minutes', 'remaining', 45, 'minute', '分'),
    { kind: 'effort_estimate', localId: 'page-rate', taskRef: { localId: 'task' }, targetRef: { localId: 'pages' },
      effortKind: 'duration_per_unit', minutes: 4, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' },
  ] };
}

const remainingOracle = (remaining: number, completed: number): VNextJevFinalStateOracle => baseOracle({
  activeWork: [
    { taskTitle: '数学プリント', quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚' },
    { taskTitle: '数学プリント', quantityRole: 'completed', amount: completed, unitCode: 'page', unitLabel: '枚' },
    { taskTitle: '数学プリント', quantityRole: 'remaining', amount: remaining, unitCode: 'page', unitLabel: '枚' },
  ], openQuestionCodes: ['missing_effort_estimate'],
});

const sameDistinctOracle = (choice: 'same' | 'distinct'): VNextJevFinalStateOracle => baseOracle({
  activeWork: [
    { taskTitle: '英語', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
    { taskTitle: '英語', quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分' },
  ],
  relations: [{ kind: choice, leftTaskTitle: '英語 / target-pages', rightTaskTitle: '英語 / other-time' }],
  scheduledWorkMinutes: choice === 'same' ? [40] : [40, 30],
});

const twoWorkOracle = (choice: 'distinct' | 'keep-pages' | 'keep-minutes'): VNextJevFinalStateOracle => {
  const activeWork: VNextJevWorkOracle[] = choice === 'keep-pages'
    ? [{ taskTitle: '英語', quantityRole: 'remaining', amount: 10, unitCode: 'page', unitLabel: 'ページ' }]
    : choice === 'keep-minutes'
      ? [{ taskTitle: '英語', quantityRole: 'remaining', amount: 45, unitCode: 'minute', unitLabel: '分' }]
      : [
        { taskTitle: '英語', quantityRole: 'remaining', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
        { taskTitle: '英語', quantityRole: 'remaining', amount: 45, unitCode: 'minute', unitLabel: '分' },
      ];
  return baseOracle({ activeWork, relations: choice === 'distinct'
    ? [{ kind: 'distinct', leftTaskTitle: '英語 / pages', rightTaskTitle: '英語 / minutes' }] : [],
  scheduledWorkMinutes: choice === 'keep-pages' ? [40] : choice === 'keep-minutes' ? [45] : [40, 45] });
};

type PositiveSpec = {
  id: string; split: VNextJevComparisonSplit; shape: VNextJevMenuShape; text: string;
  choice: string | { keep: VNextJevWorkOracle }; state: VNextJevFinalStateOracle;
};

const positiveSpecs: PositiveSpec[] = [];
for (const split of ['dev', 'holdout'] as const) {
  const prefix = split === 'dev' ? 'dev' : 'hold';
  const variation = split === 'dev';
  positiveSpecs.push(
    { id: `${prefix}-remaining-progress`, split, shape: 'remaining_conflict',
      text: variation ? '計算どおり残り8枚にしてください' : '残りは8枚でお願いします',
      choice: 'remaining_follows_progress', state: remainingOracle(8, 12) },
    { id: `${prefix}-remaining-completed`, split, shape: 'remaining_conflict',
      text: variation ? '終わった量を13枚に合わせて' : '完了は13枚だったことにします',
      choice: 'completed_follows_remaining', state: remainingOracle(7, 13) },
    { id: `${prefix}-target-distinct`, split, shape: 'one_target_same_or_distinct',
      text: variation ? '別々の作業で、どちらもやります' : '同じ作業ではなく両方です',
      choice: 'distinct', state: sameDistinctOracle('distinct') },
    { id: `${prefix}-target-same`, split, shape: 'one_target_same_or_distinct',
      text: variation ? '同じ作業なので一つにまとめてください' : 'まとめて一つの作業として扱って',
      choice: 'same', state: sameDistinctOracle('same') },
    { id: `${prefix}-two-distinct`, split, shape: 'two_work_keep_or_distinct',
      text: variation ? '二つとも別々にやります' : '両方とも別の作業です',
      choice: 'distinct', state: twoWorkOracle('distinct') },
    { id: `${prefix}-two-keep-pages`, split, shape: 'two_work_keep_or_distinct',
      text: variation ? 'ページの方だけにします' : '10ページの作業だけ残してください',
      choice: { keep: { taskTitle: '英語', quantityRole: 'remaining', amount: 10, unitCode: 'page', unitLabel: 'ページ' } },
      state: twoWorkOracle('keep-pages') },
    { id: `${prefix}-two-keep-minutes`, split, shape: 'two_work_keep_or_distinct',
      text: variation ? '時間で書いた方だけ残す' : '45分の作業だけでお願いします',
      choice: { keep: { taskTitle: '英語', quantityRole: 'remaining', amount: 45, unitCode: 'minute', unitLabel: '分' } },
      state: twoWorkOracle('keep-minutes') },
  );
}

type FallbackSpec = { id: string; split: VNextJevComparisonSplit; shape: VNextJevMenuShape; text: string;
  holdoutText: string; purpose: string; state: VNextJevFinalStateOracle; oracleCorrectionReason?: string };
const fallbackSpecs: FallbackSpec[] = [];
for (const split of ['dev', 'holdout'] as const) {
  const suffix = split === 'dev' ? 'd' : 'h';
  fallbackSpecs.push(
    { id: `${suffix}-unsupported-value`, split, shape: 'remaining_conflict', text: '残りは9枚にします',
      holdoutText: '残りを9枚にしたいです',
      purpose: 'Menuにない値を勝手に近いoptionへ丸めない',
      state: { ...remainingOracle(9, 12), openQuestionCodes: ['remaining_inconsistent'] },
      oracleCorrectionReason: 'Remaining 9 conflicts with 20−12=8, so the inconsistency question must remain open.' },
    { id: `${suffix}-refusal`, split, shape: 'one_target_same_or_distinct', text: 'まだ決めたくありません',
      holdoutText: '今はどちらとも決められないです',
      purpose: '拒否・保留を選択へ変換しない', state: baseOracle({
        activeWork: [{ taskTitle: '英語', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
          { taskTitle: '英語', quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分' }],
        openQuestionCodes: ['same_or_distinct_work'],
        questionStateAlternatives: [
          { openQuestionCodes: ['same_or_distinct_work'], deferredQuestionCodes: [] },
          { openQuestionCodes: [], deferredQuestionCodes: ['same_or_distinct_work'] },
        ],
      }), oracleCorrectionReason: 'Declining to choose preserves meaning whether the question stays open or is explicitly deferred.' },
    { id: `${suffix}-new-topic`, split, shape: 'remaining_conflict', text: 'その話は後で。英語の音読を25分したいです',
      holdoutText: '数学の確認は保留して、英語の発音練習を25分追加して',
      purpose: '新しい依頼をoption回答として誤読せず、両方をfull readerへ渡す', state: baseOracle({
        activeWork: remainingOracle(7, 12).activeWork.concat([{ taskTitle: '英語の発音練習',
          taskTitleAliases: ['英語の音読', '音読', '英語', '発音練習'],
          quantityRole: 'target', amount: 25, unitCode: 'minute', unitLabel: '分' }]),
        deferredQuestionCodes: ['remaining_inconsistent'],
        scheduledWorkMinutes: [25],
      }), oracleCorrectionReason: 'The utterance defers the arithmetic conflict and adds pronunciation practice as a 25-minute target.' },
    { id: `${suffix}-unknown-defer`, split, shape: 'one_target_same_or_distinct', text: '今は分かりません',
      holdoutText: '今は答えが分からないので後回しで',
      purpose: '回答不能をtyped deferralにでき、選択や見積もりを捏造しない', state: baseOracle({
        activeWork: [{ taskTitle: '英語', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
          { taskTitle: '英語', quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分' }],
        deferredQuestionCodes: ['same_or_distinct_work'],
      }) },
    { id: `${suffix}-approval-request`, split, shape: 'remaining_conflict', text: 'これで保存していいですか？',
      holdoutText: '確認が終わったら保存までお願いできますか',
      purpose: '保存可否の質問をoption選択に変えず、未解決の矛盾を維持して保存しない', state: baseOracle({
        activeWork: remainingOracle(7, 12).activeWork, openQuestionCodes: ['remaining_inconsistent'],
      }) },
    { id: `${suffix}-mixed-deadline`, split, shape: 'remaining_conflict',
      text: '計算どおり8枚で。締切は明日です',
      holdoutText: '残り8枚を選びます。明日が期限です',
      purpose: '回答と締切の二つの意味を両方full readingに渡して保持する', state: baseOracle({
        activeWork: remainingOracle(8, 12).activeWork,
        hardDeadlines: [{ taskTitle: '数学プリント', date: '2026-11-03' }],
        openQuestionCodes: ['missing_effort_estimate'],
      }) },
    { id: `${suffix}-mixed-task`, split, shape: 'one_target_same_or_distinct',
      text: '別々にやります。あと国語の漢字を15分やりたいです',
      holdoutText: '別々でお願いします。ついでに国語の漢字を15分追加',
      purpose: '明示的なoption回答と別タスクの追加をどちらもfull readerに保持する', state: baseOracle({
        activeWork: [
          { taskTitle: '英語', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
          { taskTitle: '英語', quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分' },
          { taskTitle: '国語', taskTitleAliases: ['国語の漢字', '漢字'],
            quantityRole: 'target', amount: 15, unitCode: 'minute', unitLabel: '分' },
        ], relations: [{ kind: 'distinct', leftTaskTitle: '英語 / target-pages', rightTaskTitle: '英語 / other-time' }],
        scheduledWorkMinutes: [40, 30, 15],
      }), oracleCorrectionReason: 'An added 15-minute item is a target, and 国語 and 国語の漢字 name the same subject.' },
    { id: `${suffix}-mixed-correction`, split, shape: 'one_target_same_or_distinct',
      text: '別々の作業です。音読は35分ではなく30分でした',
      holdoutText: '別々だね。音読は30分じゃなく、35分だった',
      purpose: 'optionに合致する明示回答と既存work量の訂正の両方を保持する', state: baseOracle({
        activeWork: [
          { taskTitle: '英語', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
          { taskTitle: '英語', quantityRole: 'remaining', amount: split === 'holdout' ? 35 : 30, unitCode: 'minute', unitLabel: '分' },
        ], relations: [{ kind: 'distinct', leftTaskTitle: '英語 / target-pages', rightTaskTitle: '英語 / other-time' }],
        scheduledWorkMinutes: split === 'holdout' ? [40, 35] : [40, 30],
      }), oracleCorrectionReason: split === 'holdout'
        ? 'The frozen text corrects the seeded 35 minutes to 35 and explicitly rejects 30.' : undefined },
    { id: `${suffix}-ambiguous`, split, shape: 'two_work_keep_or_distinct', text: 'どっちでもいいと思います',
      holdoutText: 'どちらかと言えば、たぶん両方かな',
      purpose: split === 'holdout'
        ? 'A hedged affirmative says both works remain distinct; it no longer represents a truly ambiguous holdout.'
        : '曖昧な選好を低確信のままfull readingに送り、どのworkも消さない',
      state: split === 'holdout' ? twoWorkOracle('distinct') : baseOracle({
        activeWork: [
          { taskTitle: '英語', quantityRole: 'remaining', amount: 10, unitCode: 'page', unitLabel: 'ページ' },
          { taskTitle: '英語', quantityRole: 'remaining', amount: 45, unitCode: 'minute', unitLabel: '分' },
        ], openQuestionCodes: ['same_or_distinct_work'],
      }),
      oracleCorrectionReason: split === 'holdout'
        ? 'The holdout hedges but affirms both, so distinct is supported; this is no longer a truly ambiguous instance.' : undefined },
  );
}

function seedFor(shape: VNextJevMenuShape) {
  switch (shape) {
    case 'remaining_conflict': return remainingConflictSeed();
    case 'one_target_same_or_distinct': return oneTargetSeed();
    case 'two_work_keep_or_distinct': return twoWorkSeed();
  }
}

function seedForCase(spec: { id: string; shape: VNextJevMenuShape }) {
  return spec.id.endsWith('mixed-correction') ? oneTargetCorrectionSeed() : seedFor(spec.shape);
}

const positivePurpose: Record<VNextJevMenuShape, string> = {
  remaining_conflict: 'User explicitly selects one of the displayed arithmetic reconciliation choices.',
  one_target_same_or_distinct: 'User explicitly says whether the target and the other workload are one work or two.',
  two_work_keep_or_distinct: 'User explicitly selects distinct work or identifies which stated work to retain.',
};

export const VNEXT_JEV_COMPARISON_CASES: readonly VNextJevComparisonCase[] = [
  ...positiveSpecs.map((spec): VNextJevComparisonCase => ({
    id: spec.id, split: spec.split, menuShape: spec.shape, purpose: positivePurpose[spec.shape],
    reachablePath: `A VNext reply is waiting on the ${spec.shape} menu, and the user answers it in ordinary Japanese.`,
    responsibility: 'Jev_closed_choice', seed: seedFor(spec.shape), userText: spec.text,
    expectedRoute: 'option_choice', expectedChoice: spec.choice, finalState: spec.state,
  })),
  ...fallbackSpecs.map((spec): VNextJevComparisonCase => ({
    id: spec.id, split: spec.split, menuShape: spec.shape,
    purpose: spec.purpose,
    reachablePath: `The session has an open ${spec.shape} question and the user sends this plausible reply.`,
    responsibility: 'Luna_full_semantic_reading', seed: seedForCase(spec),
    userText: spec.split === 'holdout' ? spec.holdoutText : spec.text,
    expectedRoute: 'full_reading', expectedChoice: null, finalState: spec.state,
    oracleCorrectionReason: spec.oracleCorrectionReason,
  })),
];

/** Dev-only export for the separate raw-score collector. It contains no holdout utterances or oracles. */
export const VNEXT_JEV_COMPARISON_DEV_CASES: readonly VNextJevComparisonCase[] = VNEXT_JEV_COMPARISON_CASES
  .filter((testCase) => testCase.split === 'dev');

/** SHA-256 over the exact dev-only `${id}\\t${split}\\t${userText}` manifest. */
export const VNEXT_JEV_COMPARISON_DEV_CASES_SHA256 = 'b5e1cf376fcdd8a0d53e54316a64a80e886cb9c9c6ff49cf2f1ccc5559dfad14';

/** SHA-256 of UTF-8 lines `${id}\t${split}\t${userText}` in corpus order, with a final newline. */
export const VNEXT_JEV_COMPARISON_SPLIT_SHA256 = '52d08024c56a0805e6192989c426fb0fe3a34ff82b09ba0ce5c1e4da9621805d';

