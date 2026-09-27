import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isProposalResponseDecisionContext,
  parseProposalResponseDecisionContent,
  type ProposalResponseDecision,
  type ProposalResponseDecisionContext,
} from '../../../../shared/proposalResponseDecision';
import type { DecisionEvaluation, DecisionMetadata, DecisionProvider } from './decisionProvider';
import {
  dispatchProposalResponse,
  proposalResponseBaselineFromDocument,
  resolveProposalResponseBaselineFailure,
} from './proposalResponseDispatch';
import {
  gateProposalResponseDecision,
  proposalResponseCanarySelected,
  proposalResponseDecisionMode,
} from './proposalResponseDecisionPolicy';

const metadata: DecisionMetadata = {
  provider: 'typesafe',
  requestedModel: 'injected-proposal-model',
  servedModel: 'injected-proposal-model',
  latencyMs: 3,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  requestBytes: 20,
  responseBytes: 40,
};

function context(currentUserText = '今回はやめておきます'): ProposalResponseDecisionContext {
  return {
    purpose: 'proposal_response',
    requestId: 'request-proposal-dispatch',
    inputRevision: 8,
    state: {
      currentUserText,
      presentedAssistantText: '英単語は1回15〜30分に分けて復習する分散学習を提案します。採用しますか？',
      proposal: {
        kind: 'spaced_memory_practice',
        taskTitle: '英単語',
        sessionMinutes: { min: 15, max: 30 },
      },
    },
  };
}

function evaluated(
  decision: ProposalResponseDecision,
  options: Partial<{
    confidence: number;
    selectedProbability: number;
    conditionChange: number;
    independentMeaning: number;
  }> = {},
): DecisionEvaluation<ProposalResponseDecision> {
  const selected = options.selectedProbability ?? 0.995;
  return {
    status: 'evaluated',
    decision,
    confidence: options.confidence ?? 0.999,
    probabilities: {
      reject_only: decision === 'reject_only' ? selected : 1 - selected,
      other: decision === 'other' ? selected : 1 - selected,
    },
    conditionChange: options.conditionChange ?? 0.001,
    independentMeaning: options.independentMeaning ?? 0.001,
    metadata,
  };
}

function provider(
  result: DecisionEvaluation<ProposalResponseDecision>,
): DecisionProvider<ProposalResponseDecisionContext['state'], ProposalResponseDecision> {
  return { evaluate: vi.fn(async () => result) };
}

const LUNA_DOCUMENT = JSON.stringify({ schemaVersion: 'generic-luna-document' });
const lunaResponse = () => Response.json({ content: LUNA_DOCUMENT });
const canaryEnv = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' } as const;
const respond = (content: unknown) => Response.json({ content: JSON.stringify(content) });

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proposal-response context contract', () => {
  it('accepts only the exact bounded projection', () => {
    expect(isProposalResponseDecisionContext(context())).toBe(true);
    expect(isProposalResponseDecisionContext({ ...context(), extra: true })).toBe(false);
    expect(isProposalResponseDecisionContext({
      ...context(),
      state: { ...context().state, proposal: { ...context().state.proposal, kind: 'calibrate_memory_pace' } },
    })).toBe(false);
    expect(isProposalResponseDecisionContext({
      ...context(),
      state: { ...context().state, proposal: { ...context().state.proposal, publicId: 'wpp_x' } },
    })).toBe(false);
    expect(isProposalResponseDecisionContext({
      ...context(),
      state: {
        ...context().state,
        proposal: { ...context().state.proposal, sessionMinutes: { min: 30, max: 15 } },
      },
    })).toBe(false);
    expect(isProposalResponseDecisionContext(context('あ'.repeat(201)))).toBe(false);
    expect(isProposalResponseDecisionContext({ ...context(), inputRevision: -1 })).toBe(false);
  });

  it('parses only a correlated reject_only content', () => {
    const expected = { requestId: 'r', inputRevision: 8 };
    const content = (value: unknown) => JSON.stringify(value);
    expect(parseProposalResponseDecisionContent(
      content({ proposalResponse: { decision: 'reject_only', requestId: 'r', inputRevision: 8 } }),
      expected,
    )).not.toBeNull();
    for (const invalid of [
      content({ proposalResponse: { decision: 'reject_only', requestId: 'other', inputRevision: 8 } }),
      content({ proposalResponse: { decision: 'reject_only', requestId: 'r', inputRevision: 9 } }),
      content({ proposalResponse: { decision: 'other', requestId: 'r', inputRevision: 8 } }),
      content({ proposalResponse: { decision: 'accept', requestId: 'r', inputRevision: 8 } }),
      content({ proposalResponse: { decision: 'reject_only', requestId: 'r', inputRevision: 8, id: 'x' } }),
      content({ proposalResponse: { decision: 'reject_only', requestId: 'r', inputRevision: 8 }, tasks: [] }),
      LUNA_DOCUMENT,
      'not json',
    ]) {
      expect(parseProposalResponseDecisionContent(invalid, expected)).toBeNull();
    }
  });
});

