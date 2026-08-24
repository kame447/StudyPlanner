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
  it('keeps dangling-correction repair local, bound, bounded, and preservation-safe', () => {
    const invalidResponse = JSON.stringify({
      tasks: [{
        localId: 'task-1',
        existingPublicId: 'public-task-1',
        category: 'study',
        study: {
          purpose: 'self_study',
          activityKind: 'problem_solving',
          contextLabel: null,
          components: [],
        },
      }],
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
    expect(payload.requiredChanges).toHaveLength(1);
    expect(directive).toContain('missing replacement facts');
    expect(directive).toContain('currentUserText');
    expect(directive).toContain('schema-valid task/component');
    expect(directive).toContain('keep valid fields');
    expect(directive).toContain('correction.replacementLocalId');
    expect(directive).toContain('fresh localId');
    expect(directive).toContain('exact existingPublicIds');
    expect(directive).toContain('Preserve unrelated supported current-turn facts');
    expect(directive).toContain('schema-valid fields from the invalid response');
    // This is a runaway guard, not a compaction target. Provenance and
    // preservation instructions must not be removed merely to satisfy bytes.
    expect(bytes(directive)).toBeLessThanOrEqual(1024);
    expect(messages[messages.length - 2]).toEqual({
      role: 'assistant',
      content: invalidResponse,
    });
  });

  it('keeps symbolic relative-date meaning in the shared policy while repair stays local', () => {
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
      'Keep relative dates symbolic; deterministic calendar code resolves them.',
    );
    expect(payload.requiredChanges).toHaveLength(1);
    expect(payload.requiredChanges?.[0]).toContain(
      'Use a fresh localId declared in this response as targetLocalId',
    );
    expect(payload.requiredChanges?.[0]).toContain(
      'Preserve unrelated supported current-turn facts',
    );
  });

  it('repairs a self-referential uncertainty toward document or a supported fact without dropping valid meaning', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: '{}',
      validationErrors: [
        'document.uncertainties[0].targetLocalId:self-reference',
      ],
    });
    const payload = repairPayload(messages);

    expect(payload.requiredChanges).toHaveLength(1);
    expect(payload.requiredChanges?.[0]).toContain(
      'Never target an uncertainty at its own localId',
    );
    expect(payload.requiredChanges?.[0]).toContain(
      'Preserve unrelated supported current-turn facts',
    );
    expect(payload.requiredChanges?.join('\n')).not.toContain(
      'Use a fresh localId declared in this response as targetLocalId',
    );
  });
});
