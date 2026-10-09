import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT, WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT } from './dialogue/weeklyPlanningInteractionFallbackText';
import { A, schedulingDocument } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';

// Safe failure, not tolerated loss: when the completeness audit reported content that the turn
// could not take in (its re-read was refused by the retention floor), the application says so in
// its own sentence. The free-text audit hints are never shown or interpreted.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

function document(titles: string[], architecture: WeeklyPlanningConversationArchitecture): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: titles.map((title, index) => ({
      localId: `task-${index}`, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
      study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: title, components: [] },
      workloads: [{ localId: `workload-${index}`, quantityRole: 'target', amount: 10, unitCode: 'problem', unitLabel: '問',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `${title}を10問` }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: `${title}を10問`,
    })),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
    ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}),
  };
}

const FILLER = 'それぞれ自分のペースで、無理のない範囲で取り組みたいと思っています。';
// A distinctive free-text audit hint: it must never reach the user or the renderer.
const AUDIT_HINT = 'audit-hint-omitted-chemistry';
function denseText(): string {
  let text = '来週、数学を10問進めたいです。物理を10問進めたいです。化学を10問も追加します。';
  while (new TextEncoder().encode(text).length < 1300) text += FILLER;
  return text;
}

async function turn(params: { architecture: WeeklyPlanningConversationArchitecture; audit: 'complete' | 'incomplete'; reread: string[] }) {
  let semanticCalls = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '数学と物理は、それぞれ1問あたり何分くらいかかりそうですか？');
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') {
      return JSON.stringify(params.audit === 'complete'
        ? { decision: 'complete', missingFacts: [] }
        : { decision: 'incomplete', missingFacts: [AUDIT_HINT] });
    }
    semanticCalls += 1;
    return JSON.stringify(document(semanticCalls === 1 ? ['数学', '物理'] : params.reread, params.architecture));
  }, { completenessAudit: 'scripted' });
  const conversation = createScriptedConversation({ provider, architecture: params.architecture });
  const result = await conversation.submit(denseText());
  const titles = (conversation.graph()?.tasks ?? []).map(task => (task as { title: string }).title).sort();
  const rendererCall = result.calls.find(call => call.kind === 'renderer');
  const rendererRequest = rendererCall
    ? JSON.parse(rendererCall.messages.find(message => message.role === 'user')!.content) as Json : null;
  const boundedTrace = result.result?.dialogueRendererTrace
    ? JSON.stringify(boundWeeklyPlanningDialogueRendererTraceForTransport(result.result.dialogueRendererTrace)) : '';
  return { result, titles, rendererRequest, boundedTrace };
}

describe('completeness omission disclosure (application-owned safe failure)', () => {
  it('states the possible omission when the audit-reported content could not be taken in', async () => {
    const { result, titles, rendererRequest, boundedTrace } = await turn({ architecture: 'interaction_v1', audit: 'incomplete', reread: ['数学', '化学'] });
    expect(titles).toEqual(['数学', '物理'].sort());
    // A typed flag reaches the renderer request and its bounded transport trace; no audit text does.
    expect((rendererRequest!.applicationDecision as Json).communication).toMatchObject({ possibleCompletenessOmission: true });
    expect(boundedTrace).toContain('possibleCompletenessOmission');
    expect(JSON.stringify(rendererRequest)).not.toContain(AUDIT_HINT);
    expect(result.result?.message).not.toContain(AUDIT_HINT);
    expect(result.result?.communicationFacts?.possibleCompletenessOmission).toBe(true);
    expect(result.result?.message).toContain(WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT);
    // The free-text audit hint is never shown to the user.
    expect(result.result?.message).not.toContain(AUDIT_HINT);
  });

  it.each([
    ['the audit found nothing missing', 'complete', ['数学', '物理']],
    ['the re-read took the missing content in', 'incomplete', ['数学', '物理', '化学']],
  ] as const)('says nothing extra when %s', async (_label, audit, reread) => {
    const { result, rendererRequest, boundedTrace } = await turn({ architecture: 'interaction_v1', audit, reread: [...reread] });
    expect(result.result?.communicationFacts?.possibleCompletenessOmission).toBeUndefined();
    expect((rendererRequest!.applicationDecision as Json).communication).not.toHaveProperty('possibleCompletenessOmission');
    expect(boundedTrace).not.toContain('possibleCompletenessOmission');
    expect(result.result?.message).not.toContain(WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT);
  });

  it('legacy keeps its behavior: the re-read replaces the reading and no notice is added (documented residual)', async () => {
    const { result, titles } = await turn({ architecture: 'legacy_v5', audit: 'incomplete', reread: ['数学', '化学'] });
    expect(titles).toEqual(['数学', '化学'].sort());
    expect(result.result?.message ?? '').not.toContain(WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT);
  });
});

