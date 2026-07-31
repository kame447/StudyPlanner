import {
  createActiveLifecycleEntriesV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactDiffV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import type {
  SemanticQuantityRoleV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  isWeeklyPlanningContextualQuestionCodeV5,
} from './weeklyPlanningPendingQuestionV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

export interface WeeklyPlanningStableV5ContextualAnswerInput {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
  conversationId: string;
  turnId: string;
  expectedRevision: number;
  userText: string;
}

export type WeeklyPlanningStableV5ContextualAnswerEvaluationStatus =
  | 'not_contextual'
  | 'incompatible'
  | 'applied';

export interface WeeklyPlanningStableV5ContextualAnswerEvaluation {
  status: WeeklyPlanningStableV5ContextualAnswerEvaluationStatus;
  reason:
    | 'reply_shape_not_contextual'
    | 'unsupported_question_code'
    | 'target_unavailable'
    | 'expected_single_duration'
    | 'expected_single_quantity_role'
    | 'duplicate_or_conflicting_turn'
    | 'applied';
  result: WeeklyPlanningSemanticCanonicalizationResultV5 | null;
  questionCode: string;
  targetFactId: string | null;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function contextualFactId(params: {
  kind: string;
  conversationId: string;
  turnId: string;
  targetFactId: string;
}): string {
  return `wpf_${params.kind}_${stableHash([
    params.conversationId,
    params.turnId,
    params.kind,
    params.targetFactId,
  ].join('|'))}`;
}

function turnKey(input: WeeklyPlanningStableV5ContextualAnswerInput): string {
  return `${input.conversationId}:${input.turnId}`;
}

function normalizeSourceText(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。！？!?]+$/g, '');
}

function hasWholeTurnTaskSource(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): boolean {
  const normalizedUserText = normalizeSourceText(input.userText);
  return input.document.tasks.some(
    (task) => normalizeSourceText(task.sourceText) === normalizedUserText,
  );
}

function isMinimalContextualReply(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): boolean {
  const text = input.userText.trim();
  return text.length > 0
    && text.length <= 40
    && hasWholeTurnTaskSource(input)
    && input.expectedRevision === input.graph.revision
    && input.pendingQuestion.graphRevision === input.graph.revision
    && isWeeklyPlanningContextualQuestionCodeV5(input.pendingQuestion.questionCode)
    && typeof input.pendingQuestion.targetFactId === 'string'
    && input.pendingQuestion.targetFactId.length > 0
    && input.document.planningIntent !== 'create_plan'
    && input.document.planningWindow === null
    && input.document.tasks.length === 1
    && input.document.relations.length === 0
    && input.document.availabilityDeclarations.length === 0
    && input.document.constraintSourceRequests.length === 0
    && input.document.uncertainties.length === 0
    && input.document.corrections.length === 0
    && input.document.decisions.length === 0;
}

function isActiveFact(graph: WeeklyPlanningFactGraphV5, factId: string): boolean {
  return graph.factLifecycles.some(
    (entry) => entry.factId === factId && entry.status === 'active',
  );
}

