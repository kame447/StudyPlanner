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
  'Interpret only the current answer to the machine-selected pending question; state fixes the target identity, but the user may answer effort in a different measurement scale.',
  'For missing_effort_estimate, use effort_answer for a total duration and effort_per_unit_answer for an explicit per-unit duration; convert the stated duration to minutes without multiplying by workload amount. For quantity_role_unresolved, use quantity_role_answer only for clear target, remaining, or completed meaning. Any other change, discussion, or ambiguity is fallback.',
].join('\n');

type FocusedContextualQuestionCodeV5 =
  | 'missing_effort_estimate'
  | 'quantity_role_unresolved';

interface FocusedContextualComponentV5 {
  publicId: string;
  role: SemanticComponentRoleV5;
  label: string;
}

export interface FocusedContextualTargetV5 {
  questionCode: FocusedContextualQuestionCodeV5;
  graphRevision: number;
  publicId: string;
  taskPublicId: string;
  taskCategory: SemanticTaskCategoryV5;
  taskTitle: string;
  component: FocusedContextualComponentV5 | null;
  quantityRole: SemanticQuantityRoleV5;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
}

export interface FocusedContextualAnswerDecisionV5 {
  decision:
    | 'effort_answer'
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

  const target = summary.workloads.find((candidate) =>
    isRecord(candidate) && candidate.publicId === pending.targetFactId);
  if (!isRecord(target)) return null;

  const unitCode = workloadUnitCode(target.unitCode);
  const targetQuantityRole = quantityRole(target.quantityRole);
  const rangeStart = nullableString(target.rangeStart);
  const rangeEnd = nullableString(target.rangeEnd);
  const periodExpression = nullableString(target.periodExpression);
  if (
    !unitCode
    || !targetQuantityRole
    || typeof target.publicId !== 'string'
    || !target.publicId
    || typeof target.taskPublicId !== 'string'
    || !target.taskPublicId
    || typeof target.amount !== 'number'
    || !Number.isFinite(target.amount)
    || target.amount <= 0
    || typeof target.unitLabel !== 'string'
    || rangeStart === undefined
    || rangeEnd === undefined
    || typeof target.perOccurrence !== 'boolean'
    || periodExpression === undefined
  ) return null;

  const task = summary.tasks.find((candidate) =>
    isRecord(candidate) && candidate.publicId === target.taskPublicId);
  if (!isRecord(task)) return null;
  const category = taskCategory(task.category);
  if (!category || typeof task.title !== 'string') return null;

  let component: FocusedContextualComponentV5 | null = null;
  if (target.componentPublicId !== null) {
    if (
      typeof target.componentPublicId !== 'string'
      || !target.componentPublicId
      || !Array.isArray(summary.components)
    ) return null;
    const matchingComponent = summary.components.find((candidate) =>
      isRecord(candidate)
      && candidate.publicId === target.componentPublicId
      && candidate.taskPublicId === target.taskPublicId);
    if (!isRecord(matchingComponent)) return null;
    const role = componentRole(matchingComponent.role);
    if (!role || typeof matchingComponent.label !== 'string') return null;
    component = {
      publicId: target.componentPublicId,
      role,
      label: matchingComponent.label,
    };
  }

  return {
    questionCode,
    graphRevision: Number(pending.graphRevision),
    publicId: target.publicId,
    taskPublicId: target.taskPublicId,
    taskCategory: category,
    taskTitle: task.title,
    component,
    quantityRole: targetQuantityRole,
    amount: target.amount,
    unitCode,
    unitLabel: target.unitLabel,
    rangeStart,
    rangeEnd,
    perOccurrence: target.perOccurrence,
    periodExpression,
  };
}

export function focusedContextualAnswerEligibleV5(
  input: FocusedContextualAnswerInputV5,
): boolean {
  return focusedContextualTargetV5(input) !== null;
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
          targetWorkload: {
            amount: target.amount,
            unitCode: target.unitCode,
            unitLabel: target.unitLabel,
            quantityRole: target.quantityRole,
          },
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
    const quantityRole = value.quantityRole;

    if (
      decision !== 'effort_answer'
      && decision !== 'effort_per_unit_answer'
      && decision !== 'quantity_role_answer'
      && decision !== 'fallback'
    ) return null;

    if (decision === 'effort_answer' || decision === 'effort_per_unit_answer') {
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
      if (precision !== 'exact' && precision !== 'approximate' && precision !== 'unspecified') {
        return null;
      }
      if (quantityRole !== null) return null;
      return { decision, minutes, precision, quantityRole: null };
    }

    if (decision === 'quantity_role_answer') {
      if (minutes !== null || precision !== null) return null;
      if (quantityRole !== 'target' && quantityRole !== 'remaining' && quantityRole !== 'completed') {
        return null;
      }
      return { decision, minutes: null, precision: null, quantityRole };
    }

    if (minutes !== null || precision !== null || quantityRole !== null) return null;
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

export function createFocusedContextualAnswerDocumentV5(params: {
  input: FocusedContextualAnswerInputV5;
  decision: FocusedContextualAnswerDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 | null {
  const target = focusedContextualTargetV5(params.input);
  if (!target || params.decision.decision === 'fallback') return null;

  const sourceText = params.input.userText;
  if (
    params.decision.decision === 'effort_answer'
    || params.decision.decision === 'effort_per_unit_answer'
  ) {
    if (target.questionCode !== 'missing_effort_estimate') return null;
    const perUnit = params.decision.decision === 'effort_per_unit_answer';
    return {
      ...emptyDocument(),
      tasks: [taskForTarget({
        target,
        sourceText,
        effortEstimate: {
          kind: perUnit ? 'duration_per_unit' : 'total_duration',
          minutes: params.decision.minutes as number,
          unitCode: perUnit ? target.unitCode : null,
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
