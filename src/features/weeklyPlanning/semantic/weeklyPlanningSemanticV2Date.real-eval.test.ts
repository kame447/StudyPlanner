import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticSystemPromptV2,
  createWeeklyPlanningSemanticUserPromptV2,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  type SemanticTaskV2,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import { parseWeeklyPlanningSemanticDocumentV2WithDateRules } from './weeklyPlanningSemanticValidatorV2DateRules';
import { canonicalizeWeeklyPlanningSemanticDocumentV2 } from './weeklyPlanningSemanticCanonicalizerV2';
import { createEmptyWeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import { resolveWeeklyPlanningTaskDateRules } from './weeklyPlanningTaskDateRuleResolver';

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_V2_DATE_REAL_EVAL === '1';
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const MODEL = process.env.WEEKLY_PLANNING_SEMANTIC_V2_DATE_EVAL_MODEL?.trim()
  || 'openai/gpt-4.1';

interface EvalCase {
  id: string;
  userText: string;
  evaluate: (params: {
    document: WeeklyPlanningSemanticDocumentV2;
    canonicalStatus: string;
    canonicalErrors: string[];
    resolved: ReturnType<typeof resolveWeeklyPlanningTaskDateRules> | null;
  }) => Record<string, boolean>;
}

interface EvalOutcome {
  id: string;
  userText: string;
  model: string;
  latencyMs: number;
  parseErrors: string[];
  canonicalStatus: string | null;
  canonicalErrors: string[];
  resolverIssues: unknown[];
  metrics: Record<string, boolean>;
  document: WeeklyPlanningSemanticDocumentV2 | null;
  rawContent?: string;
  error?: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesText(value: string, expected: string): boolean {
  return normalize(value).includes(normalize(expected));
}

function findTask(
  document: WeeklyPlanningSemanticDocumentV2,
  expected: string,
): SemanticTaskV2 | undefined {
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

function dateRuleExpressions(task: SemanticTaskV2 | undefined, kind: string): string[] {
  return task?.temporalConstraints
    .filter((constraint) => constraint.kind === kind)
    .map((constraint) => constraint.dateExpression ?? '') ?? [];
}

function weeklyDays(task: SemanticTaskV2 | undefined): string[] {
  const recurrence = task?.recurrence.find((item) => item.kind === 'weekly');
  return recurrence?.days ?? [];
}

function weeklyTargetsTask(task: SemanticTaskV2 | undefined): boolean {
  if (!task) return false;
  const recurrence = task.recurrence.find((item) => item.kind === 'weekly');
  return recurrence?.targetLocalId === task.localId;
}

function resolverEligibility(
  resolved: ReturnType<typeof resolveWeeklyPlanningTaskDateRules> | null,
  document: WeeklyPlanningSemanticDocumentV2,
  task: SemanticTaskV2 | undefined,
) {
  if (!resolved || !task) return undefined;
  const canonicalTaskId = resolved.eligibilities.find((item) => {
    const sourceIds = new Set(item.sourceFactIds);
    const semanticSourceIds = new Set([
      ...task.temporalConstraints.map((constraint) => constraint.localId),
      ...task.recurrence.map((recurrence) => recurrence.localId),
    ]);
    return [...sourceIds].some((sourceId) =>
      [...semanticSourceIds].some((semanticId) => sourceId.includes(semanticId)));
  })?.taskId;
  if (canonicalTaskId) {
    return resolved.eligibilities.find((item) => item.taskId === canonicalTaskId);
  }
  return resolved.eligibilities.length === 1 ? resolved.eligibilities[0] : undefined;
}

function buildCases(): EvalCase[] {
  return [
    {
      id: 'discontinuous-allowed-dates',
      userText: '英単語は2026年7月8日、10日、11日だけやりたい。',
      evaluate: ({ document, canonicalStatus, resolved }) => {
        const task = findTask(document, '英単語');
        const eligibility = resolverEligibility(resolved, document, task);
        return {
          taskFound: Boolean(task),
          threeAllowedDateFacts: exactSet(
            dateRuleExpressions(task, 'allowed_date'),
            ['2026-07-08', '2026-07-10', '2026-07-11'],
          ),
          noCollapsedGap: !dateRuleExpressions(task, 'allowed_date').includes('2026-07-09'),
          canonicalApplied: canonicalStatus === 'applied',
          resolverReady: resolved?.readiness === 'ready',
          resolverExactDates: exactSet(
            eligibility?.allowedDates ?? [],
            ['2026-07-08', '2026-07-10', '2026-07-11'],
          ),
        };
      },
    },
    {
      id: 'weekly-discontinuous-weekday-set',
      userText: '英単語は毎週、水曜と金曜から日曜にやりたい。',
      evaluate: ({ document, canonicalStatus, resolved }) => {
        const task = findTask(document, '英単語');
        const eligibility = resolverEligibility(resolved, document, task);
        return {
          taskFound: Boolean(task),
          oneWeeklyRecurrence: task?.recurrence.filter((item) => item.kind === 'weekly').length === 1,
          exactWeekdaySet: exactSet(weeklyDays(task), ['wed', 'fri', 'sat', 'sun']),
          recurrenceTargetsTask: weeklyTargetsTask(task),
          canonicalApplied: canonicalStatus === 'applied',
          resolverReady: resolved?.readiness === 'ready',
          resolverExactDates: exactSet(
            eligibility?.allowedDates ?? [],
            ['2026-07-22', '2026-07-24', '2026-07-25', '2026-07-26'],
          ),
        };
      },
    },
    {
      id: 'weekly-set-with-exact-exclusion',
      userText: '英単語は毎週、水曜と金曜から日曜にやりたい。ただし2026年7月25日はやらない。',
      evaluate: ({ document, canonicalStatus, resolved }) => {
        const task = findTask(document, '英単語');
        const eligibility = resolverEligibility(resolved, document, task);
        return {
          taskFound: Boolean(task),
          exactWeekdaySet: exactSet(weeklyDays(task), ['wed', 'fri', 'sat', 'sun']),
          exactExcludedDate: exactSet(
            dateRuleExpressions(task, 'excluded_date'),
            ['2026-07-25'],
          ),
          canonicalApplied: canonicalStatus === 'applied',
          resolverReady: resolved?.readiness === 'ready',
          resolverSubtractsException: exactSet(
            eligibility?.allowedDates ?? [],
            ['2026-07-22', '2026-07-24', '2026-07-26'],
          ),
          noFalseConflict: !(resolved?.issues ?? []).some((issue) =>
            issue.code === 'conflicting_task_date_rule'),
        };
      },
    },
    {
      id: 'two-task-attachment',
      userText: '数学は2026年7月8日、10日、11日だけ、英単語は毎週水曜と金曜から日曜にやりたい。',
      evaluate: ({ document, canonicalStatus }) => {
        const math = findTask(document, '数学');
        const english = findTask(document, '英単語');
        return {
          separateTasks: Boolean(math && english && math.localId !== english.localId),
          mathOwnsDates: exactSet(
            dateRuleExpressions(math, 'allowed_date'),
            ['2026-07-08', '2026-07-10', '2026-07-11'],
          ),
          englishOwnsWeekdays: exactSet(weeklyDays(english), ['wed', 'fri', 'sat', 'sun']),
          noDateLeakToEnglish: dateRuleExpressions(english, 'allowed_date').length === 0,
          noRecurrenceLeakToMath: weeklyDays(math).length === 0,
          canonicalApplied: canonicalStatus === 'applied',
        };
      },
    },
    {
      id: 'discontinuous-excluded-dates',
      userText: '英単語は2026年7月8日、10日、11日はやらない。',
      evaluate: ({ document, canonicalStatus, resolved }) => {
        const task = findTask(document, '英単語');
        const eligibility = resolverEligibility(resolved, document, task);
        return {
          taskFound: Boolean(task),
          threeExcludedDateFacts: exactSet(
            dateRuleExpressions(task, 'excluded_date'),
            ['2026-07-08', '2026-07-10', '2026-07-11'],
          ),
          canonicalApplied: canonicalStatus === 'applied',
          resolverReady: resolved?.readiness === 'ready',
          exclusionsPreserved: exactSet(
            eligibility?.excludedDates ?? [],
            ['2026-07-08', '2026-07-10', '2026-07-11'],
          ),
        };
      },
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
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: createWeeklyPlanningSemanticSystemPromptV2() },
        {
          role: 'user',
          content: createWeeklyPlanningSemanticUserPromptV2({
            userText,
            publicStateSummary: {
              currentDate: '2026-07-22',
              selectedDate: '2026-07-22',
              timeZone: 'Asia/Tokyo',
            },
          }),
        },
      ],
      response_format: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
    }),
  });
}

