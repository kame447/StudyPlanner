import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_QUANTITY_ROLES_V5,
  SEMANTIC_TASK_CATEGORIES_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticComponentRoleV5,
  type SemanticQuantityRoleV5,
  type SemanticTaskCategoryV5,
  type SemanticWorkloadUnitCodeV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS = 140;

export const FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_contextual_answer_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'minutes', 'precision', 'quantityRole'],
      properties: {
        decision: {
          type: 'string',
          enum: [
            'effort_answer',
            'remaining_effort_answer',
            'effort_per_unit_answer',
            'quantity_role_answer',
            'fallback',
          ],
        },
        minutes: {
          anyOf: [
            { type: 'number', exclusiveMinimum: 0 },
            { type: 'null' },
          ],
        },
        precision: {
          anyOf: [
            { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
            { type: 'null' },
          ],
        },
        quantityRole: {
          anyOf: [
            { type: 'string', enum: ['target', 'remaining', 'completed'] },
            { type: 'null' },
          ],
        },
      },
    },
  },
};

const FOCUSED_CONTEXTUAL_ANSWER_SYSTEM_PROMPT = [
  'Interpret only the current answer around the machine-selected pending question. Machine state provides the fact being asked about and, only for completed-work pace questions, a distinct remaining workload that is actually schedulable.',
  'For missing_effort_estimate, clear effort answers are supported even when they answer a useful alternate measurement instead of the wording of the pending question. effort_answer = total duration explicitly for questionTargetWorkload. remaining_effort_answer = total duration explicitly for estimateForWorkload. effort_per_unit_answer = an explicit per-unit rate for the work being estimated; use estimateForWorkload when present. Convert duration to minutes without multiplying by workload amount.',
  'When questionBasis=completed_workload_total and estimateForWorkload exists, do not use fallback merely because the user states remaining-work duration or a per-unit rate instead of completed-work total duration. Those are valid focused answers. Never bind remaining-work meaning to completed work. Use fallback only when the meaning is ambiguous between these choices or the turn also carries unsupported independent planning meaning.',
  'For quantity_role_unresolved, quantity_role_answer is only for clear target, remaining, or completed meaning. Other changes, discussion, or ambiguity are fallback.',
].join('\n');

type FocusedContextualQuestionCodeV5 =
  | 'missing_effort_estimate'
  | 'quantity_role_unresolved';

interface FocusedContextualComponentV5 {
  publicId: string;
  role: SemanticComponentRoleV5;
  label: string;
}

interface FocusedContextualWorkloadV5 {
  publicId: string;
  quantityRole: SemanticQuantityRoleV5;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
}

export interface FocusedContextualTargetV5 extends FocusedContextualWorkloadV5 {
  questionCode: FocusedContextualQuestionCodeV5;
  graphRevision: number;
  taskPublicId: string;
  taskCategory: SemanticTaskCategoryV5;
  taskTitle: string;
  component: FocusedContextualComponentV5 | null;
  estimateForWorkload: FocusedContextualWorkloadV5 | null;
  questionBasis: 'completed_workload_total' | null;
}

export interface FocusedContextualAnswerDecisionV5 {
  decision:
    | 'effort_answer'
    | 'remaining_effort_answer'
    | 'effort_per_unit_answer'
    | 'quantity_role_answer'
    | 'fallback';
  minutes: number | null;
  precision: 'exact' | 'approximate' | 'unspecified' | null;
  quantityRole: 'target' | 'remaining' | 'completed' | null;
}

export interface FocusedContextualAnswerInputV5 {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contextualQuestionCode(value: unknown): FocusedContextualQuestionCodeV5 | null {
  return value === 'missing_effort_estimate' || value === 'quantity_role_unresolved'
    ? value
    : null;
}

function workloadUnitCode(value: unknown): SemanticWorkloadUnitCodeV5 | null {
  return typeof value === 'string' && [
    'minute',
    'hour',
    'page',
    'problem',
    'word',
    'lesson',
    'chapter',
    'section',
    'exam_year',
    'mock_exam',
    'session',
    'custom',
  ].includes(value)
    ? value as SemanticWorkloadUnitCodeV5
    : null;
}

function quantityRole(value: unknown): SemanticQuantityRoleV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_QUANTITY_ROLES_V5 as readonly string[]).includes(value)
    ? value as SemanticQuantityRoleV5
    : null;
}

