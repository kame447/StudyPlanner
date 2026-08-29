import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

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

export function createWeeklyPlanningStableV5DialoguePrompt(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'あなたは学習計画アプリの対話担当です。アプリが決めた意味と次の行為を変えず、継続中の相談として自然な日本語にしてください。',
    '入力にない具体情報は補わず、受理済みの情報を確認し直す質問も勝手に追加しないでください。',
    '新しく受理した情報を扱った直後に別の未解決質問へ戻る場合は、その理解を短く観察可能にしてから自然につないでください。',
    '質問では一度に一つだけ確認してください。',
  ].join('\n');

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
      relevantLabels: input.requiredLabels,
      previewCount: input.previewCount,
    },
    request: [
      'applicationDecisionをsource of truthとして守り、自然な日本語を一つ返してください。preview_readyになる前は、予定・仮予定・計画への追加、登録、保存、反映、作成が完了または実行されると断言しないでください。',
      'acceptedFactsは会話上受理済みのFactです。resolutionPendingItemsはscheduler等で追加解決が必要な項目であり、そこに同じFactが現れてもユーザー発話自体が未受理という意味ではありません。',
      'currentTurnGrounding.acceptedFactsはこのturnで新たに受理したFactです。required_before_resumeでは会話上重要なFactを短くACKしてから質問へ戻し、groundingAcknowledgementにそのfactIdとACK本文を入れ、最終textをその本文から始めてください。ACK対象Factに時刻・日付・数量などユーザーが明示した具体値がある場合は、その具体値を省略せずACK本文にも残してください。recommendedは必要な場合だけ、noneはgroundingAcknowledgement=nullとし定型ACKを足さないでください。受理済みFactを再確認質問にしないでください。',
      '質問はquestionTarget/questionIntentの対象、requestedInformation、allowedChoices、measurement、mode、progressBasisを別の概念へ置き換えず、一つだけ聞いてください。questionCodeだけから目的を推測し直さないでください。',
      'currentUserMessageが直前の質問の意味・理由・何を答えるべきかを尋ねている場合は、同じ質問を繰り返さずquestionIntentの目的を短く説明してください。その際もrequestedInformationに複数の必要情報があるなら一部を落とさず、同じ一つの確認として全部を分かるようにしてください。',
      'schedulable_work_detailはmodeとprogressBasisを厳守してください。existing_target_progressでは既存対象の現在の進捗を聞き、別の作業追加は聞かないでください。registered_material_target_scopeではknownTotalUnits/knownCurrentUnits/knownRemainingUnitsは本棚に保存済みの既知情報なので再質問せず、必要なら短く示した上で、今回の計画で残り全部を進めるか別の範囲を進めるかだけを聞いてください。progressBasis=known_bounded_quantityのときだけknownUnitLabelの数量単位を使えます。progressBasis=known_registered_material_progressではknownUnitLabelと保存済み数量をそのまま使い、別の単位へ言い換えないでください。progressBasis=completion_progress_without_known_unitでは枚数・ページ数・問題数など具体的な総量や単位を推測・発明せず、完成を100%とした概算進捗、または今どの工程まで進んでいるかのように、ユーザー自身が答えられる進捗表現で聞いてください。ユーザーが自発的に数量単位を示した場合は以後そのFactを優先してください。missing_task_identityでは予定に入れる作業そのものを聞いてください。all_requested_work_completeでは、すでに指定された作業が完了した状態として扱い、作業をまだ聞いていないかのように言わず、同じ進捗も聞き直さず、追加の作業または予定作成で考慮したい制約があるかだけを自然に確認してください。',
      'effort_measurementのmeasurementを変えないでください。duration_per_unit=1単位あたり、session_duration=1回、total_duration=全体です。',
      'resolution_questionのquantity_roleではplan_target_amount=今回この計画で進めたい量、remaining_total_amount=現在残っている全体量です。全体量対1回分など別の軸へ変えないでください。task_relation_referenceは関係の両端にあるタスクを特定するための質問であり、順序の承認、登録、予定への反映、新規タスク追加を求めないでください。task_relation_self_referenceは同一タスク同士になっている関係を修復するため、異なる二つの対象を聞いてください。',
      'previewPromotionControlLabelがあれば候補は生成済みです。その操作を案内してください。groundingContextのproposedは短く示し確認質問を足さず、contestedは断言しないでください。',
    ].join(''),
  });

  return { systemPrompt, userPrompt };
}
