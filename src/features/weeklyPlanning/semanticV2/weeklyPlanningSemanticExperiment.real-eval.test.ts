import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createSemanticExperimentSystemPrompt,
  createSemanticExperimentUserPrompt,
  parseSemanticPlanningDocument,
  type SemanticPlanningDocument,
  type SemanticTask,
  WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT,
} from './weeklyPlanningSemanticExperiment';

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_REAL_EVAL === '1';
const DEFAULT_MODEL = 'gpt-5.4-mini-2026-03-17';

interface EvalCase {
  id: string;
  userText: string;
  evaluate: (document: SemanticPlanningDocument) => Record<string, boolean>;
}

interface EvalOutcome {
  id: string;
  userText: string;
  model: string;
  transport: 'openai-direct' | 'cloudflare-proxy';
  latencyMs: number;
  parseErrors: string[];
  metrics: Record<string, boolean>;
  document: SemanticPlanningDocument | null;
  rawContent?: string;
  error?: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesLabel(value: string, expected: string): boolean {
  return normalize(value).includes(normalize(expected));
}

function findTask(
  document: SemanticPlanningDocument,
  predicate: (task: SemanticTask) => boolean,
): SemanticTask | undefined {
  return document.tasks.find(predicate);
}

function findComponent(document: SemanticPlanningDocument, expectedLabel: string) {
  for (const task of document.tasks) {
    const component = task.study?.components.find((item) => includesLabel(item.label, expectedLabel));
    if (component) return { task, component };
  }
  return undefined;
}

function hasWorkload(params: {
  document: SemanticPlanningDocument;
  label: string;
  amount: number;
  unitCode: string;
  perOccurrence?: boolean;
}): boolean {
  const found = findComponent(params.document, params.label);
  if (!found) return false;
  return found.component.workloads.some((workload) =>
    workload.amount === params.amount
      && workload.unitCode === params.unitCode
      && (params.perOccurrence === undefined || workload.perOccurrence === params.perOccurrence));
}

function relationExists(params: {
  document: SemanticPlanningDocument;
  fromTask: SemanticTask | undefined;
  toTask: SemanticTask | undefined;
  kind: string;
}): boolean {
  if (!params.fromTask || !params.toTask) return false;
  return params.document.relations.some((relation) =>
    relation.kind === params.kind
      && relation.fromLocalId === params.fromTask?.localId
      && relation.toLocalId === params.toTask?.localId);
}

function buildCases(): EvalCase[] {
  return [
    {
      id: 'mixed:graduate-exam-and-research',
      userText: '院試の過去問を進めたいんですけど、分野は二つあってOSとネットワークは1年分、ヒューマンサイエンスは2年分あります。あ、でもその前に研究も15時くらいまで進めないといけません。',
      evaluate: (document) => {
        const studyTask = findTask(document, (task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', '院'));
        const researchTask = findTask(document, (task) =>
          task.category === 'non_study' && includesLabel(task.title, '研究'));
        const researchEnd = researchTask?.scheduleConstraints.some((constraint) =>
          constraint.targetLocalId === researchTask.localId
          && constraint.kind === 'end_time'
          && constraint.endTime === '15:00'
          && constraint.precision === 'approximate') ?? false;
        return {
          genericStudyTask: Boolean(studyTask),
          osNetworkWorkload: hasWorkload({
            document, label: 'OSとネットワーク', amount: 1, unitCode: 'exam_year',
          }),
          humanScienceWorkload: hasWorkload({
            document, label: 'ヒューマンサイエンス', amount: 2, unitCode: 'exam_year',
          }),
          researchSeparated: Boolean(researchTask),
          researchEndTime: researchEnd,
          beforeRelation: relationExists({
            document, fromTask: researchTask, toTask: studyTask, kind: 'before',
          }),
        };
      },
    },
    {
      id: 'study:qualification-exam',
      userText: '基本情報技術者試験に向けて、アルゴリズムの過去問を30問、ネットワークの参考書を3章進めたいです。',
      evaluate: (document) => ({
        examContext: document.tasks.some((task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', '基本情報')),
        algorithmWorkload: hasWorkload({
          document, label: 'アルゴリズム', amount: 30, unitCode: 'problem',
        }),
        networkWorkload: hasWorkload({
          document, label: 'ネットワーク', amount: 3, unitCode: 'chapter',
        }),
        noExamSpecificTopLevelType: document.tasks.every((task) =>
          ['study', 'non_study', 'unknown'].includes(task.category)),
      }),
    },
    {
      id: 'study:university-entrance-modifier-attachment',
      userText: '共通テスト対策で、英単語を毎日300語ずつではなく今週合計300語、数学IAの過去問を2年分進めたいです。数学は週末にまとめたいです。',
      evaluate: (document) => {
        const math = findComponent(document, '数学IA');
        const english = findComponent(document, '英単語');
        const mathWeekend = document.tasks.some((task) =>
          task.recurrence.some((recurrence) =>
            recurrence.targetLocalId === math?.component.localId
            && recurrence.kind === 'weekends'));
        return {
          entranceExamContext: document.tasks.some((task) =>
            task.category === 'study'
            && task.study?.purpose === 'exam'
            && includesLabel(task.study.contextLabel ?? '', '共通テスト')),
          englishWeeklyTotal: hasWorkload({
            document, label: '英単語', amount: 300, unitCode: 'word', perOccurrence: false,
          }),
          mathYears: hasWorkload({
            document, label: '数学IA', amount: 2, unitCode: 'exam_year',
          }),
          mathWeekendAttached: Boolean(math && mathWeekend),
          englishNotDaily: !document.tasks.some((task) =>
            task.recurrence.some((recurrence) =>
              recurrence.targetLocalId === english?.component.localId
              && recurrence.kind === 'daily')),
        };
      },
    },
    {
      id: 'study:school-homework-and-timing',
      userText: '明日までに数学のワークを12ページ、英単語を80語やりたい。英単語は夕食前と寝る前、数学は20時から進めたい。',
      evaluate: (document) => {
        const math = findComponent(document, '数学');
        const english = findComponent(document, '英単語');
        const mathStart = document.tasks.some((task) => task.scheduleConstraints.some((constraint) =>
          constraint.targetLocalId === math?.component.localId
          && constraint.kind === 'start_time'
          && constraint.startTime === '20:00'));
        const englishPreference = document.tasks.some((task) => task.scheduleConstraints.some((constraint) =>
          constraint.targetLocalId === english?.component.localId
          && constraint.kind === 'preferred_time'));
        return {
          homeworkPurpose: document.tasks.some((task) =>
            task.category === 'study' && task.study?.purpose === 'homework'),
          mathPages: hasWorkload({ document, label: '数学', amount: 12, unitCode: 'page' }),
          englishWords: hasWorkload({ document, label: '英単語', amount: 80, unitCode: 'word' }),
          mathStartAttached: mathStart,
          englishPreferenceAttached: englishPreference,
          deadlinePreserved: document.tasks.some((task) => task.scheduleConstraints.some((constraint) =>
            constraint.kind === 'deadline' && includesLabel(constraint.dateExpression ?? '', '明日'))),
        };
      },
    },
    {
      id: 'study:daily-and-times-per-week-habits',
      userText: '毎日英会話を30分、週3回プログラミングの問題を2問ずつ進めたい。',
      evaluate: (document) => {
        const english = findComponent(document, '英会話');
        const programming = findComponent(document, 'プログラミング');
        return {
          bothStudyComponents: Boolean(english && programming),
          englishPerOccurrence: hasWorkload({
            document, label: '英会話', amount: 30, unitCode: 'minute', perOccurrence: true,
          }),
          englishDaily: document.tasks.some((task) => task.recurrence.some((recurrence) =>
            recurrence.targetLocalId === english?.component.localId
            && recurrence.kind === 'daily')),
          programmingPerOccurrence: hasWorkload({
            document, label: 'プログラミング', amount: 2, unitCode: 'problem', perOccurrence: true,
          }),
          programmingThreeTimes: document.tasks.some((task) => task.recurrence.some((recurrence) =>
            recurrence.targetLocalId === programming?.component.localId
            && recurrence.kind === 'times_per_week'
            && recurrence.count === 3)),
        };
      },
    },
    {
      id: 'non-study:chores-and-sequence',
      userText: '部屋の掃除を1時間してから、買い物を18時までに終わらせたい。',
      evaluate: (document) => {
        const cleaning = findTask(document, (task) =>
          task.category === 'non_study' && includesLabel(task.title, '掃除'));
        const shopping = findTask(document, (task) =>
          task.category === 'non_study' && includesLabel(task.title, '買い物'));
        return {
          twoGenericTasks: Boolean(cleaning && shopping),
          cleaningDuration: cleaning?.scheduleConstraints.some((constraint) =>
            constraint.targetLocalId === cleaning.localId
            && constraint.kind === 'duration'
            && constraint.durationMinutes === 60) ?? false,
          shoppingEndTime: shopping?.scheduleConstraints.some((constraint) =>
            constraint.targetLocalId === shopping.localId
            && constraint.kind === 'end_time'
            && constraint.endTime === '18:00') ?? false,
          sequencePreserved: relationExists({
            document, fromTask: cleaning, toTask: shopping, kind: 'before',
          }) || relationExists({
            document, fromTask: cleaning, toTask: shopping, kind: 'sequence',
          }),
        };
      },
    },
    {
      id: 'mixed:work-and-language-exam',
      userText: '仕事の資料を仕上げた後、TOEICのリスニング問題を20問解きたい。TOEICは試験対策です。',
      evaluate: (document) => {
        const work = findTask(document, (task) =>
          task.category === 'non_study' && includesLabel(task.title, '資料'));
        const toeic = findTask(document, (task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', 'TOEIC'));
        return {
          workSeparated: Boolean(work),
          toeicAsGenericStudy: Boolean(toeic),
          listeningWorkload: hasWorkload({
            document, label: 'リスニング', amount: 20, unitCode: 'problem',
          }),
          workBeforeStudy: relationExists({
            document, fromTask: work, toTask: toeic, kind: 'before',
          }),
        };
      },
    },
  ];
}

function resolveModel(): string {
  return process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_EVAL_MODEL?.trim() || DEFAULT_MODEL;
}

function resolveDirectApiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function resolveProxyUrl(): string | null {
  return process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_EVAL_PROXY_URL?.trim()
    || process.env.WEEKLY_PLANNING_REAL_AI_EVAL_PROXY_URL?.trim()
    || process.env.VITE_CLOUDFLARE_AI_PROXY_URL?.trim()
    || null;
}

function resolveProxyToken(): string | null {
  return process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_EVAL_ID_TOKEN?.trim()
    || process.env.WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN?.trim()
    || null;
}

function resolveTransport(): {
  kind: 'openai-direct' | 'cloudflare-proxy';
  endpoint: string;
  token: string;
} {
  const apiKey = resolveDirectApiKey();
  if (apiKey) {
    const baseUrl = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
    return {
      kind: 'openai-direct',
      endpoint: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      token: apiKey,
    };
  }
  const proxyUrl = resolveProxyUrl();
  const proxyToken = resolveProxyToken();
  if (proxyUrl && proxyToken) {
    return {
      kind: 'cloudflare-proxy',
      endpoint: proxyUrl.endsWith('/chat/completions')
        ? proxyUrl
        : `${proxyUrl.replace(/\/$/, '')}/chat/completions`,
      token: proxyToken,
    };
  }
  throw new Error(
    'No API credentials available. Set OPENAI_API_KEY, or set a Cloudflare proxy URL and WEEKLY_PLANNING_SEMANTIC_SCHEMA_EVAL_ID_TOKEN.',
  );
}

async function delay(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(params: {
  userText: string;
  model: string;
  transport: ReturnType<typeof resolveTransport>;
}): Promise<string> {
  const body = {
    model: params.model,
    temperature: 0,
    messages: [
      { role: 'system', content: createSemanticExperimentSystemPrompt() },
      {
        role: 'user',
        content: createSemanticExperimentUserPrompt({
          userText: params.userText,
          currentDateTime: '2026-07-22T15:00:00+09:00',
          selectedDate: '2026-07-22',
        }),
      },
    ],
    response_format: WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT,
    max_completion_tokens: 1200,
  };
  const response = await fetch(params.transport.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.transport.token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json() as {
    content?: string;
    error?: string | { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = params.transport.kind === 'cloudflare-proxy'
    ? data.content?.trim()
    : data.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !content) {
    const error = typeof data.error === 'string'
      ? data.error
      : data.error?.message || `API request failed with status ${response.status}`;
    throw new Error(error);
  }
  return content;
}

function writeReport(outcomes: EvalOutcome[]): void {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/weekly-planning-semantic-schema-eval.json',
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.document).length,
        passedCaseCount: outcomes.filter((outcome) =>
          outcome.document
          && Object.values(outcome.metrics).every(Boolean)).length,
      },
    }, null, 2),
  );
}

describe.skipIf(!shouldRun)('weekly planning generic semantic schema real evaluation', () => {
  it('normalizes heterogeneous study and non-study requests without exam-specific top-level structures', async () => {
    const model = resolveModel();
    const transport = resolveTransport();
    const cases = buildCases();
    const outcomes: EvalOutcome[] = [];

    for (let index = 0; index < cases.length; index += 1) {
      const evalCase = cases[index];
      if (index > 0 && transport.kind === 'cloudflare-proxy') await delay(13_000);
      const startedAt = performance.now();
      try {
        const rawContent = await callModel({
          userText: evalCase.userText,
          model,
          transport,
        });
        const parsed = parseSemanticPlanningDocument(rawContent);
        const metrics = parsed.document ? evalCase.evaluate(parsed.document) : {};
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model,
          transport: transport.kind,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: parsed.errors,
          metrics,
          document: parsed.document,
          rawContent,
        });
      } catch (error) {
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model,
          transport: transport.kind,
          latencyMs: Math.round(performance.now() - startedAt),
          parseErrors: [],
          metrics: {},
          document: null,
          error: error instanceof Error ? error.message : 'unknown API error',
        });
      }
    }

    writeReport(outcomes);
    console.info('[weekly-planning-semantic-schema-eval]', JSON.stringify(outcomes, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || !outcome.document
      || Object.values(outcome.metrics).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 15 * 60 * 1000);
});
