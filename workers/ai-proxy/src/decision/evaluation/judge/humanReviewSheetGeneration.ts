import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  validateFocusedAuthorizationSyntheticCandidates,
} from '../focusedAuthorizationSyntheticCandidates';
import {
  adaptSyntheticReviewCandidates,
  applyAdjudication,
  buildAdjudicationSheet,
  buildBlindReviewPackage,
  combineReviewInputs,
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
  type FocusedAuthorizationReviewInput,
} from './humanReviewSheet';

export async function generateEmptyReviewSheets(
  extraInputs: readonly FocusedAuthorizationReviewInput[] = [],
): Promise<void> {
  const outputDirectory = process.env.GEMINI_AGENT_JUDGE_OUTPUT_DIR?.trim()
    || process.env.GEMINI_JUDGE_OUTPUT_DIR?.trim()
    || 'artifacts/issue333-gemini-agent';
  validateFocusedAuthorizationSyntheticCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES);
  const inputs = combineReviewInputs(
    adaptSyntheticReviewCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES),
    extraInputs,
  );
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
  const adjudication = buildAdjudicationSheet(review, []);
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
    ...(['A', 'B'] as const).flatMap((slot) => [
      writeFile(
        path.join(outputDirectory, `focused-authorization-blind-review-${slot}.empty.json`),
        serializeBlindReviewJson(blind.rows, slot),
        'utf8',
      ),
      writeFile(
        path.join(outputDirectory, `focused-authorization-blind-review-${slot}.empty.csv`),
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
      path.join(outputDirectory, 'focused-authorization-adjudication.empty.json'),
      serializeAdjudicationJson(adjudication),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-adjudication.empty.csv'),
      serializeAdjudicationCsv(adjudication),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-human-review-summary.empty.json'),
      JSON.stringify({
        rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
        summary: resolution.summary,
      }, null, 2),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-human-reviewed-gold.empty.json'),
      JSON.stringify({
        rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
        summary: resolution.summary,
        goldCases: resolution.goldCases,
      }, null, 2),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'focused-authorization-comparison-labels.empty.json'),
      JSON.stringify(toComparisonGoldLabels(resolution.goldCases), null, 2),
      'utf8',
    ),
  ]);
  console.log(JSON.stringify({
    event: 'empty_human_review_sheets_written',
    outputDirectory,
    rowCount: blind.rows.length,
    csvEncoding: HUMAN_REVIEW_CSV_ENCODING,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    summary: resolution.summary,
  }));
}
