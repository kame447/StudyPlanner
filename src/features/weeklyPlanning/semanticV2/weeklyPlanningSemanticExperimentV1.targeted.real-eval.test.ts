import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createSemanticPlanningV1SystemPrompt,
  createSemanticPlanningV1UserPrompt,
  parseSemanticPlanningV1,
  SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
  type SemanticPlanningDocumentV1,
  type SemanticTaskV1,
} from './weeklyPlanningSemanticExperimentV1';

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_V1_TARGETED_EVAL === '1';
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const MODEL = 'openai/gpt-4.1';

const refinementRules = [
  'Research, thesis work, laboratory work, and project work are non_study unless explicitly described as learning the research content. A non_study task must have study=null.',
  'Use discourse evidence such as an explicit item count to preserve grouping. Example: 分野は二つあって、OSとネットワーク、ヒューマンサイエンス means exactly two field components named OSとネットワーク and ヒューマンサイエンス. Do not split the first named field into OS and ネットワーク.',
  'Attach a shared quantity to the complete named field it modifies.',
  'Do not set planningWindow from a period that modifies only one workload. Whole-plan wording is required.',
  'A weekend preference is preferred_window. It is not necessarily recurrence.',
  'Use target for an amount the user wants to do. Use remaining only when unfinished remaining work is explicit.',
].join('\n');

interface TargetedCase {
  id: string;
  userText: string;
  evaluate: (document: SemanticPlanningDocumentV1) => Record<string, boolean>;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesText(value: string, expected: string): boolean {
  return normalize(value).includes(normalize(expected));
}

function matchingTask(
  document: SemanticPlanningDocumentV1,
  predicate: (task: SemanticTaskV1) => boolean,
): SemanticTaskV1 | undefined {
  return document.tasks.find(predicate);
}

function componentIds(task: SemanticTaskV1, phrase: string): Set<string> {
  const ids = new Set<string>();
  for (const component of task.study?.components ?? []) {
    if (includesText(component.label, phrase) || includesText(component.sourceText, phrase)) {
      ids.add(component.localId);
    }
  }
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

function workloadExists(params: {
  task: SemanticTaskV1 | undefined;
  phrase: string;
  amount: number;
  unitCode: string;
}): boolean {
  if (!params.task) return false;
  const ids = componentIds(params.task, params.phrase);
  return (params.task.study?.components ?? [])
    .filter((component) => ids.has(component.localId))
    .flatMap((component) => component.workloads)
    .some((workload) =>
      workload.amount === params.amount
      && workload.unitCode === params.unitCode
      && ['target', 'remaining'].includes(workload.kind));
}

function relationExists(
  document: SemanticPlanningDocumentV1,
  from: SemanticTaskV1 | undefined,
  to: SemanticTaskV1 | undefined,
): boolean {
  if (!from || !to) return false;
  return document.relations.some((relation) =>
    ['before', 'sequence'].includes(relation.kind)
    && relation.fromLocalId === from.localId
    && relation.toLocalId === to.localId);
}

const cases: TargetedCase[] = [
  {
    id: 'graduate-example-grouping-and-research',
    userText: '院試の過去問を進めたいんですけど、分野は二つあってOSとネットワークは1年分、ヒューマンサイエンスは2年分あります。あ、でもその前に研究も15時くらいまで進めないといけません。',
    evaluate(document) {
      const study = matchingTask(document, (task) =>
        task.category === 'study' && task.study?.purpose === 'exam');
      const research = matchingTask(document, (task) =>
        task.category === 'non_study' && includesText(task.title, '研究'));
      const fields = study?.study?.components.filter((component) => component.role === 'field') ?? [];
      return {
        genericStudyTask: Boolean(study),
        researchIsNonStudy: Boolean(research && research.study === null),
        exactlyTwoFields: fields.length === 2,
        osNetworkGrouped: workloadExists({
          task: study, phrase: 'OSとネットワーク', amount: 1, unitCode: 'exam_year',
        }),
        humanScienceMapped: workloadExists({
          task: study, phrase: 'ヒューマンサイエンス', amount: 2, unitCode: 'exam_year',
        }),
        researchLatestEnd: Boolean(research?.temporalConstraints.some((constraint) =>
          constraint.targetLocalId === research.localId
          && constraint.kind === 'latest_end'
          && constraint.endTime === '15:00'
          && constraint.precision === 'approximate')),
        researchBeforeStudy: relationExists(document, research, study),
      };
    },
  },
  {
    id: 'school-component-hierarchy',
    userText: '明日までに数学のワークを12ページ、英単語を80語やりたい。英単語は夕食前と寝る前、数学は20時から進めたい。',
    evaluate(document) {
      const studyTasks = document.tasks.filter((task) => task.category === 'study');
      const mathTask = studyTasks.find((task) =>
        includesText(task.sourceText, '数学') || includesText(task.title, '数学'));
      const englishTask = studyTasks.find((task) =>
        includesText(task.sourceText, '英単語') || includesText(task.title, '英単語'));
      const mathIds = mathTask ? componentIds(mathTask, '数学') : new Set<string>();
      const englishIds = englishTask ? componentIds(englishTask, '英単語') : new Set<string>();
      return {
        noPlanningWindowLeak: document.planningWindow === null,
        mathPages: workloadExists({ task: mathTask, phrase: '数学', amount: 12, unitCode: 'page' }),
        englishWords: workloadExists({ task: englishTask, phrase: '英単語', amount: 80, unitCode: 'word' }),
        mathStartAttached: Boolean(mathTask?.temporalConstraints.some((constraint) =>
          (constraint.targetLocalId === mathTask.localId || mathIds.has(constraint.targetLocalId))
          && constraint.kind === 'earliest_start'
          && constraint.startTime === '20:00')),
        englishPreferenceAttached: Boolean(englishTask?.temporalConstraints.some((constraint) =>
          (constraint.targetLocalId === englishTask.localId || englishIds.has(constraint.targetLocalId))
          && constraint.kind === 'preferred_window')),
        deadlinePreserved: studyTasks.every((task) =>
          task.temporalConstraints.some((constraint) =>
            constraint.kind === 'deadline'
            && includesText(constraint.dateExpression ?? '', '明日'))),
      };
    },
  },
  {
    id: 'mixed-work-and-exam',
    userText: '仕事の資料を仕上げた後、TOEICのリスニング問題を20問解きたい。TOEICは試験対策です。',
    evaluate(document) {
      const work = matchingTask(document, (task) =>
        task.category === 'non_study' && includesText(task.title, '資料'));
      const toeic = matchingTask(document, (task) =>
        task.category === 'study'
        && task.study?.purpose === 'exam'
        && includesText(task.study.contextLabel ?? '', 'TOEIC'));
      return {
        genericCategories: Boolean(work && toeic),
        listeningWorkload: workloadExists({
          task: toeic, phrase: 'リスニング', amount: 20, unitCode: 'problem',
        }),
        workBeforeStudy: relationExists(document, work, toeic),
      };
    },
  },
];

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
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: `${createSemanticPlanningV1SystemPrompt()}\n${refinementRules}`,
        },
        { role: 'user', content: createSemanticPlanningV1UserPrompt(userText) },
      ],
      response_format: SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
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
    lastError = `${response.status}: ${raw.slice(0, 300)}`;
    if (response.status !== 429) break;
  }
  throw new Error(lastError);
}

