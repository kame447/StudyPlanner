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

function normalizedMaterialLookup(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u3000\-_・･.,，。:：/／\\()（）\[\]［］「」『』【】]/g, '');
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

function targetFactId(
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>,
): string | null {
  return typeof questionTarget?.fact.id === 'string' ? questionTarget.fact.id : null;
}

function boundedWorkloadForTarget(params: {
  planningInformation: Record<string, unknown> | null;
  targetCollection: string | undefined;
  targetFactId: string;
}): Record<string, unknown> | null {
  const workloads = recordArray(params.planningInformation, 'workloads');
  const candidates = workloads.filter((workload) => {
    if (params.targetCollection === 'components') {
      return workload.componentId === params.targetFactId;
    }
    return workload.taskId === params.targetFactId && (workload.componentId ?? null) === null;
  });
  return candidates.find((workload) =>
    typeof workload.amount === 'number'
    && Number.isFinite(workload.amount)
    && workload.amount > 0
    && typeof workload.unitCode === 'string'
    && typeof workload.unitLabel === 'string'
    && workload.unitLabel.trim().length > 0
    && workload.quantityRole === 'scope_total') ?? null;
}

function registeredMaterialTargetLabel(params: {
  planningInformation: Record<string, unknown> | null;
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>;
}): string | null {
  const target = params.questionTarget;
  if (!target) return null;
  if (target.collection === 'components') {
    return normalizedLabel(target.fact.label);
  }
  if (target.collection === 'tasks') {
    const taskId = typeof target.fact.id === 'string' ? target.fact.id : null;
    if (taskId) {
      const materialComponents = recordArray(params.planningInformation, 'components')
        .filter((component) => component.taskId === taskId && component.role === 'material');
      if (materialComponents.length === 1) {
        const label = normalizedLabel(materialComponents[0].label);
        if (label) return label;
      }
    }
    return normalizedLabel(target.fact.title);
  }
  if (target.collection === 'uncertainties') {
    if (target.fact.field !== 'work_breakdown') return null;
    const ownerId = typeof target.fact.targetFactId === 'string'
      ? target.fact.targetFactId
      : null;
    if (!ownerId) return null;
    const materialComponents = recordArray(params.planningInformation, 'components')
      .filter((component) => component.taskId === ownerId && component.role === 'material');
    if (materialComponents.length === 1) {
      const label = normalizedLabel(materialComponents[0].label);
      if (label) return label;
    }
    return ownerLabelForFactId(params.planningInformation, ownerId);
  }
  const id = targetFactId(target);
  return id ? ownerLabelForFactId(params.planningInformation, id) : null;
}

function registeredMaterialTerms(material: Record<string, unknown>): string[] {
  const rawAliases = Array.isArray(material.aliases)
    ? material.aliases.filter((value): value is string => typeof value === 'string')
    : [];
  return [material.name, material.catalogTitle, ...rawAliases]
    .map(normalizedMaterialLookup)
    .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index);
}

function registeredMaterialForLabel(params: {
  planningInformation: Record<string, unknown> | null;
  label: string;
}): Record<string, unknown> | null {
  const normalized = normalizedMaterialLookup(params.label);
  if (!normalized) return null;
  const materials = recordArray(params.planningInformation, 'registeredMaterials')
    .filter((material) => material.paceEnabled === true);
  const exact = materials.filter((material) => registeredMaterialTerms(material).includes(normalized));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const contained = materials.filter((material) =>
    registeredMaterialTerms(material).some((term) =>
      term.length >= 3 && (normalized.includes(term) || term.includes(normalized))));
  return contained.length === 1 ? contained[0] : null;
}

function registeredMaterialUnitLabel(material: Record<string, unknown>): string | null {
  const explicit = normalizedLabel(material.progressUnitLabel);
  if (explicit) return explicit;
  switch (material.progressUnit) {
    case 'page': return 'ページ';
    case 'problem': return '問';
    case 'section': return 'セクション';
    case 'video': return '本';
    case 'word': return '語';
    case 'custom': return '単位';
    default: return null;
  }
}

