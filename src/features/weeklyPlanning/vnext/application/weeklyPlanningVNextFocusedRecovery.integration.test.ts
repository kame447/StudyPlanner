import { describe, expect, it } from 'vitest';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';

// Astra re-audit at a40681b2: the recovery renderer may run only when no provider dispatch of the interpretation
// failed ("no earlier provider failure"). A failed FOCUSED request followed by a native fallback that is rejected
// twice used to look like a plain structured rejection to the gate, because the fallback dropped the earlier failure.
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: 'audit', conversationId: 'audit-conversation', weekStartDate: '2026-11-02', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };

describe.each([['focused provider failure', true, 0], ['successful focused abstention (control)', false, 1]] as const)('%s then a rejected native reading', (_name, focusedFails, expectedRecoveryRenders) => {
  it(`makes ${expectedRecoveryRenders} recovery renderer request and persists nothing`, async () => {
    const stages: string[] = [];
    let raw: string | null = null;
    const client = { async createChatCompletion(request: { purpose?: string; decisionContext?: { purpose?: string } }) {
      const stage = request.decisionContext?.purpose === 'focused_contextual_answer_v2' ? 'focused' : request.purpose ?? 'none';
      stages.push(stage);
      if (stage === 'focused') {
        if (focusedFails) throw new TypeError('synthetic focused transport outage');
        return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      }
      if (stage === 'weekly_planning_semantic_normalizer') return '{}';
      throw new Error('synthetic renderer unavailable');
    } };
    const seedReading = async () => ({ status: 'interpreted' as const, planningIntent: 'discuss' as const, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
      delta: { add: [{ kind: 'task' as const, localId: 't', category: 'study' as const, title: '数学' },
        { kind: 'workload' as const, localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining' as const, amount: 8, unitCode: 'page' as const,
          unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }], patch: [], remove: [], relate: [], defer: [] } });
    const ports: WeeklyPlanningVNextExperimentalPorts = { client: client as never, interpret: seedReading,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '数学の残り8ページには何分かかりますか？', rawResponse: '' }) }),
      checkpoint: { read: () => raw, write: (value: string) => { raw = value; } }, legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { throw new Error('no approval'); } },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('no save'); } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => '2026-11-02T00:00:00.000Z' };
    const seed = await submitWeeklyPlanningVNextExperimentalTurn({ scope, turnId: 'seed', userText: '数学が残り8ページあります', shownRevision: null, ports });
    expect(seed.question?.code).toBe('missing_effort_estimate');
    const before = raw;
    // The production composition: focused route first, then the native reading (here always invalid), the real renderer core.
    ports.interpret = createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: { policy: VNEXT_OPTION_CHOICE_POLICY,
      choose: async () => { throw new Error('a missing-effort question must bypass the closed choice'); } } });
    ports.createRenderer = options => createWeeklyPlanningStableV5DialogueRendererCore(client as never, options);
    stages.length = 0;
    const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, turnId: 'answer', userText: '40分くらい', shownRevision: seed.graphRevision, ports });
    expect(stages[0]).toBe('focused');
    expect(stages.filter(stage => stage === 'weekly_planning_renderer')).toHaveLength(expectedRecoveryRenders);
    expect(result.outcome).toBe('interpretation_failed');
    if (!focusedFails) expect(stages.filter(stage => stage === 'weekly_planning_renderer')).not.toHaveLength(0);
    else {
      expect(result.interpretation).toMatchObject({ status: 'failed', reason: 'rejected_after_repair', metrics: { providerFailures: 1 } });
      expect(result.replySource).toBe('system');
    }
    // The failed turn changes nothing accepted: the question is still the one asked.
    expect(JSON.parse(raw!).vnext.state).toEqual(JSON.parse(before!).vnext.state);
  });
});
