import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from './weeklyPlanningEffortQuestionPolicyV5';
import {
  createActiveLifecycleEntriesV5,
} from './weeklyPlanningFactLifecycleV5';
import {
  applyWeeklyPlanningFactLifecycleOperationV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  EffortEstimateFactV5,
  UncertaintyFactV5,
  WeeklyPlanningFactDiffV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import type {
  SemanticQuantityRoleV5,
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  isWeeklyPlanningContextualQuestionCodeV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

/*
 * Semantic ownership boundary
 *
 * The semantic AI interprets the reply. This layer only verifies that the
 * machine pending question still points to an active exact fact and that the
 * accepted semantic document contains one compatible answer value or a
 * concrete semantic delta that resolves one exact uncertainty.
 *
 * Never compare userText with phrases, units, labels, or quantities here. Never
 * infer another target. A mismatch is rejected or recorded as an incompatible
 * turn; it is not repaired by a deterministic natural-language parser.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/tasks/20260803-weekly-planning-partial-semantic-acceptance-and-clarification-repair.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
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
    | 'duration_not_grounded_in_user_text'
    | 'quantity_role_not_grounded_in_user_text'
    | 'uncertainty_not_resolved'
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

function isSemanticUncertaintyQuestion(code: string): boolean {
  return code === 'semantic_uncertainty';
}

function correctionsOnlyRestatePendingTarget(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): boolean {
  if (input.document.corrections.length === 0) return true;
  const targetFactId = input.pendingQuestion.targetFactId;
  if (!targetFactId) return false;
  return input.document.corrections.every((correction) =>
    correction.operation === 'replace'
    && correction.target.publicId === targetFactId
    && correction.target.localId === null);
}

function taskCarriesCurrentSemanticDelta(task: SemanticTaskV5): boolean {
  return task.workloads.length > 0
    || task.effortEstimates.length > 0
    || task.temporalConstraints.length > 0
    || task.recurrence.length > 0
    || (task.durableContextSignals?.length ?? 0) > 0
    || (task.study?.components.length ?? 0) > 0;
}

function taskIsExistingIdentityShell(task: SemanticTaskV5): boolean {
  return typeof task.existingPublicId === 'string'
    && task.existingPublicId.length > 0
    && !taskCarriesCurrentSemanticDelta(task);
}

function hasOneContextualPayloadTask(document: WeeklyPlanningSemanticDocumentV5): boolean {
  const payloadTasks = document.tasks.filter(taskCarriesCurrentSemanticDelta);
  if (payloadTasks.length !== 1) return false;
  const payloadTask = payloadTasks[0];
  return document.tasks.every((task) => task === payloadTask || taskIsExistingIdentityShell(task));
}

function isMinimalWorkloadContextualReply(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): boolean {
  return input.expectedRevision === input.graph.revision
    && input.pendingQuestion.graphRevision === input.graph.revision
    && isWeeklyPlanningContextualQuestionCodeV5(input.pendingQuestion.questionCode)
    && typeof input.pendingQuestion.targetFactId === 'string'
    && input.pendingQuestion.targetFactId.length > 0
    && input.document.planningIntent !== 'create_plan'
    && input.document.planningWindow === null
    && hasOneContextualPayloadTask(input.document)
    && input.document.relations.length === 0
    && input.document.availabilityDeclarations.length === 0
    && input.document.constraintSourceRequests.length === 0
    && correctionsOnlyRestatePendingTarget(input)
    && input.document.decisions.length === 0;
}

function isSemanticUncertaintyReplyEnvelope(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): boolean {
  return input.expectedRevision === input.graph.revision
    && input.pendingQuestion.graphRevision === input.graph.revision
    && isSemanticUncertaintyQuestion(input.pendingQuestion.questionCode)
    && typeof input.pendingQuestion.targetFactId === 'string'
    && input.pendingQuestion.targetFactId.length > 0;
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
  ) return null;
  if (
    input.pendingQuestion.questionCode === 'missing_effort_estimate'
    && input.graph.effortEstimates.some((estimate) =>
      isActiveFact(input.graph, estimate.id)
      && estimate.targetFactId === workload.id)
  ) return null;
  return workload;
}

function targetUncertainty(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): UncertaintyFactV5 | null {
  const targetFactId = input.pendingQuestion.targetFactId;
  if (!targetFactId || !isActiveFact(input.graph, targetFactId)) return null;
  return input.graph.uncertainties.find((fact) => fact.id === targetFactId) ?? null;
}

function semanticLocalIdsForExistingFact(
  document: WeeklyPlanningSemanticDocumentV5,
  publicId: string | null,
): Set<string> {
  if (!publicId) return new Set();
  const localIds = new Set<string>();
  for (const task of document.tasks) {
    if (task.existingPublicId === publicId) localIds.add(task.localId);
    for (const component of task.study?.components ?? []) {
      if (component.existingPublicId === publicId) localIds.add(component.localId);
    }
  }
  return localIds;
}

function retainsPendingSemanticUncertainty(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
  target: UncertaintyFactV5,
): boolean {
  const targetLocalIds = semanticLocalIdsForExistingFact(
    input.document,
    target.targetFactId,
  );
  return input.document.uncertainties.some((uncertainty) => {
    if (uncertainty.field !== target.field) return false;
    if (!uncertainty.targetLocalId) return true;
    if (targetLocalIds.size === 0) return true;
    return targetLocalIds.has(uncertainty.targetLocalId);
  });
}

function durationCandidates(document: WeeklyPlanningSemanticDocumentV5): Array<{
  minutes: number;
  precision: EffortEstimateFactV5['precision'];
}> {
  return document.tasks.flatMap((task) =>
    task.effortEstimates
      .filter((estimate) => Number.isFinite(estimate.minutes) && estimate.minutes > 0)
      .map((estimate) => ({
        minutes: estimate.minutes,
        precision: estimate.precision,
      })),
  );
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

function containsResolvedSemanticDelta(
  document: WeeklyPlanningSemanticDocumentV5,
): boolean {
  return document.planningWindow !== null
    || document.tasks.length > 0
    || document.relations.length > 0
    || document.availabilityDeclarations.length > 0
    || document.constraintSourceRequests.length > 0
    || document.corrections.length > 0
    || document.decisions.length > 0;
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

  const questionPlan = createWeeklyPlanningEffortQuestionPlanV5(target);
  const fact: EffortEstimateFactV5 = {
    id,
    taskId: target.taskId,
    targetFactId: target.id,
    kind: questionPlan.kind,
    minutes: candidate.minutes,
    unitCode: questionPlan.unitCode as EffortEstimateFactV5['unitCode'],
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

function applySemanticUncertaintyAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
  target: UncertaintyFactV5,
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const canonicalization = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: input.graph,
    document: input.document,
    context: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      expectedRevision: input.expectedRevision,
    },
  });
  if (canonicalization.status !== 'applied' || !canonicalization.diff) {
    return canonicalization.status === 'rejected' ? canonicalization : null;
  }

  const removal = applyWeeklyPlanningFactLifecycleOperationV5({
    graph: canonicalization.graph,
    expectedRevision: canonicalization.graph.revision,
    operation: {
      operationKey: `contextual-uncertainty:${turnKey(input)}:${target.id}`,
      kind: 'remove',
      targetFactId: target.id,
    },
  });
  if (removal.status === 'rejected') {
    return {
      status: 'rejected',
      graph: input.graph,
      diff: null,
      errors: removal.errors.map((error) => `uncertainty-resolution:${error}`),
      localToFactId: canonicalization.localToFactId,
    };
  }
  if (removal.status !== 'applied') return null;

  return {
    status: 'applied',
    graph: removal.graph,
    diff: {
      fromRevision: input.graph.revision,
      toRevision: removal.graph.revision,
      added: canonicalization.diff.added,
      superseded: [
        ...canonicalization.diff.superseded,
        ...removal.superseded,
      ],
      removed: [
        ...canonicalization.diff.removed,
        ...removal.removed,
      ],
    },
    errors: [],
    localToFactId: canonicalization.localToFactId,
  };
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

function rejectUnavailableTarget(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningSemanticCanonicalizationResultV5 {
  return {
    status: 'rejected',
    graph: input.graph,
    diff: null,
    errors: [
      `contextual-answer-target-unavailable:${input.pendingQuestion.questionCode}:${input.pendingQuestion.targetFactId ?? 'none'}`,
    ],
    localToFactId: {},
  };
}

export function evaluateWeeklyPlanningStableV5ContextualAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningStableV5ContextualAnswerEvaluation {
  const base = {
    questionCode: input.pendingQuestion.questionCode,
    targetFactId: input.pendingQuestion.targetFactId,
  };

  if (isSemanticUncertaintyQuestion(input.pendingQuestion.questionCode)) {
    if (!isSemanticUncertaintyReplyEnvelope(input)) {
      return {
        ...base,
        status: 'not_contextual',
        reason: 'reply_shape_not_contextual',
        result: null,
      };
    }
    const target = targetUncertainty(input);
    if (!target) {
      return {
        ...base,
        status: 'incompatible',
        reason: 'target_unavailable',
        result: null,
      };
    }
    if (
      retainsPendingSemanticUncertainty(input, target)
      || !containsResolvedSemanticDelta(input.document)
    ) {
      return {
        ...base,
        status: 'incompatible',
        reason: 'uncertainty_not_resolved',
        result: null,
      };
    }
    const result = applySemanticUncertaintyAnswer(input, target);
    return result
      ? { ...base, status: 'applied', reason: 'applied', result }
      : {
          ...base,
          status: 'incompatible',
          reason: 'duplicate_or_conflicting_turn',
          result: null,
        };
  }

  if (!isMinimalWorkloadContextualReply(input)) {
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
        reason: 'duration_not_grounded_in_user_text',
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
      reason: 'quantity_role_not_grounded_in_user_text',
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
  if (evaluation.status !== 'incompatible') return null;
  if (evaluation.reason === 'target_unavailable') {
    return rejectUnavailableTarget(input);
  }
  if (
    evaluation.reason === 'duration_not_grounded_in_user_text'
    || evaluation.reason === 'quantity_role_not_grounded_in_user_text'
    || evaluation.reason === 'uncertainty_not_resolved'
    || evaluation.reason === 'duplicate_or_conflicting_turn'
  ) {
    return applyIncompatibleReplyTurn(input);
  }
  return null;
}
