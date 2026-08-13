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

function isResolvedWorkload(value: unknown): boolean {
  return isRecord(value) && value.quantityRole !== 'unknown';
}

function isResolvedDeclaration(value: unknown): boolean {
  return isRecord(value) && value.resolutionStatus !== 'unresolved';
}

function createDecidedFacts(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!planningInformation) return null;

  return Object.fromEntries(
    Object.entries(planningInformation)
      .filter(([key]) => key !== 'uncertainties')
      .map(([key, value]) => {
        if (key === 'workloads' && Array.isArray(value)) {
          return [key, value.filter(isResolvedWorkload)];
        }
        if (
          (key === 'availabilityDeclarations' || key === 'constraintSourceRequests')
          && Array.isArray(value)
        ) {
          return [key, value.filter(isResolvedDeclaration)];
        }
        return [key, value];
      }),
  );
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

function unresolvedDeclarations(
  planningInformation: Record<string, unknown> | null,
  key: 'availabilityDeclarations' | 'constraintSourceRequests',
): Record<string, unknown>[] {
  return arrayField(planningInformation, key)
    .filter(isRecord)
    .filter((entry) => entry.resolutionStatus === 'unresolved')
    .map((entry) => ({
      sourceCollection: key,
      ...entry,
    }));
}

export function createWeeklyPlanningStableV5DialogueStateSummary(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): Record<string, unknown> {
  const planningInformation = input.planningInformation;

  return {
    decidedFacts: createDecidedFacts(planningInformation),
    undecidedItems: [
      ...arrayField(planningInformation, 'uncertainties'),
      ...unresolvedWorkloadFields(planningInformation),
      ...unresolvedDeclarations(planningInformation, 'availabilityDeclarations'),
      ...unresolvedDeclarations(planningInformation, 'constraintSourceRequests'),
    ],
  };
}

export function createWeeklyPlanningStableV5DialoguePrompt(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは学習計画アプリの対話担当です。',
    '会話とアプリ状態に基づいて、次の自然な日本語を返してください。',
    '内部状態や入力フォームを埋めさせるような聞き方ではなく、相談相手として自然に一つずつ確認してください。',
    '一度に複数の独立した回答を要求せず、現在のユーザーが答えやすい一つの確認を優先してください。',
    '入力にない具体情報は、例としても補わないでください。',
    '指定されたJSON形式とaction識別子を変更しないでください。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    actionId: input.actionId,
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningStateSummary: createWeeklyPlanningStableV5DialogueStateSummary(input),
    applicationDecision: {
      actionKind: input.actionKind,
      questionCode: input.questionCode,
      relevantLabels: input.requiredLabels,
      referenceResponse: input.fallbackText,
      previewCount: input.previewCount,
    },
    request: [
      '現在のユーザーに返す自然な日本語を一つ作成してください。',
      'actionId、actionKind、questionCodeはapplicationDecisionどおりに返してください。',
      'decidedFactsは確定情報、undecidedItemsは確認が必要な情報です。referenceResponseはアプリが必要としている確認意図の参考であり、文型・列挙順・語句をコピーする必要はありません。',
      'undecidedItemsにfieldがwork_breakdownの項目がある場合だけ、その対象の中身を分ける質問をしてください。questionCodeがmissing_schedulable_workの場合は追加の分解を求めません。対象について現在の全体範囲や進捗をまだ把握していないなら、まずその教材・作業で自然な単位を使って、全体の範囲と現在どこまで終わっているかを一つの確認として尋ねてください。ページに固定せず、問題数、単語数、章、節、回、時間など、planningStateSummaryや会話から分かる対象に合う粒度を使ってください。完了済み・現在位置がすでにdecidedFactsまたはrecentConversationから分かる場合に限って、次に今回の計画期間でどこまで進めたいかを尋ねてください。semantic_uncertaintyの場合はsourceTextとreasonを使い、意味を決め打ちせず、その曖昧さを解消する一つの確認だけをしてください。',
      '説明要求には説明し、questionでは必要情報だけを尋ね、未実行の作成・保存を完了したとは言わないでください。',
    ].join(''),
  }, null, 2);

  return { systemPrompt, userPrompt };
}
