import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5CommunicationGoal,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5QuestionPurpose,
} from './weeklyPlanningStableV5DialogueContracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayField(
  value: Record<string, unknown> | null,
  key: string,
): unknown[] {
  const field = value?.[key];
  return Array.isArray(field) ? field : [];
}

function createAcceptedFacts(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!planningInformation) return null;
  return Object.fromEntries(
    Object.entries(planningInformation)
      .filter(([key]) => key !== 'uncertainties' && key !== 'groundingRecords'),
  );
}

function groundingContext(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown>[] {
  return arrayField(planningInformation, 'groundingRecords')
    .filter(isRecord)
    .filter((record) => record.status !== 'rejected');
}

function unresolvedWorkloadFields(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown>[] {
  return arrayField(planningInformation, 'workloads')
    .filter(isRecord)
    .filter((workload) => workload.quantityRole === 'unknown')
    .map((workload) => ({
      kind: 'workload_field',
      taskId: workload.taskId ?? null,
      componentId: workload.componentId ?? null,
      field: 'quantityRole',
      knownAmount: workload.amount ?? null,
      knownUnitLabel: workload.unitLabel ?? null,
    }));
}

function resolutionPendingDeclarations(
  planningInformation: Record<string, unknown> | null,
  key: 'availabilityDeclarations' | 'constraintSourceRequests',
): Record<string, unknown>[] {
  return arrayField(planningInformation, key)
    .filter(isRecord)
    .filter((entry) => entry.resolutionStatus === 'unresolved')
    .map((entry) => ({ sourceCollection: key, ...entry }));
}

export function createWeeklyPlanningStableV5DialogueStateSummary(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): Record<string, unknown> {
  const planningInformation = input.planningInformation;
  return {
    acceptedFacts: createAcceptedFacts(planningInformation),
    groundingContext: groundingContext(planningInformation),
    resolutionPendingItems: [
      ...arrayField(planningInformation, 'uncertainties'),
      ...unresolvedWorkloadFields(planningInformation),
      ...resolutionPendingDeclarations(planningInformation, 'availabilityDeclarations'),
      ...resolutionPendingDeclarations(planningInformation, 'constraintSourceRequests'),
    ],
  };
}

const LEGACY_SYSTEM_PROMPT = [
  'あなたは学習計画アプリの対話担当です。アプリが決めた意味と次の行為を変えず、継続中の相談として自然な日本語にしてください。',
  '入力にない具体情報は補わず、受理済みの情報を確認し直す質問も勝手に追加しないでください。',
  '新しく受理した情報を扱った直後に別の未解決質問へ戻る場合は、その理解を短く観察可能にしてから自然につないでください。',
  '質問では一度に一つだけ確認してください。',
].join('\n');

/**
 * Interaction architecture (Issue #488): the application decides WHAT this reply must do
 * (`applicationDecision.communication`); the renderer only decides HOW to say it, as a person
 * helping with a study plan, never as a report of the system's internals.
 */
const INTERACTION_SYSTEM_PROMPT = [
  'あなたは学習計画アプリで、ユーザーの勉強の予定づくりを手伝う相手です。applicationDecision.communicationが決めた伝える内容と次の行為は変えず、言い方だけを自然な会話の日本語で決めてください。',
  '最初の一文で、ユーザーがいま言ったことに直接応えてください。',
  'アプリ内部の仕組みや処理（データの整理、検証、状態、保留、接続、再試行など）には触れず、処理できた・できなかったという報告や断り書きも書かないでください。',
  '入力にない具体情報は補わず、質問は一度に一つ、短く自然にしてください。',
].join('\n');

/**
 * Meaning of the machine-owned purpose codes, for the renderer only (instructions, not
 * user-facing text). The renderer explains the reason in its own words.
 */
const QUESTION_PURPOSE_MEANINGS: Readonly<Record<WeeklyPlanningStableV5QuestionPurpose, string>> = {
  estimate_time_to_fit_available_time: 'how long the work takes, so it can be spread over the free time in the planning period without overloading any day',
  set_session_length: 'how long one study session should be, so the work can be split into sessions',
  skip_already_finished_work: 'how much is already done, so only the remaining part is scheduled',
  choose_scope_for_this_plan: 'how much of the remaining material to cover in this plan (saved progress is already known)',
  identify_work_to_schedule: 'what study work to put into the schedule',
  find_more_work_or_constraints: 'other work or conditions to add, because the requested work is already finished',
  identify_which_work_and_how_much: 'which material or part the stated amount refers to and how big it is, so the right work is scheduled in the right amount',
  resolve_unclear_detail: 'which meaning was intended for a detail that can be read in more than one way, so the wrong thing is not scheduled',
  set_planning_period: 'which days the plan should cover',
  choose_one_planning_period: 'which of the mentioned periods to plan for',
  tell_plan_amount_from_remaining_total: 'whether the amount is what to do in this plan or everything that remains, because that changes how much is scheduled',
  choose_one_time_estimate: 'which of the stated time estimates to use',
  apply_time_limits_to_right_days: 'which days a time limit applies to, so study avoids the right days',
  know_exact_time_range: 'the start and end time, so study can be placed around it',
  place_fixed_commitment: 'when a fixed commitment happens, so study stays clear of it',
  resolve_conflicting_day_rule: 'whether a day is allowed or excluded, because both were stated',
  avoid_existing_commitments: 'which existing schedule to treat as busy time',
  order_tasks_correctly: 'which tasks a stated order refers to',
  decide_on_study_method_suggestion: 'whether to adopt a suggested study method; it is used only if accepted',
  make_the_plan_fit_available_time: 'how to make all the work fit: a longer period, less work, or more free time',
  complete_planning_information: 'a detail the plan still needs',
};

function purposeMeanings(
  communication: WeeklyPlanningStableV5CommunicationContext,
): Record<string, string> {
  return Object.fromEntries(
    [...new Set([...communication.questionPurposes, ...communication.laterNeeds])]
      .map((purpose) => [purpose, QUESTION_PURPOSE_MEANINGS[purpose]]),
  );
}

const SHARED_DECISION_INSTRUCTION = 'applicationDecisionをsource of truthとして守り、自然な日本語を一つ返してください。preview_readyになる前は、予定・仮予定・計画への追加、登録、保存、反映、作成が完了または実行されると断言しないでください。';
const SHARED_FACT_INSTRUCTIONS = [
  'acceptedFactsは会話上受理済みのFactです。resolutionPendingItemsはscheduler等で追加解決が必要な項目であり、そこに同じFactが現れてもユーザー発話自体が未受理という意味ではありません。',
  'currentTurnGrounding.acceptedFactsはこのturnで新たに受理したFactです。required_before_resumeでは会話上重要なFactを短くACKしてから質問へ戻し、groundingAcknowledgementにそのfactIdとACK本文を入れ、最終textをその本文から始めてください。ACK対象Factに時刻・日付・数量などユーザーが明示した具体値がある場合は、その具体値を省略せずACK本文にも残してください。recommendedは必要な場合だけ、noneはgroundingAcknowledgement=nullとし定型ACKを足さないでください。受理済みFactを再確認質問にしないでください。',
  '質問はquestionTarget/questionIntentの対象、requestedInformation、allowedChoices、measurement、mode、progressBasisを別の概念へ置き換えず、一つだけ聞いてください。questionCodeだけから目的を推測し直さないでください。',
];
const SCHEDULABLE_WORK_INSTRUCTION = 'schedulable_work_detailはmode/progressBasis厳守。existing_target_progress=現在進捗のみ、別作業は聞かない。registered_material_target_scope=保存済みtotal/current/remainingを再質問せず、knownUnitLabelのまま短く示し、今回が残り全部か別範囲かだけ聞く。known_bounded_quantityのみknownUnitLabel数量可。known_registered_material_progressは保存値/単位をそのまま使用。completion_progress_without_known_unitは具体的な単位/総量を発明せず、100%概算や工程を聞く。ユーザー提示単位を優先。missing_task_identity=作業自体。all_requested_work_complete=完了済みとして同じ進捗を聞き直さず、追加作業/制約だけ聞く。';
const EFFORT_MEASUREMENT_INSTRUCTION = 'effort_measurementのmeasurementを変えないでください。duration_per_unit=1単位あたり、session_duration=1回、total_duration=全体です。';
const RESOLUTION_QUESTION_INSTRUCTION = 'resolution_questionのquantity_roleではplan_target_amount=今回この計画で進めたい量、remaining_total_amount=現在残っている全体量です。全体量対1回分など別の軸へ変えないでください。task_relation_referenceは関係の両端にあるタスクを特定するための質問であり、順序の承認、登録、予定への反映、新規タスク追加を求めないでください。task_relation_self_referenceは同一タスク同士になっている関係を修復するため、異なる二つの対象を聞いてください。';
const PREVIEW_AND_GROUNDING_INSTRUCTION = 'previewPromotionControlLabelがあれば候補は生成済みです。その操作を案内してください。groundingContextのproposedは短く示し確認質問を足さず、contestedは断言しないでください。';
const SHARED_QUESTION_KIND_INSTRUCTIONS = [
  SCHEDULABLE_WORK_INSTRUCTION,
  EFFORT_MEASUREMENT_INSTRUCTION,
  RESOLUTION_QUESTION_INSTRUCTION,
  PREVIEW_AND_GROUNDING_INSTRUCTION,
];

/** Interaction architecture: only the rule of the typed question kind of this reply. */
function interactionQuestionKindInstructions(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): string[] {
  const kind = input.questionIntent?.kind;
  return [
    ...(kind === 'schedulable_work_detail' ? [SCHEDULABLE_WORK_INSTRUCTION] : []),
    ...(kind === 'effort_measurement' ? [EFFORT_MEASUREMENT_INSTRUCTION] : []),
    ...(kind === 'resolution_question' ? [RESOLUTION_QUESTION_INSTRUCTION] : []),
    PREVIEW_AND_GROUNDING_INSTRUCTION,
  ];
}

/** Legacy architecture (verbatim pre-#488): the renderer itself decides from the raw message. */
const LEGACY_EXPLANATION_INSTRUCTION = 'currentUserMessageが直前の質問の意味・理由・何を答えるべきかを尋ねている場合は、同じ質問を繰り返さずquestionIntentの目的を短く説明してください。その際もrequestedInformationに複数の必要情報があるなら一部を落とさず、同じ一つの確認として全部を分かるようにしてください。';

const INTERACTION_GOAL_INSTRUCTION = 'communication.goalはアプリが決めたこの返答の目的です。currentUserMessageから目的を推測し直さないでください。';

/** Only the instruction of the typed goal of this reply is sent (selected by the goal code). */
const INTERACTION_GOAL_INSTRUCTIONS: Readonly<Record<WeeklyPlanningStableV5CommunicationGoal, string>> = {
  ask_question: 'goal=ask_question: questionIntentの質問を一つ聞く。このturnで受け取った情報があれば先に短く受け止める。',
  report_status: 'goal=report_status: statusReason=ready_to_create_preview→予定を作るのに必要なことはそろい、頼めば仮予定を作れると伝える（「この条件で予定を作って」のように頼めると添えてよい）。preview_unchanged→今の仮予定の候補はそのままで、直したい点を言うかpreviewPromotionControlLabelの操作で進められると伝える。',
  present_preview: 'goal=present_preview: previewCount件の候補ができたことと、previewPromotionControlLabelの操作を案内する。',
  explain_question: 'goal=explain_question: ユーザーは直前の質問の理由や意味を尋ねている。最初に（required_before_resumeならACKのすぐ後に）、なぜその情報が必要かをquestionPurposes（意味はpurposeMeanings）と分かっている内容（relevantLabels・量・期間など）に沿って具体的に答える。ユーザーの思う質問の中身が実際と違えば、いま確かめたいことを穏やかに伝える。laterNeedsは疑問への答えに役立つときだけ触れてよい。そのあとaskQuestion=trueなら、同じ質問をrequestedInformationを落とさず、直前と同じ文面にせず一度だけ聞く。',
  acknowledge_aside: 'goal=acknowledge_aside: ユーザーが移った別の話題に自然に応じる。止まっている質問は聞かず、保留や未変更の説明もしない。',
  resume_question: 'goal=resume_question: その話題に自然に戻り、その質問を一つ聞く。',
  clarify_turn: 'goal=clarify_turn: このメッセージはいまの形では予定に使えず、予定には何も加わっていない。理由やアプリの事情は言わず、うまく受け取れなかったことを短く自然に伝え、askQuestion=trueならその質問を、falseなら何を予定に入れたいかを聞く。同じ文面の再送は頼まない。',
};

function interactionCommunicationInstructions(
  communication: WeeklyPlanningStableV5CommunicationContext | null,
  hasSelfRepair: boolean,
): string[] {
  if (!communication) return [INTERACTION_GOAL_INSTRUCTION];
  return [
    INTERACTION_GOAL_INSTRUCTION,
    INTERACTION_GOAL_INSTRUCTIONS[communication.goal],
    ...(hasSelfRepair
      ? ['acceptedFacts.selfRepairはユーザーがこのturnで訂正した内容（before→after）。最初に短く自然に受け止めてから続ける。']
      : []),
    ...(communication.previewDisclosure
      ? ['previewDisclosure: omittedWorkLabelsをすべて名前で挙げ、空き時間に入りきらず今回の候補には入れていないとはっきり伝える。']
      : []),
    ...(communication.planningDetailsNotApplied
      ? ['planningDetailsNotApplied=true: このメッセージにあった予定の内容は取り込めていない。理由は言わず、変えたいことがあればもう一度教えてほしいと一文添える。']
      : []),
    ...(communication.consultationDeferred
      ? ['consultationDeferred=true: 助言・相談への回答は今回は行っていないと一文で伝え、助言内容や数値判断を発明しない。']
      : []),
  ];
}

export function createWeeklyPlanningStableV5DialoguePrompt(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): { systemPrompt: string; userPrompt: string } {
  const interactionOutcome = conversationArchitecturePolicy(input.conversationArchitecture)
    .interactionOutcome;
  const communication = interactionOutcome ? input.communication ?? null : null;

  const userPrompt = JSON.stringify({
    actionId: input.actionId,
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    currentTurnGrounding: input.currentTurnGrounding ?? { mode: 'none', acceptedFacts: [] },
    planningStateSummary: createWeeklyPlanningStableV5DialogueStateSummary(input),
    applicationDecision: {
      actionKind: input.actionKind,
      questionCode: input.questionCode,
      questionTarget: input.questionTarget ?? null,
      questionIntent: input.questionIntent ?? null,
      previewPromotionControlLabel: input.previewPromotionControlLabel ?? null,
      ...(interactionOutcome
        ? {
            communication,
            purposeMeanings: communication ? purposeMeanings(communication) : {},
          }
        : {}),
      relevantLabels: input.requiredLabels,
      previewCount: input.previewCount,
    },
    request: [
      SHARED_DECISION_INSTRUCTION,
      ...SHARED_FACT_INSTRUCTIONS,
      ...(interactionOutcome
        ? interactionCommunicationInstructions(
            communication,
            isRecord(input.planningInformation) && isRecord(input.planningInformation.selfRepair),
          )
        : [LEGACY_EXPLANATION_INSTRUCTION]),
      ...(interactionOutcome
        ? interactionQuestionKindInstructions(input)
        : SHARED_QUESTION_KIND_INSTRUCTIONS),
    ].join(''),
  });

  return {
    systemPrompt: interactionOutcome ? INTERACTION_SYSTEM_PROMPT : LEGACY_SYSTEM_PROMPT,
    userPrompt,
  };
}
