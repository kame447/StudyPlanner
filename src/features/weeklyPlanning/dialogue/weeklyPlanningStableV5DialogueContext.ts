export const WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL = 'この内容で仮予定にする';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(
  planningInformation: Record<string, unknown> | null,
  key: string,
): Record<string, unknown>[] {
  const value = planningInformation?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizedLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  if (!label || label.length > 100 || /[\r\n]/.test(label)) return null;
  return label;
}

function factById(
  planningInformation: Record<string, unknown> | null,
  key: string,
  factId: string,
): Record<string, unknown> | null {
  return recordArray(planningInformation, key)
    .find((entry) => entry.id === factId) ?? null;
}

function ownerLabelForFactId(
  planningInformation: Record<string, unknown> | null,
  factId: string,
  visited = new Set<string>(),
): string | null {
  if (visited.has(factId)) return null;
  visited.add(factId);

  const task = factById(planningInformation, 'tasks', factId);
  const taskLabel = normalizedLabel(task?.title);
  if (taskLabel) return taskLabel;

  const component = factById(planningInformation, 'components', factId);
  const componentLabel = normalizedLabel(component?.label);
  if (componentLabel) return componentLabel;

  const uncertainty = factById(planningInformation, 'uncertainties', factId);
  if (typeof uncertainty?.targetFactId === 'string') {
    const label = ownerLabelForFactId(
      planningInformation,
      uncertainty.targetFactId,
      visited,
    );
    if (label) return label;
  }

  for (const key of [
    'workloads',
    'effortEstimates',
    'temporalConstraints',
    'taskDateRules',
    'recurrences',
  ]) {
    const fact = factById(planningInformation, key, factId);
    if (!fact) continue;
    if (typeof fact.targetFactId === 'string') {
      const targetLabel = ownerLabelForFactId(
        planningInformation,
        fact.targetFactId,
        visited,
      );
      if (targetLabel) return targetLabel;
    }
    if (typeof fact.componentId === 'string') {
      const componentOwnerLabel = ownerLabelForFactId(
        planningInformation,
        fact.componentId,
        visited,
      );
      if (componentOwnerLabel) return componentOwnerLabel;
    }
    if (typeof fact.taskId === 'string') {
      const taskOwnerLabel = ownerLabelForFactId(
        planningInformation,
        fact.taskId,
        visited,
      );
      if (taskOwnerLabel) return taskOwnerLabel;
    }
  }

  return null;
}

const QUESTION_TARGET_COLLECTIONS = [
  'tasks',
  'components',
  'workloads',
  'effortEstimates',
  'temporalConstraints',
  'taskDateRules',
  'recurrences',
  'uncertainties',
  'availabilityDeclarations',
  'constraintSourceRequests',
] as const;

export function questionTargetForStableV5Dialogue(params: {
  planningInformation: Record<string, unknown> | null;
  targetFactId: string | null;
}) {
  if (!params.targetFactId) return null;
  for (const collection of QUESTION_TARGET_COLLECTIONS) {
    const fact = factById(params.planningInformation, collection, params.targetFactId);
    if (fact) return { collection, fact };
  }
  return null;
}

function quantityRole(value: unknown): 'declared' | 'target' | 'remaining' | 'completed' | 'unknown' {
  return value === 'declared'
    || value === 'target'
    || value === 'remaining'
    || value === 'completed'
    || value === 'unknown'
    ? value
    : 'unknown';
}

function effortMeasurement(value: unknown) {
  return value === 'total_duration'
    || value === 'duration_per_unit'
    || value === 'session_duration'
    ? value
    : null;
}

export function questionIntentForStableV5Dialogue(params: {
  questionCode: string | null;
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>;
  effortMeasurement?: string | null;
}) {
  const fact = params.questionTarget?.fact;
  const measurement = effortMeasurement(params.effortMeasurement);
  if (
    params.questionCode !== 'missing_effort_estimate'
    || params.questionTarget?.collection !== 'workloads'
    || typeof fact?.id !== 'string'
    || typeof fact.amount !== 'number'
    || !Number.isFinite(fact.amount)
    || fact.amount <= 0
    || typeof fact.unitCode !== 'string'
    || measurement === null
  ) {
    return null;
  }
  const role = quantityRole(fact.quantityRole);
  return {
    kind: 'effort_measurement',
    measurement,
    quantityRole: role,
    targetFactId: fact.id,
    amount: fact.amount,
    unitCode: measurement === 'total_duration' ? null : fact.unitCode,
    unitLabel: typeof fact.unitLabel === 'string' ? fact.unitLabel : null,
  } as const;
}

export function learningStrategyProposalIntentForStableV5Dialogue(params: {
  questionCode: string | null;
  actionId: string | null;
  proposalRecords: readonly unknown[];
}) {
  if (params.questionCode !== 'learning_strategy_proposal' || !params.actionId) return null;
  const proposal = params.proposalRecords
    .filter(isRecord)
    .find((record) => record.id === params.actionId && record.status === 'pending');
  if (!proposal) return null;
  const proposalKind = proposal.kind;
  if (proposalKind !== 'spaced_memory_practice' && proposalKind !== 'calibrate_memory_pace') {
    return null;
  }
  if (typeof proposal.workloadFactId !== 'string') return null;
  if (!isRecord(proposal.suggestedSessionMinutes)) return null;
  const min = proposal.suggestedSessionMinutes.min;
  const max = proposal.suggestedSessionMinutes.max;
  if (
    typeof min !== 'number'
    || !Number.isFinite(min)
    || min <= 0
    || typeof max !== 'number'
    || !Number.isFinite(max)
    || max < min
  ) return null;

  if (proposalKind === 'calibrate_memory_pace') {
    const sessionDurationMinutes = typeof proposal.selectedSessionMinutes === 'number'
      && Number.isFinite(proposal.selectedSessionMinutes)
      && proposal.selectedSessionMinutes > 0
      ? proposal.selectedSessionMinutes
      : min === max
        ? min
        : null;
    if (sessionDurationMinutes === null) return null;
    return {
      kind: 'learning_strategy_proposal',
      proposalKind: 'calibrate_memory_pace',
      targetFactId: proposal.workloadFactId,
      suggestedSessionDurationMinutes: { min, max },
      selectedSessionDurationMinutes: sessionDurationMinutes,
      sessionDurationMinutes,
      measurementPlan: {
        observation: 'progress_during_single_session',
        objective: 'measure_personal_pace',
        futureUse: 'personalize_future_session_planning',
      },
      decisionRequested: 'accept_or_reject',
    } as const;
  }

  return {
    kind: 'learning_strategy_proposal',
    proposalKind: 'spaced_memory_practice',
    targetFactId: proposal.workloadFactId,
    suggestedSessionDurationMinutes: { min, max },
    spacingInterval: 'not_yet_selected',
    rationale: 'distributed_retrieval_supports_retention',
    decisionRequested: 'accept_or_reject',
  } as const;
}

export function requiredLabelsForStableV5Dialogue(params: {
  planningInformation: Record<string, unknown> | null;
  targetFactId: string | null;
  includePreviewPromotionControl: boolean;
}): string[] {
  const labels = new Set<string>();
  if (params.targetFactId) {
    const targetLabel = ownerLabelForFactId(
      params.planningInformation,
      params.targetFactId,
    );
    if (targetLabel) labels.add(targetLabel);
  }
  if (params.includePreviewPromotionControl) {
    labels.add(WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL);
  }
  return [...labels];
}
