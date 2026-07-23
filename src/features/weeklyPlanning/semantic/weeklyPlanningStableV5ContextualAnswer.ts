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
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

export type WeeklyPlanningStableV5ContextualQuestionCode =
  | 'missing_effort_estimate'
  | 'quantity_role_unresolved';

export interface WeeklyPlanningStableV5ContextualAnswerInput {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  questionCode: WeeklyPlanningStableV5ContextualQuestionCode;
  conversationId: string;
  turnId: string;
  expectedRevision: number;
  userText: string;
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

function unresolvedWorkloads(
  graph: WeeklyPlanningFactGraphV5,
  code: WeeklyPlanningStableV5ContextualQuestionCode,
): WorkloadFactV5[] {
  return graph.workloads.filter((workload) => {
    if (!isActiveFact(graph, workload.id)) return false;
    if (code === 'quantity_role_unresolved') {
      return workload.quantityRole === 'declared' || workload.quantityRole === 'unknown';
    }
    const targetFactIds = new Set([
      workload.taskId,
      ...(workload.componentId ? [workload.componentId] : []),
    ]);
    return !graph.effortEstimates.some((estimate) =>
      isActiveFact(graph, estimate.id)
      && targetFactIds.has(estimate.targetFactId));
  });
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
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const targets = unresolvedWorkloads(input.graph, 'missing_effort_estimate');
  const candidates = durationCandidates(input.document);
  if (targets.length !== 1 || candidates.length !== 1) return null;

  const target = targets[0];
  const candidate = candidates[0];
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
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  const targets = unresolvedWorkloads(input.graph, 'quantity_role_unresolved');
  const roles = quantityRoleCandidates(input.document);
  if (targets.length !== 1 || roles.length !== 1) return null;

  const target = targets[0];
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
    quantityRole: roles[0],
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

export function applyWeeklyPlanningStableV5ContextualAnswer(
  input: WeeklyPlanningStableV5ContextualAnswerInput,
): WeeklyPlanningSemanticCanonicalizationResultV5 | null {
  if (!isMinimalContextualReply(input)) return null;
  if (input.questionCode === 'missing_effort_estimate') return applyEffortAnswer(input);
  return applyQuantityRoleAnswer(input);
}

export function inferWeeklyPlanningStableV5ContextualQuestionCode(
  publicStateSummary?: Record<string, unknown>,
): WeeklyPlanningStableV5ContextualQuestionCode | null {
  const lastAssistantMessage = publicStateSummary?.lastAssistantMessage;
  if (typeof lastAssistantMessage !== 'string') return null;
  if (lastAssistantMessage.includes('合計でどれくらい時間')) {
    return 'missing_effort_estimate';
  }
  if (lastAssistantMessage.includes('今回進めたい量ですか')) {
    return 'quantity_role_unresolved';
  }
  return null;
}
