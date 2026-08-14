import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import {
  normalizeWeeklyPlanningTemporalClockRawV5,
  validateWeeklyPlanningTemporalClockEncodingV5,
} from './weeklyPlanningTemporalClockEncodingV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function invalidClockAsCustomPeriod(): WeeklyPlanningSemanticDocumentV5 {
  const document = baseDocument();
  document.availabilityDeclarations = [{
    localId: 'availability-tuesday',
    kind: 'unavailable',
    dateExpression: 'weekday:tuesday',
    namedTimePeriod: 'custom:18時から20時',
    startTime: null,
    endTime: null,
    recurrenceKind: 'weekly',
    days: ['weekday:tuesday'],
    constraintLevel: 'hard',
    sourceText: '火曜日の18時から20時は予定があるので避けてください',
  }];
  return document;
}

function repairedClockFields(): WeeklyPlanningSemanticDocumentV5 {
  const document = baseDocument();
  document.availabilityDeclarations = [{
    localId: 'availability-tuesday',
    kind: 'unavailable',
    dateExpression: 'weekday:tuesday',
    namedTimePeriod: null,
    startTime: '18:00',
    endTime: '20:00',
    recurrenceKind: 'weekly',
    days: ['weekday:tuesday'],
    constraintLevel: 'hard',
    sourceText: '火曜日の18時から20時は予定があるので避けてください',
  }];
  return document;
}

function redundantNamedPeriodWithClock(): WeeklyPlanningSemanticDocumentV5 {
  const document = repairedClockFields();
  document.availabilityDeclarations[0].namedTimePeriod = 'evening';
  return document;
}

describe('Stable V5 temporal clock encoding', () => {
  it('rejects exact clock values encoded only inside custom namedTimePeriod', () => {
    const errors = validateWeeklyPlanningTemporalClockEncodingV5(
      invalidClockAsCustomPeriod(),
    );

    expect(errors).toEqual([
      expect.stringContaining(
        'explicit clock text must use startTime/endTime with namedTimePeriod=null',
      ),
    ]);
  });

  it('canonicalizes redundant namedTimePeriod when exact clocks already exist', () => {
    const raw = normalizeWeeklyPlanningTemporalClockRawV5(
      JSON.stringify(redundantNamedPeriodWithClock()),
    );
    const parsed = JSON.parse(raw.rawResponse) as WeeklyPlanningSemanticDocumentV5;

    expect(parsed.availabilityDeclarations[0]).toMatchObject({
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
    });
    expect(raw.repairs).toEqual([
      'named-time-period-cleared-for-explicit-clock:availability:availability-tuesday',
    ]);
  });

  it('accepts the canonical exact-clock representation', () => {
    expect(
      validateWeeklyPlanningTemporalClockEncodingV5(repairedClockFields()),
    ).toEqual([]);
  });

  it('accepts redundant exact-clock representation in one provider call', async () => {
    const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        calls.push(request);
        return JSON.stringify(redundantNamedPeriodWithClock());
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で、火曜日の18時から20時は予定があるので避けてください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'named-time-period-cleared-for-explicit-clock:availability:availability-tuesday',
    );
    expect(result.document?.availabilityDeclarations[0]).toMatchObject({
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
    });
    expect(calls).toHaveLength(1);
  });

  it('sends a clock expression that still needs semantic interpretation through one AI repair', async () => {
    const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const responses = [
      JSON.stringify(invalidClockAsCustomPeriod()),
      JSON.stringify(repairedClockFields()),
    ];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        calls.push(request);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で、火曜日の18時から20時は予定があるので避けてください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
    });
    expect(result.diagnostics.validationErrors).toEqual([
      expect.stringContaining(
        'explicit clock text must use startTime/endTime with namedTimePeriod=null',
      ),
    ]);
    expect(result.document?.availabilityDeclarations).toEqual([
      expect.objectContaining({
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
      }),
    ]);
    expect(calls).toHaveLength(2);

    const repairMessages = calls[1].messages;
    const repairPayload = JSON.parse(
      repairMessages[repairMessages.length - 1]?.content ?? '{}',
    ) as { requiredChanges?: string[] };
    expect(repairPayload.requiredChanges).toHaveLength(1);
    expect(repairPayload.requiredChanges?.[0]).toContain('startTime/endTime');
    expect(repairPayload.requiredChanges?.[0]).toContain('namedTimePeriod null');
    expect(repairPayload.requiredChanges?.[0]).toContain('invent no bounds');
  });
});
