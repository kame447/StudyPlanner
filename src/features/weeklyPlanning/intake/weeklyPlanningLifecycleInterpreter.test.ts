import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningIntakeInterpreter } from './weeklyPlanningInterpreterTypes';
import { createLifecycleAwareWeeklyPlanningInterpreter } from './weeklyPlanningLifecycleInterpreter';

const emptyInterpreter: WeeklyPlanningIntakeInterpreter = {
  async interpretUserTurn() {
    return { candidates: [], parseRejections: [] };
  },
};

function params(userText: string) {
  return {
    userText,
    context: { selectedDate: '2026-07-14' },
    stateSummary: { knownFields: [], confirmedSlots: [] },
  };
}

describe('weeklyPlanningLifecycleInterpreter', () => {
  it('turns explicit approval into a typed assumption decision', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: emptyInterpreter,
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [{
        proposalId: 'proposal-1',
        slot: 'duration',
        targetRef: 'task:0',
        proposedValue: 90,
        proposedUnit: 'minutes',
      }],
      correctionTargets: [],
    });
    const result = await interpreter.interpretUserTurn(params('その仮定で進めて'));
    expect(result.assumptionDecisions).toEqual([{
      type: 'accept_assumption',
      proposalId: 'proposal-1',
      expectedStateRevision: 4,
      sourceText: 'その仮定で進めて',
      confidence: 'high',
    }]);
  });

  it('turns a duration correction into an independent correction envelope', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: emptyInterpreter,
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });
    const result = await interpreter.interpretUserTurn(params('英語は60分にして'));
    expect(result.correctionEnvelopes?.[0]).toMatchObject({
      conversationId: 'conversation-1',
      expectedStateRevision: 4,
      operation: 'replace',
      target: { kind: 'task', taskRef: 'task:0' },
      replacementCommand: {
        type: 'set_study_goal',
        goal: { title: '英語', unit: 'minutes', amount: 60 },
      },
    });
  });

  it('does not guess when multiple proposals or targets match', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: emptyInterpreter,
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [
        { proposalId: 'proposal-1', slot: 'duration', targetRef: 'task:0', proposedValue: 60 },
        { proposalId: 'proposal-2', slot: 'duration', targetRef: 'task:1', proposedValue: 60 },
      ],
      correctionTargets: [
        { kind: 'task', ref: 'task:0', label: '英語' },
        { kind: 'task', ref: 'task:1', label: '英語ワーク' },
      ],
    });
    const result = await interpreter.interpretUserTurn(params('それで進めて。英語は外して'));
    expect(result.assumptionDecisions).toBeUndefined();
    expect(result.correctionEnvelopes).toBeUndefined();
  });
});
