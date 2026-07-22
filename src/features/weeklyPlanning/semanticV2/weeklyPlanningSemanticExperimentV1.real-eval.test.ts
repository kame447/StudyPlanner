import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createSemanticPlanningV1SystemPrompt,
  createSemanticPlanningV1UserPrompt,
  parseSemanticPlanningV1,
  SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
  type SemanticPlanningDocumentV1,
  type SemanticStudyComponentV1,
  type SemanticTaskV1,
} from './weeklyPlanningSemanticExperimentV1';

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_V1_REAL_EVAL === '1';
const MODEL = process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_V1_MODEL?.trim() || 'openai/gpt-4.1';
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';

interface EvalCase {
  id: string;
  userText: string;
  evaluate: (document: SemanticPlanningDocumentV1) => Record<string, boolean>;
}

interface ComponentMatch {
  task: SemanticTaskV1;
  component: SemanticStudyComponentV1;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesLabel(value: string, expected: string): boolean {
  return normalized(value).includes(normalized(expected));
}

function componentMatches(document: SemanticPlanningDocumentV1, label: string): ComponentMatch[] {
  return document.tasks.flatMap((task) =>
    (task.study?.components ?? [])
      .filter((component) => includesLabel(component.label, label))
      .map((component) => ({ task, component })));
}

function descendantIds(task: SemanticTaskV1, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of task.study?.components ?? []) {
      if (component.parentLocalId && ids.has(component.parentLocalId) && !ids.has(component.localId)) {
        ids.add(component.localId);
        changed = true;
      }
    }
  }
  return ids;
}

function hasComponentWorkload(params: {
  document: SemanticPlanningDocumentV1;
  label: string;
  amount: number;
  unitCode: string;
  perOccurrence?: boolean;
  periodExpression?: string;
}): boolean {
  return componentMatches(params.document, params.label).some(({ task, component }) => {
    const ids = descendantIds(task, component.localId);
    return (task.study?.components ?? [])
      .filter((candidate) => ids.has(candidate.localId))
      .flatMap((candidate) => candidate.workloads)
      .some((workload) =>
        workload.amount === params.amount
        && workload.unitCode === params.unitCode
        && (params.perOccurrence === undefined || workload.perOccurrence === params.perOccurrence)
        && (params.periodExpression === undefined
          || includesLabel(workload.periodExpression ?? '', params.periodExpression)));
  });
}

function hasTaskOrComponentWorkload(params: {
  document: SemanticPlanningDocumentV1;
  label: string;
  amount: number;
  unitCode: string;
  perOccurrence?: boolean;
}): boolean {
  const componentResult = hasComponentWorkload(params);
  if (componentResult) return true;
  return params.document.tasks.some((task) =>
    includesLabel(task.title, params.label)
    && task.workloads.some((workload) =>
      workload.amount === params.amount
      && workload.unitCode === params.unitCode
      && (params.perOccurrence === undefined || workload.perOccurrence === params.perOccurrence)));
}

function targetCovers(match: ComponentMatch, targetLocalId: string): boolean {
  if (targetLocalId === match.task.localId) return true;
  return descendantIds(match.task, match.component.localId).has(targetLocalId);
}

function hasRecurrence(params: {
  document: SemanticPlanningDocumentV1;
  label: string;
  kind: string;
  count?: number;
}): boolean {
  return componentMatches(params.document, params.label).some((match) =>
    match.task.recurrence.some((recurrence) =>
      targetCovers(match, recurrence.targetLocalId)
      && recurrence.kind === params.kind
      && (params.count === undefined || recurrence.count === params.count)));
}

function hasTemporalConstraint(params: {
  document: SemanticPlanningDocumentV1;
  label: string;
  kind: string;
  startTime?: string;
  endTime?: string;
  dateExpression?: string;
}): boolean {
  const componentMatchesForLabel = componentMatches(params.document, params.label);
  const taskMatches = params.document.tasks
    .filter((task) => includesLabel(task.title, params.label))
    .map((task) => ({ task, component: null as SemanticStudyComponentV1 | null }));
  return [...componentMatchesForLabel, ...taskMatches].some((match) =>
    match.task.temporalConstraints.some((constraint) => {
      const targetMatches = match.component
        ? targetCovers(match as ComponentMatch, constraint.targetLocalId)
        : constraint.targetLocalId === match.task.localId;
      return targetMatches
        && constraint.kind === params.kind
        && (params.startTime === undefined || constraint.startTime === params.startTime)
        && (params.endTime === undefined || constraint.endTime === params.endTime)
        && (params.dateExpression === undefined
          || includesLabel(constraint.dateExpression ?? '', params.dateExpression));
    }));
}