function targetWorkload(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WorkloadFactV5 | null {
  const targetFactId = input.pendingQuestion.targetFactId;
  if (!targetFactId || !isActiveFact(input.graph, targetFactId)) return null;
  const workload = input.graph.workloads.find((fact) => fact.id === targetFactId) ?? null;
  if (!workload) return null;
  if (
    input.pendingQuestion.questionCode === 'quantity_role_unresolved'
    && workload.quantityRole !== 'declared'
    && workload.quantityRole !== 'unknown'
  ) {
    return null;
  }
  if (input.pendingQuestion.questionCode === 'missing_effort_estimate') {
    const targetFactIds = new Set([
      workload.taskId,
      ...(workload.componentId ? [workload.componentId] : []),
    ]);
    const alreadyEstimated = input.graph.effortEstimates.some((estimate) =>
      isActiveFact(input.graph, estimate.id)
      && targetFactIds.has(estimate.targetFactId));
    if (alreadyEstimated) return null;
  }
  return workload;
}

function durationCandidates(document: WeeklyPlanningSemanticDocumentV5): Array<{
  minutes: number;
  precision: EffortEstimateFactV5['precision'];
}> {
  const estimates = document.tasks.flatMap((task) =>
    task.effortEstimates
      .filter((estimate) => Number.isFinite(estimate.minutes) && estimate.minutes > 0)
      .map((estimate) => ({
        minutes: estimate.minutes,
        precision: estimate.precision,
      })),
  );
  if (estimates.length > 0) return estimates;

  return document.tasks.flatMap((task) => [
    ...task.workloads,
    ...(task.study?.components ?? []).flatMap((component) => component.workloads),
  ]).flatMap((workload) => {
    if (!Number.isFinite(workload.amount) || workload.amount <= 0) return [];
    if (workload.unitCode === 'minute') {
      return [{ minutes: workload.amount, precision: 'exact' as const }];
    }
    if (workload.unitCode === 'hour') {
      return [{ minutes: workload.amount * 60, precision: 'exact' as const }];
    }
    return [];
  });
}

function quantityRoleCandidates(
  document: WeeklyPlanningSemanticDocumentV5,
): SemanticQuantityRoleV5[] {
  return document.tasks.flatMap((task) => [
    ...task.workloads,
    ...(task.study?.components ?? []).flatMap((component) => component.workloads),
  ])
    .map((workload) => workload.quantityRole)
    .filter((role): role is SemanticQuantityRoleV5 =>
      role === 'target' || role === 'remaining' || role === 'completed');
}

function appliedResult(params: {
  graph: WeeklyPlanningFactGraphV5;
  diff: WeeklyPlanningFactDiffV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  return {
    status: 'applied',
    graph: params.graph,
    diff: params.diff,
    errors: [],
    localToFactId: {},
  };
}

function applyEffortAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
  target: WorkloadFactV5,
  candidate: {
    minutes: number;
    precision: EffortEstimateFactV5['precision'];
  },
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const nextRevision = input.graph.revision + 1;
  const id = contextualFactId({
    kind: 'effort',
    conversationId: input.conversationId,
    turnId: input.turnId,
    targetFactId: target.id,
  });
  if (
    input.graph.effortEstimates.some((fact) => fact.id === id)
    || input.graph.appliedTurnKeys.includes(turnKey(input))
  ) return null;

  const fact: EffortEstimateFactV5 = {
    id,
    taskId: target.taskId,
    targetFactId: target.componentId ?? target.taskId,
    kind: 'total_duration',
    minutes: candidate.minutes,
    unitCode: null,
    precision: candidate.precision,
    source: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      semanticLocalId: 'contextual-effort-answer',
      sourceText: input.userText,
      origin: 'user',
    },
    createdRevision: nextRevision,
  };
  const added = [{ kind: 'effort_estimate' as const, id }];
  return appliedResult({
    graph: {
      ...input.graph,
      revision: nextRevision,
      appliedTurnKeys: [...input.graph.appliedTurnKeys, turnKey(input)],
      effortEstimates: [...input.graph.effortEstimates, fact],
      factLifecycles: [
        ...input.graph.factLifecycles,
        ...createActiveLifecycleEntriesV5({ added, revision: nextRevision }),
      ],
    },
    diff: {
      fromRevision: input.graph.revision,
      toRevision: nextRevision,
      added,
      superseded: [],
      removed: [],
    },
  });
}

function applyQuantityRoleAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
  target: WorkloadFactV5,
  role: SemanticQuantityRoleV5,
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const nextRevision = input.graph.revision + 1;
  const id = contextualFactId({
    kind: 'workload',
    conversationId: input.conversationId,
    turnId: input.turnId,
    targetFactId: target.id,
  });
  if (
    input.graph.workloads.some((fact) => fact.id === id)
    || input.graph.appliedTurnKeys.includes(turnKey(input))
  ) return null;

  const replacement: WorkloadFactV5 = {
    ...target,
    id,
    quantityRole: role,
    source: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      semanticLocalId: 'contextual-quantity-role-answer',
      sourceText: input.userText,
      origin: 'user',
    },
    createdRevision: nextRevision,
  };
  const lifecycles = input.graph.factLifecycles.map((entry) =>
    entry.factId === target.id
      ? {
          ...entry,
          status: 'superseded' as const,
          terminalRevision: nextRevision,
          supersededByFactId: id,
        }
      : entry);
  const added = [{ kind: 'workload' as const, id }];
  const superseded = [{ kind: 'workload' as const, id: target.id }];
  return appliedResult({
    graph: {
      ...input.graph,
      revision: nextRevision,
      appliedTurnKeys: [...input.graph.appliedTurnKeys, turnKey(input)],
      appliedLifecycleOperationKeys: [
        ...input.graph.appliedLifecycleOperationKeys,
        `contextual:${turnKey(input)}`,
      ],
      workloads: [...input.graph.workloads, replacement],
      factLifecycles: [
        ...lifecycles,
        ...createActiveLifecycleEntriesV5({ added, revision: nextRevision }),
      ],
    },
    diff: {
      fromRevision: input.graph.revision,
      toRevision: nextRevision,
      added,
      superseded,
      removed: [],
    },
  });
}

function applyIncompatibleReplyTurn(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const key = turnKey(input);
  if (input.graph.appliedTurnKeys.includes(key)) {
    return {
      status: 'duplicate',
      graph: input.graph,
      diff: null,
      errors: [],
      localToFactId: {},
    };
  }
  const nextRevision = input.graph.revision + 1;
  return appliedResult({
    graph: {
      ...input.graph,
      revision: nextRevision,
      appliedTurnKeys: [...input.graph.appliedTurnKeys, key],
    },
    diff: {
      fromRevision: input.graph.revision,
      toRevision: nextRevision,
      added: [],
      superseded: [],
      removed: [],
    },
  });
}

export function evaluateWeeklyPlanningStableV5ContextualAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningStableV5ContextualAnswerEvaluation {
  const base = {
    questionCode: input.pendingQuestion.questionCode,
    targetFactId: input.pendingQuestion.targetFactId,
  };
  if (!isMinimalContextualReply(input)) {
    return {
      ...base,
      status: 'not_contextual',
      reason: 'reply_shape_not_contextual',
      result: null,
    };
  }
  if (!isWeeklyPlanningContextualQuestionCodeV5(input.pendingQuestion.questionCode)) {
    return {
      ...base,
      status: 'not_contextual',
      reason: 'unsupported_question_code',
      result: null,
    };
  }

  const target = targetWorkload(input);
  if (!target) {
    return {
      ...base,
      status: 'incompatible',
      reason: 'target_unavailable',
      result: null,
    };
  }

  if (input.pendingQuestion.questionCode === 'missing_effort_estimate') {
    const candidates = durationCandidates(input.document);
    if (candidates.length !== 1) {
      return {
        ...base,
        status: 'incompatible',
        reason: 'expected_single_duration',
        result: null,
      };
    }
    const result = applyEffortAnswer(input, target, candidates[0]);
    return result
      ? { ...base, status: 'applied', reason: 'applied', result }
      : {
          ...base,
          status: 'incompatible',
          reason: 'duplicate_or_conflicting_turn',
          result: null,
        };
  }

  const roles = quantityRoleCandidates(input.document);
  if (roles.length !== 1) {
    return {
      ...base,
      status: 'incompatible',
      reason: 'expected_single_quantity_role',
      result: null,
    };
  }
  const result = applyQuantityRoleAnswer(input, target, roles[0]);
  return result
    ? { ...base, status: 'applied', reason: 'applied', result }
    : {
        ...base,
        status: 'incompatible',
        reason: 'duplicate_or_conflicting_turn',
        result: null,
      };
}

export function applyWeeklyPlanningStableV5ContextualAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const evaluation = evaluateWeeklyPlanningStableV5ContextualAnswer(input);
  if (evaluation.status === 'applied') return evaluation.result;
  if (evaluation.status === 'incompatible') {
    return applyIncompatibleReplyTurn(input);
  }
  return null;
}
