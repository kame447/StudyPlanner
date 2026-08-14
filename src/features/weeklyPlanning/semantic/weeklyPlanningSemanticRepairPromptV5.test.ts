import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';

describe('Stable V5 semantic repair prompt', () => {
  it('requires a declared replacement fact for a dangling correction replacement localId', () => {
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

    const payload = JSON.parse(messages.at(-1)?.content ?? '{}') as {
      requiredChanges?: string[];
    };
    expect(payload.requiredChanges).toEqual([
      expect.stringContaining('Create the replacement fact stated by current userText'),
    ]);
    expect(payload.requiredChanges?.[0]).toContain(
      "set correction.replacementLocalId to that fact's declared localId",
    );
    expect(payload.requiredChanges?.[0]).toContain('Do not leave a dangling localId');
    expect(messages.at(-2)).toEqual({
      role: 'assistant',
      content: invalidResponse,
    });
  });
});
