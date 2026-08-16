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
      .filter(([key]) => key !== 'uncertainties' && key !== 'groundingRecords')
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
    groundingContext: groundingContext(planningInformation),
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
    'あなたは学習計画アプリの対話担当です。アプリが決めた意図を、簡潔で自然な日本語にしてください。',
    '入力にない具体情報は、例としても補わないでください。',
    '直前の発話への理解や、アプリが構造化した解釈・確定した帰結は、共有理解に必要な場合に自然に示してください。',
    '質問では一度に一つだけ確認してください。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    actionId: input.actionId,
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
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
      'applicationDecisionを守り、自然な日本語を一つ返してください。',
      'decidedFactsは確定、undecidedItemsは未確定です。',
      '質問はquestionTarget/questionIntentの対象・目的・判断要求を変えず、一つだけ聞いてください。',
      'schedulable_work_detailはmodeを厳守してください。existing_target_scope_progressでは既存対象の全体範囲と現在の進捗を聞き、別の作業追加は聞かないでください。missing_task_identityでは予定に入れる作業そのものを聞いてください。',
      'effort_measurementのmeasurementを変えないでください。duration_per_unit=1単位あたり、session_duration=1回、total_duration=全体です。',
      'previewPromotionControlLabelがあれば候補は生成済みです。その操作を案内してください。',
      'groundingContextのproposedは短く示し、確認質問は足さないでください。contestedは断言しないでください。',
    ].join(''),
  });

  return { systemPrompt, userPrompt };
}
