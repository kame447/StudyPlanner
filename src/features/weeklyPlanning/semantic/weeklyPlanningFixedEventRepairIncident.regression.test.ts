import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/e2e/fixtures/fixed-event-registration.live-20261026.json', import.meta.url), 'utf8'));
const initial = fixture.original.calls[0].response.content as string;
const repaired = fixture.original.calls[1].response.content as string;

describe('Recorded real-provider fixed-event repair, no network', () => {
  it('isolates the soft-fixed-interval rejection after date encoding is normalized', () => {
    const document = JSON.parse(initial);
    for (const task of document.tasks) for (const time of task.temporalConstraints) time.dateExpression = 'tomorrow';
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: fixture.original.text });
    expect(validation.errors).toEqual(['document.tasks[4].temporalConstraints[0].constraintLevel:soft-fixed-interval-use-preferred-window']);
  });

  it('must not accept a repair which makes a stated appointment movable or drops registration intent', async () => {
    const queued = [initial, repaired];
    const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
      requests.push(request);
      const response = queued.shift();
      if (!response) throw new Error('Unexpected extra model call in recorded reproduction');
      return response;
    } };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: fixture.original.text });
    expect(requests).toHaveLength(2);
    // Rejecting the unsafe result or returning an explicit clarification is safe.
    if (result.status !== 'accepted') return;
    const conference = result.document?.tasks.find(task => task.title === 'カンファレンス');
    expect.soft(conference?.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_interval', startTime: '17:00', endTime: '21:00' }),
    ]));
    expect(result.document?.conversationActs).toContainEqual(expect.objectContaining({ kind: 'request_event_registration' }));
  });
});
