import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionalAllocationContextV5 } from './weeklyPlanningProvisionalAllocationRouteV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';

function input() {
  return { traceRequestId: 'allocation-recovery', userText: '全体の時間はわからないので今ある空き時間で仮に予定を決めて',
    recentConversation: [{ role: 'user' as const, content: '完成までの時間はわからない' }],
    publicStateSummary: { graphRevision: 10, pendingQuestion: { questionCode: 'semantic_uncertainty', intent: null as string | null, graphRevision: 10, targetFactId: 'need' },
      tasks: [{ publicId: 'task', category: 'study', title: '研究' }], components: [], workloads: [],
      uncertainties: [{ publicId: 'need', targetPublicId: 'task', field: 'total_duration', reason: '見積もり不明' }] } };
}
const generic = { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
  conversationActs: [], uncertainties: [], corrections: [], decisions: [] };
afterEach(() => resetWeeklyPlanningStableV5DebugTraceForTest());

describe('allocation permission while a progress/effort need is pending', () => {
  it('recovers a persisted unknown estimate via the real normalizer without inventing an effort fact', async () => {
    const client = { createChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({ decision: 'provisional_timebox' })) };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(input());
    expect(result).toMatchObject({ status: 'accepted', contextualDirective: { kind: 'provisional_timebox' },
      document: { tasks: [], decisions: [], uncertainties: [] } });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    const request = client.createChatCompletion.mock.calls[0][0];
    expect(request).not.toHaveProperty('decisionContext');
    expect(JSON.stringify(request)).toContain('見積もり不明');
    expect(takeWeeklyPlanningStableV5DebugTrace('allocation-recovery').some(e => e.stage === 'semantic_provider_request')).toBe(true);
  });
  it.each(['material_identity', 'quantityRole', 'deadline', 'work_breakdown'])('does not bypass the unrelated need %s', field => {
    const value = input(); value.publicStateSummary.uncertainties[0].field = field;
    expect(provisionalAllocationContextV5(value)).toBeNull();
  });
  it('does not turn an unavailable answer into permission when the classifier returns fallback', async () => {
    const value = input(); value.userText = 'わからない';
    const client = { createChatCompletion: vi.fn().mockResolvedValueOnce('{"decision":"fallback"}').mockResolvedValue(JSON.stringify(generic)) };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(value);
    expect(result.contextualDirective).toBeUndefined();
    expect(result.document?.tasks).toEqual([]);
  });
  it('does not accept a model response against a changed question revision', async () => {
    const value = input();
    const client = { createChatCompletion: vi.fn(async () => {
      value.publicStateSummary.graphRevision += 1;
      return '{"decision":"provisional_timebox"}';
    }) };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(value);
    expect(result.status).toBe('rejected'); expect(result.contextualDirective).toBeUndefined();
    expect(result.diagnostics.validationErrors).toContain('provisional-allocation:stale-binding');
  });
  it('requires unique current target identity before dispatch', () => {
    const value = input(); value.publicStateSummary.tasks.push(value.publicStateSummary.tasks[0]);
    expect(provisionalAllocationContextV5(value)).toBeNull();
  });
  it('can classify an explicit allocation request for an open-ended task without a percentage workload', async () => {
    const value = input(); value.publicStateSummary.pendingQuestion = { questionCode: 'missing_schedulable_work', intent: 'open_ended_session', targetFactId: 'task', graphRevision: 10 };
    const client = { createChatCompletion: vi.fn().mockResolvedValue('{"decision":"provisional_timebox"}') };
    expect((await createWeeklyPlanningSemanticNormalizerV5(client).normalize(value)).contextualDirective?.kind).toBe('provisional_timebox');
  });
});
