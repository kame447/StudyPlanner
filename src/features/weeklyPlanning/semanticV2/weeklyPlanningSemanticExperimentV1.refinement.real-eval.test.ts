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

const shouldRun = process.env.WEEKLY_PLANNING_SEMANTIC_SCHEMA_V1_REFINEMENT_EVAL === '1';
const MODEL = 'openai/gpt-4.1';
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';

const additionalRules = [
  'Research, thesis work, laboratory work, and project work are non_study unless the user explicitly says they are studying or learning the research content. A non_study task must have study=null.',
  'Do not set planningWindow merely because one workload contains 今週, 今月, or another local period. planningWindow requires wording that scopes the whole requested plan, such as 今週の計画, 来週の予定, or 今日のスケジュール.',
  'Example: 英単語を今週合計300語、数学を2年分進めたい => planningWindow=null and only the English workload has periodExpression=今週.',
  'Example: 今週の計画を立てたい。英単語を300語進めたい => planningWindow.value=今週.',
  'For workload kind, use target when the user states an amount they want to do, remaining when they explicitly describe unfinished remaining work, completed only for finished work, and total only for an independently stated overall total.',
  'A weekend preference such as 週末にまとめたい is preferred_window with dateExpression=週末. It is not necessarily recurrence.',
].join('\n');

function systemPrompt(): string {
  return `${createSemanticPlanningV1SystemPrompt()}\n${additionalRules}`;
}