function relationExists(params: {
  document: SemanticPlanningDocumentV1;
  from: SemanticTaskV1 | undefined;
  to: SemanticTaskV1 | undefined;
  kinds: string[];
}): boolean {
  if (!params.from || !params.to) return false;
  return params.document.relations.some((relation) =>
    params.kinds.includes(relation.kind)
    && relation.fromLocalId === params.from?.localId
    && relation.toLocalId === params.to?.localId);
}

function findTask(
  document: SemanticPlanningDocumentV1,
  predicate: (task: SemanticTaskV1) => boolean,
): SemanticTaskV1 | undefined {
  return document.tasks.find(predicate);
}

function buildCases(): EvalCase[] {
  return [
    {
      id: 'mixed:graduate-exam-and-research',
      userText: '院試の過去問を進めたいんですけど、分野は二つあってOSとネットワークは1年分、ヒューマンサイエンスは2年分あります。あ、でもその前に研究も15時くらいまで進めないといけません。',
      evaluate: (document) => {
        const study = findTask(document, (task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', '院'));
        const research = findTask(document, (task) =>
          task.category === 'non_study' && includesLabel(task.title, '研究'));
        return {
          studyGeneric: Boolean(study),
          osWorkload: hasComponentWorkload({
            document, label: 'OSとネットワーク', amount: 1, unitCode: 'exam_year',
          }),
          humanScienceWorkload: hasComponentWorkload({
            document, label: 'ヒューマンサイエンス', amount: 2, unitCode: 'exam_year',
          }),
          researchSeparate: Boolean(research),
          researchLatestEnd: hasTemporalConstraint({
            document, label: '研究', kind: 'latest_end', endTime: '15:00',
          }),
          researchBeforeStudy: relationExists({
            document, from: research, to: study, kinds: ['before', 'sequence'],
          }),
        };
      },
    },
    {
      id: 'study:qualification-exam',
      userText: '基本情報技術者試験に向けて、アルゴリズムの過去問を30問、ネットワークの参考書を3章進めたいです。',
      evaluate: (document) => ({
        genericExamContext: document.tasks.some((task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', '基本情報')),
        algorithmWorkload: hasComponentWorkload({
          document, label: 'アルゴリズム', amount: 30, unitCode: 'problem',
        }),
        networkWorkload: hasComponentWorkload({
          document, label: 'ネットワーク', amount: 3, unitCode: 'chapter',
        }),
      }),
    },
    {
      id: 'study:university-entrance-attachment',
      userText: '共通テスト対策で、英単語を毎日300語ずつではなく今週合計300語、数学IAの過去問を2年分進めたいです。数学は週末にまとめたいです。',
      evaluate: (document) => ({
        context: document.tasks.some((task) =>
          task.category === 'study'
          && task.study?.purpose === 'exam'
          && includesLabel(task.study.contextLabel ?? '', '共通テスト')),
        englishWeeklyTotal: hasComponentWorkload({
          document,
          label: '英単語',
          amount: 300,
          unitCode: 'word',
          perOccurrence: false,
          periodExpression: '今週',
        }),
        mathYears: hasComponentWorkload({
          document, label: '数学IA', amount: 2, unitCode: 'exam_year',
        }),
        mathWeekend: hasRecurrence({ document, label: '数学IA', kind: 'weekends' }),
        notWholePlanWindow: document.planningWindow === null,
        noEnglishDailyRecurrence: !hasRecurrence({ document, label: '英単語', kind: 'daily' }),
      }),
    },
    {
      id: 'study:school-work-and-timing',
      userText: '明日までに数学のワークを12ページ、英単語を80語やりたい。英単語は夕食前と寝る前、数学は20時から進めたい。',
      evaluate: (document) => ({
        studyTasks: document.tasks.filter((task) => task.category === 'study').length >= 1,
        mathPages: hasComponentWorkload({
          document, label: '数学', amount: 12, unitCode: 'page',
        }),
        englishWords: hasComponentWorkload({
          document, label: '英単語', amount: 80, unitCode: 'word',
        }),
        mathStart: hasTemporalConstraint({
          document, label: '数学', kind: 'earliest_start', startTime: '20:00',
        }),
        englishPreferred: hasTemporalConstraint({
          document, label: '英単語', kind: 'preferred_window',
        }),
        taskDeadline: document.tasks
          .filter((task) => task.category === 'study')
          .every((task) => task.temporalConstraints.some((constraint) =>
            constraint.kind === 'deadline'
            && includesLabel(constraint.dateExpression ?? '', '明日'))),
        notWholePlanWindow: document.planningWindow === null,
      }),
    },
    {
      id: 'study:recurring-habits',
      userText: '毎日英会話を30分、週3回プログラミングの問題を2問ずつ進めたい。',
      evaluate: (document) => ({
        englishWorkload: hasTaskOrComponentWorkload({
          document, label: '英会話', amount: 30, unitCode: 'minute', perOccurrence: true,
        }),
        englishDaily: hasRecurrence({ document, label: '英会話', kind: 'daily' }),
        programmingWorkload: hasComponentWorkload({
          document, label: 'プログラミング', amount: 2, unitCode: 'problem', perOccurrence: true,
        }),
        programmingFrequency: hasRecurrence({
          document, label: 'プログラミング', kind: 'times_per_week', count: 3,
        }),
      }),
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
          separateTasks: Boolean(cleaning && shopping),
          cleaningWorkload: hasTaskOrComponentWorkload({
            document, label: '掃除', amount: 1, unitCode: 'hour',
          }) || hasTaskOrComponentWorkload({
            document, label: '掃除', amount: 60, unitCode: 'minute',
          }),
          shoppingDeadline: hasTemporalConstraint({
            document, label: '買い物', kind: 'deadline', endTime: '18:00',
          }),
          sequence: relationExists({
            document, from: cleaning, to: shopping, kinds: ['before', 'sequence'],
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
          mixedCategories: Boolean(work && toeic),
          listeningWorkload: hasComponentWorkload({
            document, label: 'リスニング', amount: 20, unitCode: 'problem',
          }),
          relation: relationExists({
            document, from: work, to: toeic, kinds: ['before', 'sequence'],
          }),
        };
      },
    },
    {
      id: 'study:workload-and-effort-rate',
      userText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
      evaluate: (document) => {
        const matches = componentMatches(document, '簿記');
        const workload = hasComponentWorkload({
          document, label: '簿記', amount: 20, unitCode: 'problem',
        });
        const estimate = matches.some((match) =>
          match.task.effortEstimates.some((item) =>
            targetCovers(match, item.targetLocalId)
            && item.kind === 'duration_per_unit'
            && item.minutes === 10
            && item.unitCode === 'problem'
            && item.precision === 'approximate'));
        return { workload, perUnitEstimate: estimate };
      },
    },
  ];
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGitHubModels(token: string, userText: string): Promise<string> {
  const response = await fetch(ENDPOINT, {
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
      max_tokens: 2000,
      messages: [
        { role: 'system', content: createSemanticPlanningV1SystemPrompt() },
        { role: 'user', content: createSemanticPlanningV1UserPrompt(userText) },
      ],
      response_format: SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
    }),
  });
  const raw = await response.text();
  let data: {
    choices?: Array<{ message?: { content?: string | null } }>;
    message?: string;
    error?: { message?: string } | string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`GitHub Models returned non-JSON: ${raw.slice(0, 300)}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !content) {
    const message = typeof data.error === 'string'
      ? data.error
      : data.error?.message || data.message || `status ${response.status}`;
    throw new Error(message);
  }
  return content;
}

describe.skipIf(!shouldRun)('weekly planning semantic schema v1 real evaluation', () => {
  it('normalizes heterogeneous planning requests into the generic schema', async () => {
    const token = process.env.GITHUB_MODELS_TOKEN?.trim();
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is required.');
    const outcomes: Array<Record<string, unknown>> = [];
    const cases = buildCases();

    for (let index = 0; index < cases.length; index += 1) {
      const evalCase = cases[index];
      if (index > 0) await delay(13_000);
      const startedAt = performance.now();
      try {
        const rawContent = await callGitHubModels(token, evalCase.userText);
        const parsed = parseSemanticPlanningV1(rawContent);
        const metrics = parsed.document ? evalCase.evaluate(parsed.document) : {};
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
          model: MODEL,
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
          model: MODEL,
          latencyMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : 'unknown error',
          metrics: {},
          document: null,
        });
      }
    }

    mkdirSync('artifacts', { recursive: true });
    const passed = outcomes.filter((outcome) =>
      outcome.document
      && Object.values(outcome.metrics as Record<string, boolean>).every(Boolean));
    const report = {
      generatedAt: new Date().toISOString(),
      schemaVersion: 'planning-semantic-v1',
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.document).length,
        passedCaseCount: passed.length,
      },
    };
    writeFileSync(
      'artifacts/weekly-planning-semantic-schema-v1-eval.json',
      JSON.stringify(report, null, 2),
    );
    console.info('[weekly-planning-semantic-schema-v1-eval]', JSON.stringify(report, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || !outcome.document
      || Object.values(outcome.metrics as Record<string, boolean>).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 20 * 60 * 1000);
});
