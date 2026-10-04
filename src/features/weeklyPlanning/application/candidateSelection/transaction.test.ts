import { describe, expect, it } from 'vitest';
import {
  createCandidateManifest, createSelectionLedger, selectApplicationCandidate,
  prepareCandidateSelectionCommit, commitStagedCandidateSelection, projectCandidateProviderContext,
  type AtomicSelectionCommitPort, type AtomicSelectionView, type CandidateChoiceRequest,
  type CandidateObservation, type SelectionCommitDecision, type SelectionLedger, type StagedCandidateSelection,
} from './index';
import { basis, observation, fixturePolicy, responseFor } from './fixtures.testUtils';

const wholeUtterance = '  2つ目で。ただし別の意味も消さないで。\n原文全文  ';

async function setup(count = 3, width = 2) {
  const live = basis(count);
  const manifest = await createCandidateManifest(live);
  const policy = fixturePolicy(manifest, width);
  let overrides: Partial<CandidateObservation> = {};
  const requests: CandidateChoiceRequest[] = [];
  const readCurrent = (): CandidateObservation => ({ ...observation(manifest), binding: live.binding, candidates: live.candidates, ...overrides });
  const run = (choose: (request: CandidateChoiceRequest, beforeDispatch: () => void) => Promise<unknown> = async (request, dispatch) => {
    dispatch(); return responseFor(request);
  }, options: Partial<Parameters<typeof selectApplicationCandidate>[0]> = {}) => selectApplicationCandidate({
    manifest, wholeUtterance, policy, maximumChildrenPerMenu: width, maximumDecisions: 10, readCurrent,
    choose: async (request, dispatch) => { requests.push(request); return choose(request, dispatch); }, ...options,
  });
  return { manifest, policy, live, requests, readCurrent, run, override: (value: Partial<CandidateObservation>) => { overrides = value; } };
}

async function staged(harness: Awaited<ReturnType<typeof setup>>, index = 0): Promise<StagedCandidateSelection> {
  const result = await harness.run(async (request, dispatch) => { dispatch(); return responseFor(request, request.menu.options[index].id); });
  expect(result.status).toBe('staged');
  if (result.status !== 'staged') throw new Error(`Expected staged, got ${result.reason}`);
  return result.selection;
}

/** Executable reference contract, NOT StudyPlanner integration or a cross-device storage transaction. */
class ReferenceAtomicPort implements AtomicSelectionCommitPort {
  state: { applied: string[]; ledger: SelectionLedger };
  events: string[] = [];
  failure: 'before_callback' | 'callback' | 'validation' | 'before_write' | 'after_commit' | undefined;
  constructor(private readCurrent: () => CandidateObservation) {
    const current = readCurrent();
    this.state = { applied: [], ledger: createSelectionLedger(current.binding.ownerId, current.binding.conversationId) };
  }
  async commitAtomically(_selection: StagedCandidateSelection, decide: (view: AtomicSelectionView) => SelectionCommitDecision) {
    if (this.failure === 'before_callback') throw new Error('before transaction');
    // The read and synchronous callback execute at transaction entry, never before an await.
    this.events.push('read');
    const current = this.readCurrent();
    const view: AtomicSelectionView = {
      observation: current, ledger: this.state.ledger,
      validateLeaf: (candidate) => {
        this.events.push('validate');
        if (this.failure === 'validation') throw new Error('validator failed');
        return current.candidates.some((entry) => entry.id === candidate.id && entry.tuple.minutes === candidate.tuple.minutes);
      },
    };
    if (this.failure === 'callback') throw new Error('callback boundary failed');
    const decision = decide(view);
    if (decision.status === 'rejected') return decision;
    const next = { applied: [...this.state.applied, decision.candidate.id], ledger: decision.nextLedger };
    if (this.failure === 'before_write') throw new Error('write aborted before swap');
    this.events.push('write');
    this.state = next; // Complete leaf effect AND ledger in one swap; neither can advance separately.
    if (this.failure === 'after_commit') throw new Error('ack lost AFTER commit');
    return { status: 'committed' as const };
  }
}