describe.skipIf(!shouldRun)('weekly planning semantic v1 targeted API evaluation', () => {
  it('verifies the remaining generic-schema boundaries', async () => {
    const token = process.env.GITHUB_MODELS_TOKEN?.trim();
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is required.');
    const outcomes: Array<Record<string, unknown>> = [];

    for (const evalCase of cases) {
      const startedAt = performance.now();
      try {
        const rawContent = await callModel(token, evalCase.userText);
        const parsed = parseSemanticPlanningV1(rawContent);
        const metrics = parsed.document ? evalCase.evaluate(parsed.document) : {};
        outcomes.push({
          id: evalCase.id,
          userText: evalCase.userText,
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
          latencyMs: Math.round(performance.now() - startedAt),
          metrics: {},
          document: null,
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
      await wait(20_000);
    }

    const passedCaseCount = outcomes.filter((outcome) =>
      outcome.document
      && Object.values(outcome.metrics as Record<string, boolean>).every(Boolean)).length;
    const report = {
      generatedAt: new Date().toISOString(),
      model: MODEL,
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.document).length,
        passedCaseCount,
      },
    };
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/weekly-planning-semantic-schema-v1-targeted-eval.json',
      JSON.stringify(report, null, 2),
    );
    console.info('[weekly-planning-semantic-v1-targeted-eval]', JSON.stringify(report, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || !outcome.document
      || Object.values(outcome.metrics as Record<string, boolean>).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 20 * 60 * 1000);
});
