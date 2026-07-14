import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  renderBehaviorAwareDialogueFallback,
} from '../planning/weeklyPlanningBehaviorPlanner';
import {
  validateBehaviorAwareDialogueResponseStrict,
} from '../planning/weeklyPlanningBehaviorSafety';
import type {
  AllowedDialogueAction,
  BehaviorAwareDialogueResponse,
  PlanningHypothesisSnapshot,
} from '../planning/weeklyPlanningBehaviorTypes';

export interface BehaviorAwareDialoguePlannerInput {
  snapshot: PlanningHypothesisSnapshot;
  allowedActions: AllowedDialogueAction[];
  acceptedFacts: {
    taskLabels: string[];
    planningPeriodLabel?: string;
    constraintSummary: string[];
  };
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previewAllowed: boolean;
}

export interface BehaviorAwareDialoguePlannerResult {
  message: string;
  response: BehaviorAwareDialogueResponse | null;
  source: 'ai' | 'deterministic_fallback';
}

function stringSchema(): Record<string, unknown> {
  return { type: 'string' };
}

export const WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_behavior_dialogue',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedActionIds', 'items'],
      properties: {
        acknowledgement: stringSchema(),
        selectedActionIds: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: stringSchema(),
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['actionId', 'text'],
            properties: {
              actionId: stringSchema(),
              text: stringSchema(),
              optionIds: {
                type: 'array',
                uniqueItems: true,
                items: stringSchema(),
              },
            },
          },
        },
        reasoningSummary: stringSchema(),
      },
    },
  },
};

function createSystemPrompt(): string {
  return [
    'You are the Japanese dialogue planner for a study-planning application.',
    'Return only JSON matching the response schema.',
    'The deterministic application core has already decided every action you may perform.',
    'Select only actionId values in allowedActions. Never invent an action, option, fact, deadline, time, proposal, or scheduling result.',
    'Use one or two substantive actions in normal turns and never more than three.',
    'Every selectedActionId must have exactly one matching items entry.',
    'Briefly acknowledge the latest accepted information, explain a safe planning hypothesis when available, and ask only the highest-impact remaining confirmation.',
    'When a safe default or finite options are allowed, present those before asking an unrestricted free-answer question.',
    'Do not expose internal names such as readiness, blockingDimensions, reasonCode, suitability, sourceFactRefs, proposalRef, or slotKey.',
    'Do not claim that a plan was saved, confirmed, registered, or added. A preview is not a saved plan.',
    'Do not claim preview generation unless generate_preview is present in allowedActions.',
    'Keep the tone like a calm, practical tutor. Keep each item concise and easy to correct.',
  ].join('\n');
}

function createUserPrompt(input: BehaviorAwareDialoguePlannerInput): string {
  return JSON.stringify({
    acceptedFacts: input.acceptedFacts,
    planningHypothesis: {
      taskProfiles: input.snapshot.taskProfiles.map((profile) => ({
        taskRef: profile.taskRef,
        activityKind: profile.activityKind,
        distributionPolicy: profile.distributionPolicy,
        cognitiveLoad: profile.cognitiveLoad,
      })),
      lifeActivityAnchors: input.snapshot.lifeActivityAnchors.map((anchor) => ({
        anchorId: anchor.anchorId,
        kind: anchor.kind,
        date: anchor.date,
        startTime: anchor.startTime,
        endTime: anchor.endTime,
      })),
      opportunityAnnotations: input.snapshot.opportunityAnnotations.map((annotation) => ({
        availabilityRangeRef: annotation.availabilityRangeRef,
        tags: annotation.tags,
      })),
      suggestedNextAction: input.snapshot.suggestedNextAction,
    },
    allowedActions: input.allowedActions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      topicId: action.topicId,
      allowedProposalRefs: action.allowedProposalRefs,
      allowedOptionIds: action.allowedOptionIds,
      maxItems: action.maxItems,
      displayHint: action.displayHint,
    })),
    recentConversation: input.recentConversation?.slice(-6),
    previewAllowed: input.previewAllowed,
    styleConstraints: {
      language: 'ja',
      tone: 'practical_tutor',
      maxItems: 3,
      preferredItems: 2,
    },
  });
}

function parseResponse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function composeMessage(response: BehaviorAwareDialogueResponse): string {
  return [
    response.acknowledgement,
    ...response.items.map((item) => item.text),
    response.reasoningSummary,
  ].filter((part): part is string => Boolean(part?.trim())).join('\n');
}

export function createAiBehaviorAwareWeeklyPlanningDialoguePlanner(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
} {
  return {
    async plan(input) {
      try {
        const content = await client.createChatCompletion({
          messages: [
            { role: 'system', content: createSystemPrompt() },
            { role: 'user', content: createUserPrompt(input) },
          ],
          temperature: 0.2,
          responseFormat: WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT,
          purpose: 'weekly_planning_renderer',
        });
        const response = validateBehaviorAwareDialogueResponseStrict({
          response: parseResponse(content),
          actions: input.allowedActions,
          previewAllowed: input.previewAllowed,
        });

        if (response) {
          return {
            message: composeMessage(response),
            response,
            source: 'ai' as const,
          };
        }
      } catch {
        // Provider and parsing failures use the same deterministic action-aware fallback.
      }

      return {
        message: renderBehaviorAwareDialogueFallback({
          snapshot: input.snapshot,
          actions: input.allowedActions,
        }),
        response: null,
        source: 'deterministic_fallback' as const,
      };
    },
  };
}

export function createDeterministicBehaviorAwareDialoguePlanner(): {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
} {
  return {
    async plan(input) {
      return {
        message: renderBehaviorAwareDialogueFallback({
          snapshot: input.snapshot,
          actions: input.allowedActions,
        }),
        response: null,
        source: 'deterministic_fallback',
      };
    },
  };
}
