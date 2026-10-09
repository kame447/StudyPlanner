import { ADD_SCHEDULE_CONTROL_LABEL } from '../../../components/quickAddMenuLabels';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5CommunicationGoal,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueQuestionIntent,
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
  'ACK only typed acceptedFacts. Unaccepted user times/days/amounts may be queried, never echoed as received.',
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
  identify_work_to_schedule: 'what the user wants to study',
  find_more_work_or_constraints: 'anything else to study or any schedule to consider; the requested study is already finished',
  identify_which_work_and_how_much: 'which material or part the stated amount refers to and how big it is, so the right work is scheduled in the right amount',
  resolve_unclear_detail: 'which meaning was intended for a detail that can be read in more than one way, so the wrong thing is not scheduled',
  confirm_open_point: 'a point the user mentioned is still open; the user may state it, or tell the plan to go ahead as it is. Never say the point was answered or that the plan can work',
  set_planning_period: 'which days the plan should cover',
  choose_one_planning_period: 'which of the mentioned periods to plan for',
  tell_plan_amount_from_remaining_total: 'whether the amount is what to do in this plan or everything that remains, because that changes how much is scheduled',
  tell_plan_amount_from_completed_amount: 'whether the amount is what to do in this plan or work already done, because that changes how much is scheduled',
  choose_one_time_estimate: 'which of the stated time estimates to use',
  apply_time_limits_to_right_days: 'which days a time limit applies to, so study avoids the right days',
  know_exact_time_range: 'the start and end time, so study can be placed around it',
  confirm_existing_schedule: 'confirm existing scheduled events; ask about schedules, not study tasks',
  register_event: 'clarify which event the user wants to add; no registration has occurred',
  clarify_schedule_request: 'clarify what kind of schedule the user wants; study work is not assumed',
  place_fixed_commitment: 'when a fixed commitment happens, so study stays clear of it',
  resolve_conflicting_day_rule: 'whether a day is allowed or excluded, because both were stated',
  avoid_existing_commitments: 'which existing schedule to treat as busy time',
  order_tasks_correctly: 'which tasks a stated order refers to',
  decide_on_study_method_suggestion: 'whether to adopt a suggested study method; it is used only if accepted',
  make_the_plan_fit_available_time: 'how to make all the work fit: a longer period, less work, or more free time',
  count_in_whole_units: 'the amount in whole units (for example whole problems), because the work is scheduled unit by unit',
  link_detail_to_its_task: 'which task a stated detail belongs to, so it is applied to the right work',
  use_dates_the_plan_can_read: 'a date, day or time that fits the planning period, because the stated one cannot be used as it is',
  know_how_strict_a_condition_is: 'whether a condition must always hold or is only a preference, because that changes how strictly it is kept',
  set_daily_study_limit: 'how much time per day can go to study, so no day is overloaded',
  resolve_conflicting_dates: 'which of two date limits that contradict each other is meant',
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
const INTERACTION_FACT_INSTRUCTIONS = [
  'acceptedFacts received; resolutionPendingItems need scheduling details, not re-acceptance.',
  ...SHARED_FACT_INSTRUCTIONS.slice(1),
];
const SCHEDULABLE_WORK_INSTRUCTION = 'schedulable_work_detailはmode/progressBasis厳守。existing_target_progress=現在進捗のみ、別作業は聞かない。registered_material_target_scope=保存済みtotal/current/remainingを再質問せず、knownUnitLabelのまま短く示し、今回が残り全部か別範囲かだけ聞く。known_bounded_quantityのみknownUnitLabel数量可。known_registered_material_progressは保存値/単位をそのまま使用。completion_progress_without_known_unitは具体的な単位/総量を発明せず、100%概算や工程を聞く。ユーザー提示単位を優先。missing_task_identity=作業自体。all_requested_work_complete=完了済みとして同じ進捗を聞き直さず、追加作業/制約だけ聞く。';
/** Keep the shared historical rule above byte-identical for legacy requests. */
const INTERACTION_SCHEDULABLE_MODE_INSTRUCTIONS = {
  existing_target_progress: 'existing_target_progress=現在進捗のみ、別の内容は聞かない。',
  registered_material_target_scope: 'registered_material_target_scope=保存済みtotal/current/remainingをknownUnitLabelで示し、今回は残り全部か別範囲かだけ聞く。保存済み進捗は再質問しない。',
  missing_task_identity: 'missing_task_identity=勉強したい内容。',
  all_requested_work_complete: 'all_requested_work_complete=完了済みとして同じ進捗を聞き直さず、追加の勉強内容/予定だけ聞く。',
};
const INTERACTION_PROGRESS_BASIS_INSTRUCTIONS = {
  known_registered_material_progress: 'known_registered_material_progressは保存値/単位をそのまま使用し再質問しない。',
  known_bounded_quantity: 'known_bounded_quantityのみknownUnitLabel数量可。',
  completion_progress_without_known_unit: 'completion_progress_without_known_unitは具体的な単位/総量を発明せず100%概算や工程を聞く。',
};