function taskCategory(value: unknown): SemanticTaskCategoryV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_TASK_CATEGORIES_V5 as readonly string[]).includes(value)
    ? value as SemanticTaskCategoryV5
    : null;
}

function componentRole(value: unknown): SemanticComponentRoleV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_COMPONENT_ROLES_V5 as readonly string[]).includes(value)
    ? value as SemanticComponentRoleV5
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function parsedWorkloadV5(value: Record<string, unknown>): FocusedContextualWorkloadV5 | null {
  const unitCode = workloadUnitCode(value.unitCode);
  const parsedQuantityRole = quantityRole(value.quantityRole);
  const rangeStart = nullableString(value.rangeStart);
  const rangeEnd = nullableString(value.rangeEnd);
  const periodExpression = nullableString(value.periodExpression);
  if (
    !unitCode
    || !parsedQuantityRole
    || typeof value.publicId !== 'string'
    || !value.publicId
    || typeof value.amount !== 'number'
    || !Number.isFinite(value.amount)
    || value.amount <= 0
    || typeof value.unitLabel !== 'string'
    || rangeStart === undefined
    || rangeEnd === undefined
    || typeof value.perOccurrence !== 'boolean'
    || periodExpression === undefined
  ) return null;
  return {
    publicId: value.publicId,
    quantityRole: parsedQuantityRole,
    amount: value.amount,
    unitCode,
    unitLabel: value.unitLabel,
    rangeStart,
    rangeEnd,
    perOccurrence: value.perOccurrence,
    periodExpression,
  };
}

function workloadByPublicId(params: {
  workloads: unknown[];
  publicId: unknown;
}): FocusedContextualWorkloadV5 | null {
  if (typeof params.publicId !== 'string' || !params.publicId) return null;
  const candidate = params.workloads.find((value) =>
    isRecord(value) && value.publicId === params.publicId);
  return isRecord(candidate) ? parsedWorkloadV5(candidate) : null;
}

export function focusedContextualTargetV5(
  input: FocusedContextualAnswerInputV5,
): FocusedContextualTargetV5 | null {
  const summary = input.publicStateSummary;
  if (!isRecord(summary)) return null;
  const pending = summary.pendingQuestion;
  if (!isRecord(pending)) return null;

  const questionCode = contextualQuestionCode(pending.questionCode);
  if (!questionCode) return null;
  if (typeof pending.targetFactId !== 'string' || !pending.targetFactId) return null;
  if (!Number.isInteger(pending.graphRevision) || Number(pending.graphRevision) < 0) return null;
  if (!Array.isArray(summary.workloads) || !Array.isArray(summary.tasks)) return null;

  const targetRecord = summary.workloads.find((candidate) =>
    isRecord(candidate) && candidate.publicId === pending.targetFactId);
  if (!isRecord(targetRecord)) return null;
  const parsedTarget = parsedWorkloadV5(targetRecord);
  if (
    !parsedTarget
    || typeof targetRecord.taskPublicId !== 'string'
    || !targetRecord.taskPublicId
  ) return null;

  const task = summary.tasks.find((candidate) =>
    isRecord(candidate) && candidate.publicId === targetRecord.taskPublicId);
  if (!isRecord(task)) return null;
  const category = taskCategory(task.category);
  if (!category || typeof task.title !== 'string') return null;

  let component: FocusedContextualComponentV5 | null = null;
  if (targetRecord.componentPublicId !== null) {
    if (
      typeof targetRecord.componentPublicId !== 'string'
      || !targetRecord.componentPublicId
      || !Array.isArray(summary.components)
    ) return null;
    const matchingComponent = summary.components.find((candidate) =>
      isRecord(candidate)
      && candidate.publicId === targetRecord.componentPublicId
      && candidate.taskPublicId === targetRecord.taskPublicId);
    if (!isRecord(matchingComponent)) return null;
    const role = componentRole(matchingComponent.role);
    if (!role || typeof matchingComponent.label !== 'string') return null;
    component = {
      publicId: targetRecord.componentPublicId,
      role,
      label: matchingComponent.label,
    };
  }

  const questionBasis = pending.questionBasis === 'completed_workload_total'
    ? 'completed_workload_total' as const
    : null;
  const estimateForWorkload = questionBasis
    ? workloadByPublicId({
        workloads: summary.workloads,
        publicId: pending.estimateForWorkloadFactId,
      })
    : null;
  if (estimateForWorkload && estimateForWorkload.publicId === parsedTarget.publicId) {
    return null;
  }
  if (questionBasis && !estimateForWorkload) return null;

  return {
    ...parsedTarget,
    questionCode,
    graphRevision: Number(pending.graphRevision),
    taskPublicId: targetRecord.taskPublicId,
    taskCategory: category,
    taskTitle: task.title,
    component,
    estimateForWorkload,
    questionBasis,
  };
}

