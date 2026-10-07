import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from './weeklyPlanningScriptedConversationHarness';
import { campaignRendererReply } from './weeklyPlanningRealE2ECampaignFixture';

type Json = Record<string, unknown>;
export const MATERIAL_SETUP_TEXT = '来週、数学の問題集を20問進めたい';
export const MATERIAL_RATE_TEXT = '1問3分くらい';
export const NAMED_MATERIAL = '青チャート 数学III';
const document = (overrides: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides });
const workload = (localId: string, sourceText: string): Json => ({ localId, quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const component = (existingPublicId: string | null, label: string, sourceText: string, workloads: Json[] = []): Json => ({ localId: 'material', existingPublicId, parentLocalId: null, role: 'material', label, workloads, durableContextSignals: [], sourceText });
const task = (existingPublicId: string | null, sourceText: string, components: Json[], effortEstimates: Json[] = []): Json => ({
  localId: 'task', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集を進める',
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components },
  workloads: [], effortEstimates, temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText,
});

export function materialIdentityConversationFixture(params: {
  shape?: 'relabel' | 'modify' | 'remove'; rateShape?: 'replay' | 'public_reference'; architecture?: 'interaction_v1' | 'legacy_v5';
  conversationId?: string;
} = {}) {
  resetScriptedConversationRuntime();
  let conversation: ScriptedConversation;
  let nameAttempts = 0;
  const answerText = params.shape === 'modify' ? 'はい' : params.shape === 'remove' ? `はい、${NAMED_MATERIAL}です` : '青チャートのこと';
  const provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return campaignRendererReply(call.payload ?? {});
    if (call.kind !== 'semantic_generic') throw new Error(`unexpected material fixture ${call.kind}`);
    const payload = call.messages.map((message) => { try { return JSON.parse(message.content) as Json; } catch { return {}; } }).find((value) => typeof value.userText === 'string')!;
    const text = String(payload.userText);
    let result: Json;
    if (text === MATERIAL_SETUP_TEXT) result = document({
      planningIntent: 'create_plan', planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [task(null, '数学の問題集を20問進めたい', [component(null, '数学の問題集', '数学の問題集', [workload('work', '20問')])])],
      uncertainties: [{ localId: 'identity', targetLocalId: 'material', field: 'material_identity', reason: '対象教材が未確定', sourceText: '数学の問題集' }],
    });
    else {
      const graph = conversation.graph()!;
      const parent = graph.tasks[0];
      const material = graph.components.find((fact) => fact.role === 'material')!;
      const work = graph.workloads[0];
      if (text === MATERIAL_RATE_TEXT) result = document({ tasks: [task(parent.id, text,
        params.rateShape === 'public_reference' ? [] : [component(material.id, material.label, text, [workload(work.id, '数学の問題集を20問進めたい')])],
        [{ localId: 'rate', targetLocalId: work.id, kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: text }])],
      });
      else {
        const correction = params.shape === 'modify' ? { localId: 'modify', target: { kind: 'component', publicId: material.id, localId: null, mention: '数学の問題集' }, operation: 'modify', replacementLocalId: 'material', sourceText: text }
          : params.shape === 'remove' && nameAttempts === 0 ? { localId: 'remove', target: { kind: 'component', publicId: material.id, localId: null, mention: NAMED_MATERIAL }, operation: 'remove', replacementLocalId: null, sourceText: text } : null;
        result = document({ tasks: [task(parent.id, text, [component(material.id, NAMED_MATERIAL, text)])],
          corrections: correction ? [correction] : [], conversationActs: [{ kind: 'answer_pending_question', targetPublicId: material.id }] });
        nameAttempts += 1;
      }
    }
    if (!call.schemaProperties.includes('conversationActs')) delete result.conversationActs;
    return JSON.stringify(result);
  });
  conversation = createScriptedConversation({ provider, conversationId: params.conversationId, architecture: params.architecture ?? 'interaction_v1', studyMaterials: [{
    id: 'book-blue', userId: 'issue488-owner', name: NAMED_MATERIAL, subjectId: 'math', subjectName: '数学', paceEnabled: false,
    progressUnit: 'problem', totalUnits: 100, currentUnit: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  }] });
  return { provider, conversation, answerText };
}