function interactionSchedulableWorkInstructions(
  intent: Extract<WeeklyPlanningStableV5DialogueQuestionIntent, { kind: 'schedulable_work_detail' }>,
): string[] {
  return [
    'schedulable_work_detail: mode/progressBasis厳守。提示単位を優先。',
    INTERACTION_SCHEDULABLE_MODE_INSTRUCTIONS[intent.mode],
    ...(intent.progressBasis ? [INTERACTION_PROGRESS_BASIS_INSTRUCTIONS[intent.progressBasis]] : []),
  ];
}
const INTERACTION_QUESTION_WORDING_INSTRUCTION = 'Wording follows typed purpose, never raw text. 日付/時刻/量の必須質問を保つ。「作業/学習タスク/schedulable_work/task identity」は会話に出さない。';
const SCHEDULE_QUESTION_WORDING_INSTRUCTION = 'confirm_existing_schedule=「どんな予定がありますか？」、register_event=「どんな予定を入れたいですか？」、identify_study_work/identify_work_to_schedule=「何を勉強したいですか？」、clarify_schedule_request=予定の希望。例文は固定しない。';
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
    INTERACTION_QUESTION_WORDING_INSTRUCTION,
    ...(kind === 'schedule_request' ? [SCHEDULE_QUESTION_WORDING_INSTRUCTION,
      'schedule_request: purposeを守り、勉強を前提にしない。追加/保存完了を主張しない。'] : []),
    ...(input.questionIntent?.kind === 'schedulable_work_detail'
      ? interactionSchedulableWorkInstructions(input.questionIntent) : []),
    ...(kind === 'effort_measurement' ? [EFFORT_MEASUREMENT_INSTRUCTION] : []),
    ...(kind === 'resolution_question' ? [RESOLUTION_QUESTION_INSTRUCTION] : []),
    ...(input.questionIntent?.kind === 'resolution_question'
      && (input.questionIntent.allowedChoices as readonly string[]).includes('completed_amount')
      ? ['completed_amount=すでに終わった量。'] : []),
    PREVIEW_AND_GROUNDING_INSTRUCTION,
  ];
}

/** Legacy architecture (verbatim pre-#488): the renderer itself decides from the raw message. */
const LEGACY_EXPLANATION_INSTRUCTION = 'currentUserMessageが直前の質問の意味・理由・何を答えるべきかを尋ねている場合は、同じ質問を繰り返さずquestionIntentの目的を短く説明してください。その際もrequestedInformationに複数の必要情報があるなら一部を落とさず、同じ一つの確認として全部を分かるようにしてください。';

const INTERACTION_GOAL_INSTRUCTION = 'communication.goalはアプリが決めたこの返答の目的です。currentUserMessageから目的を推測し直さないでください。';

/** Only the instruction of the typed goal of this reply is sent (selected by the goal code). */
const INTERACTION_GOAL_INSTRUCTIONS: Readonly<Record<WeeklyPlanningStableV5CommunicationGoal, string>> = {
  ask_question: 'goal=ask_question: questionIntentの質問を一つ聞く。このturnで受け取った情報があれば先に短く受け止める。',
  report_status: 'goal=report_status: このturnで受け取った情報があれば先に短く受け止める。statusReason=ready_to_create_preview→予定を作るのに必要なことはそろい、頼めば仮予定を作れると伝える。preview_unchanged→今の仮予定の候補はそのままで、直したい点を言うかpreviewPromotionControlLabelの操作で進められると伝える。新しい候補ができた・候補が変わったとは書かず、候補の中身も書かない。',
  present_preview: 'goal=present_preview: ACK details. previewCount counts blocks in ONE preview: say 候補N件, never N個/つのプレビュー or N案. Announce previewPromotionControlLabel. 候補の日時・回数・時間帯など中身は書かず、条件どおりとも言わない。',
  explain_question: 'goal=explain_question: 直前の質問の理由・意味に、questionPurposes/purposeMeaningsと既知の量・期間・relevantLabelsに沿ってまず具体的に答える（required_before_resumeならACKの後）。質問の誤解は穏やかに正す。laterNeedsは説明に役立つときだけ使う。askQuestion=trueならrequestedInformationを落とさず、直前と同じ文面を避けて同じ質問を一度聞く。',
  acknowledge_aside: 'goal=acknowledge_aside: ユーザーが移った別の話題に自然に応じる。止まっている質問は聞かず、保留や未変更の説明もしない。',
  resume_question: 'goal=resume_question: その話題に自然に戻り、その質問を一つ聞く。',
  clarify_turn: 'goal=clarify_turn: このメッセージは予定づくりに使えなかった。そのことの報告や理由、アプリの事情は書かず、うまく受け取れなかったことを短く自然に伝える（聞き返す形でもよい）。依頼の内容や実現できるかどうかには触れない（「進められません」等と言わない）。askQuestion=trueならその質問を聞く。falseなら、ユーザーがすでに言った教材・量・期間などを聞き直す質問はせず、伝えたいことを少しずつ分けて教えてほしいと頼む。同じ文面の再送は頼まない。',
};

