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

async function normalizeRepair(response: string) {
  const queued = [initial, response];
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