function norm(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesText(value: string, expected: string): boolean {
  return norm(value).includes(norm(expected));
}

function targetIdsForPhrase(task: SemanticTaskV1, phrase: string): Set<string> {
  const ids = new Set<string>();
  if (includesText(task.title, phrase) || includesText(task.sourceText, phrase)) ids.add(task.localId);
  for (const component of task.study?.components ?? []) {
    if (includesText(component.label, phrase) || includesText(component.sourceText, phrase)) {
      ids.add(component.localId);
      let parent = component.parentLocalId;
      while (parent) {
        ids.add(parent);
        parent = task.study?.components.find((candidate) => candidate.localId === parent)?.parentLocalId ?? null;
      }
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

function workloadMatches(params: {
  document: SemanticPlanningDocumentV1;
  phrase: string;
  amount: number;
  unitCode: string;
  periodExpression?: string;
  allowedKinds?: string[];
}): boolean {
  return params.document.tasks.some((task) => {
    const ids = targetIdsForPhrase(task, params.phrase);
    const workloads = [
      ...(ids.has(task.localId) ? task.workloads : []),
      ...(task.study?.components ?? [])
        .filter((component) => ids.has(component.localId))
        .flatMap((component) => component.workloads),
    ];
    return workloads.some((workload) =>
      workload.amount === params.amount
      && workload.unitCode === params.unitCode
      && (params.periodExpression === undefined
        || includesText(workload.periodExpression ?? '', params.periodExpression))
      && (params.allowedKinds === undefined || params.allowedKinds.includes(workload.kind)));
  });
}

function temporalMatches(params: {
  document: SemanticPlanningDocumentV1;
  phrase: string;
  kind: string;
  startTime?: string;
  endTime?: string;
  dateExpression?: string;
}): boolean {
  return params.document.tasks.some((task) => {
    const ids = targetIdsForPhrase(task, params.phrase);
    return task.temporalConstraints.some((constraint) =>
      ids.has(constraint.targetLocalId)
      && constraint.kind === params.kind
      && (params.startTime === undefined || constraint.startTime === params.startTime)
      && (params.endTime === undefined || constraint.endTime === params.endTime)
      && (params.dateExpression === undefined
        || includesText(constraint.dateExpression ?? '', params.dateExpression)));
  });
}

function relationMatches(
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

function componentForPhrase(task: SemanticTaskV1, phrase: string): SemanticStudyComponentV1 | undefined {
  return task.study?.components.find((component) =>
    includesText(component.label, phrase) || includesText(component.sourceText, phrase));
}

const cases = [
  {
    id: 'graduate-research-boundary',
    userText: '院試の過去問を進めたいんですけど、分野は二つあってOSとネットワークは1年分、ヒューマンサイエンスは2年分あります。あ、でもその前に研究も15時くらいまで進めないといけません。',
    evaluate(document: SemanticPlanningDocumentV1) {
      const study = document.tasks.find((task) =>
        task.category === 'study' && task.study?.purpose === 'exam');
      const research = document.tasks.find((task) =>
        task.category === 'non_study' && includesText(task.title, '研究'));
      return {
        researchNonStudy: Boolean(research && research.study === null),
        studyTask: Boolean(study),
        osAndNetworkOneUnit: workloadMatches({
          document,
          phrase: 'OSとネットワーク',
          amount: 1,
          unitCode: 'exam_year',
          allowedKinds: ['target', 'remaining'],
        }),
        humanScienceTwoUnits: workloadMatches({
          document,
          phrase: 'ヒューマンサイエンス',
          amount: 2,
          unitCode: 'exam_year',
          allowedKinds: ['target', 'remaining'],
        }),
        researchLatestEnd: temporalMatches({
          document, phrase: '研究', kind: 'latest_end', endTime: '15:00',
        }),
        researchBeforeStudy: relationMatches(document, research, study),
      };
    },
  },
  {
    id: 'local-period-and-weekend-preference',
    userText: '共通テスト対策で、英単語を毎日300語ずつではなく今週合計300語、数学IAの過去問を2年分進めたいです。数学は週末にまとめたいです。',
    evaluate(document: SemanticPlanningDocumentV1) {
      return {
        localPeriodOnly: document.planningWindow === null,
        englishWeeklyTotal: workloadMatches({
          document,
          phrase: '英単語',
          amount: 300,
          unitCode: 'word',
          periodExpression: '今週',
          allowedKinds: ['target', 'total'],
        }),
        mathYears: workloadMatches({
          document,
          phrase: '数学IA',
          amount: 2,
          unitCode: 'exam_year',
          allowedKinds: ['target'],
        }),
        mathWeekendPreference: temporalMatches({
          document, phrase: '数学', kind: 'preferred_window', dateExpression: '週末',
        }),
      };
    },
  },
  {
    id: 'hierarchical-school-components',
    userText: '明日までに数学のワークを12ページ、英単語を80語やりたい。英単語は夕食前と寝る前、数学は20時から進めたい。',
    evaluate(document: SemanticPlanningDocumentV1) {
      return {
        noPlanWindowLeak: document.planningWindow === null,
        mathPages: workloadMatches({
          document, phrase: '数学のワーク', amount: 12, unitCode: 'page', allowedKinds: ['target'],
        }),
        englishWords: workloadMatches({
          document, phrase: '英単語', amount: 80, unitCode: 'word', allowedKinds: ['target'],
        }),
        mathStart: temporalMatches({
          document, phrase: '数学', kind: 'earliest_start', startTime: '20:00',
        }),
        englishPreference: temporalMatches({
          document, phrase: '英単語', kind: 'preferred_window',
        }),
        deadline: temporalMatches({
          document, phrase: '数学', kind: 'deadline', dateExpression: '明日',
        }) && temporalMatches({
          document, phrase: '英単語', kind: 'deadline', dateExpression: '明日',
        }),
      };
    },
  },
  {
    id: 'mixed-work-and-exam',
    userText: '仕事の資料を仕上げた後、TOEICのリスニング問題を20問解きたい。TOEICは試験対策です。',
    evaluate(document: SemanticPlanningDocumentV1) {
      const work = document.tasks.find((task) =>
        task.category === 'non_study' && includesText(task.title, '資料'));
      const toeic = document.tasks.find((task) =>
        task.category === 'study'
        && task.study?.purpose === 'exam'
        && includesText(task.study.contextLabel ?? '', 'TOEIC'));
      return {
        categories: Boolean(work && toeic),
        listeningProblems: workloadMatches({
          document,
          phrase: 'リスニング',
          amount: 20,
          unitCode: 'problem',
          allowedKinds: ['target'],
        }),
        relation: relationMatches(document, work, toeic),
      };
    },
  },
  {
    id: 'workload-and-effort-rate',
    userText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
    evaluate(document: SemanticPlanningDocumentV1) {
      const task = document.tasks.find((candidate) =>
        candidate.category === 'study' && includesText(candidate.sourceText, '簿記'));
      const targetIds = task ? targetIdsForPhrase(task, '簿記') : new Set<string>();
      return {
        workload: workloadMatches({
          document,
          phrase: '簿記',
          amount: 20,
          unitCode: 'problem',
          allowedKinds: ['target'],
        }),
        perUnitEstimate: Boolean(task?.effortEstimates.some((estimate) =>
          targetIds.has(estimate.targetLocalId)
          && estimate.kind === 'duration_per_unit'
          && estimate.minutes === 10
          && estimate.unitCode === 'problem'
          && estimate.precision === 'approximate')),
      };
    },
  },
] as const;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(token: string, userText: string): Promise<string> {
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
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: createSemanticPlanningV1UserPrompt(userText) },
      ],
      response_format: SEMANTIC_PLANNING_V1_RESPONSE_FORMAT,
    }),
  });
  const raw = await response.text();
  let data: { choices?: Array<{ message?: { content?: string | null } }>; error?: string | { message?: string } };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`non-json response: ${raw.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !content) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `status ${response.status}`);
  }
  return content;
}

describe.skipIf(!shouldRun)('weekly planning semantic v1 refinement real evaluation', () => {
  it('resolves the remaining semantic boundaries', async () => {
    const token = process.env.GITHUB_MODELS_TOKEN?.trim();
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is required.');
    const outcomes: Array<Record<string, unknown>> = [];

    for (let index = 0; index < cases.length; index += 1) {
      const evalCase = cases[index];
      if (index > 0) await wait(25_000);
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
    }

    const passed = outcomes.filter((outcome) =>
      outcome.document
      && Object.values(outcome.metrics as Record<string, boolean>).every(Boolean));
    const report = {
      generatedAt: new Date().toISOString(),
      outcomes,
      summary: {
        caseCount: outcomes.length,
        parsedCount: outcomes.filter((outcome) => outcome.document).length,
        passedCaseCount: passed.length,
      },
    };
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/weekly-planning-semantic-schema-v1-refinement-eval.json',
      JSON.stringify(report, null, 2),
    );
    console.info('[weekly-planning-semantic-v1-refinement-eval]', JSON.stringify(report, null, 2));

    const failures = outcomes.filter((outcome) =>
      outcome.error
      || !outcome.document
      || Object.values(outcome.metrics as Record<string, boolean>).some((value) => !value));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 20 * 60 * 1000);
});
