import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import {
  normalizePlanningWindowCanonicalV5,
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import type { SemanticPlanningWindowV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function absoluteWindow(
  partial: Partial<SemanticPlanningWindowV5> = {},
): SemanticPlanningWindowV5 {
  return {
    localId: 'pw1',
    kind: 'absolute',
    value: '2026-08-17/2026-08-23',
    start: '2026-08-17',
    end: '2026-08-23',
    sourceText: '8月17日から23日',
    ...partial,
  };
}

function observedInitialInvalidResponse(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'pw1',
      kind: 'absolute',
      value: '8月17日から23日',
      start: null,
      end: null,
      sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 't1',
      existingPublicId: null,
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '英単語を進める',
      study: {
        purpose: 'self_study',
        contextLabel: '英単語',
        components: [{
          localId: 'c1',
          existingPublicId: null,
          parentLocalId: null,
          role: 'material',
          label: '英単語',
          workloads: [{
            localId: 'w1',
            quantityRole: 'target',
            amount: 220,
            unitCode: 'word',
            unitLabel: '語',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英単語220語',
          }],
          durableContextSignals: [],
          sourceText: '英単語220語',
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '英単語220語',
    }],
    relations: [],
    availabilityDeclarations: [{
      localId: 'a1',
      kind: 'unavailable',
      dateExpression: 'weekday:tuesday',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
      recurrenceKind: 'weekly',
      days: ['weekday:tuesday'],
      constraintLevel: 'hard',
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

function focusedRepairResponse(): string {
  return JSON.stringify({
    value: '2026-08-17/2026-08-23',
    start: '2026-08-17',
    end: '2026-08-23',
  });
}

describe('Stable V5 planning window validation boundary', () => {
  it('keeps the canonical runtime vocabulary resolvable', () => {
    for (const expression of [
      ...CANONICAL_RELATIVE_DAY_EXPRESSIONS,
      ...CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
    ]) {
      expect(resolveCanonicalDateExpression({
        expression,
        currentDate: '2026-08-03',
      }).status).toBe('resolved');
    }
  });

  it('does not overwrite an AI-selected relative value from conflicting sourceText', () => {
    const window = {
      localId: 'planning-window-1',
      kind: 'relative_day' as const,
      value: 'today',
      start: null,
      end: null,
      sourceText: '明日',
    };
    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window,
      repairs: [],
    });
  });

  it('canonicalizes only the derived absolute value when start/end are already valid', () => {
    const window = absoluteWindow({ value: '2026-08-17 to 2026-08-23' });
    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window: absoluteWindow(),
      repairs: ['planning-window-value-canonicalized-from-validated-range'],
    });
  });

  it('accepts every canonical relative-day value without reinterpreting sourceText', () => {
    for (const value of CANONICAL_RELATIVE_DAY_EXPRESSIONS) {
      expect(planningWindowCanonicalValueErrors({
        localId: 'planning-window-1',
        kind: 'relative_day',
        value,
        start: null,
        end: null,
        sourceText: '相対日付',
      })).toEqual([]);
    }
  });

  it('rejects a non-canonical value without choosing a replacement meaning', () => {
    expect(planningWindowCanonicalValueErrors({
      localId: 'planning-window-1',
      kind: 'relative_day',
      value: 'next_business_day',
      start: null,
      end: null,
      sourceText: '次の営業日',
    })).toEqual([
      'document.planningWindow.value:canonical-relative-day:next_business_day',
    ]);
  });

  it('accepts only ISO ordered absolute ranges with canonical value', () => {
    expect(planningWindowCanonicalValueErrors(absoluteWindow())).toEqual([]);
    expect(planningWindowCanonicalValueErrors(absoluteWindow({
      value: '8月17日から23日',
      start: '8月17日',
      end: '8月23日',
    }))).toEqual([
      'document.planningWindow:absolute-iso-range-required',
    ]);
    expect(planningWindowCanonicalValueErrors(absoluteWindow({
      start: '2026-08-23',
      end: '2026-08-17',
      value: '2026-08-23/2026-08-17',
    }))).toEqual([
      'document.planningWindow:absolute-range-order',
    ]);
    expect(planningWindowCanonicalValueErrors(absoluteWindow({
      value: '8月17日から23日',
    }))).toEqual([
      'document.planningWindow.value:absolute-canonical-range:2026-08-17/2026-08-23',
    ]);
  });

  it('repairs only a missing absolute range while preserving valid current-turn facts', async () => {
    const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const responses = [observedInitialInvalidResponse(), focusedRepairResponse()];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        calls.push(request);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で、英単語220語を進める予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
      publicStateSummary: {
        calendarContext: {
          currentDate: '2026-08-12',
          timeZone: 'Asia/Tokyo',
        },
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
    });
    expect(result.document?.planningIntent).toBe('create_plan');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    });
    expect(result.document?.tasks).toHaveLength(1);
    expect(result.document?.availabilityDeclarations).toHaveLength(1);

    expect(calls).toHaveLength(2);
    expect(calls[1].responseFormat?.json_schema.name).toBe(
      'weekly_planning_focused_planning_window_repair_v5',
    );
    const repairPayload = JSON.parse(calls[1].messages[1]?.content ?? '{}') as Record<string, unknown>;
    expect(repairPayload).toMatchObject({
      sourceText: '8月17日から23日',
      invalidRepresentation: {
        value: '8月17日から23日',
        start: null,
        end: null,
      },
      calendarContext: {
        currentDate: '2026-08-12',
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(calls[1].messages[1]?.content).not.toContain('英単語220語');
    expect(JSON.stringify(calls[1]).length).toBeLessThan(JSON.stringify(calls[0]).length / 4);
  });

  it('rejects a full-document payload at the focused repair boundary', async () => {
    const destructiveFullDocument = JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'unknown',
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
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    const responses = [observedInitialInvalidResponse(), destructiveFullDocument];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '8月17日から23日で、英単語220語を進める予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toContain(
      'repair:focused-planning-window:invalid-response',
    );
  });
});
