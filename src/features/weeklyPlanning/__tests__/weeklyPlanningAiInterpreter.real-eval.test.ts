import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';

const shouldRunRealAiEvaluation = process.env.WEEKLY_PLANNING_REAL_AI_EVAL === '1';
const evaluationCase = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation;
const stateSummary = {
  knownFields: [],
  confirmedSlots: ['planning_range'],
  planningRangeSummary: '2026-07-06〜2026-07-12',
};

interface DirectOpenAiEvalStatus {
  attempted: boolean;
  reachedApi: boolean;
  status?: number;
  error?: string;
  usage?: unknown;
}

interface DirectOpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: unknown;
  error?: {
    message?: string;
  };
}

function readEvalConfig(): AiConfig | null {
  const apiKey = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_API_KEY?.trim();
  const model = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_MODEL?.trim();

  if (!apiKey || !model) {
    return null;
  }

  return {
    provider: 'openai',
    baseUrl: process.env.WEEKLY_PLANNING_REAL_AI_EVAL_BASE_URL?.trim() || 'https://api.openai.com/v1',
    model,
    apiKey,
  };
}

function createDirectOpenAiEvalClient(
  config: AiConfig,
  status: DirectOpenAiEvalStatus,
): OpenAiCompatibleClient {
  return {
    async createChatCompletion({ messages, temperature = 0.1, responseFormat }) {
      status.attempted = true;

      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature,
            messages,
            response_format: responseFormat,
          }),
        });
        status.reachedApi = true;
        status.status = response.status;

        const data = (await response.json()) as DirectOpenAiResponse;
        status.usage = data.usage;

        if (!response.ok) {
          throw new Error(data.error?.message || `OpenAI request failed with status ${response.status}.`);
        }

        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error('OpenAI response was empty.');
        }

        return content;
      } catch (error) {
        status.error = error instanceof Error ? error.message : 'OpenAI request failed.';
        throw error;
      }
    },
  };
}

function hasRequiredExamScope(command: ParsedWeeklyPlanningCommand): boolean {
  return command.type === 'set_exam_scope' &&
    evaluationCase.fields.every((field) => command.scope.fields.includes(field)) &&
    command.scope.yearRange?.startYear === 2025 &&
    command.scope.yearRange.endYear === 2019;
}

function hasRequiredPriorityPolicy(command: ParsedWeeklyPlanningCommand): boolean {
  if (command.type !== 'set_priority_policy') {
    return false;
  }

  const policy = command.policy;
  if (policy.kind !== 'field_first') {
    return false;
  }

  return evaluationCase.fields.every((field) => policy.order.includes(field));
}

describe.skipIf(!shouldRunRealAiEvaluation)('weekly planning AI interpreter real evaluation', () => {
  it('records the first evaluation case result without prompt iteration', async () => {
    const config = readEvalConfig();

    if (!config) {
      console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
        skipped: true,
        reason: 'missing evaluation env: WEEKLY_PLANNING_REAL_AI_EVAL_API_KEY and WEEKLY_PLANNING_REAL_AI_EVAL_MODEL are required',
        reachedApi: false,
      }, null, 2));
      expect(true).toBe(true);
      return;
    }

    const status: DirectOpenAiEvalStatus = {
      attempted: false,
      reachedApi: false,
    };
    const startedAt = performance.now();
    const interpreterResult = await createAiWeeklyPlanningInterpreter(
      config,
      createDirectOpenAiEvalClient(config, status),
    ).interpretUserTurn({
      userText: evaluationCase.freeTextExamScopeAndPriority,
      context: { selectedDate: '2026-07-06', planningDayCount: 7 },
      stateSummary,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (status.error) {
      console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
        attempted: status.attempted,
        reachedApi: status.reachedApi,
        status: status.status,
        error: status.error,
        latencyMs,
        resultRecorded: false,
      }, null, 2));
      expect(true).toBe(true);
      return;
    }

    const diagnostics = validateInterpretedCandidates(interpreterResult.candidates, stateSummary);
    diagnostics.parseRejections = interpreterResult.parseRejections;
    const validatedCommands = [
      ...diagnostics.accepted,
      ...diagnostics.acceptedWithConfirmation,
    ];
    const passed =
      validatedCommands.some(hasRequiredExamScope) &&
      validatedCommands.some(hasRequiredPriorityPolicy);

    console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
      passed,
      attempted: status.attempted,
      reachedApi: status.reachedApi,
      status: status.status,
      latencyMs,
      candidates: interpreterResult.candidates,
      parseRejections: interpreterResult.parseRejections,
      accepted: diagnostics.accepted,
      acceptedWithConfirmation: diagnostics.acceptedWithConfirmation,
      clarifications: diagnostics.clarifications,
      rejected: diagnostics.rejected,
      tokenUsage: status.usage ?? 'unavailable: provider response did not include usage',
      cost: 'unavailable: cost is not computed by the evaluation harness',
    }, null, 2));

    expect(status.reachedApi).toBe(true);
  }, 60000);
});