import type { StudyMaterial } from '../../../types/domain';
import { A, G, schedulingDocument, type Json } from './weeklyPlanningSchedulingConstraintsFixture';
import { CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument, conditionDocument } from './weeklyPlanningConditionPropagationFixture';

/** Exact user utterances from the 2026-10-07 Computer Use report, not captured model outputs.
 * These explicitly authored semantic doubles prove application behavior, never model quality.
 * Shared by full-controller Vitest and real-runtime browser tests; no Vitest/browser dependency.
 */
export const CAMPAIGN = {
  A: [A],
  B: ['来週、数学の問題集を20問進めたい', 'なんで時間が必要なの？', '1問3分くらい', '青チャートのこと'],
  C: ['来週、アルゴリズムイントロダクションを30ページ読みたい。1ページ4分くらい', 'やっぱり20ページにして、金曜日までに終わらせたい', '10月16日まで'],
  D: [CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP],
  E: ['来週、卒業研究ノートを3時間進めたい', 'その前に、土日にまとめてやる感じでも大丈夫？', 'じゃあ土日にまとめたい。1回1時間半くらいで'],
  F: ['来週は卒研を進めたい。できれば夜', '合計2時間くらい', '卒業研究ノートです。進み具合は特に気にしなくて大丈夫', '一部で大丈夫。1回1時間くらいで', '一部にします', 'セクション数は決めてないので、合計2時間でお任せします'],
  G: [G],
} as const;
export type CampaignScenario = keyof typeof CAMPAIGN;
export const CAMPAIGN_NOW = '2026-10-07T09:00:00.000Z';
export const CAMPAIGN_MATERIALS: StudyMaterial[] = [{
  id: 'material-note', userId: 'issue488-owner', name: '卒業研究ノート', subjectId: 'subject-research',
  subjectName: '卒業研究', paceEnabled: true, progressUnit: 'section', totalUnits: 12, currentUnit: 5,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}];

export interface CampaignRequest {
  messages: Array<{ role: string; content: string }>;
  response_format?: { json_schema?: { name?: string; schema?: { properties?: Json } } };
}
export function campaignPayload(request: CampaignRequest): Json {
  const content = request.messages.find(message => message.role === 'user')?.content;
  return content ? JSON.parse(content) as Json : {};
}
function facts(payload: Json, key: string): Json[] {
  return ((payload.publicStateSummary as Json | undefined)?.[key] ?? []) as Json[];
}
const week = { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
function workload(amount: number, unitCode: string, unitLabel: string, sourceText: string): Json {
  return { localId: 'amount', quantityRole: 'target', amount, unitCode, unitLabel,
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText };
}
function task(title: string, sourceText: string, extra: Json = {}): Json {
  return { localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText, ...extra };
}
function effort(kind: string, minutes: number, sourceText: string, targetLocalId = 'task', unitCode: string | null = null): Json {
  return { localId: 'effort', targetLocalId, kind, minutes, unitCode, precision: 'approximate', sourceText };
}
function timing(sourceText: string, extra: Json = {}): Json {
  return { localId: 'timing', targetLocalId: 'task', kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText, ...extra };
}
function correction(payload: Json, index: number): Json {
  const first = index === 0;
  const text = CAMPAIGN.C[index];
  const deadline = timing(index === 1 ? '金曜日までに終わらせたい' : text, {
    kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-10-16', namedTimePeriod: null, precision: 'exact',
  });
  const bound = facts(payload, index === 1 ? 'workloads' : 'temporalConstraints')[0];
  return conditionDocument({
    planningIntent: first ? 'create_plan' : 'update_plan', planningWindow: first ? week : null,
    tasks: [task('アルゴリズムイントロダクション', first ? 'アルゴリズムイントロダクションを30ページ読みたい' : text, {
      existingPublicId: first ? null : facts(payload, 'tasks')[0].publicId,
      workloads: index === 2 ? [] : [workload(first ? 30 : 20, 'page', 'ページ', first ? '30ページ読みたい' : '20ページにして')],
      // Deliberately echo the committed pace on the correction: the real C regression.
      effortEstimates: index === 2 ? [] : [effort('duration_per_unit', 4, '1ページ4分くらい', 'amount', 'page')],
      temporalConstraints: first ? [] : [deadline],
    })],
    corrections: first ? [] : [{ localId: 'correction', target: {
      kind: index === 1 ? 'workload' : 'temporal_constraint', publicId: bound.publicId, localId: null, mention: null,
    }, operation: 'replace', replacementLocalId: index === 1 ? 'amount' : 'timing', sourceText: text }],
  });
}
function conditionFollowup(payload: Json): Json {
  return conditionDocument({ planningIntent: 'update_plan', tasks: facts(payload, 'tasks').map((bound, index) => {
    const id = `existing-${index}`;
    return task(String(bound.title), CONDITION_FOLLOWUP, {
      localId: id, existingPublicId: bound.publicId, study: null,
      effortEstimates: bound.title === '卒業研究ノート'
        ? [effort('session_duration', 60, '1回1時間くらいで2回に分けたい', id, 'session')] : [],
      temporalConstraints: [timing('どっちも夜がいい', { localId: `night-${index}`, targetLocalId: id })],
    });
  }) });
}
function research(payload: Json, scenario: 'E' | 'F', index: number): Json {
  const text = CAMPAIGN[scenario][index];
  if (scenario === 'E' && index === 1) return conditionDocument({
    conversationActs: [{ kind: 'consultation_request', targetPublicId: null }],
  });
  const first = index === 0;
  const isF = scenario === 'F';
  const entry = task(isF ? '卒研' : '卒業研究ノート', first && isF ? '卒研を進めたい' : text, {
    existingPublicId: first ? null : facts(payload, 'tasks')[0].publicId,
    decompositionStatus: first && isF ? 'needs_breakdown' : 'atomic',
    study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: isF && index === 2 ? [{
      localId: 'note', existingPublicId: null, parentLocalId: null, role: 'material', label: '卒業研究ノート',
      workloads: [], durableContextSignals: [], sourceText: '卒業研究ノート',
    }] : [] },
    workloads: !isF && first ? [workload(3, 'hour', '時間', '卒業研究ノートを3時間進めたい')] : [],
    effortEstimates: isF && index === 1 ? [effort('total_duration', 120, text)]
      : isF && index === 3 ? [effort('session_duration', 60, '1回1時間くらいで')]
        : !isF && index === 2 ? [effort('session_duration', 90, '1回1時間半くらいで')] : [],
    temporalConstraints: first && isF ? [timing('できれば夜')] : !isF && index === 2
      ? [timing('土日にまとめたい', { dateExpression: '2026-10-17/2026-10-18', namedTimePeriod: null })] : [],
  });
  return conditionDocument({ planningIntent: first ? 'create_plan' : 'update_plan', planningWindow: first ? week : null, tasks: [entry] });
}
function math(payload: Json, index: number): Json {
  if (index === 1) return conditionDocument({ conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] });
  const first = index === 0;
  return conditionDocument({
    planningIntent: first ? 'create_plan' : 'update_plan', planningWindow: first ? week : null,
    tasks: [task('数学', CAMPAIGN.B[index], {
      existingPublicId: first ? null : facts(payload, 'tasks')[0].publicId,
      decompositionStatus: first ? 'needs_breakdown' : 'atomic',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: first ? [{
        localId: 'book', existingPublicId: null, parentLocalId: null, role: 'material', label: '数学の問題集',
        workloads: [workload(20, 'problem', '問', '数学の問題集を20問')], durableContextSignals: [], sourceText: '数学の問題集',
      }] : [] },
      effortEstimates: index === 2 ? [effort('duration_per_unit', 3, '1問3分くらい', 'task', 'problem')] : [],
    })],
    uncertainties: first ? [{ localId: 'which-book', targetLocalId: 'task', field: 'work_breakdown',
      reason: 'task constituents are not yet identified for planning', sourceText: CAMPAIGN.B[0] }] : [],
  });
}

