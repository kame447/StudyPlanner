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
  it('keeps dangling-correction repair local, bound, compact, and preservation-safe', () => {
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
    const preservation = payload.requiredChanges?.[1] ?? '';

    expect(payload).not.toHaveProperty('instruction');
    expect(payload.validationErrors).toEqual([
      'document.corrections[0].replacementLocalId:unknown:temporal_1',
    ]);
    expect(directive).toContain('missing replacement fact');
    expect(directive).toContain('minimal schema-valid containing task/component');
    expect(directive).toContain('preserve existing schema-valid task/component fields');
    expect(directive).toContain('correction.replacementLocalId');
    expect(directive).toContain('fresh localId');
    expect(directive).toContain('exact existingPublicIds');
    expect(bytes(directive)).toBeLessThanOrEqual(450);
    expect(preservation).toContain('Preserve unrelated supported current-turn facts');
    expect(preservation).toContain('schema-valid fields from the invalid response');
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
    expect(payload.requiredChanges).toEqual([
      'Use a fresh localId declared in this response as targetLocalId; never use a public Fact ID there.',
      'Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response unless a listed error requires changing them.',
    ]);
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

    expect(payload.requiredChanges).toEqual([
      'Never target an uncertainty at its own localId. If the referent is unresolved, use targetLocalId=document; otherwise target the supported fact localId.',
      'Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response unless a listed error requires changing them.',
    ]);
    expect(payload.requiredChanges?.join('\n')).not.toContain(
      'Use a fresh localId declared in this response as targetLocalId',
    );
  });
});
