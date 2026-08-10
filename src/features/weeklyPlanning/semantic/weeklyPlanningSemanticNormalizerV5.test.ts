import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: 'availability-1',
      kind: 'unavailable',
      dateExpression: null,
      namedTimePeriod: null,
      startTime: null,
      endTime: '18:00',
      recurrenceKind: 'weekdays',
      days: [],
      constraintLevel: 'hard',
      sourceText: '平日は18時まで勉強できません',
    }],
    constraintSourceRequests: [{
      localId: 'source-1',
      kind: 'timetable',
      selector: 'active',
      requestedAction: 'use',
      sourceText: '時間割も使って',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function priorityDocument(invalidTemporalConstraint: boolean): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-research',
      category: 'study',
      title: '卒業研究',
      study: { purpose: 'research', contextLabel: '卒業研究', components: [] },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: invalidTemporalConstraint
        ? [{
            localId: 'constraint-research-priority',
            targetLocalId: 'task-research',
            kind: 'earliest_start',
            constraintLevel: 'unknown',
            dateExpression: 'today',
            namedTimePeriod: 'morning',
            startTime: null,
            endTime: null,
            precision: 'unspecified',
            sourceText: '優先順位は卒業研究',
          }]
        : [],
      recurrence: [],
      sourceText: '卒業研究',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function client(sequence: Array<string | Error>): {
  value: OpenAiCompatibleClient;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  return {
    calls,
    value: {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        const next = sequence[index++];
        if (next instanceof Error) throw next;
        if (next === undefined) throw new Error('fake sequence exhausted');
        return next;
      },
    },
  };
}

function repairPayload(call: Record<string, unknown>): {
  instruction?: string;
  requiredChanges?: string[];
  validationErrors?: string[];
} {
  const messages = call.messages as Array<{ role: string; content: string }>;
  return JSON.parse(messages[messages.length - 1]?.content ?? '{}');
}

describe('Stable V5 semantic normalizer', () => {
  it('uses the Stable V5 schema and records version metadata', async () => {
    const raw = JSON.stringify(document());
    const fake = client([raw]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '平日は18時まで勉強できません。時間割も使ってください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toEqual(document());
    expect(result.diagnostics).toMatchObject({
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
      attemptCount: 1,
      repairAttempted: false,
      providerError: null,
    });
    expect(fake.calls[0]).toMatchObject({
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: 3200,
    });
  });

  it('tells the AI it owns contextual meaning and exact pending-target resolution', async () => {
    const fake = client([JSON.stringify(document())]);
    await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '40問に3時間かかります',
      publicStateSummary: {
        pendingQuestion: {
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload-40',
          graphRevision: 1,
        },
      },
    });

    const messages = fake.calls[0].messages as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? '';
    expect(system).toContain('You alone interpret user meaning and context');
    expect(system).toContain('Treat publicStateSummary.pendingQuestion as authoritative');
    expect(system).toContain('never infer its target from assistant wording');
    expect(system).toContain('Every sourceText must be supported by current userText, not prior turns');
    expect(system).toContain('target means the amount intended for this plan');
    expect(system).toContain('remaining means the full unfinished amount');
    expect(system).toContain('completed means the amount already done');
    expect(system).toContain('For quantity_role_unresolved');
    expect(system).toContain('Never keep uncertainty for a resolved role');
    expect(system).toContain('For semantic_uncertainty');
    expect(system).toContain('An effortEstimate may target the exact task, component, or workload localId');
  });

  it('does not manufacture an omitted planning window from the user wording', async () => {
    const response = {
      ...document(),
      availabilityDeclarations: [],
      constraintSourceRequests: [],
    };
    const fake = client([JSON.stringify(response)]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日の予定を立てたいです',
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toEqual(response);
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('repairs at most once and never falls back to a parser', async () => {
    const repaired = { ...document(), availabilityDeclarations: [] };
    const fake = client(['not-json', JSON.stringify(repaired)]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '時間割も使って',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document:invalid-json'],
    });
    expect(fake.calls).toHaveLength(2);
    const payload = repairPayload(fake.calls[1]);
    expect(payload.requiredChanges).toEqual([
      'Correct only the listed schema, type, range, reference, or structural validation failures while preserving the meaning you derived from the original context.',
    ]);
    expect(payload.validationErrors).toEqual(['document:invalid-json']);
  });

  it('repairs a structural temporal error without selecting new user meaning', async () => {
    const fake = client([
      JSON.stringify(priorityDocument(true)),
      JSON.stringify(priorityDocument(false)),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '卒業研究を優先します',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics.validationErrors).toEqual([
      'document.tasks[0].temporalConstraints[0]:missing-start',
    ]);
    expect(repairPayload(fake.calls[1]).requiredChanges).toEqual([
      'Remove or change unsupported temporal constraints instead of inventing a missing clock or date boundary.',
    ]);
  });

  it('rejects when the single repair remains invalid', async () => {
    const fake = client(['not-json', '{}']);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '予定を見て',
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(fake.calls).toHaveLength(2);
  });

  it('returns provider failure without semantic state', async () => {
    const fake = client([new Error('provider unavailable')]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '平日は無理です',
    });

    expect(result).toMatchObject({
      status: 'provider_failure',
      document: null,
      diagnostics: {
        attemptCount: 1,
        repairAttempted: false,
        providerError: 'provider unavailable',
      },
    });
  });
});
