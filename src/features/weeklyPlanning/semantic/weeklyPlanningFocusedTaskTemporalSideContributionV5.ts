import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  CANONICAL_RELATIVE_DATE_EXPRESSIONS,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  isCanonicalDateExpressionSyntax,
} from './weeklyPlanningCalendarResolver';
import {
  SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5,
  SEMANTIC_NAMED_TIME_PERIODS_V5,
  SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticConstraintLevelV5,
  type SemanticNamedTimePeriodV5,
  type SemanticTaskCategoryV5,
  type SemanticTemporalConstraintKindV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS = 320;

export const FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_task_temporal_side_contribution_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'decision',
        'kind',
        'constraintLevel',
        'dateExpression',
        'namedTimePeriod',
        'startTime',
        'endTime',
        'precision',
      ],
      properties: {
        decision: {
          type: 'string',
          enum: ['temporal_constraint', 'fallback'],
        },
        kind: {
          anyOf: [
            {
              type: 'string',
              enum: [
                ...SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5,
                ...SEMANTIC_TASK_DATE_RULE_KINDS_V5,
              ],
            },
            { type: 'null' },
          ],
        },
        constraintLevel: {
          anyOf: [
            { type: 'string', enum: [...SEMANTIC_CONSTRAINT_LEVELS_V5] },
            { type: 'null' },
          ],
        },
        dateExpression: {
          anyOf: [
            {
              type: 'string',
              enum: [
                ...CANONICAL_RELATIVE_DATE_EXPRESSIONS,
                ...CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
              ],
            },
            { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            { type: 'string', pattern: '^custom:.+$' },
            { type: 'null' },
          ],
        },
        namedTimePeriod: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        startTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        endTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        precision: {
          anyOf: [
            { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
            { type: 'null' },
          ],
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  'Interpret only whether currentUserText states a temporal constraint on knownTask. The existing pending question is context only and must not suppress a side contribution.',
  'Return temporal_constraint only when the current text clearly constrains when knownTask can, should, must, or must not occur or be completed. Return fallback for non-temporal meaning, plan-wide availability/unavailability, or ambiguous target/scope.',
  'Use deadline for completion-by timing; earliest_start/latest_end for one-sided bounds; fixed_interval for an exact occupied interval; preferred_window/avoid_window for soft task timing; allowed_date/excluded_date only for date eligibility without a clock.',
  `dateExpression is a machine representation, never copied natural-language date text. Use ISO YYYY-MM-DD, custom:<expression>, or one canonical token: ${[
    ...CANONICAL_RELATIVE_DATE_EXPRESSIONS,
    ...CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  ].join(', ')}. For example, a user-language expression meaning tomorrow must become tomorrow.`,
  'Preserve an explicitly stated clock in startTime/endTime as appropriate. Do not invent missing dates, clocks, or hardness.',
].join('\n');

interface ExistingTaskTargetV5 {
  publicId: string;
  category: SemanticTaskCategoryV5;
  title: string;
}

export interface FocusedTaskTemporalSideContributionDecisionV5 {
  decision: 'temporal_constraint' | 'fallback';
  kind: SemanticTemporalConstraintKindV5 | null;
  constraintLevel: SemanticConstraintLevelV5 | null;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function existingTaskTarget(
  publicStateSummary: Record<string, unknown> | undefined,
): ExistingTaskTargetV5 | null {
  if (!publicStateSummary || !isRecord(publicStateSummary.pendingQuestion)) return null;
  const targetFactId = publicStateSummary.pendingQuestion.targetFactId;
  if (typeof targetFactId !== 'string' || !targetFactId) return null;
  if (!Array.isArray(publicStateSummary.tasks)) return null;

  const task = publicStateSummary.tasks.find(
    (candidate) => isRecord(candidate) && candidate.publicId === targetFactId,
  );
  if (!isRecord(task)) return null;
  if (
    typeof task.publicId !== 'string'
    || typeof task.title !== 'string'
    || typeof task.category !== 'string'
    || !(SEMANTIC_TASK_CATEGORIES_V5 as readonly string[]).includes(task.category)
  ) return null;
  return {
    publicId: task.publicId,
    category: task.category as SemanticTaskCategoryV5,
    title: task.title,
  };
}

export function focusedTaskTemporalSideContributionEligibleV5(params: {
  publicStateSummary?: Record<string, unknown>;
}): boolean {
  return existingTaskTarget(params.publicStateSummary) !== null;
}

export function createFocusedTaskTemporalSideContributionMessagesV5(params: {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}): ChatMessage[] {
  const target = existingTaskTarget(params.publicStateSummary);
  if (!target) return [];
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: params.userText,
        knownTask: {
          publicId: target.publicId,
          category: target.category,
          title: target.title,
        },
      }),
    },
  ];
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function canonicalDateExpression(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && isCanonicalDateExpressionSyntax(value)
    ? value
    : undefined;
}

function temporalKind(value: unknown): SemanticTemporalConstraintKindV5 | null {
  if (typeof value !== 'string') return null;
  const supported = [
    ...SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5,
    ...SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  ] as readonly string[];
  return supported.includes(value) ? value as SemanticTemporalConstraintKindV5 : null;
}

function namedTimePeriod(value: unknown): SemanticNamedTimePeriodV5 | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  if ((SEMANTIC_NAMED_TIME_PERIODS_V5 as readonly string[]).includes(value)) {
    return value as SemanticNamedTimePeriodV5;
  }
  return value.startsWith('custom:') && value.length > 'custom:'.length
    ? value as SemanticNamedTimePeriodV5
    : undefined;
}

