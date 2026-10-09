import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedProviderCall } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { CAMPAIGN, CAMPAIGN_MATERIALS, campaignProviderReply, campaignRendererReply, type CampaignRequest, type CampaignScenario } from './testUtils/weeklyPlanningRealE2ECampaignFixture';
import { conditionDocument } from './testUtils/weeklyPlanningConditionPropagationFixture';
import type { Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

vi.setConfig({ testTimeout: 30_000 });
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let consulting: boolean;
let scenario: CampaignScenario;
let busyWeekend: boolean;
let falseFirstClaim: boolean;
let rendererCount: number;
let resume: boolean;
let mixedChange: boolean;
let consultationText: string;
let nameTestedDates: boolean;
let hypothesisFault: 'unknown' | 'malformed' | null;
function reply(call: ScriptedProviderCall) {
  if (resume && call.kind === 'semantic_generic') return JSON.stringify(conditionDocument({ conversationActs: [{ kind: 'resume_topic', targetPublicId: null }] }));
  if (consulting && call.kind === 'semantic_generic') {
    const tasks = (call.payload?.publicStateSummary as Json).tasks as Json[];
    return JSON.stringify(conditionDocument({
      planningIntent: mixedChange ? 'update_plan' : 'discuss',
      // Sanitized live vfin-E T2 shape: a bound empty shell plus the consultation act.
      tasks: [{ localId: 'accepted-task', existingPublicId: tasks[0].publicId, decompositionStatus: 'atomic', category: 'study',
        title: tasks[0].title, study: null, workloads: [], effortEstimates: mixedChange ? [{ localId: 'session', targetLocalId: 'accepted-task', kind: 'session_duration', minutes: 90, unitCode: 'minute', precision: 'approximate', sourceText: '1回1時間半にして' }] : [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: consultationText }],
      conversationActs: [{ kind: 'consultation_request', targetPublicId: hypothesisFault === 'unknown' ? 'unknown-task' : tasks[0].publicId,
      placementAlternative: { scope: 'task', dateExpressions: hypothesisFault === 'malformed' ? ['土日'] : ['weekday:saturday', 'weekday:sunday'], sourceText: consultationText },
    }] }));
  }
  if (consulting && call.kind === 'renderer') {
    const decision = call.payload?.applicationDecision as Json;
    const communication = decision.communication as Json;
    const consultation = communication.consultation as Json | undefined;
    const status = (consultation?.feasibility as Json | undefined)?.status;
    const claim = falseFirstClaim && rendererCount++ === 0 ? 'fits' : status === 'not_evaluated' ? 'none' : status;
    const base = JSON.parse(campaignRendererReply(call.payload as Json));
    const acknowledgement = base.groundingAcknowledgement?.text ?? '';
    const previewControl = decision.actionKind === 'preview_ready' && communication.alternativeRequiresAdoption !== true
      ? '今の候補を確認し、よければ「この内容で仮予定にする」を押してください。' : '';
    return JSON.stringify({ ...base, actionId: call.payload?.actionId, actionKind: decision.actionKind,
      questionCode: decision.questionCode ?? null,
      feasibilityClaim: claim ?? 'none', text: acknowledgement + (claim === 'fits'
        ? nameTestedDates ? '10月17日と10月18日であれば、今の条件では取り組めそうです。希望するなら、この日程で進めましょう。' : '土日にまとめる形でも、今の条件では取り組めそうです。希望するなら、この条件で候補を見てみましょう。'
        : claim === 'does_not_fit' ? '今の予定を保ったまま土日だけに収めるのは難しそうです。別の日も使う形を考えてみましょう。'
          : '必要な時間がまだ分からないため、土日に収まるかは確かめられていません。まず取り組む内容を確認しましょう。') + previewControl,
    });
  }
  if (busyWeekend && call.kind === 'semantic_generic') {
    const request = call.request as unknown as CampaignRequest;
    const initialRequest = { ...request, messages: request.messages.map(message => message.role === 'user'
      ? { ...message, content: JSON.stringify({ ...JSON.parse(message.content), userText: CAMPAIGN.E[0] }) } : message) };
    const doc = JSON.parse(campaignProviderReply('E', initialRequest));
    doc.availabilityDeclarations = ['2026-10-17', '2026-10-18'].map((dateExpression, index) => ({
      localId: `busy-${index}`, kind: 'unavailable', dateExpression, namedTimePeriod: null, startTime: '00:00', endTime: '23:59',
      recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: '土日は終日予定があります',
    }));
    return JSON.stringify(doc);
  }
  if (resume && call.kind === 'renderer') {
    const decision = call.payload?.applicationDecision as Json;
    return JSON.stringify({ actionId: call.payload?.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode ?? null, groundingAcknowledgement: null, text: '続きから進めましょう。取り組む内容をもう少し教えてください。' });
  }
  return campaignProviderReply(scenario, call.request as unknown as CampaignRequest);
}
beforeEach(() => { resetScriptedConversationRuntime(); consulting = false; scenario = 'E'; busyWeekend = false; falseFirstClaim = false; rendererCount = 0; resume = false; mixedChange = false; nameTestedDates = false; hypothesisFault = null; consultationText = CAMPAIGN.E[1]; provider = installScriptedWeeklyPlanningProvider(reply); });
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

describe('alternative placement consultation through the real turn controller', () => {
  it('checks a proposed weekend with no AI retry, while preserving accepted graph and preview', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS });
    const first = await conversation.submit(CAMPAIGN.E[0]);
    expect(first.result?.failure).toBeUndefined();
    const before = structuredClone(conversation.graph());
    const preview = structuredClone(conversation.getState().previewCandidates);
    consulting = true;
    const turn = await conversation.submit(CAMPAIGN.E[1]);
    const decision = turn.calls.find(call => call.kind === 'renderer')?.payload?.applicationDecision as Json;
    expect((decision.communication as Json).consultation).toMatchObject({
      mode: 'advisory_only', assessmentScope: 'proposed_days',
      feasibility: { status: 'fits', basis: 'alternative_scheduler' },
      alternative: { scope: 'task', dates: ['2026-10-17', '2026-10-18'] }, nextAction: 'offer_alternative_adoption',
    });
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.responseSource, JSON.stringify(turn.result?.dialogueRendererTrace)).toBe('ai');
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(conversation.graph()).toEqual({ ...before, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(conversation.getState().previewCandidates).toEqual(preview);
    expect(conversation.getState().pendingApproval).toBeUndefined();
    consulting = false;
    const adopted = await conversation.submit(CAMPAIGN.E[2]);
    expect(adopted.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates?.every(candidate => ['2026-10-17', '2026-10-18'].includes(candidate.date))).toBe(true);
    expect(conversation.getState().previewCandidates).not.toEqual(preview);
  });
  it('the alternative scheduler sees MonthEvent busy time: an all-day weekend MonthEvent makes the weekend not fit', async () => {
    const day = (date: string) => ({ id: `weekend-${date}`, userId: 'issue488-owner', date, endDate: date, title: '予定', startTime: '00:00',
      endTime: '24:00', repeat: 'none' as const, repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS,
      monthEvents: [day('2026-10-17'), day('2026-10-18')] });
    const first = await conversation.submit(CAMPAIGN.E[0]);
    expect(first.result?.failure, JSON.stringify(first.result)).toBeUndefined();
    consulting = true;
    const turn = await conversation.submit(CAMPAIGN.E[1]);
    expect(turn.result?.communicationFacts?.consultation?.feasibility).toEqual({ status: 'does_not_fit', basis: 'alternative_scheduler' });
  });
  it('reports actual weekend capacity failure and repairs a contradictory feasibility claim once', async () => {
    busyWeekend = true;
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS });
    const first = await conversation.submit(`${CAMPAIGN.E[0]}。土日は終日予定があります`);
    expect(first.result?.failure, JSON.stringify(first.result)).toBeUndefined();
    const preview = structuredClone(conversation.getState().previewCandidates);
    expect(preview?.length).toBeGreaterThan(0);
    const graph = structuredClone(conversation.graph());
    consulting = true;
    falseFirstClaim = true;
    const turn = await conversation.submit(CAMPAIGN.E[1]);
    expect(turn.result?.communicationFacts?.consultation?.feasibility).toEqual({ status: 'does_not_fit', basis: 'alternative_scheduler' });
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer', 'renderer']);
    expect(turn.result?.responseSource, JSON.stringify(turn.result?.dialogueRendererTrace)).toBe('ai');
    expect(turn.calls[2].messages[turn.calls[2].messages.length - 1]?.content).toContain('feasibilityClaim');
    expect(JSON.parse(turn.result!.dialogueRendererTrace!.response.rawResponse!).feasibilityClaim).toBe('does_not_fit');
    expect(conversation.graph()).toEqual({ ...graph, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(conversation.getState().previewCandidates).toEqual(preview);
  });

  it('keeps the unresolved question and rebinds it freshly on resume when the alternative cannot yet be evaluated', async () => {
    scenario = 'B';
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const first = await conversation.submit(CAMPAIGN.B[0]);
    expect(first.result?.failure).toBeUndefined();
    const context = structuredClone(conversation.getState().intakeState?.lastQuestionContext);
    const graph = structuredClone(conversation.graph());
    expect(context).toBeTruthy();
    consulting = true;
    falseFirstClaim = true;
    const aside = await conversation.submit(CAMPAIGN.E[1]);
    expect(aside.result?.failure).toBeUndefined();
    expect(aside.calls.filter(call => call.kind === 'renderer')).toHaveLength(2);
    expect(aside.result?.responseSource).toBe('ai');
    expect(aside.result?.communicationFacts?.consultation?.feasibility).toMatchObject({ status: 'not_evaluated', reason: 'planning_details_missing' });
    expect(conversation.graph()).toEqual({ ...graph, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(conversation.getState().intakeState?.lastQuestionContext?.topicId).toBe(context?.topicId);
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe(context?.targetSlot);
    consulting = false;
    resume = true;
    const resumed = await conversation.submit('元の話に戻ろう');
    expect(resumed.result?.failure).toBeUndefined();
    expect(resumed.result?.interactionOutcome?.kind).toBe('resume_pending_question');
    const state = conversation.getState();
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: state.intakeState, inputStateRevision: state.revision, messages: state.messages, graphRevision: conversation.graph()!.revision }).status).toBe('fresh');
    expect(conversation.getState().intakeState?.lastQuestionContext?.topicId).toBe(context?.topicId);
  });
});

