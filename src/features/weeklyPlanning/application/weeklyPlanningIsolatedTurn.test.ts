import { describe, expect, it } from 'vitest';
import { executeIsolatedWeeklyPlanningTurn } from './weeklyPlanningIsolatedTurn';
import { durableReceipt } from './weeklyPlanningDurableTurn.testUtils';
import { getWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
import { loadUserPlanningContextSnapshotV1 } from '../../userPlanningContext/userPlanningContextSpace';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';

function clientFor(text: string): OpenAiCompatibleClient {
  return { async createChatCompletion(input) {
    if (input.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
      planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-14', start: '2026-10-14', end: '2026-10-14', sourceText: '10月14日' },
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
    });
    const prompt = JSON.parse([...input.messages].reverse().find((m) => m.role === 'user')!.content);
    return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
      questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text });
  } };
}
describe('invocation-local shared weekly planning runtime', () => {
  it('runs the real semantic, deterministic planning and renderer code without writing browser sessions', async () => {
    const payload = durableReceipt().payload; payload.input.userText = '10月14日の計画を立てたい';
    const result = await executeIsolatedWeeklyPlanningTurn(payload, clientFor('どの学習を計画しましょうか？'));
    expect(result.result.failure).toBeUndefined();
    expect(result.result.stableV5Graph?.revision).toBe(1);
    expect(result.result.stableV5Graph?.planningWindows).toHaveLength(1);
    expect(result.result.message).toBe('どの学習を計画しましょうか？');
    expect(result.result.draftCandidates).toEqual([]);
    expect(getWeeklyPlanningStableV5RuntimeSession('chat')).toBeNull();
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'alice', currentDate: '2026-10-14' }).records).toEqual([]);
  });
  it('does not mix two simultaneous owners using the same conversation and request IDs', async () => {
    const alice = durableReceipt().payload; alice.input.userText = '10月14日の計画を立てたい';
    const bob = structuredClone(alice); bob.input.userId = 'bob';
    const [a, b] = await Promise.all([executeIsolatedWeeklyPlanningTurn(alice, clientFor('何を学習しますか？')),
      executeIsolatedWeeklyPlanningTurn(bob, clientFor('どの学習を計画しましょうか？'))]);
    expect(a.result.message).toBe('何を学習しますか？'); expect(b.result.message).toBe('どの学習を計画しましょうか？');
    expect(getWeeklyPlanningStableV5RuntimeSession('chat')).toBeNull();
  });
});
