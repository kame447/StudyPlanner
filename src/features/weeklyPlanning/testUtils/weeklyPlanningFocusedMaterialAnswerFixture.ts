import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation, type ScriptedProviderCall } from './weeklyPlanningScriptedConversationHarness';
import { campaignRendererReply } from './weeklyPlanningRealE2ECampaignFixture';
import liveDocuments from './weeklyPlanningFocusedMaterialLiveDocuments.json';

type Json = Record<string, unknown>;
export const MATERIAL_SETUP = '来週、数学の問題集を20問進めたい';
export const MATERIAL_WHY = 'なんで時間が必要なの？';
export const MATERIAL_PACE = '1問3分くらい';
export const MATERIAL_NAME = '青チャートのこと';
export const MATERIAL_MIXED = '青チャートです。1問3分くらい';
export const MATERIAL_SHORT_MIXED = '青チャート、1問3分';
export const MATERIAL_DIGIT_REMAINDER = '青チャート3分';
export const FOCUSED_MATERIAL_SCHEMA = 'weekly_planning_focused_material_answer_v5';
export const emptyMaterialAnswer = (decision = 'fallback', values: Json = {}) => ({
  decision, label: null, registeredChoice: null, workloadChoice: null, effortKind: null,
  minutes: null, precision: null, sourceText: null, effortSourceText: null, ...values,
});
export function materialAnswerForRequestedSchema(call: ScriptedProviderCall, decision: string, values: Json = {}): string {
  const answer = emptyMaterialAnswer(decision, values) as Json;
  // Reviewer red/green replay uses the exact response contract at each base.
  if (!call.schemaProperties.includes('effortSourceText')) delete answer.effortSourceText;
  return JSON.stringify(answer);
}
export function mixedMaterialDocument(call: ScriptedProviderCall): string {
  const payload = call.messages.map((message) => { try { return JSON.parse(message.content) as Json; } catch { return {}; } })
    .find((value) => typeof value.userText === 'string' && value.publicStateSummary)!;
  const state = payload.publicStateSummary as Json;
  const task = (state.tasks as Json[])[0]; const material = (state.components as Json[]).find((fact) => fact.role === 'material');
  const work = (state.workloads as Json[])[0];
  const total = payload.userText === MATERIAL_DIGIT_REMAINDER;
  const paceSource = total ? '3分' : payload.userText === MATERIAL_SHORT_MIXED ? '1問3分' : '1問3分くらい';
  return JSON.stringify(doc({ tasks: [{ localId: 'mixed-task', existingPublicId: task.publicId, decompositionStatus: 'atomic', category: 'study', title: task.title,
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{ localId: 'mixed-material', existingPublicId: material?.publicId ?? null,
      role: 'material', parentLocalId: null, label: '青チャート', sourceText: '青チャート', workloads: [], durableContextSignals: [] }] },
    workloads: [], effortEstimates: [{ localId: 'mixed-pace', targetLocalId: work.publicId, kind: total ? 'total_duration' : 'duration_per_unit', minutes: 3, unitCode: total ? null : 'problem', precision: 'approximate', sourceText: paceSource }],
    temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: String(payload.userText),
  }], conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] }));
}
const doc = (values: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...values });

