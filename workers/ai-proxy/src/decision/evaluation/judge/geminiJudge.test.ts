import { describe, expect, it, vi } from 'vitest';
import { FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES } from '../focusedAuthorizationSyntheticCandidates';
import { createGeminiJudge } from './geminiJudge';
import {
  aggregateGeminiJudgeCase,
  aggregateGeminiJudgeRecords,
} from './geminiJudgeAggregation';
import {
  parseGeminiJudgment,
  type GeminiJudgeRecord,
  type GeminiJudgment,
} from './geminiJudgeContract';
import {
  adaptSyntheticReviewCandidates,
  applyAdjudication,
  buildAdjudicationSheet,
  buildBlindReviewPackage,
  cohensKappa,
  combineReviewInputs,
  extractDoubleBlindReview,
  HUMAN_REVIEW_RUBRIC_VERSION,
  HUMAN_REVIEW_RUBRIC_TEXT,
  parseAdjudicationCsv,
  parseBlindReviewCsv,
  serializeAdjudicationCsv,
  serializeBlindReviewCsv,
  serializeBlindReviewJson,
  serializeBlindReviewMappingJson,
  toComparisonGoldLabels,
  validateReviewInputs,
  type BlindReviewRow,
  type FocusedAuthorizationReviewInput,
  type HumanReviewLabel,
} from './humanReviewSheet';

const validJudgment: GeminiJudgment = {
  judgedClass: 'create_plan',
  reviewRequired: false,
  rationale: '既存条件のまま案の作成だけを依頼している。',
  problematicExpressions: [],
  alternativeInterpretations: [],
};

