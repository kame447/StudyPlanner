import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

/*
 * One semantic owner, two independently validated parts (Issue #488, design A2).
 * The same model response carries a planning delta and conversation acts. When no planning
 * delta of the turn is usable after the single permitted repair, a valid self-sufficient act
 * still carries the turn as a non-mutating conversation turn. No second model call is made
 * and no invalid planning content is ever accepted.
 */

type Json = Record<string, unknown>;
const USER_TEXT = 'なんで時間が必要なの？';
const PUBLIC_STATE = { tasks: [{ publicId: 'task-1', category: 'study', title: '数学' }] };

function document(overrides: Json = {}): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    conversationActs: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    ...overrides,
  });
}

/** A relation between undeclared local ids, quoting text the user never said: invalid. */
const INVALID_PLANNING = {
  planningIntent: 'update_plan',
  relations: [{ localId: 'r', kind: 'before', fromLocalId: 'x', toLocalId: 'y', sourceText: '英語より先に数学' }],
};

function scriptedClient(replies: Array<string | Error>): OpenAiCompatibleClient & { calls: number } {
  const client = {
    calls: 0,
    async createChatCompletion() {
      const reply = replies[client.calls];
      client.calls += 1;
      if (reply === undefined) throw new Error('unexpected extra call');
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return client as unknown as OpenAiCompatibleClient & { calls: number };
}

function normalize(client: OpenAiCompatibleClient, architecture: 'legacy_v5' | 'interaction_v1' = 'interaction_v1') {
  return createWeeklyPlanningSemanticNormalizerV5(client).normalize({
    userText: USER_TEXT,
    publicStateSummary: PUBLIC_STATE,
    conversationArchitecture: architecture,
  });
}

describe('conversation acts carry a turn whose planning delta is unusable', () => {
  it('keeps a valid explanation act after the planning part is rejected twice', async () => {
    const invalidWithAct = document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] });
    const client = scriptedClient([invalidWithAct, invalidWithAct]);
    const result = await normalize(client);

    expect(client.calls).toBe(2);
    expect(result.status).toBe('accepted');
    expect(result.conversationOnly).toEqual({ planningDelta: 'rejected', planningContentPresent: true, actSource: 'repair' });
    // Nothing from the invalid planning part is accepted.
    expect(result.document).toMatchObject({
      planningIntent: 'discuss', planningWindow: null, tasks: [], relations: [], uncertainties: [], corrections: [], decisions: [],
      conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }],
    });
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.validationErrors.some((error) => error.startsWith('initial:'))).toBe(true);
    expect(result.diagnostics.validationErrors.some((error) => error.startsWith('repair:'))).toBe(true);
  });

  it('keeps the act of the initial response when the repair call itself fails', async () => {
    const client = scriptedClient([
      document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'topic_shift', targetPublicId: 'task-1' }] }),
      new Error('fixture network outage'),
    ]);
    const result = await normalize(client);

    expect(result.status).toBe('accepted');
    expect(result.conversationOnly).toEqual({ planningDelta: 'provider_failure', planningContentPresent: true, actSource: 'initial' });
    expect(result.document?.conversationActs).toEqual([{ kind: 'topic_shift', targetPublicId: 'task-1' }]);
  });

  it('uses an act that only the repaired response carries', async () => {
    const client = scriptedClient([
      document(INVALID_PLANNING),
      document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'resume_topic', targetPublicId: null }] }),
    ]);
    const result = await normalize(client);
    expect(result.status).toBe('accepted');
    expect(result.conversationOnly?.actSource).toBe('repair');
    expect(result.document?.conversationActs).toEqual([{ kind: 'resume_topic', targetPublicId: null }]);
  });

  it('does not carry a turn with a bare answer act: an answer needs its planning delta', async () => {
    const invalidAnswer = document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] });
    const result = await normalize(scriptedClient([invalidAnswer, invalidAnswer]));
    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.conversationOnly).toBeUndefined();
  });

  it('does not carry a turn through a malformed act (fail closed)', async () => {
    const malformed = document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'approve_plan', targetPublicId: null }] });
    const result = await normalize(scriptedClient([malformed, malformed]));
    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
  });

  it('carries nothing of a rejected response that also tried to change other facts', async () => {
    // Rejected planning content aimed at facts this conversation does not have, next to a
    // valid explanation act: the rescued turn is built empty, never merged from the response.
    const adversarial = document({
      ...INVALID_PLANNING,
      corrections: [{
        localId: 'c1', target: { kind: 'task', publicId: 'task-of-another-conversation', localId: null, mention: null },
        operation: 'remove', replacementLocalId: null, sourceText: USER_TEXT,
      }],
      decisions: [{
        localId: 'd1', target: { kind: 'proposal', publicId: 'proposal-of-another-conversation', localId: null, mention: null },
        decision: 'accept', sourceText: USER_TEXT,
      }],
      conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }],
    });
    const result = await normalize(scriptedClient([adversarial, adversarial]));

    expect(result.status).toBe('accepted');
    expect(result.conversationOnly).toMatchObject({ planningDelta: 'rejected', planningContentPresent: true });
    expect(result.document).toEqual({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
      conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }],
    });
  });

  it('never applies to unparseable output', async () => {
    const result = await normalize(scriptedClient(['not json', 'still not json']));
    expect(result.status).toBe('rejected');
    expect(result.conversationOnly).toBeUndefined();
  });

  it('keeps a valid planning delta and its act together (mixed turn), without the conversation-only marker', async () => {
    const mixed = document({
      planningIntent: 'update_plan',
      availabilityDeclarations: [{
        localId: 'a1', kind: 'unavailable', dateExpression: 'weekday:tuesday', namedTimePeriod: null,
        startTime: '18:00', endTime: '20:00', recurrenceKind: null, days: [], constraintLevel: 'hard',
        capacityMinutes: null, sourceText: '火曜日の18時から20時は勉強できない',
      }],
      conversationActs: [{ kind: 'consultation_request', targetPublicId: null }],
    });
    const client = scriptedClient([mixed]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '火曜日の18時から20時は勉強できない。英語はこの量で間に合う？',
      publicStateSummary: PUBLIC_STATE,
      conversationArchitecture: 'interaction_v1',
    });
    expect(client.calls).toBe(1);
    expect(result.status).toBe('accepted');
    expect(result.conversationOnly).toBeUndefined();
    expect(result.document?.availabilityDeclarations).toHaveLength(1);
    expect(result.document?.conversationActs).toEqual([{ kind: 'consultation_request', targetPublicId: null }]);
  });

  it('legacy: acts are an unknown key and never carry a turn (pre-#488 contract)', async () => {
    const withAct = document({ ...INVALID_PLANNING, conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] });
    const client = scriptedClient([withAct, withAct]);
    const result = await normalize(client, 'legacy_v5');
    expect(client.calls).toBe(2);
    expect(result.status).toBe('rejected');
    expect(result.conversationOnly).toBeUndefined();
  });
});
