import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_V5_REAL_EVAL === '1';
const BASE_URL = process.env.WEEKLY_PLANNING_SEMANTIC_V5_EVAL_BASE_URL?.trim()
  || 'https://api.openai.com/v1';
const ENDPOINT = BASE_URL.endsWith('/chat/completions')
  ? BASE_URL
  : `${BASE_URL.replace(/\/$/, '')}/chat/completions`;
const MODEL = process.env.WEEKLY_PLANNING_SEMANTIC_V5_EVAL_MODEL?.trim()
  || 'gpt-5.4-mini';
const DATE_SET_INSTRUCTION = [
  'For multiple non-consecutive explicit calendar dates that apply to one task, create one allowed_date temporal constraint per date. Do not collapse gaps into a continuous date range.',
  'For a repeating task on explicitly named weekdays, create one recurrence fact with kind weekly and a single days array using only sun, mon, tue, wed, thu, fri, sat.',
  'Expand weekday ranges before returning JSON. For example, 水曜と金曜から日曜 becomes days [wed, fri, sat, sun].',
].join('\n');

interface EvaluationContext {
  document: WeeklyPlanningSemanticDocumentV5;
  graph: WeeklyPlanningFactGraphV5;
  localToFactId: Record<string, string>;
}

interface EvalCase {
  id: string;
  userText: string;
  evaluate: (context: EvaluationContext) => Record<string, boolean>;
}

interface EvalOutcome {
  id: string;
  userText: string;
  model: string;
  semanticSchemaVersion: string;
  jsonSchemaName: string;
  factGraphVersion: string;
  latencyMs: number;
  parseErrors: string[];
  canonicalStatus: string | null;
  canonicalErrors: string[];
  metrics: Record<string, boolean>;
  error?: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesText(value: string, expected: string): boolean {
  return normalize(value).includes(normalize(expected));
}

function findTask(
  document: WeeklyPlanningSemanticDocumentV5,
  expected: string,
): SemanticTaskV5 | undefined {
  return document.tasks.find((task) =>
    includesText(task.title, expected)
    || includesText(task.sourceText, expected)
    || (task.study?.components ?? []).some((component) =>
      includesText(component.label, expected)
      || includesText(component.sourceText, expected)));
}

function exactSet(values: string[], expected: string[]): boolean {
  return [...new Set(values)].sort().join('|') === [...expected].sort().join('|');
}

function dateExpressions(task: SemanticTaskV5 | undefined, kind: string): string[] {
  return task?.temporalConstraints
    .filter((constraint) => constraint.kind === kind)
    .map((constraint) => constraint.dateExpression ?? '') ?? [];
}

function weeklyDays(task: SemanticTaskV5 | undefined): string[] {
  return task?.recurrence.find((item) => item.kind === 'weekly')?.days ?? [];
}

function graphTaskDateExpressions(
  context: EvaluationContext,
  task: SemanticTaskV5 | undefined,
  kind: 'allowed_date' | 'excluded_date',
): string[] {
  if (!task) return [];
  const taskFactId = context.localToFactId[task.localId];
  return context.graph.taskDateRules
    .filter((rule) => rule.taskId === taskFactId && rule.kind === kind)
    .map((rule) => rule.dateExpression);
}

function graphWeeklyDays(
  context: EvaluationContext,
  task: SemanticTaskV5 | undefined,
): string[] {
  if (!task) return [];
  const taskFactId = context.localToFactId[task.localId];
  return context.graph.recurrences.find((recurrence) =>
    recurrence.taskId === taskFactId
    && recurrence.targetFactId === taskFactId
    && recurrence.kind === 'weekly')?.days ?? [];
}

function buildCases(): EvalCase[] {
  return [
    {
      id: 'discontinuous-allowed-dates',
      userText: '英単語は2026年7月8日、10日、11日だけやりたい。',
      evaluate: (context) => {
        const task = findTask(context.document, '英単語');
        const expected = ['2026-07-08', '2026-07-10', '2026-07-11'];
        return {
          taskFound: Boolean(task),
          semanticDates: exactSet(dateExpressions(task, 'allowed_date'), expected),
          graphDates: exactSet(graphTaskDateExpressions(context, task, 'allowed_date'), expected),
          noCollapsedGap: !dateExpressions(task, 'allowed_date').includes('2026-07-09'),
        };
      },
    },
    {
      id: 'weekly-discontinuous-weekday-set',
      userText: '英単語は毎週、水曜と金曜から日曜にやりたい。',
      evaluate: (context) => {
        const task = findTask(context.document, '英単語');
        const expected = ['wed', 'fri', 'sat', 'sun'];
        return {
          taskFound: Boolean(task),
          oneWeeklyRecurrence:
            task?.recurrence.filter((item) => item.kind === 'weekly').length === 1,
          semanticWeekdays: exactSet(weeklyDays(task), expected),
          graphWeekdays: exactSet(graphWeeklyDays(context, task), expected),
        };
      },
    },
    {
      id: 'weekly-set-with-exact-exclusion',
      userText: '英単語は毎週、水曜と金曜から日曜にやりたい。ただし2026年7月25日はやらない。',
      evaluate: (context) => {
        const task = findTask(context.document, '英単語');
        return {
          taskFound: Boolean(task),
          semanticWeekdays: exactSet(weeklyDays(task), ['wed', 'fri', 'sat', 'sun']),
          graphWeekdays: exactSet(
            graphWeeklyDays(context, task),
            ['wed', 'fri', 'sat', 'sun'],
          ),
          semanticExclusion: exactSet(
            dateExpressions(task, 'excluded_date'),
            ['2026-07-25'],
          ),
          graphExclusion: exactSet(
            graphTaskDateExpressions(context, task, 'excluded_date'),
            ['2026-07-25'],
          ),
        };
      },
    },
    {
      id: 'availability-and-authoritative-source-request',
      userText: '2026年7月23日は何も入れないで。登録済みのカレンダーも使って計画したい。',
      evaluate: (context) => ({
        hardWholeDayUnavailable: context.document.availabilityDeclarations.some((item) =>
          item.kind === 'unavailable'
          && item.constraintLevel === 'hard'
          && item.dateExpression === '2026-07-23'
          && item.namedTimePeriod === null
          && item.startTime === null
          && item.endTime === null),
        calendarRequest: context.document.constraintSourceRequests.some((item) =>
          item.kind === 'calendar'
          && item.selector === 'active'
          && item.requestedAction === 'use'),
        graphAvailability: context.graph.availabilityDeclarations.length === 1,
        graphSourceRequest: context.graph.constraintSourceRequests.length === 1,
      }),
    },
  ];
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(token: string, userText: string): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_completion_tokens: 4000,
      messages: [
        {
          role: 'system',
          content: [
            createWeeklyPlanningSemanticSystemPromptV5(),
            DATE_SET_INSTRUCTION,
          ].join('\n'),
        },
        {
          role: 'user',
          content: createWeeklyPlanningSemanticUserPromptV5({
            userText,
            publicStateSummary: {
              currentDate: '2026-07-22',
              selectedDate: '2026-07-22',
              timeZone: 'Asia/Tokyo',
            },
          }),
        },
      ],
      response_format: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
    }),
  });
}

