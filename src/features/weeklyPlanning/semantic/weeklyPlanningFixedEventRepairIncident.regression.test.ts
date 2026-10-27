import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/e2e/fixtures/fixed-event-registration.live-20261026.json', import.meta.url), 'utf8'));
const initial = fixture.original.calls[0].response.content as string;
const repaired = fixture.original.calls[1].response.content as string;

function safeRepair(): WeeklyPlanningSemanticDocumentV5 {
  const document: WeeklyPlanningSemanticDocumentV5 = JSON.parse(initial);
  for (const task of document.tasks) for (const time of task.temporalConstraints) {
    time.dateExpression = 'tomorrow';
    time.constraintLevel = 'hard';
  }
  return document;
}

async function normalizeRepair(response: string, firstResponse = initial) {
  const queued = [firstResponse, response];
  const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
    requests.push(request);
    const response = queued.shift();
    if (!response) throw new Error('Unexpected extra model call in recorded reproduction');
    return response;
  } };
  const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: fixture.original.text });
  expect(requests).toHaveLength(2);
  expect(queued).toEqual([]);
  expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
  return result;
}

describe('Recorded real-provider fixed-event repair, no network', () => {
  it('fails closed on an unavailable initial document while retaining separately validated registration acts', async () => {
    const first: Partial<WeeklyPlanningSemanticDocumentV5> = safeRepair();
    delete first.relations;
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(first), { currentUserText: fixture.original.text });
    expect(validation.providerDocument).toBeNull();
    expect(validation.parsedDocument).toBeNull();
    expect(validation.conversationActs).toEqual(first.conversationActs);
    const response = safeRepair();
    response.conversationActs = [];
    const result = await normalizeRepair(JSON.stringify(response), JSON.stringify(first));
    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toContain('repair:semantic-repair-preservation:comparison-document-unavailable');
  });

  it.each([false, true])('preserves a fixed interval when the initial optional userContextFacts is omitted (destructive=%s)', async destructive => {
    const first = safeRepair();
    first.tasks[4].temporalConstraints[0].constraintLevel = 'soft';
    delete first.userContextFacts;
    const response = safeRepair();
    if (destructive) {
      response.tasks[4].temporalConstraints[0].kind = 'preferred_window';
      response.tasks[4].temporalConstraints[0].constraintLevel = 'soft';
      response.conversationActs = [];
    }
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(first), { currentUserText: fixture.original.text }).errors)
      .toEqual(['document.tasks[4].temporalConstraints[0].constraintLevel:soft-fixed-interval-use-preferred-window']);
    const result = await normalizeRepair(JSON.stringify(response), JSON.stringify(first));
    expect(result.status).toBe(destructive ? 'rejected' : 'accepted');
    if (destructive) expect(result.document).toBeNull();
    else {
      expect(result.document?.tasks[4].temporalConstraints[0]).toEqual(response.tasks[4].temporalConstraints[0]);
      expect(result.document?.conversationActs).toEqual(response.conversationActs);
    }
  });

  it.each(['preserved', 'kind', 'clock', 'precision', 'target', 'removed', 'reordered', 'reordered_kind'] as const)(
    'keeps the addressed interval immutable even with a missing-deadline repair: %s', async change => {
      const first = safeRepair();
      first.tasks[4].temporalConstraints[0].constraintLevel = 'soft';
      first.tasks[0].temporalConstraints.push({
        ...first.tasks[0].temporalConstraints[0], localId: 'missing-deadline', kind: 'deadline',
        dateExpression: null, startTime: null, endTime: null,
      });
      const response = safeRepair();
      const conference = response.tasks[4].temporalConstraints[0];
      if (change === 'kind' || change === 'reordered_kind') { conference.kind = 'preferred_window'; conference.constraintLevel = 'soft'; }
      if (change === 'clock') conference.startTime = '18:00';
      if (change === 'precision') conference.precision = 'exact';
      if (change === 'target') conference.targetLocalId = response.tasks[0].localId;
      if (change === 'removed') response.tasks[4].temporalConstraints = [];
      if (change === 'reordered' || change === 'reordered_kind') response.tasks.reverse();
      const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(first), { currentUserText: fixture.original.text });
      expect(validation.errors).toEqual(expect.arrayContaining([
        'document.tasks[0].temporalConstraints[1]:missing-deadline',
        'document.tasks[4].temporalConstraints[0].constraintLevel:soft-fixed-interval-use-preferred-window',
      ]));
      const result = await normalizeRepair(JSON.stringify(response), JSON.stringify(first));
      const valid = change === 'preserved' || change === 'reordered';
      expect(result.status).toBe(valid ? 'accepted' : 'rejected');
      if (!valid) expect(result.document).toBeNull();
      else expect(result.document?.conversationActs).toEqual(first.conversationActs);
    },
  );

  it('isolates the soft-fixed-interval rejection after date encoding is normalized', () => {
    const document = JSON.parse(initial);
    for (const task of document.tasks) for (const time of task.temporalConstraints) time.dateExpression = 'tomorrow';
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: fixture.original.text });
    expect(validation.errors).toEqual(['document.tasks[4].temporalConstraints[0].constraintLevel:soft-fixed-interval-use-preferred-window']);
  });

  it('must not accept a repair which makes a stated appointment movable or drops registration intent', async () => {
    const result = await normalizeRepair(repaired);
    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toContain(
      'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts');
  });

  it('accepts only the addressed date encoding and constraint level changes, retaining all five fixed events and registration intent', async () => {
    const response = safeRepair();
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(response), { currentUserText: fixture.original.text }).errors).toEqual([]);
    const result = await normalizeRepair(JSON.stringify(response));
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks).toHaveLength(5);
    for (const [index, task] of (result.document?.tasks ?? []).entries()) {
      expect(task.temporalConstraints).toEqual(response.tasks[index].temporalConstraints);
      expect(task.temporalConstraints[0]).toMatchObject({ kind: 'fixed_interval', constraintLevel: 'hard', dateExpression: 'tomorrow' });
    }
    expect(result.document?.tasks[4].temporalConstraints[0].precision).toBe('approximate');
    expect(result.document?.conversationActs).toEqual([{ kind: 'request_event_registration', targetPublicId: null }]);
  });

  it.each(['kind', 'clock', 'precision', 'task', 'untargeted_level', 'act_deleted', 'act_changed'] as const)(
    'rejects an otherwise valid repair that changes unrelated %s', async change => {
      const response = safeRepair();
      const conference = response.tasks[4].temporalConstraints[0];
      if (change === 'kind') conference.kind = 'preferred_window';
      if (change === 'clock') conference.startTime = '18:00';
      if (change === 'precision') conference.precision = 'exact';
      if (change === 'task') response.tasks.pop();
      if (change === 'untargeted_level') {
        response.tasks[0].temporalConstraints[0].constraintLevel = 'soft';
      }
      if (change === 'act_deleted') response.conversationActs = [];
      if (change === 'act_changed') response.conversationActs = [{ kind: 'decline_additional_work', targetPublicId: null }];
      const result = await normalizeRepair(JSON.stringify(response));
      expect(result.status).toBe('rejected');
      expect(result.document).toBeNull();
      expect(result.diagnostics.validationErrors).toContain(
        'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts');
    },
  );
});
