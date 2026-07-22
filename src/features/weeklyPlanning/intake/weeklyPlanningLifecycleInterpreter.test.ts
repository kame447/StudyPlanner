import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningIntakeInterpreter } from './weeklyPlanningInterpreterTypes';
import { createLifecycleAwareWeeklyPlanningInterpreter } from './weeklyPlanningLifecycleInterpreter';

function params(userText: string) {
  return {
    userText,
    context: { selectedDate: '2026-07-14' },
    stateSummary: { knownFields: [], confirmedSlots: [] },
  };
}

describe('weeklyPlanningLifecycleInterpreter', () => {
  it('does not synthesize lifecycle meaning from raw text when the AI returns none', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: {
        async interpretUserTurn() {
          return { candidates: [], parseRejections: [] };
        },
      },
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [{
        proposalId: 'proposal-1',
        slot: 'duration',
        targetRef: 'task:0',
        proposedValue: 90,
        proposedUnit: 'minutes',
      }],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });

    const result = await interpreter.interpretUserTurn(params('その仮定で進めて。英語は外して'));

    expect(result.assumptionDecisions).toBeUndefined();
    expect(result.correctionEnvelopes).toBeUndefined();
  });

  it('injects trusted revision metadata into an AI assumption decision draft', async () => {
    const base: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        return {
          candidates: [],
          parseRejections: [],
          assumptionDecisions: [{
            type: 'accept_assumption',
            proposalId: 'proposal-1',
            confidence: 'high',
          }],
        };
      },
    };
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: base,
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [{
        proposalId: 'proposal-1',
        slot: 'duration',
        targetRef: 'task:0',
        proposedValue: 90,
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

  it('resolves a high-confidence AI correction draft only against a public correction target', async () => {
    const base: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        return {
          candidates: [],
          parseRejections: [],
          correctionEnvelopes: [{
            operation: 'remove',
            targetKind: 'task',
            targetRef: 'task:0',
            confidence: 'high',
          }],
        };
      },
    };
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: base,
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });

    const result = await interpreter.interpretUserTurn(params('英語は外して'));

    expect(result.correctionEnvelopes).toEqual([{
      correctionId: 'conversation-1:correction:4:0',
      conversationId: 'conversation-1',
      expectedStateRevision: 4,
      operation: 'remove',
      target: { kind: 'task', taskRef: 'task:0' },
      sourceText: '英語は外して',
    }]);
  });

  it('drops a destructive correction draft unless confidence is high', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: {
        async interpretUserTurn() {
          return {
            candidates: [],
            parseRejections: [],
            correctionEnvelopes: [{
              operation: 'remove',
              targetKind: 'task',
              targetRef: 'task:0',
              confidence: 'medium',
            }],
          };
        },
      },
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });

    const result = await interpreter.interpretUserTurn(params('英語は外してもいいかも'));

    expect(result.correctionEnvelopes).toBeUndefined();
  });

  it('accepts a grounded replacement command after releasing only the corrected slot', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: {
        async interpretUserTurn() {
          return {
            candidates: [],
            parseRejections: [],
            correctionEnvelopes: [{
              operation: 'replace',
              targetKind: 'task',
              targetRef: 'task:0',
              confidence: 'high',
              replacementCommand: {
                type: 'set_study_goal',
                goal: { title: '英語', subject: '英語', unit: 'minutes', amount: 60 },
                sourceText: '英語の勉強は60分にして',
                confidence: 'high',
              },
            }],
          };
        },
      },
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });

    const result = await interpreter.interpretUserTurn(params('英語の勉強は60分にして'));

    expect(result.correctionEnvelopes?.[0]).toMatchObject({
      operation: 'replace',
      target: { kind: 'task', taskRef: 'task:0' },
      replacementCommand: {
        type: 'set_study_goal',
        goal: { title: '英語', subject: '英語', unit: 'minutes', amount: 60 },
      },
    });
  });

  it('does not re-parse raw text to second-guess a structurally valid AI correction', async () => {
    const interpreter = createLifecycleAwareWeeklyPlanningInterpreter({
      interpreter: {
        async interpretUserTurn() {
          return {
            candidates: [],
            parseRejections: [],
            correctionEnvelopes: [{
              operation: 'replace',
              targetKind: 'task',
              targetRef: 'task:0',
              confidence: 'high',
              replacementCommand: {
                type: 'set_study_goal',
                goal: { title: '英語', subject: '英語', unit: 'minutes', amount: 120 },
                sourceText: '英語の勉強は60分にして',
                confidence: 'high',
              },
            }],
          };
        },
      },
      conversationId: 'conversation-1',
      currentStateRevision: 4,
      pendingAssumptions: [],
      correctionTargets: [{ kind: 'task', ref: 'task:0', label: '英語' }],
    });

    const result = await interpreter.interpretUserTurn(params('英語の勉強は60分にして'));

    expect(result.correctionEnvelopes?.[0]).toMatchObject({
      replacementCommand: {
        type: 'set_study_goal',
        goal: { amount: 120, unit: 'minutes' },
      },
    });
  });
});