const RETAINED_PREVIEW_RECOVERY_INSTRUCTION = 'goal=clarify_turn: Briefly say the change could not be used. Do not describe the current candidates or preview; the application states that beside your reply. Say nothing about the content of the request or whether it is possible. Invite the specific edit, never splitting/rephrasing. askQuestion=true keeps that required question instead.';

function interactionCommunicationInstructions(
  communication: WeeklyPlanningStableV5CommunicationContext | null,
  hasSelfRepair: boolean,
  hasRemovals: boolean,
  previewCount: number,
): string[] {
  if (!communication) return [INTERACTION_GOAL_INSTRUCTION];
  return [
    INTERACTION_GOAL_INSTRUCTION,
    communication.goal === 'clarify_turn' && communication.retainedPreviewUnchanged
      ? RETAINED_PREVIEW_RECOVERY_INSTRUCTION : INTERACTION_GOAL_INSTRUCTIONS[communication.goal],
    // One block is the typed fact; a split the user asked for is not represented, so the reply must not echo it (live X5).
    ...(communication.goal === 'present_preview' && previewCount === 1
      ? ['previewCount=1: 分割・複数回に触れず、ユーザーの「分けて」等を繰り返さない。'] : []),
    ...(communication.alternativeRequiresAdoption
      ? ['alternativeRequiresAdoption=true: This trial differs from the current preview. Never name/offer the promotion control; invite the user to say if they want to adopt it.'] : []),
    ...(communication.possibleCompletenessOmission
      ? ['possibleCompletenessOmission=true: Never say everything was taken in; the application states the possible omission beside your reply.'] : []),
    ...(communication.nothingRead
      ? ['nothingRead=true: Nothing was read from the reply; the application states it beside yours. Never say it was taken in or the plan changed.'] : []),
    ...(communication.rateUnitProjected || communication.ignoredRate
      ? ['rateUnitProjected/ignoredRate: The app states the rate beside yours. Never say it was used or ignored.'] : []),
    ...(communication.statusReason === 'fixed_event_manual_entry'
      ? [`fixed_event_manual_entry: この固定予定はここでは追加・保存できない。一度だけ既存の「${ADD_SCHEDULE_CONTROL_LABEL}」から入力できると案内する。受け取った時刻等は空き時間の参考情報であり登録結果ではない。追加質問はしない。`] : []),
    ...(communication.statusReason === 'no_additional_work'
      ? ['no_additional_work: 短く受け止めて会話を閉じる。追加質問・登録案内の繰り返し・保存の主張はしない。'] : []),
    ...(communication.askQuestion ? ['askQuestion=true: One question. Choices: ask which, not 選んでください？.'] : []),
    ...(hasSelfRepair
      ? ['ACK acceptedFacts.selfRepair (this turn’s before→after correction) briefly before continuing.']
      : []),
    ...(hasRemovals
      ? ['acceptedFacts.removedThisTurnはユーザーがこのturnで取り消した内容。最初に短く自然に受け止めてから続ける（取り消したものを予定に残っているようには言わない）。']
      : []),
    ...(communication.mustConvey?.some((entry) => entry.code === 'declared_amount_waiting')
      ? ["mustConvey declared_amount_waiting: In your own words say the user's amount (their quote or the amount) is not used in the plan yet and waits for their choice: still to do, or already done. Do not say it was applied or planned with, and do not offer a preview. The reply is verified."]
      : []),
    ...(communication.planningNeeds?.length && !communication.askQuestion && !communication.mustConvey?.length
      ? ['planningNeeds: open plan items (not a question to ask now). Mention one only if it helps, in your own words; ask nothing about it; never say the plan is ready.']
      : []),
    ...(communication.calendarFree?.length
      ? ['calendarFree: free minutes per day already known from the calendar; never ask for availability it answers. planningNeeds lists what the plan still needs, in no fixed order; you may propose an amount from calendarFree instead of asking.']
      : []),
    ...(communication.askedPurposeOptions?.length
      ? ['askedPurpose: pick what your question asks.']
      : []),
    ...(communication.uncertaintyReleased
      ? ['uncertaintyReleased: The app states that one open point stays unconfirmed beside your reply. Do not say it was settled, confirmed or resolved, and do not restate it.']
      : []),
    ...(communication.mustConvey?.some((entry) => entry.code === 'shortfall')
      ? ['mustConvey shortfall: State these facts naturally in your own words: that the work did not all fit, the total minutes the plan needs (requiredMinutes), which work did not fit (use the labels as the user wrote them, with the minutes), and how many more items did not fit when moreCount is above zero; when the one unmet item is the whole plan, the total and the name are enough. Then ask the question. Do not say the plan fits, is complete, saved or applied. The reply is checked against these facts.']
      : communication.capacityShortfall
      ? ['capacityShortfall: The app states the unmet work and its amounts after your reply. Do not state amounts, minutes or a shortfall yourself; say the work did not all fit and ask the question.']
      : []),
    ...(communication.previewDisclosure
      ? ['previewDisclosure: The app states omitted work after the reply. Do not name extent=all work or claim inclusion/exclusion; announce the preview count and control only.']
      : []),
    ...(communication.previewConstraintSatisfaction?.some((entry) => entry.status !== 'satisfied')
      ? ['previewConstraintSatisfaction: Unmet/unverified overrides value ACK. Use count/control; app discloses conditions. Neutral ACK cites accepted factIds without values.']
      : []),
    ...(communication.allocationBreakdown
      ? ['allocationBreakdown: App shows estimates/margins. Never mention either in this reply, even zero margin.']
      : []),
    ...(communication.planningDetailsNotApplied
      ? ['planningDetailsNotApplied=true: Details were not accepted. Do not report acceptance, rejection or its cause; simply invite the intended change again.']
      : []),
    ...(communication.consultation
      ? consultationInstructions(communication.consultation)
      : communication.consultationDeferred
      ? ['consultationDeferred=true: その問いかけには結論を出さない（助言・可否・数値の判断は書かない）。「判断できない」「相談」などの断り方はせず、そうしたい希望や条件があればそのまま伝えてもらえれば予定に入れて考えられる、と自然に一言添える。']
      : []),
  ];
}

