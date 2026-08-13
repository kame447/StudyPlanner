import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  normalizeWeeklyPlanningWeekdayEncodingV5,
  validateWeeklyPlanningWeekdayEncodingV5,
} from './weeklyPlanningWeekdayEncodingV5';

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
  it('accepts canonical weekday tokens and still rejects unknown aliases', () => {
    expect(validateWeeklyPlanningWeekdayEncodingV5(
      documentWithDay('weekday:tuesday'),
    )).toEqual([]);
    expect(validateWeeklyPlanningWeekdayEncodingV5(
      documentWithDay('tue'),
    )).toEqual([
      'availabilityDeclarations[a1].days:canonical-weekday-required:tue',
    ]);
  });

  it('canonicalizes an exact bare weekday alias without semantic inference', () => {
    const normalized = normalizeWeeklyPlanningWeekdayEncodingV5(
      documentWithDay('tuesday'),
    );

    expect(normalized.document.availabilityDeclarations[0]?.days).toEqual([
      'weekday:tuesday',
    ]);
    expect(normalized.repairs).toEqual([
      'weekday-token-canonicalized:availability:a1:tuesday->weekday:tuesday',
    ]);
  });

  it('accepts a mocked bare weekday provider violation in one call', async () => {
    const response = JSON.stringify(documentWithDay('tuesday'));
    const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        requests.push(request);
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'weekday-token-canonicalized:availability:a1:tuesday->weekday:tuesday',
    );
    expect(result.document?.availabilityDeclarations[0]?.days).toEqual([
      'weekday:tuesday',
    ]);
    expect(requests).toHaveLength(1);
  });
});
