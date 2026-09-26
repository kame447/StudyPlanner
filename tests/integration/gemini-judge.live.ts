import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  validateFocusedAuthorizationSyntheticCandidates,
} from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';
import { createGeminiJudge } from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiJudge';
import {
  aggregateGeminiJudgeCase,
  GEMINI_JUDGE_MAX_REPETITIONS,
  validateGeminiJudgeRepetitions,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiJudgeAggregation';
import {
  adaptSyntheticReviewCandidates,
  applyAdjudication,
  buildAdjudicationSheet,
  buildBlindReviewPackage,
  extractDoubleBlindReview,
  HUMAN_REVIEW_CSV_ENCODING,
  HUMAN_REVIEW_RUBRIC_VERSION,
  parseBlindReviewCsv,
  parseAdjudicationCsv,
  serializeAdjudicationCsv,
  serializeAdjudicationJson,
  serializeBlindReviewCsv,
  serializeBlindReviewJson,
  serializeBlindReviewMappingJson,
  toComparisonGoldLabels,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheet';

const MAX_CASES_CAP = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.length;

function boundedInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

it('writes an opt-in Gemini candidate review sheet without declaring gold', async () => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_JUDGE_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error('Set GEMINI_API_KEY and GEMINI_JUDGE_MODEL before running the Gemini judge.');
  }
  const maxCases = boundedInteger('GEMINI_JUDGE_MAX_CASES', MAX_CASES_CAP, MAX_CASES_CAP);
  const repetitions = boundedInteger(
    'GEMINI_JUDGE_REPETITIONS',
    GEMINI_JUDGE_MAX_REPETITIONS,
    GEMINI_JUDGE_MAX_REPETITIONS,
  );
  validateGeminiJudgeRepetitions(repetitions);
  validateFocusedAuthorizationSyntheticCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES);
  const outputDirectory = process.env.GEMINI_JUDGE_OUTPUT_DIR?.trim()
    || 'artifacts/issue333-gemini-judge';
  const candidates = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.slice(0, maxCases);
  const inputs = adaptSyntheticReviewCandidates(candidates);
  const judge = createGeminiJudge({ apiKey, model });
  const aggregates = [];
  for (const input of inputs) {
    const records = [];
    for (let runIndex = 0; runIndex < repetitions; runIndex += 1) {
      records.push(await judge.judge(input.id, {
        currentUserText: input.currentUserText,
        lastAssistantMessage: input.lastAssistantMessage,
      }, runIndex));
    }
    aggregates.push(aggregateGeminiJudgeCase(input.id, input.syntheticLabel, records));
  }
  const blind = buildBlindReviewPackage(inputs);
  const slotAPath = process.env.GEMINI_JUDGE_BLIND_REVIEW_A_CSV?.trim();
  const slotBPath = process.env.GEMINI_JUDGE_BLIND_REVIEW_B_CSV?.trim();
  if (Boolean(slotAPath) !== Boolean(slotBPath)) {
    throw new Error('Set both GEMINI_JUDGE_BLIND_REVIEW_A_CSV and GEMINI_JUDGE_BLIND_REVIEW_B_CSV.');
  }
  const review = slotAPath && slotBPath
    ? extractDoubleBlindReview(
      parseBlindReviewCsv(await readFile(slotAPath, 'utf8')),
      parseBlindReviewCsv(await readFile(slotBPath, 'utf8')),
      blind.mapping,
    )
    : extractDoubleBlindReview(blind.rows, blind.rows, blind.mapping);
  const adjudication = buildAdjudicationSheet(review, aggregates);
  const adjudicationPath = process.env.GEMINI_JUDGE_ADJUDICATION_CSV?.trim();
  if (adjudicationPath && (!slotAPath || !slotBPath)) {
    throw new Error('Adjudication requires both completed blind review CSV files.');
  }
  const resolution = applyAdjudication(
    review,
    adjudicationPath
      ? parseAdjudicationCsv(await readFile(adjudicationPath, 'utf8'))
      : [],
  );
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputDirectory, 'focused-authorization-gemini-judge-records.json'),
      JSON.stringify({
        judgeStatus: 'gemini_judged_candidate',
        warning: 'Gemini judgments prioritize human review and are never gold labels.',
        aggregates,
      }, null, 2),
      'utf8',
    ),
    ...(['A', 'B'] as const).flatMap((slot) => [
      writeFile(
        path.join(outputDirectory, `focused-authorization-blind-review-${slot}.json`),
        serializeBlindReviewJson(blind.rows, slot),
        'utf8',
      ),
      writeFile(
        path.join(outputDirectory, `focused-authorization-blind-review-${slot}.csv`),
        serializeBlindReviewCsv(blind.rows),
        'utf8',
      ),
    ]),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-blind-review-mapping.json'),
      serializeBlindReviewMappingJson(blind.mapping),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-adjudication.json'),
      serializeAdjudicationJson(adjudication),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-adjudication.csv'),
      serializeAdjudicationCsv(adjudication),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-human-review-summary.json'),
      JSON.stringify({
        rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
        summary: resolution.summary,
      }, null, 2),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-human-reviewed-gold.json'),
      JSON.stringify({
        rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
        summary: resolution.summary,
        goldCases: resolution.goldCases,
      }, null, 2),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-comparison-labels.json'),
      JSON.stringify(toComparisonGoldLabels(resolution.goldCases), null, 2),
      'utf8',
    ),
  ]);
  console.log(JSON.stringify({
    event: 'gemini_judge_review_sheet_written',
    outputDirectory,
    caseCount: inputs.length,
    repetitions,
    csvEncoding: HUMAN_REVIEW_CSV_ENCODING,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    reviewSummary: resolution.summary,
  }));
  expect(aggregates.flatMap((aggregate) => aggregate.records)
    .some((record) => record.status === 'judged')).toBe(true);
}, 900_000);
