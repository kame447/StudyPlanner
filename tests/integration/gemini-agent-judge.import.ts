import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationExpansionCandidates';
import { FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';
import { importGeminiAgentJudgments } from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiAgentJudgePacket';
import {
  aggregateGeminiJudgeCase,
  GEMINI_JUDGE_MAX_REPETITIONS,
  validateGeminiJudgeRepetitions,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiJudgeAggregation';
import type {
  GeminiJudgeRecord,
  GeminiJudgedClass,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiJudgeContract';
import {
  adaptExpansionReviewCandidates,
  adaptSyntheticReviewCandidates,
  buildAdjudicationSheet,
  buildBlindReviewPackage,
  combineReviewInputs,
  extractDoubleBlindReview,
  parseBlindReviewCsv,
  serializeAdjudicationCsv,
  serializeAdjudicationJson,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheet';

const DEFAULT_OUTPUT_DIRECTORY = 'artifacts/issue333-gemini-agent';

function requestedRuns(): number {
  const raw = process.env.GEMINI_AGENT_JUDGE_RUNS?.trim();
  const runs = raw ? Number(raw) : GEMINI_JUDGE_MAX_REPETITIONS;
  validateGeminiJudgeRepetitions(runs);
  return runs;
}

function classCounts(records: readonly GeminiJudgeRecord[]): Record<GeminiJudgedClass, number> {
  const counts: Record<GeminiJudgedClass, number> = {
    create_plan: 0,
    fallback: 0,
    ambiguous: 0,
  };
  for (const record of records) {
    if (record.status === 'judged' && record.judgment) {
      counts[record.judgment.judgedClass] += 1;
    }
  }
  return counts;
}

it('imports Orrery agent judgments and writes candidate-only review artifacts', async () => {
  const runs = requestedRuns();
  const outputDirectory = process.env.GEMINI_AGENT_JUDGE_OUTPUT_DIR?.trim()
    || DEFAULT_OUTPUT_DIRECTORY;
  const inputs = combineReviewInputs(
    adaptSyntheticReviewCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES),
    adaptExpansionReviewCandidates(FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES),
  );
  const inputByCaseId = new Map(inputs.map((input) => [input.id, input]));
  const records: GeminiJudgeRecord[] = [];
  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    const [mappingText, responseText, agentText] = await Promise.all([
      readFile(path.join(outputDirectory, 'mappings', `run-${runIndex}.json`), 'utf8'),
      readFile(path.join(outputDirectory, `run-${runIndex}`, 'judgments.json'), 'utf8'),
      readFile(path.join(outputDirectory, `run-${runIndex}`, 'agent.json'), 'utf8'),
    ]);
    const imported = importGeminiAgentJudgments(
      JSON.parse(mappingText) as unknown,
      responseText,
      JSON.parse(agentText) as unknown,
    );
    const importedIds = new Set(imported.map((record) => record.caseId));
    if (imported.length !== inputs.length
      || importedIds.size !== inputs.length
      || inputs.some((input) => !importedIds.has(input.id))) {
      throw new Error(`Gemini agent mapping for run ${runIndex} does not cover the 131 expected cases.`);
    }
    records.push(...imported);
  }

  const aggregates = inputs.map((input) => aggregateGeminiJudgeCase(
    input.id,
    input.syntheticLabel,
    records.filter((record) => record.caseId === input.id),
  ));
  const statusCounts = {
    judged: records.filter((record) => record.status === 'judged').length,
    invalid: records.filter((record) => record.status === 'invalid_response').length,
    missing: records.filter((record) => record.status === 'missing').length,
  };
  const disagreements = aggregates.filter((aggregate) => {
    const input = inputByCaseId.get(aggregate.caseId);
    return input?.syntheticLabel !== null && aggregate.disagreesWithSyntheticLabel;
  });
  const summary = {
    judgeStatus: 'gemini_judged_candidate' as const,
    warning: 'Gemini judgments are first-pass candidates and never human-reviewed gold.',
    runCount: runs,
    caseCount: inputs.length,
    recordCount: records.length,
    statusCounts,
    classDistribution: classCounts(records),
    unstableCount: aggregates.filter((aggregate) => aggregate.unstable).length,
    labeledCaseCount: inputs.filter((input) => input.syntheticLabel !== null).length,
    comparedLabeledCaseCount: aggregates.filter((aggregate) => {
      const input = inputByCaseId.get(aggregate.caseId);
      return input?.syntheticLabel !== null && aggregate.majorityClass !== null;
    }).length,
    disagreementsWithSyntheticLabel: {
      count: disagreements.length,
      caseIds: disagreements.map((aggregate) => aggregate.caseId),
    },
  };

  const blind = buildBlindReviewPackage(inputs);
  const reviewAPath = process.env.GEMINI_AGENT_JUDGE_BLIND_REVIEW_A_CSV?.trim();
  const reviewBPath = process.env.GEMINI_AGENT_JUDGE_BLIND_REVIEW_B_CSV?.trim();
  if (Boolean(reviewAPath) !== Boolean(reviewBPath)) {
    throw new Error('Set both GEMINI_AGENT_JUDGE_BLIND_REVIEW_A_CSV and GEMINI_AGENT_JUDGE_BLIND_REVIEW_B_CSV.');
  }
  const review = reviewAPath && reviewBPath
    ? extractDoubleBlindReview(
      parseBlindReviewCsv(await readFile(reviewAPath, 'utf8')),
      parseBlindReviewCsv(await readFile(reviewBPath, 'utf8')),
      blind.mapping,
    )
    : extractDoubleBlindReview(blind.rows, blind.rows, blind.mapping);
  const pendingCaseIds = new Set(review.pendingCaseIds);
  const adjudication = buildAdjudicationSheet(
    review,
    aggregates,
    inputs.filter((input) => pendingCaseIds.has(input.id)),
  );

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'gemini-records.json'), JSON.stringify({
      judgeStatus: 'gemini_judged_candidate',
      warning: 'Gemini judgments are first-pass candidates and never human-reviewed gold.',
      records,
    }, null, 2), 'utf8'),
    writeFile(path.join(outputDirectory, 'gemini-aggregates.json'), JSON.stringify({
      judgeStatus: 'gemini_judged_candidate',
      aggregates,
    }, null, 2), 'utf8'),
    writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8'),
    writeFile(
      path.join(outputDirectory, 'adjudication.json'),
      serializeAdjudicationJson(adjudication),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'adjudication.csv'),
      serializeAdjudicationCsv(adjudication),
      'utf8',
    ),
  ]);
  console.log(JSON.stringify({ event: 'gemini_agent_judgments_imported', ...summary }));
  expect(records).toHaveLength(inputs.length * runs);
  expect(statusCounts.judged + statusCounts.invalid + statusCounts.missing)
    .toBe(records.length);
});