function response(judgment: unknown = validJudgment): Response {
  return Response.json({
    modelVersion: 'gemini-served-fixture',
    candidates: [{ content: { parts: [{ text: JSON.stringify(judgment) }] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
  });
}

function judged(
  caseId: string,
  judgedClass: GeminiJudgment['judgedClass'],
  reviewRequired = false,
): GeminiJudgeRecord {
  return {
    caseId,
    judgeStatus: 'gemini_judged_candidate',
    judgeProvider: 'gemini',
    requestedModel: 'gemini-requested-fixture',
    servedModel: 'gemini-served-fixture',
    promptVersion: 'focused-authorization-judge-v1',
    schemaVersion: 'focused-authorization-judgment-v1',
    runIndex: 0,
    temperature: 0,
    latencyMs: 4,
    inputTokens: 12,
    outputTokens: 8,
    status: 'judged',
    reason: null,
    judgment: { ...validJudgment, judgedClass, reviewRequired },
  };
}

function unavailable(caseId: string, runIndex: number): GeminiJudgeRecord {
  return {
    caseId,
    judgeStatus: 'gemini_judged_candidate',
    judgeProvider: 'gemini',
    requestedModel: 'gemini-requested-fixture',
    servedModel: null,
    promptVersion: 'focused-authorization-judge-v1',
    schemaVersion: 'focused-authorization-judgment-v1',
    runIndex,
    temperature: 0,
    latencyMs: 4,
    inputTokens: null,
    outputTokens: null,
    status: 'unavailable',
    reason: 'network',
    judgment: null,
  };
}

function completedRows(
  rows: readonly BlindReviewRow[],
  labels: readonly HumanReviewLabel[],
  reviewer: string,
): BlindReviewRow[] {
  return rows.map((row, index) => index < labels.length ? {
    ...row,
    humanLabel: labels[index],
    humanReviewer: reviewer,
    humanReviewedAt: '2026-09-26T20:30:00+09:00',
    humanNotes: `slot review ${index}`,
  } : row);
}

describe('Gemini judge response contract', () => {
  it('accepts the exact bounded judgment', () => {
    expect(parseGeminiJudgment(validJudgment)).toEqual(validJudgment);
  });

  it('rejects extra keys and bad enums instead of coercing them', () => {
    expect(parseGeminiJudgment({ ...validJudgment, extra: true })).toBeNull();
    expect(parseGeminiJudgment({ ...validJudgment, judgedClass: 'unknown' })).toBeNull();
    expect(parseGeminiJudgment({
      ...validJudgment,
      alternativeInterpretations: [{ class: 'create_plan', reading: '候補', extra: true }],
    })).toBeNull();
  });
});

describe('Gemini REST judge', () => {
  it('sends only blinded conversation data and keeps the API key out of the URL', async () => {
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
    const judge = createGeminiJudge({
      apiKey: 'secret-fixture-key',
      model: 'gemini-model-fixture',
      fetch: fakeFetch as typeof fetch,
    });
    const record = await judge.judge('case-id-must-not-be-sent', {
      currentUserText: 'CURRENT_USER_MARKER',
      lastAssistantMessage: 'LAST_ASSISTANT_MARKER',
    }, 0);
    expect(record).toMatchObject({
      status: 'judged', requestedModel: 'gemini-model-fixture',
      servedModel: 'gemini-served-fixture', inputTokens: 12, outputTokens: 8,
    });
    const [url, init] = fakeFetch.mock.calls[0];
    expect(String(url)).not.toContain('secret-fixture-key');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-fixture-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('CURRENT_USER_MARKER');
    expect(serialized).toContain('LAST_ASSISTANT_MARKER');
    expect(serialized).not.toContain('case-id-must-not-be-sent');
    expect(serialized).not.toMatch(/"(?:expected|layer|split|caseId)"\s*:/);
    expect(body).toMatchObject({
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });
  });

  it('turns a malformed structured response into invalid_response', async () => {
    const judge = createGeminiJudge({
      apiKey: 'key', model: 'model',
      fetch: vi.fn(async () => response({ ...validJudgment, extra: true })) as typeof fetch,
    });
    await expect(judge.judge('case', {
      currentUserText: 'はい', lastAssistantMessage: '案を作りますか？',
    }, 0)).resolves.toMatchObject({
      status: 'invalid_response', reason: 'invalid_response', judgment: null,
    });
  });

  it('classifies timeout as unavailable', async () => {
    const fakeFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })) as typeof fetch;
    const judge = createGeminiJudge({ apiKey: 'key', model: 'model', fetch: fakeFetch, timeoutMs: 5 });
    await expect(judge.judge('case', {
      currentUserText: 'はい', lastAssistantMessage: '案を作りますか？',
    }, 0)).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('does not call fetch when required configuration is absent', async () => {
    const fakeFetch = vi.fn(async () => response()) as typeof fetch;
    const judge = createGeminiJudge({ model: 'model', fetch: fakeFetch });
    await expect(judge.judge('case', {
      currentUserText: 'はい', lastAssistantMessage: null,
    }, 0)).resolves.toMatchObject({ status: 'unavailable', reason: 'configuration' });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('Gemini judge aggregation', () => {
  it('detects semantic instability while retaining a strict majority', () => {
    const records = [
      judged('case', 'create_plan'), judged('case', 'fallback'), judged('case', 'create_plan'),
    ];
    expect(aggregateGeminiJudgeRecords('create_plan', records)).toEqual({
      majorityClass: 'create_plan',
      unstable: true,
      incomplete: false,
      judgedRunCount: 3,
      failedRunCount: 0,
      anyReviewRequired: false,
      disagreesWithSyntheticLabel: false,
    });
  });

  it('keeps a tie undecided and treats ambiguity as requiring review', () => {
    expect(aggregateGeminiJudgeRecords('fallback', [
      judged('case', 'create_plan'), judged('case', 'ambiguous'),
    ])).toEqual({
      majorityClass: null,
      unstable: true,
      incomplete: false,
      judgedRunCount: 2,
      failedRunCount: 0,
      anyReviewRequired: true,
      disagreesWithSyntheticLabel: false,
    });
  });

  it('marks failed repetitions incomplete and never compares against a missing synthetic label', () => {
    expect(aggregateGeminiJudgeRecords(null, [
      judged('case', 'create_plan'), unavailable('case', 1), unavailable('case', 2),
    ])).toEqual({
      majorityClass: 'create_plan',
      unstable: true,
      incomplete: true,
      judgedRunCount: 1,
      failedRunCount: 2,
      anyReviewRequired: true,
      disagreesWithSyntheticLabel: false,
    });
  });
});

describe('generic review inputs and blind sheets', () => {
  const syntheticInputs = adaptSyntheticReviewCandidates(
    FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.slice(0, 4),
  );
  const expansion: FocusedAuthorizationReviewInput = {
    id: 'expansion-001',
    conversationGroupId: 'expansion-group-001',
    layer: 'phatic_politeness',
    split: 'holdout',
    lastAssistantMessage: '計画案を作りますか？',
    currentUserText: 'ありがとう',
    syntheticLabel: null,
    source: 'issue333_expansion_v1',
  };

  it('adapts PR #332 candidates and carries unlabeled expansion metadata', () => {
    expect(syntheticInputs[0]).toMatchObject({
      syntheticLabel: 'create_plan', source: 'pr332_synthetic_v1',
    });
    const combined = combineReviewInputs(syntheticInputs, [expansion]);
    const blind = buildBlindReviewPackage(combined);
    expect(blind.mapping.find((row) => row.id === expansion.id)).toMatchObject({
      syntheticLabel: null, source: 'issue333_expansion_v1', layer: 'phatic_politeness',
    });

    const expansionIndex = blind.mapping.findIndex((row) => row.id === expansion.id);
    const slotA = blind.rows.map((row, index) => index === expansionIndex ? {
      ...row,
      humanLabel: 'create_plan' as const,
      humanReviewer: 'reviewer-a',
      humanReviewedAt: '2026-09-26',
    } : row);
    const slotB = blind.rows.map((row, index) => index === expansionIndex ? {
      ...row,
      humanLabel: 'fallback' as const,
      humanReviewer: 'reviewer-b',
      humanReviewedAt: '2026-09-26',
    } : row);
    const review = extractDoubleBlindReview(slotA, slotB, blind.mapping);
    expect(review.needsAdjudication[0]).toMatchObject({
      syntheticLabel: null, source: 'issue333_expansion_v1',
    });
    const [adjudicationRow] = buildAdjudicationSheet(review, [
      aggregateGeminiJudgeCase(expansion.id, null, [judged(expansion.id, 'fallback')]),
    ]);
    expect(adjudicationRow).toMatchObject({
      syntheticLabel: null, source: 'issue333_expansion_v1',
    });
    expect(applyAdjudication(review, [{
      ...adjudicationRow,
      adjudicatedLabel: 'fallback',
      adjudicationReviewer: 'reviewer-c',
      adjudicatedAt: '2026-09-27',
      adjudicationNotes: '拡張候補を再確認した。',
    }]).goldCases[0]).toMatchObject({
      syntheticLabel: null, source: 'issue333_expansion_v1', humanLabel: 'fallback',
    });
  });

  it('rejects duplicate ids, cross-source group collisions, and split leakage', () => {
    expect(() => combineReviewInputs(syntheticInputs, [{ ...expansion, id: syntheticInputs[0].id }]))
      .toThrow(/Duplicate or empty review input id/);
    expect(() => combineReviewInputs(syntheticInputs, [{
      ...expansion,
      conversationGroupId: syntheticInputs[0].conversationGroupId,
    }])).toThrow(/duplicated across input lists/);
    expect(() => validateReviewInputs([
      expansion,
      { ...expansion, id: 'expansion-002', split: 'tuning' },
    ])).toThrow(/crosses evaluation splits/);
  });

  it('keeps both blind copies opaque, stable, and rubric-versioned', () => {
    const blind = buildBlindReviewPackage([...syntheticInputs, expansion]);
    const repeated = buildBlindReviewPackage([...syntheticInputs, expansion]);
    expect(blind).toEqual(repeated);
    expect(blind.rows.map((row) => row.opaqueReviewId)).toEqual([
      'review-001', 'review-002', 'review-003', 'review-004', 'review-005',
    ]);
    const slotAJson = serializeBlindReviewJson(blind.rows, 'A');
    const slotBJson = serializeBlindReviewJson(blind.rows, 'B');
    expect(slotAJson).toContain(`"rubricVersion": "${HUMAN_REVIEW_RUBRIC_VERSION}"`);
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toMatch(/save/);
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toContain('ありがとう');
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toMatch(/Reaffirming/);
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toMatch(/ambiguous/);
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toMatch(/exclude/);
    expect(HUMAN_REVIEW_RUBRIC_TEXT).toMatch(/stale or insufficient context/);
    expect(slotAJson).toContain('"reviewerSlot": "A"');
    expect(slotBJson).toContain('"reviewerSlot": "B"');
    expect(slotAJson).not.toMatch(/"(?:caseId|conversationGroupId|split|layer|syntheticLabel|geminiMajority|source)"\s*:/);
    expect(serializeBlindReviewMappingJson(blind.mapping)).toContain('"shuffleSeed"');
  });

  it('round-trips quoted and multiline blind data without exposing the mapping', () => {
    const inputs = adaptSyntheticReviewCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES);
    const blind = buildBlindReviewPackage(inputs);
    expect(parseBlindReviewCsv(serializeBlindReviewCsv(blind.rows))).toEqual(blind.rows);
  });
});

describe('independent double blind review and gold', () => {
  const inputs = adaptSyntheticReviewCandidates(
    FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.slice(0, 4),
  );

  it('requires two different reviewers and creates gold only on agreement', () => {
    const blind = buildBlindReviewPackage(inputs);
    const slotA = completedRows(blind.rows, ['create_plan'], 'reviewer-a');
    const slotB = completedRows(blind.rows, ['create_plan'], 'reviewer-b');
    const review = extractDoubleBlindReview(slotA, slotB, blind.mapping);
    expect(review.agreedGold).toHaveLength(1);
    expect(review.needsAdjudication).toHaveLength(0);
    expect(review.agreedGold[0]).toMatchObject({
      humanLabel: 'create_plan',
      rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
      labelStatus: 'human_reviewed_gold',
      firstPass: [
        { reviewerSlot: 'A', humanReviewer: 'reviewer-a' },
        { reviewerSlot: 'B', humanReviewer: 'reviewer-b' },
      ],
    });
    expect(review.summary).toMatchObject({
      agreedCount: 1, disagreedCount: 0, adjudicatedCount: 0, pendingCount: 3,
      rawInterReviewerAgreement: 1,
    });
    expect(() => extractDoubleBlindReview(
      slotA,
      completedRows(blind.rows, ['create_plan'], ' Reviewer-A '),
      blind.mapping,
    )).toThrow(/must be different/);
  });

  it('routes reviewer disagreement to adjudication and reports agreement statistics', () => {
    const blind = buildBlindReviewPackage(inputs);
    const slotA = completedRows(blind.rows, ['create_plan', 'create_plan'], 'reviewer-a');
    const slotB = completedRows(blind.rows, ['create_plan', 'fallback'], 'reviewer-b');
    const review = extractDoubleBlindReview(slotA, slotB, blind.mapping);
    expect(review.agreedGold).toHaveLength(1);
    expect(review.needsAdjudication).toHaveLength(1);
    expect(review.summary).toMatchObject({
      agreedCount: 1, disagreedCount: 1, adjudicatedCount: 0, pendingCount: 2,
      rawInterReviewerAgreement: 0.5,
      cohensKappa: 0,
    });
    expect(cohensKappa([
      { reviewerALabel: 'create_plan', reviewerBLabel: 'create_plan' },
      { reviewerALabel: 'create_plan', reviewerBLabel: 'fallback' },
      { reviewerALabel: 'fallback', reviewerBLabel: 'fallback' },
      { reviewerALabel: 'fallback', reviewerBLabel: 'create_plan' },
    ])).toBe(0);
  });

  it('rejects incomplete reviews, missing rows, and source-text tampering', () => {
    const blind = buildBlindReviewPackage(inputs);
    expect(() => extractDoubleBlindReview(
      [{ ...blind.rows[0], humanLabel: 'create_plan' }, ...blind.rows.slice(1)],
      blind.rows,
      blind.mapping,
    )).toThrow(/Incomplete human review/);
    expect(() => extractDoubleBlindReview(blind.rows.slice(1), blind.rows, blind.mapping))
      .toThrow(/missing rows/);
    expect(() => extractDoubleBlindReview(
      [{ ...blind.rows[0], currentUserText: 'tampered' }, ...blind.rows.slice(1)],
      blind.rows,
      blind.mapping,
    )).toThrow(/source text changed/);
  });

  it('shows Gemini only after both reviews lock, then requires explicit adjudication', () => {
    const blind = buildBlindReviewPackage([inputs[0]]);
    const aggregate = aggregateGeminiJudgeCase(inputs[0].id, inputs[0].syntheticLabel, [
      judged(inputs[0].id, 'fallback'),
    ]);
    const pending = extractDoubleBlindReview(blind.rows, blind.rows, blind.mapping);
    expect(buildAdjudicationSheet(pending, [aggregate])).toEqual([]);

    const review = extractDoubleBlindReview(
      completedRows(blind.rows, ['create_plan'], 'reviewer-a'),
      completedRows(blind.rows, ['fallback'], 'reviewer-b'),
      blind.mapping,
    );
    const [row] = buildAdjudicationSheet(review, [aggregate]);
    expect(row).toMatchObject({
      geminiMajority: 'fallback', firstPassLabelA: 'create_plan',
      firstPassLabelB: 'fallback', labelStatus: 'needs_adjudication',
    });
    expect(parseAdjudicationCsv(serializeAdjudicationCsv([row]))).toEqual([row]);
    expect(() => applyAdjudication(review, [{ ...row, adjudicatedLabel: 'fallback' }]))
      .toThrow(/Incomplete adjudication/);
    const resolved = applyAdjudication(review, [{
      ...row,
      adjudicatedLabel: 'fallback',
      adjudicationReviewer: 'reviewer-a',
      adjudicatedAt: '2026-09-27T09:00:00+09:00',
      adjudicationNotes: '両方の読みを比較し、独立した意味を優先した。',
    }]);
    expect(resolved.goldCases[0]).toMatchObject({
      humanLabel: 'fallback',
      firstPass: [
        { humanLabel: 'create_plan', humanReviewer: 'reviewer-a' },
        { humanLabel: 'fallback', humanReviewer: 'reviewer-b' },
      ],
      adjudication: { humanLabel: 'fallback', humanReviewer: 'reviewer-a' },
    });
    expect(resolved.summary).toMatchObject({
      agreedCount: 0, disagreedCount: 0, adjudicatedCount: 1, pendingCount: 0,
    });
  });

  it('turns only binary human gold into comparison labels and reports omissions', () => {
    const blind = buildBlindReviewPackage(inputs);
    const labels = ['create_plan', 'fallback', 'ambiguous', 'exclude'] as const;
    const review = extractDoubleBlindReview(
      completedRows(blind.rows, labels, 'reviewer-a'),
      completedRows(blind.rows, labels, 'reviewer-b'),
      blind.mapping,
    );
    const result = toComparisonGoldLabels(review.agreedGold);
    expect(Object.values(result.labels)).toEqual(expect.arrayContaining([
      { expected: 'create_plan', labelStatus: 'human_reviewed_gold' },
      { expected: 'fallback', labelStatus: 'human_reviewed_gold' },
    ]));
    expect(result.ambiguous).toMatchObject({ count: 1 });
    expect(result.excluded).toMatchObject({ count: 1 });
    expect(result.ambiguous.caseIds).toHaveLength(1);
    expect(result.excluded.caseIds).toHaveLength(1);
  });
});
