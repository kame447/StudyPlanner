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

    expect(payload).not.toHaveProperty('instruction');
    expect(payload.validationErrors).toEqual([
      'document.corrections[0].replacementLocalId:unknown:temporal_1',
    ]);
    expect(payload.requiredChanges).toHaveLength(1);
    expect(directive).toContain('missing replacement facts');
    expect(directive).toContain('schema-valid task/component');
    expect(directive).toContain('keep valid fields');
    expect(directive).toContain('correction.replacementLocalId');
    expect(directive).toContain('fresh localId');
    expect(directive).toContain('exact existingPublicIds');
    expect(directive).toContain('Preserve unrelated supported current-turn facts');
    expect(directive).toContain('schema-valid fields from the invalid response');
    // The current repair adds one canonical-date sentence, because a fact added by the one
    // repair cannot be repaired again (live C on d7b85616); the historical prompt stays compact.
    expect(directive).toContain('Any dateExpression you write must be canonical');
    expect(bytes(directive)).toBeLessThanOrEqual(650);
    const legacy = repairPayload(createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse,
      validationErrors: ['document.corrections[0].replacementLocalId:unknown:temporal_1'],
      conversationArchitecture: 'legacy_v5',
    })).requiredChanges?.[0] ?? '';
    expect(legacy).not.toContain('Any dateExpression you write must be canonical');
    expect(bytes(legacy)).toBeLessThanOrEqual(450);
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
      'Keep relative dates symbolic for deterministic calendar resolution.',
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

  it('repairs rejected sourceText from exact current-turn evidence or removes the unsupported fact', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: '{}',
      validationErrors: [
        'document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text',
      ],
    });
    const directive = repairPayload(messages).requiredChanges?.join('\n') ?? '';

    expect(directive).toContain('exact contiguous substring from current userText');
    expect(directive).toContain('do not paraphrase');
    expect(directive).toContain('remove only that unsupported fact');
    expect(directive).toContain('Preserve unrelated supported current-turn facts');
  });

  it('repairs weekday date expressions into canonical Stable V5 syntax without inventing dates', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: '{}',
      validationErrors: [
        'document.tasks[0].taskDateRules[0].dateExpression:canonical-expression',
      ],
    });
    const directive = repairPayload(messages).requiredChanges?.join('\n') ?? '';

    expect(directive).toContain('weekday:sunday through weekday:saturday');
    expect(directive).toContain('weekday:<english-weekday>');
    expect(directive).toContain('never emit a bare localized weekday');
    expect(directive).toContain('never invent an absolute date');
    expect(directive).toContain('Preserve unrelated supported current-turn facts');
  });
});


it('current repair teaches the resolver range syntax while the historical comparison prompt stays unchanged', () => {
  const create = (conversationArchitecture: 'interaction_v1' | 'legacy_v5') => repairPayload(createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: [{ role: 'system', content: 'normalize' }], invalidResponse: '{}',
    validationErrors: ['document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression'],
    conversationArchitecture,
  }));
  const current = create('interaction_v1');
  const legacy = create('legacy_v5');
  const currentDirective = current.requiredChanges?.[0] ?? '';
  const legacyDirective = legacy.requiredChanges?.[0] ?? '';
  expect(currentDirective).toContain('YYYY-MM-DD/YYYY-MM-DD');
  expect(currentDirective).not.toContain('YYYY-MM-DD..YYYY-MM-DD');
  expect(legacyDirective).toContain('YYYY-MM-DD..YYYY-MM-DD');
  // Current repair adds only the weekday-set restatement (live A on 2f9ae953); the
  // historical comparison prompt is otherwise the same rule, byte for byte.
  const rule = (directive: string) => directive.slice(0, directive.indexOf(' Correct every listed validation failure.'));
  expect(rule(currentDirective).replace('YYYY-MM-DD/YYYY-MM-DD', 'YYYY-MM-DD..YYYY-MM-DD').startsWith(rule(legacyDirective))).toBe(true);
  expect(rule(legacyDirective).endsWith('never invent an absolute date.')).toBe(true);
  for (const token of ['recurrenceKind/days', 'one copy per weekday', 'Never add recurrence']) {
    expect(currentDirective).toContain(token);
    expect(legacyDirective).not.toContain(token);
  }
});

it('keeps a stated time of day when a date rule must drop its period (live H on b3204cdd)', () => {
  const create = (conversationArchitecture: 'interaction_v1' | 'legacy_v5') => repairPayload(createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: [{ role: 'system', content: 'normalize' }], invalidResponse: '{}',
    validationErrors: ['document.tasks[0].temporalConstraints[0].namedTimePeriod:must-be-null-for-date-rule'],
    conversationArchitecture,
  })).requiredChanges?.join('\n') ?? '';
  expect(create('interaction_v1')).toContain('Never drop the stated time of day');
  expect(create('interaction_v1')).toContain('separate preferred_window');
  expect(create('legacy_v5')).not.toContain('Never drop the stated time of day');
});


it('interaction unknown replacement guidance preserves the referenced id and corrected kind or drops a no-change correction', () => {
  const create = (conversationArchitecture: 'interaction_v1' | 'legacy_v5', validationErrors: string[]) => repairPayload(createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: [{ role: 'user', content: 'ordinary user input' }],
    invalidResponse: '{}', validationErrors, conversationArchitecture,
  })).requiredChanges?.join('\n') ?? '';
  const error = 'document.corrections[0].replacementLocalId:unknown:deadline-next';
  const current = create('interaction_v1', [error]);
  expect(current).toContain('corrected kind');
  expect(current).toContain('referenced correction.replacementLocalId');
  expect(current).toContain('drop the correction if no change is meant');
  const historical = create('legacy_v5', [error]);
  expect(historical).toBe('Declare missing replacement facts in a schema-valid task/component; keep valid fields. Set correction.replacementLocalId to each fresh localId. Use exact existingPublicIds for accepted parent identity. Correct every listed validation failure. Treat listed validation failures cumulatively. Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response. Re-read userText for supported omissions.');
  const unrelated = create('interaction_v1', ['document.tasks[0].localId:required']);
  expect(unrelated).not.toContain('corrected kind');
});

describe('repair of a restated accepted fact (live D T3)', () => {
  const restated = (existingPublicId: string | null) => JSON.stringify({
    tasks: [{
      localId: 'task_reading', existingPublicId, sourceText: '',
      workloads: [{ localId: 'w1', amount: 20, unitCode: 'page', sourceText: '20ページ' }],
      effortEstimates: [{ localId: 'e1', kind: 'session_duration', minutes: 60, sourceText: '1回1時間' }],
    }],
  });
  const create = (
    invalidResponse: string,
    validationErrors: string[],
    conversationArchitecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1',
  ) => repairPayload(createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: [{ role: 'user', content: 'ordinary user input' }],
    invalidResponse, validationErrors, conversationArchitecture,
  })).requiredChanges?.join('\n') ?? '';
  const errors = [
    'document.tasks[0].sourceText:not-grounded-in-current-user-text',
    'document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text',
  ];

  it('tells the repair not to restate an accepted entity bound by existingPublicId', () => {
    expect(create(restated('task-accepted'), errors)).toContain('Do not restate');
  });

  it('adds nothing for an unbound entity, for unrelated errors, or in legacy', () => {
    expect(create(restated(null), errors)).not.toContain('Do not restate');
    expect(create(restated('task-accepted'), ['document.tasks[0].localId:required'])).not.toContain('Do not restate');
    expect(create(restated('task-accepted'), errors, 'legacy_v5')).not.toContain('Do not restate');
    expect(create('not json', errors)).not.toContain('Do not restate');
  });
});