function consultationInstructions(consultation: NonNullable<WeeklyPlanningStableV5CommunicationContext['consultation']>): string[] {
  const uncertainty = consultation.feasibility.status === 'not_evaluated'
    ? {
        planning_details_missing: 'Explain missingQuestionCodes via purposeMeanings.',
        preview_required: 'A draft must check other commitments.',
        existing_preview_not_rechecked: 'The alternative has not been checked.',
        no_schedulable_work: 'Work to schedule still needs defining.',
        invalid_alternative: 'Clarify the proposed days before assessing them.',
        ambiguous_alternative: 'Clarify which alternative to test.',
        alternative_not_grounded: 'The proposed days still need clarification.',
        alternative_target_unavailable: 'Clarify which work the alternative concerns.',
        alternative_outside_horizon: 'The proposed days fall outside the planning period checked.',
        fixed_work_not_movable: 'The work includes fixed commitments; moving those has not been checked.',
      }[consultation.feasibility.reason]
    : consultation.assessmentScope === 'proposed_days'
      ? 'Report whether the scheduler could place the work on alternative.dates with current commitments and hard limits; this is a trial, not a changed preview.'
      : 'Report feasibility for accepted conditions; draft contents need review.';
  const next = {
    clarify_planning_details: 'Offer to clarify before drafting.',
    offer_preview: 'Offer a draft once preferences are chosen.',
    offer_preference_change: 'Invite changed conditions.',
    review_preview: 'Invite review of the draft.',
    offer_alternative_adoption: 'Offer to use these days next if the user chooses them.',
  }[consultation.nextAction];
  return [
    'consultation: Answer the side question first after ACK; never adopt/change/approve/save.',
    consultation.assessmentScope === 'proposed_days'
      ? 'Only alternative.taskLabels/dates were tested. Explain fits as a feasible trial; does_not_fit as unable to place under current constraints, not universal impossibility. Do not invent times or imply adoption.'
      : 'feasibility never proves an unaccepted alternative. workEstimates=needed minutes; dailyLimits=limits, NOT free time. No invented placement.',
    'feasibilityClaim must match text: none or evidenced fits/does_not_fit. Untested: none; no 可能/大丈夫/できます. Explain uncertainty; offer a trial draft; no blanket refusal.',
    uncertainty, next,
    'askQuestion=false: no question; true: answer then ask it.',
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
      ...(interactionOutcome ? INTERACTION_FACT_INSTRUCTIONS : SHARED_FACT_INSTRUCTIONS),
      ...(interactionOutcome
        ? interactionCommunicationInstructions(
            communication,
            isRecord(input.planningInformation) && isRecord(input.planningInformation.selfRepair),
            isRecord(input.planningInformation)
              && Array.isArray(input.planningInformation.removedThisTurn)
              && input.planningInformation.removedThisTurn.length > 0,
            input.previewCount,
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