function registeredMaterialTargetScopeIntent(params: {
  planningInformation: Record<string, unknown> | null;
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>;
}) {
  const label = registeredMaterialTargetLabel(params);
  if (!label) return null;
  const material = registeredMaterialForLabel({
    planningInformation: params.planningInformation,
    label,
  });
  if (!material) return null;
  const total = material.totalUnits;
  const current = material.currentUnit;
  if (
    typeof total !== 'number'
    || !Number.isFinite(total)
    || total <= 0
    || typeof current !== 'number'
    || !Number.isFinite(current)
    || current < 0
    || current > total
  ) return null;
  const unitLabel = registeredMaterialUnitLabel(material);
  if (!unitLabel) return null;
  return {
    kind: 'schedulable_work_detail' as const,
    mode: 'registered_material_target_scope' as const,
    targetFactId: targetFactId(params.questionTarget),
    progressBasis: 'known_registered_material_progress' as const,
    knownUnitCode: typeof material.progressUnit === 'string' ? material.progressUnit : null,
    knownUnitLabel: unitLabel,
    knownTotalUnits: total,
    knownCurrentUnits: current,
    knownRemainingUnits: Math.max(0, total - current),
    requestedInformation: ['plan_target_scope'] as const,
  };
}

function resolutionIntent(params: {
  questionCode: string;
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>;
}) {
  const fact = params.questionTarget?.fact;
  const id = targetFactId(params.questionTarget);
  const base = {
    kind: 'resolution_question' as const,
    targetFactId: id,
    allowedChoices: [] as const,
    knownAmount: null as number | null,
    knownUnitLabel: null as string | null,
    ambiguityField: null as string | null,
    ambiguityReason: null as string | null,
  };

  switch (params.questionCode) {
    case 'semantic_uncertainty':
      return {
        ...base,
        resolutionKind: 'semantic_clarification' as const,
        requestedInformation: ['clarify_ambiguous_meaning'] as const,
        ambiguityField: typeof fact?.field === 'string' ? fact.field : null,
        ambiguityReason: typeof fact?.reason === 'string' ? fact.reason : null,
      };
    case 'invalid_planning_horizon':
      return { ...base, resolutionKind: 'planning_horizon' as const, requestedInformation: ['planning_period'] as const };
    case 'ambiguous_planning_window':
      return { ...base, resolutionKind: 'planning_window_choice' as const, requestedInformation: ['single_planning_window'] as const };
    case 'quantity_role_unresolved':
      return {
        ...base,
        resolutionKind: 'quantity_role' as const,
        requestedInformation: ['quantity_role'] as const,
        allowedChoices: ['plan_target_amount', 'remaining_total_amount'] as const,
        knownAmount: typeof fact?.amount === 'number' && Number.isFinite(fact.amount) ? fact.amount : null,
        knownUnitLabel: typeof fact?.unitLabel === 'string' ? fact.unitLabel : null,
      };
    case 'ambiguous_effort_estimate':
      return { ...base, resolutionKind: 'effort_estimate_choice' as const, requestedInformation: ['choose_effort_estimate'] as const };
    case 'missing_availability_date_scope':
      return { ...base, resolutionKind: 'availability_date_scope' as const, requestedInformation: ['availability_date_scope'] as const };
    case 'missing_time_bounds':
    case 'invalid_time_interval':
      return { ...base, resolutionKind: 'time_bounds' as const, requestedInformation: ['start_and_end_time'] as const };
    case 'named_time_period_unresolved':
      return { ...base, resolutionKind: 'named_time_period_bounds' as const, requestedInformation: ['named_time_period_start_and_end'] as const };
    case 'missing_commitment_date_scope':
      return { ...base, resolutionKind: 'commitment_date_scope' as const, requestedInformation: ['commitment_date'] as const };
    case 'invalid_commitment_interval':
      return { ...base, resolutionKind: 'commitment_time_bounds' as const, requestedInformation: ['commitment_start_and_end_time'] as const };
    case 'conflicting_task_date_rule':
      return {
        ...base,
        resolutionKind: 'task_date_rule_conflict' as const,
        requestedInformation: ['allowed_or_excluded_date_rule'] as const,
        allowedChoices: ['allowed_date', 'excluded_date'] as const,
      };
    case 'constraint_source_unavailable':
    case 'active_constraint_source_missing':
      return {
        ...base,
        resolutionKind: 'constraint_source_choice' as const,
        requestedInformation: ['constraint_source'] as const,
        allowedChoices: ['timetable', 'existing_plans', 'calendar'] as const,
      };
    case 'orphan_relation_task':
      return { ...base, resolutionKind: 'task_relation_reference' as const, requestedInformation: ['identify_relation_endpoints'] as const };
    case 'self_relation':
      return { ...base, resolutionKind: 'task_relation_self_reference' as const, requestedInformation: ['distinct_relation_endpoints'] as const };
    default:
      return null;
  }
}

