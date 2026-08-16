import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';
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

  it('keeps canonical relative-date handling in the shared meaning policy while repair stays local', () => {
    const baseMessages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: 'こちらは来週末までに。',
      publicStateSummary: {
        calendarContext: {
          currentDate: '2026-08-16',
          timeZone: 'Asia/Tokyo',
        },
      },
    });
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages,
      invalidResponse: '{}',
      validationErrors: ['document.uncertainties[0].targetLocalId'],
    });

    const payload = repairPayload(messages);
    const system = messages[0]?.content ?? '';

    expect(system).toContain(
      'Resolve relative dates from calendarContext to canonical dateExpression.',
    );
    expect(payload.requiredChanges).toEqual([
      'Use a fresh localId declared in this response as targetLocalId; never use a public Fact ID there.',
    ]);
  });
});
