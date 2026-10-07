import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CAMPAIGN, campaignProviderReply, type CampaignRequest,
} from './testUtils/weeklyPlanningRealE2ECampaignFixture';
import type { Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let scenario: 'D' | 'E';
let weekendShape: 'recurrence' | 'preferred';
beforeEach(() => {
  resetScriptedConversationRuntime();
  weekendShape = 'recurrence';
  provider = installScriptedWeeklyPlanningProvider(call => {
    const reply = campaignProviderReply(scenario, call.request as unknown as CampaignRequest);
    if (scenario !== 'E' || weekendShape !== 'recurrence' || call.kind !== 'semantic_generic'
      || call.payload?.userText !== CAMPAIGN.E[2]) return reply;
    // Exact live E shape: weekend recurrence, no temporal/availability declaration.
    const document = JSON.parse(reply) as Json;
    const task = (document.tasks as Json[])[0];
    task.temporalConstraints = [];
    task.recurrence = [{ localId: 'weekend-sessions', targetLocalId: String(task.localId), kind: 'weekends', count: null,
      days: ['weekday:saturday', 'weekday:sunday'], sourceText: '土日にまとめたい' }];
    return JSON.stringify(document);
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

describe.each(['interaction_v1', 'legacy_v5'] as const)('split-session full turns (%s)', architecture => {
  it('D: keeps the book and places two one-hour research sessions on separate nights', async () => {
    scenario = 'D';
    const conversation = createScriptedConversation({ provider, architecture });
    await conversation.submit(CAMPAIGN.D[0]);
    await conversation.submit(CAMPAIGN.D[1]);
    const old = structuredClone(conversation.getState().previewCandidates);
    const turn = await conversation.submit(CAMPAIGN.D[2]);
    expect(turn.result?.failure).toBeUndefined();
    const semantic = turn.calls.find(call => call.kind === 'semantic_generic')!;
    const system = semantic.messages.find(message => message.role === 'system')!.content;
    if (architecture === 'interaction_v1') {
      expect(system).toContain('Splitting existing work keeps its total unless explicitly changed');
      expect(system).toContain('session_duration for per-session length and recurrence.count when stated');
      expect(system).toContain('どっちも/両方/全部');
    } else expect(system).not.toContain('Splitting existing work keeps its total');
    expect(turn.result?.preserveExistingPreview).not.toBe(true);
    const candidates = conversation.getState().previewCandidates!;
    expect(candidates).not.toEqual(old);
    expect(candidates).toHaveLength(3);
    const research = candidates.filter(candidate => candidate.title.includes('卒業研究ノート'));
    expect(research.map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
    expect(new Set(research.map(candidate => candidate.date)).size).toBe(2);
    expect(candidates.every(candidate => candidate.startTime >= '21:00' && candidate.endTime <= '24:00')).toBe(true);
    expect(candidates.every(candidate => candidate.date >= '2026-10-12' && candidate.date <= '2026-10-18')).toBe(true);
    expect(conversation.graph()!.tasks).toHaveLength(2);
    const researchTask = conversation.graph()!.tasks.find(task => task.title === '卒業研究ノート')!;
    expect(conversation.graph()!.workloads.filter(work => work.taskId === researchTask.id))
      .toMatchObject([{ amount: 2, unitCode: 'hour' }]);
    if (architecture === 'interaction_v1') {
      expect(turn.result?.communicationFacts?.previewConstraintSatisfaction?.every(fact => fact.status === 'satisfied')).toBe(true);
    }
  });

  it.each(['recurrence', 'preferred'] as const)('E: replaces the three-hour preview with Saturday/Sunday sessions (%s)', async shape => {
    scenario = 'E';
    weekendShape = shape;
    const conversation = createScriptedConversation({ provider, architecture });
    await conversation.submit(CAMPAIGN.E[0]);
    const old = structuredClone(conversation.getState().previewCandidates);
    if (architecture === 'interaction_v1') {
      await conversation.submit(CAMPAIGN.E[1]);
      expect(conversation.getState().previewCandidates).toEqual(old);
    }
    const turn = await conversation.submit(CAMPAIGN.E[2]);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(turn.result?.preserveExistingPreview).not.toBe(true);
    const candidates = conversation.getState().previewCandidates!;
    expect(candidates).not.toEqual(old);
    expect(candidates.map(candidate => candidate.date)).toEqual(['2026-10-17', '2026-10-18']);
    expect(candidates.map(candidate => candidate.durationMinutes)).toEqual([90, 90]);
    expect(conversation.graph()!.workloads.map(work => [work.amount, work.unitCode])).toEqual([[3, 'hour']]);
    expect(conversation.graph()!.effortEstimates.filter(effort => effort.kind === 'session_duration'))
      .toMatchObject([{ minutes: 90 }]);
    if (shape === 'recurrence') {
      expect(conversation.graph()!.recurrences).toMatchObject([{ kind: 'weekends', days: ['weekday:saturday', 'weekday:sunday'] }]);
      expect(conversation.graph()!.temporalConstraints).toEqual([]);
      expect(conversation.graph()!.availabilityDeclarations).toEqual([]);
    }
  });
});