export function focusedContextualAnswerEligibleV5(
  input: FocusedContextualAnswerInputV5,
): boolean {
  return focusedContextualTargetV5(input) !== null;
}

function workloadPromptView(workload: FocusedContextualWorkloadV5) {
  return {
    publicId: workload.publicId,
    amount: workload.amount,
    unitCode: workload.unitCode,
    unitLabel: workload.unitLabel,
    quantityRole: workload.quantityRole,
  };
}

export function createFocusedContextualAnswerMessagesV5(
  input: FocusedContextualAnswerInputV5,
): ChatMessage[] {
  const target = focusedContextualTargetV5(input);
  if (!target) return [];
  return [
    { role: 'system', content: FOCUSED_CONTEXTUAL_ANSWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: input.userText,
        pendingQuestion: {
          questionCode: target.questionCode,
          questionBasis: target.questionBasis,
          questionTargetWorkload: workloadPromptView(target),
          estimateForWorkload: target.estimateForWorkload
            ? workloadPromptView(target.estimateForWorkload)
            : null,
        },
      }),
    },
  ];
}

export function parseFocusedContextualAnswerDecisionV5(
  raw: string,
): FocusedContextualAnswerDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    const decision = value.decision;
    const minutes = value.minutes;
    const precision = value.precision;
    const parsedQuantityRole = value.quantityRole;

    if (
      decision !== 'effort_answer'
      && decision !== 'remaining_effort_answer'
      && decision !== 'effort_per_unit_answer'
      && decision !== 'quantity_role_answer'
      && decision !== 'fallback'
    ) return null;

    if (
      decision === 'effort_answer'
      || decision === 'remaining_effort_answer'
      || decision === 'effort_per_unit_answer'
    ) {
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
      if (precision !== 'exact' && precision !== 'approximate' && precision !== 'unspecified') {
        return null;
      }
      if (parsedQuantityRole !== null) return null;
      return { decision, minutes, precision, quantityRole: null };
    }

    if (decision === 'quantity_role_answer') {
      if (minutes !== null || precision !== null) return null;
      if (
        parsedQuantityRole !== 'target'
        && parsedQuantityRole !== 'remaining'
        && parsedQuantityRole !== 'completed'
      ) return null;
      return { decision, minutes: null, precision: null, quantityRole: parsedQuantityRole };
    }

    if (minutes !== null || precision !== null || parsedQuantityRole !== null) return null;
    return { decision: 'fallback', minutes: null, precision: null, quantityRole: null };
  } catch {
    return null;
  }
}

