import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const DATE_SET_NORMALIZATION_INSTRUCTION_V5 = [
  'For multiple non-consecutive explicit calendar dates that apply to one task, create one allowed_date temporal constraint per date. Do not collapse gaps into a continuous date range.',
  'For a repeating task on explicitly named weekdays, create one recurrence fact with kind weekly and a single days array using only sun, mon, tue, wed, thu, fri, sat.',
  'Expand weekday ranges before returning JSON. For example, 水曜と金曜から日曜 becomes days [wed, fri, sat, sun]. Keep the entire weekday set in one recurrence fact rather than splitting it into multiple recurrence facts.',
].join('\n');
const CONTEXTUAL_ANSWER_INSTRUCTION_V5 = [
  'Use recentConversation and publicStateSummary to interpret short answers to the immediately preceding assistant question.',
  'When the preceding question asks for the total time required and the user answers only a duration such as 3時間です, return exactly one minimal task containing exactly one effortEstimate with that duration in minutes. The task and target may use response-local IDs; the application core binds the structured answer to the single unresolved public fact.',
  'When the preceding question asks whether a quantity is the current target, remaining total, or completed amount, return exactly one minimal task containing exactly one workload with quantityRole target, remaining, or completed. Preserve the amount and unit visible in publicStateSummary when the short answer does not restate them.',
  'Do not select the target public fact yourself. Do not emit application commands or state mutations. Emit only the meaning of the short answer in the Stable V5 schema.',
].join('\n');
const AUTHORIZATION_INSTRUCTION_V5 = [
  'When the user only authorizes creation from the already accepted public state, for example この条件で予定を作って or それで仮予定を作って, set planningIntent to create_plan and return empty arrays for tasks, relations, availabilityDeclarations, constraintSourceRequests, uncertainties, corrections, and decisions unless the same utterance explicitly adds or changes a fact.',
  'Do not copy accepted tasks or constraints from publicStateSummary into a creation-authorization response. publicStateSummary is context, not a request to re-emit existing facts.',
  'When the user provides new planning facts and requests creation in the same utterance, set planningIntent to create_plan and include only those newly stated facts.',
].join('\n');

export interface WeeklyPlanningSemanticNormalizerInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticNormalizerDiagnosticsV5 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5;
  jsonSchemaName: typeof WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name;
  normalizerVersion: typeof WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
}

export interface WeeklyPlanningSemanticNormalizerResultV5 {
  status: 'accepted' | 'rejected' | 'provider_failure';
  document: WeeklyPlanningSemanticDocumentV5 | null;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV5;
}

export interface WeeklyPlanningSemanticNormalizerV5 {
  normalize(
    input: WeeklyPlanningSemanticNormalizerInputV5,
  ): Promise<WeeklyPlanningSemanticNormalizerResultV5>;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Unknown Stable V5 semantic provider error.';
}

function createBaseMessages(input: WeeklyPlanningSemanticNormalizerInputV5): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticSystemPromptV5(),
        DATE_SET_NORMALIZATION_INSTRUCTION_V5,
        CONTEXTUAL_ANSWER_INSTRUCTION_V5,
        AUTHORIZATION_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV5(input) },
  ];
}

function createRepairMessages(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
}): ChatMessage[] {
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Return the complete corrected Stable V5 JSON document only. Preserve the user meaning. Do not invent external events, facts, commands, questions, readiness decisions, preview decisions, schedule placements, approval decisions, or save decisions.',
        validationErrors: params.validationErrors,
      }),
    },
  ];
}

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const startedAt = performance.now();
      const requestBytes: number[] = [];
      const responseLengths: number[] = [];
      const baseMessages = createBaseMessages(input);
      const call = async (messages: ChatMessage[]): Promise<string> => {
        requestBytes.push(byteLength({
          purpose: 'weekly_planning_semantic_normalizer',
          messages,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
          maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
        }));
        const response = await client.createChatCompletion({
          messages,
          temperature: 0,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
        });
        responseLengths.push(response.length);
        return response;
      };

      const diagnostics = (params: {
        attemptCount: number;
        repairAttempted: boolean;
        validationErrors: string[];
        providerError: string | null;
      }): WeeklyPlanningSemanticNormalizerDiagnosticsV5 => ({
        schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
        jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
        normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
        attemptCount: params.attemptCount,
        repairAttempted: params.repairAttempted,
        requestBytes,
        responseLengths,
        latencyMs: Math.round(performance.now() - startedAt),
        validationErrors: params.validationErrors,
        providerError: params.providerError,
      });

      let initialResponse: string;
      try {
        initialResponse = await call(baseMessages);
      } catch (error) {
        return {
          status: 'provider_failure',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: errorMessage(error),
          }),
        };
      }

      const initialParse = parseWeeklyPlanningSemanticDocumentV5(initialResponse);
      if (initialParse.document) {
        return {
          status: 'accepted',
          document: initialParse.document,
          diagnostics: diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: null,
          }),
        };
      }

      const repairMessages = createRepairMessages({
        baseMessages,
        invalidResponse: initialResponse,
        validationErrors: initialParse.errors,
      });

      let repairedResponse: string;
      try {
        repairedResponse = await call(repairMessages);
      } catch (error) {
        return {
          status: 'provider_failure',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: initialParse.errors,
            providerError: errorMessage(error),
          }),
        };
      }

      const repairedParse = parseWeeklyPlanningSemanticDocumentV5(repairedResponse);
      if (!repairedParse.document) {
        return {
          status: 'rejected',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: [
              ...initialParse.errors.map((value) => `initial:${value}`),
              ...repairedParse.errors.map((value) => `repair:${value}`),
            ],
            providerError: null,
          }),
        };
      }

      return {
        status: 'accepted',
        document: repairedParse.document,
        diagnostics: diagnostics({
          attemptCount: 2,
          repairAttempted: true,
          validationErrors: initialParse.errors,
          providerError: null,
        }),
      };
    },
  };
}