describe('staged application candidate transaction', () => {
  it('never applies a parent route or consumes a selection while staging', async () => {
    const h = await setup(17, 2);
    const port = new ReferenceAtomicPort(h.readCurrent);
    const original = port.state;
    const selection = await staged(h);
    expect(h.requests.length).toBeGreaterThan(1);
    expect(port.state).toBe(original);
    expect(port.state.applied).toEqual([]);
    expect(port.state.ledger.consumed).toEqual([]);
    expect(selection.candidate).toBe(h.manifest.candidates[0]);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(new Set(h.requests.map((r) => r.menu.nodeId)).size).toBe(h.requests.length);
  });

  it('carries frozen minimal question/target/scope context through serialized requests, symmetrically', async () => {
    const h = await setup(5, 2);
    await staged(h);
    const projection = projectCandidateProviderContext(h.manifest);
    for (const request of h.requests) {
      const wire = JSON.parse(JSON.stringify(request));
      expect(wire.context).toEqual(projection);
      expect(wire.context.question).toEqual({ id: 'question-a', code: 'ambiguous_effort_estimate' });
      expect(wire.context.target).toEqual({ kind: 'workload', id: 'workload-a' });
      expect(Object.keys(wire.context).sort()).toEqual(['question', 'scope', 'target']);
      expect(wire.context).not.toHaveProperty('ownerId');
      expect(wire.context).not.toHaveProperty('sources');
      expect(Object.isFrozen(request.context.scope)).toBe(true);
      expect(request.wholeUtterance).toBe(wholeUtterance);
    }
    const flatRequests: CandidateChoiceRequest[] = [];
    const flat = await h.run(async (request, dispatch) => { dispatch(); flatRequests.push(request); return responseFor(request); }, {
      maximumChildrenPerMenu: 5, policy: fixturePolicy(h.manifest, 5),
    });
    expect(flat.status).toBe('staged');
    expect(flatRequests[0].context).toEqual(projection);
    expect(h.requests[0].context).toBe(h.requests[1].context);
    const other = basis(5); other.binding.question.code = 'missing_effort_estimate';
    expect(projectCandidateProviderContext(await createCandidateManifest(other)).question.code).not.toBe(projection.question.code);
  });

  it.each([
    [{ sourceAccess: 'denied' }, 'source_access'],
    [{ sourceAccess: 'unknown' }, 'source_access'],
    [{ intentProvenance: 'unproven' }, 'current_intent'],
    [{ targetStatus: 'inactive' }, 'target_inactive'],
    [{ questionPresentation: 'stale' }, 'question_not_fresh'],
    [{ questionPresentation: 'unknown' }, 'question_not_fresh'],
    [{ formalEligibility: 'ineligible' }, 'formal_gate'],
  ] as const)('blocks initial exposure for %j regardless of confidence', async (overrides, reason) => {
    const h = await setup(); h.override(overrides);
    expect(await h.run()).toEqual({ status: 'fallback', reason, wholeUtterance });
    expect(h.requests).toHaveLength(0);
  });

  it('revalidates at actual dispatch AFTER async adapter authentication', async () => {
    const h = await setup(); let disclosures = 0;
    const result = await h.run(async (request, beforeDispatch) => {
      await Promise.resolve(); // Adapter auth/hash/preparation gap.
      h.override({ sourceAccess: 'denied' });
      beforeDispatch();
      disclosures += 1;
      return responseFor(request);
    });
    expect(result).toEqual({ status: 'fallback', reason: 'source_access', wholeUtterance });
    expect(disclosures).toBe(0);
  });

  it('requires the dispatch guard and prevents another dispatch under the same decision budget', async () => {
    const h = await setup();
    expect(await h.run(async (request) => responseFor(request))).toMatchObject({ status: 'fallback', reason: 'invalid_response' });
    expect(await h.run(async (request, dispatch) => { dispatch(); dispatch(); return responseFor(request); })).toMatchObject({ status: 'fallback', reason: 'budget_exhausted' });
  });

  it('checks again after a route, before the next route, and after the final response', async () => {
    const afterParent = await setup();
    expect(await afterParent.run(async (request, dispatch) => { dispatch(); afterParent.override({ sourceAccess: 'denied' }); return responseFor(request); })).toMatchObject({ reason: 'source_access' });
    expect(afterParent.requests).toHaveLength(1);
    const between = await setup(); let reads = 0;
    expect(await between.run(undefined, { readCurrent: () => {
      reads += 1;
      return { ...between.readCurrent(), sourceAccess: reads >= 4 ? 'denied' : 'allowed' };
    } })).toMatchObject({ reason: 'source_access' });
    expect(between.requests).toHaveLength(1);
    const final = await setup(1);
    expect(await final.run(async (request, dispatch) => { dispatch(); final.override({ sourceAccess: 'denied' }); return responseFor(request); })).toMatchObject({ reason: 'source_access' });
  });

  it('re-derives live candidate basis instead of trusting the captured hash', async () => {
    const h = await setup(1);
    expect(await h.run(async (request, dispatch) => {
      dispatch(); h.live.candidates[0].tuple.minutes += 1; return responseFor(request);
    })).toEqual({ status: 'fallback', reason: 'stale', wholeUtterance });
  });

  const invalidResponses: [string, (response: ReturnType<typeof responseFor>) => unknown][] = [
    ['unknown option', (r) => ({ ...r, optionId: 'new-candidate-from-model' })],
    ['replayed parent route', (r) => ({ ...r, nodeId: 'group:0:999' })],
    ['different request', (r) => ({ ...r, requestId: 'other-request' })],
    ['different epoch', (r) => ({ ...r, selectionEpoch: r.selectionEpoch + 1 })],
    ['different hash', (r) => ({ ...r, candidateSetHash: 'same-label-different-basis' })],
    ['missing option probability', (r) => ({ ...r, probabilities: r.probabilities.slice(1) })],
    ['duplicate probability', (r) => ({ ...r, probabilities: r.probabilities.map(() => r.probabilities[0]) })],
    ['NaN', (r) => ({ ...r, probabilities: r.probabilities.map((v) => ({ ...v, probability: NaN })) })],
    ['negative', (r) => ({ ...r, probabilities: r.probabilities.map((v) => ({ ...v, probability: -0.1 })) })],
    ['over one', (r) => ({ ...r, probabilities: r.probabilities.map((v) => ({ ...v, probability: 1.1 })) })],
    ['unnormalized', (r) => ({ ...r, probabilities: r.probabilities.map((v) => ({ ...v, probability: 0.1 })) })],
    ['selected value is not top', (r) => ({ ...r, optionId: 'none' })],
    ['extra output meaning', (r) => ({ ...r, addition: { arbitraryMutation: true } })],
    ['accessor', (r) => Object.defineProperty({ ...r }, 'optionId', { enumerable: true, get: () => 'leaf:0' })],
  ];
  it.each(invalidResponses)('rejects %s with the entire unchanged utterance', async (_name, invalid) => {
    const h = await setup(1);
    expect(await h.run(async (request, dispatch) => { dispatch(); return invalid(responseFor(request)); })).toEqual({ status: 'fallback', reason: 'invalid_response', wholeUtterance });
  });

  it('does not silently reuse a previous group response for a later menu', async () => {
    const h = await setup(8); let old: ReturnType<typeof responseFor>;
    const result = await h.run(async (request, dispatch) => { dispatch(); old ??= responseFor(request); return old; });
    expect(result).toMatchObject({ status: 'fallback', reason: 'invalid_response', wholeUtterance });
    expect(h.requests).toHaveLength(2);
  });

  it('abstains for none, semantic extra meaning, low probability, ties and provider errors', async () => {
    const h = await setup(1);
    expect(await h.run(async (r, d) => { d(); return responseFor(r, 'none'); })).toMatchObject({ reason: 'none', wholeUtterance });
    expect(await h.run(async (r, d) => { d(); return { ...responseFor(r), semanticSufficiency: 'extra_meaning' }; })).toMatchObject({ reason: 'extra_meaning' });
    expect(await h.run(async (r, d) => { d(); return { ...responseFor(r), semanticSufficiency: 'unknown' }; })).toMatchObject({ reason: 'extra_meaning' });
    expect(await h.run(undefined, { policy: { ...h.policy, rules: h.policy.rules.map((v) => ({ ...v, minimumTopProbability: 0.99 })) } })).toMatchObject({ reason: 'low_probability' });
    expect(await h.run(async (r, d) => { d(); return { ...responseFor(r), probabilities: r.menu.options.map((v) => ({ optionId: v.id, probability: 0.5 })) }; })).toMatchObject({ reason: 'invalid_response' });
    expect(await h.run(async (_r, d) => { d(); throw new Error('provider down'); })).toMatchObject({ reason: 'provider_error', wholeUtterance });
  });

  it('requires a calibrated policy for the exact depth/kind/cardinality and stops at the budget', async () => {
    const h = await setup(17);
    expect(await h.run(undefined, { maximumDecisions: 1 })).toMatchObject({ reason: 'budget_exhausted' });
    expect(await h.run(undefined, { policy: { ...h.policy, calibrationEvidenceId: '' } })).toMatchObject({ reason: 'invalid_policy' });
    expect(await h.run(undefined, { policy: { ...h.policy, rules: h.policy.rules.filter((v) => v.depth !== 0) } })).toMatchObject({ reason: 'uncalibrated_menu' });
    const single = await setup(1);
    await staged(single);
    expect(single.requests).toHaveLength(1); // No synthetic p=1 shortcut.
  });

  it('gates margin independently of top probability and rejects malformed calibration policies', async () => {
    const h = await setup(1);
    expect(await h.run(async (r, d) => {
      d(); return { ...responseFor(r), probabilities: [{ optionId: 'leaf:0', probability: 0.7 }, { optionId: 'none', probability: 0.3 }] };
    }, { policy: { ...h.policy, rules: h.policy.rules.map((rule) => ({ ...rule, minimumMargin: 0.5 })) } })).toMatchObject({ reason: 'low_probability' });
    for (const minimum of [NaN, -0.1, 1.1]) {
      expect(await h.run(undefined, { policy: { ...h.policy, rules: h.policy.rules.map((rule) => ({ ...rule, minimumTopProbability: minimum })) } })).toMatchObject({ reason: 'invalid_policy' });
    }
    expect(await h.run(undefined, { policy: { ...h.policy, rules: [...h.policy.rules, ...h.policy.rules] } })).toMatchObject({ reason: 'invalid_policy' });
  });

  it('captures original utterance/manifest/configuration before await and cannot be redirected by mutable params', async () => {
    const h = await setup(1);
    const params = {
      manifest: h.manifest, wholeUtterance,
      policy: { ...h.policy, rules: h.policy.rules.map((rule) => ({ ...rule })) }, maximumChildrenPerMenu: 2,
      maximumDecisions: 1, readCurrent: h.readCurrent,
      choose: async (request: CandidateChoiceRequest, dispatch: () => void) => {
        dispatch(); await Promise.resolve();
        params.wholeUtterance = 'trimmed or different text';
        params.maximumDecisions = 999;
        params.policy.rules[0] = { ...params.policy.rules[0], minimumTopProbability: 0 };
        return responseFor(request, 'none');
      },
    };
    expect(await selectApplicationCandidate(params)).toEqual({ status: 'fallback', reason: 'none', wholeUtterance });
  });
});