it('applies an independent session change while keeping the proposed days hypothetical', async () => {
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS });
  await conversation.submit(CAMPAIGN.E[0]);
  const before = structuredClone(conversation.graph());
  consulting = true;
  mixedChange = true;
  consultationText = '1回1時間半にして。土日だけにできそう？';
  const turn = await conversation.submit(consultationText);
  expect(turn.result?.failure, JSON.stringify(turn.debugTrace)).toBeUndefined();
  expect(turn.result?.interactionOutcome?.kind).toBe('apply');
  expect(turn.result?.responseSource, JSON.stringify(turn.result?.dialogueRendererTrace)).toBe('ai');
  expect(turn.result?.communicationFacts?.consultation?.feasibility.status).toBe('fits');
  const decision = turn.calls.find(call => call.kind === 'renderer')!.payload!.applicationDecision as Json;
  expect(decision.communication).toMatchObject({ alternativeRequiresAdoption: true });
  expect(decision.previewPromotionControlLabel).toBeNull();
  expect(turn.result?.message).not.toContain('この内容で仮予定にする');
  expect(conversation.graph()?.effortEstimates).toEqual(expect.arrayContaining([expect.objectContaining({ minutes: 90, kind: 'session_duration' })]));
  expect(conversation.graph()?.temporalConstraints).toEqual(before?.temporalConstraints);
  expect(conversation.graph()?.recurrences).toEqual(before?.recurrences);
  expect(conversation.graph()?.taskDateRules).toEqual(before?.taskDateRules);
  expect(conversation.getState().previewCandidates?.some(candidate => candidate.date < '2026-10-17')).toBe(true);
  expect(conversation.getState().pendingApproval).toBeUndefined();
});

it('grounds dates named from the evaluated hypothetical result without treating them as accepted facts', async () => {
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS });
  await conversation.submit(CAMPAIGN.E[0]);
  consulting = true;
  nameTestedDates = true;
  const turn = await conversation.submit(CAMPAIGN.E[1]);
  expect(turn.result?.responseSource, JSON.stringify(turn.result?.dialogueRendererTrace)).toBe('ai');
  expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
});

it.each(['unknown', 'malformed'] as const)('keeps rejected hypotheses unknown when an independent change produces a fresh preview (%s)', async fault => {
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: CAMPAIGN_MATERIALS });
  await conversation.submit(CAMPAIGN.E[0]);
  consulting = true;
  mixedChange = true;
  hypothesisFault = fault;
  consultationText = '1回1時間半にして。土日だけにできそう？';
  const turn = await conversation.submit(consultationText);
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.result?.interactionOutcome?.kind).toBe('apply');
  expect(turn.result?.communicationFacts?.consultation?.feasibility.status).toBe('not_evaluated');
  expect(conversation.graph()?.effortEstimates).toEqual(expect.arrayContaining([expect.objectContaining({ minutes: 90 })]));
  expect(conversation.graph()?.temporalConstraints).toEqual([]);
  expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
});
