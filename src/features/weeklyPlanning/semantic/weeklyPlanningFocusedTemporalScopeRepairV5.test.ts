import { describe, expect, it } from 'vitest';
import type {
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  applyFocusedTemporalScopeRepairV5,
  createFocusedTemporalScopeRepairMessagesV5,
  parseFocusedTemporalScopeRepairDecisionV5,
  readFocusedTemporalScopeRepairCandidateV5,
} from './weeklyPlanningFocusedTemporalScopeRepairV5';

function invalidResponse(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 't1',
      title: '数学の問題を進める',
      temporalConstraints: [{
        localId: 'tc1',
        targetLocalId: 't1',
        kind: 'excluded_date',
        constraintLevel: 'hard',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
        precision: 'exact',
        sourceText: '火曜日の18時から20時は予定があるので避けてください',
      }],
    }],
    availabilityDeclarations: [],
    uncertainties: [],
  });
}

function realApiShapeWithOneTemporalScopeError(): string {
  return JSON.stringify({
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
    }, {
      localId: 't2',
      existingPublicId: null,
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '数学の問題を進める',
      study: {
        purpose: 'practice',
        contextLabel: '数学',
        components: [{
          localId: 'c2',
          existingPublicId: null,
          parentLocalId: null,
          role: 'subject',
          label: '数学',
          workloads: [{
            localId: 'w2',
            quantityRole: 'target',
            amount: 40,
            unitCode: 'problem',
            unitLabel: '問',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '数学の問題40問',
          }],
          durableContextSignals: [],
          sourceText: '数学の問題40問',
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'tc1',
        targetLocalId: 't2',
        kind: 'excluded_date',
        constraintLevel: 'hard',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
        precision: 'exact',
        sourceText: '火曜日の18時から20時は予定があるので避けてください',
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '数学の問題40問',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

const errors = [
  'document.tasks[0].temporalConstraints[0]:date-rule-cannot-have-clock',
];

describe('Stable V5 focused temporal-scope repair', () => {
  it('extracts only the exact invalid temporal fact selected by validation', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });

    expect(candidate).toMatchObject({
      taskIndex: 0,
      constraintIndex: 0,
      taskTitle: '数学の問題を進める',
      taskLocalId: 't1',
      constraintLocalId: 'tc1',
      dateExpression: 'weekday:tuesday',
      startTime: '18:00',
      endTime: '20:00',
    });
  });

  it('sends only source evidence, current attachment and interpreted time', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const messages = createFocusedTemporalScopeRepairMessagesV5(candidate);
    const payload = JSON.parse(messages[1]?.content ?? '{}') as Record<string, unknown>;

    expect(payload).toEqual({
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
      currentAttachedTask: '数学の問題を進める',
      interpretedTime: {
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
      },
    });
    expect(messages[1]?.content).not.toContain('英単語');
  });

  it('moves a confirmed plan-wide busy interval to availability without rewriting the task', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const repairedRaw = applyFocusedTemporalScopeRepairV5({
      rawResponse: invalidResponse(),
      candidate,
      decision: { decision: 'plan_unavailable' },
    });
    if (!repairedRaw) throw new Error('repair failed');
    const repaired = JSON.parse(repairedRaw) as any;

    expect(repaired.tasks[0].title).toBe('数学の問題を進める');
    expect(repaired.tasks[0].temporalConstraints).toEqual([]);
    expect(repaired.availabilityDeclarations).toEqual([{
      localId: 'tc1__availability',
      kind: 'unavailable',
      dateExpression: 'weekday:tuesday',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
      recurrenceKind: 'weekly',
      days: ['weekday:tuesday'],
      constraintLevel: 'hard',
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
    }]);
  });

  it('turns non-confirmed scope into an uncertainty instead of guessing', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const repairedRaw = applyFocusedTemporalScopeRepairV5({
      rawResponse: invalidResponse(),
      candidate,
      decision: { decision: 'uncertain' },
    });
    if (!repairedRaw) throw new Error('repair failed');
    const repaired = JSON.parse(repairedRaw) as any;

    expect(repaired.tasks[0].temporalConstraints).toEqual([]);
    expect(repaired.availabilityDeclarations).toEqual([]);
    expect(repaired.uncertainties).toEqual([
      expect.objectContaining({
        targetLocalId: 't1',
        field: 'temporal_scope',
      }),
    ]);
  });

  it('accepts only the two focused decisions and no extra keys', () => {
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"plan_unavailable"}'))
      .toEqual({ decision: 'plan_unavailable' });
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"uncertain"}'))
      .toEqual({ decision: 'uncertain' });
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"plan_unavailable","tasks":[]}'))
      .toBeNull();
  });

  it('handles the observed real-API scope error without full-document repair', async () => {
    const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const responses = [
      realApiShapeWithOneTemporalScopeError(),
      JSON.stringify({ decision: 'plan_unavailable' }),
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
      userText: '8月17日から23日で、英単語220語と数学の問題40問を進める予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
      publicStateSummary: {
        calendarContext: {
          currentDate: '2026-08-12',
          timeZone: 'Asia/Tokyo',
        },
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningIntent).toBe('create_plan');
    expect(result.document?.tasks).toHaveLength(2);
    expect(result.document?.tasks[1]?.temporalConstraints).toEqual([]);
    expect(result.document?.availabilityDeclarations).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        dateExpression: 'weekday:tuesday',
        startTime: '18:00',
        endTime: '20:00',
      }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1].responseFormat?.json_schema.name).toBe(
      'weekly_planning_focused_temporal_scope_repair_v5',
    );
    expect(JSON.stringify(calls[1]).length).toBeLessThan(
      JSON.stringify(calls[0]).length / 8,
    );
  });
});
