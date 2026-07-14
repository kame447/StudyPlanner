import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import {
  applyCorrectionEnvelopes,
  type CorrectionEnvelope,
} from './weeklyPlanningAssumptionLifecycle';
import {
  createWeeklyDraftApprovalOperation,
  executeWeeklyDraftApproval,
} from './weeklyPlanningApproval';
import type { WeeklyPreviewMetadata } from './weeklyPlanningApprovalTypes';
import { resolveRelativeConstraints } from './weeklyPlanningRelativeConstraints';

const PROPERTY_SEED = 20260714;

function pendingRecord(index: number): AssumptionProposalRecord {
  return {
    proposalId: `proposal-${index}`,
    conversationId: 'conversation-property',
    slot: 'duration',
    targetRef: `task:${index}`,
    proposedValue: 60,
    proposedUnit: 'minutes',
    reasonCode: 'missing_duration',
    sourceFactRefs: [`task:${index}`],
    createdAtTurnId: 'turn-1',
    createdFromStateRevision: 2,
    status: 'pending',
  };
}

describe('weekly planning dialogue stack properties', () => {
  it('task removal corrections are order independent for distinct stable source targets', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 4 }),
      (indexes) => {
        const state = {
          ...createInitialPlanningIntakeState(),
          tasks: Array.from({ length: 5 }, (_, index) => ({
            title: `task-${index}`,
            unit: 'hours' as const,
            amount: 1,
            rawText: `task-${index}`,
            requiresTimeEstimate: false,
            source: 'command' as const,
          })),
          sourceTurns: ['a', 'b'],
        };
        const envelopes = indexes.map((index): CorrectionEnvelope => ({
          correctionId: `correction-${index}`,
          conversationId: 'conversation-property',
          expectedStateRevision: 2,
          operation: 'remove',
          target: { kind: 'task', taskRef: `task:${index}` },
          sourceText: `task-${index}を外す`,
        }));
        const apply = (items: CorrectionEnvelope[]) => applyCorrectionEnvelopes({
          state,
          records: Array.from({ length: 5 }, (_, index) => pendingRecord(index)),
          envelopes: items,
          context: {
            conversationId: 'conversation-property',
            turnId: 'turn-3',
            currentStateRevision: 2,
          },
        });
        const forward = apply(envelopes);
        const reverse = apply([...envelopes].reverse());
        expect(forward.state.tasks.map((task) => task.title).sort()).toEqual(
          reverse.state.tasks.map((task) => task.title).sort(),
        );
      },
    ), { seed: PROPERTY_SEED, numRuns: 40 });
  });

  it('duplicate approval never performs a second save for the same source block', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 20 }),
      async (suffix) => {
        const id = `block-${suffix}`;
        const metadata: WeeklyPreviewMetadata = {
          previewId: `preview-${suffix}`,
          stateRevision: 1,
          assumptionDependencies: [],
          approvalEligibility: 'eligible',
          stale: false,
          authorizedUserId: 'user-1',
        };
        const block = {
          id,
          userId: 'user-1',
          date: '2026-07-14',
          startTime: '10:00',
          endTime: '11:00',
          title: 'task',
          subject: 'task',
          type: 'study' as const,
          label: 'task',
          source: 'ai' as const,
          status: 'draft' as const,
          userEdited: false,
          createdAt: '2026-07-14T00:00:00Z',
          updatedAt: '2026-07-14T00:00:00Z',
        };
        const operation = createWeeklyDraftApprovalOperation({
          userId: 'user-1',
          metadata,
          blocks: [block],
          now: '2026-07-14T00:00:00Z',
        });
        let saves = 0;
        const first = await executeWeeklyDraftApproval({
          operation,
          blocks: [block],
          dependencies: {
            async findExistingPlanId() { return undefined; },
            async saveBlock() { saves += 1; return { planId: 'plan-1' }; },
            now: () => '2026-07-14T00:01:00Z',
          },
        });
        await executeWeeklyDraftApproval({
          operation: first,
          blocks: [block],
          dependencies: {
            async findExistingPlanId() { return 'plan-1'; },
            async saveBlock() { saves += 1; return { planId: 'plan-2' }; },
            now: () => '2026-07-14T00:02:00Z',
          },
        });
        expect(saves).toBe(1);
      },
    ), { seed: PROPERTY_SEED, numRuns: 20 });
  });

  it('relative resolution never produces an interval outside the day', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 120 }),
      fc.integer({ min: 1, max: 180 }),
      (offsetMinutes, durationMinutes) => {
        const result = resolveRelativeConstraints({
          constraints: [{
            relationId: 'relation-1',
            anchorFactRef: 'anchor-1',
            relation: 'after',
            offsetMinutes,
            durationMinutes,
            sourceFactRefs: ['fact-1'],
            stateRevision: 1,
            confidence: 'high',
          }],
          anchors: [{
            factRef: 'anchor-1',
            eventId: 'event-1',
            date: '2026-07-14',
            startTime: '18:00',
            endTime: '22:00',
            visibility: 'public',
            stateRevision: 1,
            sourceFactRefs: ['anchor-1'],
          }],
          currentStateRevision: 1,
        });
        result.resolved.forEach((resolved) => {
          expect(resolved.startTime).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
          expect(resolved.endTime).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
          expect(resolved.startTime < resolved.endTime).toBe(true);
        });
      },
    ), { seed: PROPERTY_SEED, numRuns: 40 });
  });
});
