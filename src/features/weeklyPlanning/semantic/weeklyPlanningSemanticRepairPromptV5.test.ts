import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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

    const payload = JSON.parse(messages[messages.length - 1]?.content ?? '{}') as {
      requiredChanges?: string[];
      validationErrors?: string[];
    };
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
});
