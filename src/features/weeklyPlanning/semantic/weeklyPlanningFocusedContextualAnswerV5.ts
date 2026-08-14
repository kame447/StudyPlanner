import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticQuantityRoleV5,
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
          enum: ['effort_answer', 'quantity_role_answer', 'fallback'],
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
  'Interpret only the current answer to the machine-selected pending question; state already fixes the target identity and scale.',
  'For missing_effort_estimate, return effort_answer only for a direct duration answer and convert it to minutes. For quantity_role_unresolved, return quantity_role_answer only for clear target, remaining, or completed meaning. Any other change, discussion, or ambiguity is fallback; return only the schema.',
].join('\n');

type FocusedContextualQuestionCodeV5 =
  | 'missing_effort_estimate'
  | 'quantity_role_unresolved';

export interface FocusedContextualTargetV5 {
  questionCode: FocusedContextualQuestionCodeV5;
  graphRevision: number;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  quantityRole: string;
}

export interface FocusedContextualAnswerDecisionV5 {
  decision: 'effort_answer' | 'quantity_role_answer' | 'fallback';
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
  if (!Array.isArray(summary.workloads)) return null;

  const target = summary.workloads.find((candidate) =>
    isRecord(candidate) && candidate.publicId === pending.targetFactId);
  if (!isRecord(target)) return null;

  const unitCode = workloadUnitCode(target.unitCode);
  if (
    !unitCode
    || typeof target.amount !== 'number'
    || !Number.isFinite(target.amount)
    || target.amount <= 0
    || typeof target.unitLabel !== 'string'
  ) return null;

  return {
    questionCode,
    graphRevision: Number(pending.graphRevision),
    amount: target.amount,
    unitCode,
    unitLabel: target.unitLabel,
    quantityRole: typeof target.quantityRole === 'string' ? target.quantityRole : 'unknown',
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
      && decision !== 'quantity_role_answer'
      && decision !== 'fallback'
    ) return null;

    if (decision === 'effort_answer') {
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

export function createFocusedContextualAnswerDocumentV5(params: {
  input: FocusedContextualAnswerInputV5;
  decision: FocusedContextualAnswerDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 | null {
  const target = focusedContextualTargetV5(params.input);
  if (!target || params.decision.decision === 'fallback') return null;

  const sourceText = params.input.userText;
  if (params.decision.decision === 'effort_answer') {
    if (target.questionCode !== 'missing_effort_estimate') return null;
    return {
      ...emptyDocument(),
      tasks: [{
        localId: 'focused_contextual_task',
        existingPublicId: null,
        decompositionStatus: 'atomic',
        category: 'unknown',
        title: 'pending effort answer',
        study: null,
        workloads: [],
        effortEstimates: [{
          localId: 'focused_contextual_effort',
          targetLocalId: 'focused_contextual_task',
          kind: 'total_duration',
          minutes: params.decision.minutes as number,
          unitCode: null,
          precision: params.decision.precision as 'exact' | 'approximate' | 'unspecified',
          sourceText,
        }],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText,
      }],
    };
  }

  if (target.questionCode !== 'quantity_role_unresolved') return null;
  return {
    ...emptyDocument(),
    tasks: [{
      localId: 'focused_contextual_task',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'unknown',
      title: 'pending quantity-role answer',
      study: null,
      workloads: [{
        localId: 'focused_contextual_workload',
        quantityRole: params.decision.quantityRole as SemanticQuantityRoleV5,
        amount: target.amount,
        unitCode: target.unitCode,
        unitLabel: target.unitLabel,
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText,
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText,
    }],
  };
}