export function questionIntentForStableV5Dialogue(params: {
  questionCode: string | null;
  questionTarget: ReturnType<typeof questionTargetForStableV5Dialogue>;
  planningInformation?: Record<string, unknown> | null;
  effortMeasurement?: string | null;
}) {
  const fact = params.questionTarget?.fact;

  if (params.questionCode === 'missing_schedulable_work') {
    if (
      (params.questionTarget?.collection === 'tasks'
        || params.questionTarget?.collection === 'components')
      && typeof fact?.id === 'string'
    ) {
      const registeredIntent = registeredMaterialTargetScopeIntent({
        planningInformation: params.planningInformation ?? null,
        questionTarget: params.questionTarget,
      });
      if (registeredIntent) return registeredIntent;
      const boundedWorkload = boundedWorkloadForTarget({
        planningInformation: params.planningInformation ?? null,
        targetCollection: params.questionTarget.collection,
        targetFactId: fact.id,
      });
      return {
        kind: 'schedulable_work_detail',
        mode: 'existing_target_progress',
        targetFactId: fact.id,
        progressBasis: boundedWorkload
          ? 'known_bounded_quantity'
          : 'completion_progress_without_known_unit',
        knownUnitCode: typeof boundedWorkload?.unitCode === 'string' ? boundedWorkload.unitCode : null,
        knownUnitLabel: typeof boundedWorkload?.unitLabel === 'string' ? boundedWorkload.unitLabel : null,
        requestedInformation: ['current_progress'],
      } as const;
    }
    if (params.questionTarget === null) {
      if (params.effortMeasurement === 'all_requested_work_complete') {
        return {
          kind: 'schedulable_work_detail',
          mode: 'all_requested_work_complete',
          targetFactId: null,
          progressBasis: null,
          knownUnitCode: null,
          knownUnitLabel: null,
          requestedInformation: ['additional_task_or_constraint'],
        } as const;
      }
      return {
        kind: 'schedulable_work_detail',
        mode: 'missing_task_identity',
        targetFactId: null,
        progressBasis: null,
        knownUnitCode: null,
        knownUnitLabel: null,
        requestedInformation: ['task_identity'],
      } as const;
    }
    return null;
  }

  if (
    params.questionCode === 'semantic_uncertainty'
    && params.questionTarget?.collection === 'uncertainties'
    && fact?.field === 'work_breakdown'
  ) {
    const registeredIntent = registeredMaterialTargetScopeIntent({
      planningInformation: params.planningInformation ?? null,
      questionTarget: params.questionTarget,
    });
    if (registeredIntent) return registeredIntent;
  }

  const measurement = effortMeasurement(params.effortMeasurement);
  if (
    params.questionCode === 'missing_effort_estimate'
    && params.questionTarget?.collection === 'workloads'
    && typeof fact?.id === 'string'
    && typeof fact.amount === 'number'
    && Number.isFinite(fact.amount)
    && fact.amount > 0
    && typeof fact.unitCode === 'string'
    && measurement !== null
  ) {
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

  return params.questionCode
    ? resolutionIntent({ questionCode: params.questionCode, questionTarget: params.questionTarget })
    : null;
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
  if (
    proposalKind !== 'spaced_memory_practice'
    && proposalKind !== 'calibrate_memory_pace'
    && proposalKind !== 'mixed_acquisition_review'
  ) return null;
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

  if (proposalKind === 'mixed_acquisition_review') {
    const strategy = proposal.capacityStrategy;
    if (
      !isRecord(strategy)
      || strategy.trigger !== 'insufficient_capacity'
      || strategy.acquisition !== 'longer_sessions'
      || strategy.review !== 'short_distributed_sessions'
    ) return null;
    return {
      kind: 'learning_strategy_proposal',
      proposalKind: 'mixed_acquisition_review',
      targetFactId: proposal.workloadFactId,
      capacityReason: 'insufficient_capacity',
      acquisitionMode: 'longer_sessions',
      reviewMode: 'short_distributed_sessions',
      reviewSessionDurationMinutes: { min, max },
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
    const targetLabel = ownerLabelForFactId(params.planningInformation, params.targetFactId);
    if (targetLabel) labels.add(targetLabel);
  }
  if (params.includePreviewPromotionControl) {
    labels.add(WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL);
  }
  return [...labels];
}