function emptyDocument(): Omit<WeeklyPlanningSemanticDocumentV5, 'tasks'> {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function targetWithWorkload(
  target: FocusedContextualTargetV5,
  workload: FocusedContextualWorkloadV5,
): FocusedContextualTargetV5 {
  return {
    ...target,
    ...workload,
    estimateForWorkload: target.estimateForWorkload,
  };
}

function workloadForTarget(
  target: FocusedContextualTargetV5,
  sourceText: string,
  role: SemanticQuantityRoleV5 = target.quantityRole,
) {
  return {
    localId: target.publicId,
    quantityRole: role,
    amount: target.amount,
    unitCode: target.unitCode,
    unitLabel: target.unitLabel,
    rangeStart: target.rangeStart,
    rangeEnd: target.rangeEnd,
    perOccurrence: target.perOccurrence,
    periodExpression: target.periodExpression,
    sourceText,
  };
}

function taskForTarget(params: {
  target: FocusedContextualTargetV5;
  sourceText: string;
  workloadRole?: SemanticQuantityRoleV5;
  effortEstimate?: {
    kind: 'total_duration' | 'duration_per_unit';
    minutes: number;
    unitCode: SemanticWorkloadUnitCodeV5 | null;
    precision: 'exact' | 'approximate' | 'unspecified';
  };
}) {
  const workload = workloadForTarget(
    params.target,
    params.sourceText,
    params.workloadRole,
  );
  const effortEstimates = params.effortEstimate
    ? [{
        localId: 'focused_contextual_effort',
        targetLocalId: params.target.publicId,
        kind: params.effortEstimate.kind,
        minutes: params.effortEstimate.minutes,
        unitCode: params.effortEstimate.unitCode,
        precision: params.effortEstimate.precision,
        sourceText: params.sourceText,
      }]
    : [];
  return {
    localId: 'focused_contextual_task',
    existingPublicId: params.target.taskPublicId,
    decompositionStatus: 'atomic' as const,
    category: params.target.taskCategory,
    title: params.target.taskTitle,
    study: params.target.component
      ? {
          purpose: 'unknown' as const,
          contextLabel: null,
          components: [{
            localId: 'focused_contextual_component',
            existingPublicId: params.target.component.publicId,
            parentLocalId: null,
            role: params.target.component.role,
            label: params.target.component.label,
            workloads: [workload],
            durableContextSignals: [],
            sourceText: params.sourceText,
          }],
        }
      : null,
    workloads: params.target.component ? [] : [workload],
    effortEstimates,
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

function effortTargetForDecision(params: {
  target: FocusedContextualTargetV5;
  decision: FocusedContextualAnswerDecisionV5['decision'];
}): FocusedContextualTargetV5 | null {
  if (params.decision === 'effort_answer') return params.target;
  if (params.decision === 'remaining_effort_answer') {
    const estimateTarget = params.target.estimateForWorkload;
    if (!estimateTarget || estimateTarget.quantityRole !== 'remaining') return null;
    return targetWithWorkload(params.target, estimateTarget);
  }
  if (params.decision === 'effort_per_unit_answer') {
    return params.target.estimateForWorkload
      ? targetWithWorkload(params.target, params.target.estimateForWorkload)
      : params.target;
  }
  return null;
}

export function createFocusedContextualAnswerDocumentV5(params: {
  input: FocusedContextualAnswerInputV5;
  decision: FocusedContextualAnswerDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 | null {
  const target = focusedContextualTargetV5(params.input);
  if (!target || params.decision.decision === 'fallback') return null;

  const sourceText = params.input.userText;
  if (
    params.decision.decision === 'effort_answer'
    || params.decision.decision === 'remaining_effort_answer'
    || params.decision.decision === 'effort_per_unit_answer'
  ) {
    if (target.questionCode !== 'missing_effort_estimate') return null;
    const effortTarget = effortTargetForDecision({
      target,
      decision: params.decision.decision,
    });
    if (!effortTarget) return null;
    const perUnit = params.decision.decision === 'effort_per_unit_answer';
    return {
      ...emptyDocument(),
      tasks: [taskForTarget({
        target: effortTarget,
        sourceText,
        effortEstimate: {
          kind: perUnit ? 'duration_per_unit' : 'total_duration',
          minutes: params.decision.minutes as number,
          unitCode: perUnit ? effortTarget.unitCode : null,
          precision: params.decision.precision as 'exact' | 'approximate' | 'unspecified',
        },
      })],
    };
  }

  if (target.questionCode !== 'quantity_role_unresolved') return null;
  return {
    ...emptyDocument(),
    tasks: [taskForTarget({
      target,
      sourceText,
      workloadRole: params.decision.quantityRole as SemanticQuantityRoleV5,
    })],
  };
}
