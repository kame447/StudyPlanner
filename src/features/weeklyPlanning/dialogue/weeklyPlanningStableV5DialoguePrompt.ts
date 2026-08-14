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
    'あなたは学習計画アプリの対話担当です。アプリが決めた意図を、簡潔で自然な日本語にしてください。',
    '入力にない具体情報は、例としても補わないでください。',
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
      relevantLabels: input.requiredLabels,
      previewCount: input.previewCount,
    },
    request: [
      'applicationDecisionを守り、現在の発話系列に合う自然な日本語を一つ返してください。',
      'decidedFactsは確定情報、undecidedItemsは未確定情報です。',
      '質問ならquestionCodeの解消に必要な一つだけを尋ねてください。',
    ].join(''),
  });

  return { systemPrompt, userPrompt };
}