describe('proposal-response gate', () => {
  it('accepts only a confident, unconflicted reject_only', () => {
    expect(gateProposalResponseDecision(evaluated('reject_only')))
      .toEqual({ status: 'accepted', decision: 'reject_only' });
    expect(gateProposalResponseDecision(evaluated('other')))
      .toEqual({ status: 'abstained', reason: 'other_choice' });
    expect(gateProposalResponseDecision(evaluated('reject_only', { confidence: 0.5 })))
      .toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateProposalResponseDecision(evaluated('reject_only', { selectedProbability: 0.6 })))
      .toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateProposalResponseDecision(evaluated('reject_only', { conditionChange: 0.5 })))
      .toEqual({ status: 'abstained', reason: 'conflicting_heads' });
    expect(gateProposalResponseDecision(evaluated('reject_only', { independentMeaning: 0.5 })))
      .toEqual({ status: 'abstained', reason: 'conflicting_heads' });
    expect(gateProposalResponseDecision({ status: 'unavailable', reason: 'timeout', metadata }))
      .toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('keeps off as the default and only allows the fixed canary steps', () => {
    expect(proposalResponseDecisionMode({})).toBe('off');
    expect(proposalResponseDecisionMode({ JEV_MODE: 'on' })).toBe('off');
    expect(proposalResponseCanarySelected({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '0' }, 0)).toBe(false);
    expect(proposalResponseCanarySelected({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '50' }, 0)).toBe(false);
    expect(proposalResponseCanarySelected({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '5' }, 0.01)).toBe(true);
    expect(proposalResponseCanarySelected({ JEV_MODE: 'shadow', JEV_CANARY_PERCENT: '100' }, 0)).toBe(false);
  });
});

describe('proposal-response shadow baseline', () => {
  const pure = {
    schemaVersion: 'x',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [{ localId: 'd', target: { kind: 'proposal', publicId: 'p' }, decision: 'reject' }],
  };

  it('classifies only a lone proposal rejection as reject_only', () => {
    expect(proposalResponseBaselineFromDocument(JSON.stringify(pure))).toBe('reject_only');
    expect(proposalResponseBaselineFromDocument(JSON.stringify({
      ...pure,
      decisions: [{ ...pure.decisions[0], decision: 'accept' }],
    }))).toBe('other');
    expect(proposalResponseBaselineFromDocument(JSON.stringify({
      ...pure,
      tasks: [{ localId: 't' }],
    }))).toBe('other');
    expect(proposalResponseBaselineFromDocument(JSON.stringify({
      ...pure,
      decisions: [...pure.decisions, pure.decisions[0]],
    }))).toBe('other');
    expect(proposalResponseBaselineFromDocument(JSON.stringify({
      ...pure,
      planningWindow: { value: 'next_week' },
    }))).toBe('other');
    expect(proposalResponseBaselineFromDocument('not json')).toBeNull();
  });
});

