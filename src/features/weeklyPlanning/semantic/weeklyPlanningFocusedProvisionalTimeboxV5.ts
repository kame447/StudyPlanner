import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  focusedContextualTargetV5,
} from './weeklyPlanningFocusedContextualAnswerV5';
import type {
  WeeklyPlanningSemanticNormalizerResultV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  semanticNormalizerErrorDetails,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';

export const FOCUSED_PROVISIONAL_TIMEBOX_MAX_COMPLETION_TOKENS = 160;

export const FOCUSED_PROVISIONAL_TIMEBOX_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_provisional_timebox_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'effortDisposition', 'allocationMode'],
      properties: {
        decision: {
          type: 'string',
          enum: ['provisional_timebox', 'fallback'],
        },
        effortDisposition: {
          anyOf: [
            { type: 'string', enum: ['unavailable'] },
            { type: 'null' },
          ],
        },
        allocationMode: {
          anyOf: [
            { type: 'string', enum: ['available_capacity'] },
            { type: 'null' },
          ],
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  'Interpret currentUserText only as a response to the typed missing-effort question.',
  'Return provisional_timebox only when the user clearly says the requested effort value is unknown or should not be asserted, and explicitly asks to continue planning by assigning currently available schedule time provisionally.',
  'A provisional timebox is scheduling capacity only. It is not a fact or estimate of how long completion requires, and it must never imply a quantity needed to finish.',
  'Do not invent workloads, quantities, comparison targets, relation endpoints, dates, availability, or effort.',
  'If the turn introduces an independent new planning fact or correction that must be represented in the Fact Graph, return fallback so the full semantic route can handle it.',
  'An underspecified priority reminder without an explicit comparison target must never be expanded into new relation endpoints. If it is only compatible reiteration of existing planning context, it does not prevent provisional_timebox.',
  'For fallback, effortDisposition and allocationMode must both be null.',
].join('\n');

interface ProvisionalTimeboxDecision {
  decision: 'provisional_timebox' | 'fallback';
  effortDisposition: 'unavailable' | null;
  allocationMode: 'available_capacity' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDecision(raw: string): ProvisionalTimeboxDecision | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (value.decision === 'provisional_timebox') {
      if (
        value.effortDisposition !== 'unavailable'
        || value.allocationMode !== 'available_capacity'
      ) return null;
      return {
        decision: 'provisional_timebox',
        effortDisposition: 'unavailable',
        allocationMode: 'available_capacity',
      };
    }
    if (value.decision !== 'fallback') return null;
    if (value.effortDisposition !== null || value.allocationMode !== null) return null;
    return {
      decision: 'fallback',
      effortDisposition: null,
      allocationMode: null,
    };
  } catch {
    return null;
  }
}

function noOpUpdateDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function currentRelations(summary: Record<string, unknown> | undefined): unknown[] {
  return Array.isArray(summary?.relations) ? summary.relations : [];
}

export async function tryFocusedProvisionalTimeboxRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const target = focusedContextualTargetV5(run.input);
  if (!target || target.questionCode !== 'missing_effort_estimate') return null;

  const request = {
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: JSON.stringify({
          currentUserText: run.input.userText,
          pendingQuestion: {
            questionCode: target.questionCode,
            questionTargetWorkload: {
              publicId: target.publicId,
              taskPublicId: target.taskPublicId,
              taskTitle: target.taskTitle,
              componentLabel: target.component?.label ?? null,
              quantityRole: target.quantityRole,
              amount: target.amount,
              unitCode: target.unitCode,
              unitLabel: target.unitLabel,
            },
          },
          existingRelations: currentRelations(run.input.publicStateSummary),
        }),
      },
    ],
    temperature: 0,
    responseFormat: FOCUSED_PROVISIONAL_TIMEBOX_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_PROVISIONAL_TIMEBOX_MAX_COMPLETION_TOKENS,
  };

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'focused_provisional_timebox_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'route_from_machine_pending_question',
        'apply_provisional_scheduler_projection_without_fact_mutation',
      ],
    },
  });

  try {
    const response = await run.callTracked(request, 'focused_provisional_timebox');
    const decision = parseDecision(response);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: run.input.traceRequestId,
      stage: 'semantic_focused_provisional_timebox_result',
      data: {
        decision: decision?.decision ?? 'invalid_response',
        effortDisposition: decision?.effortDisposition ?? null,
        allocationMode: decision?.allocationMode ?? null,
        rawResponse: response,
      },
    });
    if (decision?.decision !== 'provisional_timebox') return null;

    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'accepted',
      document: noOpUpdateDocument(),
      contextualDirective: {
        kind: 'provisional_timebox',
        scope: 'current_missing_effort',
      },
      diagnostics: run.diagnostics({
        attemptCount: 1,
        repairAttempted: false,
        validationErrors: [],
        providerError: null,
      }),
    };
    run.recordDecision(result, { route: 'focused_provisional_timebox' });
    return result;
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: run.input.traceRequestId,
      stage: 'semantic_focused_provisional_timebox_error',
      severity: 'warn',
      data: {
        error: semanticNormalizerErrorDetails(error),
        fallback: 'generic_semantic',
      },
    });
    return null;
  }
}
