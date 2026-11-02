import { describe, expect, it, vi } from 'vitest';
import { VNEXT_JEV_COMPARISON_DEV_CASES, VNEXT_JEV_COMPARISON_DEV_CASES_SHA256,
  VNEXT_JEV_COMPARISON_SPLIT_SHA256 } from '../src/features/weeklyPlanning/evals/vnextJevComparisonCases';
import { CANDIDATE_CHOICE_CATALOG_VERSION, isCandidateChoiceDecisionContext, type CandidateChoiceWireRequest, type CandidateChoiceResult } from '../shared/candidateChoiceDecision';
import { collectVNextJevDevRaw, devCasesHash, prepareVNextJevDevCase, type VNextJevDevRawArtifact } from './vnext-jev-remote-dev';
import type { ProviderUsage } from './vnext-jev-remote';

function remote(unavailable = false) {
  const empty = (): ProviderUsage => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
    latencyMs: 0, servedModels: [], httpStatuses: [], lastCall: null });
  const totals = { luna: empty(), jev: empty() };
  return { usage: () => structuredClone(totals), evaluateJev: vi.fn(async (r: CandidateChoiceWireRequest): Promise<CandidateChoiceResult> => {
    totals.jev.calls++;
    totals.jev.lastCall = { inputTokens: 20, outputTokens: 5, costUsd: 0.001, latencyMs: 10,
      servedModel: 'typesafe/jev-1.14', httpStatus: 200 };
    if (unavailable) return { status: 'unavailable' as const, reason: 'timeout' };
    return { status: 'evaluated' as const, catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
      requestId: r.requestId, selectionEpoch: r.selectionEpoch, candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId,
      optionId: r.menu.options[0].id, probabilities: r.menu.options.map((o, i) => ({ optionId: o.id,
        probability: i === 0 ? 0.98 : 0.02 / (r.menu.options.length - 1) })), conditionChange: 0.01, independentMeaning: 0.02 };
  }) };
}
const input = () => ({ cases: [VNEXT_JEV_COMPARISON_DEV_CASES[0]],
  splitHash: VNEXT_JEV_COMPARISON_SPLIT_SHA256, expectedDevHash: devCasesHash([VNEXT_JEV_COMPARISON_DEV_CASES[0]]),
  codeHead: '9873f0428497bbe38f7afe29f1bb1f94e20770c7', remote: remote(), persist: async (_artifact: VNextJevDevRawArtifact) => {} });

describe('DEV-only raw Jev collection (offline)', () => {
  it('uses the frozen dev-only text hash and prepares all 16 actual menus without provider calls', async () => {
    expect(VNEXT_JEV_COMPARISON_DEV_CASES.length).toBe(16);
    expect(devCasesHash(VNEXT_JEV_COMPARISON_DEV_CASES)).toBe(VNEXT_JEV_COMPARISON_DEV_CASES_SHA256);
    expect(VNEXT_JEV_COMPARISON_DEV_CASES_SHA256).toBe('b5e1cf376fcdd8a0d53e54316a64a80e886cb9c9c6ff49cf2f1ccc5559dfad14');
    for (const item of VNEXT_JEV_COMPARISON_DEV_CASES) {
      const prepared = await prepareVNextJevDevCase(item);
      expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: prepared.request }), item.id).toBe(true);
      expect(prepared.choices[prepared.expectedWireOptionId], item.id).toBe(prepared.expectedChoice);
    }
  });

  it('rejects non-dev inputs and a changed freeze before any provider exposure', async () => {
    const options = input();
    await expect(collectVNextJevDevRaw({ ...options, cases: [{ ...options.cases[0], split: 'holdout' }] })).rejects.toThrow('Only development');
    await expect(collectVNextJevDevRaw({ ...options, expectedDevHash: '0'.repeat(64) })).rejects.toThrow('freeze mismatch');
    expect(options.remote.evaluateJev).not.toHaveBeenCalled();
  });

  it('collects exactly three raw evaluations per case, checkpointing usage and scores without utterance echoes', async () => {
    const options = input();
    const persisted: VNextJevDevRawArtifact[] = [];
    options.persist = async artifact => { persisted.push(artifact); };
    const artifact = await collectVNextJevDevRaw(options);
    expect(options.remote.evaluateJev).toHaveBeenCalledTimes(3);
    expect(artifact.completed).toBe(true);
    expect(artifact.calls.map(call => call.repetition)).toEqual([1, 2, 3]);
    expect(artifact.calls[0]).toMatchObject({ caseId: options.cases[0].id, status: 'evaluated', conditionChange: 0.01,
      independentMeaning: 0.02, usage: { inputTokens: 20, outputTokens: 5, costUsd: 0.001, latencyMs: 10 } });
    expect(artifact.calls[0].probabilities?.length).toBe(artifact.calls[0].menu.optionCount);
    expect(persisted.map(value => value.calls.length)).toEqual([0, 1, 2, 3, 3]);
    expect(JSON.stringify(artifact)).not.toContain(options.cases[0].userText);
    expect(JSON.stringify(artifact)).not.toContain('"presentedQuestion"');
    expect(JSON.stringify(artifact)).not.toContain('"userText"');
  });

  it('retains unavailable observations without adding retries or manufacturing probabilities', async () => {
    const options = { ...input(), remote: remote(true) };
    const artifact = await collectVNextJevDevRaw(options);
    expect(options.remote.evaluateJev).toHaveBeenCalledTimes(3);
    expect(artifact.calls).toHaveLength(3);
    expect(artifact.calls.every(call => call.status === 'unavailable' && call.reason === 'timeout'
      && call.probabilities === null && call.optionId === null)).toBe(true);
  });
});