async function callModel(token: string, userText: string): Promise<string> {
  const retryDelays = [0, 5_000, 20_000];
  let lastError = 'OpenAI request failed.';
  for (const retryDelay of retryDelays) {
    if (retryDelay > 0) await wait(retryDelay);
    const response = await requestOnce(token, userText);
    const raw = await response.text();
    if (response.ok) {
      const data = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastError = 'OpenAI response had no content.';
      continue;
    }
    lastError = `${response.status}: ${raw.slice(0, 500)}`;
    if (response.status !== 429) break;
  }
  throw new Error(lastError);
}

function writeReport(outcomes: EvalOutcome[]): void {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/weekly-planning-semantic-v5-real-eval.json',
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      endpoint: ENDPOINT,
      model: MODEL,
      semanticSchemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
      factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.parseErrors.length === 0).length,
        canonicalizedCount: outcomes.filter(
          (outcome) => outcome.canonicalStatus === 'applied',
        ).length,
        passedCaseCount: outcomes.filter((outcome) =>
          !outcome.error
          && outcome.parseErrors.length === 0
          && outcome.canonicalStatus === 'applied'
          && Object.values(outcome.metrics).every(Boolean)).length,
      },
    }, null, 2),
  );
}

describe.skipIf(!shouldRun)('weekly planning Stable V5 real evaluation', () => {
  it('evaluates the direct Stable schema and canonicalizer', async () => {
    const token = process.env.OPENAI_API_KEY?.trim();
    if (!token) throw new Error('OPENAI_API_KEY is required.');
    const outcomes: EvalOutcome[] = [];

    for (const [index, evalCase] of buildCases().entries()) {
      if (index > 0) await wait(2_000);
      const startedAt = performance.now();
      try {
        const content = await callModel(token, evalCase.userText);
        const parsed = parseWeeklyPlanningSemanticDocumentV5(content);
        let canonicalStatus: string | null = null;
        let canonicalErrors: string[] = [];
        let metrics: Record<string, boolean> = {};

        if (parsed.document) {
          const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
            graph: createEmptyWeeklyPlanningFactGraphV5(),
            document: parsed.document,
            context: {
              conversationId: `stable-real-eval-${evalCase.id}`,
              turnId: 'turn-1',
              expectedRevision: 0,
            },
          });
          canonicalStatus = canonical.status;
          canonicalErrors = canonical.errors;
          if (canonical.status === 'applied') {
            metrics = evalCase.evaluate({
              document: parsed.document,
              graph: canonical.graph,
              localToFactId: canonical.localToFactId,
            });
          }
        }

        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model: MODEL,
          semanticSchemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
          factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: parsed.errors,
          canonicalStatus,
          canonicalErrors,
          metrics,
        });
      } catch (error) {
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model: MODEL,
          semanticSchemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
          factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: [],
          canonicalStatus: null,
          canonicalErrors: [],
          metrics: {},
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    writeReport(outcomes);
    console.info('[weekly-planning-semantic-v5-real-eval]', JSON.stringify(outcomes, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || outcome.parseErrors.length > 0
      || outcome.canonicalStatus !== 'applied'
      || Object.values(outcome.metrics).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 10 * 60 * 1000);
});
