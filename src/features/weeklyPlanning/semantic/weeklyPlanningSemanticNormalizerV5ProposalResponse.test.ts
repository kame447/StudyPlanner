import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningProposalResponseCandidateV5 } from './weeklyPlanningFocusedProposalResponseV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

const PROPOSAL_ID = 'wpp_memory_abc';
const REQUEST_ID = 'conversation-1:request:5';

const candidate: WeeklyPlanningProposalResponseCandidateV5 = {
  proposalPublicId: PROPOSAL_ID,
  inputRevision: 8,
  presentedAssistantText: '英単語は1回15〜30分の分散学習にしますか？',
  proposal: {
    kind: 'spaced_memory_practice',
    taskTitle: '英単語',
    sessionMinutes: { min: 15, max: 30 },
  },
};

const publicStateSummary = {
  graphRevision: 3,
  pendingQuestion: {
    actionId: PROPOSAL_ID,
    questionCode: 'learning_strategy_proposal',
    targetFactId: 'workload-1',
    graphRevision: 3,
    effortMeasurement: null,
    estimateForWorkloadFactId: null,
    questionBasis: null,
  },
  learningStrategyProposals: [{
    publicId: PROPOSAL_ID,
    kind: 'spaced_memory_practice',
    taskPublicId: 'task-1',
    workloadPublicId: 'workload-1',
    scope: 'week',
    status: 'pending',
    suggestedSessionMinutes: { min: 15, max: 30 },
  }],
  tasks: [{ publicId: 'task-1', category: 'study', title: '英単語' }],
};

const closedDecision = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  proposalResponse: {
    decision: 'reject_only',
    requestId: REQUEST_ID,
    inputRevision: 8,
    ...overrides,
  },
});

const lunaAcceptDocument = JSON.stringify({
  schemaVersion: 'weekly-planning-semantic-v5',
  planningIntent: 'discuss',
  planningWindow: null,
  tasks: [],
  relations: [],
  availabilityDeclarations: [],
  constraintSourceRequests: [],
  uncertainties: [],
  corrections: [],
  decisions: [{
    localId: 'd1',
    target: { kind: 'proposal', publicId: PROPOSAL_ID, localId: null, mention: null },
    decision: 'accept',
    sourceText: 'はい',
  }],
});

function client(...responses: string[]): OpenAiCompatibleClient {
  const queue = [...responses];
  return {
    createChatCompletion: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected extra provider call');
      return next;
    }),
  };
}

function normalize(ai: OpenAiCompatibleClient, userText: string, withCandidate = true) {
  return createWeeklyPlanningSemanticNormalizerV5(ai).normalize({
    userText,
    publicStateSummary,
    traceRequestId: REQUEST_ID,
    ...(withCandidate ? { proposalResponseCandidate: candidate } : {}),
  });
}

describe('Stable V5 proposal-response route', () => {
  it('attaches the bounded context to the single generic request and applies an accepted rejection', async () => {
    const ai = client(closedDecision());

    const result = await normalize(ai, '今回はやめておきます');

    expect(ai.createChatCompletion).toHaveBeenCalledTimes(1);
    const request = vi.mocked(ai.createChatCompletion).mock.calls[0][0];
    expect(request.purpose).toBe('weekly_planning_semantic_normalizer');
    expect(request.decisionContext).toEqual({
      purpose: 'proposal_response',
      requestId: REQUEST_ID,
      inputRevision: 8,
      state: {
        currentUserText: '今回はやめておきます',
        presentedAssistantText: candidate.presentedAssistantText,
        proposal: candidate.proposal,
      },
    });
    expect(JSON.stringify(request.decisionContext)).not.toContain(PROPOSAL_ID);
    expect(result).toMatchObject({
      status: 'accepted',
      document: {
        planningIntent: 'discuss',
        tasks: [],
        decisions: [{
          target: { kind: 'proposal', publicId: PROPOSAL_ID },
          decision: 'reject',
          sourceText: '今回はやめておきます',
        }],
      },
    });
  });

  it('uses an ordinary generic document unchanged when the Worker returns one', async () => {
    const ai = client(lunaAcceptDocument);

    const result = await normalize(ai, 'はい、お願いします');

    expect(result.status).toBe('accepted');
    expect(result.document?.decisions).toEqual([
      expect.objectContaining({ decision: 'accept' }),
    ]);
  });

  it.each([
    ['another request', closedDecision({ requestId: 'conversation-1:request:4' })],
    ['another revision', closedDecision({ inputRevision: 7 })],
    ['a non-reject decision', closedDecision({ decision: 'accept' })],
  ])('never applies a closed decision for %s', async (_label, response) => {
    const ai = client(response, lunaAcceptDocument, lunaAcceptDocument);

    const result = await normalize(ai, '今回はやめておきます');

    expect(result.document?.decisions ?? []).not.toContainEqual(
      expect.objectContaining({ decision: 'reject' }),
    );
  });

  it('sends no proposal-response context without an application-resolved candidate', async () => {
    const ai = client(lunaAcceptDocument);

    await normalize(ai, 'はい', false);

    expect(vi.mocked(ai.createChatCompletion).mock.calls[0][0]).not.toHaveProperty('decisionContext');
  });

  it('never attaches the context to a turn with supplemental evidence', async () => {
    const ai = client(lunaAcceptDocument);

    await createWeeklyPlanningSemanticNormalizerV5(ai).normalize({
      userText: 'いいえ',
      supplementalContext: '画像から読み取った予定',
      publicStateSummary,
      traceRequestId: REQUEST_ID,
      proposalResponseCandidate: candidate,
    });

    for (const [request] of vi.mocked(ai.createChatCompletion).mock.calls) {
      expect(request).not.toHaveProperty('decisionContext');
    }
  });

  it('falls closed to a generic request when the rejection cannot be validated', async () => {
    const ai = client(closedDecision(), lunaAcceptDocument);

    const result = await createWeeklyPlanningSemanticNormalizerV5(ai).normalize({
      userText: '今回はやめておきます',
      // The proposal is not in the published state, so the rejection cannot bind.
      publicStateSummary: { ...publicStateSummary, learningStrategyProposals: [] },
      traceRequestId: REQUEST_ID,
      proposalResponseCandidate: candidate,
    });

    const calls = vi.mocked(ai.createChatCompletion).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [request] of calls.slice(1)) {
      expect(request).not.toHaveProperty('decisionContext');
    }
    expect(result.document?.decisions ?? []).not.toContainEqual(
      expect.objectContaining({ decision: 'reject' }),
    );
  });
});