async function callModel(token: string, userText: string): Promise<string> {
  const retryDelays = [0, 60_000, 120_000];
  let lastError = 'GitHub Models request failed.';
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
      lastError = 'GitHub Models response had no content.';
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
    'artifacts/weekly-planning-semantic-v2-date-real-eval.json',
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      model: MODEL,
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.document).length,
        canonicalizedCount: outcomes.filter((outcome) => outcome.canonicalStatus === 'applied').length,
        passedCaseCount: outcomes.filter((outcome) =>
          outcome.document
          && Object.values(outcome.metrics).every(Boolean)).length,
      },
    }, null, 2),
  );
}

describe.skipIf(!shouldRun)('weekly planning semantic v2 date real evaluation', () => {
  it('structures discontinuous dates and weekday sets through the deterministic pipeline', async () => {
    const token = process.env.GITHUB_MODELS_TOKEN?.trim();
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is required.');
    const outcomes: EvalOutcome[] = [];
    const cases = buildCases();

    for (let index = 0; index < cases.length; index += 1) {
      const evalCase = cases[index];
      if (index > 0) await wait(20_000);
      const startedAt = performance.now();
      try {
        const rawContent = await callModel(token, evalCase.userText);
        const parsed = parseWeeklyPlanningSemanticDocumentV2WithDateRules(rawContent);
        let canonicalStatus: string | null = null;
        let canonicalErrors: string[] = [];
        let resolved: ReturnType<typeof resolveWeeklyPlanningTaskDateRules> | null = null;

        if (parsed.document) {
          const canonical = canonicalizeWeeklyPlanningSemanticDocumentV2({
            graph: createEmptyWeeklyPlanningFactGraphV2(),
            document: parsed.document,
            context: {
              conversationId: `real-eval-${evalCase.id}`,
              turnId: 'turn-1',
              expectedRevision: 0,
            },
          });
          canonicalStatus = canonical.status;
          canonicalErrors = canonical.errors;
          if (canonical.status === 'applied') {
            resolved = resolveWeeklyPlanningTaskDateRules({
              graph: canonical.graph,
              currentDate: '2026-07-22',
              planningStartDate: '2026-07-01',
              planningEndDate: '2026-07-31',
            });
          }
        }

        const metrics = parsed.document
          ? evalCase.evaluate({
            document: parsed.document,
            canonicalStatus: canonicalStatus ?? 'not-run',
            canonicalErrors,
            resolved,
          })
          : {};
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model: MODEL,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: parsed.errors,
          canonicalStatus,
          canonicalErrors,
          resolverIssues: resolved?.issues ?? [],
          metrics,
          document: parsed.document,
          rawContent,
        });
      } catch (error) {
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model: MODEL,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: [],
          canonicalStatus: null,
          canonicalErrors: [],
          resolverIssues: [],
          metrics: {},
          document: null,
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    writeReport(outcomes);
    console.info('[weekly-planning-semantic-v2-date-real-eval]', JSON.stringify(outcomes, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || !outcome.document
      || outcome.canonicalStatus !== 'applied'
      || Object.values(outcome.metrics).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 25 * 60 * 1000);
});