/** Provider wire reply. Routing here is an explicit test script, never production interpretation. */
export function campaignProviderReply(scenario: CampaignScenario, request: CampaignRequest): string {
  const schema = request.response_format?.json_schema;
  const payload = campaignPayload(request);
  if (schema?.name === 'weekly_planning_stable_v5_dialogue_response') return campaignRendererReply(payload);
  if (schema?.name === 'weekly_planning_focused_contextual_answer_v5') {
    const pace = scenario === 'D';
    return JSON.stringify({ decision: pace ? 'effort_answer' : 'fallback', effortTarget: pace ? 'question_target' : null,
      effortMeasurement: pace ? 'duration_per_unit' : null, minutes: pace ? 3 : null, precision: pace ? 'approximate' : null, quantityRole: null });
  }
  if (schema?.name !== 'weekly_planning_semantic_document_v5') throw new Error(`Unscripted provider schema: ${schema?.name}`);
  const index = (CAMPAIGN[scenario] as readonly string[]).indexOf(String(payload.userText));
  if (index < 0) throw new Error(`Unscripted ${scenario} turn: ${String(payload.userText)}`);
  const document: Json = scenario === 'A' || scenario === 'G' ? schedulingDocument(scenario)
    : scenario === 'C' ? correction(payload, index)
      : scenario === 'D' ? index === 0 ? conditionSetupDocument() : conditionFollowup(payload)
        : scenario === 'B' ? math(payload, index) : research(payload, scenario, index);
  if (!schema.schema?.properties?.conversationActs) delete document.conversationActs;
  return JSON.stringify(document);
}

export function campaignRendererReply(payload: Json): string {
  const decision = (payload.applicationDecision ?? {}) as Json;
  const communication = (decision.communication ?? {}) as Json;
  const grounding = (payload.currentTurnGrounding ?? {}) as Json;
  const accepted = (grounding.acceptedFacts ?? []) as Json[];
  // Include the accepted evidence in this fixture's acknowledgement so the real renderer
  // validator checks its fact IDs and clocks. This is not Japanese naturalness evidence.
  const acknowledgement = [...new Set(accepted.map(fact => String(fact.sourceText)))].join('、');
  const prefix = acknowledgement ? `${acknowledgement}ですね。` : '';
  const continuation = communication.askQuestion ? '予定を組むため、もう少し教えてもらえますか？'
    : decision.actionKind === 'preview_ready' ? '候補を確認して、よければ「この内容で仮予定にする」を押してください。' : '予定の内容を確認してください。';
  const text = `${prefix}${continuation}`;
  return JSON.stringify({ ...(communication.consultation ? { feasibilityClaim: 'none' } : {}),
    actionId: payload.actionId ?? null, actionKind: decision.actionKind ?? 'status',
    questionCode: decision.questionCode ?? null, groundingAcknowledgement: accepted.length && grounding.mode !== 'none'
      ? { factIds: accepted.map(fact => String(fact.factId)), text: prefix } : null, text });
}