export function parseFocusedTaskTemporalSideContributionDecisionV5(
  raw: string,
): FocusedTaskTemporalSideContributionDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (value.decision === 'fallback') {
      if (
        value.kind !== null
        || value.constraintLevel !== null
        || value.dateExpression !== null
        || value.namedTimePeriod !== null
        || value.startTime !== null
        || value.endTime !== null
        || value.precision !== null
      ) return null;
      return {
        decision: 'fallback',
        kind: null,
        constraintLevel: null,
        dateExpression: null,
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: null,
      };
    }
    if (value.decision !== 'temporal_constraint') return null;

    const kind = temporalKind(value.kind);
    const level = typeof value.constraintLevel === 'string'
      && (SEMANTIC_CONSTRAINT_LEVELS_V5 as readonly string[]).includes(value.constraintLevel)
      ? value.constraintLevel as SemanticConstraintLevelV5
      : null;
    const dateExpression = canonicalDateExpression(value.dateExpression);
    const period = namedTimePeriod(value.namedTimePeriod);
    const startTime = nullableString(value.startTime);
    const endTime = nullableString(value.endTime);
    const precision = value.precision === 'exact'
      || value.precision === 'approximate'
      || value.precision === 'unspecified'
      ? value.precision
      : null;
    if (
      !kind
      || !level
      || dateExpression === undefined
      || period === undefined
      || startTime === undefined
      || endTime === undefined
      || !precision
    ) return null;
    return {
      decision: 'temporal_constraint',
      kind,
      constraintLevel: level,
      dateExpression,
      namedTimePeriod: period,
      startTime,
      endTime,
      precision,
    };
  } catch {
    return null;
  }
}

export function createFocusedTaskTemporalSideContributionDocumentV5(params: {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
  decision: FocusedTaskTemporalSideContributionDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 | null {
  if (params.decision.decision !== 'temporal_constraint') return null;
  const target = existingTaskTarget(params.publicStateSummary);
  if (
    !target
    || !params.decision.kind
    || !params.decision.constraintLevel
    || !params.decision.precision
  ) return null;

  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'focused_temporal_task',
      existingPublicId: target.publicId,
      decompositionStatus: 'atomic',
      category: target.category,
      title: target.title,
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'focused_temporal_constraint',
        targetLocalId: 'focused_temporal_task',
        kind: params.decision.kind,
        constraintLevel: params.decision.constraintLevel,
        dateExpression: params.decision.dateExpression,
        namedTimePeriod: params.decision.namedTimePeriod,
        startTime: params.decision.startTime,
        endTime: params.decision.endTime,
        precision: params.decision.precision,
        sourceText: params.userText,
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText: params.userText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}
