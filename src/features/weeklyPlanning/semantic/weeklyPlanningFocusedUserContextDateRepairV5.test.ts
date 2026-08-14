import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS,
  applyFocusedUserContextDateRepairV5,
  createFocusedUserContextDateRepairMessagesV5,
  parseFocusedUserContextDateRepairDecisionV5,
  readFocusedUserContextDateRepairCandidateV5,
} from './weeklyPlanningFocusedUserContextDateRepairV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [{
      localId: 'event-1',
      kind: 'goal_event',
      label: '共通テスト模試',
      value: '模試が実施される',
      dateExpression: '2週間後',
      sourceText: '2週間後に共通テスト模試もあるので',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 focused user-context date repair', () => {
  it('routes only the exact unsupported user-context date error', () => {
    const candidate = readFocusedUserContextDateRepairCandidateV5({
      document: document(),
      validationErrors: [
        'document.userContextFacts[0].dateExpression:unsupported-expression',
      ],
    });

    expect(candidate).toMatchObject({
      factIndex: 0,
      label: '共通テスト模試',
      invalidDateExpression: '2週間後',
    });
    expect(readFocusedUserContextDateRepairCandidateV5({
      document: document(),
      validationErrors: ['document.tasks[0]:invalid'],
    })).toBeNull();
  });

  it('asks only for the canonical date and patches only dateExpression', () => {
    const candidate = readFocusedUserContextDateRepairCandidateV5({
      document: document(),
      validationErrors: [
        'document.userContextFacts[0].dateExpression:unsupported-expression',
      ],
    });
    if (!candidate) throw new Error('candidate missing');

    const messages = createFocusedUserContextDateRepairMessagesV5({
      candidate,
      calendarContext: { currentDate: '2026-08-14', timeZone: 'Asia/Tokyo' },
    });
    expect(messages[0]?.content).toContain('only the already-interpreted relative event date');
    expect(FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS).toBe(40);

    const decision = parseFocusedUserContextDateRepairDecisionV5(
      JSON.stringify({ dateExpression: '2026-08-28' }),
    );
    expect(decision).toEqual({ dateExpression: '2026-08-28' });
    if (!decision) throw new Error('decision missing');

    const repaired = applyFocusedUserContextDateRepairV5({
      document: document(),
      candidate,
      decision,
    });
    expect(repaired?.userContextFacts?.[0]).toEqual({
      localId: 'event-1',
      kind: 'goal_event',
      label: '共通テスト模試',
      value: '模試が実施される',
      dateExpression: '2026-08-28',
      sourceText: '2週間後に共通テスト模試もあるので',
    });
    expect(repaired?.tasks).toEqual([]);
    expect(repaired?.corrections).toEqual([]);
  });
});
