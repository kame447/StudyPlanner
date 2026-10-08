import { createScriptedConversation, installScriptedWeeklyPlanningProvider, scriptedRendererReply, type ScriptedConversation, type ScriptedProviderCall } from './weeklyPlanningScriptedConversationHarness';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';

export const FIXED_EVENT_TURNS = ['明日の予定を立てたい', 'やっぱり今日にして', '今日10:30〜12:00は部活があるから、その予定を入れておいて', '特にない', 'ない'];
export const BUSY_ONLY_TEXT = '今日10:30〜12:00は部活がある';
export const MIXED_EVENT_TEXT = `${FIXED_EVENT_TURNS[2]}。数学を20分勉強する予定も立てて`;
export type Json = Record<string, unknown>;
export const eventDocument = (extra: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], ...extra });
export function fixedEventTask(dateExpression = 'today') {
  return { localId: 'club', existingPublicId: null, decompositionStatus: 'atomic', category: 'non_study', title: '部活', study: null,
    workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: FIXED_EVENT_TURNS[2],
    temporalConstraints: [{ localId: 'club-time', targetLocalId: 'club', kind: 'fixed_interval', constraintLevel: 'hard', dateExpression,
      namedTimePeriod: null, startTime: '10:30', endTime: '12:00', precision: 'exact', sourceText: FIXED_EVENT_TURNS[2] }] };
}
export function eventStudyTask(unitCode = 'minute') {
  const sourceText = unitCode === 'minute' ? '数学を20分勉強する' : '数学の問題集を20問解く';
  return { localId: 'study', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [{ localId: 'study-amount', quantityRole: 'target', amount: 20, unitCode, unitLabel: unitCode === 'minute' ? '分' : '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText }],
    effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText };
}
export function eventRendererReply(call: ScriptedProviderCall, textOverride?: string) {
  const decision = call.payload?.applicationDecision as Json;
  const communication = decision.communication as Json | undefined;
  const text = textOverride ?? (communication?.statusReason === 'fixed_event_manual_entry'
    ? 'この固定予定はここでは追加・保存できません。「予定を追加」から入力してください。'
    : decision.actionKind === 'question' ? 'どのような予定を立てたいですか？'
      : decision.actionKind === 'preview_ready' ? '候補が1件できました。「この内容で仮予定にする」で進められます。' : 'わかりました。');
  const grounding = call.payload?.currentTurnGrounding as { mode?: string; acceptedFacts: Array<{ factId: string; sourceText: string }> } | undefined;
  const fact = grounding?.acceptedFacts[0];
  const acknowledgement = grounding?.mode === 'required_before_resume' && fact ? `${fact.sourceText}ですね。` : '';
  return JSON.stringify({ ...JSON.parse(scriptedRendererReply(call, acknowledgement + text)),
    groundingAcknowledgement: acknowledgement ? { factIds: [fact!.factId], text: acknowledgement } : null });
}

/** Interpreted fixtures only: production never inspects these Japanese selectors. */
export function installFixedEventConversation(options: {
  architecture?: WeeklyPlanningConversationArchitecture;
  busyOnly?: boolean;
  registrationAct?: boolean;
  topicShift?: boolean;
  eventOverride?: (document: Json) => Json;
  rendererText?: string;
  ownerId?: string;
  conversationId?: string;
} = {}) {
  const architecture = options.architecture ?? 'interaction_v1';
  let conversation: ScriptedConversation;
  const provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call, options.rendererText);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    const text = call.payload?.userText;
    let document: Json;
    if (text === FIXED_EVENT_TURNS[0] || text === FIXED_EVENT_TURNS[1]) {
      const today = text === FIXED_EVENT_TURNS[1];
      document = eventDocument({ planningIntent: today ? 'update_plan' : 'create_plan', planningWindow: {
        localId: today ? 'today-window' : 'tomorrow-window', kind: 'relative_day', value: today ? 'today' : 'tomorrow', start: null, end: null, sourceText: today ? '今日' : '明日',
      }, ...(today ? { corrections: [{ localId: 'move-day', target: { kind: 'planning_window', publicId: conversation.graph()!.planningWindows[0].id, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'today-window', sourceText: FIXED_EVENT_TURNS[1] }] } : {}) });
    } else if (text !== FIXED_EVENT_TURNS[3] && text !== FIXED_EVENT_TURNS[4] && text !== 'わかりました' && text !== 'その予定も追加して') {
      document = eventDocument({ planningIntent: 'create_plan', ...(options.busyOnly ? { availabilityDeclarations: [{
        localId: 'busy-club', kind: 'unavailable', dateExpression: 'today', namedTimePeriod: null, startTime: '10:30', endTime: '12:00',
        recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: BUSY_ONLY_TEXT,
      }] } : { tasks: [fixedEventTask()] }) });
      if (options.eventOverride) document = options.eventOverride(document);
    } else document = eventDocument();
    if (architecture === 'interaction_v1') document.conversationActs = FIXED_EVENT_TURNS.slice(3).includes(String(text))
      ? [{ kind: 'decline_additional_work', targetPublicId: null }]
      : (options.registrationAct && (text === FIXED_EVENT_TURNS[2] || text === 'その予定も追加して'
          || (options.eventOverride && Array.isArray(document.tasks) && document.tasks.length > 0)))
        ? [{ kind: 'request_event_registration', targetPublicId: null }] : [];
    if (architecture === 'interaction_v1' && options.topicShift && text === FIXED_EVENT_TURNS[2])
      (document.conversationActs as Json[]).push({ kind: 'topic_shift', targetPublicId: null });
    return JSON.stringify(document);
  });
  conversation = createScriptedConversation({ provider, architecture, now: () => '2026-10-07T00:00:00.000Z',
    ...(options.ownerId ? { ownerId: options.ownerId } : {}), ...(options.conversationId ? { conversationId: options.conversationId } : {}) });
  return { provider, conversation };
}