describe('proposal-response dispatch', () => {
  it('keeps off mode byte-for-byte on the unchanged generic Luna request', async () => {
    const fallback = vi.fn(async () => new Response('baseline-body', {
      status: 207,
      headers: { 'X-Baseline': 'preserved' },
    }));
    const injected = provider(evaluated('reject_only'));
    const response = await dispatchProposalResponse({
      context: context(),
      env: {},
      firebaseUid: 'user-fixture',
      signal: new AbortController().signal,
      fallback,
      respond,
      provider: injected,
    });

    expect(response.status).toBe(207);
    expect(response.headers.get('X-Baseline')).toBe('preserved');
    expect(await response.text()).toBe('baseline-body');
    expect(injected.evaluate).not.toHaveBeenCalled();
  });

  it('keeps an unselected canary on the generic Luna request without calling Jev', async () => {
    const injected = provider(evaluated('reject_only'));
    const fallback = vi.fn(async () => lunaResponse());
    const response = await dispatchProposalResponse({
      context: context(),
      env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '0' },
      firebaseUid: 'user-fixture',
      signal: new AbortController().signal,
      fallback,
      respond,
      provider: injected,
    });
    expect(await response.json()).toEqual({ content: LUNA_DOCUMENT });
    expect(injected.evaluate).not.toHaveBeenCalled();
  });

  it('returns only the correlated closed decision when Jev is accepted', async () => {
    const fallback = vi.fn(async () => lunaResponse());
    const response = await dispatchProposalResponse({
      context: context(),
      env: canaryEnv,
      firebaseUid: 'user-fixture',
      signal: new AbortController().signal,
      fallback,
      respond,
      provider: provider(evaluated('reject_only')),
    });

    expect(await response.json()).toEqual({
      content: JSON.stringify({
        proposalResponse: {
          decision: 'reject_only',
          requestId: 'request-proposal-dispatch',
          inputRevision: 8,
        },
      }),
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['other choice', evaluated('other')],
    ['low confidence', evaluated('reject_only', { confidence: 0.5 })],
    ['conflicting heads', evaluated('reject_only', { independentMeaning: 0.8 })],
    ['timeout', { status: 'unavailable', reason: 'timeout', metadata }],
    ['network', { status: 'unavailable', reason: 'network', metadata }],
    ['HTTP failure', { status: 'unavailable', reason: 'http', httpStatus: 500, metadata }],
    ['malformed', { status: 'unavailable', reason: 'invalid_response', metadata }],
    ['model mismatch', { status: 'unavailable', reason: 'model_mismatch', metadata }],
    ['provider abort', { status: 'unavailable', reason: 'cancelled', metadata }],
  ] as const)('falls back to the generic Luna request for %s', async (_name, evaluation) => {
    const fallback = vi.fn(async () => lunaResponse());
    const response = await dispatchProposalResponse({
      context: context(),
      env: canaryEnv,
      firebaseUid: 'user-fixture',
      signal: new AbortController().signal,
      fallback,
      respond,
      provider: provider(evaluation),
    });

    expect(await response.json()).toEqual({ content: LUNA_DOCUMENT });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('returns Luna in shadow and records Jev against the Luna classification', async () => {
    const pending: Promise<unknown>[] = [];
    const fallback = vi.fn(async () => lunaResponse());
    const response = await dispatchProposalResponse({
      context: context(),
      env: { JEV_MODE: 'shadow' },
      firebaseUid: 'user-fixture',
      executionContext: { waitUntil: (promise) => pending.push(promise) },
      signal: new AbortController().signal,
      fallback,
      respond,
      provider: provider(evaluated('reject_only')),
    });

    expect(await response.json()).toEqual({ content: LUNA_DOCUMENT });
    await Promise.all(pending);
    expect(console.info).toHaveBeenCalledWith(
      '[AI Decision]',
      expect.objectContaining({
        purpose: 'weekly_planning_proposal_response',
        mode: 'shadow',
        outcome: 'shadow',
      }),
    );
  });

  it('classifies an aborted Luna fallback without exposing the error', async () => {
    const controller = new AbortController();
    let fallbackStarted = false;
    const pending = dispatchProposalResponse({
      context: context(),
      env: canaryEnv,
      firebaseUid: 'user-fixture',
      signal: controller.signal,
      fallback: (signal) => new Promise((_resolve, reject) => {
        fallbackStarted = true;
        signal?.addEventListener('abort', () => reject(new Error('private-luna-error')), {
          once: true,
        });
      }),
      respond,
      provider: provider(evaluated('reject_only', { confidence: 0.5 })),
    });
    const failure = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(fallbackStarted).toBe(true));
    controller.abort();

    expect(resolveProposalResponseBaselineFailure(await failure)).toEqual({
      mode: 'canary',
      failure: 'cancelled',
    });
  });
});