describe('every completion path that discards or cannot check a reading is disclosed (live H T3, round 3)', () => {
  it('an empty first reading whose re-read is invalid is an unusable message, not an unchanged plan', async () => {
    let turn2 = false;
    let semanticCalls = 0;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, turn2
        ? '変更をうまく受け取れませんでした。変えたい点を教えてください。'
        : '候補を用意しました。内容を確認してください。');
      if (!turn2) return JSON.stringify(schedulingDocument('A'));
      semanticCalls += 1;
      if (semanticCalls > 1) return '{invalid-reread';
      const tasks = (call.payload!.publicStateSummary as Json).tasks as Json[];
      // Live H T3 shape: the accepted task is pointed at, but no change is carried.
      return JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
        tasks: [{ localId: 'shell', existingPublicId: tasks[0].publicId, decompositionStatus: 'atomic', category: 'study',
          title: 'アルゴリズムイントロダクション', study: null, workloads: [], effortEstimates: [], temporalConstraints: [],
          recurrence: [], durableContextSignals: [], sourceText: '水曜の夜にまとめて' }],
        relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
        conversationActs: [], uncertainties: [], corrections: [], decisions: [] });
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(A);
    const previewBefore = structuredClone(conversation.getState().previewCandidates);
    expect(previewBefore?.length).toBeGreaterThan(0);
    const graphBefore = structuredClone(conversation.graph());
    turn2 = true;
    const result = await conversation.submit('じゃあ水曜の夜にまとめて');
    expect(result.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic' });
    expect(result.result?.message).toContain(WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT);
    expect(result.result?.message).not.toContain('この内容で仮予定にする');
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
    expect(conversation.graph()?.tasks).toEqual(graphBefore?.tasks);
    // initial reading and its single re-read; no repair is added
    expect(result.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(2);
  });

  it('an invalid re-read that carries no change keeps the still-valid unchanged reading', async () => {
    let turn2 = false;
    let semanticCalls = 0;
    let shellPublicId = '';
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '候補はこのままです。');
      if (!turn2) return JSON.stringify(schedulingDocument('A'));
      semanticCalls += 1;
      // The re-read's last user message is the retry instruction, not a JSON payload.
      if (semanticCalls === 1) shellPublicId = ((call.payload!.publicStateSummary as Json).tasks as Json[])[0].publicId as string;
      // The re-read is schema-valid but fails semantic validation (it quotes text the user did
      // not write) and still carries no planning content: nothing suggests a change, so the
      // still-valid unchanged reading is kept.
      return JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
        tasks: [{ localId: 'shell', existingPublicId: shellPublicId, decompositionStatus: 'atomic', category: 'study',
          title: 'アルゴリズムイントロダクション', study: null, workloads: [], effortEstimates: [], temporalConstraints: [],
          recurrence: [], durableContextSignals: [], sourceText: semanticCalls > 1 ? '発話にない引用' : 'うん' }],
        relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
        conversationActs: [], uncertainties: [], corrections: [], decisions: [] });
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(A);
    const previewBefore = structuredClone(conversation.getState().previewCandidates);
    turn2 = true;
    const result = await conversation.submit('うん');
    expect(result.result?.interactionOutcome?.kind).not.toBe('recover');
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
  });

  it('a malformed audit on the short literal-gap route keeps the reading and discloses the possible omission', async () => {
    const text = '来週、数学を10問進めたいです。化学も少しやりたいと思っています。';
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '数学は1問あたり何分くらいかかりそうですか？');
      if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return '{"decision":"maybe"}';
      return JSON.stringify(document(['数学'], 'interaction_v1'));
    }, { completenessAudit: 'scripted' });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const result = await conversation.submit(text);
    expect(result.result?.communicationFacts?.possibleCompletenessOmission).toBe(true);
    expect(result.result?.message).toContain(WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT);
  });
});
