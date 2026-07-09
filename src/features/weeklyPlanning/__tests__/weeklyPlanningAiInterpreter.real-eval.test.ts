import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import { resolveConstraintSourceReferences } from '../intake/weeklyPlanningReferenceResolution';
import type {
  CandidateValidationResult,
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from '../intake/weeklyPlanningInterpreterTypes';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';

const shouldRunRealAiEvaluation = process.env.WEEKLY_PLANNING_REAL_AI_EVAL === '1';
const foundationCase = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation;
const semanticIntentCases = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.semanticIntent;

// 比較対象 model。既定は本番 routing と同じ2 model。_MODELS(カンマ)/ _MODEL(単一)で上書き可。
// この eval は既存 Worker proxy の「model 指定経路(purpose 無し)」で model を切り替えて比較する。
// 本番の purpose→model routing(interpreter は purpose を送る)はこの経路とは別で、変更しない。
const DEFAULT_EVAL_MODELS = ['gpt-5.4-nano-2026-03-17', 'gpt-5.4-mini-2026-03-17'];

const baseStateSummary: InterpreterStateSummary = {
  knownFields: [],
  confirmedSlots: ['planning_range'],
  planningRangeSummary: '2026-07-06〜2026-07-12',
};

// use_constraint_source 系: 現在 active な参照元(timetable / existing_plans)を利用可能にして評価する。
// calendar は未実装のため false(本番と揃える)。
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

interface ProxyEvalStatus {
  attempted: boolean;
  reachedApi: boolean;
  status?: number;
  error?: string;
  rawContent?: string;
}

interface AiProxyResponse {
  content?: string;
  error?: string;
}

interface EvalContext {
  commands: ParsedWeeklyPlanningCommand[];
  diagnostics: CandidateValidationResult;
}

interface EvalCase {
  id: string;
  group: EvalGroup;
  userText: string;
  expected: Record<string, boolean>;
  stateSummary: InterpreterStateSummary;
  evaluate: (ctx: EvalContext) => Record<string, boolean>;
}

function readEvalIdToken(): string | null {
  return process.env.WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN?.trim() || null;
}

function resolveProxyUrl(): string | null {
  return (
    process.env.WEEKLY_PLANNING_REAL_AI_EVAL_PROXY_URL?.trim() ||
    getCloudflareAiProxyUrl() ||
    null
  );
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

function readCaseFilter(): Set<string> | null {
  const raw = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_CASE?.trim();
  if (!raw) {
    return null;
  }

  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

// 連続呼び出しで Worker の quota(uid: 5/min, 30/day)に当たりやすいため、
// 明示指定時のみ呼び出し間に待機できるようにする(既定 0)。
function readCallDelayMs(): number {
  const raw = Number(process.env.WEEKLY_PLANNING_REAL_AI_EVAL_DELAY_MS ?? '0');
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function evalInterpreterConfig(model: string): AiConfig {
  // client を注入するため config.model は未使用(参照専用)。provider は openai。
  return { provider: 'openai', baseUrl: '', model, apiKey: '' };
}

/**
 * 既存 Worker AI Proxy 経由の eval 用 client。
 * - `openAiCompatibleClient.ts` の proxy 契約(endpoint / Authorization / body / {content} 応答)に合わせる。
 * - ただし Node には Firebase セッションが無いため、ID トークンは env から供給する。
 * - model 指定経路(purpose を送らず model を送る)を使い、eval 対象 model を切り替えて比較する。
 *   Worker は resolveChatModel で purpose 無し → payload.model を使い、allowlist 検証後に Secret で OpenAI を呼ぶ。
 * - purpose を送らないため本番の purpose→model routing はこの eval では発火しない(壊さない)。
 */
function createProxyEvalClient(params: {
  proxyUrl: string;
  idToken: string;
  model: string;
  status: ProxyEvalStatus;
}): OpenAiCompatibleClient {
  return {
    async createChatCompletion({ messages, temperature = 0.1, responseFormat }) {
      params.status.attempted = true;
      const endpoint = params.proxyUrl.endsWith('/chat/completions')
        ? params.proxyUrl
        : `${params.proxyUrl.replace(/\/$/, '')}/chat/completions`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.idToken}`,
          },
          body: JSON.stringify({
            model: params.model,
            temperature,
            messages,
            response_format: responseFormat,
          }),
        });
        params.status.reachedApi = true;
        params.status.status = response.status;

        const data = (await response.json()) as AiProxyResponse;
        const content = data.content?.trim();
        params.status.rawContent = content;

        if (!response.ok || !content) {
          throw new Error(data.error || `AI proxy request failed with status ${response.status}.`);
        }

        return content;
      } catch (error) {
        params.status.error = error instanceof Error ? error.message : 'AI proxy request failed.';
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
      expected: { intent: true, payload: true },
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
      expected: { intent: true, payload: true },
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
      expected: { intent: true, payload: true },
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
      expected: { notHardApplied: true, clarified: true },
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
      expected: { intent: true, payload: true },
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
      expected: { noFalseFire: true },
      stateSummary: constraintSourceStateSummary,
      evaluate: ({ commands }) => ({
        noFalseFire: !firedForbiddenIntent(commands),
      }),
    });
  });

  return cases;
}

interface CaseOutcome {
  id: string;
  group: EvalGroup;
  userText: string;
  expected: Record<string, boolean>;
  reachedApi: boolean;
  error?: string;
  metrics: Record<string, boolean>;
  rawAiResponse?: string;
  parsedCandidates?: InterpretedCommandCandidate[];
  validatorResult?: CandidateValidationResult;
  hardApplied?: boolean;
  clarified?: boolean;
  candidateCount: number;
  rejectedCount: number;
  parseRejectionCount: number;
  latencyMs: number;
}

async function evaluateModel(params: {
  proxyUrl: string;
  idToken: string;
  model: string;
  cases: EvalCase[];
  callDelayMs: number;
}): Promise<{ model: string; outcomes: CaseOutcome[] }> {
  const config = evalInterpreterConfig(params.model);
  const outcomes: CaseOutcome[] = [];

  for (let index = 0; index < params.cases.length; index += 1) {
    const evalCase = params.cases[index];
    if (index > 0) {
      await delay(params.callDelayMs);
    }

    const status: ProxyEvalStatus = { attempted: false, reachedApi: false };
    const startedAt = performance.now();
    const interpreterResult = await createAiWeeklyPlanningInterpreter(
      config,
      createProxyEvalClient({ proxyUrl: params.proxyUrl, idToken: params.idToken, model: params.model, status }),
    ).interpretUserTurn({
      userText: evalCase.userText,
      context: { selectedDate: '2026-07-06', planningDayCount: 7 },
      stateSummary: evalCase.stateSummary,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (status.error || !status.reachedApi) {
      outcomes.push({
        id: evalCase.id,
        group: evalCase.group,
        userText: evalCase.userText,
        expected: evalCase.expected,
        reachedApi: status.reachedApi,
        error: status.error ?? 'call did not reach the proxy',
        metrics: {},
        candidateCount: 0,
        rejectedCount: 0,
        parseRejectionCount: 0,
        latencyMs,
      });
      continue;
    }

    const resolvedCandidates = resolveConstraintSourceReferences({
      candidates: interpreterResult.candidates,
      userText: evalCase.userText,
      stateSummary: evalCase.stateSummary,
    });
    const diagnostics = validateInterpretedCandidates(resolvedCandidates, evalCase.stateSummary);
    diagnostics.parseRejections = interpreterResult.parseRejections;
    const commands = interpreterResult.candidates.map((candidate) => candidate.command);
    const metrics = evalCase.evaluate({ commands, diagnostics });
    const hardApplied = hardAppliedConstraintSource(diagnostics);
    const clarified = requestedClarification({ commands, diagnostics });

    outcomes.push({
      id: evalCase.id,
      group: evalCase.group,
      userText: evalCase.userText,
      expected: evalCase.expected,
      reachedApi: true,
      metrics,
      rawAiResponse: status.rawContent,
      parsedCandidates: resolvedCandidates,
      validatorResult: diagnostics,
      hardApplied,
      clarified,
      candidateCount: interpreterResult.candidates.length,
      rejectedCount: diagnostics.rejected.length,
      parseRejectionCount: diagnostics.parseRejections.length,
      latencyMs,
    });
  }

  return { model: params.model, outcomes };
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

function summarizeModel(result: { model: string; outcomes: CaseOutcome[] }) {
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
    // Worker proxy は {content} のみ返し usage を透過しないため、proxy 経由では token/コストを計測できない。
    tokenUsage: 'unavailable: worker proxy does not forward token usage',
    estimatedCostUsd: 'unavailable: token usage is not exposed through the proxy',
    byGroup: summarizeByGroup(evaluated),
    failures: result.outcomes
      .filter((outcome) =>
        Boolean(outcome.error) ||
        Object.entries(outcome.metrics).some(([key, value]) => key !== 'clarified' && value === false))
      .map((outcome) => ({
        id: outcome.id,
        group: outcome.group,
        inputText: outcome.userText,
        expected: outcome.expected,
        error: outcome.error,
        rawAiResponse: outcome.rawAiResponse,
        parsedCandidates: outcome.parsedCandidates,
        validatorResult: outcome.validatorResult,
        finalEvaluationResult: outcome.metrics,
        hardApplied: outcome.hardApplied,
        clarified: outcome.clarified,
      })),
  };
}

describe.skipIf(!shouldRunRealAiEvaluation)('weekly planning AI interpreter real evaluation', () => {
  it('compares semantic-intent golden cases across the routed models via the Worker proxy', async () => {
    const idToken = readEvalIdToken();
    const proxyUrl = resolveProxyUrl();

    if (!idToken || !proxyUrl) {
      console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
        skipped: true,
        reason: 'missing evaluation env: WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN and a proxy URL (VITE_CLOUDFLARE_AI_PROXY_URL or WEEKLY_PLANNING_REAL_AI_EVAL_PROXY_URL) are required',
        hasIdToken: Boolean(idToken),
        hasProxyUrl: Boolean(proxyUrl),
      }, null, 2));
      expect(true).toBe(true);
      return;
    }

    const models = resolveEvalModels();
    const caseFilter = readCaseFilter();
    const cases = buildEvalCases().filter((evalCase) => !caseFilter || caseFilter.has(evalCase.id));
    const callDelayMs = readCallDelayMs();
    const perModel: Array<{ model: string; outcomes: CaseOutcome[] }> = [];

    if (cases.length === 0) {
      throw new Error(`No weekly planning real-eval cases matched filter: ${Array.from(caseFilter ?? []).join(', ')}`);
    }

    for (const model of models) {
      perModel.push(await evaluateModel({ proxyUrl, idToken, model, cases, callDelayMs }));
    }

    const comparison = perModel.map(summarizeModel);
    const anyReachedApi = perModel.some((result) => result.outcomes.some((outcome) => outcome.reachedApi));

    console.info('[weekly-planning-ai-real-eval]', JSON.stringify({
      via: 'cloudflare-worker-ai-proxy (model path, no purpose)',
      models,
      caseCount: cases.length,
      caseFilter: caseFilter ? Array.from(caseFilter) : null,
      comparison,
    }, null, 2));

    expect(anyReachedApi).toBe(true);
    // 両モデル比較の最悪ケース: 33×呼び出し間待機(既定推奨15s≒495s)+ 34回分の実 API 応答時間。
    // 応答遅延を含めても完走できるよう 20 分に設定する。
  }, 1200000);
});
