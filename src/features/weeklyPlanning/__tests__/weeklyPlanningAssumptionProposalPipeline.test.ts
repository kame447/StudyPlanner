import { describe, expect, it } from 'vitest';
import {
  runWeeklyPlanningIntakePipelineWithInterpreter,
} from '../pipeline/weeklyPlanningIntakePipeline';
import type {
  AssumptionProposalCanonicalizationContext,
  PendingAssumptionProposalDraft,
} from '../intake/weeklyPlanningAssumptionProposals';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';

const pipelineDefaults = {
  planningStartDate: '2026-07-13',
  planningDayCount: 7,
  sessionPolicy: {
    firstDayStartTime: '19:00',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    breakMinutes: 0,
  },
};

const draft: PendingAssumptionProposalDraft = {
  slot: 'duration',
  targetRef: 'task-1',
  proposedValue: 30,
  proposedUnit: 'minutes',
  reasonCode: 'missing_duration',
  sourceFactRefs: [],
};

const proposalContext: AssumptionProposalCanonicalizationContext = {
  authorization: { userId: 'user-1' },
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  stateRevision: 1,
  validTargetRefs: ['task-1'],
  currentPublicSourceFacts: [],
  allowedPolicyIds: [],
  existingProposalRecords: [],
};

function interpreter(result: { assumptionProposalDrafts?: unknown[] }): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn() {
      return {
        candidates: [],
        parseRejections: [],
        ...result,
      };
    },
  };
}

describe('weekly planning assumption proposal pipeline boundary', () => {
  it('canonicalizes drafts separately and hands the pending proposal ref to the caller', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...pipelineDefaults,
      userText: 'この課題は30分くらい',
      interpreter: interpreter({ assumptionProposalDrafts: [draft] }),
      assumptionProposalContext: proposalContext,
    });

    expect(output.state.tasks).toEqual([]);
    expect(output.assumptionProposalState?.records).toHaveLength(1);
    expect(output.assumptionProposalState?.records[0]).toMatchObject({
      status: 'pending',
      conversationId: 'conversation-1',
      createdAtTurnId: 'turn-1',
      createdFromStateRevision: 1,
    });
    expect(output.assumptionProposalRefs).toEqual([
      output.assumptionProposalState?.records[0].proposalId,
    ]);
    expect(output.assumptionProposalDiagnostics?.rejected).toEqual([]);
  });

  it('keeps production behavior unchanged when canonicalization context is omitted', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...pipelineDefaults,
      userText: 'この課題は30分くらい',
      interpreter: interpreter({ assumptionProposalDrafts: [draft] }),
    });

    expect(output.assumptionProposalState).toBeUndefined();
    expect(output.assumptionProposalRefs).toBeUndefined();
    expect(output.assumptionProposalDiagnostics).toBeUndefined();
  });

  it('preserves session-local pending records when the provider fails', async () => {
    const first = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...pipelineDefaults,
      userText: 'この課題は30分くらい',
      interpreter: interpreter({ assumptionProposalDrafts: [draft] }),
      assumptionProposalContext: proposalContext,
    });
    const second = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...pipelineDefaults,
      previousState: first.state,
      previousAssumptionProposalState: first.assumptionProposalState,
      userText: 'あとで続ける',
      interpreter: {
        async interpretUserTurn() {
          throw new Error('provider unavailable');
        },
      },
      assumptionProposalContext: {
        ...proposalContext,
        turnId: 'turn-2',
        existingProposalRecords: first.assumptionProposalState?.records ?? [],
      },
    });

    expect(second.assumptionProposalState?.records).toEqual(first.assumptionProposalState?.records);
    expect(second.state.tasks).toEqual(first.state.tasks);
  });
});
