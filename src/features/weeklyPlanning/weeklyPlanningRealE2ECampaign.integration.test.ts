import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestWeeklyPlanningTurnMeasurement } from './application/weeklyPlanningTurnMeasurement';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedConversation, type ScriptedConversationTurn, type ScriptedProviderCall } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { CAMPAIGN, CAMPAIGN_MATERIALS, campaignProviderReply, type CampaignRequest, type CampaignScenario } from './testUtils/weeklyPlanningRealE2ECampaignFixture';
import { schedulingDocument, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

vi.setConfig({ testTimeout: 30_000 });
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let scenario: CampaignScenario;
let clock: number;
let override: (call: ScriptedProviderCall) => string | undefined;
beforeEach(() => {
  resetScriptedConversationRuntime();
  clock = 0;
  override = () => undefined;
  provider = installScriptedWeeklyPlanningProvider(call => {
    clock += call.kind === 'renderer' ? 2_000 : 5_000;
    return override(call) ?? campaignProviderReply(scenario, call.request as unknown as CampaignRequest);
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

async function submit(conversation: ScriptedConversation, text: string, expected: string[]) {
  const turn = await conversation.submit(text);
  expect(turn.result?.failure, JSON.stringify(turn.debugTrace.filter(event => event.stage === 'semantic_validation_result'))).toBeUndefined();
  expect(turn.calls.map(call => call.kind)).toEqual(expected);
  expect(turn.result?.responseSource, JSON.stringify(turn.result?.dialogueRendererTrace)).toBe('ai');
  const semantic = expected.filter(kind => kind !== 'renderer').length;
  const renderer = expected.length - semantic;
  expect(getLatestWeeklyPlanningTurnMeasurement()).toMatchObject({
    architecture: 'interaction_v1', status: 'committed', failureCode: null,
    elapsedMs: semantic * 5_000 + renderer * 2_000,
    aiDispatches: { total: expected.length, semantic, renderer, enforced: true, refused: 0 },
  });
  expect(conversation.getState().pendingApproval).toBeUndefined();
  return turn;
}
function start(value: CampaignScenario) {
  scenario = value;
  return createScriptedConversation({ provider, architecture: 'interaction_v1', measurementClock: () => clock, studyMaterials: CAMPAIGN_MATERIALS });
}
const normal = ['semantic_generic', 'renderer'];
function candidates(conversation: ScriptedConversation) { return conversation.getState().previewCandidates ?? []; }
function latestAssistantText(conversation: ScriptedConversation) {
  const messages = conversation.getState().messages.filter(message => message.role === 'assistant');
  return messages[messages.length - 1]?.content ?? '';
}
function expectNextWeek(conversation: ScriptedConversation, end = '2026-10-18') {
  expect(candidates(conversation).length).toBeGreaterThan(0);
  expect(candidates(conversation).every(entry => entry.date >= '2026-10-12' && entry.date <= end)).toBe(true);
}
function activeWorkloads(conversation: ScriptedConversation) {
  const graph = conversation.graph()!;
  const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  return graph.workloads.filter(entry => active.has(entry.id));
}
function rendererDecision(turn: ScriptedConversationTurn) { return turn.calls.find(call => call.kind === 'renderer')?.payload?.applicationDecision; }

describe('real E2E A–G: full application turns with scripted provider wire responses', () => {
  it('A: a complete request needs one semantic and one renderer call, preserving next week and after 20:00', async () => {
    const conversation = start('A');
    await submit(conversation, CAMPAIGN.A[0], normal);
    expectNextWeek(conversation, '2026-10-16');
    expect(candidates(conversation).every(entry => entry.startTime >= '20:00')).toBe(true);
    expect(activeWorkloads(conversation).map(entry => entry.amount)).toEqual([20]);
  });

  it('C: correction with an echoed committed rate avoids repair and replaces 30 pages with 20 through date confirmation', async () => {
    const conversation = start('C');
    await submit(conversation, CAMPAIGN.C[0], normal);
    const old = structuredClone(candidates(conversation));
    await submit(conversation, CAMPAIGN.C[1], normal);
    expect(candidates(conversation)).not.toEqual(old);
    expect(activeWorkloads(conversation).map(entry => entry.amount)).toEqual([20]);
    await submit(conversation, CAMPAIGN.C[2], normal);
    expectNextWeek(conversation, '2026-10-16');
    expect(activeWorkloads(conversation).map(entry => entry.amount)).toEqual([20]);
    expect(conversation.getState().intakeState?.questions).toEqual([]);
  });

  it('D: a focused pace answer followed by split/evening changes updates both real preview and renderer decision', async () => {
    const conversation = start('D');
    await submit(conversation, CAMPAIGN.D[0], normal);
    await submit(conversation, CAMPAIGN.D[1], ['semantic_focused_contextual', 'renderer']);
    const old = structuredClone(candidates(conversation));
    const final = await submit(conversation, CAMPAIGN.D[2], normal);
    expect(candidates(conversation)).not.toEqual(old);
    expectNextWeek(conversation);
    expect(candidates(conversation).filter(entry => entry.title.includes('卒業研究ノート')).map(entry => entry.durationMinutes)).toEqual([60, 60]);
    expect(candidates(conversation).every(entry => entry.startTime >= '18:00')).toBe(true);
    expect(rendererDecision(final)).toMatchObject({ actionKind: 'preview_ready', previewCount: 3 });
  });

  // NOTE (P3 S1): this scripted F is the PLAN-SCOPE variant: turn 1 raises the work_breakdown clarification, whose answer (the stated
  // 2-hour total) is a legitimate plan amount, so binding it is correct here. It is NOT the live F path (a progress question,
  // `missing_schedulable_work` on an unbounded task); that path and the owner's F status are covered by the live-shape pins in
  // weeklyPlanningAnswerPurposeGuard.integration.test.ts. The owner's F status must not be read from this test.
  it('F: all measured incremental turns reach a two-hour preview without repeating scope questions', async () => {
    const conversation = start('F');
    for (const [index, text] of CAMPAIGN.F.entries()) {
      // Turns 5-6 add no new fact to the accepted plan; an act-less empty delta after a plan
      // is re-read once (live D on fa6347e6) and then accepted as unchanged.
      await submit(conversation, text, index >= 4 ? ['semantic_generic', 'semantic_generic', 'renderer'] : normal);
      if (index === 0) continue;
      expectNextWeek(conversation);
      expect(conversation.getState().intakeState?.questions).toEqual([]);
      expect(candidates(conversation).reduce((sum, entry) => sum + entry.durationMinutes, 0)).toBe(120);
      expect(candidates(conversation).every(entry => entry.startTime >= '18:00')).toBe(true);
    }
    expect(candidates(conversation).map(entry => entry.durationMinutes)).toEqual([60, 60]);
  });

  it('E: consultation keeps accepted facts/preview unchanged; adopting weekend sessions rebuilds it', async () => {
    const conversation = start('E');
    await submit(conversation, CAMPAIGN.E[0], normal);
    const old = structuredClone(candidates(conversation));
    const graph = structuredClone(conversation.graph());
    const consultation = await submit(conversation, CAMPAIGN.E[1], normal);
    // The evidenced consultation is the reply's subject, not an "unchanged preview" report (live E on 65f178e0).
    const communication = (rendererDecision(consultation) as { communication?: Record<string, unknown> } | undefined)?.communication;
    expect(communication).toMatchObject({ goal: 'report_status', statusReason: null, consultationDeferred: true });
    expect(communication?.consultation).toBeTruthy();
    expect(candidates(conversation)).toEqual(old);
    expect(conversation.graph()).toEqual({ ...graph, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    await submit(conversation, CAMPAIGN.E[2], normal);
    expect(candidates(conversation).map(entry => entry.durationMinutes)).toEqual([90, 90]);
    expect(candidates(conversation).every(entry => ['2026-10-17', '2026-10-18'].includes(entry.date))).toBe(true);
  });

  it('G: a complete deadline/exclusion request has a two-call fast path, with no repair/audit', async () => {
    const conversation = start('G');
    await submit(conversation, CAMPAIGN.G[0], normal);
    expect(candidates(conversation).length).toBeGreaterThan(0);
    expect(candidates(conversation).every(entry => entry.date <= '2026-10-16')).toBe(true);
    expect(conversation.graph()?.availabilityDeclarations).toMatchObject([{ kind: 'unavailable', dateExpression: 'weekday:tuesday', startTime: '20:00', endTime: '22:00' }]);
  });

  it('B: explanation preserves the required question and has no semantic retry', async () => {
    const conversation = start('B');
    await submit(conversation, CAMPAIGN.B[0], normal);
    const graph = structuredClone(conversation.graph());
    const why = await submit(conversation, CAMPAIGN.B[1], normal);
    expect(why.result?.interactionOutcome?.kind).toBe('explain_pending_question');
    expect(conversation.graph()).toEqual({ ...graph, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(candidates(conversation)).toEqual([]);
    expect(rendererDecision(why)).toMatchObject({ communication: { goal: 'explain_question', askQuestion: true } });
  });
});


describe('dispatch attribution: repairs are counted, not hidden in the two-call successful path', () => {
  it('D: a follow-up that comes back as accepted-task shells only is re-read once (live D on fa6347e6)', async () => {
    const conversation = start('D');
    await submit(conversation, CAMPAIGN.D[0], normal);
    await submit(conversation, CAMPAIGN.D[1], ['semantic_focused_contextual', 'renderer']);
    const old = structuredClone(candidates(conversation));
    let shellsOnly = true;
    override = call => {
      if (call.kind !== 'semantic_generic' || !shellsOnly) return undefined;
      shellsOnly = false;
      const reply = JSON.parse(campaignProviderReply(scenario, call.request as unknown as CampaignRequest));
      // The live first response kept only the accepted-task shells: no session, split or evening fact.
      reply.tasks = (reply.tasks as Json[]).map(task => ({ ...task, study: null, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [] }));
      reply.availabilityDeclarations = [];
      reply.corrections = [];
      reply.relations = [];
      reply.uncertainties = [];
      return JSON.stringify(reply);
    };
    const final = await submit(conversation, CAMPAIGN.D[2], ['semantic_generic', 'semantic_generic', 'renderer']);
    expect(candidates(conversation)).not.toEqual(old);
    expect(candidates(conversation).filter(entry => entry.title.includes('卒業研究ノート')).map(entry => entry.durationMinutes)).toEqual([60, 60]);
    expect(rendererDecision(final)).toMatchObject({ actionKind: 'preview_ready' });
  });

  it('C: a correction the application could not use does not present the old preview as its result (live C on d7b85616)', async () => {
    const conversation = start('C');
    await submit(conversation, CAMPAIGN.C[0], normal);
    const before = candidates(conversation).map(entry => `${entry.date} ${entry.startTime} ${entry.durationMinutes}`);
    expect(before.length).toBeGreaterThan(0);
    override = call => (call.kind === 'semantic_generic' ? 'invalid fixture JSON' : undefined);
    const turn = await conversation.submit(CAMPAIGN.C[1]);
    expect(turn.result?.failure).toBeDefined();
    const decision = rendererDecision(turn) as Record<string, unknown> | undefined;
    expect(decision?.previewPromotionControlLabel ?? null).toBeNull();
    expect(decision?.relevantLabels).not.toContain('この内容で仮予定にする');
    // The accepted preview itself is unchanged and still available on the card.
    expect(candidates(conversation).map(entry => `${entry.date} ${entry.startTime} ${entry.durationMinutes}`)).toEqual(before);
  });

  it('A: a weekday-set preference first written as one task date is restated per weekday by the single repair (live A on 2f9ae953)', async () => {
    const conversation = start('A');
    const evening = { localId: 'evening', targetLocalId: 'book', kind: 'preferred_window', constraintLevel: 'soft',
      dateExpression: '平日', namedTimePeriod: null, startTime: '20:00', endTime: null, precision: 'exact', sourceText: '平日は20時以降がいい' };
    let semantic = 0;
    override = call => {
      if (call.kind !== 'semantic_generic') return undefined;
      // The live first response had no canonical form for the weekday set; the repair restates it.
      const document = schedulingDocument('A', { availabilityDeclarations: [] });
      const [task] = document.tasks as Json[];
      task.temporalConstraints = semantic++ === 0 ? [evening]
        : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
          .map((day, index) => ({ ...evening, localId: `evening-${index}`, dateExpression: `weekday:${day}` })).reverse();
      return JSON.stringify(document);
    };
    const turn = await submit(conversation, CAMPAIGN.A[0], ['semantic_generic', 'semantic_generic', 'renderer']);
    const repair = turn.calls[1].messages;
    expect(repair[repair.length - 1].content).toContain('one copy per weekday');
    expectNextWeek(conversation, '2026-10-16');
    expect(candidates(conversation).every(entry => entry.startTime >= '20:00')).toBe(true);
    expect(activeWorkloads(conversation).map(entry => entry.amount)).toEqual([20]);
  });

  it.each(['none', 'ack_out_of_order', 'unknown_ack_fact'] as const)('G uses exactly one semantic repair; a renderer repair only for output that composition cannot fix (%s)', async (rendererFault) => {
    const conversation = start('G');
    let semantic = 0;
    let renderer = 0;
    let acknowledgement = '';
    override = call => {
      if (call.kind === 'semantic_generic' && semantic++ === 0) return 'invalid fixture JSON';
      if (call.kind === 'renderer' && renderer++ === 0 && rendererFault !== 'none') {
        const reply = JSON.parse(campaignProviderReply(scenario, call.request as unknown as CampaignRequest));
        acknowledgement = reply.groundingAcknowledgement?.text ?? '';
        if (rendererFault === 'ack_out_of_order') {
          // ACK kept in its metadata but not leading the text: composed deterministically, no repair.
          reply.text = '候補を確認して「この内容で仮予定にする」を押してください。';
        } else {
          // The ACK cites a fact this turn did not accept: composition cannot fix it, one repair.
          reply.groundingAcknowledgement = { ...reply.groundingAcknowledgement, factIds: ['wpf_not_accepted_this_turn'] };
        }
        return JSON.stringify(reply);
      }
      return undefined;
    };
    const expected = ['semantic_generic', 'semantic_generic', 'renderer', ...(rendererFault === 'unknown_ack_fact' ? ['renderer'] : [])];
    const turn = await submit(conversation, CAMPAIGN.G[0], expected);
    expect(turn.debugTrace.find(event => event.stage === 'semantic_repair_prepared')).toBeDefined();
    if (rendererFault === 'unknown_ack_fact') {
      const messages = turn.calls[turn.calls.length - 1].messages;
      expect(messages[messages.length - 1].content).toContain('ACK契約');
    }
    if (rendererFault === 'ack_out_of_order') {
      expect(acknowledgement.length).toBeGreaterThan(0);
      expect(latestAssistantText(conversation).startsWith(acknowledgement.trim())).toBe(true);
    }
    expect(candidates(conversation).length).toBeGreaterThan(0);
  });
});