describe('consumer-owned atomic commit reference contract', () => {
  it('checks live freshness and formal validation at commit; a staged leaf grants no authority', async () => {
    const h = await setup(); const selection = await staged(h); const port = new ReferenceAtomicPort(h.readCurrent);
    h.override({ sourceAccess: 'denied' });
    expect(await commitStagedCandidateSelection(selection, port)).toEqual({ status: 'rejected', reason: 'source_access' });
    expect(port.state.applied).toEqual([]); expect(port.state.ledger.consumed).toEqual([]);
    h.override({ formalEligibility: 'ineligible' });
    expect(await commitStagedCandidateSelection(selection, port)).toMatchObject({ reason: 'formal_gate' });
    h.override({ intentProvenance: 'unproven' });
    expect(await commitStagedCandidateSelection(selection, port)).toMatchObject({ reason: 'current_intent' });
    h.override({ questionPresentation: 'stale' });
    expect(await commitStagedCandidateSelection(selection, port)).toMatchObject({ reason: 'question_not_fresh' });
    h.override({}); h.live.binding.graphRevision += 1;
    expect(await commitStagedCandidateSelection(selection, port)).toMatchObject({ reason: 'stale' });
    expect(port.events).not.toContain('write');
  });

  it('reads at transaction entry even when acquisition awaits and access changes meanwhile', async () => {
    const h = await setup(); const selection = await staged(h); const port = new ReferenceAtomicPort(h.readCurrent);
    const delayed: AtomicSelectionCommitPort = { commitAtomically: async (candidate, decide) => {
      await Promise.resolve(); h.override({ sourceAccess: 'denied' });
      return port.commitAtomically(candidate, decide);
    } };
    expect(await commitStagedCandidateSelection(selection, delayed)).toMatchObject({ reason: 'source_access' });
    expect(port.state.applied).toEqual([]); expect(port.state.ledger.consumed).toEqual([]);
  });

  it('validates/apply/consumes once under replay and concurrent competing selections', async () => {
    const h = await setup(2, 2); const first = await staged(h, 0); const second = await staged(h, 1);
    const port = new ReferenceAtomicPort(h.readCurrent);
    const outcomes = await Promise.all([commitStagedCandidateSelection(first, port), commitStagedCandidateSelection(second, port)]);
    expect(outcomes).toEqual([{ status: 'committed' }, { status: 'rejected', reason: 'already_consumed' }]);
    expect(port.state.applied).toEqual([first.candidate.id]); expect(port.state.ledger.consumed).toHaveLength(1);
    expect(port.events.slice(0, 3)).toEqual(['read', 'validate', 'write']);
    expect(await commitStagedCandidateSelection(first, port)).toMatchObject({ reason: 'already_consumed' });
    // JSON roundtrip models the consumer obligation; not real persistence integration evidence.
    port.state = { ...port.state, ledger: JSON.parse(JSON.stringify(port.state.ledger)) };
    expect(await commitStagedCandidateSelection(first, port)).toMatchObject({ reason: 'already_consumed' });
    expect(port.state.applied).toHaveLength(1);
  });

  it('deduplicates both epoch across requests and request across epochs', async () => {
    const h = await setup(1); const first = await staged(h); const port = new ReferenceAtomicPort(h.readCurrent);
    expect(await commitStagedCandidateSelection(first, port)).toMatchObject({ status: 'committed' });
    h.live.binding.requestId = 'request-b';
    let fresh = await createCandidateManifest(h.live);
    let result = await h.run(undefined, { manifest: fresh, policy: fixturePolicy(fresh, 2) });
    if (result.status !== 'staged') throw new Error('fixture');
    expect(await commitStagedCandidateSelection(result.selection, port)).toMatchObject({ reason: 'already_consumed' });
    h.live.binding.requestId = 'request-a'; h.live.binding.selectionEpoch += 1; h.live.binding.question.id = 'question-b';
    fresh = await createCandidateManifest(h.live);
    result = await h.run(undefined, { manifest: fresh, policy: fixturePolicy(fresh, 2) });
    if (result.status !== 'staged') throw new Error('fixture');
    expect(await commitStagedCandidateSelection(result.selection, port)).toMatchObject({ reason: 'already_consumed' });
    expect(port.state.applied).toHaveLength(1); expect(port.state.ledger.consumed).toHaveLength(1);
  });

  it.each(['before_callback', 'callback', 'validation', 'before_write'] as const)('does not partially advance state/ledger on %s failure', async (phase) => {
    const h = await setup(); const selection = await staged(h); const port = new ReferenceAtomicPort(h.readCurrent);
    const before = port.state; port.failure = phase;
    const outcome = await commitStagedCandidateSelection(selection, port);
    expect(outcome).toEqual(phase === 'validation' ? { status: 'rejected', reason: 'invalid_leaf' } : { status: 'unknown' });
    expect(port.state).toBe(before); expect(port.state.applied).toHaveLength(0); expect(port.state.ledger.consumed).toHaveLength(0);
  });

  it('reports unknown after commit-then-throw; durable replay cannot mutate a second time', async () => {
    const h = await setup(); const selection = await staged(h); const port = new ReferenceAtomicPort(h.readCurrent);
    port.failure = 'after_commit';
    expect(await commitStagedCandidateSelection(selection, port)).toEqual({ status: 'unknown' });
    expect(port.state.applied).toEqual([selection.candidate.id]); expect(port.state.ledger.consumed).toHaveLength(1);
    port.failure = undefined;
    expect(await commitStagedCandidateSelection(selection, port)).toEqual({ status: 'rejected', reason: 'already_consumed' });
    expect(port.state.applied).toHaveLength(1); expect(port.state.ledger.consumed).toHaveLength(1);
  });

  it('rejects forged selections, foreign ledgers, invalid leaf validation and malformed state', async () => {
    const h = await setup(); const selection = await staged(h); const ledger = createSelectionLedger('owner-a', 'conversation-a');
    const view: AtomicSelectionView = { observation: h.readCurrent(), ledger, validateLeaf: () => true };
    expect(prepareCandidateSelectionCommit({ ...selection }, view)).toMatchObject({ reason: 'invalid_selection' });
    expect(prepareCandidateSelectionCommit(selection, { ...view, ledger: createSelectionLedger('owner-b', 'conversation-a') })).toMatchObject({ reason: 'ledger_scope' });
    expect(prepareCandidateSelectionCommit(selection, { ...view, validateLeaf: () => false })).toMatchObject({ reason: 'invalid_leaf' });
    expect(prepareCandidateSelectionCommit(selection, { ...view, ledger: { ...ledger, consumed: [{}] } as unknown as SelectionLedger })).toMatchObject({ reason: 'ledger_scope' });
    expect(ledger.consumed).toEqual([]);
  });
});
