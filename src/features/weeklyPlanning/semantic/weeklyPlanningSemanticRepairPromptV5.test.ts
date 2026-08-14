import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function repairPayload(messages: Array<{ role: string; content: string }>): {
  requiredChanges?: string[];
  validationErrors?: string[];
} {
  return JSON.parse(messages[messages.length - 1]?.content ?? '{}');
}

describe('Stable V5 semantic repair prompt', () => {
  it('keeps dangling-correction repair local, bound, and compact', () => {
    const invalidResponse = JSON.stringify({
      corrections: [{
        operation: 'replace',
        replacementLocalId: 'temporal_1',
      }],
    });
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse,
      validationErrors: [
        'document.corrections[0].replacementLocalId:unknown:temporal_1',
      ],
      input: {
        userText: 'やっぱり夕方ではなく、夜にしてください。',
      },
    });

    const payload = repairPayload(messages);
    const directive = payload.requiredChanges?.[0] ?? '';

    expect(payload).not.toHaveProperty('instruction');
    expect(payload.validationErrors).toEqual([
      'document.corrections[0].replacementLocalId:unknown:temporal_1',
    ]);
    expect(directive).toContain('replacement fact stated in currentUserText');
    expect(directive).toContain('minimal schema-valid containing task/component');
    expect(directive).toContain('correction.replacementLocalId');
    expect(directive).toContain('fresh localId');
    expect(directive).toContain('exact existingPublicIds');
    expect(bytes(directive)).toBeLessThanOrEqual(450);
    expect(messages[messages.length - 2]).toEqual({
      role: 'assistant',
      content: invalidResponse,
    });
  });

  it('repairs unsupported relative goal-event dates without restoring a global prompt guard', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: '{}',
      validationErrors: [
        'document.userContextFacts[0].dateExpression:unsupported-expression',
      ],
      input: {
        userText: '2週間後に共通テスト模試があります。',
        publicStateSummary: {
          calendarContext: { currentDate: '2026-08-14', timeZone: 'Asia/Tokyo' },
        },
      },
    });

    const directive = repairPayload(messages).requiredChanges?.[0] ?? '';
    expect(directive).toContain('supported ISO YYYY-MM-DD');
    expect(directive).toContain('calendarContext.currentDate/timeZone');
    expect(directive).toContain('preserve the event value separately');
    expect(bytes(directive)).toBeLessThanOrEqual(260);
  });
});
