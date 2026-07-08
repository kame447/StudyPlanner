import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type {
  CandidateValidationResult,
  InterpreterStateSummary,
} from '../intake/weeklyPlanningInterpreterTypes';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';

const shouldRunRealAiEvaluation = process.env.WEEKLY_PLANNING_REAL_AI_EVAL === '1';
const foundationCase = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation;
const semanticIntentCases = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.semanticIntent;

// 用途別 model の比較実行。既定は本番 routing と同じ2 model。
// 明示指定したい場合のみ WEEKLY_PLANNING_REAL_AI_EVAL_MODELS(カンマ区切り)/ _MODEL(単一)で上書きする。
const DEFAULT_EVAL_MODELS = ['gpt-5.4-nano-2026-03-17', 'gpt-5.4-mini-2026-03-17'];

// 推定コスト用の単価(USD / 1,000,000 tokens)。実請求とは別の見積り。実単価に合わせて更新すること。
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'gpt-5.4-nano-2026-03-17': { prompt: 0.05, completion: 0.4 },
  'gpt-5.4-mini-2026-03-17': { prompt: 0.25, completion: 2.0 },
};

const baseStateSummary: InterpreterStateSummary = {
  knownFields: [],
  confirmedSlots: ['planning_range'],
  planningRangeSummary: '2026-07-06〜2026-07-12',
};

// use_constraint_source 系: 現在 active な参照元(timetable / existing_plans)を利用可能にして評価する。
// calendar は未実装のため false(AI が利用可能と誤認しないことを本番と揃える)。
const constraintSourceStateSummary: InterpreterStateSummary = {
  ...baseStateSummary,
  availableConstraintSources: { timetable: true, existingPlans: true, calendar: false },
};

type EvalGroup =
  | 'foundation'
  | 'unambiguous_timetable'
  | 'unambiguous_existing_plans'
  | 'ambiguous'
  | 'clarification'
  | 'negative';

const POSITIVE_INTENT_GROUPS: EvalGroup[] = [
  'foundation',
  'unambiguous_timetable',
  'unambiguous_existing_plans',
  'clarification',
];

interface DirectOpenAiEvalStatus {
  attempted: boolean;
  reachedApi: boolean;
  status?: number;
  error?: string;
  usage?: unknown;
}

interface DirectOpenAiResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: unknown;
  error?: { message?: string };
}

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

interface EvalContext {
  commands: ParsedWeeklyPlanningCommand[];
  diagnostics: CandidateValidationResult;
}

interface EvalCase {
  id: string;
  group: EvalGroup;
  userText: string;
  stateSummary: InterpreterStateSummary;
  evaluate: (ctx: EvalContext) => Record<string, boolean>;
}

function readEvalApiKey(): string | null {
  return process.env.WEEKLY_PLANNING_REAL_AI_EVAL_API_KEY?.trim() || null;
}

function resolveEvalModels(): string[] {
  const list = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_MODELS?.trim();
  if (list) {
    return list.split(',').map((model) => model.trim()).filter(Boolean);
  }

  const single = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_MODEL?.trim();
  if (single) {
    return [single];
  }

  return DEFAULT_EVAL_MODELS;
}

function buildConfig(apiKey: string, model: string): AiConfig {
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
  // dev direct path を維持(proxy には切り替えない)。model は config.model を直接使う。
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
    foundationCase.fields.every((field) => command.scope.fields.includes(field)) &&
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

  return foundationCase.fields.every((field) => policy.order.includes(field));
}

function hasConstraintSourceKind(commands: ParsedWeeklyPlanningCommand[], kind: 'timetable' | 'existing_plans'): boolean {
  return commands.some(
    (command) =>
      command.type === 'use_constraint_source' &&
      command.source.selector === 'active' &&
      command.source.kind === kind,
  );
}

function hardAppliedConstraintSource(diagnostics: CandidateValidationResult): boolean {
  return diagnostics.accepted.some((command) => command.type === 'use_constraint_source');
}

function requestedClarification(ctx: EvalContext): boolean {
  return ctx.commands.some((command) => command.type === 'request_clarification') ||
    ctx.diagnostics.clarificationRequests.length > 0;
}

function firedForbiddenIntent(commands: ParsedWeeklyPlanningCommand[]): boolean {
  return commands.some(
    (command) => command.type === 'use_constraint_source' || command.type === 'request_clarification',
  );
}

