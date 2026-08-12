import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  applyFocusedPlanningWindowRepairV5,
  createFocusedPlanningWindowRepairMessagesV5,
  focusedPlanningWindowRepairEligibleV5,
  parseFocusedPlanningWindowRepairDecisionV5,
} from './weeklyPlanningFocusedPlanningWindowRepairV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
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
        purpose: 'practice',
        contextLabel: '英単語',
        components: [],
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
  };
}

describe('Stable V5 focused planning-window repair', () => {
  it('routes only absolute planning-window representation failures', () => {
    expect(focusedPlanningWindowRepairEligibleV5({
      userText: '8月17日から23日で予定を作りたい',
      invalidDocument: document(),
      validationErrors: ['document.planningWindow:absolute-range'],
    })).toBe(true);

    expect(focusedPlanningWindowRepairEligibleV5({
      userText: '8月17日から23日で予定を作りたい',
      invalidDocument: document(),
      validationErrors: [
        'availabilityDeclarations[a1].days:canonical-weekday-required:tuesday',
      ],
    })).toBe(false);
  });

  it('sends only the invalid planning-window representation and compact calendar context', () => {
    const messages = createFocusedPlanningWindowRepairMessagesV5({
      userText: '8月17日から23日で予定を作りたい',
      invalidDocument: document(),
      validationErrors: ['document.planningWindow:absolute-range'],
      calendarContext: {
        currentDate: '2026-08-12',
        timeZone: 'Asia/Tokyo',
      },
    });

    const payload = JSON.parse(messages[1]?.content ?? '{}') as Record<string, unknown>;
    expect(payload).toEqual({
      currentUserText: '8月17日から23日で予定を作りたい',
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
    expect(messages[1]?.content).not.toContain('英単語を進める');
    expect(messages[1]?.content).not.toContain('18:00');
  });

  it('merges only value/start/end and preserves all unrelated semantic facts', () => {
    const initial = document();
    const decision = parseFocusedPlanningWindowRepairDecisionV5(JSON.stringify({
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
    }));
    if (!decision) throw new Error('repair decision missing');

    const repaired = applyFocusedPlanningWindowRepairV5({
      document: initial,
      decision,
    });

    expect(repaired.planningWindow).toEqual({
      ...initial.planningWindow,
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
    });
    expect(repaired.tasks).toEqual(initial.tasks);
    expect(repaired.availabilityDeclarations).toEqual(initial.availabilityDeclarations);
    expect(repaired.planningIntent).toBe(initial.planningIntent);
  });
});
