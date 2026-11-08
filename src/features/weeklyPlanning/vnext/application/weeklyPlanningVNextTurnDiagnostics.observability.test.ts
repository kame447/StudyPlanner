import { describe, expect, it } from 'vitest';
import { captureWeeklyPlanningVNextTurnDiagnostics } from './weeklyPlanningVNextTurnDiagnostics';
import type { WeeklyPlanningVNextExperimentalPorts, WeeklyPlanningVNextExperimentalTurn } from './weeklyPlanningVNextExperimentalSession';

// Stage B SB11: the turn's question and failure reach telemetry as closed-list codes, never as the reply or the user's words.
const ports = { client: { createChatCompletion: async () => '{}' }, createRenderer: () => ({ render: async () => ({ status: 'unavailable' }) }) } as unknown as WeeklyPlanningVNextExperimentalPorts;
const metrics = { calls: 1, repairs: 1 };
const turn = (changes: Record<string, unknown>) => ({ outcome: 'applied', graphRevision: 2, readiness: 'needs_resolution', previewBlockedBy: [], errors: [],
  reply: '「数学プリント」の20枚は、全部で何分くらいかかりそうですか？', replySource: 'renderer', preview: null, unplacedOwnerKeys: [], question: null,
  interpretation: { status: 'interpreted', metrics }, ...changes }) as unknown as WeeklyPlanningVNextExperimentalTurn;
const finish = (changes: Record<string, unknown>) => captureWeeklyPlanningVNextTurnDiagnostics(`request-${Math.random()}`, ports).finish(turn(changes));
const question = (code: string, extra: Record<string, unknown> = {}) => ({ code, key: `${code}:owner`, options: [], ...extra });

describe('turn observability dimensions', () => {
  it('names the question the turn ended by asking, by code only', () => {
    const { observability } = finish({ question: question('missing_effort_estimate') });
    expect(observability).toMatchObject({ questionCode: 'missing_effort_estimate', rejectionReason: null });
    expect(JSON.stringify(observability)).not.toContain('数学プリント');
  });

  it('counts no question for an optional invitation, an unknown code, or a turn that asks nothing', () => {
    expect(finish({ question: question('missing_schedulable_work', { optionalInvitation: { message: '追加の作業はありますか？', intent: 'x' } }) }).observability?.questionCode).toBeNull();
    expect(finish({ question: question('a_code_that_does_not_exist') }).observability?.questionCode).toBeNull();
    expect(finish({}).observability?.questionCode).toBeNull();
  });

  it('gives a failed turn a typed reason: the provider reason, a rejection, or "other" for anything else', () => {
    const failedReading = (reason: string) => ({ status: 'failed', reason, errors: [], metrics });
    expect(finish({ outcome: 'interpretation_failed', interpretation: failedReading('rejected_after_repair') }).observability?.rejectionReason).toBe('rejected_after_repair');
    expect(finish({ outcome: 'interpretation_failed', interpretation: failedReading('provider_error') }).observability?.rejectionReason).toBe('provider_error');
    expect(finish({ outcome: 'rejected' }).observability?.rejectionReason).toBe('rejected');
    expect(finish({ outcome: 'checkpoint_unreadable', interpretation: null }).observability?.rejectionReason).toBe('checkpoint_unreadable');
    expect(finish({ outcome: 'interpretation_failed', interpretation: null }).observability?.rejectionReason).toBe('other');
    expect(finish({ outcome: 'interpretation_failed', interpretation: failedReading('a free-text reason with the user words') }).observability?.rejectionReason).toBe('other');
  });

  it('gives a turn that did not fail no reason', () => {
    expect(finish({ outcome: 'applied' }).observability?.rejectionReason).toBeNull();
    expect(finish({ outcome: 'noop' }).observability?.rejectionReason).toBeNull();
  });
});