function buildEvalCases(): EvalCase[] {
  const cases: EvalCase[] = [
    {
      id: 'foundation:exam_scope+priority',
      group: 'foundation',
      userText: foundationCase.freeTextExamScopeAndPriority,
      stateSummary: baseStateSummary,
      evaluate: ({ commands }) => ({
        intent:
          commands.some((command) => command.type === 'set_exam_scope') &&
          commands.some((command) => command.type === 'set_priority_policy'),
        payload: commands.some(hasRequiredExamScope) && commands.some(hasRequiredPriorityPolicy),
      }),
    },
  ];

  semanticIntentCases.useConstraintSourceUnambiguousTimetable.forEach((text, index) => {
    cases.push({
      id: `unambiguous_timetable:${index}`,
      group: 'unambiguous_timetable',
      userText: text,
      stateSummary: constraintSourceStateSummary,
      evaluate: ({ commands }) => ({
        intent: commands.some((command) => command.type === 'use_constraint_source'),
        payload: hasConstraintSourceKind(commands, 'timetable'),
      }),
    });
  });

  semanticIntentCases.useConstraintSourceUnambiguousExistingPlans.forEach((text, index) => {
    cases.push({
      id: `unambiguous_existing_plans:${index}`,
      group: 'unambiguous_existing_plans',
      userText: text,
      stateSummary: constraintSourceStateSummary,
      evaluate: ({ commands }) => ({
        intent: commands.some((command) => command.type === 'use_constraint_source'),
        payload: hasConstraintSourceKind(commands, 'existing_plans'),
      }),
    });
  });

  semanticIntentCases.useConstraintSourceAmbiguous.forEach((text, index) => {
    cases.push({
      id: `ambiguous:${index}`,
      group: 'ambiguous',
      userText: text,
      stateSummary: constraintSourceStateSummary,
      // 単一 source に勝手に hard 確定しないこと(notHardApplied)を最優先で測り、
      // clarification に倒れたか(clarified)を併記する。
      evaluate: (ctx) => ({
        notHardApplied: !hardAppliedConstraintSource(ctx.diagnostics),
        clarified: requestedClarification(ctx),
      }),
    });
  });

  semanticIntentCases.requestClarificationParaphrases.forEach((text, index) => {
    cases.push({
      id: `clarification:${index}`,
      group: 'clarification',
      userText: text,
      stateSummary: baseStateSummary,
      evaluate: ({ commands }) => ({
        intent: commands.some((command) => command.type === 'request_clarification'),
        payload: commands.some(
          (command) =>
            command.type === 'request_clarification' &&
            (command.target === 'referenced_question' ||
              command.target === 'referenced_term' ||
              command.target === 'unresolved_slot'),
        ),
      }),
    });
  });

  semanticIntentCases.negativeCases.forEach((text, index) => {
    cases.push({
      id: `negative:${index}`,
      group: 'negative',
      userText: text,
      stateSummary: constraintSourceStateSummary,
      evaluate: ({ commands }) => ({
        noFalseFire: !firedForbiddenIntent(commands),
      }),
    });
  });

  return cases;
}

function readUsage(usage: unknown): TokenUsage | null {
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const prompt = typeof record.prompt_tokens === 'number' ? record.prompt_tokens : undefined;
  const completion = typeof record.completion_tokens === 'number' ? record.completion_tokens : undefined;
  const total = typeof record.total_tokens === 'number' ? record.total_tokens : undefined;

  if (prompt === undefined && completion === undefined && total === undefined) {
    return null;
  }

  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  return {
    prompt: promptTokens,
    completion: completionTokens,
    total: total ?? promptTokens + completionTokens,
  };
}

function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return null;
  }

  return (usage.prompt / 1_000_000) * pricing.prompt + (usage.completion / 1_000_000) * pricing.completion;
}

interface CaseOutcome {
  id: string;
  group: EvalGroup;
  reachedApi: boolean;
  error?: string;
  metrics: Record<string, boolean>;
  candidateCount: number;
  rejectedCount: number;
  parseRejectionCount: number;
  latencyMs: number;
}