export function focusedMaterialConversationFixture(options: {
  genericShape?: 'shell' | 'topic_shift' | 'relabel' | 'bookshelf_reference';
  materialQuestion?: boolean; architecture?: 'interaction_v1' | 'legacy_v5';
  conversationId?: string; focusedReply?: (call: ScriptedProviderCall) => string;
  genericReply?: (call: ScriptedProviderCall) => string;
  completenessAuditReply?: (call: ScriptedProviderCall) => string;
  taskMaterialNeed?: boolean;
  captureCase?: keyof typeof liveDocuments;
  registeredMaterialName?: string;
  registeredMaterialAliases?: string[];
} = {}) {
  resetScriptedConversationRuntime();
  let conversation: ScriptedConversation;
  const component = (existingPublicId: string | null, label: string, sourceText: string, workloads: Json[] = []): Json => ({
    localId: 'material', existingPublicId, parentLocalId: null, role: 'material', label, sourceText, workloads, durableContextSignals: [],
  });
  const task = (existingPublicId: string | null, sourceText: string, components: Json[]): Json => ({
    localId: 'task', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集を進める',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components },
    sourceText, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
  });
  const provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return campaignRendererReply(call.payload ?? {});
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5' && options.completenessAuditReply) return options.completenessAuditReply(call);
    const text = String(call.payload?.currentUserText ?? call.payload?.userText ?? '');
    if (call.schemaName === FOCUSED_MATERIAL_SCHEMA) {
      if (options.focusedReply) return options.focusedReply(call);
      if (text === MATERIAL_WHY) return JSON.stringify(emptyMaterialAnswer('explain_question', { sourceText: text }));
      if (text === MATERIAL_PACE) return JSON.stringify(emptyMaterialAnswer('effort_answer', {
        workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: text,
      }));
      if (text === MATERIAL_NAME) return JSON.stringify(emptyMaterialAnswer('material_answer', {
        label: '青チャート', registeredChoice: null, sourceText: '青チャート',
      }));
      if (text === MATERIAL_MIXED) return materialAnswerForRequestedSchema(call, 'material_and_effort_answer', {
        label: '青チャート', sourceText: '青チャート', effortSourceText: '1問3分くらい',
        workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate',
      });
      return JSON.stringify(emptyMaterialAnswer());
    }
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify(text === MATERIAL_PACE
      ? { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null }
      : { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.kind !== 'semantic_generic') throw new Error(`unexpected material provider schema ${call.schemaName}`);
    if (options.genericReply && text !== MATERIAL_SETUP) return options.genericReply(call);
    let result: Json;
    if (text === MATERIAL_SETUP) result = doc({ planningIntent: 'create_plan',
      planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [task(null, '数学の問題集を20問進めたい', [component(null, '数学の問題集', '数学の問題集', [{ localId: 'work', quantityRole: 'target', amount: 20,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '20問' }])])],
      uncertainties: options.materialQuestion === false ? [] : [{ localId: 'identity', targetLocalId: options.taskMaterialNeed ? 'task' : 'material', field: options.taskMaterialNeed ? 'material' : 'material_identity', reason: '対象教材が未確定', sourceText: '数学の問題集' }],
    });
    else if (text === MATERIAL_WHY) result = doc({ planningIntent: 'discuss', conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] });
    else {
      const graph = conversation.graph()!;
      const material = graph.components.find((fact) => fact.role === 'material');
      if (text === MATERIAL_NAME && options.genericShape === 'topic_shift') result = doc({ conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] });
      else result = doc({ tasks: [task(graph.tasks[0].id, text, [component(
        text === MATERIAL_NAME && options.genericShape === 'bookshelf_reference' ? 'book-blue' : material?.id ?? null,
        text === MATERIAL_NAME && ['relabel', 'bookshelf_reference'].includes(options.genericShape ?? '') ? '青チャート（架空A）' : material?.label ?? '数学の問題集',
        text,
      )])], conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] });
    }
    if (!call.schemaProperties.includes('conversationActs')) delete result.conversationActs;
    if (text === MATERIAL_SETUP && options.taskMaterialNeed) {
      const initial = (result.tasks as Json[])[0];
      const study = initial.study as Json;
      initial.workloads = (study.components as Json[])[0].workloads;
      study.components = [];
    }
    if (options.captureCase) {
      const captured = liveDocuments[options.captureCase];
      const selected = text === MATERIAL_SETUP ? captured.initial : text === MATERIAL_PACE ? captured.pace : text === MATERIAL_NAME ? captured.name : null;
      if (selected) {
        const graph = conversation.graph();
        const replacements: Record<string, string> = { '{{catalog_blue}}': 'book-blue' };
        if (graph) for (const [group, token] of [['tasks', 'task'], ['components', 'component'], ['workloads', 'workload'], ['uncertainties', 'uncertainty']] as const) {
          graph[group].forEach((fact, index) => { replacements[`{{${token}:${index}}}`] = fact.id; });
        }
        result = JSON.parse(JSON.stringify(selected, (_key, value: unknown) => typeof value === 'string' ? replacements[value] ?? value : value)) as Json;
        if (!call.schemaProperties.includes('conversationActs')) delete result.conversationActs;
      }
    }
    return JSON.stringify(result);
  }, { completenessAudit: options.completenessAuditReply ? 'scripted' : 'complete' });
  const materials = [options.registeredMaterialName ?? '青チャート（架空A）', '赤チャート（架空B）'].map((name, index) => ({
    id: index ? 'book-red' : 'book-blue', userId: 'issue488-owner', name, subjectId: 'math', subjectName: '数学', paceEnabled: false,
    aliases: index ? [] : options.registeredMaterialAliases ?? [],
    progressUnit: 'problem' as const, totalUnits: 100, currentUnit: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  }));
  conversation = createScriptedConversation({ provider, studyMaterials: materials, conversationId: options.conversationId, architecture: options.architecture ?? 'interaction_v1' });
  return { provider, conversation };
}
