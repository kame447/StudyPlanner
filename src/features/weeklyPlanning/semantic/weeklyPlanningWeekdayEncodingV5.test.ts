import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningWeekdayEncodingV5 } from './weeklyPlanningWeekdayEncodingV5';

function documentWithDay(day: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'pw1',
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: 'a1',
      kind: 'unavailable',
      dateExpression: 'weekday:tuesday',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
      recurrenceKind: 'weekly',
      days: [day],
      constraintLevel: 'hard',
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 weekday encoding', () => {
  it('accepts canonical weekday:<english-day> tokens and rejects bare weekdays', () => {
    expect(validateWeeklyPlanningWeekdayEncodingV5(
      documentWithDay('weekday:tuesday'),
    )).toEqual([]);
    expect(validateWeeklyPlanningWeekdayEncodingV5(
      documentWithDay('tuesday'),
    )).toEqual([
      'availabilityDeclarations[a1].days:canonical-weekday-required:tuesday',
    ]);
  });

  it('still validates and repairs a mocked provider violation without prompt-wording coupling', async () => {
    const responses = [
      JSON.stringify(documentWithDay('tuesday')),
      JSON.stringify(documentWithDay('weekday:tuesday')),
    ];
    const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        requests.push(request);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
    });
    expect(result.document?.availabilityDeclarations[0]?.days).toEqual([
      'weekday:tuesday',
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].responseFormat?.json_schema.name).toBe(
      'weekly_planning_semantic_document_v5',
    );
  });
});