async function evaluateModel(apiKey: string, model: string, cases: EvalCase[]): Promise<{
  model: string;
  outcomes: CaseOutcome[];
  usage: TokenUsage;
  usageAvailable: boolean;
}> {
  const config = buildConfig(apiKey, model);
  const outcomes: CaseOutcome[] = [];
  const usage: TokenUsage = { prompt: 0, completion: 0, total: 0 };
  let usageAvailable = false;

  for (const evalCase of cases) {
    const status: DirectOpenAiEvalStatus = { attempted: false, reachedApi: false };
    const startedAt = performance.now();
    const interpreterResult = await createAiWeeklyPlanningInterpreter(
      config,
      createDirectOpenAiEvalClient(config, status),
    ).interpretUserTurn({
      userText: evalCase.userText,
      context: { selectedDate: '2026-07-06', planningDayCount: 7 },
      stateSummary: evalCase.stateSummary,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    const parsedUsage = readUsage(status.usage);
    if (parsedUsage) {
      usageAvailable = true;
      usage.prompt += parsedUsage.prompt;
      usage.completion += parsedUsage.completion;
      usage.total += parsedUsage.total;
    }

    if (status.error || !status.reachedApi) {
      outcomes.push({
        id: evalCase.id,
        group: evalCase.group,
        reachedApi: status.reachedApi,
        error: status.error ?? 'call did not reach the API',
        metrics: {},
        candidateCount: 0,
        rejectedCount: 0,
        parseRejectionCount: 0,
        latencyMs,
      });
      continue;
    }

    const diagnostics = validateInterpretedCandidates(interpreterResult.candidates, evalCase.stateSummary);
    diagnostics.parseRejections = interpreterResult.parseRejections;
    const commands = interpreterResult.candidates.map((candidate) => candidate.command);

    outcomes.push({
      id: evalCase.id,
      group: evalCase.group,
      reachedApi: true,
      metrics: evalCase.evaluate({ commands, diagnostics }),
      candidateCount: interpreterResult.candidates.length,
      rejectedCount: diagnostics.rejected.length,
      parseRejectionCount: diagnostics.parseRejections.length,
      latencyMs,
    });
  }

  return { model, outcomes, usage, usageAvailable };
}

function meanBool(values: boolean[]): number | null {
  return values.length === 0 ? null : Number((values.filter(Boolean).length / values.length).toFixed(3));
}

function metricValues(outcomes: CaseOutcome[], groups: EvalGroup[], key: string): boolean[] {
  return outcomes
    .filter((outcome) => groups.includes(outcome.group) && key in outcome.metrics)
    .map((outcome) => outcome.metrics[key]);
}

function summarizeByGroup(outcomes: CaseOutcome[]): Record<string, Record<string, number | null>> {
  const byGroup: Record<string, Record<string, number | null>> = {};

  for (const outcome of outcomes) {
    const bucket = (byGroup[outcome.group] ??= {});
    for (const key of Object.keys(outcome.metrics)) {
      bucket[key] = meanBool(metricValues(outcomes, [outcome.group], key));
    }
  }

  return byGroup;
}

function summarizeModel(result: Awaited<ReturnType<typeof evaluateModel>>) {
  const evaluated = result.outcomes.filter((outcome) => outcome.reachedApi && !outcome.error);
  const totalCandidates = evaluated.reduce(
    (sum, outcome) => sum + outcome.candidateCount + outcome.parseRejectionCount,
    0,
  );
  const totalRejected = evaluated.reduce(
    (sum, outcome) => sum + outcome.rejectedCount + outcome.parseRejectionCount,
    0,
  );
  const latencies = evaluated.map((outcome) => outcome.latencyMs);
  const cost = result.usageAvailable ? estimateCostUsd(result.model, result.usage) : null;

  return {
    model: result.model,
    casesEvaluated: evaluated.length,
    casesErrored: result.outcomes.length - evaluated.length,
    intentAccuracy: meanBool(metricValues(evaluated, POSITIVE_INTENT_GROUPS, 'intent')),
    payloadAccuracy: meanBool(metricValues(evaluated, POSITIVE_INTENT_GROUPS, 'payload')),
    ambiguousNotHardAppliedRate: meanBool(metricValues(evaluated, ['ambiguous'], 'notHardApplied')),
    ambiguousClarifiedRate: meanBool(metricValues(evaluated, ['ambiguous'], 'clarified')),
    negativeFalseFireRate: meanBool(metricValues(evaluated, ['negative'], 'noFalseFire').map((value) => !value)),
    validatorRejectRate: totalCandidates === 0 ? null : Number((totalRejected / totalCandidates).toFixed(3)),
    latencyMs: {
      total: latencies.reduce((sum, value) => sum + value, 0),
      average: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    },
    tokenUsage: result.usageAvailable ? result.usage : 'unavailable: provider response did not include usage',
    estimatedCostUsd: cost === null
      ? 'unavailable: no usage or no pricing entry for model (see MODEL_PRICING)'
      : Number(cost.toFixed(6)),
    byGroup: summarizeByGroup(evaluated),
    failures: result.outcomes
      .filter((outcome) =>
        Boolean(outcome.error) ||
        Object.entries(outcome.metrics).some(([key, value]) => key !== 'clarified' && value === false))
      .map((outcome) => ({ id: outcome.id, error: outcome.error, metrics: outcome.metrics })),
  };
}

describe.skipIf(!shouldRunRealAiEvaluation)('weekly planning AI interpreter real evaluation', () => {
  it('compares semantic-intent golden cases across the routed models', async () => {
    const apiKey = readEvalApiKey();

    if (!apiKey) {
      console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
        skipped: true,
        reason: 'missing evaluation env: WEEKLY_PLANNING_REAL_AI_EVAL_API_KEY is required',
        reachedApi: false,
      }, null, 2));
      expect(true).toBe(true);
      return;
    }

    const models = resolveEvalModels();
    const cases = buildEvalCases();
    const perModel: Array<Awaited<ReturnType<typeof evaluateModel>>> = [];

    for (const model of models) {
      perModel.push(await evaluateModel(apiKey, model, cases));
    }

    const comparison = perModel.map(summarizeModel);
    const anyReachedApi = perModel.some((result) => result.outcomes.some((outcome) => outcome.reachedApi));

    console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
      models,
      caseCount: cases.length,
      comparison,
    }, null, 2));

    expect(anyReachedApi).toBe(true);
  }, 240000);
});
